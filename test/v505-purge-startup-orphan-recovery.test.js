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

test('V505 recovers only stale unclaimed workerPid=0 startup sidecars under the global submission mutex',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-startup-orphan-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  process.env.V505_PURGE_STARTUP_ORPHAN_STALE_MS='60000';

  const {getDb,getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {
    inspectStaleUnclaimedPurgeStartup,
    recoverStaleUnclaimedPurgeStartup,
    v505PurgeStartupOrphanGuard,
    V505_PURGE_STARTUP_ORPHAN_ID
  }=await import('../src/v505PurgeStartupOrphanGuard.js');
  const {claimPurgeWorkerSidecar,V505_PURGE_WORKER_CLAIM_ID}=await import('../src/v505PurgeWorkerClaim.js');

  const user={email:'startup-orphan@example.test',username:'startup-orphan',role:'ADMIN'};
  const key=identityKey(user);
  const cfg=getRuntimeConfig();
  const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
  const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');
  fs.mkdirSync(prepareDir,{recursive:true});
  fs.mkdirSync(executeDir,{recursive:true});
  const prepareFile=path.join(prepareDir,`${key}.job.json`);
  const challengeFile=path.join(prepareDir,`${key}.challenge.json`);
  const executeFile=path.join(executeDir,`${key}.job.json`);
  const staleAt=Date.now()-180_000;
  const meta=getDb().prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
  let fakeSpawnCalls=0;
  const fakeSpawn=()=>{fakeSpawnCalls+=1;return {pid:process.pid};};

  try{
    const stalePrepareId=crypto.randomUUID();
    const prepareToken='a'.repeat(48);
    fs.writeFileSync(prepareFile,JSON.stringify({
      kind:'PREPARE',jobId:stalePrepareId,statusToken:prepareToken,status:'QUEUED',workerPid:0,
      submittedAt:staleAt,heartbeatAt:staleAt,updatedAt:staleAt,email:user.email,payload:null
    }),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({challengeId:'half-written-prepare-evidence'}),'utf8');
    meta.run('data_purge_block_until',String(Date.now()+30*60_000),new Date().toISOString());
    const blockBeforePrepareRecovery=Number(getDb().prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0);

    const preview=inspectStaleUnclaimedPurgeStartup(user);
    assert.equal(preview.prepareRecoverable,true,'stale pid=0 PREPARE must be recognized as an abandoned startup after the conservative timeout');
    assert.equal(preview.needsSerialization,true);

    let nextCalled=false;
    const blockedRes=responseHarness();
    v505PurgeStartupOrphanGuard({user},blockedRes,()=>{nextCalled=true;});
    assert.equal(nextCalled,false,'startup orphan recovery must never mutate state without the global submission mutex');
    assert.equal(blockedRes.statusCode,423);
    assert.equal(blockedRes.body?.code,'DATA_PURGE_STARTUP_ORPHAN_NEEDS_MUTEX');
    assert.equal(JSON.parse(fs.readFileSync(prepareFile,'utf8')).workerPid,0,'blocked recovery must leave evidence untouched');

    const prepareRecovered=recoverStaleUnclaimedPurgeStartup(user,{mutationAuthorized:true,spawnWorker:fakeSpawn});
    assert.equal(prepareRecovered.prepareRecovered,true);
    assert.equal(prepareRecovered.patchId,V505_PURGE_STARTUP_ORPHAN_ID);
    assert.equal(prepareRecovered.prepareRecovery?.claimedByParent,false,'recovery parent must never write workerPid after spawning because the child owns the atomic claim');
    assert.equal(prepareRecovered.prepareRecovery?.reason,'CHILD_CLAIM_REQUIRED');
    assert.equal(prepareRecovered.prepareRecovery?.pid,process.pid);
    const restartedPrepare=JSON.parse(fs.readFileSync(prepareFile,'utf8'));
    assert.equal(restartedPrepare.jobId,stalePrepareId,'PREPARE startup recovery must keep the same durable job id/status channel');
    assert.equal(restartedPrepare.workerPid,0,'parent persists only recovery intent; detached child performs the authoritative PID claim as its first instruction');
    assert.equal(restartedPrepare.startupRecoveryPatch,V505_PURGE_STARTUP_ORPHAN_ID);
    assert.equal(fs.existsSync(challengeFile),false,'half-written PREPARE challenge evidence must be retired before the same job rebuilds its verified backup');
    assert.equal(Number(getDb().prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0),blockBeforePrepareRecovery,'same-job PREPARE recovery keeps the write freeze continuously sealed');

    const challengeId=crypto.randomUUID();
    const future=Date.now()+10*60_000;
    fs.writeFileSync(prepareFile,JSON.stringify({
      kind:'PREPARE',jobId:crypto.randomUUID(),status:'SUCCEEDED',workerPid:0,email:user.email,
      payload:{challengeId,expiresAt:new Date(future).toISOString()}
    }),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({challengeId,challenge:{expiresAt:future}}),'utf8');
    meta.run('data_purge_block_until',String(Date.now()+30*60_000),new Date().toISOString());
    const blockBefore=Number(getDb().prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0);

    const staleExecuteId=crypto.randomUUID();
    const executeToken='b'.repeat(48);
    fs.writeFileSync(executeFile,JSON.stringify({
      kind:'EXECUTE',jobId:staleExecuteId,challengeId,statusToken:executeToken,status:'QUEUED',workerPid:0,
      submittedAt:staleAt,heartbeatAt:staleAt,updatedAt:staleAt,user,request:{challengeId}
    }),'utf8');
    const executeRecovered=recoverStaleUnclaimedPurgeStartup(user,{mutationAuthorized:true,spawnWorker:fakeSpawn});
    assert.equal(executeRecovered.executeRecovered,true,'stale unclaimed pre-COMMIT EXECUTE must restart the same durable job rather than create a second DELETE identity');
    assert.equal(executeRecovered.executeRecovery?.claimedByParent,false);
    assert.equal(executeRecovered.executeRecovery?.reason,'CHILD_CLAIM_REQUIRED');
    const restartedExecute=JSON.parse(fs.readFileSync(executeFile,'utf8'));
    assert.equal(restartedExecute.jobId,staleExecuteId);
    assert.equal(restartedExecute.workerPid,0,'recovery parent must not race the destructive child sidecar claim');
    assert.equal(restartedExecute.startupRecoveryPatch,V505_PURGE_STARTUP_ORPHAN_ID);
    assert.equal(fs.existsSync(prepareFile),true,'verified PREPARE evidence must survive EXECUTE startup recovery');
    assert.equal(fs.existsSync(challengeFile),true,'persisted challenge must survive EXECUTE startup recovery');
    assert.equal(Number(getDb().prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value||0),blockBefore,'EXECUTE startup recovery must preserve the sealed safety block');

    const pendingOtherReceipt={
      version:2,challengeId:crypto.randomUUID(),executeJobId:crypto.randomUUID(),committedAt:new Date().toISOString(),
      recoveryBlockUntil:Date.now()+60*60_000,before:{},after:{}
    };
    const pendingJobId=crypto.randomUUID();
    fs.writeFileSync(executeFile,JSON.stringify({
      kind:'EXECUTE',jobId:pendingJobId,challengeId,statusToken:executeToken,status:'QUEUED',workerPid:0,
      submittedAt:staleAt,heartbeatAt:staleAt,updatedAt:staleAt,user,request:{challengeId}
    }),'utf8');
    meta.run('data_purge_last_commit_receipt',JSON.stringify(pendingOtherReceipt),new Date().toISOString());
    assert.equal(inspectStaleUnclaimedPurgeStartup(user).executeRecoverable,false,'any unfinalized durable receipt blocks startup respawn for another destructive generation');
    recoverStaleUnclaimedPurgeStartup(user,{mutationAuthorized:true,spawnWorker:fakeSpawn});
    assert.equal(JSON.parse(fs.readFileSync(executeFile,'utf8')).workerPid,0,'pending durable receipt must leave the ambiguous startup sidecar untouched');
    getDb().prepare("DELETE FROM app_meta WHERE key='data_purge_last_commit_receipt'").run();

    const historicalFinalizedMs=Date.now()-300_000;
    const historicalFinalizedReceipt={
      version:2,challengeId:crypto.randomUUID(),executeJobId:crypto.randomUUID(),
      committedAt:new Date(historicalFinalizedMs-10_000).toISOString(),
      finalizedAt:new Date(historicalFinalizedMs).toISOString(),finalizationState:'SAFE_POSTCHECK_PASSED',
      recoveryBlockUntil:historicalFinalizedMs,before:{},after:{}
    };
    meta.run('data_purge_last_commit_receipt',JSON.stringify(historicalFinalizedReceipt),new Date().toISOString());
    getDb().prepare("DELETE FROM app_meta WHERE key='data_purge_block_until'").run();

    const newerExecuteId=crypto.randomUUID();
    fs.writeFileSync(executeFile,JSON.stringify({
      kind:'EXECUTE',jobId:newerExecuteId,challengeId,statusToken:executeToken,status:'QUEUED',workerPid:0,
      submittedAt:staleAt,heartbeatAt:staleAt,updatedAt:staleAt,user,request:{challengeId}
    }),'utf8');
    assert.equal(inspectStaleUnclaimedPurgeStartup(user).executeRecoverable,true,'a stale startup submitted after an older finalized receipt belongs to a newer generation and may recover');
    const newerExecuteRecovered=recoverStaleUnclaimedPurgeStartup(user,{mutationAuthorized:true,spawnWorker:fakeSpawn});
    assert.equal(newerExecuteRecovered.executeRecovered,true);
    assert.equal(newerExecuteRecovered.executeRecovery?.reason,'CHILD_CLAIM_REQUIRED');
    assert.equal(JSON.parse(fs.readFileSync(executeFile,'utf8')).jobId,newerExecuteId);
    assert.equal(JSON.parse(fs.readFileSync(executeFile,'utf8')).workerPid,0);
    fs.rmSync(executeFile,{force:true});

    const newerPrepareId=crypto.randomUUID();
    const newerPrepareToken='c'.repeat(48);
    fs.writeFileSync(prepareFile,JSON.stringify({
      kind:'PREPARE',jobId:newerPrepareId,statusToken:newerPrepareToken,status:'QUEUED',workerPid:0,
      submittedAt:staleAt,heartbeatAt:staleAt,updatedAt:staleAt,email:user.email,payload:null
    }),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({challengeId:'newer-half-written-prepare-evidence'}),'utf8');
    assert.equal(inspectStaleUnclaimedPurgeStartup(user).prepareRecoverable,true,'a newer PREPARE has no challenge yet, so finalized-receipt generation ordering must use its durable submittedAt timestamp');
    const newerPrepareRecovered=recoverStaleUnclaimedPurgeStartup(user,{mutationAuthorized:true,spawnWorker:fakeSpawn});
    assert.equal(newerPrepareRecovered.prepareRecovered,true);
    assert.equal(newerPrepareRecovered.prepareRecovery?.reason,'CHILD_CLAIM_REQUIRED');
    assert.equal(JSON.parse(fs.readFileSync(prepareFile,'utf8')).jobId,newerPrepareId);
    assert.equal(JSON.parse(fs.readFileSync(prepareFile,'utf8')).workerPid,0);
    assert.equal(fs.existsSync(challengeFile),false);
    fs.rmSync(prepareFile,{force:true});

    const olderThanFinalized=historicalFinalizedMs-120_000;
    const oldDebrisExecuteId=crypto.randomUUID();
    fs.writeFileSync(executeFile,JSON.stringify({
      kind:'EXECUTE',jobId:oldDebrisExecuteId,challengeId,statusToken:executeToken,status:'QUEUED',workerPid:0,
      submittedAt:olderThanFinalized,heartbeatAt:olderThanFinalized,updatedAt:olderThanFinalized,user,request:{challengeId}
    }),'utf8');
    const oldExecutePreview=inspectStaleUnclaimedPurgeStartup(user);
    assert.equal(oldExecutePreview.executeRecoverable,false,'pre-finalization mismatched execute debris must never respawn');
    assert.equal(oldExecutePreview.executeRetirable,true,'pre-finalization startup debris can be safely retired because the later receipt is already terminal');
    const spawnCallsBeforeExecuteRetire=fakeSpawnCalls;
    const oldExecuteRetired=recoverStaleUnclaimedPurgeStartup(user,{mutationAuthorized:true,spawnWorker:fakeSpawn});
    assert.equal(oldExecuteRetired.executeRetired,true);
    assert.equal(fs.existsSync(executeFile),false,'retired historical EXECUTE startup debris must stop owning later purge controls');
    assert.equal(fakeSpawnCalls,spawnCallsBeforeExecuteRetire,'historical EXECUTE debris retirement must not launch any worker');

    const oldDebrisPrepareId=crypto.randomUUID();
    const oldPrepareToken='d'.repeat(48);
    fs.writeFileSync(prepareFile,JSON.stringify({
      kind:'PREPARE',jobId:oldDebrisPrepareId,statusToken:oldPrepareToken,status:'QUEUED',workerPid:0,
      submittedAt:olderThanFinalized,heartbeatAt:olderThanFinalized,updatedAt:olderThanFinalized,email:user.email,payload:null
    }),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({
      challengeId:'old-debris-half-written-challenge',
      challenge:{createdAt:olderThanFinalized},updatedAt:olderThanFinalized
    }),'utf8');
    const oldPreparePreview=inspectStaleUnclaimedPurgeStartup(user);
    assert.equal(oldPreparePreview.prepareRecoverable,false,'pre-finalization PREPARE debris cannot be guessed to be a new generation');
    assert.equal(oldPreparePreview.prepareRetirable,true);
    const spawnCallsBeforePrepareRetire=fakeSpawnCalls;
    const oldPrepareRetired=recoverStaleUnclaimedPurgeStartup(user,{mutationAuthorized:true,spawnWorker:fakeSpawn});
    assert.equal(oldPrepareRetired.prepareRetired,true);
    assert.equal(fs.existsSync(prepareFile),false);
    assert.equal(fs.existsSync(challengeFile),false,'a challenge provably created before the terminal receipt may be retired with the old PREPARE sidecar');
    assert.equal(oldPrepareRetired.prepareRetirement?.challengeRetirement?.removed,true);
    assert.equal(oldPrepareRetired.prepareRetirement?.challengeRetirement?.reason,'PRE_FINALIZATION_CHALLENGE');
    assert.equal(fakeSpawnCalls,spawnCallsBeforePrepareRetire,'historical PREPARE debris retirement must not launch any worker');

    // The old PREPARE sidecar and the per-user challenge file can belong to
    // different generations after a crash. Never delete a challenge that is
    // provably newer than the terminal receipt merely because its sidecar path
    // is the same per-user filename.
    const crossGenerationPrepareId=crypto.randomUUID();
    const newerChallengeId=crypto.randomUUID();
    const newerChallengeAt=historicalFinalizedMs+60_000;
    fs.writeFileSync(prepareFile,JSON.stringify({
      kind:'PREPARE',jobId:crossGenerationPrepareId,statusToken:'e'.repeat(48),status:'RUNNING',workerPid:0,
      submittedAt:olderThanFinalized,heartbeatAt:olderThanFinalized,updatedAt:olderThanFinalized,email:user.email,payload:null
    }),'utf8');
    fs.writeFileSync(challengeFile,JSON.stringify({
      challengeId:newerChallengeId,challenge:{createdAt:newerChallengeAt,expiresAt:newerChallengeAt+10*60_000},updatedAt:newerChallengeAt
    }),'utf8');
    const crossGenerationRetire=recoverStaleUnclaimedPurgeStartup(user,{mutationAuthorized:true,spawnWorker:fakeSpawn});
    assert.equal(crossGenerationRetire.prepareRetired,true,'historical PREPARE sidecar itself is still safe to retire');
    assert.equal(fs.existsSync(prepareFile),false);
    assert.equal(fs.existsSync(challengeFile),true,'newer challenge evidence must survive retirement of an older same-user PREPARE sidecar');
    assert.equal(JSON.parse(fs.readFileSync(challengeFile,'utf8')).challengeId,newerChallengeId);
    assert.equal(crossGenerationRetire.prepareRetirement?.challengeRetirement?.reason,'NEWER_CHALLENGE_PRESERVED');
    fs.rmSync(challengeFile,{force:true});
    getDb().prepare("DELETE FROM app_meta WHERE key='data_purge_last_commit_receipt'").run();

    fs.writeFileSync(executeFile,JSON.stringify({
      kind:'EXECUTE',jobId:crypto.randomUUID(),challengeId,statusToken:executeToken,status:'COMMITTED',workerPid:0,
      submittedAt:staleAt,heartbeatAt:staleAt,updatedAt:staleAt,user,request:{challengeId}
    }),'utf8');
    const committedPreview=inspectStaleUnclaimedPurgeStartup(user);
    assert.equal(committedPreview.executeRecoverable,false,'COMMITTED + pid=0 is never treated as an abandoned pre-commit startup');
    assert.equal(committedPreview.executeRetirable,false);
    recoverStaleUnclaimedPurgeStartup(user,{mutationAuthorized:true,spawnWorker:fakeSpawn});
    assert.equal(JSON.parse(fs.readFileSync(executeFile,'utf8')).workerPid,0,'COMMITTED evidence must remain fail-closed for exact receipt recovery/manual investigation');

    fs.writeFileSync(executeFile,JSON.stringify({
      kind:'EXECUTE',jobId:crypto.randomUUID(),challengeId,statusToken:executeToken,status:'RUNNING',workerPid:process.pid,
      submittedAt:staleAt,heartbeatAt:staleAt,updatedAt:staleAt,user,request:{challengeId}
    }),'utf8');
    const livePreview=inspectStaleUnclaimedPurgeStartup(user);
    assert.equal(livePreview.executeRecoverable,false,'known live worker PID remains authoritative even with a stale heartbeat');
    assert.equal(livePreview.executeRetirable,false);

    const claimFile=path.join(dir,'claim.job.json');
    const claimJobId=crypto.randomUUID();
    fs.writeFileSync(claimFile,JSON.stringify({jobId:claimJobId,status:'QUEUED',workerPid:0,heartbeatAt:staleAt,updatedAt:staleAt}),'utf8');
    const claimed=claimPurgeWorkerSidecar({jobFile:claimFile,jobId:claimJobId,allowedStatuses:['QUEUED','RUNNING']});
    assert.equal(claimed.workerPid,process.pid,'detached child must claim its PID before startup delay/DB work');
    assert.equal(claimed.workerClaimPatch,V505_PURGE_WORKER_CLAIM_ID);
    assert.ok(Number(claimed.heartbeatAt)>staleAt);
    assert.equal(JSON.parse(fs.readFileSync(claimFile,'utf8')).workerPid,process.pid);
    assert.throws(()=>claimPurgeWorkerSidecar({jobFile:claimFile,jobId:crypto.randomUUID(),allowedStatuses:['QUEUED']}),/V505_PURGE_WORKER_CLAIM_JOB_MISMATCH/,'late worker from a replaced job cannot claim the current sidecar');

    const prepareWorkerSource=fs.readFileSync(new URL('../scripts/CE_QC_PurgePrepareTaskWorker.mjs',import.meta.url),'utf8');
    const executeWorkerSource=fs.readFileSync(new URL('../scripts/CE_QC_PurgeExecuteTaskWorker.mjs',import.meta.url),'utf8');
    assert.ok(prepareWorkerSource.indexOf('claimPurgeWorkerSidecar')>=0&&prepareWorkerSource.indexOf('claimPurgeWorkerSidecar')<prepareWorkerSource.indexOf('const delayMs'),'PREPARE child must claim PID before its startup delay');
    assert.ok(executeWorkerSource.indexOf('claimPurgeWorkerSidecar')>=0&&executeWorkerSource.indexOf('claimPurgeWorkerSidecar')<executeWorkerSource.indexOf('const delay='),'EXECUTE child must claim PID before its startup delay');
    assert.ok(executeWorkerSource.indexOf('claimPurgeWorkerSidecar')<executeWorkerSource.indexOf('assertPurgeExecuteReadOnlyPreflight(payload)'),'EXECUTE PID claim must happen before readonly preflight while destructive coordinator import remains later');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});