import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);};

test('V148 candidate critical runtime files are syntax valid',()=>{
  for(const file of [
    'bootstrap.js','server.js','src/v44WhppUiPatch.js','src/v137TrendTruthPatch.js',
    'src/v142UnifiedSnapshotRepairPatch.js','src/v143HomeTruthPatch.js','src/v146ProcessingReadinessPatch.js','src/unifiedImportStore.js',
    'public/v67-resilient-run-guard.js','public/v137-range-trends.js','public/v139-normal-web-runtime.js','public/v64-whpp-total-kpi-integration.js'
  ])syntax(file);
});

test('V148 UI cache bust loads unified processing evidence runner',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/2026-08-15-v148-unified-processing-evidence-v36/);
  assert.match(injector,/v67-resilient-run-guard\.js\?v=20260815-9/);
  assert.match(injector,/v137-range-trends\.js\?v=20260815-6/);
  assert.match(injector,/v64-whpp-total-kpi-integration\.js\?v=20260815-8/);
  assert.ok(injector.indexOf('v139-normal-web-runtime.js?v=20260815-5')<injector.indexOf('v64-whpp-total-kpi-integration.js?v=20260815-8'));
  assert.doesNotMatch(injector,/<script src="\/v56-trend-truth\.js/);
});

test('V148 runner binds to unified date and reapplies canonical evidence after legacy CCSL render',()=>{
  const runner=read('public/v67-resilient-run-guard.js');
  assert.match(runner,/api\/import\/unified-latest\?compact=1/);
  assert.match(runner,/const unifiedDate=isoDate\(states\.UNIFIED\?\.import\?\.reportDate\)/);
  assert.match(runner,/states\.CURRENT_REPORT_DATE=reportDate/);
  assert.match(runner,/api\/v146\/processing-readiness/);
  assert.match(runner,/apiScanCount/);
  assert.match(runner,/podLockCount/);
  assert.match(runner,/scanCoveredCount/);
  assert.match(runner,/POD锁复用/);
  assert.match(runner,/await global\.refresh\(\)/);
  assert.ok(runner.indexOf("await global.refresh()")<runner.indexOf('renderEvidenceStatus(currentReportDate'));
  assert.match(runner,/LATEST_UNIFIED_REPORT_DATE_PLUS_API_OR_POD_LOCK_EVIDENCE/);
});

test('V148 distinguishes real API scan coverage from terminal POD-lock reuse',()=>{
  const backend=read('src/v146ProcessingReadinessPatch.js');
  const bootstrap=read('bootstrap.js');
  assert.match(bootstrap,/v146ProcessingReadinessPatch/);
  assert.match(backend,/business_scan_results/);
  assert.match(backend,/business_pod_locks/);
  assert.match(backend,/business_final_rows/);
  assert.match(backend,/business_run_locks/);
  assert.match(backend,/business_export_snapshots/);
  assert.match(backend,/apiScanCount/);
  assert.match(backend,/podLockScanCount/);
  assert.match(backend,/podLockTimedCount/);
  assert.match(backend,/scanCoveredCount/);
  assert.match(backend,/const scanComplete=sourceCount===0\|\|evidence\.scanCoveredCount>=sourceCount/);
  assert.match(backend,/API_SCAN_OR_TERMINAL_POD_LOCK_THEN_FINAL_ROW/);
  assert.match(backend,/falseCompleted/);
  assert.match(backend,/SHOPEE_PROCESSING_EVIDENCE_INCOMPLETE/);
  assert.match(backend,/UPDATE business_export_snapshots/);
  assert.match(backend,/UPDATE business_run_locks/);
  assert.match(backend,/UPDATE unified_snapshots SET status='IMPORTED'/);
});

