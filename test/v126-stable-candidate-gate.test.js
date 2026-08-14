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
    'src/v44WhppUiPatch.js','src/v132WhppFastIntegrationPatch.js','src/v133ClosureRatePatch.js','src/v134WhppRunSupervisorPatch.js',
    'scripts/CE_QC_PreUpdate_Backup.mjs','scripts/CE_QC_PurgeDeleteWorker.mjs',
    'public/v125-local-api-resilience.js','public/v104-fast-purge-ui.js',
    'public/v108-route-lazy-features.js','public/v105-fast-render.js',
    'public/v103-home-whpp-card-guard.js','public/v132-whpp-seven-business-fast.js','public/v133-closure-rate.js'
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

test('V127 update backup is visible reusable read-only and still verified',()=>{
  const backup=read('scripts/CE_QC_PreUpdate_Backup.mjs');
  assert.match(backup,/console\.error\(`\[BACKUP \$\{step\}\] \$\{text\}`\)/);
  assert.match(backup,/CE_QC_UPDATE_BACKUP_RATE_PAGES\|\|8192/);
  assert.match(backup,/findReusableBackup\(fingerprintBefore\)/);
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

test('V132 makes WHPP fast and refuses false seven-business completion',()=>{
  const backend=read('src/v132WhppFastIntegrationPatch.js');
  const ui=read('public/v132-whpp-seven-business-fast.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(backend,/v132-whpp-fast-summary-v1/);
  assert.match(backend,/\/api\/v132\/whpp-fast-summary/);
  assert.match(backend,/business_history_summary/);
  assert.match(backend,/CACHE_MS/);
  assert.match(ui,/v132-whpp-seven-business-fast-v2/);
  assert.match(ui,/ensureWhppCompleted/);
  assert.match(ui,/WHPP最终快照已验证/);
  assert.match(ui,/系统不会把它误报为七业务处理完成/);
  assert.match(ui,/global\.runUnified=\(\)=>runSeven\('start'\)/);
  assert.match(ui,/global\.resumeUnified=\(\)=>runSeven\('resume'\)/);
  assert.match(injector,/v134-whpp-run-supervisor-v21/);
  assert.match(injector,/v132-whpp-seven-business-fast\.js\?v=20260814-1/);
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

test('V134 supervises WHPP asynchronously and recovers stale persisted running state',()=>{
  const supervisor=read('src/v134WhppRunSupervisorPatch.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(supervisor,/v134-whpp-run-supervisor-v1/);
  assert.match(supervisor,/res\.status\(202\)\.json/);
  assert.match(supervisor,/runtimePromise/);
  assert.match(supervisor,/runtimeActive/);
  assert.match(supervisor,/const stale = Boolean\(persisted\.running && !runtimeActive\)/);
  assert.match(supervisor,/phase: 'WHPP等待断点恢复'/);
  assert.match(supervisor,/WHPP_REQUEST_TIMEOUT_MS \|\| 20_000/);
  assert.match(supervisor,/client\.http\.defaults\.timeout = WHPP_REQUEST_TIMEOUT_MS/);
  assert.match(supervisor,/delete copy\.rawJson/);
  assert.match(supervisor,/trackResults: \[\]/);
  assert.match(supervisor,/WHPP订单扫描\\s\+\(\\d\+\)-\(\\d\+\)/);
  assert.match(injector,/v134WhppRunSupervisorPatch\.js/);
  assert.match(injector,/v134-whpp-run-supervisor-v21/);
});

test('WHPP total conservation guard remains present after fast render',()=>{
  const guard=read('public/v103-home-whpp-card-guard.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(guard,/WHPP本土/);
  assert.match(guard,/const residual=Math\.max\(0,total-sixTotal\)/);
  assert.ok(injector.indexOf('v105-fast-render.js')<injector.indexOf('v103-home-whpp-card-guard.js'));
  assert.ok(injector.indexOf('v103-home-whpp-card-guard.js')<injector.indexOf('v132-whpp-seven-business-fast.js'));
  assert.ok(injector.indexOf('v132-whpp-seven-business-fast.js')<injector.indexOf('v133-closure-rate.js'));
});
