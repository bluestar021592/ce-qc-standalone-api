import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('V505 detached worker PID claim uses an atomic live-owner lock and recovers only dead lock owners',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-worker-claim-lock-'));
  const jobFile=path.join(dir,'execute.job.json');
  const lockFile=`${jobFile}.worker-claim.lock`;
  const jobId=crypto.randomUUID();
  const {claimPurgeWorkerSidecar,V505_PURGE_WORKER_CLAIM_ID}=await import('../src/v505PurgeWorkerClaim.js');

  const seed=()=>fs.writeFileSync(jobFile,JSON.stringify({
    kind:'EXECUTE',jobId,status:'QUEUED',workerPid:0,
    submittedAt:Date.now()-120_000,heartbeatAt:Date.now()-120_000,updatedAt:Date.now()-120_000
  }),'utf8');

  try{
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
    const claimed=claimPurgeWorkerSidecar({jobFile,jobId,allowedStatuses:['QUEUED','RUNNING']});
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
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
