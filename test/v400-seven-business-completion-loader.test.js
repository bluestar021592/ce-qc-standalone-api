import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('UI loader serves atomic import truth then one persisted V322/V168 status chain and keeps WHPP display-only', () => {
  const loader = read('../src/v44WhppUiPatch.js');
  const v146At = loader.indexOf('/v146-unified-import-date-status.js');
  const v168At = loader.indexOf('/v168-seven-business-status.js');
  const v169At = loader.indexOf('/v169-seven-business-legacy-status-sync.js');

  assert.match(loader, /2026-09-13-v509-no-live-trend-shell-v1/);
  assert.match(loader, /PERSISTED_STATUS_BUILD='2026-09-02-v414-one-read-seven-business-status-v1'/);
  assert.match(loader, /X-CE-QC-Persisted-Status/);
  assert.match(loader, /WHPP_PAGE_OWNER='V132'/);
  assert.match(loader, /X-CE-QC-WHPP-Page-Owner/);
  assert.ok(v146At >= 0, 'V146 atomic import owner must be loaded');
  assert.ok(v168At > v146At, 'persisted status owner must load after V146 pending-date truth');
  assert.ok(v169At > v168At, 'V169 entry guard must load after V168 canonical truth');
  assert.match(loader, /v146-unified-import-date-status\.js\?v=20260901-v410-1/);
  assert.match(loader, /v168-seven-business-status\.js\?v=20260902-v414-status-1/);
  assert.match(loader, /v67-resilient-run-guard\.js\?v=20260902-v414-explicit-1/);
  assert.match(loader, /v159-current-import-stability\.js\?v=20260902-v419-open-single-source-1/);
  assert.match(loader, /v132-whpp-seven-business-fast\.js\?v=20260902-display-only-2/);
  assert.match(loader, /v169-seven-business-legacy-status-sync\.js\?v=20260901-v411-1/);

  for (const retired of [
    '/whpp-v44.js',
    '/whpp-v45-cleanup.js',
    '/whpp-v47-auto-run.js',
    '/v52-whpp-source-truth-route.js',
    '/v72-whpp-light-state-bridge.js',
    '/v103-home-whpp-card-guard.js'
  ]) assert.equal(loader.includes(retired), false, `${retired} must stay retired from the live browser chain`);

  const whpp = read('../public/v132-whpp-seven-business-fast.js');
  assert.match(whpp, /displayOnly:true,authoritativeRunner:'V67'/);
  assert.match(whpp, /VERSION='2026-09-03-v419-whpp-one-global-range-board-v2'/);
  assert.match(whpp, /REVISION='2026-09-03-v419-whpp-range-summary-trend-detail-v2'/);
  assert.doesNotMatch(whpp, /继续七业务处理|onclick="window\.runUnified\(\)"|\/api\/whpp\/run\/start/);

  const v170 = read('../public/v170-route-isolation-whpp-priority.js');
  assert.match(v170, /routeIsolationOnly:\s*true/);
  assert.match(v170, /authoritativeRunner:\s*'V67'/);
  assert.doesNotMatch(v170, /executePriority|patchRunner|\/api\/whpp\/run\/start|\/api\/shopee\/run\/start/);

  const totalSync = read('../public/v68-whpp-classification-stability.js');
  assert.match(totalSync, /fullUnique:\s*core\s*\+\s*whppTotal/);
  assert.match(totalSync, /日报导入完成，\s*共/);
  assert.match(totalSync, /state\.summary\s*=\s*\{[\s\S]*validUniqueWaybills:\s*core\s*\+\s*total/);
});

test('V168 performs one exact-date persisted status read; V419 keeps V414 semantics on a scalar current-cohort proof chain', () => {
  const importUi = read('../public/v146-unified-import-date-status.js');
  const statusUi = read('../public/v168-seven-business-status.js');
  const fastStatus = read('../src/v322WebAvailabilityPatch.js');
  const fastProof = read('../src/v418StatusProofFastPath.js');

  const screenshotCounts = { CE:2339, CEAF:11, TBKH:2178, ALI1688:81, SHOPEECN:637, SHOPEEVN:1422, WHPP:80 };
  assert.equal(Object.values(screenshotCounts).reduce((sum, value) => sum + value, 0), 6748);
  assert.equal(screenshotCounts.CE + screenshotCounts.CEAF + screenshotCounts.TBKH + screenshotCounts.ALI1688 + screenshotCounts.SHOPEECN + screenshotCounts.SHOPEEVN, 6668);
  assert.equal(6748 - 6668, screenshotCounts.WHPP);

  assert.match(importUi, /v410-atomic-seven-business-visible-truth-v1/);
  assert.match(importUi, /BUSINESS_TYPES=\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]/);
  assert.match(importUi, /function sevenBusinessTotal\(counts=\{\}\)\{return BUSINESS_TYPES\.reduce/);
  assert.match(importUi, /validUniqueWaybills:total,sevenBusinessValidUniqueWaybills:total/);
  assert.match(importUi, /UNIFIED_IMPORT_NOT_COMMITTED/);

  assert.match(statusUi, /v168-one-persisted-status-read-v1/);
  assert.match(statusUi, /STATUS_SOURCE_REVISION = '2026-09-02-v414-one-read-seven-business-status-v1'/);
  const pendingPos = statusUi.indexOf('const pending = pendingImportDate()');
  const reportInputPos = statusUi.indexOf("document.getElementById('reportDate')?.value");
  assert.ok(pendingPos >= 0 && reportInputPos > pendingPos, 'pending report date must beat the previous committed reportDate input');
  assert.match(statusUi, /__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__\?\.getPendingDate/);
  assert.match(statusUi, /STATUS_TIMEOUT_MS = 8000/);
  assert.match(statusUi, /STATUS_POLL_MS = 10000/);
  assert.match(statusUi, /businessType: 'ALL', reportDate: target/);
  assert.match(statusUi, /\/api\/v33\/run-progress\?\$\{query\.toString\(\)\}/);
  assert.match(statusUi, /statusFresh: false/);
  assert.match(statusUi, /状态确认中/);
  assert.match(statusUi, /确认前禁止重复启动/);
  assert.doesNotMatch(statusUi, /\/api\/v311\/shopee-recovery|\/api\/v317\/ccsl-recovery|\/api\/v132\/whpp-fast-summary/);
  assert.doesNotMatch(statusUi, /Promise\.allSettled|\/api\/whpp\/run\/start|\/api\/shopee\/run\/start/);

  assert.match(fastStatus, /V322_SEVEN_BUSINESS_STATUS_ID='2026-09-02-v414-one-read-seven-business-status-v1'/);
  assert.match(fastStatus, /V322_WHPP_COMPLETION_PARITY_ID='2026-09-02-v414-whpp-success-evidence-parity-v1'/);
  assert.match(fastStatus, /V419_SCALAR_STATUS_PRIORITY_ID='2026-09-02-v419-scalar-status-priority-no-json-v1'/);
  assert.match(fastStatus, /V419_STATUS_TIMING_ID='2026-09-02-v419-status-substage-timing-v1'/);
  assert.match(fastStatus, /readV322SevenBusinessStatus/);
  assert.match(fastStatus, /stages:\{CCSL,SHOPEE,WHPP\}/);
  assert.match(fastStatus, /PERSISTED_DAILY_HEADER_RUN_LOCK_SNAPSHOT/);
  assert.match(fastStatus, /PERSISTED_WHPP_V414_SUCCESS_AND_RESTART_PROOF/);
  assert.match(fastStatus, /readV418CurrentMembershipCounts/);
  assert.match(fastStatus, /readV418CcslProcessingProof/);
  assert.match(fastStatus, /readV418BusinessSuccessCoverage/);
  assert.match(fastStatus, /COMPLETE_LOCK\.has/);
  assert.match(fastStatus, /unifiedCompletionClaim\(db,batch\)/);
  assert.match(fastStatus, /coverage\?\.ok&&n\(coverage\.count\)>=n\(counts\.WHPP\)/,
    'WHPP may complete only when current-member SUCCESS coverage reaches the current WHPP cohort');
  assert.match(fastStatus, /restartInterrupted/);
  assert.match(fastStatus, /PROCESS_RESTART_INTERRUPTED/);
  assert.match(fastStatus, /this\.route\(pathValue\)\.get\(progressHandler\)/,
    'V419 status route must bypass the legacy V415 response wrapper and avoid a second proof read');
  assert.doesNotMatch(fastStatus, /readV415CurrentProcessingProof/,
    'V419 V322 must not invoke the legacy second proof chain');
  assert.match(fastStatus, /code:'V322_PERSISTED_STATUS_READ_FAILED'/,
    'status read failure must preserve the canonical V322 code for existing browser consumers');
  assert.match(fastStatus, /detailCode:'V419_SCALAR_STATUS_READ_FAILED'/,
    'V419 scalar failure detail must remain visible for diagnostics while the canonical code stays compatible');
  assert.doesNotMatch(fastStatus, /SELECT[^`\n]*(?:payloadJson|summaryJson|valueJson)/,
    'V419 status SQL must not select heavy JSON state/checkpoint columns');
  assert.doesNotMatch(fastStatus, /scan_results|business_scan_results|business_track_events|track_events/,
    'normal web status owner must never reconstruct scan or trajectory facts');

  assert.match(fastProof, /readV418BusinessSuccessCoverage/);
  assert.match(fastProof, /JOIN business_final_rows f[\s\S]*f\.shipmentCode=d\.shipmentCode[\s\S]*UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/,
    'WHPP completion proof must be an indexed current-member set join over SUCCESS rows');
  assert.match(fastProof, /JOIN business_final_rows f[\s\S]*f\.shipmentCode=u\.shipmentCode[\s\S]*UPPER\(COALESCE\(f\.apiStatus,''\)\)='SUCCESS'/,
    'SHOPEE completion proof must be an indexed current-snapshot set join over SUCCESS rows');
});

test('V408 home WHPP KPI reads canonical V132 summary and preserves normal-flow semantics', () => {
  const v64 = read('../public/v64-whpp-total-kpi-integration.js');
  assert.match(v64, /2026-09-04-v426-unified-import-truth-kpi-v3/);
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

test('V411 entry guard blocks complete and unconfirmed run/resume entries, and releases only fresh incomplete truth', async () => {
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

  const reportDate = { value: '2026-08-29' };
  const document = {
    readyState: 'loading',
    visibilityState: 'visible',
    body: {},
    getElementById(id) { return id === 'reportDate' ? reportDate : null; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === 'button') return [button];
      if (selector === 'button[data-v169-entry-lock="1"]') return button.dataset.v169EntryLock === '1' ? [button] : [];
      return [];
    },
    addEventListener() {}
  };

  let runCalls = 0;
  let resumeCalls = 0;
  const staleStages = [
    { key:'CCSL', state:'done', statusFresh:false },
    { key:'SHOPEE', state:'done', statusFresh:false },
    { key:'WHPP', state:'pending', statusFresh:false }
  ];
  const canonical = {
    lastTruth: { reportDate: '2026-08-29', complete: false, statusFresh: false, stages: staleStages, checkedAt: 0 },
    refresh: async function () {
      this.lastTruth = { ...this.lastTruth, checkedAt: Number(this.lastTruth?.checkedAt || 0) + 1 };
      return this.lastTruth;
    }
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
    setTimeout: callback => { if (typeof callback === 'function') callback(); return 1; },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {}
  };

  vm.runInNewContext(source, context, { filename: 'v169-seven-business-legacy-status-sync.js' });
  const api = window.__CE_QC_V169_LEGACY_STATUS_SYNC__;
  assert.ok(api, 'V169 API must install');
  assert.equal(api.apply(), false);
  assert.equal(button.hidden, true, '08-29 stale status must hide the legacy WHPP continue CTA');
  assert.equal(button.disabled, true);

  const staleResume = await window.resumeUnified();
  const staleStart = await window.runUnified();
  assert.equal(staleResume.code, 'SEVEN_BUSINESS_STATUS_UNCONFIRMED');
  assert.equal(staleStart.code, 'SEVEN_BUSINESS_STATUS_UNCONFIRMED');
  assert.equal(resumeCalls, 0);
  assert.equal(runCalls, 0);

  canonical.lastTruth = {
    reportDate: '2026-08-29', complete: true, statusFresh: true, checkedAt: 10,
    stages: [
      { key:'CCSL', state:'done', statusFresh:true },
      { key:'SHOPEE', state:'done', statusFresh:true },
      { key:'WHPP', state:'done', statusFresh:true }
    ]
  };
  assert.equal(api.apply(), true);
  const completed = await window.resumeUnified();
  assert.equal(completed.code, 'SEVEN_BUSINESS_ALREADY_COMPLETE');
  assert.equal(resumeCalls, 0);

  canonical.lastTruth = {
    reportDate: '2026-08-30', complete: false, statusFresh: true, checkedAt: 20,
    stages: [
      { key:'CCSL', state:'done', statusFresh:true },
      { key:'SHOPEE', state:'done', statusFresh:true },
      { key:'WHPP', state:'pending', statusFresh:true }
    ]
  };
  reportDate.value = '2026-08-30';
  assert.equal(api.apply(), false);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  const nextResume = await window.resumeUnified();
  assert.equal(nextResume.original, true);
  assert.equal(resumeCalls, 1);

  canonical.lastTruth = {
    reportDate: '2026-08-29', complete: true, statusFresh: true, checkedAt: 30,
    stages: [
      { key:'CCSL', state:'done', statusFresh:true },
      { key:'SHOPEE', state:'done', statusFresh:true },
      { key:'WHPP', state:'done', statusFresh:true }
    ]
  };
  reportDate.value = '2026-08-30';
  assert.equal(api.apply(), false, 'a previous-date completed truth is unconfirmed for the new target and must stay locked');
  const mismatched = await window.runUnified();
  assert.equal(mismatched.code, 'SEVEN_BUSINESS_STATUS_UNCONFIRMED');
  assert.equal(runCalls, 0);

  canonical.lastTruth = {
    reportDate: '2026-08-30', complete: false, statusFresh: true, checkedAt: 40,
    stages: [
      { key:'CCSL', state:'done', statusFresh:true },
      { key:'SHOPEE', state:'done', statusFresh:true },
      { key:'WHPP', state:'pending', statusFresh:true }
    ]
  };
  api.apply();
  await window.runUnified();
  assert.equal(runCalls, 1, 'fresh current-date incomplete truth is the only state that may enter V67');
});