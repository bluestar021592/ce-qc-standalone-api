const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
for(const file of ['src/v311ShopeeIncompleteRecoveryPatch.js','public/v309-ui-integrity.js','public/v310-unified-resume-owner.js','public/v311-shopee-recovery-owner.js','public/v168-seven-business-status.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const backend=fs.readFileSync('src/v311ShopeeIncompleteRecoveryPatch.js','utf8');
const v309=fs.readFileSync('public/v309-ui-integrity.js','utf8');
const v310=fs.readFileSync('public/v310-unified-resume-owner.js','utf8');
const ui=fs.readFileSync('public/v311-shopee-recovery-owner.js','utf8');
const seven=fs.readFileSync('public/v168-seven-business-status.js','utf8');
const inject=fs.readFileSync('src/v295FirstAttemptUiInjectionPatch.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');

assert.match(backend,/2026-08-26-v311-reopen-finished-without-snapshot-v1/);
assert.match(backend,/business_export_snapshots/,'V311+ must verify an exact VALID snapshot before reopening a finished run');
assert.match(backend,/reconciliationStatus/,'V311+ must require completed snapshot reconciliation');
assert.match(backend,/lock\?\.status==='finished'/,'V311+ must specifically repair the finished-without-snapshot dead state');
assert.match(backend,/updateBusinessRunLock\(SHOPEE,date,'failed'/,'V311+ must reopen without deleting checkpoints');
assert.doesNotMatch(backend,/DELETE FROM business_(?:scan|track|shipment|daily|run_checkpoints)/,'recovery must never delete persisted progress or daily membership');

assert.match(v309,/global\.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__/,'V309 auto-resume must yield to the canonical recovery owner');
assert.match(v310,/global\.__CE_QC_V311_SHOPEE_RECOVERY_OWNER__/,'V310 watchdog must yield to the canonical recovery owner');

assert.ok(ui.includes('2026-08-27-v333-shopee-recovery-no-summary-mutation-v1'),'V333 SHOPEE recovery owner must be active');
assert.ok(ui.includes('__CE_QC_V311_SHOPEE_RECOVERY_OWNER__'),'SHOPEE recovery owner must remain installed');
assert.ok(ui.includes('/api/v311/shopee-recovery'),'recovery UI must ask backend truth rather than stale DOM state');
assert.ok(ui.includes("fetch('/api/shopee/run/resume'"),'recovery UI must bypass stale browser runInFlight/app-state gates when resuming');
assert.ok(ui.includes('VALID + COMPLETED 正式快照'),'SHOPEE completion notice must still mean a real formal snapshot exists');
assert.ok(ui.includes('syncCanonicalStatus'),'recovery state must still come from one backend status object');
assert.ok(ui.includes('globalProcessingNotice'),'SHOPEE recovery may own its process notice');
assert.doesNotMatch(ui,/getElementById\('ccslRunStatus'\)/,'SHOPEE recovery must never mutate the CCSL detail panel');
assert.doesNotMatch(ui,/sevenBusinessStageSummary/,'SHOPEE recovery must never mutate the canonical seven-business summary');
assert.doesNotMatch(ui,/querySelectorAll\('#importPage \.status-pill/,'SHOPEE recovery must not scan/repaint status pills owned by V168/V138');
assert.match(ui,/setInterval\(\(\)=>tick\(false\),5000\)/,'recovery truth must remain synchronized');
assert.doesNotMatch(ui,/global\.resumeShopee\(\)|global\.resumeUnified\(\)/,'recovery owner must not depend on browser runInFlight-gated wrappers');

assert.match(seven,/2026-08-27-v333-canonical-seven-business-owner-v1/,'V168 V333 must own canonical summary text and colors');
assert.match(seven,/postJson\('\/api\/v311\/shopee-recovery',[\s\S]*action: 'status'/,'V168 must read the same canonical SHOPEE recovery truth used by the recovery owner');
assert.match(seven,/stageFromShopeeRecovery/,'V168 must derive SHOPEE stage from canonical recovery payload');

assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260827-v333-1'),'V333 SHOPEE recovery owner must be cache-busted and injected');
assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260827-v332-1'),'V332 compatibility marker must remain source-visible for older safety gates');
assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260826-v313-1'),'V313 compatibility marker must remain source-visible for older safety gates');
assert.ok(inject.includes('X-CE-QC-V332-UI'),'V332 compatibility response header must remain observable');
assert.ok(inject.includes('X-CE-QC-V333-UI'),'V333 response header must be observable');
assert.match(activation,/v311ShopeeIncompleteRecoveryPatch\.js/,'backend recovery route must remain production-active');

console.log('[V333/V313] SHOPEE recovery isolation smoke passed · recovery stays checkpoint-safe · V168 alone owns summary · CCSL detail is never repainted by SHOPEE');
