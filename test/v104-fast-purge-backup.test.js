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
  assert.match(source,/await backup\(db, filePath, \{ rate: 1024 \}\)/);
  assert.match(source,/method: 'node-sqlite-online-backup'/);
  assert.doesNotMatch(source,/wal_checkpoint\(FULL\)/);
  assert.doesNotMatch(source,/promises\.copyFile\(cfg\.dbFile, filePath\)/);
});

test('purge source is quick-checked once before backup while backup receives the full integrity check',()=>{
  assert.match(source,/PRAGMA quick_check\(1\)/);
  assert.match(source,/verifyBackupIntegrityOnce\(filePath\)/);
  assert.match(source,/PRAGMA integrity_check/);
  assert.doesNotMatch(source,/function assertIntegrity\(/);
  const prepareStart=source.indexOf('export async function createPurgeChallenge');
  const prepareEnd=source.indexOf('export async function executePurge',prepareStart);
  const prepare=source.slice(prepareStart,prepareEnd);
  assert.doesNotMatch(prepare,/assertQuickIntegrity\(db\)/);
  assert.match(prepare,/const counts = tableCounts\(db\)/);
  assert.match(prepare,/createVerifiedPreClearBackup\(user\.email \|\| '', counts\)/);
});

test('five-second confirmation reuses already verified backup without another whole-file hash or integrity scan',()=>{
  const start=source.indexOf('function verifyPreparedBackupStillPresent');
  const end=source.indexOf('function tableCounts',start);
  assert.ok(start>=0&&end>start);
  const fn=source.slice(start,end);
  assert.match(fn,/stat\.size/);
  assert.match(fn,/mtimeMs/);
  assert.match(fn,/backup\.integrity !== 'ok'/);
  assert.doesNotMatch(fn,/hashFileStream|DatabaseSync|integrity_check/);
});

test('purge still keeps a SHA-256 manifest and full backup integrity evidence',()=>{
  assert.match(source,/const sha256 = await hashFileStream\(filePath\)/);
  assert.match(source,/sourceQuickCheck: 'ok'/);
  assert.match(source,/integrity: verified\.integrity/);
  assert.match(source,/recordBackup\(/);
});

test('dead dashboard-cache worker lease is cleared immediately instead of delaying purge for fifteen minutes',()=>{
  assert.match(source,/function pidIsAlive\(pid\)/);
  assert.match(source,/process\.kill\(pid, 0\)/);
  assert.match(source,/owner\.match\(\/\^\(\\d\+\)-\//);
  assert.match(source,/DELETE FROM app_meta WHERE key IN \(\?,\?\)/);
  assert.match(source,/timeoutMs = 5 \* 60_000/);
  assert.doesNotMatch(source,/timeoutMs = 15 \* 60_000/);
});

test('purge dialog backgrounds both backup preparation and destructive execution',()=>{
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
  assert.match(ui,/安全备份正在后台执行/);
  assert.match(ui,/正在后台安全清空业务数据/);
  assert.match(ui,/pollJob\(prepared\.pollUrl,preview,'PREPARE'\)/);
  assert.match(ui,/pollJob\(submitted\.pollUrl,preview,'EXECUTE'\)/);
  assert.match(ui,/global\.executeDataPurge/);
  assert.match(ui,/applyCompletedPurge\(result\)/);
  assert.doesNotMatch(ui,/大型数据库可能需要几分钟/);
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/v104-fast-purge-ui\.js\?v=20260814-3/);
  assert.match(injector,/v105-fast-render\.js\?v=20260814-2/);
  assert.match(injector,/v105AsyncPurgePatch\.js/);
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
