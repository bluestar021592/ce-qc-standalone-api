import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { classifyV541PurgePidOwnership } from '../src/v541PurgePidOwnership.js';

function waitForSpawn(child,timeoutMs=5000){
  if(Number(child?.pid||0)>0)return Promise.resolve(child.pid);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('child spawn timeout')),timeoutMs);
    child.once('spawn',()=>{clearTimeout(timer);resolve(child.pid);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
  });
}
function stopChild(child){
  if(!child)return;
  try{child.kill();}catch{}
  try{process.kill(child.pid,'SIGKILL');}catch{}
}
function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}

test('V541 PID ownership classifier releases only proven reuse and keeps unknown live identity fail-closed',()=>{
  const ownerAt=1_800_000_000_000;
  assert.equal(classifyV541PurgePidOwnership({workerState:'DEAD',ownerAcquiredAt:ownerAt,processStartedAt:0}).stale,true);
  const reused=classifyV541PurgePidOwnership({workerState:'ALIVE',ownerAcquiredAt:ownerAt,processStartedAt:ownerAt+60_000,toleranceMs:5000});
  assert.equal(reused.active,false);assert.equal(reused.stale,true);assert.equal(reused.identityState,'PID_REUSED');
  const owner=classifyV541PurgePidOwnership({workerState:'ALIVE',ownerAcquiredAt:ownerAt,processStartedAt:ownerAt-60_000,toleranceMs:5000});
  assert.equal(owner.active,true);assert.equal(owner.identityState,'START_MATCH');
  const unknown=classifyV541PurgePidOwnership({workerState:'ALIVE',ownerAcquiredAt:ownerAt,processStartedAt:0,toleranceMs:5000});
  assert.equal(unknown.active,true);assert.equal(unknown.stale,false);assert.equal(unknown.identityState,'START_UNVERIFIED');
});

test('V541 Windows integration recovers a global submission mutex whose numeric PID was recycled', {skip:process.platform!=='win32'}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v541-global-mutex-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  await waitForSpawn(child);
  try{
    const {getRuntimeConfig,closeDb}=await import('../src/db.js');
    const {acquireGlobalPurgeSubmissionMutex,releaseGlobalPurgeSubmissionMutex}=await import('../src/v505PurgeGlobalGuard.js');
    const cfg=getRuntimeConfig();
    const lockFile=path.join(cfg.backupsDir,'.purge_global_submission.lock.json');
    fs.mkdirSync(path.dirname(lockFile),{recursive:true});
    fs.writeFileSync(lockFile,JSON.stringify({
      ownerKey:'old-owner',pid:child.pid,processInstanceToken:'old-process',requestToken:crypto.randomUUID(),
      acquiredAt:Date.now()-2*60*60_000
    }),'utf8');
    const acquired=acquireGlobalPurgeSubmissionMutex({email:'v541-admin@example.test'});
    assert.equal(acquired.acquired,true,'proven recycled PID must not freeze the global purge submission mutex');
    assert.equal(acquired.recoveredStale,true);
    assert.equal(acquired.recoveryReason,'PID_REUSED');
    assert.equal(releaseGlobalPurgeSubmissionMutex(acquired.record),true);
    try{closeDb();}catch{}
  }finally{
    stopChild(child);
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});

test('V541 Windows coordinator treats recycled PREPARE and EXECUTE worker PIDs as dead owners', {skip:process.platform!=='win32'}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v541-coordinator-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  await waitForSpawn(child);
  let closeDb=()=>{};
  try{
    const dbModule=await import('../src/db.js');closeDb=dbModule.closeDb;
    const cfg=dbModule.getRuntimeConfig();dbModule.getDb();
    const {inspectLivePrepareJob,inspectExecutionRecovery}=await import('../src/v505PurgeCoordinator.js');
    const user={email:'v541-coordinator@example.test',role:'ADMIN'};const key=identityKey(user);
    const oldAt=Date.now()-2*60*60_000;
    const prepareDir=path.join(cfg.backupsDir,'.purge_prepare_jobs');
    const executeDir=path.join(cfg.backupsDir,'.purge_execute_jobs');
    fs.mkdirSync(prepareDir,{recursive:true});fs.mkdirSync(executeDir,{recursive:true});
    const prepareFile=path.join(prepareDir,`${key}.job.json`);
    fs.writeFileSync(prepareFile,JSON.stringify({
      jobId:crypto.randomUUID(),status:'RUNNING',email:user.email,submittedAt:oldAt-10_000,startedAt:oldAt,
      workerClaimedAt:oldAt,heartbeatAt:oldAt,updatedAt:oldAt,workerPid:child.pid
    }),'utf8');
    const prepare=inspectLivePrepareJob(user);
    assert.equal(prepare?.dead,true);assert.equal(prepare?.ownership?.identityState,'PID_REUSED');
    fs.rmSync(prepareFile,{force:true});

    const executeFile=path.join(executeDir,`${key}.job.json`);
    const executeJob={
      kind:'EXECUTE',jobId:crypto.randomUUID(),challengeId:crypto.randomUUID(),status:'RUNNING',
      submittedAt:oldAt-10_000,startedAt:oldAt,workerClaimedAt:oldAt,heartbeatAt:oldAt,updatedAt:oldAt,
      workerPid:child.pid,request:{challengeId:'no-receipt'}
    };
    fs.writeFileSync(executeFile,JSON.stringify(executeJob),'utf8');
    const recovery=inspectExecutionRecovery(user);
    assert.equal(recovery?.status,'FAILED','recycled execute PID without commit receipt must enter non-destructive failed recovery, not stay RUNNING forever');
    const persisted=JSON.parse(fs.readFileSync(executeFile,'utf8'));
    assert.equal(persisted.status,'FAILED');assert.match(String(persisted.error||persisted.message||''),/PID.*复用|进程已不存在/);
  }finally{
    stopChild(child);
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});
