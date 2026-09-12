import fs from 'node:fs';
import path from 'node:path';
import { auditSevenBusinessHistory } from './v142SevenBusinessHistoryAudit.js';
import { closeDb } from './db.js';
import { writeJsonAtomicSync } from './exportJobAtomicJson.js';

const VERSION='2026-09-11-v505-v473-all-export-worker-pid-v2';
// V478 Windows I/O safety is delegated to exportJobAtomicJson.js; V473 remains preflight owner.
// V505 persists workerPid before the history audit so purge/export coordination
// can prove this detached process is still alive even if the audit is long.
const jobFile=path.resolve(String(process.argv[2]||''));
if(!jobFile||!fs.existsSync(jobFile))process.exit(2);

function readJob(){return JSON.parse(fs.readFileSync(jobFile,'utf8'));}
function writeJob(patch={}){
  const current=readJob();
  const next={...current,...patch,updatedAt:new Date().toISOString(),v473WorkerVersion:VERSION};
  writeJsonAtomicSync(jobFile,next);
  return next;
}
function dateKey(value=''){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function cambodia(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function rangeOf(payload={}){
  const type=String(payload.periodType||'daily');
  if(type==='custom')return {from:dateKey(payload.fromDate),to:dateKey(payload.toDate)};
  const anchor=dateKey(payload.date);if(!anchor)return {from:'',to:''};
  const d=new Date(`${anchor}T12:00:00+07:00`);
  if(type==='weekly'){const offset=(d.getDay()+6)%7;const s=new Date(d);s.setDate(s.getDate()-offset);const e=new Date(s);e.setDate(e.getDate()+6);return {from:cambodia(s),to:cambodia(e)};}
  if(type==='monthly'){const s=new Date(d.getFullYear(),d.getMonth(),1,12);const e=new Date(d.getFullYear(),d.getMonth()+1,0,12);return {from:cambodia(s),to:cambodia(e)};}
  return {from:anchor,to:anchor};
}
function incompleteText(audit={}){
  const missing=(audit.missingDates||[]).join('、');
  const incomplete=(audit.incompleteDates||[]).slice(0,8).map(item=>`${item.reportDate}(${(item.issues||[]).join('/')})`).join('；');
  return `${missing?`缺少日期：${missing}。`:''}${incomplete?`待修复：${incomplete}。`:''}`;
}

try{
  const job=readJob();
  const business=String(job.payload?.businessType||'ALL').toUpperCase();
  if(business!=='ALL')throw Object.assign(new Error('V473 ALL worker只接受七业务汇总任务。'),{code:'V473_ALL_WORKER_ONLY'});
  const range=rangeOf(job.payload||{});
  if(!range.from||!range.to||range.from>range.to)throw Object.assign(new Error('导出日期范围无效。'),{code:'V473_INVALID_RANGE'});
  writeJob({status:'RUNNING',progress:1,range,historyPreflight:'RUNNING',workerPid:process.pid,heartbeatAt:new Date().toISOString(),message:`V473独立导出进程正在只读核对 ${range.from} 至 ${range.to} 七业务历史安全性；不会调用CE API`});
  let audit;
  try{audit=auditSevenBusinessHistory({fromDate:range.from,toDate:range.to});}
  catch(error){throw Object.assign(new Error(`七业务导出前完整性检查失败：${error?.message||String(error)}`),{code:'SEVEN_BUSINESS_PREFLIGHT_FAILED'});}
  if(!audit?.exportReady){throw Object.assign(new Error(`已阻止缺数据导出。${incompleteText(audit)}`),{code:'SEVEN_BUSINESS_HISTORY_INCOMPLETE'});}
  writeJob({
    status:'RUNNING',progress:2,historyPreflight:'PASSED',workerPid:process.pid,heartbeatAt:new Date().toISOString(),
    historyAudit:{fromDate:audit.fromDate,toDate:audit.toDate,expectedDays:audit.expectedDays,daysPresent:audit.daysPresent,totalImported:audit.totalImported,totalRetryPending:audit.totalRetryPending,exportReady:true},
    message:`V473七业务历史安全检查通过（${audit.daysPresent}/${audit.expectedDays}天）；开始生成每业务1个完整Excel`
  });
  await import('./v84ExportJobWorker.js');
}catch(error){
  try{writeJob({status:'FAILED',historyPreflight:'FAILED',workerPid:process.pid,heartbeatAt:new Date().toISOString(),message:error?.message||String(error),error:error?.stack||String(error),errorCode:error?.code||'V473_ALL_EXPORT_PREFLIGHT_FAILED',failedAt:new Date().toISOString()});}catch{}
  process.exitCode=1;
  try{closeDb();}catch{}
}
