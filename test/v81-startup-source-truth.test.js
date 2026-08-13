import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runtimeUrl = new URL('../public/v81-startup-source-truth.js', import.meta.url);
const runtime = fs.readFileSync(runtimeUrl, 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

test('V89 startup recovery is syntax-valid, compact-only, and waits for the primary refresh single-flight', () => {
  const syntax = spawnSync(process.execPath, ['--check', fileURLToPath(runtimeUrl)], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);

  assert.match(runtime, /PRIMARY_GRACE_MS/);
  assert.match(runtime, /refreshPromise/);
  assert.match(runtime, /Promise\.race/);
  assert.match(runtime, /\/api\/import\/unified-latest\?compact=1/);
  assert.match(runtime, /\/api\/session/);
  assert.match(runtime, /\/api\/state\?compact=1/);
  assert.match(runtime, /\/api\/shopee\/state\?compact=1/);
  assert.match(runtime, /unifiedImportState\s*=\s*imported/);
  assert.match(runtime, /historyCatalog\.UNIFIED/);
  assert.match(runtime, /accessSession\s*=\s*session/);
  assert.match(runtime, /appState\s*=\s*ccsl\.state/);
  assert.match(runtime, /shopeeState\s*=\s*shopee\.state/);
  assert.match(runtime, /RETRY_DELAYS/);
  assert.doesNotMatch(runtime, /scheduleNormalRefresh/);

  for (const heavy of ['/api/bootstrap', '/api/v55', '/api/period-dashboard', '/api/trends', '/api/v51/whpp-state']) {
    assert.doesNotMatch(runtime, new RegExp(heavy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(injector, /v81-startup-source-truth\.js\?v=20260813-3/);
  assert.ok(injector.indexOf('v81-startup-source-truth.js') > injector.indexOf('v72-whpp-light-state-bridge.js'));
});

test('when app.js primary refresh is already ready V89 makes zero duplicate startup requests', async () => {
  const status = { textContent: '' };
  const requests = [];
  const events = [];

  const context = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    sessionStorage: { setItem() {} },
    document: { getElementById(id) { return id === 'topRangeStatus' ? status : null; } },
    fetch: async url => { requests.push(String(url)); throw new Error(`duplicate request: ${url}`); },
    dispatchEvent(event) { events.push(event); },
    location: { reload() { throw new Error('unexpected reload'); } }
  };
  context.window = context;
  vm.createContext(context);

  vm.runInContext(`
    let appState = { reportDate: '2026-08-01' };
    let shopeeState = { reportDate: '2026-08-01' };
    let businessStates = {};
    let accessSession = { user: { displayName: 'CE-LEE' } };
    let unifiedImportState = { snapshotId: 'SNAP-20260801', reportDate: '2026-08-01' };
    let historyCatalog = { CCSL: [], SHOPEE: [], UNIFIED: [] };
    let historyModeDate = '2026-08-01';
    let dashboardPeriodMode = '';
    let dashboardPeriodRange = null;
    let refreshPromise = Promise.resolve('primary-ready');
    function renderAll() { globalThis.__renders = (globalThis.__renders || 0) + 1; }
  `, context);

  vm.runInContext(runtime, context);
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.deepEqual(requests, []);
  assert.equal(events.filter(event => event.type === 'ce-qc-startup-truth-ready').length, 1);
  assert.equal(events[0].detail.reportDate, '2026-08-01');
  assert.equal(events[0].detail.snapshotId, 'SNAP-20260801');
  assert.equal(status.textContent, '');
});
