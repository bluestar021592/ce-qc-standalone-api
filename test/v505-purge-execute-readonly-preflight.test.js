import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function runPreflight({dbFile,dataDir,jobFile,jobId}){
  const payload={jobFile,jobId,statusFile:'',user:{email:'readonly-preflight@example.test'},request:{}};
  const source=`
    process.env.CE_QC_PURGE_EXECUTE_CHILD='1';
    process.env.CE_QC_PURGE_SEALED_DB_FILE=${JSON.stringify(dbFile)};
    process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
    process.env.DATA_DIR=${JSON.stringify(dataDir)};
    process.env.DB_FILE=${JSON.stringify(dbFile)};
    const {assertPurgeExecuteReadOnlyPreflight}=await import('./src/v505PurgeExecuteReadOnlyPreflight.js');
    assertPurgeExecuteReadOnlyPreflight(${JSON.stringify(payload)});
    console.log('UNEXPECTED_PREFLIGHT_SUCCESS');
  `;
  return spawnSync(process.execPath,['--input-type=module','-e',source],{
    cwd:root,encoding:'utf8',env:{...process.env,CE_QC_PURGE_EXECUTE_CHILD:'1',CE_QC_PURGE_SEALED_DB_FILE:dbFile,CE_QC_DISABLE_CARRY_REFRESH:'1',DATA_DIR:dataDir,DB_FILE:dbFile}
  });
}

async function createValidDatabase(dir){
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  delete process.env.CE_QC_PURGE_EXECUTE_CHILD;
  const dbModule=await import(`../src/db.js?v505-readonly-preflight-${crypto.randomUUID()}`);
  const db=dbModule.getDb();
  return {db,dbFile:process.env.DB_FILE,close:()=>dbModule.closeDb()};
}

