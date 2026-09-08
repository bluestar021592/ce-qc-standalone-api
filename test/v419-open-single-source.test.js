import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const V426_DATE='2026-09-04';

function loadV159() {
  const source = read('../public/v159-current-import-stability.js');
  const document = { readyState:'complete', body:{}, getElementById(){return null;}, querySelector(){return null;}, querySelectorAll(){return [];}, addEventListener(){} };
  class MutationObserver { observe(){} disconnect(){} }
  const window = { addEventListener(){} };
  vm.runInNewContext(source, {
    window, document, location:{pathname:'/'}, MutationObserver,
    queueMicrotask(){}, setTimeout(){return 1;}, clearTimeout(){},
    console:{info(){},warn(){},error(){}}, Number, String, Math, Date, Promise, Object, Array, Boolean, Map
  }, { filename:'v159-current-import-stability.js' });
  return { api: window.__CE_QC_V159_CURRENT_IMPORT_STABILITY__, source };
}

function executeV51WithV64Owner() {
  const source=read('../public/v51-runtime-fix.js');
  const fetchCalls=[];
  const documentListeners=new Map();
  const windowListeners=new Map();
  const homePage={hidden:false,classList:{contains(){return true;}}};
  const document={
    readyState:'complete',hidden:false,
    getElementById(id){return id==='homePage'?homePage:null;},
    querySelector(){return null;},querySelectorAll(){return [];},
    addEventListener(type,handler){documentListeners.set(type,handler);}
  };
  const context={
    document,location:{pathname:'/',origin:'http://127.0.0.1'},
    __CE_QC_HOME_CLASSIFICATION_OWNER__:'V64',
    fetch:async input=>{fetchCalls.push(String(input||''));return {ok:true,async json(){return {ok:true,total:0};},clone(){return this;}};},
    setTimeout(handler){if(typeof handler==='function')handler();return 1;},clearTimeout(){},
    addEventListener(type,handler){windowListeners.set(type,handler);},
    console:{info(){},warn(){},error(){}},String,Number,Boolean,Math,Date,Promise,Object,Array,Map,Set,URL
  };
  context.window=context;context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'v51-runtime-fix.js'});
  documentListeners.get('ce-qc-run-complete')?.();
  document.hidden=false;
  documentListeners.get('visibilitychange')?.();
  windowListeners.get('popstate')?.();
  return {context,fetchCalls};
}

function executeV160PostRenderHandoff() {
  const source=read('../public/v160-current-home-truth.js');
  let baseRenderCount=0;
  let v64ClassificationRefreshCount=0;
  let v64MetricsRefreshCount=0;
  const unifiedImportState={
    reportDate:V426_DATE,snapshotId:'SNAP-V426-HANDOFF',
    classificationCounts:{CE:2500,CEAF:300,TBKH:700,ALI1688:560,SHOPEECN:500,SHOPEEVN:500,WHPP:228}
  };
  const appState={
    reportDate:V426_DATE,snapshotId:'SNAP-V426-HANDOFF',sourceTotal:4060,pnhBills:[],
    dailyParseSummary:{totalRecognized:4060},v55Summary:{pod:0},dashboard:{pnh:4060,totalMonitored:4060,todayPod:0}
  };
  const shopeeState={
    reportDate:V426_DATE,snapshotId:'SNAP-V426-HANDOFF',sourceTotal:1000,pnhBills:[],
    dailyParseSummary:{totalRecognized:1000},v55Summary:{pod:0},dashboard:{metrics:{total:1000}}
  };
  const document={readyState:'complete',addEventListener(){}};
  const context={
    document,unifiedImportState,appState,shopeeState,
    __CE_QC_HOME_CLASSIFICATION_OWNER__:'V64',
    __CE_QC_V64_WHPP_TOTAL_KPI__:{
      refreshClassification(){v64ClassificationRefreshCount+=1;},
      refresh(){v64MetricsRefreshCount+=1;}
    },
    renderAll(){baseRenderCount+=1;return 'BASE_RENDER_RESULT';},
    async refresh(){return {ok:true};},
    queueMicrotask(handler){if(typeof handler==='function')handler();},
    setTimeout(handler){if(typeof handler==='function')handler();return 1;},
    console:{info(){},warn(){},error(){}},String,Number,Boolean,Math,Date,Promise,Object,Array,Map,Set
  };
  context.window=context;context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'v160-current-home-truth.js'});
  const first=context.renderAll();
  const second=context.renderAll();
  return {context,baseRenderCount,v64ClassificationRefreshCount,v64MetricsRefreshCount,first,second};
}

