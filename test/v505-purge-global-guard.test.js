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
  const res=new EventEmitter();res.statusCode=200;res.body=null;
  res.status=function status(code){this.statusCode=code;return this;};
  res.json=function json(body){this.body=body;return this;};
  return res;
}
function requestFor(user,route='/api/admin/data-purge/prepare'){
  return {user,method:'POST',path:route,originalUrl:route,url:route};
}

test('V505 global purge guard blocks cross-admin ownership, serializes recovery, and treats durable commit receipt as authoritative', async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-global-guard-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.V505_PURGE_STARTUP_ORPHAN_STALE_MS='60000';
  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {v505PurgeGlobalOwnerGuard,V505_PURGE_GLOBAL_GUARD_ID,inspectGlobalPurgeOwnership}=await import('../src/v505PurgeGlobalGuard.js');
  const db=getDb();const cfg=getRuntimeConfig();
  const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
  const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');
  const mutexFile=path.join(cfg.backupsDir,'.purge_global_submission.lock.json');
  fs.mkdirSync(prepareDir,{recursive:true});fs.mkdirSync(executeDir,{recursive:true});
  const adminA={email:'admin-a@example.test',username:'admin-a',role:'ADMIN'};
  const adminB={email:'admin-b@example.test',username:'admin-b',role:'ADMIN'};
  const meta=db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
  const setBlock=until=>meta.run('data_purge_block_until',String(until),new Date().toISOString());
  const clearGuardState=()=>{
    db.prepare("DELETE FROM app_meta WHERE key IN ('data_purge_block_until','data_purge_last_commit_receipt')").run();
    fs.rmSync(mutexFile,{force:true});
    for(const directory of [prepareDir,executeDir]){
      for(const name of fs.readdirSync(directory)){if(name.endsWith('.job.json')||name.endsWith('.challenge.json')||name.endsWith('.worker-claim.lock'))fs.rmSync(path.join(directory,name),{force:true});}
    }
  };

  try{
    const foreignJob={jobId:crypto.randomUUID(),status:'RUNNING',email:adminA.email,submittedAt:Date.now()-180_000,startedAt:Date.now()-170_000,heartbeatAt:Date.now()-120_000,workerPid:process.pid,updatedAt:Date.now()-120_000};
    fs.writeFileSync(path.join(prepareDir,`${identityKey(adminA)}.job.json`),JSON.stringify(foreignJob),'utf8');
    setBlock(Date.now()+10*60_000);
    let foreignNext=false;const foreignRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminB),foreignRes,()=>{foreignNext=true;});
    assert.equal(foreignNext,false);assert.equal(foreignRes.statusCode,423);assert.equal(foreignRes.body?.code,'DATA_PURGE_OWNED_BY_ANOTHER_ADMIN');assert.equal(foreignRes.body?.workerState,'ALIVE');assert.equal(foreignRes.body?.guardPatch,V505_PURGE_GLOBAL_GUARD_ID);

    clearGuardState();
    let firstNext=false;const firstReq=requestFor(adminA);const firstRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(firstReq,firstRes,()=>{firstNext=true;});
    assert.equal(firstNext,true,'first submission must acquire the atomic global mutex');
    assert.equal(fs.existsSync(mutexFile),true,'submission mutex must exist outside SQLite while the route is entering its durable task queue');
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_submission_mutex'").get(),undefined,'submission mutex must never mutate the database fingerprint');
    assert.equal(typeof firstReq.v505PurgeSubmissionMutexRelease,'function','route owner must receive an explicit release callback');
    firstRes.emit('close');
    assert.equal(fs.existsSync(mutexFile),true,'client disconnect must not release the mutex while the server route may still be creating the durable job');

    let secondNext=false;const secondRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminB),secondRes,()=>{secondNext=true;});
    assert.equal(secondNext,false,'concurrent admin must not pass while the first request owns the submission mutex');
    assert.equal(secondRes.statusCode,423);assert.equal(secondRes.body?.code,'DATA_PURGE_SUBMISSION_BUSY');

    firstReq.v505PurgeSubmissionMutexRelease();
    assert.equal(fs.existsSync(mutexFile),false,'explicit route completion must release only its own submission mutex before detached work advances');
    let retryNext=false;const retryReq=requestFor(adminB);const retryRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(retryReq,retryRes,()=>{retryNext=true;});
    assert.equal(retryNext,true,'retry may proceed after the first submission has finished and no protected job exists');
    assert.equal(fs.existsSync(mutexFile),true);retryRes.emit('finish');assert.equal(fs.existsSync(mutexFile),false,'response finish remains a fallback release path');

    clearGuardState();setBlock(Date.now()+5*60_000);
    let orphanNext=false;const orphanRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminA),orphanRes,()=>{orphanNext=true;});
    assert.equal(orphanNext,false);assert.equal(orphanRes.statusCode,423);assert.equal(orphanRes.body?.code,'DATA_PURGE_GLOBAL_LOCK_ORPHANED');

    clearGuardState();
    const ownJob={...foreignJob,jobId:crypto.randomUUID(),email:adminA.email,heartbeatAt:Date.now(),updatedAt:Date.now()};
    fs.writeFileSync(path.join(prepareDir,`${identityKey(adminA)}.job.json`),JSON.stringify(ownJob),'utf8');setBlock(Date.now()+10*60_000);
    let ownerNext=false;const ownerReq=requestFor(adminA);const ownerRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(ownerReq,ownerRes,()=>{ownerNext=true;});
    assert.equal(ownerNext,true,'the owning admin must be able to recover/read its existing live prepare task');
    assert.equal(fs.existsSync(mutexFile),false,'live prepare recovery must not contend with the long-running backup for a new submission mutex');assert.equal(ownerReq.v505PurgeSubmissionMutexRelease,undefined);

    clearGuardState();
    const deadOwnJob={...foreignJob,jobId:crypto.randomUUID(),email:adminA.email,workerPid:2147483647,heartbeatAt:Date.now()-120_000,updatedAt:Date.now()-120_000};
    fs.writeFileSync(path.join(prepareDir,`${identityKey(adminA)}.job.json`),JSON.stringify(deadOwnJob),'utf8');setBlock(Date.now()+10*60_000);
    let deadRecoveryNext=false;const deadRecoveryReq=requestFor(adminA);const deadRecoveryRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(deadRecoveryReq,deadRecoveryRes,()=>{deadRecoveryNext=true;});
    assert.equal(deadRecoveryNext,true,'confirmed-dead own worker recovery may proceed under the global mutex');assert.equal(fs.existsSync(mutexFile),true,'dead-worker recovery must hold a submission mutex while it mutates job state');
    let duplicateDeadRecoveryNext=false;const duplicateDeadRecoveryRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminA),duplicateDeadRecoveryRes,()=>{duplicateDeadRecoveryNext=true;});
    assert.equal(duplicateDeadRecoveryNext,false,'a second same-owner dead-worker recovery must not race the first recovery request');assert.equal(duplicateDeadRecoveryRes.body?.code,'DATA_PURGE_SUBMISSION_BUSY');
    deadRecoveryRes.emit('finish');assert.equal(fs.existsSync(mutexFile),false);

    clearGuardState();
    const retryableExecute={jobId:crypto.randomUUID(),challengeId:crypto.randomUUID(),status:'FAILED',kind:'EXECUTE',workerPid:2147483647,failedAt:Date.now(),updatedAt:Date.now(),error:'simulated abrupt worker exit'};
    fs.writeFileSync(path.join(executeDir,`${identityKey(adminA)}.job.json`),JSON.stringify(retryableExecute),'utf8');
    setBlock(Date.now()+8*60_000);
    const retryableOwnership=inspectGlobalPurgeOwnership(adminA);
    assert.equal(retryableOwnership.orphanedLock,false,'failed execute sidecar with a live safety block is a retryable owner, not an orphan');
    assert.equal(retryableOwnership.own[0]?.workerState,'FAILED_RETRYABLE');
    let executeRetryNext=false;const executeRetryReq=requestFor(adminA,'/api/admin/data-purge/execute');const executeRetryRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(executeRetryReq,executeRetryRes,()=>{executeRetryNext=true;});
    assert.equal(executeRetryNext,true,'same owner must be allowed to retry execute while the verified-backup safety block is still valid');
    executeRetryReq.v505PurgeSubmissionMutexRelease?.();

    let foreignFailedNext=false;const foreignFailedRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminB,'/api/admin/data-purge/execute'),foreignFailedRes,()=>{foreignFailedNext=true;});
    assert.equal(foreignFailedNext,false,'another admin must not inherit a retryable failed execute lock');
    assert.equal(foreignFailedRes.body?.code,'DATA_PURGE_OWNED_BY_ANOTHER_ADMIN');
    assert.equal(foreignFailedRes.body?.workerState,'FAILED_RETRYABLE');

    // A terminal receipt must not leave a pre-finalization pid=0 startup sidecar
    // owned by another admin blocking the entire system forever. The global
    // guard retires only that old debris under both serialization layers before
    // deciding current ownership; no worker is started for it.
    clearGuardState();
    const finalizedAtMs=Date.now()-180_000;
    const oldForeignPrepareFile=path.join(prepareDir,`${identityKey(adminA)}.job.json`);
    const oldForeignChallengeFile=path.join(prepareDir,`${identityKey(adminA)}.challenge.json`);
    const oldForeignStatusToken='f'.repeat(48);
    const oldForeignPrepare={
      kind:'PREPARE',jobId:crypto.randomUUID(),statusToken:oldForeignStatusToken,status:'QUEUED',workerPid:0,
      email:adminA.email,submittedAt:finalizedAtMs-120_000,heartbeatAt:finalizedAtMs-120_000,updatedAt:finalizedAtMs-120_000,payload:null
    };
    fs.writeFileSync(oldForeignPrepareFile,JSON.stringify(oldForeignPrepare),'utf8');
    fs.writeFileSync(oldForeignChallengeFile,JSON.stringify({challengeId:'old-half-written-challenge'}),'utf8');
    const terminalReceipt={
      version:2,challengeId:crypto.randomUUID(),executeJobId:crypto.randomUUID(),
      committedAt:new Date(finalizedAtMs-10_000).toISOString(),finalizedAt:new Date(finalizedAtMs).toISOString(),
      finalizationState:'SAFE_POSTCHECK_PASSED',before:{},after:{}
    };
    meta.run('data_purge_last_commit_receipt',JSON.stringify(terminalReceipt),new Date().toISOString());
    assert.equal(inspectGlobalPurgeOwnership(adminB).foreign?.workerState,'UNKNOWN','before serialized cleanup, foreign pid=0 debris is still conservatively visible as an owner');
    let historicalNext=false;const historicalReq=requestFor(adminB);const historicalRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(historicalReq,historicalRes,()=>{historicalNext=true;});
    assert.equal(historicalNext,true,'another admin may proceed after terminal-receipt-era startup debris is atomically retired');
    assert.equal(fs.existsSync(oldForeignPrepareFile),false);
    assert.equal(fs.existsSync(oldForeignChallengeFile),false);
    assert.equal(typeof historicalReq.v505PurgeSubmissionMutexRelease,'function','the current request must still acquire its own submission mutex after the cleanup mutex is released');
    historicalReq.v505PurgeSubmissionMutexRelease();

    clearGuardState();
    const committedChallengeId=crypto.randomUUID();
    const committedJobId=crypto.randomUUID();
    const crashWindowJob={jobId:committedJobId,challengeId:committedChallengeId,request:{challengeId:committedChallengeId},status:'RUNNING',kind:'EXECUTE',workerPid:2147483647,heartbeatAt:Date.now()-120_000,updatedAt:Date.now()-120_000};
    fs.writeFileSync(path.join(executeDir,`${identityKey(adminA)}.job.json`),JSON.stringify(crashWindowJob),'utf8');
    meta.run('data_purge_last_commit_receipt',JSON.stringify({version:1,challengeId:committedChallengeId,executeJobId:committedJobId,committedAt:new Date().toISOString(),before:{daily_reports:1},after:{daily_reports:0}}),new Date().toISOString());
    const receiptOwnership=inspectGlobalPurgeOwnership(adminA);
    assert.equal(receiptOwnership.orphanedLock,false,'exact commit receipt must own the crash window even if the execute sidecar never reached COMMITTED');
    assert.equal(receiptOwnership.own[0]?.status,'COMMITTED');
    assert.equal(receiptOwnership.own[0]?.workerState,'COMMITTED_RECOVERY');
    assert.equal(receiptOwnership.own[0]?.durableReceipt,true);
    let foreignCommittedNext=false;const foreignCommittedRes=responseHarness();
    await v505PurgeGlobalOwnerGuard(requestFor(adminB),foreignCommittedRes,()=>{foreignCommittedNext=true;});
    assert.equal(foreignCommittedNext,false,'foreign admin cannot start another purge during crash-after-commit recovery');
    assert.equal(foreignCommittedRes.body?.code,'DATA_PURGE_OWNED_BY_ANOTHER_ADMIN');
    assert.equal(foreignCommittedRes.body?.status,'COMMITTED');
  }finally{
    try{clearGuardState();}catch{}try{closeDb();}catch{}fs.rmSync(dir,{recursive:true,force:true});
  }
});
