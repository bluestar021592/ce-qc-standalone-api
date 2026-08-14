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
    'public/v105-fast-render.js','public/v103-home-whpp-card-guard.js'
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

test('V127 update backup is visible reusable and still verified',()=>{
  const backup=read('scripts/CE_QC_PreUpdate_Backup.mjs');
  assert.match(backup,/console\.error\(`\[BACKUP \$\{step\}\] \$\{text\}`\)/);
  assert.match(backup,/CE_QC_UPDATE_BACKUP_RATE_PAGES\|\|8192/);
  assert.match(backup,/findReusableBackup\(fingerprintBefore\)/);
  assert.match(backup,/exact-source-fingerprint\+verified-backup-reuse/);
  assert.match(backup,/SQLite backup \$\{remainingPages===0\?100:pct\}%/);
  assert.match(backup,/SHA-256 \$\{processed>=total\?100:pct\}%/);
  assert.match(backup,/PRAGMA quick_check\(1\)/);
  assert.match(backup,/validSha\(manifest\.sha256\)/);
  assert.match(backup,/SOURCE_CHANGED_DURING_UPDATE_BACKUP/);
  assert.doesNotMatch(backup,/readFileSync\(copyFile\)/);
});

test('purge remains backup-first and non-destructive outside business tables',()=>{
  const purge=read('src/dataPurge.js');
  const asyncPatch=read('src/v105AsyncPurgePatch.js');
  assert.match(purge,/createVerifiedPreClearBackup/);
  assert.match(purge,/verifyPreparedBackupStillPresent/);
  assert.match(purge,/await backup\(db,filePath,\{rate:1024\}\)/);
  assert.match(purge,/backupQuickCheck:'ok'/);
  assert.match(purge,/hashFileStream/);
  assert.match(purge,/export function resealPurgeChallenge/);
  assert.match(purge,/sourceSeal='POST_PREPARE_AUDIT'/);
  assert.match(purge,/DELETE_CHANGESET_EXACT/);
  assert.doesNotMatch(purge,/reset\s+--hard/i);
  assert.match(asyncPatch,/v124-post-audit-purge-seal-v1/);
  assert.match(asyncPatch,/resealPurgeChallenge/);
});

test('managed launcher stays fast-forward only and owns backend lifetime',()=>{
  const cmd=read('Start_CE_QC.cmd');
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(cmd,/CE_QC_Managed_Launcher\.ps1/);
  assert.match(launcher,/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(launcher,/pull','--ff-only/);
  assert.match(launcher,/CE_QC_PreUpdate_Backup\.mjs/);
  assert.doesNotMatch(launcher,/reset\s+--hard/i);
});

test('WHPP total conservation guard remains present after fast render',()=>{
  const guard=read('public/v103-home-whpp-card-guard.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(guard,/WHPP本土/);
  assert.match(guard,/const residual=Math\.max\(0,total-sixTotal\)/);
  assert.ok(injector.indexOf('v105-fast-render.js')<injector.indexOf('v103-home-whpp-card-guard.js'));
});
