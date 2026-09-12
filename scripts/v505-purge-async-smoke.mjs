import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const syntaxFiles=[
  'src/dataPurge.js','src/v505PurgeCoordinator.js','src/v505PurgeGlobalGuard.js','src/v505PurgeWriteFreezeGuard.js','src/v505PurgeHttpActivity.js',
  'src/v505PurgeExternalActivity.js','src/v505PurgeExecuteAdmissionGuard.js','src/v505ExportAdmissionGuard.js','src/v505PurgePublicStatusGuard.js','src/v193ExportSidecar.js','src/v29EndpointAliasPatch.js','src/accessControl.js',
  'scripts/CE_QC_PurgePrepareTaskWorker.mjs','scripts/CE_QC_PurgeExecuteTaskWorker.mjs',
  'public/v104-fast-purge-ui.js','public/v106-purge-legacy-controls-hide.js','public/v505-data-purge-recovery.js','public/v108-route-lazy-features.js',
  'test/data-purge-large-backup.test.js','test/v505-purge-global-guard.test.js','test/v505-purge-coordinator.test.js',
  'test/v505-purge-core-live-worker.test.js','test/v505-purge-write-freeze.test.js','test/v505-purge-auth-readonly.test.js',
  'test/v505-purge-external-activity.test.js','test/v505-purge-http-drain.test.js','test/v505-purge-control-db-fallback.test.js',
  'test/v505-purge-postcommit-recovery.test.js','test/v505-purge-ui-delivery.test.js','test/v505-purge-execute-env-failsafe.test.js',
  'test/v505-purge-worker-db-init-failsafe.test.js','test/v505-purge-worker-entrypoint-invariant.test.js','test/v505-purge-execute-readonly-preflight.test.js','test/v505-purge-execute-admission.test.js',
  'test/v505-purge-unreadable-sidecar-failclosed.test.js','test/v505-purge-public-status-privacy.test.js','test/v505-purge-no-reseal-caller.test.js','test/v505-purge-fingerprint-failclosed.test.js',
  'test/v505-purge-locked-fingerprint-gate.test.js','test/v505-purge-backup-invalid-recovery.test.js'
];
for(const relative of syntaxFiles){
  const result=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(result.status,0,`${relative} syntax check failed: ${result.stderr||result.stdout}`);
}

const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.scripts?.start,'node bootstrap.js');
assert.equal(pkg.scripts?.['start:raw'],'node bootstrap.js','no supported npm start path may bypass V505 bootstrap route ownership');
assert.ok(String(pkg.scripts?.['test:ci']||'').includes('test:golive'),'test:ci must delegate to the complete go-live gate');
for(const required of syntaxFiles.filter(name=>name.startsWith('test/'))){
  assert.ok(String(pkg.scripts?.['test:golive']||'').includes(required),`${required} must be in test:golive`);
}

const bootstrap=read('bootstrap.js');
const routeOwnerAt=bootstrap.indexOf("'./src/v29EndpointAliasPatch.js'");
const serverAt=bootstrap.indexOf("'./server.js'");
assert.ok(routeOwnerAt>=0&&serverAt>routeOwnerAt,'V505 route ownership must install before server.js');