test('V505 execute preflight leaves active cache-worker safety metadata untouched and refuses DELETE',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-readonly-preflight-'));
  const jobFile=path.join(dir,'execute.job.json');
  const jobId=crypto.randomUUID();
  let holder;
  try{
    holder=await createValidDatabase(dir);
    const now=new Date().toISOString();
    const future=Date.now()+10*60_000;
    const meta=holder.db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    meta.run('data_purge_block_until',String(future),now);
    meta.run('dashboard_cache_worker_active','2147483647-v505-stale-cache',now);
    meta.run('dashboard_cache_worker_active_until',String(future),now);
    holder.close();holder=null;
    fs.writeFileSync(jobFile,JSON.stringify({kind:'EXECUTE',jobId,challengeId:crypto.randomUUID(),status:'QUEUED',request:{challengeId:crypto.randomUUID()}}),'utf8');

    const result=runPreflight({dbFile:path.join(dir,'test.db'),dataDir:dir,jobFile,jobId});
    assert.notEqual(result.status,0);
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_EXECUTE_CACHE_WORKER_PRESENT/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_PREFLIGHT_SUCCESS/);

    const verify=new DatabaseSync(path.join(dir,'test.db'),{readOnly:true});
    assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='dashboard_cache_worker_active'").get()?.value,'2147483647-v505-stale-cache','preflight must not clean a stale/dead cache marker before source fingerprint validation');
    assert.equal(Number(verify.prepare("SELECT value FROM app_meta WHERE key='dashboard_cache_worker_active_until'").get()?.value||0),future);
    assert.equal(Number(verify.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0),future);
    assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get(),undefined,'destructive reset must not start');
    verify.close();
  }finally{
    try{holder?.close();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('V505 execute preflight treats malformed commit receipt as unknown/unsafe instead of not committed',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-receipt-strict-'));
  const jobFile=path.join(dir,'execute.job.json');
  const jobId=crypto.randomUUID();
  let holder;
  try{
    holder=await createValidDatabase(dir);
    const now=new Date().toISOString();
    const future=Date.now()+10*60_000;
    const meta=holder.db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    meta.run('data_purge_block_until',String(future),now);
    meta.run('data_purge_last_commit_receipt','{malformed-json',now);
    holder.close();holder=null;
    const challengeId=crypto.randomUUID();
    fs.writeFileSync(jobFile,JSON.stringify({kind:'EXECUTE',jobId,challengeId,status:'RUNNING',request:{challengeId}}),'utf8');

    const result=runPreflight({dbFile:path.join(dir,'test.db'),dataDir:dir,jobFile,jobId});
    assert.notEqual(result.status,0);
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_COMMIT_RECEIPT_INVALID/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_PREFLIGHT_SUCCESS/);

    const verify=new DatabaseSync(path.join(dir,'test.db'),{readOnly:true});
    assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='data_purge_last_commit_receipt'").get()?.value,'{malformed-json','invalid receipt must be preserved for investigation instead of silently discarded');
    assert.equal(Number(verify.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0),future,'safety block must remain intact');
    assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get(),undefined);
    verify.close();
  }finally{
    try{holder?.close();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('V505 execute preflight rejects partial finalized marker even when receipt matches the exact job',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-partial-finalized-preflight-'));
  const jobFile=path.join(dir,'execute.job.json');
  const jobId=crypto.randomUUID();
  const challengeId=crypto.randomUUID();
  let holder;
  try{
    holder=await createValidDatabase(dir);
    const now=new Date().toISOString();
    const future=Date.now()+10*60_000;
    const partial={
      version:2,challengeId,executeJobId:jobId,committedAt:now,
      finalizedAt:new Date(Date.now()-1000).toISOString(),finalizationState:'BROKEN_PARTIAL_STATE',
      recoveryBlockUntil:future,before:{},after:{}
    };
    const raw=JSON.stringify(partial);
    const meta=holder.db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    meta.run('data_purge_block_until',String(future),now);
    meta.run('data_purge_last_commit_receipt',raw,now);
    holder.close();holder=null;
    fs.writeFileSync(jobFile,JSON.stringify({kind:'EXECUTE',jobId,challengeId,status:'COMMITTED',request:{challengeId}}),'utf8');

    const result=runPreflight({dbFile:path.join(dir,'test.db'),dataDir:dir,jobFile,jobId});
    assert.notEqual(result.status,0);
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_COMMIT_RECEIPT_INVALID/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_PREFLIGHT_SUCCESS/);

    const verify=new DatabaseSync(path.join(dir,'test.db'),{readOnly:true});
    assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='data_purge_last_commit_receipt'").get()?.value,raw,'partial finalized receipt must remain intact for manual investigation');
    assert.equal(Number(verify.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0),future,'partial finalized marker must not release the existing safety block');
    assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get(),undefined);
    verify.close();
  }finally{
    try{holder?.close();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('V505 execute preflight never downgrades a COMMITTED sidecar to a fresh destructive run when its exact receipt is missing',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-committed-receipt-missing-'));
  const jobFile=path.join(dir,'execute.job.json');
  const jobId=crypto.randomUUID();
  const challengeId=crypto.randomUUID();
  let holder;
  try{
    holder=await createValidDatabase(dir);
    const now=new Date().toISOString();
    const future=Date.now()+10*60_000;
    holder.db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_block_until',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(String(future),now);
    holder.close();holder=null;
    fs.writeFileSync(jobFile,JSON.stringify({kind:'EXECUTE',jobId,challengeId,status:'COMMITTED',workerPid:0,request:{challengeId}}),'utf8');

    const result=runPreflight({dbFile:path.join(dir,'test.db'),dataDir:dir,jobFile,jobId});
    assert.notEqual(result.status,0);
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_COMMITTED_RECEIPT_MISSING/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_PREFLIGHT_SUCCESS/);

    const verify=new DatabaseSync(path.join(dir,'test.db'),{readOnly:true});
    assert.equal(Number(verify.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0),future,'missing exact receipt must not release the safety block');
    assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get(),undefined,'a COMMITTED sidecar without its exact durable receipt must never re-enter DELETE');
    verify.close();
    assert.equal(JSON.parse(fs.readFileSync(jobFile,'utf8')).status,'COMMITTED','read-only preflight must preserve the COMMITTED sidecar verbatim');
  }finally{
    try{holder?.close();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('V505 execute preflight blocks a new RUNNING job while a different unfinalized durable receipt still requires recovery',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-other-receipt-pending-'));
  const jobFile=path.join(dir,'execute.job.json');
  const jobId=crypto.randomUUID();
  const challengeId=crypto.randomUUID();
  let holder;
  try{
    holder=await createValidDatabase(dir);
    const now=new Date().toISOString();
    const future=Date.now()+10*60_000;
    const receipt={
      version:2,challengeId:crypto.randomUUID(),executeJobId:crypto.randomUUID(),committedAt:now,
      recoveryBlockUntil:future,before:{},after:{}
    };
    const meta=holder.db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    meta.run('data_purge_block_until',String(future),now);
    meta.run('data_purge_last_commit_receipt',JSON.stringify(receipt),now);
    holder.close();holder=null;
    fs.writeFileSync(jobFile,JSON.stringify({kind:'EXECUTE',jobId,challengeId,status:'RUNNING',workerPid:0,request:{challengeId}}),'utf8');

    const result=runPreflight({dbFile:path.join(dir,'test.db'),dataDir:dir,jobFile,jobId});
    assert.notEqual(result.status,0);
    assert.match(`${result.stderr}\n${result.stdout}`,/V505_PURGE_OTHER_COMMIT_RECEIPT_PENDING/);
    assert.doesNotMatch(`${result.stderr}\n${result.stdout}`,/UNEXPECTED_PREFLIGHT_SUCCESS/);

    const verify=new DatabaseSync(path.join(dir,'test.db'),{readOnly:true});
    assert.equal(Number(verify.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0),future);
    assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get(),undefined,'unfinalized receipt from another generation must block a second destructive run');
    verify.close();
  }finally{
    try{holder?.close();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
