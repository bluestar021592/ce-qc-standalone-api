import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { URLSearchParams } from 'node:url';

const source = fs.readFileSync('public/v67-resilient-run-guard.js', 'utf8');
const date = '2026-09-04';
const STATUS_VERSION = '2026-09-02-v414-one-read-seven-business-status-v1';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload ?? {}); }
  };
}

async function runScenario({ whppCompleteAtStart }) {
  const calls = [];
  let whppComplete = Boolean(whppCompleteAtStart);
  const statusNode = { dataset: {}, innerHTML: '' };
  const runButton = { disabled: false, textContent: '' };
  const elements = new Map([
    ['importPage', { hidden: false }],
    ['reportDate', { value: date }],
    ['ccslRunStatus', statusNode]
  ]);
  const document = {
    visibilityState: 'visible',
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) { return selector === '[data-testid="global-auto-process"]' ? runButton : null; },
    addEventListener() {},
    dispatchEvent() { return true; }
  };
  const persisted = () => ({
    ok: true,
    statusVersion: STATUS_VERSION,
    reportDate: date,
    stages: {
      CCSL: { reportDate: date, complete: true, running: false },
      SHOPEE: { reportDate: date, complete: true, running: false },
      WHPP: { reportDate: date, complete: whppComplete, running: !whppComplete, phase: whppComplete ? '完成' : '订单扫描' }
    }
  });
  const context = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    location: { pathname: '/import' },
    document,
    URLSearchParams,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    async fetch(input, options = {}) {
      const url = String(input || '');
      const method = String(options.method || 'GET').toUpperCase();
      calls.push({ url, method });
      if (url.startsWith('/api/v33/run-progress?')) return response(persisted());
      if (url === '/api/whpp/run/start' && method === 'POST') {
        whppComplete = true;
        return response({ ok: true, accepted: true });
      }
      if (url === '/api/whpp/run/resume' && method === 'POST') {
        whppComplete = true;
        return response({ ok: true, accepted: true });
      }
      if (url === '/api/import/unified-latest?compact=1') return response({ ok: true, import: { reportDate: date } });
      return response({ ok: true });
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'public/v67-resilient-run-guard.js' });
  assert.equal(typeof context.runUnified, 'function', 'V67 must install the unified runner');
  const result = await context.runUnified();
  return { result, calls, statusNode, runButton };
}

const completed = await runScenario({ whppCompleteAtStart: true });
assert.equal(completed.result.ok, true, 'an already completed three-stage lifecycle must remain complete');
assert.equal(completed.result.results.length, 3);
assert.ok(completed.result.results.every(row => row.skipped === true && row.canonicalComplete === true), 'all persisted-complete stages must be skipped');
assert.deepEqual(completed.calls.filter(call => call.method === 'POST'), [], 'persisted-complete WHPP must never be re-posted by unified processing');
assert.match(completed.statusNode.innerHTML, /七业务当日日报处理完成/);

const pendingWhpp = await runScenario({ whppCompleteAtStart: false });
assert.equal(pendingWhpp.result.ok, true, 'an actually incomplete WHPP stage must still be allowed to run');
assert.equal(pendingWhpp.result.results[0]?.skipped, true, 'completed CCSL must stay skipped');
assert.equal(pendingWhpp.result.results[1]?.skipped, true, 'completed SHOPEE must stay skipped');
assert.equal(pendingWhpp.result.results[2]?.ok, true, 'WHPP must finish after the one authorized run request');
assert.deepEqual(
  pendingWhpp.calls.filter(call => call.method === 'POST').map(call => call.url),
  ['/api/whpp/run/start'],
  'only incomplete WHPP may receive exactly one start request'
);

console.log('[V426] unified completed-stage skip smoke passed · already-complete WHPP is read-only and never re-posted · incomplete WHPP receives exactly one authorized start while completed CCSL/SHOPEE remain skipped');
