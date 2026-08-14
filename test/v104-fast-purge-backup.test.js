import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const relative='src/dataPurge.js';
const source=fs.readFileSync(path.join(root,relative),'utf8');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('full purge pre-clear backup uses SQLite online backup instead of blocking file copy',()=>{
  const syntax=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/import \{ backup, DatabaseSync \} from 'node:sqlite'/);
  assert.match(source,/await backup\(db,filePath,\{rate:1024\}\)/);
  assert.match(source,/method:'node-sqlite-online-backup'/);
  assert.doesNotMatch(source,/wal_checkpoint\(FULL\)/);
  assert.doesNotMatch(source,/promises\.copyFile\(cfg\.dbFile, filePath\)/);
});

test('purge prepare skips full business-table counts and validates the recovery copy',()=>{
  assert.match(source,/function verifyBackupQuick\(filePath\)/);
  assert.match(source,/PRAGMA quick_check\(1\)/);
  assert.doesNotMatch(source,/PRAGMA integrity_check/);
  const prepareStart=source.indexOf('export async function createPurgeChallenge');
  const prepareEnd=source.indexOf('export async function executePurge',prepareStart);
  const prepare=source.slice(prepareStart,prepareEnd);
  assert.doesNotMatch(prepare,/tableCounts\(db\)/);
  assert.match(prepare,/createVerifiedPreClearBackup\(user\.email\|\|''\)/);
  assert.match(prepare,/counts:null/);
  assert.match(prepare,/DEFERRED_TO_TRANSACTIONAL_DELETE/);
});

test('five-second confirmation reuses already verified backup without another whole-file hash or integrity scan',()=>{
  const start=source.indexOf('function verifyPreparedBackupStillPresent');
  const end=source.indexOf('function statFingerprint',start);
  assert.ok(start>=0&&end>start);
  const fn=source.slice(start,end);
  assert.match(fn,/stat\.size/);
  assert.match(fn,/mtimeMs/);
  assert.match(fn,/\['ok','quick-ok'\]/);
  assert.doesNotMatch(fn,/hashFileStream|DatabaseSync|integrity_check/);
});

