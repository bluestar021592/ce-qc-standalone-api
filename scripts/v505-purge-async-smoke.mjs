import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const syntaxFiles=[
  'src/dataPurge.js',
  'src/v505PurgeCoordinator.js',
  'src/v505PurgeGlobalGuard.js',
  'src/v29EndpointAliasPatch.js',
  'src/accessControl.js',
  'src/accessControlCore.js',
  'scripts/CE_QC_PurgePrepareTaskWorker.mjs',
  'scripts/CE_QC_PurgeExecuteTaskWorker.mjs',
  'public/v104-fast-purge-ui.js',
  'public/v106-purge-legacy-controls-hide.js',
  'public/v505-data-purge-recovery.js'
];
for(const relative of syntaxFiles){
  const result=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(result.status,0,`${relative} syntax check failed: ${result.stderr||result.stdout}`);
}

const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.scripts?.start,'node bootstrap.js','production/local launcher must pass through bootstrap patch ownership');
assert.match(pkg.scripts?.['test:golive']||'',/test\/v505-purge-global-guard\.test\.js/,'cross-admin purge guard regression must be part of go-live');
const bootstrap=read('bootstrap.js');
const routeOwnerImport=bootstrap.indexOf("'./src/v29EndpointAliasPatch.js'");
const serverImport=bootstrap.indexOf("'./server.js'");
assert.ok(routeOwnerImport>=0&&serverImport>=0&&routeOwnerImport<serverImport,'V505 route owner must be installed before server.js registers purge routes');

