import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('V537 blocks real live/recent export work but ignores stale sidecars whose PID was reused by another process',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-export-activity-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  const {getRuntimeConfig}=await import('../src/db.js');
  const {inspectActiveExportJobs,inspectExportSubmissionAdmission,assertNoActiveExportJobs,V505_EXPORT_SUBMISSION_MUTEX_FILE}=await import('../src/v505PurgeExternalActivity.js');
  const cfg=getRuntimeConfig();
  const jobsDir=path.join(cfg.dataDir,'export_jobs');fs.mkdirSync(jobsDir,{recursive:true});
  const file=path.join(jobsDir,'EXP-20260911-V505TEST0001.json');
  let confirmedWorker=null;
  try{
    const staleAt=new Date(Date.now()-2*60*60_000).toISOString();
    const old=new Date(Date.now()-2*60*60_000);

    // A stale job can point at a numeric PID that Windows has since reused for an
    // unrelated process. The current test process is deliberately not an export
    // worker; V537 must prove that mismatch instead of treating PID existence as
    // permanent export ownership.
    fs.writeFileSync(file,JSON.stringify({jobId:'EXP-20260911-V505TEST0001',status:'RUNNING',workerPid:process.pid,heartbeatAt:staleAt,updatedAt:staleAt,payload:{businessType:'SHOPEECN'}}),'utf8');
    fs.utimesSync(file,old,old);
    let state=inspectActiveExportJobs();
    assert.equal(state.active,false,'old sidecar + reused unrelated PID must not block purge forever');

    // Conversely, an old heartbeat must still block when OS process identity
    // proves that the PID belongs to this exact export job file.
    confirmedWorker=spawn(process.execPath,['-e','setInterval(()=>{},1000)','v183SingleBusinessExportJobWorker.js',file],{stdio:'ignore',windowsHide:true});
    await wait(250);
    fs.writeFileSync(file,JSON.stringify({jobId:'EXP-20260911-V505TEST0001',status:'RUNNING',workerPid:confirmedWorker.pid,heartbeatAt:staleAt,updatedAt:staleAt,payload:{businessType:'SHOPEECN'}}),'utf8');
    fs.utimesSync(file,old,old);
    state=inspectActiveExportJobs();
    assert.equal(state.active,true,'exact live export worker identity stays authoritative even with an old heartbeat');
    assert.equal(state.jobs[0]?.workerState,'ALIVE_CONFIRMED_OLD');
    assert.equal(state.jobs[0]?.identityState,'MATCH');
    assert.throws(()=>assertNoActiveExportJobs(),error=>error?.code==='DATA_PURGE_EXPORT_ACTIVE');
    confirmedWorker.kill();confirmedWorker=null;
    await wait(100);

    fs.writeFileSync(file,JSON.stringify({jobId:'EXP-20260911-V505TEST0001',status:'QUEUED',workerPid:0,updatedAt:new Date().toISOString(),payload:{businessType:'ALL'}}),'utf8');
    state=inspectActiveExportJobs();
    assert.equal(state.active,true);
    assert.equal(state.jobs[0]?.workerState,'UNKNOWN_RECENT','recent queued export with no PID fails closed during the handoff window');

    fs.writeFileSync(file,'{"partial-export-sidecar"','utf8');
    state=inspectActiveExportJobs();
    assert.equal(state.active,true,'a recent unreadable export sidecar is unknown active state and must block destructive purge');
    assert.equal(state.jobs[0]?.workerState,'SIDECAR_UNREADABLE_RECENT');
    assert.equal(state.jobs[0]?.status,'UNKNOWN');
    assert.throws(()=>assertNoActiveExportJobs(),error=>error?.code==='DATA_PURGE_EXPORT_ACTIVE');

    fs.writeFileSync(file,JSON.stringify({jobId:'EXP-20260911-V505TEST0001',status:'NOT_A_REAL_EXPORT_STATE'}),'utf8');
    state=inspectActiveExportJobs();
    assert.equal(state.active,true,'a recent structurally invalid/unknown export state must fail closed rather than be interpreted as terminal');
    assert.equal(state.jobs[0]?.workerState,'SIDECAR_INVALID_RECENT');
    assert.throws(()=>assertNoActiveExportJobs(),error=>error?.code==='DATA_PURGE_EXPORT_ACTIVE');

    fs.writeFileSync(file,'{}','utf8');
    state=inspectActiveExportJobs();
    assert.equal(state.active,true,'recent JSON missing jobId/status is still unknown export ownership');
    assert.equal(state.jobs[0]?.workerState,'SIDECAR_INVALID_RECENT');

    fs.writeFileSync(file,JSON.stringify({jobId:'EXP-20260911-V505TEST0001',status:'RUNNING',workerPid:2147483647,updatedAt:staleAt,payload:{businessType:'ALL'}}),'utf8');
    fs.utimesSync(file,old,old);
    state=inspectActiveExportJobs();
    assert.equal(state.active,false,'confirmed-dead and old export state must not block purge forever');

    fs.writeFileSync(file,'{"old-broken-export-sidecar"','utf8');
    fs.utimesSync(file,old,old);
    state=inspectActiveExportJobs();
    assert.equal(state.active,false,'an unreadable export artifact older than the conservative unknown-state window is historical debris, not a permanent purge lock');

    fs.writeFileSync(file,'{}','utf8');
    fs.utimesSync(file,old,old);
    state=inspectActiveExportJobs();
    assert.equal(state.active,false,'an old structurally invalid export artifact also ages out of the conservative unknown-state window');

    fs.rmSync(file,{force:true});
    const admissionFile=path.join(cfg.backupsDir,V505_EXPORT_SUBMISSION_MUTEX_FILE);fs.mkdirSync(path.dirname(admissionFile),{recursive:true});
    fs.writeFileSync(admissionFile,JSON.stringify({pid:process.pid,requestToken:'export-admission-test',acquiredAt:Date.now()}),'utf8');
    const admission=inspectExportSubmissionAdmission();
    assert.equal(admission.active,true);
    assert.equal(admission.workerState,'ALIVE');
    assert.throws(()=>assertNoActiveExportJobs(),error=>error?.code==='DATA_PURGE_EXPORT_SUBMISSION_BUSY','purge must yield while port 5178 is between request acceptance and durable job registration');
  }finally{
    try{confirmedWorker?.kill();}catch{}
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});