test('purge backup keeps SHA-256 quick-check and source-stability evidence',()=>{
  assert.match(source,/const sha256=await hashFileStream\(filePath\)/);
  assert.match(source,/sourceQuickCheck:'deferred-to-verified-copy'/);
  assert.match(source,/backupQuickCheck:'ok'/);
  assert.match(source,/sourceFingerprintBeforeBackup/);
  assert.match(source,/sourceFingerprintAfterBackup/);
  assert.match(source,/sourceStableDuringBackup:true/);
  assert.match(source,/verificationMode:'online-backup\+stable-source-fingerprint\+backup-quick-check\+sha256'/);
  assert.match(source,/recordBackup\(/);
});

test('transactional fast delete returns exact before counts without pre-scanning',()=>{
  const executeStart=source.indexOf('export async function executePurge');
  const executeEnd=source.indexOf('export function getPurgeCounts',executeStart);
  const execute=source.slice(executeStart,executeEnd);
  assert.doesNotMatch(execute,/tableCounts\(db\)/);
  assert.match(execute,/const reset=fastResetBusinessState/);
  assert.match(execute,/countSource:PURGE_EXECUTE_COUNT_MODE/);
  assert.match(source,/DELETE_CHANGESET_EXACT/);
  assert.match(source,/before\[table\]=Number\(deleted\?\.changes\|\|0\)/);
  assert.match(source,/if\(remaining!==0\)throw new Error/);
  assert.match(source,/return \{before,after\}/);
  assert.match(source,/export function getPurgeCounts\(\)\{return tableCounts\(getDb\(\)\);\}/);
});

test('database changes after the verified backup abort purge instead of deleting unbacked rows',()=>{
  assert.match(source,/if\(!sameFingerprint\(challenge\.sourceFingerprint,currentFingerprint\)\)/);
  assert.match(source,/clearPurgeBlock\(db\)/);
  assert.match(source,/数据库在安全备份后发生变化，已停止清除/);
  assert.doesNotMatch(source,/RECOUNT_AFTER_DATABASE_CHANGE/);
});

test('dead dashboard-cache worker lease is cleared immediately instead of delaying purge for fifteen minutes',()=>{
  assert.match(source,/function pidIsAlive\(pid\)/);
  assert.match(source,/process\.kill\(pid,0\)/);
  assert.match(source,/owner\.match\(\/\^\(\\d\+\)-\//);
  assert.match(source,/DELETE FROM app_meta WHERE key IN \(\?,\?\)/);
  assert.match(source,/timeoutMs=5\*60_000/);
  assert.doesNotMatch(source,/timeoutMs = 15 \* 60_000/);
});

test('one-click purge backgrounds both backup and execution without a second user action',()=>{
  const backend=read('src/v105AsyncPurgePatch.js');
  const uiRelative='public/v104-fast-purge-ui.js';
  const ui=read(uiRelative);
  for(const file of ['src/v105AsyncPurgePatch.js',uiRelative]){
    const syntax=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
    assert.equal(syntax.status,0,`${file}: ${syntax.stderr||syntax.stdout}`);
  }
  assert.match(backend,/PREPARE_PATH = '\/api\/admin\/data-purge\/prepare'/);
  assert.match(backend,/EXECUTE_PATH = '\/api\/admin\/data-purge\/execute'/);
  assert.match(backend,/setImmediate\(async \(\) =>/);
  assert.match(backend,/runLegacyHandler\(legacyHandler, req\)/);
  assert.match(backend,/v122-single-flight-purge-jobs-v1/);
  assert.match(ui,/v123-adaptive-purge-ui-v2/);
  assert.match(ui,/executeChallengeAutomatically\(challenge,preview\)/);
  assert.match(ui,/安全倒计时 \$\{remaining\} 秒后自动清空业务数据，无需再次点击/);
  assert.match(ui,/phrase:'永久清除全部业务数据'/);
  assert.match(ui,/backupConfirmed:true/);
  assert.match(ui,/pollJob\(submitted\.pollUrl,preview,'EXECUTE'\)/);
  assert.match(ui,/applyCompletedPurge\(result\)/);
  assert.doesNotMatch(ui,/大型数据库可能需要几分钟/);
  const lazy=read('public/v108-route-lazy-features.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(lazy,/v104-fast-purge-ui\.js\?v=20260814-6/);
  assert.match(injector,/v108-route-lazy-features\.js\?v=20260814-6/);
  assert.match(injector,/v105-fast-render\.js\?v=20260814-2/);
  assert.doesNotMatch(injector,/v104-fast-purge-ui\.js/);
  assert.ok(injector.indexOf('v105-fast-render.js')<injector.indexOf('v103-home-whpp-card-guard.js'));
});

test('visible page render avoids hidden-page work on every refresh',()=>{
  const render=read('public/v105-fast-render.js');
  const syntax=spawnSync(process.execPath,['--check',path.join(root,'public/v105-fast-render.js')],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(render,/pageNow=.*currentPage/);
  assert.match(render,/if\(page==='home'\)call\('renderHome'\)/);
  assert.match(render,/else if\(page==='import'\)/);
  assert.match(render,/requestIdleCallback/);
});

test('drilldown range and identical exports are reused instead of recomputed',()=>{
  const drill=read('src/v55DashboardReconciliationPatch.js');
  const exp=read('src/v84AsyncExportPatch.js');
  assert.match(drill,/const rangeCache=new Map\(\)/);
  assert.match(drill,/function cachedRange\(fromDate,toDate\)/);
  assert.match(exp,/function payloadKey\(payload\)/);
  assert.match(exp,/function reusableJob\(key, requester/);
  assert.match(exp,/reused: 'COMPLETED'/);
});

test('versioned browser assets are cached and 2GiB durability remains opt-in',()=>{
  const assets=read('src/v89StaticAssetCachePatch.js');
  const large=read('test/data-purge-large-backup.test.js');
  assert.match(assets,/max-age=86400/);
  assert.match(assets,/stale-while-revalidate=604800/);
  assert.match(large,/CE_QC_RUN_LARGE_DURABILITY/);
  assert.match(large,/skip: !RUN_LARGE_DURABILITY/);
});