import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { getRuntimeConfig } from './db.js';

export const V505_PURGE_EXTERNAL_ACTIVITY_ID='2026-09-15-v539-export-admission-pid-start-v1';
export const V505_EXPORT_SUBMISSION_MUTEX_FILE='.v505_export_submission.lock.json';
const ACTIVE_EXPORT_STATUS=new Set(['QUEUED','RUNNING','PROCESSING']);
const TERMINAL_EXPORT_STATUS=new Set(['COMPLETED','SUCCEEDED','FAILED','CANCELLED']);
const KNOWN_EXPORT_STATUS=new Set([...ACTIVE_EXPORT_STATUS,...TERMINAL_EXPORT_STATUS]);
const UNKNOWN_RECENT_MS=Math.max(5*60_000,Math.min(60*60_000,Number(process.env.V505_EXPORT_UNKNOWN_RECENT_MS||30*60_000)));
const PID_IDENTITY_TIMEOUT_MS=Math.max(1000,Math.min(12_000,Number(process.env.V537_EXPORT_PID_IDENTITY_TIMEOUT_MS||8000)));
export const V538_UNVERIFIED_OLD_EXPORT_HARD_EXPIRY_MS=Math.max(60*60_000,Math.min(7*24*60*60_000,Number(process.env.V538_EXPORT_UNVERIFIED_HARD_EXPIRY_MS||24*60*60_000)));
export const V539_ADMISSION_PID_REUSE_TOLERANCE_MS=Math.max(1000,Math.min(60_000,Number(process.env.V539_ADMISSION_PID_REUSE_TOLERANCE_MS||5000)));

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function validExportJob(job){
  if(!job||typeof job!=='object'||Array.isArray(job))return false;
  const jobId=String(job.jobId||job.exportJobId||'').trim();
  const status=String(job.status||'').toUpperCase();
  return Boolean(jobId&&KNOWN_EXPORT_STATUS.has(status));
}
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
function admissionInstant(value){
  if(value==null||value==='')return 0;
  const numeric=Number(value);
  if(Number.isFinite(numeric))return numeric>1_000_000_000_000?numeric:0;
  const parsed=Date.parse(String(value));
  return Number.isFinite(parsed)&&parsed>1_000_000_000_000?parsed:0;
}
function fileTime(file=''){
  try{return Number(fs.statSync(file).mtimeMs||0);}catch{return 0;}
}
function activityTime(job={},file=''){
  let value=Math.max(
    instant(job.heartbeatAt),instant(job.updatedAt),instant(job.startedAt),instant(job.persistedAt),instant(job.createdAt)
  );
  if(value)return value;
  return fileTime(file);
}
function candidatePids(job={}){
  const values=[
    job.workerPid,job.businessWorkerPid,job.childWorkerPid,job.activeWorkerPid,job.exportWorkerPid,
    ...(Array.isArray(job.activeChildPids)?job.activeChildPids:[]),
    ...(Array.isArray(job.workerPids)?job.workerPids:[])
  ];
  return [...new Set(values.map(Number).filter(value=>Number.isInteger(value)&&value>0))];
}
function recentUnknownJob(file,name,now,reason='SIDECAR_UNREADABLE_RECENT'){
  const touchedAt=fileTime(file);
  const ageMs=touchedAt>0?Math.max(0,now-touchedAt):Number.POSITIVE_INFINITY;
  if(ageMs>UNKNOWN_RECENT_MS)return null;
  return {
    jobId:path.basename(name,'.json'),status:'UNKNOWN',businessType:'',
    workerState:reason,workerPid:0,
    ageMs:Number.isFinite(ageMs)?ageMs:null,
    touchedAt:touchedAt?new Date(touchedAt).toISOString():'',file
  };
}
function processCommandLine(pid){
  const value=Number(pid||0);
  if(!Number.isInteger(value)||value<=0)return {state:'UNKNOWN',commandLine:''};
  try{
    if(process.platform==='linux'){
      const raw=fs.readFileSync(`/proc/${value}/cmdline`);
      const commandLine=raw.toString('utf8').replace(/\0/g,' ').trim();
      return commandLine?{state:'KNOWN',commandLine}:{state:'UNKNOWN',commandLine:''};
    }
    if(process.platform==='win32'){
      // Get-CimInstance can take a few seconds to initialize on a cold Windows
      // host. Keep this bounded, but allow enough time to distinguish a stale
      // recycled PID from the exact export worker instead of failing closed only
      // because PowerShell/WMI startup exceeded the previous 2.5s budget.
      const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${value}\" -ErrorAction SilentlyContinue; if($p){[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $p.CommandLine}`;
      const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:PID_IDENTITY_TIMEOUT_MS});
      if(result.error)return {state:'UNKNOWN',commandLine:''};
      const commandLine=String(result.stdout||'').trim();
      return commandLine?{state:'KNOWN',commandLine}:{state:'UNKNOWN',commandLine:''};
    }
    const result=spawnSync('ps',['-p',String(value),'-o','command='],{encoding:'utf8',timeout:PID_IDENTITY_TIMEOUT_MS});
    if(result.error)return {state:'UNKNOWN',commandLine:''};
    const commandLine=String(result.stdout||'').trim();
    return commandLine?{state:'KNOWN',commandLine}:{state:'UNKNOWN',commandLine:''};
  }catch{return {state:'UNKNOWN',commandLine:''};}
}
function processStartedAtMs(pid){
  const value=Number(pid||0);
  if(!Number.isInteger(value)||value<=0)return 0;
  if(process.platform!=='win32')return 0;
  try{
    const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${value}\" -ErrorAction SilentlyContinue; if($p -and $p.CreationDate){$d=[DateTimeOffset]$p.CreationDate; [Console]::Write($d.ToUnixTimeMilliseconds())}`;
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:PID_IDENTITY_TIMEOUT_MS});
    if(result.error)return 0;
    const startedAt=Number(String(result.stdout||'').trim());
    return Number.isFinite(startedAt)&&startedAt>1_000_000_000_000?startedAt:0;
  }catch{return 0;}
}
function exportWorkerIdentity(pid,file=''){
  const info=processCommandLine(pid);
  if(info.state!=='KNOWN')return {state:'UNKNOWN',commandLine:''};
  const commandLine=String(info.commandLine||'').toLowerCase();
  const jobName=path.basename(String(file||'')).toLowerCase();
  const workerLike=/(?:export[^\s"']*worker|worker[^\s"']*export)/i.test(commandLine)||commandLine.includes('v473allbusinessexportworker')||commandLine.includes('v183singlebusinessexportjobworker');
  const exactJob=Boolean(jobName&&commandLine.includes(jobName));
  return {state:workerLike&&exactJob?'MATCH':'MISMATCH',commandLine};
}
export function classifyV538OldLiveExportIdentity({identityState='',ageMs=Number.POSITIVE_INFINITY}={}){
  const state=String(identityState||'UNKNOWN').toUpperCase();
  if(state==='MATCH')return {block:true,workerState:'ALIVE_CONFIRMED_OLD',identityState:'MATCH'};
  if(state==='MISMATCH')return {block:false,workerState:'ALIVE_PID_REUSED_OLD',identityState:'MISMATCH'};
  const finiteAge=Number.isFinite(Number(ageMs));
  const expired=finiteAge&&Number(ageMs)>V538_UNVERIFIED_OLD_EXPORT_HARD_EXPIRY_MS;
  if(expired)return {block:false,workerState:'ALIVE_UNVERIFIED_EXPIRED',identityState:'UNKNOWN'};
  return {block:true,workerState:'ALIVE_UNVERIFIED_OLD',identityState:'UNKNOWN'};
}
export function classifyV539ExportAdmissionPid({workerState='',acquiredAt=0,processStartedAt=0,toleranceMs=V539_ADMISSION_PID_REUSE_TOLERANCE_MS}={}){
  const state=String(workerState||'UNKNOWN').toUpperCase();
  if(state==='DEAD')return {active:false,stale:true,workerState:'DEAD',identityState:'DEAD'};
  if(state!=='ALIVE')return {active:true,stale:false,workerState:state||'UNKNOWN',identityState:'START_UNVERIFIED'};
  const lockAt=admissionInstant(acquiredAt);
  const startedAt=admissionInstant(processStartedAt);
  const tolerance=Math.max(1000,Math.min(60_000,Number(toleranceMs)||V539_ADMISSION_PID_REUSE_TOLERANCE_MS));
  if(!lockAt||!startedAt)return {active:true,stale:false,workerState:'ALIVE',identityState:'START_UNVERIFIED'};
  if(startedAt>lockAt+tolerance){
    return {active:false,stale:true,workerState:'ALIVE_PID_REUSED',identityState:'PID_REUSED',acquiredAt:lockAt,processStartedAt:startedAt};
  }
  return {active:true,stale:false,workerState:'ALIVE',identityState:'START_MATCH',acquiredAt:lockAt,processStartedAt:startedAt};
}
export function inspectExportSubmissionRecord(record={}){
  if(!record||typeof record!=='object'||Array.isArray(record))return {active:true,stale:false,workerState:'UNKNOWN',identityState:'START_UNVERIFIED'};
  const workerState=pidState(record.pid);
  const processStartedAt=workerState==='ALIVE'?processStartedAtMs(record.pid):0;
  return {...classifyV539ExportAdmissionPid({workerState,acquiredAt:record.acquiredAt,processStartedAt}),processStartedAt};
}

export function inspectExportSubmissionAdmission(){
  const cfg=getRuntimeConfig();
  const file=path.join(cfg.backupsDir,V505_EXPORT_SUBMISSION_MUTEX_FILE);
  if(!fs.existsSync(file))return {active:false,file,gate:V505_PURGE_EXTERNAL_ACTIVITY_ID};
  const record=readJson(file);
  if(!record)return {active:true,file,workerState:'UNKNOWN',identityState:'START_UNVERIFIED',gate:V505_PURGE_EXTERNAL_ACTIVITY_ID};
  return {...inspectExportSubmissionRecord(record),file,record,gate:V505_PURGE_EXTERNAL_ACTIVITY_ID};
}

export function inspectActiveExportJobs({now=Date.now()}={}){
  const cfg=getRuntimeConfig();
  const dir=path.join(cfg.dataDir,'export_jobs');
  let names=[];
  try{names=fs.readdirSync(dir).filter(name=>name.endsWith('.json'));}catch{return {active:false,jobs:[],directory:dir,gate:V505_PURGE_EXTERNAL_ACTIVITY_ID};}
  const jobs=[];
  for(const name of names){
    const file=path.join(dir,name);
    const job=readJson(file);
    if(!job){
      const unknown=recentUnknownJob(file,name,now,'SIDECAR_UNREADABLE_RECENT');
      if(unknown)jobs.push(unknown);
      continue;
    }
    if(!validExportJob(job)){
      const unknown=recentUnknownJob(file,name,now,'SIDECAR_INVALID_RECENT');
      if(unknown)jobs.push(unknown);
      continue;
    }
    const status=String(job.status||'').toUpperCase();
    if(!ACTIVE_EXPORT_STATUS.has(status))continue;
    const pids=candidatePids(job);
    const pidStates=pids.map(pid=>({pid,state:pidState(pid)}));
    const liveCandidates=pidStates.filter(item=>item.state==='ALIVE');
    const touchedAt=activityTime(job,file);
    const ageMs=touchedAt>0?Math.max(0,now-touchedAt):Number.POSITIVE_INFINITY;
    const recent=ageMs<=UNKNOWN_RECENT_MS;
    let live=null;
    let workerState='';
    let identityState='';
    if(recent){
      live=liveCandidates[0]||null;
      workerState=live?'ALIVE_RECENT':(pidStates.length?'DEAD_RECENT':'UNKNOWN_RECENT');
    }else if(liveCandidates.length){
      const identities=liveCandidates.map(item=>({...item,identity:exportWorkerIdentity(item.pid,file)}));
      const confirmed=identities.find(item=>item.identity.state==='MATCH');
      const unresolved=identities.find(item=>item.identity.state==='UNKNOWN');
      if(confirmed){
        live=confirmed;
        workerState='ALIVE_CONFIRMED_OLD';
        identityState='MATCH';
      }else if(unresolved){
        const decision=classifyV538OldLiveExportIdentity({identityState:'UNKNOWN',ageMs});
        if(!decision.block)continue;
        live=unresolved;
        workerState=decision.workerState;
        identityState=decision.identityState;
      }else{
        // PID reuse is common on long-running Windows hosts. An old RUNNING
        // sidecar must not become a permanent purge lock merely because Windows
        // later assigned the same numeric PID to an unrelated process.
        continue;
      }
    }else if(!recent){
      continue;
    }
    jobs.push({
      jobId:String(job.jobId||job.exportJobId||path.basename(name,'.json')),
      status,
      businessType:String(job.payload?.businessType||job.businessType||''),
      workerState:workerState||'UNKNOWN_RECENT',workerPid:live?.pid||0,
      identityState,
      ageMs:Number.isFinite(ageMs)?ageMs:null,
      touchedAt:touchedAt?new Date(touchedAt).toISOString():'',
      file
    });
  }
  return {active:jobs.length>0,jobs,directory:dir,gate:V505_PURGE_EXTERNAL_ACTIVITY_ID};
}

export function assertNoActiveExportJobs(){
  const admission=inspectExportSubmissionAdmission();
  if(admission.active){
    const error=new Error('检测到导出请求正在进入受保护任务队列，不能同时开始安全清空。请等待导出任务登记完成后再试。');
    error.code='DATA_PURGE_EXPORT_SUBMISSION_BUSY';
    error.exportAdmission=admission;
    throw error;
  }
  const state=inspectActiveExportJobs();
  if(!state.active)return state;
  const first=state.jobs[0];
  const count=state.jobs.length;
  const error=new Error(`检测到${count}个导出任务仍处于活动、近期未确认结束或近期状态文件不可读/无效状态，不能开始安全清空。请等待导出完成后再试。jobId：${first.jobId||'unknown'}`);
  error.code='DATA_PURGE_EXPORT_ACTIVE';
  error.exportActivity=state;
  throw error;
}
