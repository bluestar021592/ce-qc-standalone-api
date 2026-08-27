const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
for(const file of ['src/v311ShopeeIncompleteRecoveryPatch.js','public/v309-ui-integrity.js','public/v310-unified-resume-owner.js','public/v311-shopee-recovery-owner.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const backend=fs.readFileSync('src/v311ShopeeIncompleteRecoveryPatch.js','utf8');
const v309=fs.readFileSync('public/v309-ui-integrity.js','utf8');
const v310=fs.readFileSync('public/v310-unified-resume-owner.js','utf8');
const ui=fs.readFileSync('public/v311-shopee-recovery-owner.js','utf8');
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

assert.ok(ui.includes('__CE_QC_V311_SHOPEE_RECOVERY_OWNER__'),'canonical SHOPEE recovery owner must remain installed');
assert.ok(ui.includes('/api/v311/shopee-recovery'),'UI must ask backend truth rather than stale DOM state');
assert.ok(ui.includes("fetch('/api/shopee/run/resume'"),'UI must bypass stale browser runInFlight/app-state gates when resuming');
assert.ok(ui.includes('VALID + COMPLETED 正式快照'),'visible completion must explicitly mean a real formal snapshot exists');
assert.ok(ui.includes('syncCanonicalStatus'),'visible SHOPEE state must come from one backend status object');
assert.ok(ui.includes('globalProcessingNotice'),'canonical owner must overwrite stale visible banners');
assert.ok(ui.includes('SHOPEE CN/VN 已完成'),'canonical owner must publish the completed wording');
assert.ok(ui.includes("classList.remove('success','warning','danger','muted')"),'canonical owner must clear stale pill classes before applying state');
assert.ok(ui.includes("state==='done'?'success'"),'completed state must map to green success styling');
assert.ok(ui.includes("'SHOPEE CN/VN 已完成','done'"),'completed SHOPEE text and done visual state must be applied together');
assert.match(ui,/setInterval\(\(\)=>tick\(false\),5000\)/,'canonical truth must remain synchronized');
assert.doesNotMatch(ui,/global\.resumeShopee\(\)|global\.resumeUnified\(\)/,'canonical owner must not depend on browser runInFlight-gated wrappers');

assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260827-v332-1'),'current SHOPEE owner must be cache-busted and injected');
assert.ok(inject.includes('/v311-shopee-recovery-owner.js?v=20260826-v313-1'),'V313 compatibility marker must remain source-visible for older safety gates');
assert.ok(inject.includes('X-CE-QC-V313-UI'),'compatibility response header must remain observable');
assert.ok(inject.includes('X-CE-QC-V332-UI'),'current completion-style response header must remain observable');
assert.match(activation,/v311ShopeeIncompleteRecoveryPatch\.js/,'backend recovery route must remain production-active');

console.log('[V332/V313] SHOPEE completion gate passed · formal snapshot truth retained · completed text maps to green success · forward-safe version gate');
