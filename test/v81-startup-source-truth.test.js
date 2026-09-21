import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runtimeUrl = new URL('../public/v81-startup-source-truth.js', import.meta.url);
const runtime = fs.readFileSync(runtimeUrl, 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

test('V555 startup recovery is syntax-valid, shell-first, and never requests aggregate state', () => {
  const syntax = spawnSync(process.execPath, ['--check', fileURLToPath(runtimeUrl)], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);

  assert.match(runtime, /PRIMARY_GRACE_MS/);
  assert.match(runtime, /refreshPromise/);
  assert.match(runtime, /Promise\.race/);
  assert.match(runtime, /\/api\/import\/unified-latest\?compact=1/);
  assert.match(runtime, /\/api\/session/);
  assert.doesNotMatch(runtime, /\/api\/state\?compact=1/);
  assert.doesNotMatch(runtime, /\/api\/shopee\/state\?compact=1/);
  assert.match(runtime, /unifiedImportState\s*=\s*imported/);
  assert.match(runtime, /historyCatalog\.UNIFIED/);
  assert.match(runtime, /accessSession\s*=\s*session/);
  assert.doesNotMatch(runtime, /appState\s*=\s*ccsl\.state/);
  assert.doesNotMatch(runtime, /shopeeState\s*=\s*shopee\.state/);
  assert.doesNotMatch(runtime, /RETRY_DELAYS/);
  assert.doesNotMatch(runtime, /location\.reload\(\)/,'startup auth recovery must never enter a full-page reload loop');
  assert.match(runtime, /ce_startup_auth_redirect_inflight/,'startup auth redirect must be single-flight');
  assert.match(runtime, /SHELL_FIRST_NO_AGGREGATE_STATE_RECOVERY/);
  assert.doesNotMatch(runtime, /scheduleNormalRefresh/);

  for (const heavy of ['/api/bootstrap', '/api/v55', '/api/period-dashboard', '/api/trends', '/api/v51/whpp-state']) {
    assert.doesNotMatch(runtime, new RegExp(heavy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(injector, /v81-startup-source-truth\.js\?v=20260921-v564-1/);
  assert.ok(injector.indexOf('v81-startup-source-truth.js') > injector.indexOf('v72-whpp-light-state-bridge.js'));
});

test('when app.js primary refresh is already ready V555 makes zero duplicate startup requests', async () => {
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


test('when aggregate dashboard state is absent V555 performs only bounded session/latest recovery and leaves the shell interactive', async () => {
  const status = { textContent: '' };
  const requests = [];
  const events = [];
  let renders = 0;

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
    fetch: async url => {
      requests.push(String(url));
      if (String(url) === '/api/session') {
        return { ok: true, async json() { return { user: { displayName: 'Local Admin', role: 'ADMIN' } }; } };
      }
      if (String(url) === '/api/import/unified-latest?compact=1') {
        return { ok: true, async json() { return { ok: true, import: null }; } };
      }
      throw new Error(`unexpected startup request: ${url}`);
    },
    dispatchEvent(event) { events.push(event); },
    location: { reload() { throw new Error('unexpected reload'); } }
  };
  context.window = context;
  vm.createContext(context);

  vm.runInContext(`
    let appState = {};
    let shopeeState = {};
    let businessStates = {};
    let accessSession = {};
    let unifiedImportState = null;
    let historyCatalog = { CCSL: [], SHOPEE: [], UNIFIED: [] };
    let historyModeDate = '';
    let dashboardPeriodMode = '';
    let dashboardPeriodRange = null;
    let refreshPromise = Promise.resolve('shell-painted-without-aggregate-state');
    function renderAll() { globalThis.__renders = (globalThis.__renders || 0) + 1; }
  `, context);

  vm.runInContext(runtime, context);
  await new Promise(resolve => setTimeout(resolve, 80));
  renders = Number(context.__renders || 0);

  assert.deepEqual([...requests].sort(), ['/api/import/unified-latest?compact=1','/api/session'].sort());
  assert.equal(requests.some(url => /\/api\/(?:shopee\/)?state/.test(url)), false);
  assert.ok(renders >= 1, 'lightweight session/latest recovery may repaint the shell');
  assert.equal(status.textContent, '');
  const ready = events.find(event => event.type === 'ce-qc-startup-truth-ready');
  assert.ok(ready, 'shell-ready event should be emitted once session is available');
  assert.equal(ready.detail.shellReady, true);
  assert.equal(ready.detail.dataReady, false);
});
