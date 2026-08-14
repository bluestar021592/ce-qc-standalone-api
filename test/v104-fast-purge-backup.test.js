import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const relative='src/dataPurge.js';
const source=fs.readFileSync(path.join(root,relative),'utf8');

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

test('purge dialog shows live elapsed time while fast online backup is running',()=>{
  const uiRelative='public/v104-fast-purge-ui.js';
  const ui=fs.readFileSync(path.join(root,uiRelative),'utf8');
  const syntax=spawnSync(process.execPath,['--check',path.join(root,uiRelative)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(ui,/快速在线备份/);
  assert.match(ui,/已用 \$\{elapsed\} 秒/);
  assert.match(ui,/global\.openDataPurge/);
  const injector=fs.readFileSync(path.join(root,'src/v44WhppUiPatch.js'),'utf8');
  assert.match(injector,/v104-fast-purge-ui\.js\?v=20260814-1/);
});