const purge=read('src/dataPurge.js');
assert.match(purge,/detached\s*:\s*true/);
assert.match(purge,/child\.unref\(\)/);
assert.match(purge,/PURGE_STATUS_PUBLIC_DIR='purge-status'/);
assert.match(purge,/runPurgePreparationWorker/);
assert.match(purge,/PENDING:\$\{String\(job\.jobId/);
assert.match(purge,/crypto\.randomBytes\(24\)\.toString\('hex'\)/);
assert.match(purge,/strictRunLocks:true/);

const prepareWorker=read('scripts/CE_QC_PurgePrepareTaskWorker.mjs');
assert.match(prepareWorker,/runPurgePreparationWorker/);
assert.match(prepareWorker,/delayMs/);

const coordinator=read('src/v505PurgeCoordinator.js');
assert.match(coordinator,/inspectLivePrepareJob/);
assert.match(coordinator,/if\(alive===false\)return \{dead:true,job,file\}/,'only a confirmed dead PID may release the prepare path');
assert.match(coordinator,/系统保持锁定，不会启动第二份备份/);
assert.match(coordinator,/inspectExecutionRecovery/);
assert.match(coordinator,/queuePurgeExecution/);
assert.match(coordinator,/resealPurgeChallenge\(challengeId,user\)/);
assert.match(coordinator,/detached:true/);
assert.match(coordinator,/child\.unref\(\)/);
assert.match(coordinator,/runPurgeExecutionWorker/);
assert.match(coordinator,/DATA_PURGE_IN_PROGRESS/);
assert.match(coordinator,/statusToken=crypto\.randomBytes\(24\)\.toString\('hex'\)/);

const globalGuard=read('src/v505PurgeGlobalGuard.js');
assert.match(globalGuard,/V505_PURGE_GLOBAL_GUARD_ID/);
assert.match(globalGuard,/SUBMISSION_MUTEX_KEY='data_purge_submission_mutex'/);
assert.match(globalGuard,/BEGIN IMMEDIATE/,'global submission ownership must be claimed atomically in SQLite');
assert.match(globalGuard,/processInstanceToken/,'stale mutex cleanup must distinguish process instances from PID reuse');
assert.match(globalGuard,/DATA_PURGE_OWNED_BY_ANOTHER_ADMIN/);
assert.match(globalGuard,/DATA_PURGE_SUBMISSION_BUSY/);
assert.match(globalGuard,/DATA_PURGE_GLOBAL_LOCK_ORPHANED/);
assert.match(globalGuard,/if\(isPrepare&&ownership\.ownProtected\)return next\(\)/,'own prepare recovery must not compete with a long-running backup for a new submit lock');

const executeWorker=read('scripts/CE_QC_PurgeExecuteTaskWorker.mjs');
assert.match(executeWorker,/runPurgeExecutionWorker/);
assert.match(executeWorker,/delayMs/);

const routeOwner=read('src/v29EndpointAliasPatch.js');
assert.match(routeOwner,/v505PurgePrepareHandler/);
assert.match(routeOwner,/v505PurgeExecuteHandler/);
assert.match(routeOwner,/v505PurgeWriteBlockMiddleware/);
assert.match(routeOwner,/v505PurgeGlobalOwnerGuard/);
assert.match(routeOwner,/\/api\/admin\/data-purge\/prepare/);
assert.match(routeOwner,/\/api\/admin\/data-purge\/execute/);
assert.match(routeOwner,/v505PurgeGlobalOwnerGuard,v505PurgePrepareHandler/,'prepare route must pass the global owner guard before the coordinator');
assert.match(routeOwner,/v505PurgeGlobalOwnerGuard,v505PurgeExecuteHandler/,'execute route must pass the global owner guard before the coordinator');
assert.match(routeOwner,/handlers\.slice\(0,-1\)/,'legacy synchronous purge route handler must be replaced, not stacked');

const ui=read('public/v505-data-purge-recovery.js');
assert.match(ui,/pollBackgroundJob/);
assert.match(ui,/finishExistingExecution/);
assert.match(ui,/credentials:'same-origin'/);
assert.doesNotMatch(ui,/credentials:'omit'/);
assert.match(ui,/recoverJobId:job\.jobId/);
assert.match(ui,/后台任务独立执行/);
assert.match(ui,/心跳延迟/);
assert.match(ui,/不会解除任务锁，也不会启动第二个任务/);
assert.match(ui,/__CE_QC_V105_ASYNC_PURGE_UI__/,'V505 must claim the legacy purge sentinel before V104 can overwrite openDataPurge');
assert.match(ui,/owner:'V505'/);
assert.doesNotMatch(ui,/超过20秒没有心跳，已停止前端等待/,'a stale heartbeat alone must never make the UI invite a duplicate purge');
assert.match(ui,/\/api\/admin\/data-purge\/execute/);
assert.equal((ui.match(/\/api\/admin\/data-purge\/prepare/g)||[]).length,2,'UI must POST prepare only for initial submission and final challenge recovery');

const legacyUi=read('public/v104-fast-purge-ui.js');
assert.match(legacyUi,/if\(global\.__CE_QC_V105_ASYNC_PURGE_UI__\)return/,'legacy V104 must honor the V505 compatibility sentinel');
assert.match(legacyUi,/后台任务提交响应延迟/,'regression fixture must identify the legacy stuck-screen owner');
const legacyGuard=read('public/v106-purge-legacy-controls-hide.js');
assert.match(legacyGuard,/__CE_QC_V505_DATA_PURGE_RECOVERY__/);
assert.match(legacyGuard,/reassertV505Owner/);
assert.match(legacyGuard,/window\.openDataPurge=owner/);
assert.match(legacyGuard,/reassertV505Owner\(\);\s*setTimeout\(reassertV505Owner,100\)/);

const access=read('src/accessControl.js');
assert.match(access,/PURGE_STATUS_PATH/);
assert.match(access,/PURGE_PREPARE_AUDITS/);
assert.match(access,/DATA_PURGE_REQUESTED/);
assert.match(access,/DATA_PURGE_BACKUP_VERIFIED/);
assert.match(access,/coreAuditAction/);
const core=read('src/accessControlCore.js');
assert.match(core,/export async function accessIdentity/);
assert.match(core,/export function auditAction/);

const loader=read('public/v502-multidrive-backup-ui.js');
assert.match(loader,/v505-data-purge-recovery\.js\?v=20260910-v505-6/,'fallback loader must bust earlier cached V505 assets');
const lazyLoader=read('public/v108-route-lazy-features.js');
const v505Lazy=lazyLoader.indexOf('/v505-data-purge-recovery.js?v=20260910-v505-6');
const v104Lazy=lazyLoader.indexOf('/v104-fast-purge-ui.js?v=20260814-8');
const v106Lazy=lazyLoader.indexOf('/v106-purge-legacy-controls-hide.js?v=20260814-1');
assert.ok(v505Lazy>=0&&v104Lazy>v505Lazy&&v106Lazy>v104Lazy,'data-management lazy group must load V505 first, then inert V104, then V106 ownership guard');
const gitignore=read('.gitignore');
assert.match(gitignore,/public\/purge-status\//);
console.log('[CE-QC][V505_PURGE_ASYNC_SMOKE] pass');
