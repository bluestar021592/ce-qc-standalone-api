import express from 'express';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { inspectV461WhppHistoricalSurvivors } from './v461WhppHistoricalSurvivorDiagnosticPatch.js';
import { V461_ARCHIVE_EVIDENCE_ID } from './v461WhppArchiveEvidence.js';

export const V462_WHPP_SURVIVOR_FAST_ID='2026-09-08-v462-fast-sqlite-survivor-isolated-archive-worker-v1';
export const V462_WHPP_ARCHIVE_WORKER_ID='2026-09-08-v462-isolated-whpp-archive-evidence-worker-v1';
export const V468_V464_LAZY_DISPATCH_ID='2026-09-08-v468-v462-single-hook-lazy-v464-dispatch-v1';
const SURVIVOR_ROUTE='/api/v462/whpp-history-survivor';
const ARCHIVE_ROUTE='/api/v462/whpp-history-archive-status';
const V464_ROUTE='/api/v464/whpp-history-offline-recovery';
const WRAPPED=Symbol.for('ce-qc.v462-whpp-survivor-fast');
const WORKER_FILE=fileURLToPath(new URL('./v462WhppArchiveEvidenceWorker.js',import.meta.url));
const JOB_TIMEOUT_MS=10*60_000;
const jobs=new Map();

const text=value=>String(value??'').trim();
function dateOnly(value=''){const match=text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?`${match[1]}-${match[2]}-${match[3]}`:'';}
function memberBillsForDate(db,date){return db.prepare("SELECT DISTINCT UPPER(TRIM(shipmentCode)) shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY shipmentCode").all(date).map(row=>text(row.shipmentCode)).filter(Boolean);}
function fingerprint(values=[]){return crypto.createHash('sha256').update(values.join('\n')).digest('hex');}
function publicJob(job){
  if(!job)return{state:'NOT_STARTED',readOnly:true,networkCalls:0,databaseWrites:0,workerId:V462_WHPP_ARCHIVE_WORKER_ID,archiveVersion:V461_ARCHIVE_EVIDENCE_ID};
  return{
    state:job.state,reportDate:job.reportDate,memberCount:job.memberCount,startedAt:job.startedAt,finishedAt:job.finishedAt||'',
    processedFiles:Number(job.progress?.processedFiles||0),totalFiles:Number(job.progress?.totalFiles||0),readErrors:Number(job.progress?.readErrors||0),
    truncated:Boolean(job.progress?.truncated),elapsedMs:Number(job.progress?.elapsedMs||job.result?.elapsedMs||0),error:job.error||'',
    result:job.state==='COMPLETED'?job.result:null,readOnly:true,networkCalls:0,databaseWrites:0,workerId:V462_WHPP_ARCHIVE_WORKER_ID,archiveVersion:V461_ARCHIVE_EVIDENCE_ID
  };
}
export function getV462WhppArchiveEvidence(reportDate=''){
  const date=dateOnly(reportDate);
  return publicJob(date?jobs.get(date):null);
}
function stopJob(job,reason='REPLACED'){
  if(!job||job.state!=='RUNNING')return;
  clearTimeout(job.timer);job.state='FAILED';job.error=reason;job.finishedAt=new Date().toISOString();
  try{job.child?.kill();}catch{}
}
function startArchiveJob(reportDate,memberBills){
  const date=dateOnly(reportDate),members=[...new Set((memberBills||[]).map(value=>text(value).toUpperCase()).filter(Boolean))],memberFingerprint=fingerprint(members);
  const existing=jobs.get(date);
  if(existing&&existing.memberFingerprint===memberFingerprint&&['RUNNING','COMPLETED'].includes(existing.state))return existing;
  if(existing)stopJob(existing,'MEMBERSHIP_CHANGED');
  const job={state:'RUNNING',reportDate:date,memberCount:members.length,memberFingerprint,startedAt:new Date().toISOString(),finishedAt:'',progress:{processedFiles:0,totalFiles:0,readErrors:0,truncated:false,elapsedMs:0},result:null,error:'',child:null,timer:null};
  jobs.set(date,job);
  const child=fork(WORKER_FILE,[],{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});job.child=child;
  job.timer=setTimeout(()=>{if(job.state==='RUNNING'){job.state='FAILED';job.error='ARCHIVE_SCAN_TIMEOUT_10_MIN';job.finishedAt=new Date().toISOString();try{child.kill();}catch{}}},JOB_TIMEOUT_MS);job.timer.unref?.();
  child.on('message',message=>{
    if(message?.type==='PROGRESS'&&message.progress){job.progress={...job.progress,...message.progress};return;}
    if(message?.type==='DONE'){clearTimeout(job.timer);job.state='COMPLETED';job.result=message.result||null;job.progress={...job.progress,processedFiles:Number(message.result?.processedFiles||job.progress.processedFiles||0),totalFiles:Number(message.result?.filesConsidered||job.progress.totalFiles||0),readErrors:Number(message.result?.readErrors||0),truncated:Boolean(message.result?.truncated),elapsedMs:Number(message.result?.elapsedMs||job.progress.elapsedMs||0)};job.finishedAt=new Date().toISOString();return;}
    if(message?.type==='ERROR'){clearTimeout(job.timer);job.state='FAILED';job.error=text(message.error)||'ARCHIVE_WORKER_FAILED';job.finishedAt=new Date().toISOString();}
  });
  child.once('error',error=>{if(job.state==='RUNNING'){clearTimeout(job.timer);job.state='FAILED';job.error=error?.message||String(error);job.finishedAt=new Date().toISOString();}});
  child.once('exit',(code,signal)=>{job.child=null;if(job.state==='RUNNING'){clearTimeout(job.timer);job.state='FAILED';job.error=`ARCHIVE_WORKER_EXIT_${code??'null'}${signal?`_${signal}`:''}`;job.finishedAt=new Date().toISOString();}});
  child.send({type:'START',reportDate:date,memberBills:members});
  return job;
}
function authenticated(req,res){if(req.user)return true;res.status(401).json({ok:false,readOnly:true,version:V462_WHPP_SURVIVOR_FAST_ID,code:'AUTH_REQUIRED',error:'Authentication required.'});return false;}
function survivorHandler(req,res){
  if(!authenticated(req,res))return;
  try{
    const date=dateOnly(req.query?.reportDate||'');if(!date)throw Object.assign(new Error('V462需要有效YYYY-MM-DD日期。'),{code:'V462_REPORT_DATE_INVALID'});
    const db=getDb(),survivor=inspectV461WhppHistoricalSurvivors(date,db),members=memberBillsForDate(db,date),job=startArchiveJob(date,members);
    return res.json({...survivor,v462Version:V462_WHPP_SURVIVOR_FAST_ID,archiveJob:publicJob(job),fastResponse:true,archiveRunsInChildProcess:true});
  }catch(error){return res.status(400).json({ok:false,readOnly:true,version:V462_WHPP_SURVIVOR_FAST_ID,code:error?.code||'V462_SURVIVOR_FAILED',error:error?.message||String(error)});}
}
function archiveStatusHandler(req,res){
  if(!authenticated(req,res))return;
  const date=dateOnly(req.query?.reportDate||'');if(!date)return res.status(400).json({ok:false,readOnly:true,version:V462_WHPP_SURVIVOR_FAST_ID,code:'V462_REPORT_DATE_INVALID',error:'V462需要有效YYYY-MM-DD日期。'});
  return res.json({ok:true,readOnly:true,version:V462_WHPP_SURVIVOR_FAST_ID,archiveJob:getV462WhppArchiveEvidence(date)});
}
function dispatchV464(req,res,next){
  import('./v464WhppOfflineHistoryRecoveryPatch.js')
    .then(module=>{
      const handled=module.handleV464WhppOfflineRecoveryRequest?.(req,res,next);
      if(handled===false&&typeof next==='function')next();
    })
    .catch(error=>{
      console.error('[CE-QC][V468_V464_LAZY_DISPATCH_FAILED]',error?.stack||error);
      if(res.headersSent){if(typeof next==='function')next(error);return;}
      res.status(500).json({ok:false,version:V468_V464_LAZY_DISPATCH_ID,code:'V468_V464_LAZY_DISPATCH_FAILED',error:'V464离线恢复模块加载失败；未修改任何业务数据。'});
    });
}

