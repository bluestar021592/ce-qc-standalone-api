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

test('desktop update candidate validates and backs up with candidate tool before fast-forward install',()=>{
  const cmd=read('Start_CE_QC.cmd');
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(cmd,/CE_QC_Managed_Launcher\.ps1/);
  assert.match(launcher,/Test-RemoteCandidate/);
  assert.match(launcher,/candidateBackup = Join-Path \$tempRoot 'scripts\\CE_QC_PreUpdate_Backup\.mjs'/);
  assert.match(launcher,/CE_QC_BACKUP_PROJECT_ROOT = \$ProjectRoot/);
  assert.match(launcher,/Candidate tests passed\. Creating verified SQLite online backup before code switch/);
  const backup=launcher.indexOf("$candidateBackup = Join-Path $tempRoot 'scripts\\CE_QC_PreUpdate_Backup.mjs'");
  const pull=launcher.indexOf("@('pull','--ff-only'");
  assert.ok(backup>=0&&pull>backup);
  assert.doesNotMatch(launcher,/\$backupScript = Join-Path \$ProjectRoot 'scripts\\CE_QC_PreUpdate_Backup\.mjs'/);
  assert.doesNotMatch(launcher,/reset\s+--hard/i);
  syntax('bootstrap.js');
  syntax('scripts/CE_QC_PreUpdate_Backup.mjs');
});

test('normal startup serves first paint before optional historical maintenance',()=>{
  const bootstrap=read('bootstrap.js');
  const server=bootstrap.indexOf("await importPhase('server', './server.js')");
  const interactive=bootstrap.indexOf('await importServerInteractiveFirst()');
  const maintenance=bootstrap.indexOf('scheduleDeferredMaintenance({ v92, v76Repair })');
  assert.ok(server>=0&&interactive>=0&&maintenance>interactive);
  assert.match(bootstrap,/background maintenance disabled on normal startup/);
});

test('purge remains backup-first and browser receives V131 queued isolated-worker lifecycle',()=>{
  const purge=read('src/dataPurge.js');
  const asyncPatch=read('src/v105AsyncPurgePatch.js');
  const ui=read('public/v104-fast-purge-ui.js');
  const lazy=read('public/v108-route-lazy-features.js');
  syntax('src/dataPurge.js');
  syntax('src/v105AsyncPurgePatch.js');
  syntax('public/v104-fast-purge-ui.js');
  assert.match(purge,/createVerifiedPreClearBackup/);
  assert.match(purge,/verifyPreparedBackupStillPresent/);
  assert.match(asyncPatch,/PREPARE_PATH = '\/api\/admin\/data-purge\/prepare'/);
  assert.match(asyncPatch,/EXECUTE_PATH = '\/api\/admin\/data-purge\/execute'/);
  assert.match(asyncPatch,/JOB_START_DELAY_MS/);
  assert.match(asyncPatch,/setTimeout\(async \(\) =>/);
  assert.match(asyncPatch,/runIsolatedExecute\(req,job\)/);
  assert.match(asyncPatch,/res\.status\(202\)\.json/);
  assert.match(ui,/安全备份正在后台执行/);
  assert.match(ui,/自动清空业务数据，无需再次点击/);
  assert.match(lazy,/data:\['\/v104-fast-purge-ui\.js\?v=20260814-8'/);
});

test('visible-page rendering and request coalescing stay enabled',()=>{
  const render=read('public/v105-fast-render.js');
  const requests=read('public/v65-request-coalescing.js');
  syntax('public/v105-fast-render.js');
  syntax('public/v65-request-coalescing.js');
  assert.match(render,/if\(page==='home'\)call\('renderHome'\)/);
  assert.match(render,/requestIdleCallback/);
  assert.match(requests,/Map\(/);
});

test('large exports stay detached and identical export requests are reused',()=>{
  const source=read('src/v84AsyncExportPatch.js');
  syntax('src/v84AsyncExportPatch.js');
  assert.match(source,/detached: true/);
  assert.match(source,/payloadKey/);
  assert.match(source,/reusableJob/);
  assert.match(source,/reused: 'COMPLETED'/);
});

test('WHPP source truth protections stay present and route-lazy current assets are wired',()=>{
  const source=read('public/v89-fast-dashboard.js');
  const injector=read('src/v44WhppUiPatch.js');
  const lazy=read('public/v108-route-lazy-features.js');
  syntax('public/v89-fast-dashboard.js');
  assert.match(source,/strictWhppValue/);
  assert.match(source,/const whppValue = strict !== null/);
  assert.ok(injector.indexOf('v105-fast-render.js')<injector.indexOf('v103-home-whpp-card-guard.js'));
  assert.match(injector,/v108-route-lazy-features\.js\?v=20260818-v195-1/);
  assert.match(lazy,/v104-fast-purge-ui\.js\?v=20260814-8/);
});

test('static assets use browser cache while HTML remains version-controlled by the injector',()=>{
  const source=read('src/v89StaticAssetCachePatch.js');
  syntax('src/v89StaticAssetCachePatch.js');
  assert.match(source,/max-age=86400/);
  assert.match(source,/stale-while-revalidate=604800/);
});
