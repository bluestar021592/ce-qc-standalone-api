import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeConfig } from './db.js';

const PATCH_ID='2026-09-03-v419-export-result-truth-invalidation-v1';
const PREPARE_PATH='/api/export-period/prepare';
const STATUS_PATH='/api/v84/export-job/:jobId';
const LEGACY_RUNNING_STALE_MS=Math.max(60_000,Number(process.env.EXPORT_LEGACY_RUNNING_STALE_MS||120_000));
const HEARTBEAT_RUNNING_STALE_MS=Math.max(90_000,Number(process.env.EXPORT_HEARTBEAT_RUNNING_STALE_MS||180_000));
const QUEUED_STALE_MS=Math.max(20_000,Number(process.env.EXPORT_QUEUED_STALE_MS||30_000));
const SCAN_LIMIT=Math.max(20,Math.min(500,Number(process.env.EXPORT_STALE_SCAN_LIMIT||200)));
const WRAPPED=Symbol.for('ce-qc.v176-export-stale-recovery');
let prepareInstalled=false;
let statusInstalled=false;

function jobsDir(){
  const dir=path.join(getRuntimeConfig().dataDir,'export_jobs');
  fs.mkdirSync(dir,{recursive:true});
  return dir;
}
function safeId(value){const id=String(value||'').trim();return /^EXP-[A-Z0-9-]{10,80}$/i.test(id)?id:'';}
function fileFor(jobId){const id=safeId(jobId);return id?path.join(jobsDir(),`${id}.json`):'';}
function readJob(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function writeAtomic(file,value){
  const temp=`${file}.${process.pid}.v176.tmp`;
  fs.writeFileSync(temp,JSON.stringify(value,null,2),'utf8');
  fs.renameSync(temp,file);
}
function touchedAt(job={}){
  const raw=job.heartbeatAt||job.updatedAt||job.createdAt||'';
  const ms=Date.parse(raw);
  return Number.isFinite(ms)?ms:0;
}
function persistedTruthWatermarkMs(){
  const dbFile=String(getRuntimeConfig().dbFile||'').trim();
  if(!dbFile)return 0;
  let watermark=0;
  for(const file of [dbFile,`${dbFile}-wal`]){
    try{watermark=Math.max(watermark,Number(fs.statSync(file).mtimeMs||0));}catch{}
  }
  return watermark;
}
function staleInfo(job={}){
  const status=String(job.status||'').toUpperCase();
  if(!['QUEUED','RUNNING'].includes(status))return {stale:false,ageMs:0,limitMs:0};
  const touched=touchedAt(job);
  const ageMs=touched?Math.max(0,Date.now()-touched):Number.MAX_SAFE_INTEGER;
  const limitMs=status==='QUEUED'?QUEUED_STALE_MS:(job.heartbeatAt?HEARTBEAT_RUNNING_STALE_MS:LEGACY_RUNNING_STALE_MS);
  return {stale:ageMs>limitMs,ageMs,limitMs};
}
function completedTruthStaleInfo(job={}){
  if(String(job.status||'').toUpperCase()!=='COMPLETED')return {stale:false,completedAtMs:0,truthWatermarkMs:0};
  const completedAtMs=Date.parse(job.completedAt||job.updatedAt||'');
  const truthWatermarkMs=persistedTruthWatermarkMs();
  return {
    stale:Boolean(Number.isFinite(completedAtMs)&&completedAtMs>0&&truthWatermarkMs>completedAtMs),
    completedAtMs:Number.isFinite(completedAtMs)?completedAtMs:0,
    truthWatermarkMs
  };
}
function markStale(file,job,info){
  if(!file||!job||!info?.stale)return job;
  const now=new Date().toISOString();
  const next={
    ...job,
    status:'FAILED',
    progress:Number(job.progress||0),
    cancelRequested:true,
    errorCode:'EXPORT_JOB_STALE',
    message:`后台导出任务超过${Math.ceil(info.limitMs/1000)}秒没有心跳，已自动释放。请重新点击“一键导出全部报表”。`,
    error:`EXPORT_JOB_STALE: no heartbeat for ${Math.round(info.ageMs/1000)}s`,
    failedAt:now,
    staleDetectedAt:now,
    updatedAt:now,
    recoveryPatchId:PATCH_ID
  };
  try{writeAtomic(file,next);console.warn(`[CE-QC][V419_EXPORT_RECOVERY] stale job released ${job.jobId||path.basename(file)} age=${Math.round(info.ageMs/1000)}s`);return next;}
  catch(error){console.error('[CE-QC][V419_EXPORT_RECOVERY] failed to mark stale job:',error?.stack||error);return job;}
}
function markTruthStale(file,job,info){
  if(!file||!job||!info?.stale)return job;
  const now=new Date().toISOString();
  const next={
    ...job,
    status:'FAILED',
    progress:100,
    cancelRequested:false,
    errorCode:'EXPORT_RESULT_STALE_DATA_CHANGED',
    message:'所选范围的数据在上次导出后已经更新，旧文件已停止复用；本次将重新生成最新数据。',
    error:'EXPORT_RESULT_STALE_DATA_CHANGED',
    failedAt:now,
    staleDetectedAt:now,
    updatedAt:now,
    exportTruthCompletedAtMs:info.completedAtMs,
    exportTruthWatermarkMs:info.truthWatermarkMs,
    recoveryPatchId:PATCH_ID
  };
  try{writeAtomic(file,next);console.info(`[CE-QC][V419_EXPORT_TRUTH_INVALIDATED] ${job.jobId||path.basename(file)} completed=${info.completedAtMs} truth=${info.truthWatermarkMs}`);return next;}
  catch(error){console.error('[CE-QC][V419_EXPORT_RECOVERY] failed to invalidate stale completed export:',error?.stack||error);return job;}
}
function reapFile(file){
  const job=readJob(file);if(!job)return null;
  const truth=completedTruthStaleInfo(job);if(truth.stale)return markTruthStale(file,job,truth);
  const info=staleInfo(job);return info.stale?markStale(file,job,info):job;
}
function reapRecent(){
  let names=[];try{names=fs.readdirSync(jobsDir()).filter(name=>name.endsWith('.json')).slice(-SCAN_LIMIT);}catch{return 0;}
  let reaped=0;
  for(const name of names){
    const file=path.join(jobsDir(),name);const before=readJob(file);if(!before)continue;
    const truth=completedTruthStaleInfo(before);
    if(truth.stale){markTruthStale(file,before,truth);reaped+=1;continue;}
    const info=staleInfo(before);if(!info.stale)continue;markStale(file,before,info);reaped+=1;
  }
  return reaped;
}
function prepareRecovery(req,res,next){
  try{const reaped=reapRecent();if(reaped)req.ceQcV176ReapedJobs=reaped;}catch(error){console.warn('[CE-QC][V419_EXPORT_RECOVERY] prepare stale scan failed:',error?.message||error);}
  next();
}
function statusRecovery(req,res,next){
  try{const file=fileFor(req.params?.jobId);if(file&&fs.existsSync(file))reapFile(file);}catch(error){console.warn('[CE-QC][V419_EXPORT_RECOVERY] status stale check failed:',error?.message||error);}
  next();
}

const previousPost=express.application.post;
const previousGet=express.application.get;
if(typeof previousPost==='function'&&!previousPost[WRAPPED]){
  const wrappedPost=function v179ExportRecoveryPost(pathValue,...handlers){
    if(String(pathValue||'')===PREPARE_PATH&&!prepareInstalled){prepareInstalled=true;previousPost.call(this,PREPARE_PATH,prepareRecovery);}
    return previousPost.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrappedPost,WRAPPED,{value:true});express.application.post=wrappedPost;
}
if(typeof previousGet==='function'&&!previousGet[WRAPPED]){
  const wrappedGet=function v179ExportRecoveryGet(pathValue,...handlers){
    if(String(pathValue||'')===STATUS_PATH&&!statusInstalled){statusInstalled=true;previousGet.call(this,STATUS_PATH,statusRecovery);}
    return previousGet.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrappedGet,WRAPPED,{value:true});express.application.get=wrappedGet;
}

export function inspectV176AsyncExportRecovery(){return {patchId:PATCH_ID,prepareInstalled,statusInstalled,legacyRunningStaleMs:LEGACY_RUNNING_STALE_MS,heartbeatRunningStaleMs:HEARTBEAT_RUNNING_STALE_MS,queuedStaleMs:QUEUED_STALE_MS,truthWatermarkMs:persistedTruthWatermarkMs()};}
export const V176_ASYNC_EXPORT_RECOVERY_ID=PATCH_ID;
