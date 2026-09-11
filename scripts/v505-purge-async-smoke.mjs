import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const syntaxFiles=[
  'src/dataPurge.js','src/v505PurgeCoordinator.js','src/v505PurgeGlobalGuard.js','src/v505PurgeWriteFreezeGuard.js',
  'src/v505PurgeExternalActivity.js','src/v505ExportAdmissionGuard.js','src/v193ExportSidecar.js','src/v29EndpointAliasPatch.js','src/accessControl.js',
  'scripts/CE_QC_PurgePrepareTaskWorker.mjs','scripts/CE_QC_PurgeExecuteTaskWorker.mjs',
  'public/v104-fast-purge-ui.js','public/v106-purge-legacy-controls-hide.js','public/v505-data-purge-recovery.js',
  'test/data-purge-large-backup.test.js','test/v505-purge-global-guard.test.js','test/v505-purge-coordinator.test.js',
  'test/v505-purge-core-live-worker.test.js','test/v505-purge-write-freeze.test.js','test/v505-purge-auth-readonly.test.js',
  'test/v505-purge-external-activity.test.js','test/v505-purge-fingerprint-failclosed.test.js'
];
for(const relative of syntaxFiles){
  const result=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(result.status,0,`${relative} syntax check failed: ${result.stderr||result.stdout}`);
}

const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.scripts?.start,'node bootstrap.js');
for(const required of [
  'test/data-purge-large-backup.test.js','test/v505-purge-global-guard.test.js','test/v505-purge-coordinator.test.js',
  'test/v505-purge-core-live-worker.test.js','test/v505-purge-write-freeze.test.js','test/v505-purge-auth-readonly.test.js',
  'test/v505-purge-external-activity.test.js','test/v505-purge-fingerprint-failclosed.test.js'
]) assert.ok(String(pkg.scripts?.['test:golive']||'').includes(required),`${required} must be in test:golive`);

const bootstrap=read('bootstrap.js');
const routeOwnerAt=bootstrap.indexOf("'./src/v29EndpointAliasPatch.js'");
const serverAt=bootstrap.indexOf("'./server.js'");
assert.ok(routeOwnerAt>=0&&serverAt>routeOwnerAt,'V505 route ownership must install before server.js');

const purge=read('src/dataPurge.js');
assert.match(purge,/detached\s*:\s*true/);
assert.match(purge,/child\.unref\(\)/);
assert.match(purge,/PURGE_STATUS_PUBLIC_DIR='purge-status'/);
assert.match(purge,/runPurgePreparationWorker/);
assert.match(purge,/strictRunLocks:true/);
assert.match(purge,/sameFingerprint\(challenge\.sourceFingerprint,currentFingerprint\)/,'delete must compare the original verified-backup DB+WAL fingerprint');
assert.match(purge,/if\(workerAlive\)[\s\S]*?return pendingPurgePayload/,'stale heartbeat must not retire a live/unknown prepare worker');

const coordinator=read('src/v505PurgeCoordinator.js');
assert.match(coordinator,/inspectLivePrepareJob/);
assert.match(coordinator,/if\(alive===false\)return \{dead:true,job,file\}/);
assert.match(coordinator,/queuePurgeExecution/);
assert.match(coordinator,/assertNoActiveExportJobs\(\)/);
assert.doesNotMatch(coordinator,/resealPurgeChallenge/);
assert.doesNotMatch(coordinator,/setPurgeBlock/);
assert.match(coordinator,/detached:true/);
assert.match(coordinator,/child\.unref\(\)/);
assert.match(coordinator,/保留已验证备份的安全锁/);

const globalGuard=read('src/v505PurgeGlobalGuard.js');
assert.match(globalGuard,/SUBMISSION_MUTEX_FILE='\.purge_global_submission\.lock\.json'/);
assert.match(globalGuard,/fs\.openSync\(file,'wx',0o600\)/);
assert.match(globalGuard,/DATA_PURGE_OWNED_BY_ANOTHER_ADMIN/);
assert.match(globalGuard,/DATA_PURGE_SUBMISSION_BUSY/);
assert.match(globalGuard,/DATA_PURGE_GLOBAL_LOCK_ORPHANED/);
assert.match(globalGuard,/processInstanceToken/);
assert.doesNotMatch(globalGuard,/data_purge_submission_mutex/);

const freeze=read('src/v505PurgeWriteFreezeGuard.js');
assert.match(freeze,/v8-submission-safe/);
assert.match(freeze,/SAFE_READ_APIS/);
assert.match(freeze,/inspectExternalPurgeWriteFreeze/);
assert.match(freeze,/if\(alive!==false\)/);
assert.match(freeze,/group\.kind==='PREPARE'&&status==='SUCCEEDED'/);
assert.match(freeze,/req\.v505PurgeReadOnlyAuth=true/);
assert.match(freeze,/queryOnlyRequired/,'query-only policy must distinguish the pre-job atomic submission handoff');
assert.match(freeze,/if\(state\.sqliteActive\)return true/);
assert.match(freeze,/String\(state\.external\.kind\|\|''\)!=='SUBMISSION'/,'bare submission mutex must not sabotage the owning PREPARE SQLite safety-block write');
assert.match(freeze,/syncPurgeQueryOnly\(protectSharedDb\)/,'shared DB query_only must follow durable purge truth');
assert.doesNotMatch(freeze,/syncPurgeQueryOnly\(false\)/,'active purge control must never explicitly thaw the shared web DB');
assert.doesNotMatch(freeze,/restorePurgeQueryOnlyAfterControl|restoreSealedQueryOnlyAfterControl/,'shared-connection thaw/restore hooks are forbidden');
assert.match(freeze,/PURGE_CONTROL\.test\(pathname\)&&method==='POST'/,'control routes remain reachable while query-only');

