import assert from 'node:assert/strict';
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
function request(method,pathname,user=null){return {method,path:pathname,originalUrl:pathname,url:pathname,user};}

test('V505 submission mutex closes new admissions while pre-existing main API work drains',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v505-http-drain-'));
  process.env.DATA_DIR=dir;
  process.env.DB_FILE=path.join(dir,'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH='1';
  const {getRuntimeConfig,closeDb}=await import('../src/db.js');
  const {v505TrackMainApiActivity,inspectMainApiActivity}=await import('../src/v505PurgeHttpActivity.js');
  const {v505PurgeGlobalOwnerGuard}=await import('../src/v505PurgeGlobalGuard.js');
  const {v505PurgeWriteFreezeGuard}=await import('../src/v505PurgeWriteFreezeGuard.js');
  const cfg=getRuntimeConfig();
  const submissionFile=path.join(cfg.backupsDir,'.purge_global_submission.lock.json');
  try{
    const oldReq=request('GET','/api/export-period');
    const oldRes=responseHarness();
    let oldNext=false;
    v505TrackMainApiActivity(oldReq,oldRes,()=>{oldNext=true;});
    assert.equal(oldNext,true);
    assert.equal(inspectMainApiActivity().count,1);

    const purgeReq=request('POST','/api/admin/data-purge/prepare',{email:'drain-admin',role:'ADMIN'});
    const purgeRes=responseHarness();
    let purgeNext=false;
    const startedAt=Date.now();
    await v505PurgeGlobalOwnerGuard(purgeReq,purgeRes,()=>{purgeNext=true;});
    assert.equal(purgeNext,false,'purge must not start while an older API request is still active');
    assert.equal(purgeRes.statusCode,423);
    assert.equal(purgeRes.body?.code,'DATA_PURGE_HTTP_BUSY');
    assert.ok(Date.now()-startedAt>=2500,'guard should give already-started work a short drain window before failing closed');
    assert.equal(fs.existsSync(submissionFile),false,'failed drain must release the global submission mutex');

    oldRes.emit('finish');
    assert.equal(inspectMainApiActivity().count,0);

    const retryReq=request('POST','/api/admin/data-purge/prepare',{email:'drain-admin',role:'ADMIN'});
    const retryRes=responseHarness();
    let retryNext=false;
    await v505PurgeGlobalOwnerGuard(retryReq,retryRes,()=>{retryNext=true;});
    assert.equal(retryNext,true,'purge may proceed once all earlier tracked API work has drained');
    retryReq.v505PurgeSubmissionMutexRelease?.();
    assert.equal(fs.existsSync(submissionFile),false);

    const sseReq=request('GET','/api/events');
    const sseRes=responseHarness();
    v505TrackMainApiActivity(sseReq,sseRes,()=>{});
    assert.equal(inspectMainApiActivity().count,1,'SSE must be tracked while authentication is in flight');
    let secondPass=false;
    v505PurgeWriteFreezeGuard(sseReq,sseRes,()=>{secondPass=true;});
    assert.equal(secondPass,true);
    assert.equal(inspectMainApiActivity().count,0,'SSE lifetime must be released after authentication handoff so an open browser does not block purge forever');
  }finally{
    try{closeDb();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
