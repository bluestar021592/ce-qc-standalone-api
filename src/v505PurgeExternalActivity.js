import fs from 'node:fs';
import path from 'node:path';

import { getRuntimeConfig } from './db.js';

export const V505_PURGE_EXTERNAL_ACTIVITY_ID='2026-09-11-v505-purge-export-activity-gate-v1';
const ACTIVE_EXPORT_STATUS=new Set(['QUEUED','RUNNING','PROCESSING']);
const UNKNOWN_RECENT_MS=Math.max(5*60_000,Math.min(60*60_000,Number(process.env.V505_EXPORT_UNKNOWN_RECENT_MS||30*60_000)));

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function pidState(pid){
  const value=Number(pid||0);
  if(!Number.isInteger(value)||value<=0)return 'UNKNOWN';
  try{process.kill(value,0);return 'ALIVE';}catch(error){return error?.code==='EPERM'?'ALIVE':'DEAD';}
}
function instant(value){
  if(value==null||value==='')return 0;
  if(Number.isFinite(Number(value))&&Number(value)>1_000_000_000_000)return Number(value);
  const parsed=Date.parse(String(value));
  return Number.isFinite(parsed)?parsed:0;
}
function activityTime(job={},file=''){
  let value=Math.max(
    instant(job.heartbeatAt),instant(job.updatedAt),instant(job.startedAt),instant(job.persistedAt),instant(job.createdAt)
  );
  if(value)return value;
  try{value=Number(fs.statSync(file).mtimeMs||0);}catch{}
  return value;
}
function candidatePids(job={}){
  const values=[
    job.workerPid,job.businessWorkerPid,job.childWorkerPid,job.activeWorkerPid,job.exportWorkerPid,
    ...(Array.isArray(job.activeChildPids)?job.activeChildPids:[]),
    ...(Array.isArray(job.workerPids)?job.workerPids:[])
  ];
  return [...new Set(values.map(Number).filter(value=>Number.isInteger(value)&&value>0))];
}

export function inspectActiveExportJobs({now=Date.now()}={}){
  const cfg=getRuntimeConfig();
  const dir=path.join(cfg.dataDir,'export_jobs');
  let names=[];
  try{names=fs.readdirSync(dir).filter(name=>name.endsWith('.json'));}catch{return {active:false,jobs:[],directory:dir,gate:V505_PURGE_EXTERNAL_ACTIVITY_ID};}
  const jobs=[];
  for(const name of names){
    const file=path.join(dir,name);
    const job=readJson(file);if(!job)continue;
    const status=String(job.status||'').toUpperCase();
    if(!ACTIVE_EXPORT_STATUS.has(status))continue;
    const pids=candidatePids(job);
    const pidStates=pids.map(pid=>({pid,state:pidState(pid)}));
    const live=pidStates.find(item=>item.state==='ALIVE');
    const touchedAt=activityTime(job,file);
    const ageMs=touchedAt>0?Math.max(0,now-touchedAt):Number.POSITIVE_INFINITY;
    const recent=ageMs<=UNKNOWN_RECENT_MS;
    const protectedState=Boolean(live||recent);
    if(!protectedState)continue;
    jobs.push({
      jobId:String(job.jobId||job.exportJobId||path.basename(name,'.json')),
      status,
      businessType:String(job.payload?.businessType||job.businessType||''),
      workerState:live?'ALIVE':(pidStates.length?'DEAD_RECENT':'UNKNOWN_RECENT'),
      workerPid:live?.pid||0,
      ageMs:Number.isFinite(ageMs)?ageMs:null,
      touchedAt:touchedAt?new Date(touchedAt).toISOString():'',
      file
    });
  }
  return {active:jobs.length>0,jobs,directory:dir,gate:V505_PURGE_EXTERNAL_ACTIVITY_ID};
}

export function assertNoActiveExportJobs(){
  const state=inspectActiveExportJobs();
  if(!state.active)return state;
  const first=state.jobs[0];
  const count=state.jobs.length;
  const error=new Error(`检测到${count}个导出任务仍处于活动或近期未确认结束状态，不能开始安全清空。请等待导出完成后再试。jobId：${first.jobId||'unknown'}`);
  error.code='DATA_PURGE_EXPORT_ACTIVE';
  error.exportActivity=state;
  throw error;
}
