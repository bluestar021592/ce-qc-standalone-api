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

test('V130 submit response never relies on abort and recent jobs are recoverable',()=>{
  const backend=read('src/v105AsyncPurgePatch.js');
  const ui=read('public/v104-fast-purge-ui.js');
  syntax('src/v105AsyncPurgePatch.js');
  syntax('public/v104-fast-purge-ui.js');
  assert.match(backend,/v130-purge-job-recovery-v1/);
  assert.match(backend,/RECOVER_STATUS_PATH/);
  assert.match(backend,/function recentJobFor/);
  assert.match(backend,/activeJobFor\(owner, kind\) \|\| recentJobFor\(owner, kind\)/);
  assert.match(ui,/v130-resilient-purge-submit-v4/);
  assert.match(ui,/function abortLike/);
  assert.match(ui,/signal is aborted\|aborted without reason/);
  assert.match(ui,/Promise\.race\(\[submitPromise,recoveryPromise\]\)/);
  assert.match(ui,/recoverRecentJob/);
  assert.match(ui,/后台任务提交响应延迟/);
});

test('destructive phase is short and does not run whole-database post checks',()=>{
  const purge=read('src/dataPurge.js');
  const execute=purge.slice(purge.indexOf('export async function executePurge'),purge.indexOf('export function getPurgeCounts'));
  assert.doesNotMatch(execute,/tableCounts\(db\)/);
  assert.match(purge,/PRAGMA foreign_keys=OFF/);
  assert.match(purge,/PRAGMA foreign_keys=ON/);
  assert.match(purge,/FAST_TABLE_DELETE_FK_GUARDED/);
  assert.match(purge,/assertPurgeStructure/);
  assert.doesNotMatch(purge,/assertQuickIntegrity\(db\)/);
  assert.doesNotMatch(purge,/wal_checkpoint\(TRUNCATE\)/);
  assert.match(purge,/walCheckpoint:'AUTO'/);
  assert.match(purge,/await clearRegenerableFiles\(\)/);
});

test('V130 data-management lazy load uses fresh purge UI cache key',()=>{
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
