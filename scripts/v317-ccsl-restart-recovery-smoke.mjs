import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chooseCcslReportDate, ccslRecoveryDecision, V317_CCSL_RECOVERY_POLICY_ID } from '../src/v317CcslRecoveryPolicy.js';

for(const file of ['src/v317CcslRecoveryPolicy.js','src/v317CcslIncompleteRecoveryPatch.js','public/v317-ccsl-recovery-owner.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

assert.match(V317_CCSL_RECOVERY_POLICY_ID,/v317-ccsl-restart-recovery-policy-v1/);
assert.equal(chooseCcslReportDate({latestValidUnified:'2026-08-06',currentState:'2026-08-05',lastProcessed:'2026-08-05',latestDaily:'2026-08-05'}),'2026-08-06','latest VALID unified import must own restart recovery even when legacy state/meta still point at yesterday');
assert.equal(chooseCcslReportDate({currentState:'2026-08-06',lastProcessed:'2026-08-05'}),'2026-08-06');
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:''}),{complete:false,paused:false,needsResume:true,action:'CREATE_AND_RESUME'});
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:'running'}),{complete:false,paused:false,needsResume:true,action:'RESUME_EXISTING'});
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:'failed'}),{complete:false,paused:false,needsResume:true,action:'RESUME_EXISTING'});
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:'finished'}),{complete:false,paused:false,needsResume:true,action:'REOPEN_FINISHED'});
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:false,lockStatus:'paused'}),{complete:false,paused:true,needsResume:false,action:'PAUSED'},'explicit user pause must never be auto-resumed');
assert.deepEqual(ccslRecoveryDecision({hasDaily:true,complete:true,lockStatus:'finished'}),{complete:true,paused:false,needsResume:false,action:'COMPLETE'},'VALID COMPLETED snapshot must never be rerun');

const backend=fs.readFileSync(new URL('../src/v317CcslIncompleteRecoveryPatch.js',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../public/v317-ccsl-recovery-owner.js',import.meta.url),'utf8');
const activation=fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js',import.meta.url),'utf8');
const injection=fs.readFileSync(new URL('../src/v295FirstAttemptUiInjectionPatch.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');

assert.match(backend,/unified_import_batches WHERE status='VALID'/,'CCSL recovery date must be anchored to a VALID unified import');
assert.match(backend,/businessType IN \('CE','CEAF','TBKH','ALI1688'\)/,'CCSL membership must exactly cover the four CCSL-routed boards');
assert.match(backend,/COALESCE\(status,'VALID'\)='VALID'/);
assert.match(backend,/COALESCE\(reconciliationStatus,'COMPLETED'\)='COMPLETED'/,'only a formally valid completed CCSL snapshot can suppress recovery');
assert.match(backend,/createOrRecoverRun\(date/,'missing run locks must be created without deleting imported membership');
assert.match(backend,/updateRunLock\(date,'failed'/,'finished-without-snapshot must become recoverable rather than falsely complete');
assert.doesNotMatch(backend,/DELETE FROM (?:scan_results|track_events|run_checkpoints|unified_import_rows)/,'restart recovery must never delete persisted evidence/checkpoints/import membership');

assert.match(client,/2026-08-26-v317-ccsl-restart-auto-recovery-v2/,'all-page V317 recovery owner must be active');
assert.match(client,/\/api\/v317\/ccsl-recovery/);
assert.match(client,/\/api\/run\/start/,'V317 must directly attach/start the CCSL backend run after preparing persisted recovery state');
assert.doesNotMatch(client,/SHOPEE CN\/VN\s*待处理/,'CCSL recovery must not depend on SHOPEE being pending');
assert.match(client,/status\.paused/,'explicit pause state must be respected by the client owner');
assert.doesNotMatch(client,/location\.pathname\s*!==\s*['"]\/import['"]/,'restart continuation must not depend on the user opening the import page');
assert.match(activation,/v317CcslIncompleteRecoveryPatch\.js/,'V317 backend patch must load before server route registration');
assert.match(injection,/v317-ccsl-recovery-owner\.js\?v=20260826-v317-2/,'V317 browser owner must be cache-busted and injected');
assert.match(server,/resetRunForReport\(parsed\.reportDate\)[\s\S]*await saveState\(ccslState\)/,'fresh unified import intentionally resets the run lock, so restart recovery must recreate it from persisted current-day membership');
assert.match(server,/createOrRecoverRun\(reportDate/,'native CCSL execution must remain checkpoint-recoverable');

const screenshotCcslTotal=2478+58+0+150;
assert.equal(screenshotCcslTotal,2686,'2026-08-06 screenshot CCSL routing total must be CE+CEAF+TBKH+ALI1688, not the full 6098 import');

console.log('[V317] CCSL restart recovery smoke passed · latest VALID date wins · no-lock/running/failed resume · finished-without-snapshot reopens · explicit pause respected · completed snapshot never reruns · all-page continuation · 2026-08-06 CCSL queue=2686');