const routeOwner=read('src/v29EndpointAliasPatch.js');
assert.match(routeOwner,/inspectPurgeWriteFreezeState/);
assert.match(routeOwner,/syncPurgeQueryOnly\(inspectPurgeWriteFreezeState\(\)\.active\)/,'first PREPARE must immediately mirror queued purge truth onto the web DB before returning');
assert.match(routeOwner,/req\.v505PurgeSubmissionMutexRelease\?\.\(\)/);
assert.match(routeOwner,/v505PurgeGlobalOwnerGuard,v505GuardedPrepareHandler/);
assert.match(routeOwner,/v505PurgeGlobalOwnerGuard,v505GuardedExecuteHandler/);
assert.match(routeOwner,/handlers\.slice\(0,-1\)/,'legacy synchronous handlers must be replaced, not stacked');
assert.ok((routeOwner.match(/previousUse\.call\(this,v505PurgeWriteFreezeGuard\)/g)||[]).length>=2,'purge guard must run before and after authentication');

const access=read('src/accessControl.js');
assert.match(access,/PURGE_STATUS_PATH/);
assert.match(access,/if \(req\.v505PurgeReadOnlyAuth\) return user/,'DB-backed session expiry must not refresh while purge is active');
assert.match(access,/if\(req\.v505PurgeReadOnlyAuth\)return/,'audit writes must be suppressed while purge is active');
assert.doesNotMatch(access,/accessControlCore/);

const external=read('src/v505PurgeExternalActivity.js');
assert.match(external,/V505_EXPORT_SUBMISSION_MUTEX_FILE='\.v505_export_submission\.lock\.json'/);
assert.match(external,/DATA_PURGE_EXPORT_SUBMISSION_BUSY/);
assert.match(external,/DATA_PURGE_EXPORT_ACTIVE/);
assert.match(external,/inspectActiveExportJobs/);

const admission=read('src/v505ExportAdmissionGuard.js');
assert.match(admission,/v505PurgeWriteFreezeGuard,v505ExportAdmissionGuard,\.\.\.handlers/);
assert.match(admission,/beforeAcquire=inspectPurgeWriteFreezeState\(\)/);
assert.match(admission,/afterAcquire=inspectPurgeWriteFreezeState\(\)/);
assert.match(admission,/watchRegisteredJob/);

const sidecarEntry=read('src/v193ExportSidecar.js');
const admissionAt=sidecarEntry.indexOf("'./v505ExportAdmissionGuard.js'");
const v473At=sidecarEntry.indexOf("'./v473ExportSidecar.js'");
assert.ok(admissionAt>=0&&v473At>admissionAt,'V505 export admission must install before V473 route creation');

const ui=read('public/v505-data-purge-recovery.js');
assert.match(ui,/pollBackgroundJob/);
assert.match(ui,/finishExistingExecution/);
assert.match(ui,/credentials:'same-origin'/);
assert.match(ui,/__CE_QC_V105_ASYNC_PURGE_UI__/);
assert.match(ui,/owner:'V505'/);
assert.match(ui,/不会解除任务锁，也不会启动第二个任务/);
assert.equal((ui.match(/\/api\/admin\/data-purge\/prepare/g)||[]).length,2);
assert.match(ui,/\/api\/admin\/data-purge\/execute/);

const legacyUi=read('public/v104-fast-purge-ui.js');
assert.match(legacyUi,/if\(global\.__CE_QC_V105_ASYNC_PURGE_UI__\)return/);
assert.match(legacyUi,/后台任务提交响应延迟/);
const legacyGuard=read('public/v106-purge-legacy-controls-hide.js');
assert.match(legacyGuard,/__CE_QC_V505_DATA_PURGE_RECOVERY__/);
assert.match(legacyGuard,/reassertV505Owner/);

const happy=read('test/data-purge-large-backup.test.js');
assert.doesNotMatch(happy,/resealPurgeChallenge/);
assert.match(happy,/PUBLIC_STATUS_PRIVATE_KEYS/);
const coordinatorTest=read('test/v505-purge-coordinator.test.js');
assert.match(coordinatorTest,/PUBLIC_STATUS_PRIVATE_KEYS/);
const freezeTest=read('test/v505-purge-write-freeze.test.js');
assert.match(freezeTest,/bare submission mutex must not switch the process-global DB read-only/);
assert.match(freezeTest,/must never create a shared writable window/);
assert.match(freezeTest,/concurrent main-process write must remain impossible/);
assert.match(freezeTest,/main DB returns to writable mode only after no sealed\/active purge truth remains/);
const authTest=read('test/v505-purge-auth-readonly.test.js');
assert.match(authTest,/session expiry must not be refreshed during purge freeze/);
assert.match(authTest,/audit write must be suppressed/);
const externalTest=read('test/v505-purge-external-activity.test.js');
assert.match(externalTest,/live worker PID stays authoritative/);
assert.match(externalTest,/DATA_PURGE_EXPORT_SUBMISSION_BUSY/);
const fingerprintTest=read('test/v505-purge-fingerprint-failclosed.test.js');
assert.match(fingerprintTest,/changed-after-backup/);
assert.match(fingerprintTest,/destructive reset must not have committed/);

console.log('[CE-QC][V505_PURGE_ASYNC_SMOKE] pass · detached prepare/execute · no shared DB thaw · submission race safe · auth/read/export handshakes fail closed');
