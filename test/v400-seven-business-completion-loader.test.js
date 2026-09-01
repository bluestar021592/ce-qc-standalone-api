import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('V410 UI loader serves atomic import truth then V409/V169 status chain and keeps retired WHPP layers out', () => {
  const loader = read('../src/v44WhppUiPatch.js');
  const v146At = loader.indexOf('/v146-unified-import-date-status.js');
  const v168At = loader.indexOf('/v168-seven-business-status.js');
  const v169At = loader.indexOf('/v169-seven-business-legacy-status-sync.js');

  assert.match(loader, /v410-atomic-import-light-status-loader-v1/);
  assert.match(loader, /WHPP_PAGE_OWNER='V132'/);
  assert.match(loader, /X-CE-QC-WHPP-Page-Owner/);
  assert.ok(v146At >= 0, 'V146 atomic import owner must be loaded');
  assert.ok(v168At > v146At, 'V409 status owner must load after V146 pending-date truth');
  assert.ok(v169At > v168At, 'V169 completion guard must load after V168 canonical truth');
  assert.match(loader, /v146-unified-import-date-status\.js\?v=20260901-v410-1/);
  assert.match(loader, /v168-seven-business-status\.js\?v=20260901-v409-1/);

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

test('V409/V410 reproduce and prevent the 6668-vs-6748, stale-date, and Failed-to-fetch regressions', () => {
  const importUi = read('../public/v146-unified-import-date-status.js');
  const statusUi = read('../public/v168-seven-business-status.js');

  const screenshotCounts = { CE:2339, CEAF:11, TBKH:2178, ALI1688:81, SHOPEECN:637, SHOPEEVN:1422, WHPP:80 };
  assert.equal(Object.values(screenshotCounts).reduce((sum, value) => sum + value, 0), 6748);
  assert.equal(screenshotCounts.CE + screenshotCounts.CEAF + screenshotCounts.TBKH + screenshotCounts.ALI1688 + screenshotCounts.SHOPEECN + screenshotCounts.SHOPEEVN, 6668);
  assert.equal(6748 - 6668, screenshotCounts.WHPP);

  assert.match(importUi, /v410-atomic-seven-business-visible-truth-v1/);
  assert.match(importUi, /BUSINESS_TYPES=\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]/);
  assert.match(importUi, /function sevenBusinessTotal\(counts=\{\}\)\{return BUSINESS_TYPES\.reduce/);
  assert.match(importUi, /validUniqueWaybills:total,sevenBusinessValidUniqueWaybills:total/);
  assert.match(importUi, /UNIFIED_IMPORT_NOT_COMMITTED/);
  assert.match(importUi, /status:409,statusText:'Unified import not committed'/);
  assert.match(importUi, /committed=Boolean\(response\.ok&&payload\?\.ok===true&&payload\?\.importCommitted===true/);
  assert.match(importUi, /callerResponse=response\.ok&&payload\?\.ok===true\?uncommittedResponse/);
  assert.match(importUi, /callerResponse=responseWithPayload\(response,payload\)/);
  assert.match(importUi, /七业务有效唯一单号/);

  assert.match(statusUi, /v409-pending-date-light-status-v1/);
  const pendingPos = statusUi.indexOf('const pending = pendingImportDate()');
  const reportInputPos = statusUi.indexOf("document.getElementById('reportDate')?.value");
  assert.ok(pendingPos >= 0 && reportInputPos > pendingPos, 'selected/pending report date must beat the previous committed reportDate input');
  assert.match(statusUi, /__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__\?\.getPendingDate/);
  assert.match(statusUi, /\/api\/v132\/whpp-fast-summary\?reportDate=\$\{encoded\}&compact=1/);
  assert.match(statusUi, /STATUS_ATTEMPTS = 2/);
  assert.match(statusUi, /function transientStage/);
  assert.match(statusUi, /statusFresh: false/);
  assert.match(statusUi, /保留上一次真实进度并自动重试/);
  assert.match(statusUi, /complete: stages\.every\(stage => stage\.state === 'done' && stage\.statusFresh !== false\)/);
  assert.doesNotMatch(statusUi, /\/api\/whpp\/run\/start|\/api\/shopee\/run\/start/);
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
