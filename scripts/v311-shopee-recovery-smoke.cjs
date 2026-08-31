const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
for(const file of ['src/v311ShopeeIncompleteRecoveryPatch.js','src/businessStore.js','src/v134WhppRunSupervisorPatch.js','public/v309-ui-integrity.js','public/v310-unified-resume-owner.js','public/v311-shopee-recovery-owner.js','public/v168-seven-business-status.js','public/v67-resilient-run-guard.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
execFileSync(process.execPath,['scripts/v378-whpp-completion-lock-smoke.mjs'],{stdio:'inherit'});
const backend=fs.readFileSync('src/v311ShopeeIncompleteRecoveryPatch.js','utf8');
const businessStore=fs.readFileSync('src/businessStore.js','utf8');
const v309=fs.readFileSync('public/v309-ui-integrity.js','utf8');
const v310=fs.readFileSync('public/v310-unified-resume-owner.js','utf8');
const ui=fs.readFileSync('public/v311-shopee-recovery-owner.js','utf8');
const seven=fs.readFileSync('public/v168-seven-business-status.js','utf8');
const runner=fs.readFileSync('public/v67-resilient-run-guard.js','utf8');
const inject=fs.readFileSync('src/v295FirstAttemptUiInjectionPatch.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');

assert.match(backend,/2026-08-26-v311-reopen-finished-without-snapshot-v1/);
assert.match(backend,/business_export_snapshots/,'V311+ must verify an exact VALID snapshot before reopening a finished run');
assert.match(backend,/reconciliationStatus/,'V311+ must require completed snapshot reconciliation');
assert.match(backend,/lock\?\.status==='finished'/,'V311+ must specifically repair the finished-without-snapshot dead state');
assert.match(backend,/updateBusinessRunLock\(SHOPEE,date,'failed'/,'V311+ must retain normal same-lifecycle checkpoint recovery');

// V377 intentionally retires only a stale pre-import run pointer so a fresh
// same-date VALID import can receive a new runId. This is not business-data loss.
// The old broad regex treated business_run_checkpoints as facts and blocked the
// correct lifecycle repair. Keep the safety contract precise: exact old-run
// lock/checkpoint pointers may be deleted, all persisted daily/API/final/audit
// facts remain forbidden deletion targets.
assert.match(backend,/DELETE FROM business_run_checkpoints WHERE businessType=\? AND reportDate=\? AND runId=\?/,
  'stale checkpoint retirement must be constrained by business + date + exact old runId');
assert.match(backend,/DELETE FROM business_run_locks WHERE businessType=\? AND reportDate=\? AND runId=\?/,
  'stale lock retirement must be constrained by business + date + exact old runId');
assert.doesNotMatch(backend,/DELETE FROM business_(?:daily_reports|daily_parse_rows|scan_results|shipment_tracks|track_events|final_rows|pod_locks|carry_bills|exception_items|api_batches|export_snapshots)/,
  'recovery must never delete persisted daily membership, API evidence, final facts, carry/POD locks, or audit snapshots');
assert.doesNotMatch(backend,/DELETE FROM business_run_checkpoints\s+WHERE\s+(?!businessType=\? AND reportDate=\? AND runId=\?)/,
  'checkpoint retirement must never broaden beyond the exact stale lifecycle');

assert.match(businessStore,/const finalByBill = new Map/,'Shopee state save must index final rows once instead of rescanning per carry ticket');
assert.match(businessStore,/const priorCarryByBill = new Map/,'Shopee state save must index historical carry rows once');
assert.match(businessStore,/const final = finalByBill\.get\(bill\) \|\| priorCarryByBill\.get\(bill\) \|\| \{\}/,'active carry persistence must use O(1) indexed lookup');
assert.doesNotMatch(businessStore,/state\.finalRows\.find\(row => billOf\(row\) === bill\) \|\| state\.priorCarryRows\.find/,'O(N²) per-ticket carry lookup must never return');
assert.match(businessStore,/\[CE-QC\]\[BUSINESS_STATE_STAGE\] save_done/,'production must expose Shopee state-save timing');
assert.match(businessStore,/serializeMs=/,'state JSON serialization must be separately timed');

assert.match(v309,/2026-08-29-ui-only-no-unified-trigger-v1/,'V309 must be UI-only');
assert.doesNotMatch(v309,/global\.resumeUnified\(\)|global\.resumeShopee\(\)|\/api\/shopee\/run\/resume/,'V309 must never resume Shopee or unified processing');
assert.match(v310,/global\.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__/,'retired V310 source keeps its historical yield guard for rollback diagnostics');

assert.ok(ui.includes('2026-08-27-v333-shopee-recovery-no-summary-mutation-v1'),'historical V311 browser source must remain source-checkable');
assert.ok(ui.includes('/api/v311/shopee-recovery'),'historical source must still describe backend-truth recovery');
assert.doesNotMatch(ui,/getElementById\('ccslRunStatus'\)/,'historical V311 source must never mutate the CCSL detail panel');
assert.doesNotMatch(ui,/getElementById\('sevenBusinessStageSummary'\)/,'historical V311 source must never acquire the canonical seven-business summary DOM');

assert.match(seven,/2026-08-29-single-unified-runner-status-only-v1/,'V168 must be status-only');
assert.match(seven,/postJson\('\/api\/v311\/shopee-recovery',[\s\S]*action: 'status'/,'V168 must read canonical SHOPEE backend recovery truth');
assert.match(seven,/stageFromShopeeRecovery/,'V168 must derive SHOPEE stage from canonical recovery payload');
assert.doesNotMatch(seven,/\/api\/shopee\/run\/resume|global\.resumeUnified\s*=/,'V168 must not execute Shopee recovery');

assert.match(runner,/2026-08-29-single-unified-runner-v1/,'V67 must own the single foreground execution architecture');
assert.match(runner,/\/api\/v311\/shopee-recovery/,'V67 must use canonical Shopee backend truth before deciding whether to execute');
assert.match(runner,/\/api\/shopee\/run\/resume/,'V67 must own Shopee checkpoint continuation');

assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260827-v333-1'),'V311 compatibility marker must remain source-visible');
assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260827-v332-1'),'V332 compatibility marker must remain source-visible');
assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260826-v313-1'),'V313 compatibility marker must remain source-visible');
assert.doesNotMatch(inject,/if\(!body\.includes\(V311_RECOVERY_MARKER\)\)tags\.push/,'V311 browser recovery owner must not be injected');
assert.ok(inject.includes('X-CE-QC-V333-UI'),'V333 compatibility response header must remain observable');
assert.ok(inject.includes('X-CE-QC-Unified-Runner'),'single-runner response header must be observable');
assert.match(activation,/v311ShopeeIncompleteRecoveryPatch\.js/,'backend recovery route must remain production-active');

console.log('[V378/SINGLE-RUNNER/V345/V333] SHOPEE recovery + WHPP completion-lock smoke passed · exact stale run pointers may retire · business facts/audit remain immutable · duplicate finalized WHPP cannot re-enter processing');
