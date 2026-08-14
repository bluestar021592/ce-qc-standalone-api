import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};

test('managed desktop launcher remains safe and non-destructive',()=>{
  const cmd=read('Start_CE_QC.cmd');
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.match(cmd,/CE_QC_Managed_Launcher\.ps1/);
  assert.match(launcher,/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(launcher,/CE_QC_PreUpdate_Backup\.mjs/);
  assert.match(launcher,/pull','--ff-only/);
  assert.doesNotMatch(launcher,/reset\s+--hard/i);
});

test('server bootstrap and fast runtime files are syntax valid',()=>{
  for(const file of ['bootstrap.js','server.js','src/dataPurge.js','src/v105AsyncPurgePatch.js','src/v84AsyncExportPatch.js','src/v84ExportJobWorker.js','src/v55DashboardReconciliationPatch.js','src/v108PerformanceIndexPatch.js','src/v108PerformanceIndexWorker.js','src/v44WhppUiPatch.js','src/v89StaticAssetCachePatch.js','scripts/CE_QC_PreUpdate_Backup.mjs','public/v104-fast-purge-ui.js','public/v105-fast-render.js','public/v103-home-whpp-card-guard.js','public/v65-request-coalescing.js','public/v108-route-lazy-features.js','public/v109-instant-business-navigation.js','public/v110-drilldown-prewarm.js'])syntax(file);
});

test('full purge stays backup first asynchronous and uses fast whole-table reset',()=>{
  const purge=read('src/dataPurge.js');
  const asyncPatch=read('src/v105AsyncPurgePatch.js');
  const ui=read('public/v104-fast-purge-ui.js');
  assert.match(purge,/createVerifiedPreClearBackup/);
  assert.match(purge,/verifyPreparedBackupStillPresent/);
  assert.match(purge,/node-sqlite-online-backup/);
  assert.match(purge,/fastResetBusinessState/);
  assert.match(purge,/DELETE FROM \$\{table\}/);
  assert.doesNotMatch(purge,/LIMIT 50000/);
  assert.match(purge,/idx_v108_unified_batches_valid_date/);
  assert.match(asyncPatch,/setImmediate\(async \(\) =>/);
  assert.match(asyncPatch,/\/api\/v105\/data-purge\/prepare\//);
  assert.match(ui,/安全备份正在后台执行/);
  assert.match(ui,/自动清空业务数据，无需再次点击/);
});

test('page rendering detail reads exports and database reads keep fast paths',()=>{
  const render=read('public/v105-fast-render.js');
  const nav=read('public/v109-instant-business-navigation.js');
  const prewarm=read('public/v110-drilldown-prewarm.js');
  const detail=read('src/v55DashboardReconciliationPatch.js');
  const exp=read('src/v84AsyncExportPatch.js');
  const worker=read('src/v84ExportJobWorker.js');
  const req=read('public/v65-request-coalescing.js');
  const indexes=read('src/v108PerformanceIndexWorker.js');
  const lazy=read('public/v108-route-lazy-features.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(render,/v105VisiblePageRender/);
  assert.match(render,/requestIdleCallback/);
  assert.match(nav,/V109_BOOTSTRAP_SUMMARY/);
  assert.match(nav,/requestIdleCallback/);
  assert.match(nav,/businessStates\?\.\[type\]/);
  assert.match(prewarm,/\/api\/v55\/reconciliation\?from=/);
  assert.match(prewarm,/pointerover/);
  assert.match(prewarm,/TTL=55_000/);
  assert.match(detail,/const rangeCache=new Map\(\)/);
  assert.match(exp,/detached: true/);
  assert.match(exp,/reusableJob/);
  assert.match(worker,/EXPORT_WORKER_CONCURRENCY/);
  assert.match(worker,/Promise\.all/);
  assert.match(worker,/zlib:\{level:1\}/);
  assert.match(req,/const recent = new Map\(\)/);
  assert.match(indexes,/idx_v108_business_final_report_type/);
  assert.match(indexes,/DATA_PURGE_ACTIVE/);
  assert.match(indexes,/LARGE_LEGACY_DB_DEFER_UNTIL_FAST_PURGE/);
  assert.match(lazy,/loadGroup\('reports'\)/);
  assert.match(lazy,/loadGroup\('data'\)/);
  assert.doesNotMatch(lazy,/function warmIdle/);
  assert.match(injector,/v108-route-lazy-features\.js\?v=20260814-3/);
  assert.match(injector,/v109-instant-business-navigation\.js\?v=20260814-1/);
  assert.match(injector,/v110-drilldown-prewarm\.js\?v=20260814-1/);
  assert.doesNotMatch(injector,/v84-async-export-ui\.js/);
  assert.doesNotMatch(injector,/v104-fast-purge-ui\.js/);
});

test('update and purge backups use online copy quick structural verification and sha256',()=>{
  const updateBackup=read('scripts/CE_QC_PreUpdate_Backup.mjs');
  const purge=read('src/dataPurge.js');
  assert.match(updateBackup,/backupQuickCheck:'ok'/);
  assert.match(updateBackup,/verificationMode:'online-backup\+quick-check\+sha256'/);
  assert.doesNotMatch(updateBackup,/PRAGMA integrity_check/);
  assert.match(purge,/verifyBackupQuick/);
  assert.match(purge,/hashFileStream/);
});

test('WHPP total conservation guard remains enabled',()=>{
  const guard=read('public/v103-home-whpp-card-guard.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(guard,/WHPP本土/);
  assert.match(guard,/const residual=Math\.max\(0,total-sixTotal\)/);
  assert.ok(injector.indexOf('v105-fast-render.js')<injector.indexOf('v103-home-whpp-card-guard.js'));
});
