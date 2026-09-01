const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
for(const file of ['src/v311ShopeeIncompleteRecoveryPatch.js','src/businessStore.js','src/v134WhppRunSupervisorPatch.js','public/v309-ui-integrity.js','public/v310-unified-resume-owner.js','public/v311-shopee-recovery-owner.js','public/v168-seven-business-status.js','public/v67-resilient-run-guard.js','public/v138-ccsl-scan-progress.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
execFileSync(process.execPath,['scripts/v378-whpp-completion-lock-smoke.mjs'],{stdio:'inherit'});
const backend=fs.readFileSync('src/v311ShopeeIncompleteRecoveryPatch.js','utf8');
const businessStore=fs.readFileSync('src/businessStore.js','utf8');
const v309=fs.readFileSync('public/v309-ui-integrity.js','utf8');
const v310=fs.readFileSync('public/v310-unified-resume-owner.js','utf8');
const ui=fs.readFileSync('public/v311-shopee-recovery-owner.js','utf8');
const seven=fs.readFileSync('public/v168-seven-business-status.js','utf8');
const runner=fs.readFileSync('public/v67-resilient-run-guard.js','utf8');
const ccslProgress=fs.readFileSync('public/v138-ccsl-scan-progress.js','utf8');
const inject=fs.readFileSync('src/v295FirstAttemptUiInjectionPatch.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');

assert.match(backend,/2026-08-31-v380-auto-prepare-current-shopee-lifecycle-v1/);
assert.match(backend,/2026-08-31-v393-exact-selected-shopee-runtime-pointer-v1/,'V393 must bind the legacy SHOPEE executor to the explicitly selected persisted date');
assert.match(backend,/2026-08-31-v394-runtime-failure-diagnostic-v1/,'V394 must expose sanitized persisted Shopee failure diagnostics');
assert.match(backend,/2026-08-31-v395-preflight-running-status-v1/,'V395 must synchronize the run badge before the real CE preflight begins');
assert.match(backend,/business_export_snapshots/,'V311+ must verify an exact VALID snapshot before reopening a finished run');
assert.match(backend,/reconciliationStatus/,'V311+ must require completed snapshot reconciliation');
assert.match(backend,/lock\?\.status==='finished'/,'V311+ must specifically repair the finished-without-snapshot dead state');
assert.match(backend,/updateBusinessRunLock\(SHOPEE,date,'failed'/,'V311+ must retain normal same-lifecycle checkpoint recovery');
assert.match(backend,/function prepareCurrentShopeeLifecycle\(req,res,next\)/,'V380 must prepare the exact current SHOPEE import lifecycle before execution');
assert.match(backend,/function alignShopeeRuntimePointer\(db,reportDate\)/,'V393 must have one explicit selected-date runtime-pointer owner');
assert.match(backend,/SELECT sourceFile,summaryJson,totalCount FROM business_daily_reports WHERE businessType=\? AND reportDate=\?/,'selected-date binding must require exact persisted SHOPEE daily membership');
assert.match(backend,/const compact=\{[\s\S]*businessType:SHOPEE,[\s\S]*reportDate:date,[\s\S]*dailyReportReady:true/,'selected-date binding must write only a compact runtime pointer that loadBusinessState can rehydrate');
assert.match(backend,/const pointer=alignShopeeRuntimePointer\(getDb\(\),status\.reportDate\);[\s\S]*prepareV311ShopeeRecovery/,'selected-date pointer binding must happen before lifecycle prepare and legacy execution');
assert.match(backend,/V311_SHOPEE_DAILY_STATE_MISSING/,'missing target-date daily state must fail closed instead of silently running a different date');
assert.match(backend,/routePath==='\/api\/shopee\/run\/start'/,'SHOPEE start must pass through the lifecycle prepare gate');
assert.match(backend,/routePath==='\/api\/shopee\/run\/resume'/,'SHOPEE resume must pass through the lifecycle prepare gate');
assert.match(backend,/prepareV311ShopeeRecovery\(\{reportDate:status\.reportDate,actor:/,'the execution gate must invoke canonical V311 prepare rather than inventing a second recovery path');
assert.match(backend,/originalPost\.call\(this,route,prepareCurrentShopeeLifecycle,\.\.\.handlers\)/,'prepare must run before the registered start\/resume handler');
assert.match(backend,/function readShopeeRuntimeDiagnostic\(db,reportDate,lock=null\)/,'V394 must read failure detail from tiny persisted state/run metadata only');
assert.match(backend,/json_extract\(valueJson,'\$\.processing\.error'\)/,'V394 must expose the persisted processing error without reading heavy fact tables');
assert.match(backend,/json_extract\(valueJson,'\$\.apiDiagnostic'\)/,'V394 must expose the existing sanitized CE preflight diagnostic');
assert.match(backend,/errorMessage:String\(lock\.errorMessage\|\|''\)/,'canonical status must expose the exact persisted run-lock failure message');
assert.match(backend,/function installShopeeExecutionFailureCapture\(res,reportDate\)/,'early Shopee execution failures must synchronize into the run lock');
assert.match(backend,/const status=code==='AUTH_REQUIRED'\?'paused':'failed'/,'expired CE auth must pause while other execution failures become failed');
assert.match(backend,/installShopeeExecutionFailureCapture\(res,status\.reportDate\)/,'failure capture must be installed only after exact-date prepare succeeds');
assert.match(backend,/lock&&\['failed','paused'\]\.includes\(String\(lock\.status\|\|''\)\.toLowerCase\(\)\)/,'retrying an old failed/paused lifecycle must enter running before preflight');
assert.match(backend,/updateBusinessRunLock\(SHOPEE,date,'running',''\)/,'V395 must clear the stale failure badge at the start of the new preflight attempt');
assert.match(backend,/preflightStatusPolicy:V395_SHOPEE_PREFLIGHT_STATUS_ID/,'prepared status must disclose the V395 preflight-status policy');

// V377 intentionally retires only a stale pre-import run pointer so a fresh
// same-date VALID import can receive a new runId. This is not business-data loss.
// V393/V394/V395 may repoint/read tiny runtime metadata, but they must never mutate
// persisted daily/API/final/audit facts while selecting or diagnosing a date.
assert.match(backend,/DELETE FROM business_run_checkpoints WHERE businessType=\? AND reportDate=\? AND runId=\?/,
  'stale checkpoint retirement must be constrained by business + date + exact old runId');
assert.match(backend,/DELETE FROM business_run_locks WHERE businessType=\? AND reportDate=\? AND runId=\?/,
  'stale lock retirement must be constrained by business + date + exact old runId');
assert.doesNotMatch(backend,/DELETE FROM business_(?:daily_reports|daily_parse_rows|scan_results|shipment_tracks|track_events|final_rows|pod_locks|carry_bills|exception_items|api_batches|export_snapshots)/,
  'recovery must never delete persisted daily membership, API evidence, final facts, carry/POD locks, or audit snapshots');
assert.doesNotMatch(backend,/UPDATE\s+business_(?:daily_reports|daily_parse_rows|scan_results|shipment_tracks|track_events|final_rows|pod_locks|carry_bills|exception_items|api_batches|export_snapshots)/i,
  'selected-date routing/diagnosis must never rewrite persisted SHOPEE facts');
assert.doesNotMatch(backend,/DELETE FROM business_run_checkpoints\s+WHERE\s+(?!businessType=\? AND reportDate=\? AND runId=\?)/,
  'checkpoint retirement must never broaden beyond the exact stale lifecycle');

assert.match(businessStore,/const finalByBill = new Map/,'Shopee state save must index final rows once instead of rescanning per carry ticket');
assert.match(businessStore,/const priorCarryByBill = new Map/,'Shopee state save must index historical carry rows once');
assert.match(businessStore,/const final = finalByBill\.get\(bill\) \|\| priorCarryByBill\.get\(bill\) \|\| \{\}/,'active carry persistence must use O(1) indexed lookup');
assert.doesNotMatch(businessStore,/state\.finalRows\.find\(row => billOf\(row\) === bill\) \|\| state\.priorCarryRows\.find/,'O(N²) per-ticket carry lookup must never return');
assert.match(businessStore,/2026-09-01-shopee-lightweight-runtime-checkpoint-v1/,'production must expose the lightweight Shopee runtime-checkpoint revision');
assert.match(businessStore,/if \(runtimeCheckpoint\) mirrorBusinessRuntimeCheckpoint\(db, normalized, type, now\);\s*else mirrorBusinessTables\(db, normalized, type, now\);/,'active Shopee saves must use the lightweight checkpoint while final saves retain the authoritative full mirror');
assert.ok(businessStore.includes("runtimeCheckpoint ? 'checkpoint_done' : 'save_done'"),'production must expose separate checkpoint and final-save timing markers');
assert.match(businessStore,/serializeMs=/,'state JSON serialization must be separately timed');

assert.match(v309,/2026-08-29-ui-only-no-unified-trigger-v1/,'V309 must be UI-only');
assert.doesNotMatch(v309,/global\.resumeUnified\(\)|global\.resumeShopee\(\)|\/api\/shopee\/run\/resume/,'V309 must never resume Shopee or unified processing');
assert.match(v310,/global\.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__/,'retired V310 source keeps its historical yield guard for rollback diagnostics');

assert.ok(ui.includes('2026-08-27-v333-shopee-recovery-no-summary-mutation-v1'),'historical V311 browser source must remain source-checkable');
assert.ok(ui.includes('/api/v311/shopee-recovery'),'historical source must still describe backend-truth recovery');
assert.doesNotMatch(ui,/getElementById\('ccslRunStatus'\)/,'historical V311 source must never mutate the CCSL detail panel');
assert.doesNotMatch(ui,/getElementById\('sevenBusinessStageSummary'\)/,'historical V311 source must never acquire the canonical seven-business summary DOM');

assert.match(seven,/2026-08-29-single-unified-runner-status-only-v1/,'V168 must be status-only');
assert.match(seven,/2026-08-31-v394-visible-shopee-failure-detail-v1/,'V168 must visibly own exact Shopee failure detail');
assert.match(seven,/postJson\('\/api\/v311\/shopee-recovery',[\s\S]*action: 'status'/,'V168 must read canonical SHOPEE backend recovery truth');
assert.match(seven,/stageFromShopeeRecovery/,'V168 must derive SHOPEE stage from canonical recovery payload');
assert.match(seven,/diagnostic\.errorMessage[\s\S]*diagnostic\.ceMsg[\s\S]*payload\?\.lock\?\.errorMessage/,'V168 must prefer persisted diagnostic/run-lock error text over generic reason');
assert.match(seven,/data-testid="seven-business-failure-detail"/,'failed or paused stage reason must be visible inline instead of tooltip-only');
assert.match(seven,/diagnostic\.httpStatus/,'visible diagnostic must include sanitized HTTP status when available');
assert.doesNotMatch(seven,/\/api\/shopee\/run\/resume|global\.resumeUnified\s*=/,'V168 must not execute Shopee recovery');

assert.match(runner,/2026-08-29-single-unified-runner-v1/,'V67 must own the single foreground execution architecture');
assert.match(runner,/\/api\/v311\/shopee-recovery/,'V67 must use canonical Shopee backend truth before deciding whether to execute');
assert.match(runner,/\/api\/shopee\/run\/resume/,'V67 must own Shopee checkpoint continuation');
assert.match(ccslProgress,/2026-08-31-v393-preserve-unified-failure-detail-v1/,'CCSL detail owner must preserve terminal V67 failure visibility');
assert.match(ccslProgress,/if\(type==='FAILED'\|\|type==='ERROR'\)return true/,'a SHOPEE/WHPP failure must not be overwritten by CCSL completed detail');

assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260827-v333-1'),'V311 compatibility marker must remain source-visible');
assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260827-v332-1'),'V332 compatibility marker must remain source-visible');
assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260826-v313-1'),'V313 compatibility marker must remain source-visible');
assert.doesNotMatch(inject,/if\(!body\.includes\(V311_RECOVERY_MARKER\)\)tags\.push/,'V311 browser recovery owner must not be injected');
assert.ok(inject.includes('X-CE-QC-V333-UI'),'V333 compatibility response header must remain observable');
assert.ok(inject.includes('X-CE-QC-Unified-Runner'),'single-runner response header must be observable');
assert.match(activation,/v311ShopeeIncompleteRecoveryPatch\.js/,'backend recovery route must remain production-active');

console.log('[V395/V394/V393/V380/V378/SINGLE-RUNNER] SHOPEE exact selected-date routing + preflight running-state sync + persisted failure diagnostic + lifecycle auto-prepare + WHPP completion-lock smoke passed · early failures synchronize run lock · facts/audit immutable · V67 remains sole browser execution owner');