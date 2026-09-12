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
function responseHarness(){
  return {
    statusCode:200,body:null,
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;}
  };
}

test('V505 execute admission requires exact SUCCEEDED prepare/challenge evidence but still permits same-job and durable-receipt recovery',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-execute-admission-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {v505PurgeExecuteAdmissionGuard,V505_PURGE_EXECUTE_ADMISSION_ID}=await import('../src/v505PurgeExecuteAdmissionGuard.js');
  const user={email:'execute-admission@example.test',username:'execute-admission',role:'ADMIN'};
  const key=identityKey(user);
  const cfg=getRuntimeConfig();
  const sealedDatabasePath=cfg.dbFile;
  const db=getDb();
  const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
  const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');
  fs.mkdirSync(prepareDir,{recursive:true});
  fs.mkdirSync(executeDir,{recursive:true});
  const prepareJob=path.join(prepareDir,`${key}.job.json`);
  const challengeFile=path.join(prepareDir,`${key}.challenge.json`);
  const executeJob=path.join(executeDir,`${key}.job.json`);
  const manifestFile=path.join(dir,'sealed-backup-manifest.json');
  fs.writeFileSync(manifestFile,JSON.stringify({databasePath:sealedDatabasePath}),'utf8');
  const challengeId=crypto.randomUUID();
  const future=Date.now()+10*60_000;
  const requestFor=id=>({user,body:{challengeId:id},method:'POST',originalUrl:'/api/admin/data-purge/execute'});
  const run=req=>{
    let nextCalled=false;const res=responseHarness();
    v505PurgeExecuteAdmissionGuard(req,res,()=>{nextCalled=true;});
    return {nextCalled,res,req};
  };
  const writeReceipt=value=>db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('data_purge_last_commit_receipt',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(typeof value==='string'?value:JSON.stringify(value),new Date().toISOString());
  const clearReceipt=()=>db.prepare("DELETE FROM app_meta WHERE key='data_purge_last_commit_receipt'").run();
  try{
    fs.writeFileSync(prepareJob,JSON.stringify({jobId:crypto.randomUUID(),status:'RUNNING',payload:null}),'utf8');
    let result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'execute must not start while PREPARE is still running');
    assert.equal(result.res.statusCode,409);
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_PREPARE_NOT_SUCCEEDED');
    assert.equal(result.res.body?.admissionPatch,V505_PURGE_EXECUTE_ADMISSION_ID);

    fs.writeFileSync(prepareJob,JSON.stringify({jobId:crypto.randomUUID(),status:'SUCCEEDED',payload:{challengeId:crypto.randomUUID(),expiresAt:new Date(future).toISOString()}}),'utf8');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'a challenge unrelated to the completed backup must not start DELETE');
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_PREPARE_CHALLENGE_MISMATCH');

    fs.writeFileSync(prepareJob,JSON.stringify({jobId:crypto.randomUUID(),status:'SUCCEEDED',payload:{challengeId,expiresAt:new Date(future).toISOString(),databasePath:sealedDatabasePath}}),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({challengeId,payload:{databasePath:sealedDatabasePath},challenge:{expiresAt:future,backup:{filePath:path.join(dir,'safe.db'),sha256:'a'.repeat(64),size:1024,integrity:'ok',manifestPath:manifestFile},sourceFingerprint:{db:{exists:true,size:123,mtimeMs:1},wal:{exists:false,size:0,mtimeMs:0}}}}),'utf8');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,true,'exact completed PREPARE + persisted challenge evidence may enter the coordinator');
    assert.equal(result.req.v505PurgeExecuteAdmission?.recovery,false);
    assert.equal(result.req.v505PurgeExecuteAdmission?.sealedDatabasePath,sealedDatabasePath);

    fs.writeFileSync(manifestFile,JSON.stringify({databasePath:path.join(dir,'different-sealed.db')}),'utf8');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'backup manifest path disagreement must fail closed before the coordinator');
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_SEALED_DB_PATH_MISMATCH');
    fs.writeFileSync(manifestFile,JSON.stringify({databasePath:sealedDatabasePath}),'utf8');

    process.env.DB_FILE=path.join(dir,'unexpected-fallback.db');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'runtime DB path drift from the sealed PREPARE path must fail closed');
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED');
    process.env.DB_FILE=sealedDatabasePath;

    writeReceipt('{malformed-json');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'malformed SQLite receipt must fail closed inside execute admission even when PREPARE evidence is valid');
    assert.equal(result.res.body?.code,'V505_PURGE_COMMIT_RECEIPT_UNREADABLE');
    clearReceipt();

    const partialChallenge=crypto.randomUUID();
    const partialJob=crypto.randomUUID();
    writeReceipt({version:2,challengeId:partialChallenge,executeJobId:partialJob,committedAt:new Date().toISOString(),finalizedAt:new Date().toISOString(),finalizationState:'BROKEN_PARTIAL_STATE'});
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'finalizedAt without exact SAFE_POSTCHECK_PASSED must never be treated as historical/safe');
    assert.equal(result.res.body?.code,'V505_PURGE_COMMIT_RECEIPT_UNREADABLE');

    writeReceipt({version:2,challengeId:partialChallenge,executeJobId:partialJob,committedAt:new Date().toISOString(),finalizationState:'SAFE_POSTCHECK_PASSED'});
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'finalizationState without finalizedAt must remain unknown committed state');
    assert.equal(result.res.body?.code,'V505_PURGE_COMMIT_RECEIPT_UNREADABLE');

    writeReceipt({version:2,challengeId:partialChallenge,executeJobId:partialJob,committedAt:new Date().toISOString(),recoveryBlockUntil:Date.now()+60*60_000});
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'an unfinalized durable receipt without its execute sidecar must block a second DELETE');
    assert.equal(result.res.body?.code,'V505_PURGE_COMMIT_RECEIPT_PENDING_RECOVERY');
    clearReceipt();

    fs.writeFileSync(executeJob,'{malformed-execute-sidecar','utf8');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'an unreadable execute sidecar is UNKNOWN state and must never be overwritten by a second DELETE job');
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_SIDECAR_UNREADABLE');

    fs.writeFileSync(executeJob,'{}','utf8');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'a structurally invalid execute sidecar is UNKNOWN state even when its JSON syntax is valid');
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_SIDECAR_UNREADABLE');

    fs.writeFileSync(executeJob,JSON.stringify({jobId:crypto.randomUUID(),challengeId,status:'NOT_A_REAL_PURGE_STATE'}),'utf8');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'an execute sidecar with an unknown status must never be treated as no task');
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_SIDECAR_UNREADABLE');
    fs.rmSync(executeJob,{force:true});

    fs.writeFileSync(executeJob,JSON.stringify({kind:'EXECUTE',jobId:crypto.randomUUID(),challengeId,status:'RUNNING',sealedDatabasePath:path.join(dir,'wrong-bound.db'),request:{challengeId}}),'utf8');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,false,'a durable execute sidecar bound to a different DB path must be rejected before receipt lookup or worker reuse');
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED');
    fs.rmSync(executeJob,{force:true});

    const oldChallenge=crypto.randomUUID();
    fs.writeFileSync(executeJob,JSON.stringify({kind:'EXECUTE',jobId:crypto.randomUUID(),challengeId:oldChallenge,status:'SUCCEEDED',completedAt:Date.now(),request:{challengeId:oldChallenge}}),'utf8');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,true,'a terminal SUCCEEDED sidecar from an older purge must yield to the newly verified challenge');
    assert.equal(result.req.v505PurgeExecuteAdmission?.recovery,false);

    const committedJobId=crypto.randomUUID();
    fs.writeFileSync(executeJob,JSON.stringify({kind:'EXECUTE',jobId:committedJobId,challengeId,status:'FAILED',failedAt:Date.now(),request:{challengeId}}),'utf8');
    writeReceipt({version:2,challengeId,executeJobId:committedJobId,committedAt:new Date().toISOString(),recoveryBlockUntil:Date.now()+60*60_000});
    fs.rmSync(prepareJob,{force:true});
    fs.rmSync(challengeFile,{force:true});

    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,true,'an exact durable receipt must recover a FAILED sidecar even after PREPARE artifacts are gone');
    assert.equal(result.req.v505PurgeExecuteAdmission?.recovery,true);
    assert.equal(result.req.v505PurgeExecuteAdmission?.status,'COMMITTED');
    assert.equal(result.req.v505PurgeExecuteAdmission?.durableReceipt,true);
    assert.equal(result.req.v505PurgeExecuteAdmission?.receiptFinalized,false);

    result=run(requestFor(crypto.randomUUID()));
    assert.equal(result.nextCalled,false,'an exact durable receipt is an active owner and must reject a different challenge');
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_ACTIVE_CHALLENGE_MISMATCH');

    const finalizedAt=new Date().toISOString();
    writeReceipt({version:2,challengeId,executeJobId:committedJobId,committedAt:new Date(Date.now()-1000).toISOString(),finalizedAt,finalizationState:'SAFE_POSTCHECK_PASSED',recoveryBlockUntil:Date.now()-1000});
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,true,'an exact fully finalized receipt remains recoverable as terminal authority');
    assert.equal(result.req.v505PurgeExecuteAdmission?.status,'FINALIZED');
    assert.equal(result.req.v505PurgeExecuteAdmission?.receiptFinalized,true);

    clearReceipt();
    fs.writeFileSync(executeJob,JSON.stringify({kind:'EXECUTE',jobId:crypto.randomUUID(),challengeId,status:'COMMITTED',request:{challengeId}}),'utf8');
    result=run(requestFor(challengeId));
    assert.equal(result.nextCalled,true,'same COMMITTED execute job recovery must remain reachable even after post-COMMIT prepare artifacts were removed');
    assert.equal(result.req.v505PurgeExecuteAdmission?.recovery,true);

    result=run(requestFor(crypto.randomUUID()));
    assert.equal(result.nextCalled,false,'an active execute job must never be reused for a different challenge');
    assert.equal(result.res.body?.code,'V505_PURGE_EXECUTE_ACTIVE_CHALLENGE_MISMATCH');
  }finally{
    process.env.DB_FILE=sealedDatabasePath;
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
