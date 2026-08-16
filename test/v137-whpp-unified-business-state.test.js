import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{
  const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  assert.equal(result.status,0,`${file}: ${result.stderr||result.stdout}`);
};

test('V137 WHPP adapter is syntax-valid and exposes the common business-state route',()=>{
  syntax('src/v137WhppUnifiedBusinessStatePatch.js');
  syntax('public/v137-whpp-unified-snapshot-view.js');
  const patch=read('src/v137WhppUnifiedBusinessStatePatch.js');
  assert.match(patch,/\/api\/business-state\/:businessType/);
  assert.match(patch,/\/api\/v132\/whpp-fast-summary/);
  assert.match(patch,/sourceTruth:'NORMALIZED_SQLITE'/);
  assert.match(patch,/business_daily_reports/);
  assert.match(patch,/business_final_rows/);
  assert.match(patch,/business_history_summary/);
  assert.match(patch,/business_export_snapshots/);
  assert.match(patch,/Cache-Control','no-store/);
  assert.doesNotMatch(patch,/const cache=new Map/);
});

test('V137 keeps WHPP business rules but removes independent dashboard-source wording',()=>{
  const ui=read('public/v137-whpp-unified-snapshot-view.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(ui,/数据来自当前业务有效快照/);
  assert.match(ui,/当前业务快照处理中/);
  assert.match(injector,/v137WhppUnifiedBusinessStatePatch\.js/);
  assert.match(injector,/v137-whpp-unified-snapshot-view\.js\?v=20260815-2/);
  assert.ok(injector.indexOf('v132-whpp-seven-business-fast.js')<injector.indexOf('v137-whpp-unified-snapshot-view.js'));
});

test('V137 heading reconciliation is idempotent and cannot self-trigger an endless body observer loop',()=>{
  const ui=read('public/v137-whpp-unified-snapshot-view.js');
  assert.match(ui,/v137-whpp-unified-snapshot-view-v2/);
  assert.match(ui,/if\(node\.textContent!==target\)node\.textContent=target/);
  assert.match(ui,/pageObserver\.observe\(page,\{subtree:true,childList:true,characterData:true\}\)/);
  assert.match(ui,/bootstrapObserver\.observe\(document\.body,\{subtree:true,childList:true\}\)/);
  assert.doesNotMatch(ui,/observer\.observe\(document\.body,\{subtree:true,childList:true,characterData:true\}\)/);
  assert.ok(ui.indexOf('const headingDate=')<ui.indexOf("document.getElementById('reportDate')"));
});

test('V140 scan batches remain bounded and unresolved API rows get final retries after checkpoint recovery',()=>{
  syntax('src/v70ConfirmQueryResiliencePatch.js');
  syntax('src/v140ShopeeCheckpointRecoveryPatch.js');
  const patch=read('src/v70ConfirmQueryResiliencePatch.js');
  assert.match(patch,/v140-confirm-track-final-retry-v2/);
  assert.match(patch,/Math\.min\(100, Number\(process\.env\.CONFIRM_QUERY_BATCH_SIZE/);
  assert.match(patch,/CONFIRM_BATCH_BUDGET_MS/);
  assert.match(patch,/45_000/);
  assert.match(patch,/process\.env\.ORDER_BATCH_SIZE = String/);
  assert.match(patch,/remainingMs\(deadline\)/);
  assert.match(patch,/confirm-query batch budget exhausted/);
  assert.match(patch,/FINAL_RETRY_ROUNDS = Math\.max\(3/);
  assert.match(patch,/v138StartupRunRecoveryPatch\.js/);
  assert.match(patch,/v140ShopeeCheckpointRecoveryPatch\.js/);
  assert.match(patch,/v139DailyCarryIsolationPatch\.js/);
  assert.ok(patch.indexOf('v140ShopeeCheckpointRecoveryPatch.js')<patch.indexOf('v139DailyCarryIsolationPatch.js'));
});

test('V149 progress remains bounded by target pool without rehydrating full API evidence tables',()=>{
  syntax('src/v33RunProgressPatch.js');
  syntax('public/v138-ccsl-scan-progress.js');
  const backend=read('src/v33RunProgressPatch.js');
  const ui=read('public/v138-ccsl-scan-progress.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(backend,/v149-tiny-run-progress-compat-v2/);
  assert.match(backend,/v155-runtime-scan-pool-fallback-v2/);
  assert.match(backend,/v156-run-membership-repair-v1/);
  assert.match(backend,/function boundedCounts/);
  assert.match(backend,/Math\.min\(total, rawDone\)/);
  assert.match(backend,/Math\.min\(Math\.max\(0, total - done\), rawRetry\)/);
  assert.match(backend,/V149_RUN_LOCK_PLUS_TINY_CHECKPOINT_BOUNDED/);
  assert.match(backend,/FROM run_locks/);
  assert.match(backend,/FROM run_checkpoints/);
  assert.match(backend,/FROM business_run_locks/);
  assert.match(backend,/FROM business_run_checkpoints/);
  assert.match(backend,/payload\.lastRunSummary\?\.scanPool/);
  assert.match(backend,/payload\.lastRunSummary\?\.needTrack/);
  assert.match(backend,/FROM unified_import_batches/);
  assert.match(backend,/FROM unified_import_rows/);
  assert.match(backend,/businessType IN \('CE','CEAF','TBKH','ALI1688'\)/);
  assert.match(backend,/businessType IN \('SHOPEECN','SHOPEEVN'\)/);
  assert.match(backend,/V156_LATEST_VALID_UNIFIED_MEMBERSHIP_REPAIR/);
  assert.match(backend,/CCSL_RUN_ROUTES/);
  assert.match(backend,/podLockSkipped/);
  assert.doesNotMatch(backend,/business_api_batches/);
  assert.doesNotMatch(backend,/business_track_events/);
  assert.doesNotMatch(backend,/business_exception_items/);
  assert.doesNotMatch(backend,/loadState\s*\(/);
  assert.doesNotMatch(backend,/loadBusinessState\s*\(/);
  assert.match(ui,/v156-ccsl-final-progress-truth-v1/);
  assert.match(ui,/历史POD锁直接闭环/);
  assert.match(ui,/if\(live\?\.runId&&sameDate\)return markup\(live\)/);
  assert.match(ui,/待重试/);
  assert.match(ui,/单批最大/);
  assert.match(ui,/batchMax:100/);
  assert.match(ui,/__CE_QC_V96_V67_LIVE_PROGRESS_BRIDGE__=true/);
  assert.match(injector,/v156-ccsl-final-progress-truth-v1/);
  assert.match(injector,/v138-ccsl-scan-progress\.js\?v=20260816-3/);
  assert.ok(injector.indexOf('v138-ccsl-scan-progress.js')<injector.indexOf('v139-carry-manual-window.js'));
  assert.ok(injector.indexOf('v139-carry-manual-window.js')<injector.indexOf('v140-current-business-truth.js'));
  assert.ok(injector.indexOf('v140-current-business-truth.js')<injector.indexOf('v108-route-lazy-features.js'));
});

test('V155 unified import persists the CCSL membership summary used by current-day processing and progress',()=>{
  syntax('src/v42WhppPatch.js');
  const patch=read('src/v42WhppPatch.js');
  assert.match(patch,/v155-fresh-import-summary-authority-v1/);
  assert.match(patch,/dailyParseSummary:\s*\{/);
  assert.match(patch,/totalRecognized:\s*today\.length/);
  assert.match(patch,/pnh:\s*today\.length/);
  assert.match(patch,/pnhCount:\s*today\.length/);
  assert.match(patch,/businessCounts/);
  assert.match(patch,/V155_UNIFIED_VALID_MEMBERSHIP/);
});

test('V138 converts only orphaned running locks to paused on a fresh backend process',()=>{
  syntax('src/v138StartupRunRecoveryPatch.js');
  const recovery=read('src/v138StartupRunRecoveryPatch.js');
  assert.match(recovery,/WHERE status='running'/);
  assert.match(recovery,/SET status='paused'/);
  assert.match(recovery,/batchIndex\/totalBatches\/checkpoints/);
  assert.match(recovery,/UPDATE run_locks/);
  assert.match(recovery,/UPDATE business_run_locks/);
  assert.doesNotMatch(recovery,/DELETE FROM/);
  assert.doesNotMatch(recovery,/UPDATE (?:final_rows|business_final_rows|unified_import_rows)/);
});