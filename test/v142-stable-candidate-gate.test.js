import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);};

test('V150 candidate critical runtime files are syntax valid',()=>{
  for(const file of [
    'bootstrap.js','server.js','src/v44WhppUiPatch.js','src/v137TrendTruthPatch.js',
    'src/v142UnifiedSnapshotRepairPatch.js','src/v143HomeTruthPatch.js','src/v146ProcessingReadinessPatch.js','src/unifiedImportStore.js',
    'public/v67-resilient-run-guard.js','public/v137-range-trends.js','public/v139-normal-web-runtime.js',
    'public/v64-whpp-total-kpi-integration.js','public/v150-import-fast-path.js'
  ])syntax(file);
});

test('V150 UI loads import fast path last and cache busts event-driven home truth',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/2026-08-15-v150-import-first-stability-v38/);
  assert.match(injector,/v67-resilient-run-guard\.js\?v=20260815-9/);
  assert.match(injector,/v137-range-trends\.js\?v=20260815-6/);
  assert.match(injector,/v64-whpp-total-kpi-integration\.js\?v=20260815-10/);
  assert.match(injector,/v150-import-fast-path\.js\?v=20260815-2/);
  assert.ok(injector.indexOf('v64-whpp-total-kpi-integration.js?v=20260815-10')<injector.indexOf('v150-import-fast-path.js?v=20260815-2'));
  assert.doesNotMatch(injector,/<script src="\/v56-trend-truth\.js/);
});

test('V150 import fast path saves first then defers history/dashboard work',()=>{
  const ui=read('public/v150-import-fast-path.js');
  assert.match(ui,/v150-import-fast-path-v2/);
  assert.match(ui,/api\/import\/unified-daily-report/);
  assert.match(ui,/global\.importUnifiedExcel=importUnifiedExcelFast/);
  assert.match(ui,/已保存，可以继续上传下一份/);
  assert.match(ui,/refreshCatalogLater/);
  assert.match(ui,/setTimeout\(async\(\)=>/);
  assert.match(ui,/80\*1024\*1024/);
  assert.doesNotMatch(ui,/api\/state\?compact=1/);
  assert.doesNotMatch(ui,/api\/shopee\/state\?compact=1/);
});

test('V150 homepage truth is event-driven and never background polls SQL every five seconds',()=>{
  const ui=read('public/v64-whpp-total-kpi-integration.js');
  assert.match(ui,/v150-event-driven-home-truth-v4/);
  assert.match(ui,/EVENT_DRIVEN_NO_BACKGROUND_POLL/);
  assert.doesNotMatch(ui,/setInterval/);
  assert.doesNotMatch(ui,/MutationObserver/);
  assert.match(ui,/ce-qc-unified-import-saved/);
});

test('V150 runner binds to latest unified date and exposes processing evidence',()=>{
  const runner=read('public/v67-resilient-run-guard.js');
  assert.match(runner,/api\/import\/unified-latest\?compact=1/);
  assert.match(runner,/const unifiedDate=isoDate\(states\.UNIFIED\?\.import\?\.reportDate\)/);
  assert.match(runner,/api\/v146\/processing-readiness/);
  assert.match(runner,/apiScanCount/);
  assert.match(runner,/podLockCount/);
  assert.match(runner,/scanCoveredCount/);
  assert.match(runner,/POD锁复用/);
});

test('processing readiness distinguishes real API scan coverage from POD-lock reuse',()=>{
  const backend=read('src/v146ProcessingReadinessPatch.js');
  assert.match(backend,/business_scan_results/);
  assert.match(backend,/business_pod_locks/);
  assert.match(backend,/business_final_rows/);
  assert.match(backend,/apiScanCount/);
  assert.match(backend,/scanCoveredCount/);
  assert.match(backend,/SHOPEE_PROCESSING_EVIDENCE_INCOMPLETE/);
});

test('homepage latest VALID import keeps core isolated from Shopee',()=>{
  const backend=read('src/v143HomeTruthPatch.js');
  const ui=read('public/v64-whpp-total-kpi-integration.js');
  assert.match(backend,/v149-live-import-cross-day-attempt-v4/);
  assert.match(backend,/WHERE b\.status='VALID' AND b\.reportDate=\?/);
  assert.match(backend,/CORE_TYPES=new Set\(\['CE','CEAF','TBKH','ALI1688','WHPP'\]\)/);
  assert.match(ui,/核心指标总览/);
  assert.match(ui,/不含 SHOPEE CN\/VN/);
  assert.match(ui,/EVENT_DRIVEN_DATABASE_TRUTH/);
});

test('Shopee attempt recovery searches later real POD and dispatch evidence',()=>{
  const backend=read('src/v143HomeTruthPatch.js');
  const trend=read('src/v137TrendTruthPatch.js');
  for(const source of [backend,trend]){
    assert.match(source,/business_track_events/);
    assert.match(source,/business_scan_results/);
    assert.match(source,/podAttemptNo/);
    assert.match(source,/findPodDateInObject/);
    assert.match(source,/deliveryCompletedAt/);
    assert.match(source,/signTime/);
  }
  assert.match(backend,/pod_candidates AS/);
  assert.match(backend,/COALESCE\(s\.rawJson,''\) NOT LIKE '%POD_LOCK%'/);
  assert.match(trend,/pod_candidates AS/);
  assert.match(trend,/s\.reportDate>=v\.reportDate/);
  assert.match(trend,/PERSISTED_ATTEMPT_THEN_CROSS_DAY_DISPATCH_EVENTS_THEN_POD_TIMESTAMP_THEN_FIRST_REAL_POD_OBSERVED_DATE/);
});

test('zero-row family can complete without phantom child snapshot',()=>{
  const repair=read('src/v142UnifiedSnapshotRepairPatch.js');
  assert.match(repair,/v144-zero-family-auto-finalize-v4/);
  assert.match(repair,/const ccslRequired=expectedFamilies\.ccsl>0/);
  assert.match(repair,/const shopeeRequired=expectedFamilies\.shopee>0/);
});

test('unified snapshot completion still blocks failed reconciliation',()=>{
  const store=read('src/unifiedImportStore.js');
  assert.match(store,/INVALID_FAILED_RECONCILIATION/);
  assert.match(store,/UNIFIED_RECONCILIATION_FAILED/);
  assert.match(store,/validationPassed/);
  assert.match(store,/status='COMPLETED'/);
});

test('database schema is not bumped by V150 UI/runtime repairs',()=>{
  const migrations=read('src/migrations.js');
  assert.match(migrations,/const SCHEMA_VERSION = 18/);
});
