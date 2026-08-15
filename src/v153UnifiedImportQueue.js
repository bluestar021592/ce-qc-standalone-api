import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Worker } from 'node:worker_threads';
import { getRuntimeConfig } from './db.js';

export const V153_IMPORT_QUEUE_ID='2026-08-15-v153-durable-worker-queue-v1';
const queueDir=path.join(getRuntimeConfig().importsDir,'unified_queue');
fs.mkdirSync(queueDir,{recursive:true});
let activeJobId='';
const pending=[];
const pendingSet=new Set();

const nowIso=()=>new Date().toISOString();
const safeBase=name=>String(name||'daily-report.xlsx').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-100)||'daily-report.xlsx';
const jobPath=id=>path.join(queueDir,`${id}.json`);
function writeJobSync(job){const target=jobPath(job.jobId),tmp=`${target}.tmp`;fs.writeFileSync(tmp,JSON.stringify(job,null,2),'utf8');fs.renameSync(tmp,target);}
function readJobSync(id){try{return JSON.parse(fs.readFileSync(jobPath(id),'utf8'));}catch{return null;}}
function enqueueId(id){if(!id||pendingSet.has(id)||activeJobId===id)return;pending.push(id);pendingSet.add(id);}

async function moveFile(source,target){
  try{await fsp.rename(source,target);}
  catch(error){if(error?.code!=='EXDEV')throw error;await fsp.copyFile(source,target);await fsp.unlink(source).catch(()=>{});}
}

export async function enqueueUnifiedImport({tempPath,originalName='',manualReportDate=''}={}){
  if(!tempPath)throw new Error('没有收到综合日报Excel文件');
  const jobId=`IMPORT-${Date.now()}-${crypto.randomUUID().slice(0,8)}`;
  const target=path.join(queueDir,`${jobId}-${safeBase(originalName)}`);
  await moveFile(tempPath,target);
  const job={jobId,status:'QUEUED',phase:'QUEUED',originalName:String(originalName||''),manualReportDate:String(manualReportDate||''),filePath:target,createdAt:nowIso(),updatedAt:nowIso(),result:null,error:null,queueId:V153_IMPORT_QUEUE_ID};
  writeJobSync(job);enqueueId(jobId);setImmediate(pump);
  return {jobId,status:'QUEUED',originalName:job.originalName,manualReportDate:job.manualReportDate,createdAt:job.createdAt,queueId:V153_IMPORT_QUEUE_ID};
}

export function getUnifiedImportJob(jobId){const job=readJobSync(jobId);if(!job)return null;const {filePath,...safe}=job;return safe;}

function updateJob(id,patch){const current=readJobSync(id);if(!current)return null;const next={...current,...patch,updatedAt:nowIso()};writeJobSync(next);return next;}

function runWorker(job){
  return new Promise(resolve=>{
    const worker=new Worker(new URL('./v153UnifiedImportWorker.js',import.meta.url),{workerData:{jobId:job.jobId,filePath:job.filePath,originalName:job.originalName,manualReportDate:job.manualReportDate}});
    let finished=false;
    const settle=(patch)=>{if(finished)return;finished=true;updateJob(job.jobId,patch);resolve();};
    worker.on('message',message=>{
      if(message?.type==='phase'){updateJob(job.jobId,{status:'PROCESSING',phase:message.phase||'PROCESSING',reportDate:message.reportDate||readJobSync(job.jobId)?.reportDate||'',total:Number(message.total||readJobSync(job.jobId)?.total||0)});return;}
      if(message?.type==='done'){settle({status:'COMPLETED',phase:'COMPLETED',result:message.result||{},reportDate:message.result?.reportDate||'',error:null,completedAt:nowIso()});return;}
      if(message?.type==='failed'){settle({status:'FAILED',phase:'FAILED',error:message.error||{message:'导入Worker失败'},completedAt:nowIso()});}
    });
    worker.on('error',error=>settle({status:'FAILED',phase:'FAILED',error:{code:'IMPORT_WORKER_CRASH',message:error?.message||String(error)},completedAt:nowIso()}));
    worker.on('exit',code=>{if(!finished)settle(code===0?{status:'FAILED',phase:'FAILED',error:{code:'IMPORT_WORKER_NO_RESULT',message:'导入Worker结束但未返回结果'},completedAt:nowIso()}:{status:'FAILED',phase:'FAILED',error:{code:'IMPORT_WORKER_EXIT',message:`导入Worker异常退出（${code}）`},completedAt:nowIso()});});
  });
}

async function pump(){
  if(activeJobId)return;
  while(pending.length){
    const id=pending.shift();pendingSet.delete(id);
    const job=readJobSync(id);
    if(!job||!['QUEUED','PROCESSING'].includes(job.status))continue;
    if(!fs.existsSync(job.filePath)){updateJob(id,{status:'FAILED',phase:'FAILED',error:{code:'QUEUED_FILE_MISSING',message:'队列中的Excel文件不存在'},completedAt:nowIso()});continue;}
    activeJobId=id;updateJob(id,{status:'PROCESSING',phase:'STARTING',startedAt:nowIso()});
    try{await runWorker({...job,status:'PROCESSING'});}finally{activeJobId='';}
  }
}

function resumeQueuedJobs(){
  try{
    for(const name of fs.readdirSync(queueDir)){
      if(!name.endsWith('.json'))continue;
      const job=readJobSync(name.slice(0,-5));
      if(!job)continue;
      if(job.status==='PROCESSING'){job.status='QUEUED';job.phase='RECOVERED_AFTER_RESTART';job.updatedAt=nowIso();writeJobSync(job);}
      if(job.status==='QUEUED')enqueueId(job.jobId);
    }
  }catch(error){console.error('[CE-QC][V153_IMPORT_QUEUE] resume failed',error?.stack||error);}
  if(pending.length)setImmediate(pump);
}
resumeQueuedJobs();

export function getUnifiedImportQueueSummary(){return {queueId:V153_IMPORT_QUEUE_ID,activeJobId,pendingCount:pending.length,queueDir};}
