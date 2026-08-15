import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{
  const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});
  assert.equal(result.status,0,`${p}: ${result.stderr||result.stdout}`);
};

test('candidate runtime files are syntax valid',()=>{
  for(const file of [
    'bootstrap.js','server.js','src/dataPurge.js','src/v105AsyncPurgePatch.js',
    'src/v44WhppUiPatch.js','src/v132WhppFastIntegrationPatch.js','src/v133ClosureRatePatch.js','src/v134WhppRunSupervisorPatch.js','src/v135WhppPartialSnapshotPatch.js',
    'scripts/CE_QC_PreUpdate_Backup.mjs','scripts/CE_QC_PurgeDeleteWorker.mjs',
    'public/v125-local-api-resilience.js','public/v104-fast-purge-ui.js',
    'public/v108-route-lazy-features.js','public/v105-fast-render.js','public/v67-resilient-run-guard.js',
    'public/v103-home-whpp-card-guard.js','public/v132-whpp-seven-business-fast.js','public/v135-whpp-retry-aware-run.js','public/v133-closure-rate.js'
  ]) syntax(file);
});

test('V125 keeps local reads resilient without retrying writes',()=>{
  const resilience=read('public/v125-local-api-resilience.js');
  const injector=read('src/v44WhppUiPatch.js');
  const bootstrap=read('bootstrap.js');
  assert.match(resilience,/v125-local-api-resilience-v1/);
  assert.match(resilience,/\['GET','HEAD'\]\.includes\(method\)/);
  assert.match(resilience,/RETRY_DELAYS=\[250,800,1600\]/);
  assert.match(resilience,/const attempts=2/);
  assert.match(resilience,/lastSuccessfulApiAt<15_000/);
  assert.doesNotMatch(resilience,/\['POST','PUT','PATCH','DELETE'\]/);
  assert.match(injector,/v125-local-api-resilience\.js\?v=20260814-1/);
  assert.ok(injector.indexOf('v65-request-coalescing.js')<injector.indexOf('v125-local-api-resilience.js'));
  assert.ok(injector.indexOf('v125-local-api-resilience.js')<injector.indexOf('v67-resilient-run-guard.js'));
  assert.match(bootstrap,/DASHBOARD_CACHE_STARTUP_DELAY_MS/);
  assert.match(bootstrap,/120000/);
  assert.match(bootstrap,/importServerInteractiveFirst/);
});

test('update backup is visible reusable read-only and skips full copy only for low-risk code with recent verified backup',()=>{
  const backup=read('scripts/CE_QC_PreUpdate_Backup.mjs');
  assert.match(backup,/console\.error\(`\[BACKUP \$\{step\}\] \$\{text\}`\)/);
  assert.match(backup,/CE_QC_UPDATE_BACKUP_RATE_PAGES\|\|8192/);
  assert.match(backup,/findReusableBackup\(fingerprintBefore\)/);
  assert.match(backup,/findRecentVerifiedBackup/);
  assert.match(backup,/classifyUpdate\(changedFiles\(\)\)/);
  assert.match(backup,/LOW_RISK_UPDATE_RECENT_VERIFIED_BACKUP/);
  assert.match(backup,/High-risk update touches persistent-data code/);
  assert.match(backup,/\.\*store\\\.js/);
  assert.match(backup,/exact-source-fingerprint\+verified-backup-reuse/);
  assert.match(backup,/SQLite backup \$\{remainingPages===0\?100:pct\}%/);
  assert.match(backup,/SHA-256 \$\{processed>=total\?100:pct\}%/);
  assert.match(backup,/new DatabaseSync\(dbFile,\{readOnly:true,timeout:10000\}\)/);
  assert.match(backup,/PRAGMA query_only=ON/);
  assert.match(backup,/PRAGMA quick_check\(1\)/);
  assert.match(backup,/validSha\(manifest\.sha256\)/);
  assert.match(backup,/SOURCE_CHANGED_DURING_UPDATE_BACKUP/);
  assert.match(backup,/sourceOpenMode:'read-only'/);
  assert.doesNotMatch(backup,/readFileSync\(copyFile\)/);
});