test('V419 OPEN display uses backend values only', () => {
  const { api, source } = loadV159();
  assert.ok(api);
  assert.match(api.version, /v419-current-import-stability-v5-backend-open-single-source/);
  const display = api.reconciledCarryDisplay({todayOpen:100,historicalOpen:20,currentOpen:120,conservativeCurrentOpen:999,historicalReconciledOpen:888});
  assert.deepEqual({today:display.today,historical:display.historical,current:display.current},{today:100,historical:20,current:120});
  assert.equal(display.source,'V419_BACKEND_OPEN_SINGLE_SOURCE');
  const fallback=api.reconciledCarryDisplay({todayOpen:100,historicalOpen:20});
  assert.equal(fallback.current,120);
  assert.equal(fallback.source,'V419_BACKEND_OPEN_SUM_FALLBACK');
  assert.doesNotMatch(source,/Math\.max\(num\(carry\.todayOpen\),num\(carry\.conservativeCurrentOpen\)\)/);
  assert.doesNotMatch(source,/Math\.max\(num\(carry\.historicalOpen\),num\(carry\.historicalReconciledOpen\)\)/);
});

test('V419 heavy history audit is manual-only and cannot overwrite primary OPEN', () => {
  const audit=read('../public/v142-history-integrity-audit.js');
  const loader=read('../src/v44WhppUiPatch.js');
  assert.match(audit,/v419-manual-only-history-audit-no-open-mutation-v4/);
  assert.match(audit,/2026-09-07-v451-snapshot-indexed-history-audit-ui-v1/);
  assert.match(audit,/2026-09-08-v457-whpp-legacy-completion-attestation-ui-v1/);
  assert.match(audit,/2026-09-08-v460-whpp-history-snapshot-disambiguation-ui-v1/);
  assert.match(audit,/2026-09-08-v470-whpp-current-vs-retained-retry-display-v1/);
  assert.match(audit,/automatic:false/);
  assert.match(audit,/不会自动触发本检查/);
  assert.match(audit,/manual audit uses snapshot-indexed readonly reads/);
  assert.match(audit,/V470 distinguishes current interface retries from V464 retained historical retry markers without mutating facts/);
  assert.match(audit,/当前接口待重试/);
  assert.match(audit,/历史retry标记保留/);
  assert.match(audit,/历史审计不会回写或覆盖主页面OPEN数字/);
  assert.match(audit,/立即重新检查/);
  assert.doesNotMatch(audit,/combined-processing-queue-count/);
  assert.doesNotMatch(audit,/function syncOpenSummary\(/);
  assert.doesNotMatch(audit,/requestIdleCallback/);
  assert.doesNotMatch(audit,/ce-qc-run-complete[^\n]*load/);
  const timeoutPrelude='v471-history-audit-abort-normalizer.js?v=20260908-v471-1';
  const historyAudit='v142-history-integrity-audit.js?v=20260908-v470-1';
  assert.ok(loader.includes(timeoutPrelude),'V471 timeout normalizer must be delivered');
  assert.ok(loader.includes(historyAudit),'V470 history audit must be delivered');
  assert.ok(loader.indexOf(timeoutPrelude)<loader.indexOf(historyAudit),'V471 timeout normalizer must load before V470 history audit');
  assert.doesNotMatch(loader,/v142-history-integrity-audit\.js\?v=20260908-v460-1/);
  assert.doesNotMatch(loader,/v142-history-integrity-audit\.js\?v=20260908-v457-1/);
  assert.doesNotMatch(loader,/v142-history-integrity-audit\.js\?v=20260902-v419-priority-1/);
});

test('V419 recovery-safe startup skips synchronous POD-lock repair but explicit maintenance remains available', () => {
  const bootstrap=read('../bootstrap.js');
  const repair=read('../src/v167CcslPodLockFactRepair.js');
  assert.match(bootstrap,/process\.env\.CE_QC_RECOVERY_SAFE_MODE = '1'/);
  assert.match(repair,/v419-ccsl-pod-lock-safe-mode-startup-guard-v3/);
  assert.match(repair,/!database && \(/);
  assert.match(repair,/CE_QC_RECOVERY_SAFE_MODE/);
  assert.match(repair,/INTERACTIVE_FIRST_STARTUP_SKIP/);
  assert.match(repair,/const db = database \|\| getDb\(\)/);
});

test('V426 parser/store conserve all seven businesses including WHPP', () => {
  const parser=read('../src/unifiedExcelParser.js');
  const store=read('../src/unifiedImportStore.js');
  const seven=/\['CE',\s*'CEAF',\s*'TBKH',\s*'ALI1688',\s*'SHOPEECN',\s*'SHOPEEVN',\s*'WHPP'\]/;
  assert.match(parser,seven);
  assert.match(store,seven);
  assert.match(parser,/validUniqueWaybills:\s*details\.length/);
  assert.match(parser,/classifiedWaybills\s*===\s*details\.length/);
  assert.match(store,/function buildSourceReconciliation\(/);
  assert.match(store,/balanced:\s*classifiedWaybills\s*===\s*validUnique/);
  assert.match(store,/assertSourceReconciliation\(parsed\)/);
  assert.match(store,/SELECT businessType, COUNT\(\*\) count FROM unified_import_rows WHERE batchId=\? GROUP BY businessType/);
});

test('V426 V51 HOME legacy writer is runtime-disabled by the shell V64 owner contract', () => {
  const {context,fetchCalls}=executeV51WithV64Owner();
  assert.equal(context.__CE_QC_HOME_CLASSIFICATION_OWNER__,'V64');
  assert.equal(fetchCalls.filter(url=>url.includes('/api/v71/whpp-summary')).length,0,'V51 startup/run-complete/visibility/popstate hooks must not fetch legacy HOME WHPP truth when V64 owns classification');
});

test('V426 V160 post-render handoff uses synchronous V64 classification only and never enters metrics refresh', () => {
  const result=executeV160PostRenderHandoff();
  assert.equal(result.context.__CE_QC_V160_CURRENT_HOME_TRUTH__?.homeRenderHandoff,'2026-09-04-v426-v160-post-render-v64-classification-handoff-v2');
  assert.equal(result.first,'BASE_RENDER_RESULT');
  assert.equal(result.second,'BASE_RENDER_RESULT');
  assert.equal(result.baseRenderCount,2,'V160 must preserve exactly one V105/base render per renderAll call');
  assert.equal(result.v64ClassificationRefreshCount,2,'V160 must synchronously re-assert V64 classification after every completed base render');
  assert.equal(result.v64MetricsRefreshCount,0,'V160 post-render handoff must never depend on the asynchronous WHPP metrics refresh lock');
});

test('V426 loader delivers import-truth owners, retires V51 HOME writes, and restores authority after final renderAll', () => {
  const loader=read('../src/v44WhppUiPatch.js');
  const legacyRuntime=read('../public/v51-runtime-fix.js');
  const homeSync=read('../public/v64-whpp-total-kpi-integration.js');
  const finalHomeRender=read('../public/v160-current-home-truth.js');
  const totalSync=read('../public/v68-whpp-classification-stability.js');
  const canonicalSync=read('../public/v94-business-source-truth-ui-v2.js');
  assert.match(loader,/v159-current-import-stability\.js\?v=20260902-v419-open-single-source-1/);
  assert.doesNotMatch(loader,/v159-current-import-stability\.js\?v=20260902-v414-explicit-1/);
  assert.match(loader,/window\.__CE_QC_HOME_CLASSIFICATION_OWNER__=\\'V64\\'/);
  const ownerMarker=loader.indexOf("window.__CE_QC_HOME_CLASSIFICATION_OWNER__=\\'V64\\'");
  const v51Load=loader.indexOf('v51-runtime-fix.js?v=20260904-v426-2');
  const v105Load=loader.indexOf('v105-fast-render.js?v=20260814-2');
  const v160Load=loader.indexOf('v160-current-home-truth.js?v=20260904-v426-2');
  assert.ok(ownerMarker>=0&&v51Load>ownerMarker,'shell must declare V64 HOME owner before legacy V51 loads');
  assert.ok(v105Load>=0&&v160Load>v105Load,'V105 must install the base renderAll before V160 becomes the final wrapper');
  assert.match(loader,/v51-runtime-fix\.js\?v=20260904-v426-2/);
  assert.doesNotMatch(loader,/v51-runtime-fix\.js\?v=20260904-v426-1/);
  assert.doesNotMatch(loader,/v51-runtime-fix\.js\?v=20260812-3/);
  assert.match(loader,/v64-whpp-total-kpi-integration\.js\?v=20260904-v426-3/);
  assert.doesNotMatch(loader,/v64-whpp-total-kpi-integration\.js\?v=20260904-v426-[12]/);
  assert.match(loader,/v160-current-home-truth\.js\?v=20260904-v426-2/);
  assert.doesNotMatch(loader,/v160-current-home-truth\.js\?v=20260904-v426-1/);
  assert.doesNotMatch(loader,/v160-current-home-truth\.js\?v=20260816-1/);
  assert.match(loader,/v68-whpp-classification-stability\.js\?v=20260904-v426-1/);
  assert.match(loader,/v94-business-source-truth-ui-v2\.js\?v=20260904-v426-1/);
  assert.equal(5060+228,5288);
  assert.match(legacyRuntime,/v426-v51-shell-owner-contract-v2/);
  assert.match(legacyRuntime,/function v64OwnsHomeClassification\(/);
  assert.match(legacyRuntime,/__CE_QC_HOME_CLASSIFICATION_OWNER__/);
  assert.doesNotMatch(legacyRuntime,/v426-unified-import-truth-kpi-v[23]/,'V51 ownership handoff must not depend on one V64 version string');
  assert.equal((legacyRuntime.match(/if\(v64OwnsHomeClassification\(\)\)return;/g)||[]).length,2,'V51 must guard both HOME patching and HOME WHPP refresh when V64 owns truth');
  assert.match(homeSync,/v426-unified-import-truth-kpi-v3/);
  assert.match(homeSync,/function authoritativeHomeSummary\(/);
  assert.match(homeSync,/function refreshClassification\(/);
  const classificationRefresh=homeSync.indexOf('refreshClassification();');
  const metricsFetch=homeSync.indexOf('const summary = await readWhppSummary(reportDate);');
  assert.ok(classificationRefresh>=0&&metricsFetch>classificationRefresh,'synchronous classification must run before asynchronous WHPP metrics fetch');
  assert.match(homeSync,/refreshClassification,\s*importStats/);
  assert.match(finalHomeRender,/2026-08-16-v160-current-home-truth-v1/);
  assert.match(finalHomeRender,/v426-v160-post-render-v64-classification-handoff-v2/);
  assert.match(finalHomeRender,/function handoffHomeClassification\(/);
  assert.match(finalHomeRender,/__CE_QC_HOME_CLASSIFICATION_OWNER__/);
  assert.match(finalHomeRender,/refreshClassification=global\.__CE_QC_V64_WHPP_TOTAL_KPI__\?\.refreshClassification/);
  assert.doesNotMatch(finalHomeRender,/const refresh=global\.__CE_QC_V64_WHPP_TOTAL_KPI__\?\.refresh/);
  assert.match(totalSync,/v426-unified-import-seven-business-truth-priority-v1/);
  assert.match(totalSync,/AUTHORITATIVE_UNIFIED_IMPORT_TRUTH/);
  assert.match(totalSync,/V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH/);
  assert.match(totalSync,/fullUnique:\s*core\s*\+\s*whppTotal/);
  assert.match(totalSync,/validUniqueWaybills:\s*core\s*\+\s*total/);
  assert.match(canonicalSync,/v426-unified-import-truth-priority-v1/);
  assert.match(canonicalSync,/AUTHORITATIVE_UNIFIED_IMPORT_TRUTH/);
  assert.match(canonicalSync,/V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH/);
});