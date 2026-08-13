import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runtimeUrl = new URL('../public/v81-startup-source-truth.js', import.meta.url);
const runtime = fs.readFileSync(runtimeUrl, 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

test('V82 startup recovery is syntax-valid, compact-only, and injected last', () => {
  const syntax = spawnSync(process.execPath, ['--check', fileURLToPath(runtimeUrl)], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);

  assert.match(runtime, /\/api\/import\/unified-latest\?compact=1/);
  assert.match(runtime, /\/api\/session/);
  assert.match(runtime, /\/api\/state\?compact=1/);
  assert.match(runtime, /\/api\/shopee\/state\?compact=1/);
  assert.match(runtime, /unifiedImportState\s*=\s*imported/);
  assert.match(runtime, /historyCatalog\.UNIFIED/);
  assert.match(runtime, /historyModeDate\s*=\s*imported\.reportDate/);
  assert.match(runtime, /accessSession\s*=\s*session/);
  assert.match(runtime, /appState\s*=\s*ccslPayload\.state/);
  assert.match(runtime, /shopeeState\s*=\s*shopeePayload\.state/);
  assert.match(runtime, /dashboardHydrated/);
  assert.match(runtime, /RETRY_DELAYS/);

  for (const heavy of ['/api/bootstrap', '/api/v55', '/api/period-dashboard', '/api/trends', '/api/v51/whpp-state']) {
    assert.doesNotMatch(runtime, new RegExp(heavy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(injector, /v81-startup-source-truth\.js\?v=20260813-2/);
  assert.ok(injector.indexOf('v81-startup-source-truth.js') > injector.indexOf('v72-whpp-light-state-bridge.js'));
});

test('V82 binds exact 2026-08-01 source counts, user, and compact dashboard metrics in one cold-start pass', async () => {
  const status = { textContent: '' };
  const requests = [];
  let reloads = 0;

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
    document: {
      getElementById(id) { return id === 'topRangeStatus' ? status : null; }
    },
    fetch: async url => {
      requests.push(String(url));
      if (String(url).startsWith('/api/import/unified-latest')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            import: {
              snapshotId: 'SNAP-20260801',
              reportDate: '2026-08-01',
              classificationCounts: {
                CE: 2505,
                CEAF: 80,
                TBKH: 2067,
                ALI1688: 235,
                SHOPEECN: 0,
                SHOPEEVN: 4457
              },
              summary: { validUniqueWaybills: 9344 }
            }
          })
        };
      }
      if (url === '/api/session') {
        return { ok: true, status: 200, json: async () => ({ ok: true, user: { displayName: 'CE-LEE', department: '质控部', role: 'ADMIN' } }) };
      }
      if (url === '/api/state?compact=1') {
        return { ok: true, status: 200, json: async () => ({ ok: true, state: { reportDate: '2026-08-01', dashboard: { pnh: 4887, todayPod: 4700, podRate: 96.17 } } }) };
      }
      if (url === '/api/shopee/state?compact=1') {
        return { ok: true, status: 200, json: async () => ({ ok: true, state: { reportDate: '2026-08-01', dashboard: { total: 4457, todayPod: 4300 } } }) };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    dispatchEvent() {},
    location: { origin: 'http://127.0.0.1:5177', reload() { reloads += 1; } }
  };
  context.window = context;
  vm.createContext(context);

  vm.runInContext(`
    let appState = {};
    let shopeeState = {};
    let businessStates = {};
    let accessSession = {};
    let unifiedImportState = null;
    let historyCatalog = { CCSL: [], SHOPEE: [] };
    let historyModeDate = '';
    let dashboardPeriodMode = '';
    let dashboardPeriodRange = null;
    function renderAll() { globalThis.__renders = (globalThis.__renders || 0) + 1; }
    async function refresh() { globalThis.__refreshes = (globalThis.__refreshes || 0) + 1; }
  `, context);

  vm.runInContext(runtime, context);
  await new Promise(resolve => setTimeout(resolve, 180));

  const state = vm.runInContext(`({
    appState,
    shopeeState,
    unifiedImportState,
    historyModeDate,
    accessSession,
    historyCatalog,
    renders: globalThis.__renders || 0,
    refreshes: globalThis.__refreshes || 0
  })`, context);

  assert.equal(state.unifiedImportState.reportDate, '2026-08-01');
  assert.deepEqual(state.unifiedImportState.classificationCounts, {
    CE: 2505, CEAF: 80, TBKH: 2067, ALI1688: 235, SHOPEECN: 0, SHOPEEVN: 4457
  });
  assert.equal(state.historyModeDate, '2026-08-01');
  assert.equal(state.historyCatalog.UNIFIED[0].snapshotId, 'SNAP-20260801');
  assert.equal(state.accessSession.user.displayName, 'CE-LEE');
  assert.equal(state.accessSession.user.role, 'ADMIN');
  assert.equal(state.appState.reportDate, '2026-08-01');
  assert.equal(state.appState.dashboard.pnh, 4887);
  assert.equal(state.shopeeState.reportDate, '2026-08-01');
  assert.equal(state.shopeeState.dashboard.total, 4457);
  assert.ok(state.renders >= 1);
  assert.ok(state.refreshes >= 1);
  assert.deepEqual(requests.sort(), [
    '/api/import/unified-latest?compact=1',
    '/api/session',
    '/api/state?compact=1',
    '/api/shopee/state?compact=1'
  ].sort());
  assert.equal(status.textContent, '');
  assert.equal(reloads, 0);
});
