import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKER_FILE=fileURLToPath(new URL('./historicalMemberEvidenceWorker.js',import.meta.url));
const JOB_TIMEOUT_MS=10*60_000;
const jobs=new Map();
const text=v=>String(v??'').trim();
const bill=v=>text(v).toUpperCase();
const uniq=a=>[...new Set((a||[]).map(bill).filter(Boolean))].sort();

function normalizeGroups(groups={}){
  return Object.fromEntries(Object.entries(groups||{}).map(([k,v])=>[text(k).toUpperCase(),uniq(v)]));
}
function fingerprint(reportDate,groups){
  const normalized=normalizeGroups(groups),parts=[text(reportDate).slice(0,10)];
  for(const key of Object.keys(normalized).sort())parts.push(key,...normalized[key]);
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}
function deserialize(raw={}){
  const out={};
  for(const [type,value] of Object.entries(raw||{})){
    out[type]={
      ...value,
      podBills:new Set(value.podBills||[]),
      podEvidenceByBill:new Map(value.podEvidenceByBill||[]),
      eventsByBill:new Map(value.eventsByBill||[])
    };
  }
  return out;
}
function publicJob(job){
  if(!job)return{state:'NOT_STARTED',readOnly:true,networkCalls:0,databaseWrites:0};
  return{
    state:job.state,reportDate:job.reportDate,startedAt:job.startedAt,finishedAt:job.finishedAt||'',
    error:job.error||'',readOnly:true,networkCalls:0,databaseWrites:0,
    result:job.state==='COMPLETED'?job.result:null
  };
}
function covers(job,date,requested){
  if(String(job?.reportDate||'')!==String(date||''))return false;
  for(const [type,bills] of Object.entries(requested||{})){
    const have=new Set(job?.groups?.[type]||[]);
    if((bills||[]).some(code=>!have.has(code)))return false;
  }
  return true;
}
export function ensureHistoricalEvidenceJob({reportDate='',groups={}}={}){
  const date=text(reportDate).slice(0,10),normalized=normalizeGroups(groups),key=fingerprint(date,normalized);
  const existing=jobs.get(key);
  if(existing&&['RUNNING','COMPLETED'].includes(existing.state))return publicJob(existing);
  for(const job of jobs.values()){
    if(['RUNNING','COMPLETED'].includes(job.state)&&covers(job,date,normalized))return publicJob(job);
  }
  const job={state:'RUNNING',reportDate:date,groups:normalized,startedAt:new Date().toISOString(),finishedAt:'',error:'',result:null,child:null,timer:null};
  jobs.set(key,job);
  const child=fork(WORKER_FILE,[],{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  job.child=child;
  job.timer=setTimeout(()=>{
    if(job.state==='RUNNING'){job.state='FAILED';job.error='HISTORICAL_EVIDENCE_TIMEOUT_10_MIN';job.finishedAt=new Date().toISOString();try{child.kill();}catch{}}
  },JOB_TIMEOUT_MS);job.timer.unref?.();
  child.on('message',message=>{
    if(message?.type==='DONE'){
      clearTimeout(job.timer);job.state='COMPLETED';job.result=deserialize(message.result||{});job.finishedAt=new Date().toISOString();try{child.kill();}catch{};return;
    }
    if(message?.type==='ERROR'){
      clearTimeout(job.timer);job.state='FAILED';job.error=text(message.error)||'HISTORICAL_EVIDENCE_WORKER_FAILED';job.finishedAt=new Date().toISOString();try{child.kill();}catch{}
    }
  });
  child.once('error',error=>{if(job.state==='RUNNING'){clearTimeout(job.timer);job.state='FAILED';job.error=error?.message||String(error);job.finishedAt=new Date().toISOString();}});
  child.once('exit',(code,signal)=>{job.child=null;if(job.state==='RUNNING'){clearTimeout(job.timer);job.state='FAILED';job.error=`HISTORICAL_EVIDENCE_WORKER_EXIT_${code??'null'}${signal?'_'+signal:''}`;job.finishedAt=new Date().toISOString();}});
  child.send({type:'START',reportDate:date,groups:normalized});
  return publicJob(job);
}
export function getHistoricalEvidenceJob({reportDate='',groups={}}={}){
  return publicJob(jobs.get(fingerprint(text(reportDate).slice(0,10),normalizeGroups(groups))));
}
process.once('exit',()=>{for(const job of jobs.values())try{job.child?.kill();}catch{}});
