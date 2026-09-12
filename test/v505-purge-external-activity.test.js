import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('V505 blocks purge for live/recent export work and ignores only confirmed stale export files',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-export-activity-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  const {getRuntimeConfig}=await import('../src/db.js');
  const {inspectActiveExportJobs,inspectExportSubmissionAdmission,assertNoActiveExportJobs,V505_EXPORT_SUBMISSION_MUTEX_FILE}=await import('../src/v505PurgeExternalActivity.js');
  const cfg=getRuntimeConfig();
  const jobsDir=path.join(cfg.dataDir,'export_jobs');fs.mkdirSync(jobsDir,{recursive:true});
  const file=path.join(jobsDir,'EXP-20260911-V505TEST0001.json');
  try{
    fs.writeFileSync(file,JSON.stringify({jobId:'EXP-20260911-V505TEST0001',status:'RUNNING',workerPid:process.pid,heartbeatAt:new Date(Date.now()-2*60*60_000).toISOString(),payload:{businessType:'SHOPEECN'}}),'utf8');
    let state=inspectActiveExportJobs();
    assert.equal(state.active,true);
    assert.equal(state.jobs[0]?.workerState,'ALIVE','live worker PID stays authoritative even with an old heartbeat');
    assert.throws(()=>assertNoActiveExportJobs(),error=>error?.code==='DATA_PURGE_EXPORT_ACTIVE');

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

    const staleAt=new Date(Date.now()-2*60*60_000).toISOString();
    fs.writeFileSync(file,JSON.stringify({jobId:'EXP-20260911-V505TEST0001',status:'RUNNING',workerPid:2147483647,updatedAt:staleAt,payload:{businessType:'ALL'}}),'utf8');
    const old=new Date(Date.now()-2*60*60_000);fs.utimesSync(file,old,old);
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
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
