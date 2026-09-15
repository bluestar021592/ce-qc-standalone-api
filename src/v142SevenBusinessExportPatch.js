import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { auditSevenBusinessHistory } from './v142SevenBusinessHistoryAudit.js';
import { exportSevenBusinessPeriodReports } from './v142SevenBusinessPeriodExporter.js';
import { getRuntimeConfig } from './db.js';

const PATCH_ID='2026-09-15-v543-history-audit-isolated-job-v1';
const WRAPPED_GET=Symbol.for('ce-qc.v142-export-get');
const AUDIT_WORKER=fileURLToPath(new URL('../scripts/CE_QC_HistoryIntegrityAuditWorker.mjs',import.meta.url));
const AUDIT_TIMEOUT_MS=Math.max(60_000,Math.min(30*60_000,Number(process.env.CE_QC_HISTORY_AUDIT_TIMEOUT_MS||15*60_000)));
const AUDIT_RETENTION_MS=20*60_000;
const auditJobs=new Map();
let activeAuditJobId='';

function normalizedDate(value=''){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function cleanupAuditJobs(){const now=Date.now();for(const [id,job] of auditJobs){if(job.status!=='RUNNING'&&now-Number(job.finishedAt||job.startedAt||now)>AUDIT_RETENTION_MS)auditJobs.delete(id);}}
function publicAuditJob(job={}){return{ok:job.status!=='FAILED',pending:job.status==='RUNNING',jobId:String(job.jobId||''),status:String(job.status||''),fromDate:String(job.fromDate||''),toDate:String(job.toDate||''),startedAt:Number(job.startedAt||0),elapsedMs:Date.now()-Number(job.startedAt||Date.now()),patchId:PATCH_ID,error:String(job.error||'')};}
function finishAuditJob(job,status,{result=null,error=''}={}){
  if(!job||job.status!=='RUNNING')return;
  job.status=status;job.result=result;job.error=String(error||'');job.finishedAt=Date.now();
  if(activeAuditJobId===job.jobId)activeAuditJobId='';
  if(job.timer){clearTimeout(job.timer);job.timer=null;}
  job.child=null;
}
function startAuditJob({fromDate='2026-07-01',toDate=''}={}){
  cleanupAuditJobs();
  const from=normalizedDate(fromDate)||'2026-07-01',to=normalizedDate(toDate);
  if(activeAuditJobId){
    const active=auditJobs.get(activeAuditJobId);
    if(active?.status==='RUNNING')return{job:active,reused:true,busyDifferent:active.fromDate!==from||active.toDate!==to};
    activeAuditJobId='';
  }
  const cfg=getRuntimeConfig();
  const job={jobId:crypto.randomUUID(),fromDate:from,toDate:to,status:'RUNNING',startedAt:Date.now(),finishedAt:0,error:'',result:null,child:null,timer:null};
  const child=spawn(process.execPath,[AUDIT_WORKER],{
    cwd:process.cwd(),windowsHide:true,detached:false,stdio:['ignore','ignore','pipe','ipc'],
    env:{...process.env,CE_QC_HISTORY_AUDIT_DB_FILE:cfg.dbFile,CE_QC_HISTORY_AUDIT_FROM_DATE:from,CE_QC_HISTORY_AUDIT_TO_DATE:to}
  });
  job.child=child;auditJobs.set(job.jobId,job);activeAuditJobId=job.jobId;
  let stderr='';
  child.stderr?.on('data',chunk=>{if(stderr.length<4000)stderr+=String(chunk||'').slice(0,4000-stderr.length);});
  child.on('message',message=>{
    if(job.status!=='RUNNING'||message?.type!=='RESULT')return;
    if(message.ok===true&&message.result&&typeof message.result==='object')finishAuditJob(job,'SUCCEEDED',{result:message.result});
    else finishAuditJob(job,'FAILED',{error:String(message?.error||'历史完整性检查后台进程失败。')});
  });
  child.once('error',error=>finishAuditJob(job,'FAILED',{error:`历史完整性检查后台进程启动失败：${error?.message||error}`}));
  child.once('exit',(code,signal)=>{
    if(job.status!=='RUNNING')return;
    const detail=stderr.trim()?`；${stderr.trim().slice(0,500)}`:'';
    finishAuditJob(job,'FAILED',{error:`历史完整性检查后台进程提前退出（code=${code??'null'}${signal?`, signal=${signal}`:''}）${detail}`});
  });
  job.timer=setTimeout(()=>{
    if(job.status!=='RUNNING')return;
    try{child.kill();}catch{}
    finishAuditJob(job,'FAILED',{error:`历史完整性检查超过${Math.round(AUDIT_TIMEOUT_MS/60000)}分钟安全上限，后台只读进程已停止；未修改任何业务数据。`});
  },AUDIT_TIMEOUT_MS);job.timer.unref?.();
  return{job,reused:false,busyDifferent:false};
}

function auditHandler(req,res){
  try{
    const started=startAuditJob({fromDate:req.query.fromDate||'2026-07-01',toDate:req.query.toDate||''});
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    if(started.busyDifferent)return res.status(423).json({ok:false,code:'HISTORY_AUDIT_BUSY',error:'另一段历史日期正在后台只读核对，请等待当前检查完成。',...publicAuditJob(started.job)});
    return res.status(202).json({...publicAuditJob(started.job),reused:started.reused,statusUrl:`/api/v142/history-integrity-job/${started.job.jobId}`});
  }catch(error){return res.status(400).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});}
}
function auditStatusHandler(req,res){
  cleanupAuditJobs();
  const job=auditJobs.get(String(req.params.jobId||''));
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  if(!job)return res.status(404).json({ok:false,patchId:PATCH_ID,code:'HISTORY_AUDIT_JOB_NOT_FOUND',error:'历史完整性检查任务不存在或结果已过期。'});
  if(job.status==='RUNNING')return res.status(202).json(publicAuditJob(job));
  if(job.status==='FAILED')return res.status(500).json(publicAuditJob(job));
  return res.json({...job.result,jobId:job.jobId,backgroundAudit:true,jobPatchId:PATCH_ID,startedAt:job.startedAt,finishedAt:job.finishedAt});
}
async function downloadHandler(req,res){
  try{
    const result=await exportSevenBusinessPeriodReports({periodType:req.query.periodType||'daily',date:req.query.date||'',fromDate:req.query.fromDate||'',toDate:req.query.toDate||'',businessType:req.query.businessType||'ALL'});
    res.setHeader('X-CE-QC-Export','V142-SEVEN-BUSINESS-STRICT');
    res.download(result.file,path.basename(result.file));
  }catch(error){res.status(400).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});}
}

const previousGet=express.application.get;
if(typeof previousGet==='function'&&!previousGet[WRAPPED_GET]){
  const wrapped=function v142Get(pathValue,...handlers){
    if(String(pathValue||'')==='/api/export-period')return previousGet.call(this,pathValue,downloadHandler);
    return previousGet.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrapped,WRAPPED_GET,{value:true});express.application.get=wrapped;
}

// POST /api/export-period/prepare deliberately remains owned by V84 asynchronous
// export jobs. Its worker may keep the direct audit call because it already runs
// outside the 5177 web process. Browser history inspection is isolated separately.
let installed=false;const previousListen=express.application.listen;
express.application.listen=function v142Listen(...args){if(!installed){installed=true;this.get('/api/v142/history-integrity',auditHandler);this.get('/api/v142/history-integrity-job/:jobId',auditStatusHandler);}return previousListen.apply(this,args);};

process.once('exit',()=>{for(const job of auditJobs.values()){if(job.status==='RUNNING'){try{job.child?.kill();}catch{}}}});

export const V142_SEVEN_BUSINESS_EXPORT_PATCH_ID=PATCH_ID;
export const V543_HISTORY_AUDIT_JOB_PATCH_ID=PATCH_ID;
