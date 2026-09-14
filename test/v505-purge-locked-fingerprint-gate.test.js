import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const purgeSource=fs.readFileSync(path.join(root,'src','dataPurge.js'),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function functionBody(name){
  const start=purgeSource.indexOf(`function ${name}(`);
  assert.ok(start>=0,`${name} must exist`);
  const next=purgeSource.indexOf('\nfunction ',start+1);
  return purgeSource.slice(start,next>start?next:purgeSource.length);
}

async function waitForStatus(file,jobId,timeoutMs=30_000){
  const deadline=Date.now()+timeoutMs;
  let status=null;
  while(Date.now()<deadline){
    try{status=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    if(status?.jobId===jobId&&['SUCCEEDED','FAILED'].includes(String(status.status||'').toUpperCase()))return status;
    await wait(100);
  }
  return status;
}

async function startWriterThatCommitsWhilePurgeWaitsForWriteLock(dbFile){
  const source=`
    import { DatabaseSync } from 'node:sqlite';
    const db=new DatabaseSync(process.env.RACE_DB);
    db.exec('PRAGMA busy_timeout=3000');
    db.exec('BEGIN IMMEDIATE');
    process.stdout.write('LOCKED\\n');
    await new Promise(resolve=>setTimeout(resolve,900));
    db.prepare("INSERT INTO app_meta(key,value,updatedAt) VALUES('v505_locked_gate_race','committed-between-precheck-and-lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt").run(new Date().toISOString());
    db.exec('COMMIT');
    process.stdout.write('COMMITTED\\n');
    db.close();
  `;
  return startLockHolder(dbFile,source);
}

async function startWriterHoldingLockPastBusyTimeout(dbFile,holdMs=4500){
  const source=`
    import { DatabaseSync } from 'node:sqlite';
    const db=new DatabaseSync(process.env.RACE_DB);
    db.exec('PRAGMA busy_timeout=3000');
    db.exec('BEGIN IMMEDIATE');
    process.stdout.write('LOCKED\\n');
    await new Promise(resolve=>setTimeout(resolve,Number(process.env.HOLD_MS||4500)));
    db.exec('ROLLBACK');
    process.stdout.write('RELEASED\\n');
    db.close();
  `;
  return startLockHolder(dbFile,source,{HOLD_MS:String(holdMs)});
}

async function startLockHolder(dbFile,source,extraEnv={}){
  const child=spawn(process.execPath,['--input-type=module','-e',source],{
    cwd:root,
    env:{...process.env,RACE_DB:dbFile,...extraEnv},
    stdio:['ignore','pipe','pipe']
  });
  let stdout='';let stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk.toString();});
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`race writer did not acquire lock: ${stderr||stdout}`)),5000);
    const onData=()=>{
      if(!stdout.includes('LOCKED'))return;
      clearTimeout(timer);child.stdout.off('data',onData);resolve();
    };
    child.stdout.on('data',onData);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    onData();
  });
  return {child,getOutput:()=>({stdout,stderr})};
}

async function waitForExit(child,timeoutMs=7000){
  if(child.exitCode!==null)return child.exitCode;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('child process did not exit')),timeoutMs);
    child.once('exit',code=>{clearTimeout(timer);resolve(code);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
  });
}

