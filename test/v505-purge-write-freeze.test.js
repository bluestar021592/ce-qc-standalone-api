import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function responseHarness(){
  const res=new EventEmitter();
  res.statusCode=200;res.body=null;
  res.status=function(code){this.statusCode=code;return this;};
  res.json=function(body){this.body=body;return this;};
  return res;
}
function request(method,pathValue){return {method,path:pathValue,originalUrl:pathValue,url:pathValue};}
function identityFile(dir,label){
  const key=crypto.createHash('sha256').update(label).digest('hex').slice(0,24);
  return path.join(dir,`${key}.job.json`);
}

test('V505 freezes every unknown API path and never thaws the shared web DB while purge truth is active',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-write-freeze-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {v505PurgeWriteFreezeGuard,V505_PURGE_WRITE_FREEZE_ID}=await import('../src/v505PurgeWriteFreezeGuard.js');
  assert.ok(V505_PURGE_WRITE_FREEZE_ID);
  const db=getDb();
  const cfg=getRuntimeConfig();
  const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
  const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');
  fs.mkdirSync(prepareDir,{recursive:true});fs.mkdirSync(executeDir,{recursive:true});
  const prepareFile=identityFile(prepareDir,'prepare-owner');
  const executeFile=identityFile(executeDir,'execute-owner');
  const setExpiredSqliteBlock=()=>db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_block_until',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(String(Date.now()-60_000),new Date().toISOString());
  const runGuard=(req)=>{
    let nextCalled=false;const res=responseHarness();
    v505PurgeWriteFreezeGuard(req,res,()=>{nextCalled=true;});
    return {nextCalled,res,req};
  };
  try{
    setExpiredSqliteBlock();
    fs.writeFileSync(prepareFile,JSON.stringify({jobId:crypto.randomUUID(),status:'RUNNING',workerPid:process.pid,heartbeatAt:Date.now()-120_000}),'utf8');
    const livePrepare=runGuard(request('POST','/api/unified-import'));
    assert.equal(livePrepare.nextCalled,false);
    assert.equal(livePrepare.res.statusCode,423);
    assert.equal(livePrepare.res.body?.code,'DATA_PURGE_IN_PROGRESS');
    assert.equal(livePrepare.res.body?.protectedBy,'PREPARE:RUNNING');
    assert.equal(livePrepare.res.body?.fingerprintSealed,false);
    assert.equal(livePrepare.req.v505PurgeReadOnlyAuth,true);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'running PREPARE must freeze the shared web DB before the backup fingerprint is sealed');

    const unknownGet=runGuard(request('GET','/api/dashboard'));
    assert.equal(unknownGet.nextCalled,false,'unknown GET APIs are not assumed read-only during purge');
    assert.equal(unknownGet.res.statusCode,423);
    const health=runGuard(request('GET','/api/health'));
    assert.equal(health.nextCalled,true,'explicit health read stays available');
    assert.equal(health.req.v505PurgeReadOnlyAuth,true);
    const session=runGuard(request('GET','/api/session'));
    assert.equal(session.nextCalled,true,'session identity may be read without refreshing the DB session');

    const purgeControl=runGuard(request('POST','/api/admin/data-purge/prepare'));
    assert.equal(purgeControl.nextCalled,true,'purge coordinator endpoints must remain reachable');
    assert.equal(purgeControl.req.v505PurgeReadOnlyAuth,true,'purge control authentication remains read-only');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'trusted purge control must never create a shared writable window');
    assert.throws(()=>db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('v505_concurrent_write_probe','1',?)`).run(new Date().toISOString()),/readonly|read-only/i,'a concurrent main-process write must remain impossible during purge control recovery');

    fs.rmSync(prepareFile,{force:true});
    fs.writeFileSync(executeFile,JSON.stringify({jobId:crypto.randomUUID(),status:'RUNNING',workerPid:process.pid,heartbeatAt:Date.now()-120_000}),'utf8');
    const liveExecute=runGuard(request('DELETE','/api/admin/backups/all'));
    assert.equal(liveExecute.nextCalled,false);
    assert.equal(liveExecute.res.body?.protectedBy,'EXECUTE:RUNNING');
    assert.equal(liveExecute.res.body?.fingerprintSealed,true);
    assert.equal(liveExecute.res.body?.mainProcessQueryOnly,true);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'EXECUTE must keep the main web DB connection query-only');

    fs.rmSync(executeFile,{force:true});
    fs.writeFileSync(prepareFile,JSON.stringify({jobId:crypto.randomUUID(),status:'SUCCEEDED',workerPid:0,payload:{expiresAt:new Date(Date.now()+5*60_000).toISOString()}}),'utf8');
    const waitingExecute=runGuard(request('PATCH','/api/settings'));
    assert.equal(waitingExecute.nextCalled,false,'verified backup waiting for execute must keep writes frozen');
    assert.equal(waitingExecute.res.body?.protectedBy,'PREPARE:SUCCEEDED');
    assert.equal(waitingExecute.res.body?.fingerprintSealed,true);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1);

    const sealedControl=runGuard(request('POST','/api/admin/data-purge/execute'));
    assert.equal(sealedControl.nextCalled,true,'trusted purge control stays reachable after seal');
    assert.equal(sealedControl.req.v505PurgeReadOnlyAuth,true);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,1,'sealed control recovery must stay read-only on the shared web connection');

    fs.writeFileSync(prepareFile,JSON.stringify({jobId:crypto.randomUUID(),status:'RUNNING',workerPid:2147483647,heartbeatAt:Date.now()-120_000}),'utf8');
    const confirmedDead=runGuard(request('POST','/api/unified-import'));
    assert.equal(confirmedDead.nextCalled,true,'confirmed-dead worker must not create an endless external write freeze once SQLite block is expired');
    assert.equal(db.prepare('PRAGMA query_only').get().query_only,0,'main DB returns to writable mode only after no sealed/active purge truth remains');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
