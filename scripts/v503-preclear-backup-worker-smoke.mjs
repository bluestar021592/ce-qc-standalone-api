import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

for(const file of ['src/dataPurge.js','scripts/CE_QC_BackupQuickCheckWorker.mjs']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

const source=fs.readFileSync('src/dataPurge.js','utf8');
assert.match(source,/V503_PRE_CLEAR_VERIFY_ID='2026-09-10-v503-isolated-pre-clear-backup-quick-check-v1'/);
assert.match(source,/CE_QC_BackupQuickCheckWorker\.mjs/);
assert.match(source,/await verifyBackupQuickIsolated\(filePath\)/);
assert.match(source,/spawn\(process\.execPath,\[BACKUP_QUICK_CHECK_WORKER,payload\]/);
assert.doesNotMatch(source,/new DatabaseSync\(filePath/,'5177 purge preparation must not run backup quick_check inside the web process');
assert.match(source,/isolated-backup-quick-check/);
assert.match(source,/setPurgeBlock\(db,Date\.now\(\)\+60\*60_000\)/,'large-db prepare needs a long maintenance block while backup + verification runs');
const backupPos=source.indexOf("const verifiedBackup=await createVerifiedPreClearBackup(user.email||'');");
const createdPos=source.indexOf('const createdAt=Date.now();');
assert.ok(backupPos>=0&&createdPos>backupPos,'10-minute confirmation clock must start only after the verified backup finishes');

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-v503-'));
const dbPath=path.join(tempDir,'probe.db');
const db=new DatabaseSync(dbPath);
db.exec('CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO probe(value) VALUES (\'ok\');');
db.close();

function runWorker(filePath){
  return new Promise((resolve,reject)=>{
    const payload=Buffer.from(JSON.stringify({filePath}),'utf8').toString('base64url');
    let stdout='';let stderr='';
    const child=spawn(process.execPath,['scripts/CE_QC_BackupQuickCheckWorker.mjs',payload],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
    child.once('error',reject);
    child.once('exit',code=>{
      const lines=stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      let result=null;
      for(let i=lines.length-1;i>=0;i-=1){try{result=JSON.parse(lines[i]);break;}catch{}}
      resolve({code,result,stderr});
    });
  });
}

const good=await runWorker(dbPath);
assert.equal(good.code,0,good.stderr);
assert.equal(good.result?.ok,true);
assert.equal(good.result?.integrity,'quick-ok');
assert.equal(good.result?.worker,'V503');

const badPath=path.join(tempDir,'bad.db');
fs.writeFileSync(badPath,'not-a-sqlite-database');
const bad=await runWorker(badPath);
assert.notEqual(bad.code,0);
assert.equal(bad.result?.ok,false);

fs.rmSync(tempDir,{recursive:true,force:true});
console.log('[V503] pre-clear backup quick_check smoke passed · verification runs in isolated child process · 5177 event loop stays free · confirmation clock starts after verified backup · corrupt copy fails closed · no business delete is involved');
