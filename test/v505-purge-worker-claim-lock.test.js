import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('V540 detached worker claims recover only proven stale PID ownership',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-worker-claim-lock-'));
  const jobFile=path.join(dir,'execute.job.json');
  const lockFile=`${jobFile}.worker-claim.lock`;
  const jobId=crypto.randomUUID();
  const {
    claimPurgeWorkerSidecar,V505_PURGE_WORKER_CLAIM_ID,
    classifyV540WorkerPidOwnership,V540_WORKER_CLAIM_PID_REUSE_TOLERANCE_MS
  }=await import('../src/v505PurgeWorkerClaim.js');
  let child=null;

  const seed=(overrides={})=>fs.writeFileSync(jobFile,JSON.stringify({
    kind:'EXECUTE',jobId,status:'QUEUED',workerPid:0,
    submittedAt:Date.now()-120_000,heartbeatAt:Date.now()-120_000,updatedAt:Date.now()-120_000,
    ...overrides
  }),'utf8');

  try{
    const anchor=Date.now()-60_000;
    const originalOwner=classifyV540WorkerPidOwnership({workerState:'ALIVE',ownerAcquiredAt:anchor,processStartedAt:anchor-10_000});
    assert.equal(originalOwner.active,true,'a process that predates its ownership record must remain protected');
    assert.equal(originalOwner.identityState,'START_MATCH');
    const recycledOwner=classifyV540WorkerPidOwnership({workerState:'ALIVE',ownerAcquiredAt:anchor,processStartedAt:anchor+V540_WORKER_CLAIM_PID_REUSE_TOLERANCE_MS+1});
    assert.equal(recycledOwner.active,false,'a process created after the old ownership timestamp proves PID reuse');
    assert.equal(recycledOwner.stale,true);
    assert.equal(recycledOwner.workerState,'ALIVE_PID_REUSED');
    assert.equal(classifyV540WorkerPidOwnership({workerState:'ALIVE',ownerAcquiredAt:anchor,processStartedAt:0}).active,true,'missing process start must fail closed');
    assert.equal(classifyV540WorkerPidOwnership({workerState:'ALIVE',ownerAcquiredAt:0,processStartedAt:anchor}).active,true,'missing ownership timestamp must fail closed');
    assert.equal(classifyV540WorkerPidOwnership({workerState:'DEAD',ownerAcquiredAt:anchor}).active,false,'confirmed-dead owners remain recoverable');

    seed();
    fs.writeFileSync(lockFile,JSON.stringify({jobId,pid:process.pid,token:crypto.randomUUID(),acquiredAt:Date.now()}),'utf8');
    assert.throws(
      ()=>claimPurgeWorkerSidecar({jobFile,jobId,allowedStatuses:['QUEUED','RUNNING']}),
      error=>error?.code==='V505_PURGE_WORKER_CLAIM_BUSY',
      'a live claim-lock owner must serialize concurrent detached children before either can overwrite workerPid'
    );
    assert.equal(JSON.parse(fs.readFileSync(jobFile,'utf8')).workerPid,0,'blocked concurrent claim must not mutate the durable job sidecar');
    fs.rmSync(lockFile,{force:true});

    seed();
    fs.writeFileSync(lockFile,JSON.stringify({jobId,pid:2147483647,token:crypto.randomUUID(),acquiredAt:Date.now()-120_000}),'utf8');
    let claimed=claimPurgeWorkerSidecar({jobFile,jobId,allowedStatuses:['QUEUED','RUNNING']});
    assert.equal(claimed.workerPid,process.pid,'dead claim-lock owner may be recovered by the replacement child for the same durable job');
    assert.equal(claimed.workerClaimPatch,V505_PURGE_WORKER_CLAIM_ID);
    assert.equal(fs.existsSync(lockFile),false,'successful claim must release its short-lived serialization lock');

    seed();
    fs.writeFileSync(lockFile,'{"broken"','utf8');
    assert.throws(
      ()=>claimPurgeWorkerSidecar({jobFile,jobId,allowedStatuses:['QUEUED','RUNNING']}),
      error=>error?.code==='V505_PURGE_WORKER_CLAIM_LOCK_UNREADABLE',
      'unreadable claim ownership must fail closed instead of guessing the lock is stale'
    );
    assert.equal(JSON.parse(fs.readFileSync(jobFile,'utf8')).workerPid,0);
    fs.rmSync(lockFile,{force:true});

    if(process.platform==='win32'){
      const ancient=Date.now()-60*60_000;

      seed();
      fs.writeFileSync(lockFile,JSON.stringify({jobId,pid:process.pid,token:crypto.randomUUID(),acquiredAt:ancient}),'utf8');
      claimed=claimPurgeWorkerSidecar({jobFile,jobId,allowedStatuses:['QUEUED','RUNNING']});
      assert.equal(claimed.workerPid,process.pid,'Windows process creation time must recover a lock whose numeric PID was reused later');
      assert.equal(fs.existsSync(lockFile),false);

      child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
      await wait(250);
      seed({workerPid:child.pid,workerClaimedAt:ancient,startedAt:ancient,heartbeatAt:ancient,updatedAt:ancient});
      claimed=claimPurgeWorkerSidecar({jobFile,jobId,allowedStatuses:['QUEUED','RUNNING']});
      assert.equal(claimed.workerPid,process.pid,'a live unrelated process holding a recycled numeric worker PID must not permanently block the purge worker');
      assert.ok(claimed.workerClaimedAt>ancient,'replacement claim must reset ownership time to the current worker generation');
      child.kill();child=null;
    }
  }finally{
    try{child?.kill();}catch{}
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});
