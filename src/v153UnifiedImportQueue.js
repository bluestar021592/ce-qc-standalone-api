import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Worker } from 'node:worker_threads';

export const V153_IMPORT_QUEUE_ID='2026-08-15-v156-localappdata-worker-queue-v3';
const spoolRoot=path.join(process.env.LOCALAPPDATA||process.env.TEMP||process.cwd(),'CE_QC_LAUNCHER','upload_spool');
const queueDir=path.join(spoolRoot,'jobs');
fs.mkdirSync(queueDir,{recursive:true});
let activeJobId='';
const pending=[];
const pendingSet=new Set();

const nowIso=()=>new Date().toISOString();
const jobPath=id=>path.join(queueDir,`${id}.json`);
function writeJobSync(job){const target=jobPath(job.jobId),tmp=`${target}.tmp`;fs.writeFileSync(tmp,JSON.stringify(job,null,2),'utf8');fs.renameSync(tmp,target);}
function readJobSync(id){try{return JSON.parse(fs.readFileSync(jobPath(id),'utf8'));}catch{return null;}}
function enqueueId(id){if(!id||pendingSet.has(id)||activeJobId===id)return;pending.push(id);pendingSet.add(id);}

// V156 keeps both the uploaded Excel and queue metadata on the local launcher spool.
// The HTTP ingress therefore does not touch the database/data disk before returning 202.
export async function enqueueUnifiedImport({tempPath,originalName='',manualReportDate=''}={}){
  if(!tempPath)throw new Error('没有收到综合日报Excel文件');
  const source=path.resolve(String(tempPath));
  if(!fs.existsSync(source))throw new Error('综合日报临时文件不存在');
  const jobId=`IMPORT-${Date.now()}-${crypto.randomUUID().slice(0,8)}`;
  const job={
    jobId,status:'QUEUED',phase:'QUEUED',originalName:String(originalName||''),manualReportDate:String(manualReportDate||''),
    filePath:source,spoolPolicy:'LOCALAPPDATA_ZERO_DB_DISK',createdAt:nowIso(),updatedAt:nowIso(),result:null,preview:null,error:null,
    queueId:V153_IMPORT_QUEUE_ID
  };
  writeJobSync(job);enqueueId(jobId);setImmediate(pump);
  return {jobId,status:'QUEUED',originalName:job.originalName,manualReportDate:job.manualReportDate,createdAt:job.createdAt,queueId:V153_IMPORT_QUEUE_ID,spoolPolicy:job.spoolPolicy};
}

export function getUnifiedImportJob(jobId){const job=readJobSync(jobId);if(!job)return null;const {filePath,...safe}=job;return safe;}

function updateJob(id,patch){const current=readJobSync(id);if(!current)return null;const next={...current,...patch,updatedAt:nowIso()};writeJobSync(next);return next;}

function runWorker(job){
  return new Promise(resolve=>{
    const worker=new Worker(new URL('./v153UnifiedImportWorker.js',import.meta.url),{workerData:{jobId:job.jobId,filePath:job.filePath,originalName:job.originalName,manualReportDate:job.manualReportDate}});
    let finished=false;
    const settle=(patch)=>{if(finished)return;finished=true;updateJob(job.jobId,patch);resolve();};
    worker.on('message',message=>{
      if(message?.type==='phase'){
        const current=readJobSync(job.jobId)||{};
        updateJob(job.jobId,{status:'PROCESSING',phase:message.phase||'PROCESSING',reportDate:message.reportDate||current.reportDate||'',total:Number(message.total||current.total||0),retryAttempt:Number(message.retryAttempt||0),retryDelayMs:Number(message.retryDelayMs||0)});
        return;
      }
      if(message?.type==='classified'){
        const preview=message.preview&&typeof message.preview==='object'?message.preview:{};
        updateJob(job.jobId,{status:'PROCESSING',phase:'CLASSIFIED',preview,reportDate:preview.reportDate||'',total:Number(preview.summary?.validUniqueWaybills||0),classifiedAt:nowIso()});
        return;
      }
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
  }catch(error){console.error('[CE-QC][V156_IMPORT_QUEUE] resume failed',error?.stack||error);}
  if(pending.length)setImmediate(pump);
}
resumeQueuedJobs();

export function getUnifiedImportQueueSummary(){return {queueId:V153_IMPORT_QUEUE_ID,activeJobId,pendingCount:pending.length,queueRoot:'LOCALAPPDATA'};}
