import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const launcher='tools/CE_QC_Managed_Launcher.ps1';
const backup='scripts/CE_QC_PreUpdate_Backup.mjs';
const repair='tools/Repair_CE_QC_Desktop_Launcher_V6.ps1';

test('managed launcher owns backend with Windows kill-on-close job',()=>{
  const source=read(launcher);
  assert.match(source,/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(source,/AssignProcessToJobObject/);
  assert.match(source,/CreateKillOnCloseJob/);
  assert.match(source,/CloseHandle/);
  assert.match(source,/Start_CE_QC\.ps1/);
  assert.match(source,/Closing THIS window will automatically stop the backend and release port 5177/);
});

test('desktop root start no longer reuses a stale hidden 5177 backend',()=>{
  const source=read('Start_CE_QC.cmd');
  assert.match(source,/CE_QC_Managed_Launcher\.ps1/);
  assert.match(source,/CE_QC_CarryRefresh_Poller\.ps1/);
  assert.doesNotMatch(source,/Fast_Start_CE_QC\.ps1/);
});

test('automatic code update validates remote candidate before installation and backup',()=>{
  const source=read(launcher);
  const validate=source.indexOf('Test-RemoteCandidate $remote');
  const backupAt=source.indexOf('CE_QC_PreUpdate_Backup.mjs');
  const pull=source.indexOf("@('pull','--ff-only'");
  assert.ok(validate>=0 && backupAt>validate && pull>backupAt);
  assert.match(source,/status','--porcelain','--untracked-files=no/);
  assert.match(source,/worktree','add','--detach/);
  assert.match(source,/run','test:golive/);
  assert.match(source,/pull','--ff-only/);
  assert.doesNotMatch(source,/reset\s+--hard/i);
});

test('pre-update backup is syntax valid, online verified and does not mutate business rows',()=>{
  const source=read(backup);
  const syntax=spawnSync(process.execPath,['--check',path.join(root,backup)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/import \{ backup, DatabaseSync \} from 'node:sqlite'/);
  assert.match(source,/PRAGMA quick_check\(1\)/);
  assert.match(source,/await backup\(source, copyFile/);
  assert.match(source,/PRAGMA integrity_check/);
  assert.match(source,/sha256/);
  assert.match(source,/backups.*pre_update/s);
  assert.doesNotMatch(source,/wal_checkpoint\(FULL\)/);
  assert.doesNotMatch(source,/DELETE\s+FROM|UPDATE\s+\w+\s+SET|INSERT\s+INTO/i);
  assert.doesNotMatch(source,/resetAppState|executePurge|永久清除/);
});

test('schema migration remains independently backup-before-transaction protected',()=>{
  const source=read('src/migrations.js');
  assert.match(source,/backup_before_migration_/);
  const backupAt=source.indexOf('backupDbFile(db, cfg)');
  const begin=source.indexOf("db.exec('BEGIN IMMEDIATE')");
  assert.ok(backupAt>=0 && begin>backupAt);
});

test('desktop repair now launches one visible managed console instead of a hidden backend supervisor',()=>{
  const source=read(repair);
  assert.match(source,/Start_CE_QC\.cmd/);
  assert.match(source,/shell\.Run command, 1, False/);
  assert.match(source,/Closing that window automatically stops the backend and releases port 5177/);
  assert.doesNotMatch(source,/WindowStyle = 0/);
});
