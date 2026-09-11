import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}

function responseHarness(){
  const res=new EventEmitter();
  res.statusCode=200;
  res.body=null;
  res.status=function status(code){this.statusCode=code;return this;};
  res.json=function json(body){this.body=body;return this;};
  return res;
}

function requestFor(user,route='/api/admin/data-purge/prepare'){
  return {user,method:'POST',path:route,originalUrl:route,url:route};
}

test('V505 global purge guard blocks cross-admin ownership, closes submission races, and fails closed on orphan locks', async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-global-guard-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {v505PurgeGlobalOwnerGuard,V505_PURGE_GLOBAL_GUARD_ID}=await import('../src/v505PurgeGlobalGuard.js');
  const db=getDb();
  const cfg=getRuntimeConfig();
  const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
  fs.mkdirSync(prepareDir,{recursive:true});
  const adminA={email:'admin-a@example.test',username:'admin-a',role:'ADMIN'};
  const adminB={email:'admin-b@example.test',username:'admin-b',role:'ADMIN'};
  const setBlock=until=>db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_block_until',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(String(until),new Date().toISOString());
  const clearGuardState=()=>{
    db.prepare("DELETE FROM app_meta WHERE key IN ('data_purge_block_until','data_purge_submission_mutex')").run();
    for(const name of fs.readdirSync(prepareDir)){if(name.endsWith('.job.json'))fs.rmSync(path.join(prepareDir,name),{force:true});}
  };

  try{
    const foreignJob={
      jobId:crypto.randomUUID(),status:'RUNNING',email:adminA.email,submittedAt:Date.now()-180_000,
      startedAt:Date.now()-170_000,heartbeatAt:Date.now()-120_000,workerPid:process.pid,updatedAt:Date.now()-120_000
    };
    fs.writeFileSync(path.join(prepareDir,`${identityKey(adminA)}.job.json`),JSON.stringify(foreignJob),'utf8');
    setBlock(Date.now()+10*60_000);
    let foreignNext=false;
    const foreignRes=responseHarness();
    v505PurgeGlobalOwnerGuard(requestFor(adminB),foreignRes,()=>{foreignNext=true;});
    assert.equal(foreignNext,false);
    assert.equal(foreignRes.statusCode,423);
    assert.equal(foreignRes.body?.code,'DATA_PURGE_OWNED_BY_ANOTHER_ADMIN');
    assert.equal(foreignRes.body?.workerState,'ALIVE');
    assert.equal(foreignRes.body?.guardPatch,V505_PURGE_GLOBAL_GUARD_ID);

    clearGuardState();
    let firstNext=false;
    const firstRes=responseHarness();
    v505PurgeGlobalOwnerGuard(requestFor(adminA),firstRes,()=>{firstNext=true;});
    assert.equal(firstNext,true,'first submission must acquire the atomic global mutex');
    assert.ok(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_submission_mutex'").get()?.value,'submission mutex must remain held until the response finishes');

    let secondNext=false;
    const secondRes=responseHarness();
    v505PurgeGlobalOwnerGuard(requestFor(adminB),secondRes,()=>{secondNext=true;});
    assert.equal(secondNext,false,'concurrent admin must not pass while the first request owns the submission mutex');
    assert.equal(secondRes.statusCode,423);
    assert.equal(secondRes.body?.code,'DATA_PURGE_SUBMISSION_BUSY');

    firstRes.emit('finish');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_submission_mutex'").get(),undefined,'response completion must release only its own submission mutex');
    let retryNext=false;
    const retryRes=responseHarness();
    v505PurgeGlobalOwnerGuard(requestFor(adminB),retryRes,()=>{retryNext=true;});
    assert.equal(retryNext,true,'retry may proceed after the first submission has finished and no protected job exists');
    retryRes.emit('finish');

    clearGuardState();
    setBlock(Date.now()+5*60_000);
    let orphanNext=false;
    const orphanRes=responseHarness();
    v505PurgeGlobalOwnerGuard(requestFor(adminA),orphanRes,()=>{orphanNext=true;});
    assert.equal(orphanNext,false);
    assert.equal(orphanRes.statusCode,423);
    assert.equal(orphanRes.body?.code,'DATA_PURGE_GLOBAL_LOCK_ORPHANED');

    clearGuardState();
    const ownJob={...foreignJob,jobId:crypto.randomUUID(),email:adminA.email,heartbeatAt:Date.now(),updatedAt:Date.now()};
    fs.writeFileSync(path.join(prepareDir,`${identityKey(adminA)}.job.json`),JSON.stringify(ownJob),'utf8');
    setBlock(Date.now()+10*60_000);
    let ownerNext=false;
    const ownerRes=responseHarness();
    v505PurgeGlobalOwnerGuard(requestFor(adminA),ownerRes,()=>{ownerNext=true;});
    assert.equal(ownerNext,true,'the owning admin must be able to recover/read its existing live prepare task');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_submission_mutex'").get(),undefined,'live prepare recovery must not contend with the long-running backup for a new submission mutex');

    clearGuardState();
    const deadOwnJob={...foreignJob,jobId:crypto.randomUUID(),email:adminA.email,workerPid:2147483647,heartbeatAt:Date.now()-120_000,updatedAt:Date.now()-120_000};
    fs.writeFileSync(path.join(prepareDir,`${identityKey(adminA)}.job.json`),JSON.stringify(deadOwnJob),'utf8');
    setBlock(Date.now()+10*60_000);
    let deadRecoveryNext=false;
    const deadRecoveryRes=responseHarness();
    v505PurgeGlobalOwnerGuard(requestFor(adminA),deadRecoveryRes,()=>{deadRecoveryNext=true;});
    assert.equal(deadRecoveryNext,true,'confirmed-dead own worker recovery may proceed under the global mutex');
    assert.ok(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_submission_mutex'").get()?.value,'dead-worker recovery must hold a submission mutex while it mutates job state');
    let duplicateDeadRecoveryNext=false;
    const duplicateDeadRecoveryRes=responseHarness();
    v505PurgeGlobalOwnerGuard(requestFor(adminA),duplicateDeadRecoveryRes,()=>{duplicateDeadRecoveryNext=true;});
    assert.equal(duplicateDeadRecoveryNext,false,'a second same-owner dead-worker recovery must not race the first recovery request');
    assert.equal(duplicateDeadRecoveryRes.body?.code,'DATA_PURGE_SUBMISSION_BUSY');
    deadRecoveryRes.emit('finish');
  }finally{
    try{clearGuardState();}catch{}
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
