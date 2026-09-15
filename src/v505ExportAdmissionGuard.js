import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { getRuntimeConfig } from './db.js';
import { inspectExportSubmissionRecord, V505_EXPORT_SUBMISSION_MUTEX_FILE } from './v505PurgeExternalActivity.js';
import { inspectPurgeWriteFreezeState, v505PurgeWriteFreezeGuard } from './v505PurgeWriteFreezeGuard.js';

export const V505_EXPORT_ADMISSION_GUARD_ID='2026-09-15-v539-export-admission-pid-start-v1';
const V473_PREPARE_PATH='/api/v473/export-period/prepare';
const PROCESS_INSTANCE_TOKEN=crypto.randomBytes(16).toString('hex');
const originalPost=express.application.post;
let installed=false;

function lockFile(){
  const dir=getRuntimeConfig().backupsDir;
  fs.mkdirSync(dir,{recursive:true});
  return path.join(dir,V505_EXPORT_SUBMISSION_MUTEX_FILE);
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function safeJobId(value){const id=String(value||'').trim();return /^EXP-[A-Z0-9-]{10,80}$/i.test(id)?id:'';}
function exportJobFile(jobId){const id=safeJobId(jobId);return id?path.join(getRuntimeConfig().dataDir,'export_jobs',`${id}.json`):'';}
function lockRecord(){return {pid:process.pid,processInstanceToken:PROCESS_INSTANCE_TOKEN,requestToken:crypto.randomUUID(),acquiredAt:Date.now(),owner:'V473_EXPORT_ADMISSION',guard:V505_EXPORT_ADMISSION_GUARD_ID};}
function createLock(file,record){
  let fd=null;
  try{
    fd=fs.openSync(file,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(record),'utf8');
    try{fs.fsyncSync(fd);}catch{}
    fs.closeSync(fd);fd=null;
    return true;
  }catch(error){
    if(fd!==null){try{fs.closeSync(fd);}catch{}try{fs.rmSync(file,{force:true});}catch{}}
    if(error?.code==='EEXIST')return false;
    throw error;
  }
}
function sameLockIdentity(left={},right={}){
  const leftRequest=String(left.requestToken||'');
  const rightRequest=String(right.requestToken||'');
  if(!leftRequest||!rightRequest||leftRequest!==rightRequest)return false;
  return Number(left.pid||0)===Number(right.pid||0)
    && String(left.processInstanceToken||'')===String(right.processInstanceToken||'')
    && Number(left.acquiredAt||0)===Number(right.acquiredAt||0);
}
function removeStaleLockIfUnchanged(file,expected){
  const current=readJson(file);
  if(!current||!sameLockIdentity(current,expected))return false;
  try{fs.rmSync(file,{force:true});return true;}catch{return false;}
}
function staleForThisProcess(record={}){
  const pid=Number(record.pid||0);
  if(pid===process.pid&&String(record.processInstanceToken||'')!==PROCESS_INSTANCE_TOKEN){
    return {stale:true,reason:'PROCESS_INSTANCE_REPLACED'};
  }
  const inspection=inspectExportSubmissionRecord(record);
  return {stale:inspection.active===false&&inspection.stale===true,reason:inspection.identityState||inspection.workerState||'UNKNOWN',inspection};
}
function acquire(){
  const file=lockFile();const record=lockRecord();
  if(createLock(file,record))return {ok:true,file,record};
  const current=readJson(file);
  const stale=current?staleForThisProcess(current):{stale:false};
  if(current&&stale.stale&&removeStaleLockIfUnchanged(file,current)){
    if(createLock(file,record))return {ok:true,file,record,recoveredStale:true,recoveryReason:stale.reason};
  }
  return {ok:false,file,current:readJson(file)||current,staleInspection:stale.inspection||null};
}
function release(lock){
  if(!lock?.record?.requestToken)return false;
  const current=readJson(lock.file);
  if(!current||String(current.requestToken||'')!==String(lock.record.requestToken)||String(current.processInstanceToken||'')!==PROCESS_INSTANCE_TOKEN)return false;
  try{fs.rmSync(lock.file,{force:true});return true;}catch{return false;}
}
function watchRegisteredJob(jobId,lock){
  const file=exportJobFile(jobId);
  if(!file){release(lock);return;}
  const poll=()=>{
    if(fs.existsSync(file)){release(lock);return;}
    const current=readJson(lock.file);
    if(!current||String(current.requestToken||'')!==String(lock.record.requestToken))return;
    const timer=setTimeout(poll,25);timer.unref?.();
  };
  poll();
}
function purgeBlocked(res,purge){
  return res.status(423).json({ok:false,code:'DATA_PURGE_IN_PROGRESS',error:'系统正在执行安全备份或清空业务数据，当前不能启动新的导出任务。',protectedBy:purge?.external?.active?`${purge.external.kind}:${purge.external.status}`:'SQLITE_PURGE_BLOCK',guardPatch:V505_EXPORT_ADMISSION_GUARD_ID});
}

export function v505ExportAdmissionGuard(req,res,next){
  try{
    const beforeAcquire=inspectPurgeWriteFreezeState();
    if(beforeAcquire.active)return purgeBlocked(res,beforeAcquire);

    const lock=acquire();
    if(!lock.ok){
      return res.status(423).json({ok:false,code:'EXPORT_SUBMISSION_BUSY',error:'另一项导出正在进入受保护任务队列，请稍后重试。',guardPatch:V505_EXPORT_ADMISSION_GUARD_ID});
    }

    // Cross-process double check: purge can acquire its own global submission
    // mutex between our first check and this export lock. If that happened,
    // export yields immediately. Conversely, once this lock survives the second
    // check, purge's coordinator will see it and refuse to start until the V473
    // job file has been durably registered.
    const afterAcquire=inspectPurgeWriteFreezeState();
    if(afterAcquire.active){release(lock);return purgeBlocked(res,afterAcquire);}

    let capturedJobId='';let released=false;
    const releaseOnce=()=>{if(released)return;released=true;release(lock);};
    const originalJson=res.json.bind(res);
    res.json=function v505CaptureV473Job(body){
      capturedJobId=safeJobId(body?.jobId);
      const result=originalJson(body);
      if(capturedJobId)watchRegisteredJob(capturedJobId,lock);else releaseOnce();
      return result;
    };
    res.once?.('close',()=>{if(!capturedJobId)releaseOnce();});
    try{return next();}catch(error){releaseOnce();throw error;}
  }catch(error){
    return res.status(423).json({ok:false,code:'EXPORT_ADMISSION_GUARD_UNAVAILABLE',error:`无法确认清空/导出互斥状态，已阻止本次导出：${error?.message||String(error)}`,guardPatch:V505_EXPORT_ADMISSION_GUARD_ID});
  }
}

if(!installed){
  installed=true;
  express.application.post=function v505ExportAdmissionPost(pathValue,...handlers){
    if(String(pathValue||'')===V473_PREPARE_PATH&&handlers.length){
      return originalPost.call(this,pathValue,v505PurgeWriteFreezeGuard,v505ExportAdmissionGuard,...handlers);
    }
    return originalPost.call(this,pathValue,...handlers);
  };
  console.info('[CE-QC][V505_EXPORT_ADMISSION_GUARD]',V505_EXPORT_ADMISSION_GUARD_ID);
}
