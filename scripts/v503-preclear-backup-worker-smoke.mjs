import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

for(const file of ['src/dataPurge.js','scripts/CE_QC_BackupQuickCheckWorker.mjs','scripts/CE_QC_PreClearBackupWorker.mjs']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

const source=fs.readFileSync('src/dataPurge.js','utf8');
assert.match(source,/V503_PRE_CLEAR_VERIFY_ID='2026-09-10-v503-isolated-pre-clear-backup-quick-check-v1'/);
assert.match(source,/V504_PRE_CLEAR_BACKUP_ID='2026-09-10-v504-isolated-full-pre-clear-backup-v1'/);
assert.match(source,/CE_QC_PreClearBackupWorker\.mjs/);
assert.match(source,/await createVerifiedBackupIsolated\(cfg\.dbFile,filePath\)/);
assert.match(source,/spawn\(process\.execPath,\[PRE_CLEAR_BACKUP_WORKER,payload\]/);
assert.doesNotMatch(source,/from 'node:sqlite'/,'5177 purge preparation must not import node:sqlite backup work');
assert.doesNotMatch(source,/await backup\(/,'5177 purge preparation must never execute the 25GB SQLite backup itself');
assert.match(source,/isolated-write-freeze\+online-backup\+backup-quick-check\+sha256/);
assert.match(source,/setPurgeBlock\(db,Date\.now\(\)\+60\*60_000\)/,'large-db prepare needs a long maintenance block while backup + verification runs');
const backupPos=source.indexOf("const verifiedBackup=await createVerifiedPreClearBackup(user.email||'');");
const createdPos=source.indexOf('const createdAt=Date.now();');
assert.ok(backupPos>=0&&createdPos>backupPos,'10-minute confirmation clock must start only after the verified backup finishes');

const workerSource=fs.readFileSync('scripts/CE_QC_PreClearBackupWorker.mjs','utf8');
assert.match(workerSource,/BEGIN IMMEDIATE/,'V504 worker must freeze writers before copying');
assert.match(workerSource,/new DatabaseSync\(dbFile,\{readOnly:true/,'V504 worker must use a separate read-only backup reader');
assert.match(workerSource,/await backup\(sourceDb,filePath,\{rate:ratePages\}\)/);
assert.match(workerSource,/PRAGMA quick_check\(1\)/);
assert.match(workerSource,/createHash\('sha256'\)/);
assert.match(workerSource,/ROLLBACK/,'write freeze must always be released without mutating source data');

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-v504-'));
const dbPath=path.join(tempDir,'source.db');
const backupPath=path.join(tempDir,'backup','ce_qc_monitor.db');
const db=new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO probe(value) VALUES ('ok');");
db.close();

function runWorker(sourcePath,targetPath){
  return new Promise((resolve,reject)=>{
    const payload=Buffer.from(JSON.stringify({dbFile:sourcePath,filePath:targetPath,lockTimeoutMs:10000,ratePages:256}),'utf8').toString('base64url');
    let stdout='';let stderr='';
    const child=spawn(process.execPath,['scripts/CE_QC_PreClearBackupWorker.mjs',payload],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
    child.once('error',reject);
    child.once('exit',code=>{
      const lines=stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);let result=null;
      for(let i=lines.length-1;i>=0;i-=1){try{result=JSON.parse(lines[i]);break;}catch{}}
      resolve({code,result,stderr});
    });
  });
}

const good=await runWorker(dbPath,backupPath);
assert.equal(good.code,0,good.stderr);
assert.equal(good.result?.ok,true);
assert.equal(good.result?.worker,'V504');
assert.equal(good.result?.integrity,'quick-ok');
assert.match(String(good.result?.sha256||''),/^[a-f0-9]{64}$/i);
assert.ok(Number(good.result?.size||0)>0);
const copy=new DatabaseSync(backupPath,{readOnly:true});
assert.equal(copy.prepare('SELECT value FROM probe WHERE id=1').get()?.value,'ok');
copy.close();
const sourceCheck=new DatabaseSync(dbPath,{readOnly:true});
assert.equal(sourceCheck.prepare('SELECT COUNT(*) count FROM probe').get()?.count,1,'backup worker must not mutate source data');
sourceCheck.close();

const bad=await runWorker(path.join(tempDir,'missing.db'),path.join(tempDir,'bad-backup.db'));
assert.notEqual(bad.code,0);
assert.equal(bad.result?.ok,false);

fs.rmSync(tempDir,{recursive:true,force:true});
console.log('[V504/V503] pre-clear full backup smoke passed · online backup + quick_check + SHA all run in isolated worker · 5177 owns only orchestration/status · write-freeze source stays unchanged · corrupt/missing source fails closed · confirmation clock starts after verified copy');
