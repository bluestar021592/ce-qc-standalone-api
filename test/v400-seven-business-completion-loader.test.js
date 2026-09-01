import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('V406 UI loader serves V169 after V168, keeps seven-business total sync, and retires redundant WHPP browser layers', () => {
  const loader = read('../src/v44WhppUiPatch.js');
  const v168At = loader.indexOf('/v168-seven-business-status.js');
  const v169At = loader.indexOf('/v169-seven-business-legacy-status-sync.js');

  assert.match(loader, /v406-retire-redundant-whpp-browser-layers-v1/);
  assert.match(loader, /WHPP_PAGE_OWNER='V132'/);
  assert.match(loader, /X-CE-QC-WHPP-Page-Owner/);
  assert.ok(v168At >= 0, 'V168 canonical status script must be loaded');
  assert.ok(v169At > v168At, 'V169 completion guard must load after V168 canonical truth');

  for (const retired of [
    '/whpp-v44.js',
    '/whpp-v45-cleanup.js',
    '/whpp-v47-auto-run.js',
    '/v52-whpp-source-truth-route.js',
    '/v72-whpp-light-state-bridge.js',
    '/v103-home-whpp-card-guard.js'
  ]) {
    assert.equal(loader.includes(retired), false, `${retired} must stay retired from the live browser chain`);
  }

  assert.match(loader, /\/v132-whpp-seven-business-fast\.js/);
  assert.match(loader, /\/v170-route-isolation-whpp-priority\.js\?v=20260901-v404-1/);

  const v170 = read('../public/v170-route-isolation-whpp-priority.js');
  assert.match(v170, /routeIsolationOnly:\s*true/);
  assert.match(v170, /authoritativeRunner:\s*'V67'/);
  assert.doesNotMatch(v170, /executePriority|patchRunner|\/api\/whpp\/run\/start|\/api\/shopee\/run\/start/);

  const totalSync = read('../public/v68-whpp-classification-stability.js');
  assert.match(totalSync, /fullUnique:\s*core\s*\+\s*whppTotal/);
  assert.match(totalSync, /日报导入完成，\\s\*共/);
  assert.match(totalSync, /state\.summary\s*=\s*\{[\s\S]*validUniqueWaybills:\s*core\s*\+\s*total/);
});

test('V408 home WHPP KPI reads canonical V132 summary and preserves normal-flow semantics', () => {
  const v64 = read('../public/v64-whpp-total-kpi-integration.js');
  assert.match(v64, /v408-canonical-v132-home-kpi-v1/);
  assert.match(v64, /\/api\/v132\/whpp-fast-summary/);
  assert.doesNotMatch(v64, /\/api\/v71\/whpp-summary/);
  assert.match(v64, /metrics\.activeStoreRetention/);
  assert.match(v64, /metrics\.selfPickup/);
  assert.match(v64, /regions\?\.PV\?\.unresolved/);
  assert.match(v64, /patchCountMetric\('CCSLCN分流'/);
  assert.match(v64, /patchCountMetric\('CCSLZT分流'/);
  assert.doesNotMatch(v64, /patchCountMetric\('CECN滞留包裹'/);
  assert.doesNotMatch(v64, /patchCountMetric\('CEZT滞留包裹'/);

  const reporting = read('../src/whppReporting.js');
  assert.match(reporting, /activeStoreRetentionRows\s*=\s*activeShopRows\.filter[\s\S]*>=\s*2/);
  assert.match(reporting, /selfPickupRows\s*=\s*normalDiversionRows\.filter[\s\S]*SELF_PICKUP/);
  assert.match(reporting, /activeStoreRetention:\s*activeStoreRetentionRows\.length/);
  assert.match(reporting, /selfPickup:\s*selfPickupRows\.length/);
});

test('V169 blocks completed run/resume entries, hides stale continue CTA, and releases the lock for a new lifecycle', async () => {
  const source = read('../public/v169-seven-business-legacy-status-sync.js');
  const attrs = { onclick: 'resumeUnified()' };
  const button = {
    textContent: '继续七业务处理',
    dataset: {},
    style: {},
    disabled: false,
    hidden: false,
    title: '',
    children: [],
    getAttribute(name) { return attrs[name] ?? null; },
    setAttribute(name, value) { attrs[name] = String(value); },
    removeAttribute(name) { delete attrs[name]; if (name === 'title') this.title = ''; }
  };

  const reportDate = { value: '2026-08-26' };
  const document = {
    readyState: 'loading',
    visibilityState: 'visible',
    body: {},
    getElementById(id) { return id === 'reportDate' ? reportDate : null; },
    querySelectorAll(selector) {
      if (selector === 'button') return [button];
      if (selector === 'button[data-v169-canonical-complete="1"]') {
        return button.dataset.v169CanonicalComplete === '1' ? [button] : [];
      }
      return [];
    },
    addEventListener() {}
  };

  let runCalls = 0;
  let resumeCalls = 0;
  const canonical = {
    lastTruth: { reportDate: '2026-08-26', complete: true },
    refresh: async function () { return this.lastTruth; }
  };
  const window = {
    __CE_QC_V168_SEVEN_BUSINESS_STATUS__: canonical,
    runUnified: async () => { runCalls += 1; return { ok: true, original: true }; },
    resumeUnified: async () => { resumeCalls += 1; return { ok: true, original: true }; },
    addEventListener() {}
  };

  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
  }

  const context = {
    window,
    document,
    MutationObserver,
    console: { info() {}, warn() {}, error() {} },
    Promise,
    Date,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {}
  };

  vm.runInNewContext(source, context, { filename: 'v169-seven-business-legacy-status-sync.js' });
  const api = window.__CE_QC_V169_LEGACY_STATUS_SYNC__;
  assert.ok(api, 'V169 API must install');
  assert.equal(api.apply(), true);
  assert.equal(button.hidden, true);
  assert.equal(button.disabled, true);

  const resumed = await window.resumeUnified();
  const started = await window.runUnified();
  assert.equal(resumed.code, 'SEVEN_BUSINESS_ALREADY_COMPLETE');
  assert.equal(started.code, 'SEVEN_BUSINESS_ALREADY_COMPLETE');
  assert.equal(resumeCalls, 0);
  assert.equal(runCalls, 0);

  canonical.lastTruth = { reportDate: '2026-08-27', complete: false };
  reportDate.value = '2026-08-27';
  assert.equal(api.apply(), false);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);

  const nextResume = await window.resumeUnified();
  assert.equal(nextResume.original, true);
  assert.equal(resumeCalls, 1);

  canonical.lastTruth = { reportDate: '2026-08-26', complete: true };
  reportDate.value = '2026-08-27';
  assert.equal(api.apply(), false, 'a stale completed truth from the previous report must not lock a new report date');
  await window.runUnified();
  assert.equal(runCalls, 1);
});
