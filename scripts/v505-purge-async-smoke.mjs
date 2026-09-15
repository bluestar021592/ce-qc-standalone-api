import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const syntaxFiles=[
  'src/dataPurge.js','src/v505PurgeCoordinator.js','src/v505PurgeGlobalGuard.js','src/v505PurgeWriteFreezeGuard.js',
  'src/v505PurgeExecuteAdmissionGuard.js','src/v505PurgeStartupOrphanGuard.js','src/v505ExportAdmissionGuard.js',
  'src/v505PurgePublicStatusGuard.js','src/v505PurgeExternalActivity.js','src/v541PurgePidOwnership.js','src/v29EndpointAliasPatch.js','src/accessControl.js',
  'scripts/CE_QC_PreClearBackupWorker.mjs','scripts/CE_QC_PurgePrepareTaskWorker.mjs','scripts/CE_QC_PurgeExecuteTaskWorker.mjs',
  'public/v505-data-purge-recovery.js','public/v108-route-lazy-features.js','public/v502-multidrive-backup-ui.js'
];
for(const relative of syntaxFiles){
  const result=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(result.status,0,`${relative} syntax check failed: ${result.stderr||result.stdout}`);
}

const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.scripts?.start,'node bootstrap.js');
assert.equal(pkg.scripts?.['start:raw'],'node bootstrap.js');
assert.ok(String(pkg.scripts?.['test:ci']||'').includes('test:golive'));

const bootstrap=read('bootstrap.js');
const routeOwnerAt=bootstrap.indexOf("await importPhase('v29EndpointAliasPatch', './src/v29EndpointAliasPatch.js')");
const serverLaunchAt=bootstrap.indexOf('await importServerInteractiveFirst();');
assert.ok(routeOwnerAt>=0&&serverLaunchAt>routeOwnerAt,'V505 route ownership must install before the actual server launch');
assert.match(bootstrap,/async function importServerInteractiveFirst\(\)[\s\S]*?importPhase\('server', '\.\/server\.js'\)/);

