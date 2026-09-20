import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getRuntimeConfig } from './db.js';
import { DIRECT_PURGE_PHRASE, DIRECT_PURGE_ID } from './directDataPurge.js';

export const DIRECT_PURGE_ASYNC_ID='2026-09-20-v561-direct-purge-detached-worker-v1';

const ACTIVE=new Set(['QUEUED','RUNNING']);

function ensureDir(dir){fs.mkdirSync(dir,{recursive:true});}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function atomicWriteJson(file,value){
  ensureDir(path.dirname(file));
  const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(value),'utf8');
  try{fs.renameSync(tmp,file);}catch(error){
    try{fs.rmSync(file,{force:true});}catch{}
    fs.renameSync(tmp,file);
  }
}
function pidAlive(pid){
  const numeric=Number(pid||0);
  if(numeric<=0)return false;
  try{process.kill(numeric,0);return true;}catch(error){return error?.code==='EPERM';}
}
function files(){
  const cfg=getRuntimeConfig();
  const jobDir=path.join(cfg.backupsDir,'.direct_purge_jobs');
  const statusDir=path.join(cfg.projectRoot,'public','direct-purge-status');
  ensureDir(jobDir);ensureDir(statusDir);
  return {cfg,jobFile:path.join(jobDir,'global.job.json'),statusDir};
}
function publicJob(job={}){
  return {
    ok:true,
    direct:true,
    async:true,
    jobId:String(job.jobId||''),
    status:String(job.status||'QUEUED'),
    statusUrl:String(job.statusUrl||''),
    startedAt:Number(job.startedAt||0),
    workerPid:Number(job.workerPid||0),
    patchId:DIRECT_PURGE_ASYNC_ID
  };
}

export function queueDirectDataPurge({phrase,user={}}={}){
  if(String(phrase||'')!==DIRECT_PURGE_PHRASE){
    const error=new Error(`请输入完整确认短语：${DIRECT_PURGE_PHRASE}`);
    error.code='DIRECT_PURGE_CONFIRMATION_REQUIRED';
    throw error;
  }
  const administrator=String(user.email||user.username||'').trim();
  if(!administrator){
    const error=new Error('管理员身份无效，请重新登录。');
    error.code='DIRECT_PURGE_ADMIN_REQUIRED';
    throw error;
  }

  const {cfg,jobFile,statusDir}=files();
  const existing=readJson(jobFile);
  if(existing&&ACTIVE.has(String(existing.status||'').toUpperCase())&&pidAlive(existing.workerPid)){
    return {...publicJob(existing),reused:true};
  }

  const jobId=crypto.randomUUID();
  const token=crypto.randomBytes(24).toString('hex');
  const statusFile=path.join(statusDir,`${token}.json`);
  const statusUrl=`/direct-purge-status/${token}.json`;
  const now=Date.now();
  const job={
    kind:'DIRECT_PURGE',
    jobId,
    status:'QUEUED',
    phrase:DIRECT_PURGE_PHRASE,
    administrator,
    startedAt:now,
    updatedAt:now,
    workerPid:0,
    dbFile:cfg.dbFile,
    jobFile,
    statusFile,
    statusUrl,
    patchId:DIRECT_PURGE_ASYNC_ID
  };
  atomicWriteJson(jobFile,job);
  atomicWriteJson(statusFile,{
    ok:true,kind:'DIRECT_PURGE',jobId,status:'QUEUED',stage:'QUEUED',
    message:'直接清空任务已提交，正在启动独立后台进程。',startedAt:now,updatedAt:now,
    patchId:DIRECT_PURGE_ASYNC_ID
  });

  const workerPath=fileURLToPath(new URL('./v561DirectPurgeWorker.js',import.meta.url));
  const child=spawn(process.execPath,[workerPath],{
    cwd:cfg.projectRoot,
    detached:true,
    windowsHide:true,
    stdio:'ignore',
    env:{
      ...process.env,
      CE_QC_DIRECT_PURGE_JOB_FILE:jobFile
    }
  });
  child.unref();

  const launched={...job,status:'RUNNING',workerPid:Number(child.pid||0),updatedAt:Date.now()};
  atomicWriteJson(jobFile,launched);
  atomicWriteJson(statusFile,{
    ok:true,kind:'DIRECT_PURGE',jobId,status:'RUNNING',stage:'STARTING_WORKER',
    message:'独立后台清空进程已启动。',startedAt:now,updatedAt:Date.now(),
    workerPid:Number(child.pid||0),patchId:DIRECT_PURGE_ASYNC_ID
  });
  return {...publicJob(launched),reused:false};
}

export function readDirectPurgeStatusFile(token){
  const safe=String(token||'').toLowerCase();
  if(!/^[a-f0-9]{48}$/.test(safe))return null;
  const {statusDir}=files();
  const file=path.join(statusDir,`${safe}.json`);
  const resolved=path.resolve(file);
  const root=path.resolve(statusDir)+path.sep;
  if(!resolved.startsWith(root))return null;
  return {file,resolved,data:readJson(resolved)};
}

export function inspectDirectPurgeJob(){
  const {jobFile}=files();
  return readJson(jobFile);
}
