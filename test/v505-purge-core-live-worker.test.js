import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}

test('V505 core prepare recovery never retires a live worker because heartbeat is stale',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-core-live-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {createPurgeChallenge}=await import('../src/dataPurge.js');
  const db=getDb();
  const cfg=getRuntimeConfig();
  const user={email:'core-live-admin@example.test',username:'core-live-admin',role:'ADMIN'};
  const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
  fs.mkdirSync(prepareDir,{recursive:true});
  const jobFile=path.join(prepareDir,`${identityKey(user)}.job.json`);
  const statusToken=crypto.randomBytes(24).toString('hex');
  const lockUntil=Date.now()+10*60_000;
  const job={
    jobId:crypto.randomUUID(),statusToken,statusFile:path.join(cfg.projectRoot,'public','purge-status',`${statusToken}.json`),
    status:'RUNNING',email:user.email,submittedAt:Date.now()-180_000,startedAt:Date.now()-170_000,
    heartbeatAt:Date.now()-120_000,workerPid:process.pid,updatedAt:Date.now()-120_000,error:'',payload:null
  };
  db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_block_until',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(String(lockUntil),new Date().toISOString());
  fs.writeFileSync(jobFile,JSON.stringify(job),'utf8');

  try{
    const recovered=await createPurgeChallenge(user);
    assert.equal(recovered.status,'RUNNING');
    assert.equal(recovered.jobId,job.jobId);
    assert.equal(recovered.heartbeatStale,true);
    assert.equal(recovered.workerState,'ALIVE');
    assert.match(String(recovered.message||''),/保持锁定/);
    assert.match(String(recovered.message||''),/不会启动第二份备份/);
    const persisted=JSON.parse(fs.readFileSync(jobFile,'utf8'));
    assert.equal(persisted.status,'RUNNING','live job must remain authoritative');
    assert.equal(persisted.jobId,job.jobId);
    const lockAfter=Number(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0);
    assert.equal(lockAfter,lockUntil,'stale heartbeat must not clear the purge safety block while PID is alive');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