const purge=read('src/dataPurge.js');
assert.match(purge,/v11-generation-bound-finalize/);
assert.match(purge,/PURGE_COMMIT_RECEIPT_KEY='data_purge_last_commit_receipt'/);
assert.match(purge,/sourceFingerprint:sealedSourceFingerprint/);
assert.match(purge,/sourceFingerprintGate:'BACKUP_WORKER_BEGIN_IMMEDIATE'/);
assert.match(purge,/backupRecordMode:'DEFERRED_UNTIL_POST_COMMIT_FINALIZE'/);
assert.doesNotMatch(purge,/recordBackup\(/);
assert.match(purge,/db\.exec\('BEGIN IMMEDIATE'\);[\s\S]*?verifyPreparedBackupStillPresent\(commitContext\.backup\);[\s\S]*?const lockedFingerprint=databaseFingerprint\(getRuntimeConfig\(\)\.dbFile\);[\s\S]*?sameFingerprint\(commitContext\.expectedSourceFingerprint,lockedFingerprint\)[\s\S]*?for\(const table of clearTargets\)\{const deleted=/);
assert.match(purge,/V505_PURGE_CHALLENGE_EXPIRED_UNDER_LOCK/);
assert.match(purge,/V505_PURGE_SOURCE_FINGERPRINT_CHANGED/);
assert.match(purge,/finalizationState:'SAFE_POSTCHECK_PASSED'/);
assert.match(purge,/backupSourceFingerprint:'MATCHED_UNDER_BEGIN_IMMEDIATE'/);
assert.match(purge,/detached\s*:\s*true/);
assert.match(purge,/child\.unref\(\)/);

const coordinator=read('src/v505PurgeCoordinator.js');
assert.match(coordinator,/v541-purge-coordinator-pid-reuse-v1/);
assert.match(coordinator,/function sealedDatabasePathForChallenge/,'V541 must retain the V12 sealed DB-path gate');
assert.match(coordinator,/V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED/,'V541 must fail closed if the sealed runtime DB path changes');
assert.match(coordinator,/inspectV541PurgeJobWorker/,'V541 coordinator must use process-start PID ownership proof');
assert.match(coordinator,/finalizeCommittedPurge/);
assert.match(coordinator,/readPurgeCommitReceipt/);
assert.match(coordinator,/ACTIVE_EXECUTE=new Set\(\['QUEUED','RUNNING','COMMITTED'\]\)/);
assert.match(coordinator,/executePurge\(\{\.\.\.payload\.request[\s\S]*?executeJobId:jobId[\s\S]*?onCommitted:/);
assert.doesNotMatch(coordinator,/resealPurgeChallenge/);

const globalGuard=read('src/v505PurgeGlobalGuard.js');
assert.match(globalGuard,/v541-global-purge-pid-reuse-v1/);
assert.match(globalGuard,/retireGlobalHistoricalPurgeStartupDebris/,'V541 must preserve V18 historical-startup retirement');
assert.match(globalGuard,/inspectV541PurgePidOwnership/,'V541 global mutex must use process-start PID ownership proof');
assert.match(globalGuard,/removeStaleSubmissionMutexIfUnchanged/,'V541 stale mutex recovery must recheck exact lock identity before deletion');
assert.match(globalGuard,/DATA_PURGE_COMMIT_RECEIPT_UNREADABLE/);
assert.match(globalGuard,/DATA_PURGE_COMMIT_RECEIPT_PENDING_RECOVERY/);
assert.match(globalGuard,/SUBMISSION_MUTEX_FILE='\.purge_global_submission\.lock\.json'/);
assert.match(globalGuard,/waitForMainApiDrain\(\{timeoutMs:3000,pollMs:25\}\)/);

const pidOwnership=read('src/v541PurgePidOwnership.js');
assert.match(pidOwnership,/classifyV539ExportAdmissionPid/,'V541 purge ownership must inherit the fail-closed V539 process-start classifier');
assert.match(pidOwnership,/workerClaimedAt\|\|job\.startedAt\|\|job\.submittedAt/,'V541 worker ownership must bind to a durable task-generation timestamp');

const external=read('src/v505PurgeExternalActivity.js');
assert.match(external,/v547-low-power-pid-lookup-cache-v1/);
assert.match(external,/V547_PID_START_CACHE_MS/,'Windows creation-time lookup must be cached');
assert.match(external,/pidStartCache=new Map\(\)/);
assert.match(external,/cached&&Date\.now\(\)-Number\(cached\.at\|\|0\)<=V547_PID_START_CACHE_MS/,'repeated ownership checks must reuse the bounded cache instead of respawning PowerShell');
assert.match(external,/classifyV539ExportAdmissionPid/,'V547 must preserve the V539 fail-closed PID classifier');

const freeze=read('src/v505PurgeWriteFreezeGuard.js');
assert.match(freeze,/v547-low-power-write-freeze-reconcile-v1/);
assert.match(freeze,/inspectV541PurgeJobWorker/,'V547 write-freeze active jobs must keep the shared process-start PID proof');
assert.match(freeze,/inspectV541PurgePidOwnership/,'V547 submission mutex ownership must keep the shared process-start PID proof');
assert.doesNotMatch(freeze,/function pidAlive\(/,'V547 must not regress to numeric PID liveness in write-freeze');
assert.match(freeze,/COMMIT_RECEIPT_UNREADABLE/);
assert.match(freeze,/COMMIT_RECEIPT_ORPHANED/);
assert.match(freeze,/COMPLETED_WAITING_EXPLICIT_EXECUTE/,'completed PREPARE must be distinguishable from active backup work');
assert.match(freeze,/TERMINAL_NO_PID_LOOKUP/,'completed PREPARE must never trigger a Windows PID-start subprocess');
assert.match(freeze,/prepareBlockSuppressed:completedPrepareIdle/,'the old one-hour PREPARE safety block must not keep the normal app frozen after backup completion');
assert.match(freeze,/readonlyUiAllowedDuringFreeze/,'active PREPARE must allow read-only UI APIs while writes remain frozen');
assert.match(freeze,/pathname\.startsWith\('\/api\/'\).*\['GET','HEAD'\]/,'read-only API access must be explicit in the freeze gate');
assert.match(freeze,/V547_RECONCILE_IDLE_MS/);
assert.match(freeze,/scheduleReconcile\(state\?\.active\?V547_RECONCILE_ACTIVE_MS:V547_RECONCILE_IDLE_MS\)/,'idle reconciliation must back off while active recovery remains responsive');
assert.doesNotMatch(freeze,/setInterval\(/,'V547 must not keep a fixed 10-second purge polling loop alive forever');
assert.match(freeze,/syncPurgeQueryOnly\(protectSharedDb\)/);
assert.doesNotMatch(freeze,/syncPurgeQueryOnly\(false\)/);
assert.match(freeze,/req\.v505PurgeReadOnlyAuth=true/);

const executeAdmission=read('src/v505PurgeExecuteAdmissionGuard.js');
assert.match(executeAdmission,/v9-finalized-generation-yield/);
assert.match(executeAdmission,/function strictCommitReceiptState\(\)/);
assert.match(executeAdmission,/SELECT value FROM app_meta WHERE key=\?/);
assert.match(executeAdmission,/V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED/);
assert.match(executeAdmission,/V505_PURGE_COMMIT_RECEIPT_UNREADABLE/);
assert.match(executeAdmission,/V505_PURGE_COMMIT_RECEIPT_PENDING_RECOVERY/);
assert.match(executeAdmission,/durableReceipt:true/);
assert.match(executeAdmission,/ACTIVE_EXECUTE=new Set\(\['QUEUED','RUNNING','COMMITTED'\]\)/);
assert.match(executeAdmission,/finalizedExact&&status==='SUCCEEDED'/,'only a fully finalized SUCCEEDED older generation may yield to a newer verified PREPARE');

const routeOwner=read('src/v29EndpointAliasPatch.js');
assert.match(routeOwner,/v505PurgeGlobalOwnerGuard,v505PurgeStartupOrphanGuard,v505GuardedPrepareHandler/);
assert.match(routeOwner,/v505PurgeGlobalOwnerGuard,v505PurgeStartupOrphanGuard,v505GuardedExecuteHandler/);
assert.match(routeOwner,/if\(!admitted\)[\s\S]*?v505PurgeSubmissionMutexRelease/);
const publicGuardAt=routeOwner.indexOf('previousUse.call(this,v505PurgePublicStatusGuard)');
const firstFreeze=routeOwner.indexOf('previousUse.call(this,v505PurgeWriteFreezeGuard)');
const trackerAt=routeOwner.indexOf('previousUse.call(this,v505TrackMainApiActivity)');
const authAt=routeOwner.indexOf('const result=previousUse.apply(this,args)');
const secondFreeze=routeOwner.lastIndexOf('previousUse.call(this,v505PurgeWriteFreezeGuard)');
assert.ok(publicGuardAt>=0&&firstFreeze>publicGuardAt&&trackerAt>firstFreeze&&authAt>trackerAt&&secondFreeze>authAt,'middleware order must be public-status sanitizer -> freeze -> activity tracker -> auth -> freeze');

const publicGuard=read('src/v505PurgePublicStatusGuard.js');
assert.match(publicGuard,/SAFE_KEYS/);
assert.doesNotMatch(publicGuard,/databasePath|sourceFingerprint|statusToken|statusFile|userEmail/);

const worker=read('scripts/CE_QC_PurgeExecuteTaskWorker.mjs');
assert.ok(worker.indexOf("import('../src/v505PurgeExecuteReadOnlyPreflight.js')")<worker.indexOf("import('../src/v505PurgeCoordinator.js')"),'read-only preflight must load before destructive coordinator');
const db=read('src/db.js');
assert.match(db,/V505_PURGE_EXECUTE_SOURCE_MISSING/);
assert.match(db,/V505_PURGE_EXECUTE_DB_MODE_UNSAFE/);
assert.match(db,/V505_PURGE_EXECUTE_SCHEMA_MISMATCH/);

const preClear=read('scripts/CE_QC_PreClearBackupWorker.mjs');
assert.match(preClear,/Math\.max\(256,Math\.min\(2048,Number\(payload\.ratePages\|\|2048\)\)\)/,'V547 must keep backup work bounded while removing V545 512-page per-step overhead');
assert.match(preClear,/highWaterMark:1024\*1024/,'SHA verification must keep bounded 1 MiB reads');
assert.match(preClear,/PRAGMA quick_check\(1\)/,'throughput tuning must not remove backup integrity verification');
assert.match(preClear,/sha256=await hashFile\(filePath\)/,'throughput tuning must not remove full SHA verification');
assert.match(preClear,/BEGIN IMMEDIATE/,'pre-clear backup must still seal writes while its exact source fingerprint is captured');
assert.match(preClear,/v547-bounded-throughput/);

const ui=read('public/v505-data-purge-recovery.js');
assert.match(ui,/v545-explicit-two-step-purge-ui-v1/);
assert.doesNotMatch(ui,/requestJson\('\/api\/session'/,'purge open must never depend on a duplicate /api/session round-trip');
assert.match(ui,/knownRole=typeof accessSession!=='undefined'/,'UI may use already-loaded session state only as a best-effort early role hint');
assert.match(ui,/尚未开始任何备份或清空任务/,'opening the wizard must be inert');
assert.match(ui,/global\.continueDataPurge=v505ContinueDataPurge/,'step one must explicitly own PREPARE');
assert.match(ui,/global\.executeDataPurge=v505ExecuteDataPurge/,'step two must explicitly own EXECUTE');
assert.match(ui,/String\(phrase\?\.value\|\|''\)==='永久清除全部业务数据'/,'exact phrase is mandatory');
assert.match(ui,/Boolean\(checkbox\?\.checked\)/,'backup checkbox is mandatory');
assert.match(ui,/最终确认：现在将永久清除全部业务数据/,'final browser confirmation is mandatory');
assert.match(ui,/v505ContinueDataPurge[\s\S]*?submitPrepareRecovering/,'only the explicit continue action may initiate PREPARE');
assert.match(ui,/v505ExecuteDataPurge[\s\S]*?executeChallenge\(preparedChallenge\)/,'only the explicit final action may initiate EXECUTE');
assert.match(ui,/submitPrepareRecovering/);
assert.match(ui,/submitExecuteRecovering/);
assert.match(ui,/不会解除任务锁，也不会启动第二个任务/);

const server=read('server.js');
assert.match(server,/app\.post\('\/api\/admin\/data-purge\/prepare', requireRole\('ADMIN'\)/,'PREPARE must remain server-authoritative ADMIN-only');
assert.match(server,/app\.post\('\/api\/admin\/data-purge\/execute', requireRole\('ADMIN'\)/,'EXECUTE must remain server-authoritative ADMIN-only');

const lazy=read('public/v108-route-lazy-features.js');
assert.match(lazy,/2026-09-15-v545-explicit-purge-owner-v1/,'V545 route-lazy owner version must force a fresh loader');
assert.match(lazy,/v505-data-purge-recovery\.js\?v=20260915-v545-1/,'V545 must cache-bust the purge owner');
assert.match(lazy,/v106-purge-legacy-controls-hide\.js\?v=20260915-v545-1/,'V545 must cache-bust the legacy-control guard with the owner');
assert.match(lazy,/installed\.includes\('v545-explicit-two-step'\)/,'V545 must reject stale purge owners at the capture gate');
assert.match(lazy,/event\.stopImmediatePropagation\(\)/);
assert.match(lazy,/loadGroup\('data'\)\.then/);
assert.match(lazy,/reassertPurgeOwner/);
assert.doesNotMatch(lazy,/v104-fast-purge-ui\.js/);

const backupUi=read('public/v502-multidrive-backup-ui.js');
assert.match(backupUi,/2026-09-15-v545-explicit-purge-owner-cache-bust-v1/);
assert.match(backupUi,/v545-explicit-two-step/);
assert.match(backupUi,/v505-data-purge-recovery\.js\?v=20260915-v545-1/);

console.log('[CE-QC][V505_PURGE_ASYNC_SMOKE] pass · V547 backs off idle purge reconciliation, caches Windows PID creation-time lookups, skips terminal PID probes, and raises pre-clear backup chunks to bounded 2048 pages while preserving full quick_check + SHA + source-fingerprint safety');
