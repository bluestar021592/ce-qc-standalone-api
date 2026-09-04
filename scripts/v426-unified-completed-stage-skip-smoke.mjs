import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { URLSearchParams } from 'node:url';

const runnerSource = fs.readFileSync('public/v67-resilient-run-guard.js', 'utf8');
const v64Source = fs.readFileSync('public/v64-whpp-total-kpi-integration.js', 'utf8');
const v68Source = fs.readFileSync('public/v68-whpp-classification-stability.js', 'utf8');
const v94Source = fs.readFileSync('public/v94-business-source-truth-ui-v2.js', 'utf8');
const shellSource = fs.readFileSync('src/v44WhppUiPatch.js', 'utf8');
const date = '2026-09-04';
const STATUS_VERSION = '2026-09-02-v414-one-read-seven-business-status-v1';
const SEVEN_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload ?? {}); },
    async json() { return payload ?? {}; },
    clone() { return response(payload, status); }
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
    readyState: 'complete',
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
    setTimeout(callback, delay = 0) {
      if (Number(delay || 0) === 0 && typeof callback === 'function') callback();
      return 1;
    },
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
  vm.runInContext(runnerSource, context, { filename: 'public/v67-resilient-run-guard.js' });
  assert.equal(typeof context.runUnified, 'function', 'V67 must install the unified runner');
  const result = await context.runUnified();
  return { result, calls, statusNode, runButton };
}

function authoritativeImportFixture() {
  const classificationCounts = {
    CE: 2500,
    CEAF: 300,
    TBKH: 700,
    ALI1688: 560,
    SHOPEECN: 500,
    SHOPEEVN: 500,
    WHPP: 228
  };
  const total = SEVEN_TYPES.reduce((sum, type) => sum + classificationCounts[type], 0);
  assert.equal(total, 5288);
  return {
    batchId: 'BATCH-V426-5288',
    snapshotId: 'SNAP-V426-5288',
    reportDate: date,
    classificationCounts,
    sourceReconciliation: {
      businessTypes: [...SEVEN_TYPES],
      validUniqueWaybills: total,
      classifiedWaybills: total,
      difference: 0,
      balanced: true
    },
    summary: { rawRows: total, duplicateRows: 0, missingWaybillRows: 0, validUniqueWaybills: total, totalUnique: total }
  };
}

function loadImportTruthScript(source, apiKey, state, fetchPayload) {
  const calls = [];
  const document = {
    readyState: 'loading',
    documentElement: { dataset: {} },
    body: {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    createTreeWalker() { return { nextNode() { return false; } }; },
    createElement() { return { dataset: {}, querySelector() { return null; }, appendChild() {}, remove() {} }; }
  };
  const context = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    document,
    location: { pathname: '/import', origin: 'http://127.0.0.1' },
    unifiedImportState: state,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class MutationObserver { observe() {} disconnect() {} },
    requestAnimationFrame() { return 1; },
    setTimeout() { return 1; },
    clearTimeout() {},
    addEventListener() {},
    async fetch(input) {
      calls.push(String(input || ''));
      return response(fetchPayload);
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: apiKey });
  return { context, api: context[apiKey], calls };
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

const v68State = authoritativeImportFixture();
const v68 = loadImportTruthScript(
  v68Source,
  '__CE_QC_V68_WHPP_CLASSIFICATION_STABILITY__',
  v68State,
  { ok: true, reportDate: date, total: 0, metrics: { total: 0 } }
);
assert.ok(v68.api, 'V68 API must install');
assert.match(v68.api.version, /v426-unified-import-seven-business-truth-priority/);
const v68Truth = v68.api.authoritativeImportTruth(v68State);
assert.equal(v68Truth?.whppTotal, 228);
assert.equal(v68Truth?.fullUnique, 5288);
const v68Sync = await v68.api.sync(true);
assert.equal(v68Sync?.skipped, true, 'V68 must skip the secondary WHPP request when balanced seven-business import truth exists');
assert.equal(v68.calls.length, 0, 'V68 must not even fetch the secondary WHPP summary for authoritative imports');
assert.equal(v68State.classificationCounts.WHPP, 228);
assert.equal(v68State.summary.validUniqueWaybills, 5288);

const v64State = authoritativeImportFixture();
const v64 = loadImportTruthScript(
  v64Source,
  '__CE_QC_V64_WHPP_TOTAL_KPI__',
  v64State,
  {
    ok: true,
    reportDate: date,
    total: 0,
    metrics: { total: 0, pending3: 12, pod: 80 },
    regions: { PV: { unresolved: 9 } }
  }
);
assert.ok(v64.api, 'V64 API must install');
assert.match(v64.api.version, /v426-unified-import-truth-kpi-v3/);
assert.equal(typeof v64.api.refreshClassification, 'function', 'V64 must expose a synchronous classification-only refresh independent of metrics');
const v64Stats = v64.api.importStats();
assert.equal(v64Stats.authoritativeImport, true);
assert.equal(v64Stats.whppTotal, 228);
assert.equal(v64Stats.fullUnique, 5288);
const v64Summary = await v64.api.readWhppSummary(date);
assert.equal(v64.calls.length, 1, 'V64 may fetch WHPP metrics once, but not classification truth');
assert.equal(v64Summary.total, 228, 'stale WHPP fast-summary total=0 must be replaced by imported WHPP=228');
assert.equal(v64Summary.classificationTotal, 5288, 'HOME total must retain the seven-business imported 5288');
assert.equal(v64Summary.classificationSource, 'V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH');
assert.equal(v64Summary.metrics.pending3, 12, 'WHPP processing metrics may still come from the fast summary');
assert.match(shellSource, /v64-whpp-total-kpi-integration\.js\?v=20260904-v426-3/, 'shell must cache-bust V64 to the protected synchronous V426 v3 build');
assert.doesNotMatch(shellSource, /v64-whpp-total-kpi-integration\.js\?v=20260904-v426-[12]/, 'retired V64 v1/v2 cache-busts must not survive');

const v94State = authoritativeImportFixture();
const v94 = loadImportTruthScript(
  v94Source,
  '__CE_QC_V94_BUSINESS_SOURCE_TRUTH_UI__',
  v94State,
  {
    ok: true,
    reportDate: date,
    total: 5060,
    counts: { CE:2500, CEAF:300, TBKH:700, ALI1688:560, SHOPEECN:500, SHOPEEVN:500, WHPP:0 }
  }
);
assert.ok(v94.api, 'V94 API must install');
assert.match(v94.api.version, /v426-unified-import-truth-priority/);
const v94Sync = await v94.api.sync();
assert.equal(v94Sync?.skipped, true, 'V94 must skip stale dashboard classification when unified import proof is balanced');
assert.equal(v94.calls.length, 0, 'V94 must not fetch a competing dashboard summary for authoritative imports');
assert.equal(v94State.classificationCounts.WHPP, 228);
assert.equal(v94State.summary.validUniqueWaybills, 5288);
assert.equal(v94State.sevenBusinessValidUniqueWaybills, 5288);

console.log('[V426] regression smoke passed · completed WHPP is never re-posted · incomplete WHPP gets one authorized start · balanced unified import 5060+228=5288 outranks stale V64 HOME WHPP totals and stale V68/V94 summaries · V64 synchronous classification refresh is independent from asynchronous WHPP metrics');