test('V131 executes destructive purge in isolated sqlite worker while API stays responsive',()=>{
  const patch=read('src/v105AsyncPurgePatch.js');
  const worker=read('scripts/CE_QC_PurgeDeleteWorker.mjs');
  const ui=read('public/v104-fast-purge-ui.js');
  assert.match(patch,/v131-isolated-purge-worker-v1/);
  assert.match(patch,/PURGE_WORKER_FILE/);
  assert.match(patch,/spawn\(process\.execPath,\[PURGE_WORKER_FILE,payload\]/);
  assert.match(patch,/if\(kind==='EXECUTE'\)result=await runIsolatedExecute\(req,job\)/);
  assert.match(patch,/preparedChallenges/);
  assert.match(patch,/rememberPreparedChallenge/);
  assert.match(patch,/verifyPreparedForWorker/);
  assert.match(patch,/DATA_PURGE_WORKER_COMPLETED/);
  assert.match(patch,/RECOVER_STATUS_PATH = '\/api\/v105\/data-purge\/recover'/);
  assert.match(patch,/inspectV131PurgeJobs/);
  assert.match(worker,/ISOLATED_SQLITE_WORKER/);
  assert.match(worker,/BEGIN IMMEDIATE/);
  assert.match(worker,/DATABASE_CHANGED_BEFORE_PURGE_WORKER_LOCK/);
  assert.match(worker,/BUSINESS_DATA_TABLES/);
  assert.match(worker,/DELETE FROM \$\{table\}/);
  assert.match(worker,/data_purge_block_until/);
  assert.match(worker,/PURGE_WORKER_FOREIGN_KEYS_NOT_RESTORED/);
  assert.match(worker,/clearRegenerableFiles/);
  assert.match(ui,/v130-resilient-purge-submit-v4/);
  assert.match(ui,/recoverRecentJob/);
  assert.match(ui,/Promise\.race\(\[submitPromise,recoveryPromise\]\)/);
});

test('purge preparation remains backup-first and legacy direct path remains safety-valid',()=>{
  const purge=read('src/dataPurge.js');
  assert.match(purge,/createVerifiedPreClearBackup/);
  assert.match(purge,/verifyPreparedBackupStillPresent/);
  assert.match(purge,/await backup\(db,filePath,\{rate:1024\}\)/);
  assert.match(purge,/backupQuickCheck:'ok'/);
  assert.match(purge,/hashFileStream/);
  assert.match(purge,/export function resealPurgeChallenge/);
  assert.match(purge,/sourceSeal='POST_PREPARE_AUDIT'/);
  assert.match(purge,/DELETE_CHANGESET_EXACT/);
  assert.doesNotMatch(purge,/wal_checkpoint\(TRUNCATE\)/);
  assert.doesNotMatch(purge,/reset\s+--hard/i);
});

test('managed launcher stays fast-forward only owns backend lifetime and never recursively removes reused node_modules',()=>{
  const cmd=read('Start_CE_QC.cmd');
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  const pkg=JSON.parse(read('package.json'));
  assert.match(cmd,/CE_QC_Managed_Launcher\.ps1/);
  assert.match(launcher,/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(launcher,/pull','--ff-only/);
  assert.match(launcher,/CE_QC_PreUpdate_Backup\.mjs/);
  assert.match(launcher,/function Remove-JunctionOnly/);
  assert.match(launcher,/ReparsePoint/);
  assert.match(launcher,/rmdir `"\$Path`"/);
  assert.match(launcher,/Candidate temp worktree intentionally retained to protect installed node_modules/);
  assert.doesNotMatch(launcher,/Remove-Item -LiteralPath \(Join-Path \$tempRoot 'node_modules'\) -Force/);
  assert.doesNotMatch(launcher,/reset\s+--hard/i);
  assert.equal(pkg.ceQcUpdateGate,'v129-safe-junction-cleanup');
});

test('WHPP fast summary exposes partial snapshot retry count instead of treating the whole day as missing',()=>{
  const backend=read('src/v132WhppFastIntegrationPatch.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(backend,/v135-whpp-fast-summary-retry-v2/);
  assert.match(backend,/API_PENDING_RETRY/);
  assert.match(backend,/retryPending/);
  assert.match(backend,/COMPLETED_WITH_RETRY/);
  assert.match(backend,/business_history_summary/);
  assert.match(injector,/v136-run-start-unblock-v24/);
  assert.match(injector,/v132-whpp-seven-business-fast\.js\?v=20260814-2/);
  assert.match(injector,/v135-whpp-retry-aware-run\.js\?v=20260815-1/);
  assert.doesNotMatch(injector,/v90-instant-whpp-navigation\.js/);
});

test('V133 adds the same closure-rate definition to home and all seven business boards',()=>{
  const backend=read('src/v133ClosureRatePatch.js');
  const ui=read('public/v133-closure-rate.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(backend,/v133-unified-closure-rate-v2/);
  assert.match(backend,/\/api\/v133\/closure-summary/);
  assert.match(backend,/carryover_open_items/);
  assert.match(backend,/WHPP/);
  assert.match(backend,/businessTotal > 0 && completed \? rate\(closed, businessTotal\) : null/);
  assert.match(backend,/total > 0 && allCompleted \? rate\(closed,total\) : null/);
  assert.match(ui,/v133-unified-closure-rate-v1/);
  assert.match(ui,/闭环率/);
  assert.match(ui,/总闭环率/);
  assert.match(ui,/已闭环 \$\{fmt\(closed\)\} \/ 总票 \$\{fmt\(total\)\}/);
  assert.match(ui,/const closed=Math\.max\(0,total-unresolved\)/);
  assert.match(injector,/v133ClosureRatePatch\.js/);
  assert.match(injector,/v133-closure-rate\.js\?v=20260814-1/);
  assert.ok(injector.indexOf('v132-whpp-seven-business-fast.js')<injector.indexOf('v133-closure-rate.js'));
});

test('V135 finalizes a valid WHPP snapshot even when some API rows remain retryable',()=>{
  const supervisor=read('src/v135WhppPartialSnapshotPatch.js');
  const retryUi=read('public/v135-whpp-retry-aware-run.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(supervisor,/v135-whpp-partial-snapshot-v1/);
  assert.match(supervisor,/WHPP_PARTIAL_API_FAILURE/);
  assert.match(supervisor,/finalizeWhppState\(error\.state\)/);
  assert.match(supervisor,/COMPLETED_WITH_RETRY/);
  assert.match(supervisor,/API.*待重试|接口待重试/);
  assert.match(supervisor,/res\.status\(202\)\.json/);
  assert.match(supervisor,/phase:'WHPP等待断点恢复'/);
  assert.match(retryUi,/v136-whpp-retry-aware-run-v2/);
  assert.match(retryUi,/value\.completed\?'\/api\/whpp\/run\/resume':'\/api\/whpp\/run\/start'/);
  assert.match(retryUi,/retryPending/);
  assert.match(retryUi,/断点已保留/);
  assert.match(injector,/v135WhppPartialSnapshotPatch\.js/);
});

test('V136 starts the current imported day without hanging on slow or stale status preflight',()=>{
  const runner=read('public/v67-resilient-run-guard.js');
  const retryUi=read('public/v135-whpp-retry-aware-run.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(runner,/v136-seven-business-runner-preflight-v1/);
  assert.match(runner,/STATE_PREFLIGHT_TIMEOUT_MS = 4000/);
  assert.match(runner,/controller\.abort\(\)/);
  assert.match(runner,/__stateUnknown/);
  assert.match(runner,/document\.getElementById\('reportDate'\)/);
  assert.match(runner,/const sameTargetDay = !target \|\| date === target/);
  assert.match(runner,/if \(!known \|\| !sameTargetDay\)/);
  assert.match(retryUi,/__CE_QC_V67_RESILIENT_RUN_GUARD__\?\.targetDate/);
  assert.match(retryUi,/document\.getElementById\('reportDate'\)/);
  assert.ok(injector.indexOf('v135-whpp-retry-aware-run.js')<injector.indexOf('v132-whpp-seven-business-fast.js'));
});

test('WHPP total conservation guard remains present after fast render',()=>{
  const guard=read('public/v103-home-whpp-card-guard.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(guard,/WHPP本土/);
  assert.match(guard,/const residual=Math\.max\(0,total-sixTotal\)/);
  assert.ok(injector.indexOf('v105-fast-render.js')<injector.indexOf('v103-home-whpp-card-guard.js'));
  assert.ok(injector.indexOf('v103-home-whpp-card-guard.js')<injector.indexOf('v135-whpp-retry-aware-run.js'));
  assert.ok(injector.indexOf('v135-whpp-retry-aware-run.js')<injector.indexOf('v132-whpp-seven-business-fast.js'));
  assert.ok(injector.indexOf('v132-whpp-seven-business-fast.js')<injector.indexOf('v133-closure-rate.js'));
});
