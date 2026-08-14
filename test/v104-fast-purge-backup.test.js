import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};

test('purge backup stays online verified and count-free before delete',()=>{
  const purge=read('src/dataPurge.js');
  syntax('src/dataPurge.js');
  assert.match(purge,/await backup\(db,filePath,\{rate:1024\}\)/);
  assert.match(purge,/verifyBackupQuick/);
  assert.match(purge,/hashFileStream/);
  assert.match(purge,/backupQuickCheck:'ok'/);
  const prepare=purge.slice(purge.indexOf('export async function createPurgeChallenge'),purge.indexOf('export function resealPurgeChallenge'));
  assert.doesNotMatch(prepare,/tableCounts\(db\)/);
  assert.match(prepare,/counts:null/);
  assert.doesNotMatch(purge,/wal_checkpoint\(FULL\)/);
});

test('V131 sends destructive delete to isolated worker and preserves V130 browser recovery',()=>{
  const backend=read('src/v105AsyncPurgePatch.js');
  const worker=read('scripts/CE_QC_PurgeDeleteWorker.mjs');
  const ui=read('public/v104-fast-purge-ui.js');
  syntax('src/v105AsyncPurgePatch.js');
  syntax('scripts/CE_QC_PurgeDeleteWorker.mjs');
  syntax('public/v104-fast-purge-ui.js');
  assert.match(backend,/v131-isolated-purge-worker-v1/);
  assert.match(backend,/PURGE_WORKER_FILE/);
  assert.match(backend,/spawn\(process\.execPath,\[PURGE_WORKER_FILE,payload\]/);
  assert.match(backend,/runIsolatedExecute/);
  assert.match(backend,/RECOVER_STATUS_PATH/);
  assert.match(worker,/ISOLATED_SQLITE_WORKER/);
  assert.match(worker,/BEGIN IMMEDIATE/);
  assert.match(worker,/BUSINESS_DATA_TABLES/);
  assert.match(ui,/v130-resilient-purge-submit-v4/);
  assert.match(ui,/recoverRecentJob/);
  assert.match(ui,/Promise\.race\(\[submitPromise,recoveryPromise\]\)/);
  assert.match(ui,/后台任务提交响应延迟/);
});

test('isolated worker keeps destructive phase out of web event loop and avoids whole-database post scans',()=>{
  const worker=read('scripts/CE_QC_PurgeDeleteWorker.mjs');
  assert.match(worker,/PRAGMA foreign_keys=OFF/);
  assert.match(worker,/PRAGMA foreign_keys=ON/);
  assert.match(worker,/DELETE FROM \$\{table\}/);
  assert.match(worker,/SELECT 1 AS present FROM \$\{table\} LIMIT 1/);
  assert.match(worker,/PURGE_WORKER_FOREIGN_KEYS_NOT_RESTORED/);
  assert.match(worker,/clearRegenerableFiles/);
  assert.doesNotMatch(worker,/PRAGMA integrity_check|wal_checkpoint\(TRUNCATE\)/);
});

test('V130 browser asset remains fresh and compatible with V131 backend',()=>{
  const lazy=read('public/v108-route-lazy-features.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(lazy,/v108-route-lazy-features-v8/);
  assert.match(lazy,/v104-fast-purge-ui\.js\?v=20260814-8/);
  assert.match(injector,/v130-responsive-performance-spine-v18/);
  assert.match(injector,/v108-route-lazy-features\.js\?v=20260814-8/);
  assert.doesNotMatch(injector,/v104-fast-purge-ui\.js/);
});

test('versioned browser assets stay cached and 2GiB durability remains opt-in',()=>{
  const assets=read('src/v89StaticAssetCachePatch.js');
  const large=read('test/data-purge-large-backup.test.js');
  assert.match(assets,/max-age=86400/);
  assert.match(large,/CE_QC_RUN_LARGE_DURABILITY/);
  assert.match(large,/skip: !RUN_LARGE_DURABILITY/);
});