const purge=read('src/dataPurge.js');
assert.match(purge,/v10-backup-bound-finalize/);
assert.match(purge,/PURGE_COMMIT_RECEIPT_KEY='data_purge_last_commit_receipt'/);
assert.match(purge,/PURGE_POST_COMMIT_BLOCK_MS=Math\.max\(60\*60_000,Math\.min\(7\*24\*60\*60_000/,'post-commit block must fail closed for at least one hour and be bounded');
assert.match(purge,/sourceFingerprint:sealedSourceFingerprint/,'manifest and returned backup evidence must keep the isolated worker fingerprint');
assert.match(purge,/sourceFingerprintGate:'BACKUP_WORKER_BEGIN_IMMEDIATE'/);
assert.match(purge,/backupRecordMode:'DEFERRED_UNTIL_POST_COMMIT_FINALIZE'/,'backup catalog DB write must not occur after physical backup and before DELETE');
assert.doesNotMatch(purge,/recordBackup\(/,'PREPARE must not mutate backup_records after the physical backup fingerprint was sealed');
assert.match(purge,/const sourceFingerprint=verifiedBackup\.sourceFingerprint/,'challenge fingerprint must come from the verified backup worker, not a later DB stat reseal');
assert.match(purge,/V505_PURGE_BACKUP_SOURCE_CHANGED_BEFORE_SEAL/,'any source drift between backup completion and challenge sealing must fail closed');
assert.doesNotMatch(purge,/const expiresAt=createdAt\+10\*60_000;\s*setPurgeBlock\(db,expiresAt\)/,'PREPARE must not write SQLite after the physical backup just to shorten the safety block');
assert.match(purge,/sameFingerprint\(challenge\.sourceFingerprint,currentFingerprint\)/,'execute precheck must compare against the original backup-bound DB+WAL fingerprint');
assert.match(purge,/db\.exec\('BEGIN IMMEDIATE'\);[\s\S]*?verifyPreparedBackupStillPresent\(commitContext\.backup\);[\s\S]*?const lockedFingerprint=databaseFingerprint\(getRuntimeConfig\(\)\.dbFile\);[\s\S]*?sameFingerprint\(commitContext\.expectedSourceFingerprint,lockedFingerprint\)[\s\S]*?for\(const table of clearTargets\)\{const deleted=/,'authoritative DB+WAL fingerprint must be rechecked under BEGIN IMMEDIATE before any business DELETE');
assert.match(purge,/V505_PURGE_CHALLENGE_EXPIRED_UNDER_LOCK/);
assert.match(purge,/V505_PURGE_SAFETY_BLOCK_EXPIRED_UNDER_LOCK/);
assert.match(purge,/V505_PURGE_SOURCE_FINGERPRINT_CHANGED/);
assert.match(purge,/const recoveryBlockUntil=Date\.now\(\)\+PURGE_POST_COMMIT_BLOCK_MS;[\s\S]*?meta\.run\(PURGE_BLOCK_KEY,String\(recoveryBlockUntil\),now\);[\s\S]*?meta\.run\(PURGE_COMMIT_RECEIPT_KEY,JSON\.stringify\(receipt\),now\);[\s\S]*?db\.exec\('COMMIT'\)/,'DELETE, long safety block and exact commit receipt must share one SQLite transaction');
assert.match(purge,/function assertPostCommitBusinessState/);
assert.match(purge,/系统不会再次DELETE/,'post-commit data drift must fail closed rather than rerun DELETE');
assert.match(purge,/verifyPreparedBackupStillPresent\(receipt\.backup\);[\s\S]*?assertPurgeStructure\(db\);[\s\S]*?assertPostCommitBusinessState\(db,receipt\);/,'finalization must revalidate backup, schema and business zero-state under a write lock');
assert.match(purge,/finalizationState:'SAFE_POSTCHECK_PASSED'/);
assert.match(purge,/PURGE_COMMIT_RECEIPT_KEY,JSON\.stringify\(finalizedReceipt\),finalizedAt[\s\S]*?DELETE FROM app_meta WHERE key=\?[^\n]*PURGE_BLOCK_KEY[\s\S]*?db\.exec\('COMMIT'\)/,'finalized receipt marker and safety-block release must commit atomically');
assert.match(purge,/ensurePurgeBackupRecord/,'backup catalog insertion is deferred to post-commit finalization');
assert.match(purge,/backupSourceFingerprint:'MATCHED_UNDER_BEGIN_IMMEDIATE'/);
assert.match(purge,/if\(typeof onCommitted==='function'\)onCommitted\(reset\.receipt\)/,'worker sidecar may acknowledge COMMIT only after SQLite COMMIT returns');
assert.doesNotMatch(purge,/clearBusinessRuntimeMeta\(db\)/);
assert.match(purge,/detached\s*:\s*true/);
assert.match(purge,/child\.unref\(\)/);
assert.match(purge,/if\(workerAlive\)[\s\S]*?return pendingPurgePayload/,'stale heartbeat must not retire a live/unknown PREPARE worker');

const coordinator=read('src/v505PurgeCoordinator.js');
assert.match(coordinator,/v7-postcommit-structure-failclosed/);
assert.match(coordinator,/finalizeCommittedPurge/);
assert.match(coordinator,/readPurgeCommitReceipt/);
assert.match(coordinator,/ACTIVE_EXECUTE=new Set\(\['QUEUED','RUNNING','COMMITTED'\]\)/);
assert.match(coordinator,/function committedReceipt/);
assert.match(coordinator,/status:committed\?'COMMITTED':'QUEUED'/);
assert.match(coordinator,/if\(receipt&&status!=='SUCCEEDED'\)/,'exact SQLite receipt must outrank stale filesystem execution state');
assert.match(coordinator,/executePurge\(\{\.\.\.payload\.request[\s\S]*?executeJobId:jobId[\s\S]*?onCommitted:/,'production worker must bind every destructive commit to its exact execute job id');
assert.match(coordinator,/const committed=readPurgeCommitReceipt\(\{challengeId,executeJobId:jobId\}\)/);
assert.doesNotMatch(coordinator,/resealPurgeChallenge/);
assert.doesNotMatch(coordinator,/setPurgeBlock/);
assert.match(coordinator,/detached:true/);
assert.match(coordinator,/child\.unref\(\)/);

const globalGuard=read('src/v505PurgeGlobalGuard.js');
assert.match(globalGuard,/v14-durable-finalization/);
assert.match(globalGuard,/lastCommitReceiptState/);
assert.match(globalGuard,/commitReceiptUnreadable/);
assert.match(globalGuard,/commitReceiptOrphaned/);
assert.match(globalGuard,/DATA_PURGE_COMMIT_RECEIPT_UNREADABLE/);
assert.match(globalGuard,/DATA_PURGE_COMMIT_RECEIPT_PENDING_RECOVERY/,'an unfinalized receipt with missing sidecar must block every new purge');
assert.match(globalGuard,/SIDECAR_UNREADABLE/);
assert.match(globalGuard,/SUBMISSION_MUTEX_FILE='\.purge_global_submission\.lock\.json'/);
assert.match(globalGuard,/fs\.openSync\(file,'wx',0o600\)/);
assert.match(globalGuard,/waitForMainApiDrain\(\{timeoutMs:3000,pollMs:25\}\)/);
assert.match(globalGuard,/FAILED_RETRYABLE/);
assert.match(globalGuard,/DATA_PURGE_HTTP_BUSY/);
assert.match(globalGuard,/DATA_PURGE_OWNED_BY_ANOTHER_ADMIN/);
assert.match(globalGuard,/DATA_PURGE_SUBMISSION_BUSY/);
assert.match(globalGuard,/DATA_PURGE_GLOBAL_LOCK_ORPHANED/);

const freeze=read('src/v505PurgeWriteFreezeGuard.js');
assert.match(freeze,/v16-durable-finalization/);
assert.match(freeze,/COMMIT_RECEIPT_UNREADABLE/);
assert.match(freeze,/COMMIT_RECEIPT_ORPHANED/,'unfinalized durable receipt must keep the web DB query-only even when its sidecar disappears');
assert.match(freeze,/receiptFinalized/);
assert.match(freeze,/SIDECAR_UNREADABLE/);
assert.match(freeze,/queryOnlyRequired/);
assert.match(freeze,/syncPurgeQueryOnly\(protectSharedDb\)/);
assert.doesNotMatch(freeze,/syncPurgeQueryOnly\(false\)/,'active purge control must never explicitly thaw the shared web DB');
assert.match(freeze,/reconcilePurgeQueryOnlyNow/);
assert.match(freeze,/LONG_LIVED_AFTER_AUTH/);
assert.match(freeze,/req\.v505PurgeReadOnlyAuth=true/);

const executeAdmission=read('src/v505PurgeExecuteAdmissionGuard.js');
assert.match(executeAdmission,/v5-receipt-authority/);
assert.match(executeAdmission,/readPurgeCommitReceipt/);
assert.match(executeAdmission,/durableReceipt:true/);
assert.match(executeAdmission,/V505_PURGE_EXECUTE_SIDECAR_UNREADABLE/);
assert.match(executeAdmission,/ACTIVE_EXECUTE=new Set\(\['QUEUED','RUNNING','COMMITTED'\]\)/);

const routeOwner=read('src/v29EndpointAliasPatch.js');
assert.match(routeOwner,/v505PurgePublicStatusGuard/);
assert.match(routeOwner,/v505TrackMainApiActivity/);
assert.match(routeOwner,/v505PurgeExecuteAdmissionGuard/);
assert.match(routeOwner,/if\(!admitted\)[\s\S]*?v505PurgeSubmissionMutexRelease/);
assert.match(routeOwner,/v505PurgeGlobalOwnerGuard,v505GuardedPrepareHandler/);
assert.match(routeOwner,/v505PurgeGlobalOwnerGuard,v505GuardedExecuteHandler/);
const publicGuardAt=routeOwner.indexOf('previousUse.call(this,v505PurgePublicStatusGuard)');
const firstFreeze=routeOwner.indexOf('previousUse.call(this,v505PurgeWriteFreezeGuard)');
const trackerAt=routeOwner.indexOf('previousUse.call(this,v505TrackMainApiActivity)');
const authAt=routeOwner.indexOf('const result=previousUse.apply(this,args)');
const secondFreeze=routeOwner.lastIndexOf('previousUse.call(this,v505PurgeWriteFreezeGuard)');
assert.ok(publicGuardAt>=0&&firstFreeze>publicGuardAt&&trackerAt>firstFreeze&&authAt>trackerAt&&secondFreeze>authAt,'middleware order must be public-status sanitizer -> freeze -> activity tracker -> auth -> freeze');

const publicGuard=read('src/v505PurgePublicStatusGuard.js');
assert.match(publicGuard,/v505-public-status-allowlist/);
assert.match(publicGuard,/PUBLIC_KEYS/);
assert.doesNotMatch(publicGuard,/databasePath|sourceFingerprint|statusToken|statusFile|userEmail/,'public status allowlist module must never name private purge fields');

const access=read('src/accessControl.js');
assert.match(access,/PURGE_STATUS_PATH/);
assert.match(access,/if \(req\.v505PurgeReadOnlyAuth\) return user/);
assert.match(access,/if\(req\.v505PurgeReadOnlyAuth\)return/);

const external=read('src/v505PurgeExternalActivity.js');
assert.match(external,/V505_EXPORT_SUBMISSION_MUTEX_FILE='\.v505_export_submission\.lock\.json'/);
assert.match(external,/DATA_PURGE_EXPORT_SUBMISSION_BUSY/);
assert.match(external,/DATA_PURGE_EXPORT_ACTIVE/);
const admission=read('src/v505ExportAdmissionGuard.js');
assert.match(admission,/v505PurgeWriteFreezeGuard,v505ExportAdmissionGuard,\.\.\.handlers/);
assert.match(admission,/beforeAcquire=inspectPurgeWriteFreezeState\(\)/);
assert.match(admission,/afterAcquire=inspectPurgeWriteFreezeState\(\)/);
assert.match(admission,/watchRegisteredJob/);

const worker=read('scripts/CE_QC_PurgeExecuteTaskWorker.mjs');
assert.ok(worker.indexOf("import('../src/v505PurgeExecuteReadOnlyPreflight.js')")<worker.indexOf("import('../src/v505PurgeCoordinator.js')"),'execute worker must pass SELECT-only preflight before loading destructive coordinator code');
const db=read('src/db.js');
assert.match(db,/V505_PURGE_EXECUTE_SOURCE_MISSING/);
assert.match(db,/V505_PURGE_EXECUTE_DB_MODE_UNSAFE/);
assert.match(db,/V505_PURGE_EXECUTE_SCHEMA_MISMATCH/);

const ui=read('public/v505-data-purge-recovery.js');
assert.match(ui,/v8-version-aware-owner/);
assert.match(ui,/submitPrepareRecovering/);
assert.match(ui,/submitExecuteRecovering/);
assert.match(ui,/sameChallenge[\s\S]*?return postExecute\(challenge\)/,'lost EXECUTE response may retry only after recovery proves no job exists and the same challenge remains authoritative');
assert.match(ui,/不会解除任务锁，也不会启动第二个任务/);
assert.match(ui,/__CE_QC_V105_ASYNC_PURGE_UI__/);
assert.match(ui,/owner:'V505'/);
const lazy=read('public/v108-route-lazy-features.js');
assert.match(lazy,/v505-data-purge-recovery\.js\?v=20260911-v505-8/);
assert.doesNotMatch(lazy,/v104-fast-purge-ui\.js/);
const legacyUi=read('public/v104-fast-purge-ui.js');
assert.match(legacyUi,/if\(global\.__CE_QC_V105_ASYNC_PURGE_UI__\)return/);

const happy=read('test/data-purge-large-backup.test.js');
assert.match(happy,/exact fingerprint sealed by the verified backup worker/);
assert.match(happy,/backup catalog write must be deferred/);
assert.match(happy,/MATCHED_UNDER_BEGIN_IMMEDIATE/);
const postcommitTest=read('test/v505-purge-postcommit-recovery.test.js');
assert.match(postcommitTest,/SIMULATED_CRASH_AFTER_COMMIT/);
assert.match(postcommitTest,/V505_PURGE_POST_COMMIT_FINALIZE_BLOCKED/);
assert.match(postcommitTest,/failed post-commit invariant must not write a false finalized marker/);
assert.match(postcommitTest,/SAFE_POSTCHECK_PASSED/);
const freezeTest=read('test/v505-purge-write-freeze.test.js');
assert.match(freezeTest,/orphaned unfinalized commit receipt must remain authoritative/);
assert.match(freezeTest,/valid finalized receipt with no active sidecar is historical/);
const unreadableTest=read('test/v505-purge-unreadable-sidecar-failclosed.test.js');
assert.match(unreadableTest,/DATA_PURGE_COMMIT_RECEIPT_PENDING_RECOVERY/);
assert.match(unreadableTest,/malformed commit receipt must remain protected/);
const noResealTest=read('test/v505-purge-no-reseal-caller.test.js');
assert.match(noResealTest,/no production route, coordinator or worker may import\/call resealPurgeChallenge/);
const fingerprintTest=read('test/v505-purge-fingerprint-failclosed.test.js');
assert.match(fingerprintTest,/changed-after-backup/);
assert.match(fingerprintTest,/destructive reset must not have committed/);
const lockedFingerprintTest=read('test/v505-purge-locked-fingerprint-gate.test.js');
assert.match(lockedFingerprintTest,/after BEGIN IMMEDIATE and before first DELETE/);

console.log('[CE-QC][V505_PURGE_ASYNC_SMOKE] pass · backup-bound source fingerprint · detached prepare/execute · exact receipt recovery · atomic safe finalization marker · orphan receipt no-thaw · post-commit data/schema/backup invariants · locked fingerprint gate · public status privacy · single UI owner · bootstrap-only startup · export/API mutual exclusion');