test('V145 home core excludes Shopee and Shopee special metrics come from canonical final rows',()=>{
  const backend=read('src/v143HomeTruthPatch.js');
  const ui=read('public/v64-whpp-total-kpi-integration.js');
  assert.match(backend,/CORE_TYPES=new Set\(\['CE','CEAF','TBKH','ALI1688','WHPP'\]\)/);
  assert.match(backend,/SHOPEE_TYPES=new Set\(\['SHOPEECN','SHOPEEVN'\]\)/);
  assert.match(backend,/special:shopeeSpecialSummary\(rows\)/);
  assert.match(backend,/pendingNonContinuous/);
  assert.match(backend,/returned/);
  assert.match(ui,/patchSpecial\(data\)/);
  assert.match(ui,/CANONICAL_SHOPEE_FINAL_ROWS/);
  assert.match(ui,/CANONICAL_CORE_FIVE_BUSINESSES/);
  assert.doesNotMatch(ui,/baseValue\(/);
  assert.doesNotMatch(ui,/\+ Number\(addValue/);
});

test('V145 Shopee attempt recovery reads persisted attempt fields track events shipment summary and scan raw POD time',()=>{
  const home=read('src/v143HomeTruthPatch.js');
  const trend=read('src/v137TrendTruthPatch.js');
  for(const source of [home,trend]){
    assert.match(source,/business_track_events/);
    assert.match(source,/business_scan_results/);
    assert.match(source,/business_shipment_tracks/);
    assert.match(source,/podAttemptNo/);
    assert.match(source,/findPodDateInObject/);
    assert.match(source,/deliveryCompletedAt/);
    assert.match(source,/signTime/);
  }
  assert.match(home,/group\.pod>0&&group\.known===0/);
  assert.match(home,/group\.values=\[null,null,null\]/);
  assert.match(trend,/PERSISTED_ATTEMPT_THEN_TRACK_EVENTS_THEN_SHIPMENT_SCAN_POD_TIME/);
});

test('V144 zero-row family is considered complete instead of waiting forever for a child snapshot',()=>{
  const repair=read('src/v142UnifiedSnapshotRepairPatch.js');
  assert.match(repair,/v144-zero-family-auto-finalize-v4/);
  assert.match(repair,/function expectedFamilyCounts/);
  assert.match(repair,/function emptyCompletedChild/);
  assert.match(repair,/const ccslRequired=expectedFamilies\.ccsl>0/);
  assert.match(repair,/const shopeeRequired=expectedFamilies\.shopee>0/);
  assert.match(repair,/if\(ccslRequired&&!realCcsl\)missing\.push\('CCSL'\)/);
  assert.match(repair,/if\(shopeeRequired&&!realShopee\)missing\.push\('SHOPEE'\)/);
  assert.match(repair,/zeroFamilies:\{CCSL:!ccslRequired,SHOPEE:!shopeeRequired\}/);
});

test('selected-day trend endpoint exposes lifecycle truth and automatic persisted repair',()=>{
  const backend=read('src/v137TrendTruthPatch.js');const repair=read('src/v142UnifiedSnapshotRepairPatch.js');
  assert.match(backend,/repairUnifiedSnapshotCompletion\(to\)/);assert.match(backend,/requestedDateLifecycle:lifecycle/);assert.match(backend,/business_track_events/);assert.match(backend,/trackAttemptCount/);
  assert.match(repair,/latestCcslSnapshot/);assert.match(repair,/latestShopeeSnapshot/);assert.match(repair,/VALID/);assert.match(repair,/COMPLETED/);assert.match(repair,/completeUnifiedSnapshot/);
});

test('front end distinguishes not imported processing reconciliation failure and generic version mismatch fallback',()=>{
  const ui=read('public/v137-range-trends.js');assert.match(ui,/requestedDateLifecycle/);assert.match(ui,/尚未导入日报/);assert.match(ui,/正在等待处理完成/);assert.match(ui,/一致性检查未通过/);assert.match(ui,/没有 VALID \+ COMPLETED 的有效日报快照/);
});

test('unified snapshot completion still blocks invalid reconciliation rather than fabricating a completed day',()=>{
  const store=read('src/unifiedImportStore.js');assert.match(store,/INVALID_FAILED_RECONCILIATION/);assert.match(store,/UNIFIED_RECONCILIATION_FAILED/);assert.match(store,/validationPassed/);assert.match(store,/status='COMPLETED'/);
});

test('database schema is not bumped by V143 through V148 repairs',()=>{
  const migrations=read('src/migrations.js');assert.match(migrations,/const SCHEMA_VERSION = 18/);
});
