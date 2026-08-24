import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v285-backup-freeze-'));
const sourcePath=path.join(root,'source.db');
const backupPath=path.join(root,'backup.db');

const seed=new DatabaseSync(sourcePath,{timeout:1000});
seed.exec('PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY,value TEXT);');
seed.prepare('INSERT INTO t(value) VALUES(?)').run('before-freeze');
seed.close();

const freeze=new DatabaseSync(sourcePath,{timeout:1000});
freeze.exec('PRAGMA busy_timeout=1000; BEGIN IMMEDIATE;');

const source=new DatabaseSync(sourcePath,{readOnly:true,timeout:1000});
await backup(source,backupPath,{rate:128});
source.close();

const competingWriter=new DatabaseSync(sourcePath,{timeout:100});
competingWriter.exec('PRAGMA busy_timeout=100;');
assert.throws(
  ()=>competingWriter.prepare('INSERT INTO t(value) VALUES(?)').run('must-block'),
  error=>/busy|locked/i.test(String(error?.message||error)),
  'a competing writer must be blocked while the pre-update freeze is held'
);

const verify=new DatabaseSync(backupPath,{readOnly:true,timeout:1000});
assert.equal(verify.prepare('PRAGMA quick_check(1)').get()?.quick_check,'ok','frozen online backup must pass quick_check');
assert.equal(Number(verify.prepare('SELECT COUNT(*) n FROM t').get()?.n||0),1,'backup must contain the exact frozen pre-update state');
verify.close();

freeze.exec('ROLLBACK;');
freeze.close();
competingWriter.prepare('INSERT INTO t(value) VALUES(?)').run('after-release');
assert.equal(Number(competingWriter.prepare('SELECT COUNT(*) n FROM t').get()?.n||0),2,'writes must resume only after the freeze is released');
competingWriter.close();

fs.rmSync(root,{recursive:true,force:true});
console.log('[V285] pre-update backup write-freeze smoke passed · BEGIN IMMEDIATE blocks writers · online backup quick-checks · writes resume after release');
