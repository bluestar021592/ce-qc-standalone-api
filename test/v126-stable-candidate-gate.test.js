import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
    'src/v44WhppUiPatch.js','scripts/CE_QC_PreUpdate_Backup.mjs',
    'public/v125-local-api-resilience.js','public/v104-fast-purge-ui.js',
    'public/v108-route-lazy-features.js','public/v105-fast-render.js',
    'public/v103-home-whpp-card-guard.js'
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

test('V128 purge returns job before destructive work and can recover active job',()=>{
  const patch=read('src/v105AsyncPurgePatch.js');
  const ui=read('public/v104-fast-purge-ui.js');
  const lazy=read('public/v108-route-lazy-features.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(patch,/v128-purge-submit-flush-v1/);
  assert.match(patch,/JOB_START_DELAY_MS/);
  assert.match(patch,/setTimeout\(async \(\) =>/);
  assert.match(patch,/ACTIVE_STATUS_PATH = '\/api\/v105\/data-purge\/active'/);
  assert.match(patch,/activeStatusHandler/);
  assert.match(patch,/pollUrlFor\(job\)/);
  assert.match(patch,/inspectV128PurgeJobs/);
  assert.doesNotMatch(patch,/setImmediate\(async \(\) =>/);
  assert.match(ui,/v128-responsive-purge-ui-v3/);
  assert.match(ui,/submitBackground\('EXECUTE'/);
  assert.match(ui,/recoverActiveJob\(kind\)/);
  assert.match(ui,/后台任务提交响应延迟/);
  assert.match(ui,/directJson\(pollUrl,\{\},5000\)/);
  assert.match(lazy,/v108-route-lazy-features-v7/);
  assert.match(lazy,/v104-fast-purge-ui\.js\?v=20260814-7/);
  assert.match(injector,/v128-responsive-performance-spine-v17/);
  assert.match(injector,/v108-route-lazy-features\.js\?v=20260814-7/);
});

test('purge remains backup-first and destructive phase avoids whole-database post scans',()=>{
  const purge=read('src/dataPurge.js');
  assert.match(purge,/createVerifiedPreClearBackup/);
  assert.match(purge,/verifyPreparedBackupStillPresent/);
  assert.match(purge,/await backup\(db,filePath,\{rate:1024\}\)/);
  assert.match(purge,/backupQuickCheck:'ok'/);
  assert.match(purge,/hashFileStream/);
  assert.match(purge,/export function resealPurgeChallenge/);
  assert.match(purge,/sourceSeal='POST_PREPARE_AUDIT'/);
  assert.match(purge,/DELETE_CHANGESET_EXACT/);
  assert.match(purge,/PRAGMA foreign_keys=OFF/);
  assert.match(purge,/PRAGMA foreign_keys=ON/);
  assert.match(purge,/assertPurgeStructure/);
  assert.match(purge,/integrityCheck:'TRANSACTION_AND_SCHEMA'/);
  assert.match(purge,/walCheckpoint:'AUTO'/);
  assert.match(purge,/FAST_TABLE_DELETE_FK_GUARDED/);
  assert.doesNotMatch(purge,/assertQuickIntegrity\(db\)/);
  assert.doesNotMatch(purge,/wal_checkpoint\(TRUNCATE\)/);
  assert.match(purge,/await clearRegenerableFiles\(\)/);
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

test('WHPP total conservation guard remains present after fast render',()=>{
  const guard=read('public/v103-home-whpp-card-guard.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(guard,/WHPP本土/);
  assert.match(guard,/const residual=Math\.max\(0,total-sixTotal\)/);
  assert.ok(injector.indexOf('v105-fast-render.js')<injector.indexOf('v103-home-whpp-card-guard.js'));
});