const previousUse=express.application.use;
let installed=false;
if(typeof previousUse==='function'&&!previousUse[WRAPPED]){
  const wrapped=function v462WhppSurvivorFastUse(...args){
    const candidates=args.flat().filter(value=>typeof value==='function');
    const result=previousUse.apply(this,args);
    if(!installed&&candidates.some(fn=>fn.name==='accessIdentity')){
      installed=true;
      previousUse.call(this,(req,res,next)=>{
        if(req.method==='GET'&&req.path===SURVIVOR_ROUTE)return survivorHandler(req,res);
        if(req.method==='GET'&&req.path===ARCHIVE_ROUTE)return archiveStatusHandler(req,res);
        if(req.path===V464_ROUTE&&['GET','POST'].includes(req.method))return dispatchV464(req,res,next);
        return next();
      });
    }
    return result;
  };
  Object.defineProperty(wrapped,WRAPPED,{value:true});express.application.use=wrapped;
}
process.once('exit',()=>{for(const job of jobs.values())try{job.child?.kill();}catch{}});

console.info('[CE-QC][V462_WHPP_SURVIVOR_FAST]',V462_WHPP_SURVIVOR_FAST_ID,V462_WHPP_ARCHIVE_WORKER_ID,V468_V464_LAZY_DISPATCH_ID,'SQLite survivor returns immediately; V266 gzip evidence runs in an isolated child. The already-authenticated V462 hook lazily dispatches the exact V464 route only; V464 adds no second Express prototype wrapper.');