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
  'src/v505PurgePublicStatusGuard.js','src/v541PurgePidOwnership.js','src/v29EndpointAliasPatch.js','src/accessControl.js',
  'scripts/CE_QC_PurgePrepareTaskWorker.mjs','scripts/CE_QC_PurgeExecuteTaskWorker.mjs',
  'public/v505-data-purge-recovery.js','public/v108-route-lazy-features.js'
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

const freeze=read('src/v505PurgeWriteFreezeGuard.js');
assert.match(freeze,/v20-historical-startup-reconcile/);
assert.match(freeze,/COMMIT_RECEIPT_UNREADABLE/);
assert.match(freeze,/COMMIT_RECEIPT_ORPHANED/);
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

const ui=read('public/v505-data-purge-recovery.js');
assert.match(ui,/v8-version-aware-owner/);
assert.match(ui,/v531-server-admin-authority/,'V531 owner must be the browser purge authority');
assert.doesNotMatch(ui,/requestJson\('\/api\/session'/,'purge open must never depend on a duplicate /api/session round-trip');
assert.match(ui,/knownRole=typeof accessSession!=='undefined'/,'UI may use already-loaded session state only as a best-effort early role hint');
assert.match(ui,/submitPrepareRecovering/);
assert.match(ui,/submitExecuteRecovering/);
assert.match(ui,/不会解除任务锁，也不会启动第二个任务/);
const server=read('server.js');
assert.match(server,/app\.post\('\/api\/admin\/data-purge\/prepare', requireRole\('ADMIN'\)/,'PREPARE must remain server-authoritative ADMIN-only');
assert.match(server,/app\.post\('\/api\/admin\/data-purge\/execute', requireRole\('ADMIN'\)/,'EXECUTE must remain server-authoritative ADMIN-only');
const lazy=read('public/v108-route-lazy-features.js');
assert.match(lazy,/v505-data-purge-recovery\.js\?v=20260911-v505-8/);
assert.doesNotMatch(lazy,/v104-fast-purge-ui\.js/);

console.log('[CE-QC][V505_PURGE_ASYNC_SMOKE] pass · V541 PID-reuse recovery preserves sealed DB/receipt authority, startup-orphan retirement, write freeze and server-authoritative purge ownership');
