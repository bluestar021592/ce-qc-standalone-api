import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('V505 dead-worker recovery can clear and recreate purge safety metadata while the shared web DB is query-only',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-control-db-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.PURGE_PREPARE_START_DELAY_MS='10000';

  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {createPurgeChallenge,V505_PURGE_RECOVERY_ID}=await import('../src/dataPurge.js');
  const db=getDb();
  const cfg=getRuntimeConfig();
  const user={email:'control-recovery@example.test',role:'ADMIN'};
  const identity=crypto.createHash('sha256').update(user.email).digest('hex').slice(0,24);
  const jobDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
  const jobFile=path.join(jobDir,`${identity}.job.json`);
  fs.mkdirSync(jobDir,{recursive:true});

  let spawnedPid=0;
  try{
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_block_until',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(String(Date.now()+60_000),new Date().toISOString());
    fs.writeFileSync(jobFile,JSON.stringify({
      patchId:V505_PURGE_RECOVERY_ID,
      jobId:crypto.randomUUID(),
      status:'RUNNING',
      email:user.email,
      workerPid:2147483647,
      submittedAt:Date.now()-120_000,
      startedAt:Date.now()-119_000,
      heartbeatAt:Date.now()-118_000,
      updatedAt:Date.now()-118_000
    }), 'utf8');

    db.exec('PRAGMA query_only=ON');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1);

    const failed=await createPurgeChallenge(user,{activeRunIds:new Set()});
    assert.equal(failed.status,'FAILED');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get(),undefined,'confirmed-dead recovery must clear the safety block through an independent writable connection');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'recovery must not thaw the shared web DB connection');

    const queued=await createPurgeChallenge(user,{activeRunIds:new Set()});
    assert.equal(queued.status,'QUEUED');
    const persisted=JSON.parse(fs.readFileSync(jobFile,'utf8'));
    spawnedPid=Number(persisted.workerPid||0);
    assert.ok(spawnedPid>0,'recovery retry must durably register a detached prepare worker');
    const blockUntil=Number(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0);
    assert.ok(blockUntil>Date.now(),'retry must recreate the SQLite purge safety block through an independent writable connection');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'shared web DB remains query-only throughout recovery retry');
  }finally{
    if(spawnedPid>0){try{process.kill(spawnedPid);}catch{}}
    try{db.exec('PRAGMA query_only=OFF');}catch{}
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