async function prepareChallenge({createPurgeChallenge,getRuntimeConfig,user}){
  const queued=await createPurgeChallenge(user,{activeRunIds:new Set()});
  const statusFile=path.join(getRuntimeConfig().projectRoot,'public',String(queued.statusUrl||'').replace(/^\//,''));
  const prepared=await waitForStatus(statusFile,queued.jobId);
  assert.equal(prepared?.status,'SUCCEEDED',prepared?.error||'prepare worker did not finish');
  const challenge=await createPurgeChallenge(user,{activeRunIds:new Set()});
  assert.equal(challenge.status,'SUCCEEDED');
  const waitMs=Math.max(0,new Date(challenge.notBefore).getTime()-Date.now());
  if(waitMs)await wait(waitMs+50);
  return {challenge,statusFile};
}

test('V505 destructive reset revalidates sealed source only after BEGIN IMMEDIATE and before first DELETE',()=>{
  const body=functionBody('fastResetBusinessState');
  const tryAt=body.indexOf('try{');
  const fkOffAt=body.indexOf("db.exec('PRAGMA foreign_keys=OFF')");
  const beginAt=body.indexOf("db.exec('BEGIN IMMEDIATE')");
  const startedAt=body.indexOf('transactionStarted=true');
  const expiryAt=body.indexOf('challengeExpiresAt');
  const safetyBlockAt=body.indexOf("SELECT value FROM app_meta WHERE key=?");
  const backupAt=body.indexOf('verifyPreparedBackupStillPresent(commitContext.backup)');
  const fingerprintAt=body.indexOf('const lockedFingerprint=databaseFingerprint(getRuntimeConfig().dbFile)');
  const matchedAt=body.indexOf('sameFingerprint(commitContext.expectedSourceFingerprint,lockedFingerprint)');
  const deleteAt=body.indexOf('for(const table of clearTargets){const deleted=');
  const finallyAt=body.indexOf('finally{');
  const fkOnAt=body.indexOf("db.exec('PRAGMA foreign_keys=ON')");

  assert.ok(tryAt>=0&&fkOffAt>tryAt,'foreign_keys=OFF must itself be inside the restoration try/finally');
  assert.ok(beginAt>fkOffAt,'destructive transaction must acquire a SQLite write lock only after FK mode is captured');
  assert.ok(startedAt>beginAt,'transactionStarted may become true only after BEGIN IMMEDIATE succeeds');
  assert.ok(expiryAt>beginAt,'challenge expiry must be rechecked after write lock acquisition');
  assert.ok(safetyBlockAt>beginAt,'purge safety block must be rechecked after write lock acquisition');
  assert.ok(backupAt>beginAt,'verified backup presence must be rechecked while the write lock is held');
  assert.ok(fingerprintAt>beginAt,'source fingerprint must be sampled while the write lock is held');
  assert.ok(matchedAt>fingerprintAt,'locked fingerprint must be compared with the verified-backup fingerprint');
  assert.ok(deleteAt>matchedAt,'no business DELETE may run before the locked fingerprint comparison succeeds');
  assert.ok(finallyAt>beginAt&&fkOnAt>finallyAt,'foreign_keys must be restored in finally even when BEGIN IMMEDIATE throws');
  assert.match(body,/if\(transactionStarted\)\{try\{db\.exec\('ROLLBACK'\);\}catch\{\}\}/,'ROLLBACK must only run when BEGIN IMMEDIATE actually started a transaction');
  assert.match(body,/error\.code='V505_PURGE_SOURCE_FINGERPRINT_CHANGED'/);
  assert.match(body,/error\.stage='BEGIN_IMMEDIATE_LOCKED_BEFORE_DELETE'/);
  assert.match(body,/sourceFingerprintGate:'BEGIN_IMMEDIATE_LOCKED_BEFORE_DELETE'/);
});

test('V505 execute path is read-only before locked destructive gate',()=>{
  const start=purgeSource.indexOf('export async function executePurge(');
  const end=purgeSource.indexOf('\nexport function getPurgeCounts',start);
  assert.ok(start>=0&&end>start,'executePurge body must exist');
  const body=purgeSource.slice(start,end);
  assert.match(body,/waitForBackgroundMaintenanceIdle\(db,5\*60_000,\{readOnly:true\}\)/,'execute must not clean stale background markers before sealed-source validation');
  assert.match(body,/reconcileRunLocks\(db,activeRunIds,\{strict:true\}\)/,'execute must reject run locks instead of mutating them before the locked fingerprint gate');
  assert.match(body,/expectedSourceFingerprint:challenge\.sourceFingerprint/);
  assert.match(body,/challengeExpiresAt:challenge\.expiresAt/);
});

test('V505 concurrent writer committing after the quick fingerprint check is rejected under BEGIN IMMEDIATE before DELETE',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-locked-gate-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.PURGE_PREPARE_START_DELAY_MS='750';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {createPurgeChallenge,executePurge,PURGE_PHRASE}=await import('../src/dataPurge.js');
  const db=getDb();
  const user={email:'locked-gate-admin@example.test',username:'locked-gate-admin',role:'ADMIN'};
  let prepareStatusFile='';
  let writer=null;
  try{
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-11');
    const prepared=await prepareChallenge({createPurgeChallenge,getRuntimeConfig,user});
    prepareStatusFile=prepared.statusFile;
    const challenge=prepared.challenge;

    writer=await startWriterThatCommitsWhilePurgeWaitsForWriteLock(getRuntimeConfig().dbFile);
    let caught=null;
    try{
      await executePurge({challengeId:challenge.challengeId,phrase:PURGE_PHRASE,backupConfirmed:true,user,activeRunIds:new Set(),executeJobId:'00000000-0000-4000-8000-000000000509'});
    }catch(error){caught=error;}
    const exitCode=await waitForExit(writer.child);
    const output=writer.getOutput();
    assert.equal(exitCode,0,output.stderr||output.stdout);
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='v505_locked_gate_race'").get()?.value,'committed-between-precheck-and-lock','SQLite truth, not trailing child stdout, proves the race writer committed before purge obtained the write lock');
    assert.ok(caught,'purge must reject the source that changed while it was waiting for BEGIN IMMEDIATE');
    assert.equal(caught.code,'V505_PURGE_SOURCE_FINGERPRINT_CHANGED');
    assert.equal(caught.stage,'BEGIN_IMMEDIATE_LOCKED_BEFORE_DELETE');
    assert.match(String(caught.message||''),/执行任何DELETE之前停止清除/);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,1,'business data must remain untouched after locked fingerprint rejection');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get(),undefined,'destructive reset must not commit');
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0),1,'FK enforcement must remain enabled after locked fingerprint rejection');
  }finally{
    if(writer?.child&&writer.child.exitCode===null){try{writer.child.kill();}catch{}}
    try{closeDb();}catch{}
    if(prepareStatusFile){try{fs.rmSync(prepareStatusFile,{force:true});}catch{}}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('V505 BEGIN IMMEDIATE busy failure restores foreign_keys on the same connection',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-busy-fk-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.PURGE_PREPARE_START_DELAY_MS='750';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {createPurgeChallenge,executePurge,PURGE_PHRASE}=await import('../src/dataPurge.js');
  const db=getDb();
  const user={email:'busy-fk-admin@example.test',username:'busy-fk-admin',role:'ADMIN'};
  let prepareStatusFile='';
  let writer=null;
  try{
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-12');
    const prepared=await prepareChallenge({createPurgeChallenge,getRuntimeConfig,user});
    prepareStatusFile=prepared.statusFile;
    const challenge=prepared.challenge;
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0),1,'test requires FK enforcement enabled before destructive attempt');

    writer=await startWriterHoldingLockPastBusyTimeout(getRuntimeConfig().dbFile,4500);
    let caught=null;
    try{
      await executePurge({challengeId:challenge.challengeId,phrase:PURGE_PHRASE,backupConfirmed:true,user,activeRunIds:new Set(),executeJobId:'00000000-0000-4000-8000-000000000510'});
    }catch(error){caught=error;}
    assert.ok(caught,'BEGIN IMMEDIATE must fail while another writer holds the lock past busy_timeout');
    assert.match(String(caught?.message||caught),/busy|locked|SQLITE_BUSY/i);
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0),1,'foreign_keys must be restored even when BEGIN IMMEDIATE itself throws');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count,1,'write-lock timeout must not delete business data');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get(),undefined,'write-lock timeout must not commit purge metadata');

    const exitCode=await waitForExit(writer.child);
    const output=writer.getOutput();
    assert.equal(exitCode,0,output.stderr||output.stdout);
    assert.doesNotThrow(()=>{db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');},'SQLite lock acquisition after child exit proves the lock holder released its transaction; trailing stdout is not used as the oracle');
  }finally{
    if(writer?.child&&writer.child.exitCode===null){try{writer.child.kill();}catch{}}
    try{closeDb();}catch{}
    if(prepareStatusFile){try{fs.rmSync(prepareStatusFile,{force:true});}catch{}}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
