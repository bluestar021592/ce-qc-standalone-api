import express from 'express';
import crypto from 'node:crypto';
import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { ensureV246TrackingSchema, applyV246StrictAttemptEvidence } from './v246TrackingLedgerCore.js';

export const V315_OPERATIONAL_DATA_REFRESH_ID = '2026-08-26-v315-bounded-ccsl-export-refresh-v1';

// V315 is imported before the carryover scheduler. That scheduler imports the
// pipeline very early, so the batch policy must be fixed here before pipeline.js
// can snapshot its module constants. 100-ticket confirm batches give visible,
// bounded progress and failed batches remain explicit retry-center records.
process.env.ORDER_BATCH_SIZE = '100';
process.env.CONFIRM_QUERY_BATCH_SIZE = '100';
process.env.REQUEST_TIMEOUT_MS = '12000';
process.env.CONFIRM_QUERY_TIMEOUT_MS = '12000';
process.env.CONFIRM_QUERY_BATCH_BUDGET_MS = '25000';
process.env.TRACK_CONCURRENCY = '4';

const STRICT_TYPES = new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const ALLOWED_TYPES = new Set(['ALL','CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const TRACK_CHUNK = 50;
const TRACK_CONCURRENCY = 4;
const MAX_RANGE_DAYS = 180;
const jobs = new Map();
let activeJobId = '';
let routesRegistered = false;

const text = value => String(value ?? '').trim();
const billOf = value => text(value).toUpperCase();
function dateKey(value='') {
  const match = text(value).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
function daysBetween(from,to){
  const a=Date.parse(`${from}T00:00:00Z`),b=Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.floor((b-a)/86400000)+1:0;
}
function selectionOf(input={}){
  const businessType=text(input.businessType||'ALL').toUpperCase();
  const fromDate=dateKey(input.fromDate||input.from);
  const toDate=dateKey(input.toDate||input.to);
  if(!ALLOWED_TYPES.has(businessType))throw new Error('V315业务范围无效。');
  if(!fromDate||!toDate||fromDate>toDate)throw new Error('请选择有效开始日期和结束日期。');
  const days=daysBetween(fromDate,toDate);
  if(!days||days>MAX_RANGE_DAYS)throw new Error(`单次数据核查最多${MAX_RANGE_DAYS}天。`);
  return {businessType,fromDate,toDate,days};
}
function strictTypesFor(selection){
  if(selection.businessType==='ALL')return [...STRICT_TYPES];
  return STRICT_TYPES.has(selection.businessType)?[selection.businessType]:[];
}
function isAuthError(error){
  const status=Number(error?.response?.status||error?.status||0);
  const message=text(error?.message);
  return status===401||status===403||/登录|token|unauthorized|forbidden/i.test(message);
}
function flattenTrackResult(value){
  if(Array.isArray(value))return value;
  if(!value||typeof value!=='object')return[];
  for(const key of ['data','rows','list','records','events','result']){
    const child=value[key];
    if(Array.isArray(child))return child.flatMap(item=>Array.isArray(item)?item:[item]);
    if(child&&typeof child==='object'){
      const nested=flattenTrackResult(child);
      if(nested.length)return nested;
    }
  }
  return [];
}
function eventBill(row={}){
  return billOf(row.shipmentCode||row.运单号||row.waybill||row.waybillNo||row.billCode||row.trackingNo);
}
function incompleteRows(selection,db=getDb()){
  ensureV246TrackingSchema(db);
  const types=strictTypesFor(selection);
  if(!types.length)return[];
  const marks=types.map(()=>'?').join(',');
  return db.prepare(`SELECT shipmentCode,businessType,firstReportDate,lastImportedDate,podDate,attemptNo,attemptSource,signingDays,lastCheckedAt
    FROM qc_tracking_ledger
    WHERE terminalReason='POD' AND businessType IN (${marks})
      AND firstReportDate<=? AND lastImportedDate>=?
      AND (COALESCE(attemptNo,0)<=0 OR TRIM(COALESCE(podDate,''))='' OR COALESCE(signingDays,0)<=0)
    ORDER BY firstReportDate,shipmentCode`).all(...types,selection.toDate,selection.fromDate);
}
async function rawTrack(client,bills){
  try{
    const payload=await client.postJson('/api/tms-shipment-event/query',bills,'V315轨迹证据补核');
    return {events:flattenTrackResult(payload),error:null};
  }catch(error){
    if(isAuthError(error))throw error;
    return {events:[],error:error?.message||String(error)};
  }
}
function chunks(values,size){
  const out=[];
  for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));
  return out;
}
async function mapLimit(values,limit,worker){
  const results=new Array(values.length);let next=0;
  async function run(){
    while(true){
      const index=next++;if(index>=values.length)return;
      results[index]=await worker(values[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,Math.max(1,values.length))},()=>run()));
  return results;
}
function writeJob(job,patch={}){Object.assign(job,patch,{updatedAt:nowIso()});return job;}
function jobPublic(job){return {...job,client:undefined};}
function cleanupJobs(){
  const cutoff=Date.now()-6*60*60_000;
  for(const[id,job]of jobs){
    if(!['QUEUED','RUNNING'].includes(job.status)&&Date.parse(job.updatedAt||job.createdAt||'')<cutoff)jobs.delete(id);
  }
}

async function executeEvidenceJob(job){
  activeJobId=job.jobId;
  const db=getDb();
  try{
    const candidates=incompleteRows(job.selection,db);
    writeJob(job,{status:'RUNNING',phase:'STRICT_EVIDENCE',total:candidates.length,completed:0,progress:candidates.length?2:95,
      message:candidates.length?`发现 ${candidates.length.toLocaleString('zh-CN')} 票已POD但派次/POD日期/签收天数证据不完整，开始限时补核…`:'没有需要补核的POD证据票。'});
    if(!candidates.length){
      writeJob(job,{status:'COMPLETED',progress:100,result:{candidates:0,queried:0,failed:0,updated:0,attemptUnresolved:0,signingUnresolved:0},message:'POD派次与签收天数证据已完整。'});
      return job;
    }
    const client=new CEClient();
    const groups=chunks(candidates,TRACK_CHUNK);
    const evidenceRows=[];const failedBills=[];let completed=0,queried=0;
    await mapLimit(groups,TRACK_CONCURRENCY,async(group,index)=>{
      const bills=group.map(row=>billOf(row.shipmentCode)).filter(Boolean);
      const outcome=await rawTrack(client,bills);queried+=bills.length;
      if(outcome.error){
        failedBills.push(...bills);
      }else{
        const byBill=new Map();
        for(const event of outcome.events){
          const bill=eventBill(event);if(!bill)continue;
          if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(event);
        }
        for(const row of group){
          const bill=billOf(row.shipmentCode);if(!bill)continue;
          const strict=analyzeV246ShopeeAttemptCycle(byBill.get(bill)||[],{podDate:row.podDate||''});
          evidenceRows.push({shipmentCode:bill,businessType:row.businessType,attemptNo:strict.attemptNo,source:strict.source,
            startMode:strict.startMode,starts:strict.starts,failures:strict.failures,podDate:strict.podDate||row.podDate||''});
        }
      }
      completed+=group.length;
      writeJob(job,{completed,queried,failed:failedBills.length,progress:Math.min(88,2+Math.floor(completed*86/Math.max(1,candidates.length))),
        message:`POD证据补核 ${completed.toLocaleString('zh-CN')}/${candidates.length.toLocaleString('zh-CN')} · 网络失败待下次重试 ${failedBills.length.toLocaleString('zh-CN')}票`});
      return {index,count:group.length,error:outcome.error};
    });
    const applied=evidenceRows.length?applyV246StrictAttemptEvidence(evidenceRows,{db,reason:`${job.jobId}:V315_EXPORT_REFRESH`}):{updated:0,known:0,unknown:0,podDateFilled:0,corrected:0};
    const unresolved=incompleteRows(job.selection,db);
    const attemptUnresolved=unresolved.filter(row=>Number(row.attemptNo||0)<=0).length;
    const signingUnresolved=unresolved.filter(row=>!dateKey(row.podDate)||!Number(row.signingDays||0)).length;
    const result={candidates:candidates.length,queried,failed:failedBills.length,failedBills:failedBills.slice(0,50),...applied,
      unresolved:unresolved.length,attemptUnresolved,signingUnresolved};
    writeJob(job,{status:'COMPLETED',phase:'DONE',progress:100,result,failed:failedBills.length,
      message:unresolved.length
        ? `数据核查完成；仍有 ${unresolved.length.toLocaleString('zh-CN')} 票真实派次/签收证据暂未取得，相关比例和平均天数将显示“—”，不会伪造0。`
        : '数据核查完成：POD派次、POD日期和签收天数证据已完整。'});
    return job;
  }catch(error){
    writeJob(job,{status:'FAILED',phase:'FAILED',error:error?.message||String(error),message:`POD证据补核失败：${error?.message||error}`});
    throw error;
  }finally{if(activeJobId===job.jobId)activeJobId='';}
}
function startEvidenceJob(selection){
  cleanupJobs();
  if(activeJobId){const active=jobs.get(activeJobId);if(active)return active;}
  const job={jobId:`V315-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,selection,status:'QUEUED',phase:'QUEUED',progress:0,total:0,completed:0,failed:0,
    message:'等待POD证据补核',createdAt:nowIso(),updatedAt:nowIso()};
  jobs.set(job.jobId,job);
  setImmediate(()=>executeEvidenceJob(job).catch(error=>console.error('[CE-QC][V315_EVIDENCE_JOB_FAILED]',error?.message||error)));
  return job;
}
function startHandler(req,res){
  try{const selection=selectionOf(req.body||{});return res.json({ok:true,version:V315_OPERATIONAL_DATA_REFRESH_ID,job:jobPublic(startEvidenceJob(selection))});}
  catch(error){return res.status(400).json({ok:false,version:V315_OPERATIONAL_DATA_REFRESH_ID,error:error?.message||String(error)});}
}
function jobHandler(req,res){
  const job=jobs.get(text(req.params?.jobId));
  if(!job)return res.status(404).json({ok:false,version:V315_OPERATIONAL_DATA_REFRESH_ID,error:'V315数据核查任务不存在或已过期'});
  return res.json({ok:true,version:V315_OPERATIONAL_DATA_REFRESH_ID,job:jobPublic(job)});
}

const previousPost=express.application.post;
const previousGet=express.application.get;
function registerRoutes(app){
  if(routesRegistered)return;routesRegistered=true;
  previousPost.call(app,'/api/v315/evidence-recheck',startHandler);
  previousGet.call(app,'/api/v315/evidence-job/:jobId',jobHandler);
  console.info('[CE-QC][V315_DATA_REFRESH_ROUTES] registered bounded terminal-POD evidence recheck routes');
}
express.application.post=function v315OperationalPost(pathValue,...handlers){
  if(!routesRegistered)registerRoutes(this);
  return previousPost.call(this,pathValue,...handlers);
};
express.application.get=function v315OperationalGet(pathValue,...handlers){
  if(!routesRegistered)registerRoutes(this);
  return previousGet.call(this,pathValue,...handlers);
};

console.info('[CE-QC][V315_OPERATIONAL_DATA_REFRESH]',JSON.stringify({
  id:V315_OPERATIONAL_DATA_REFRESH_ID,
  orderBatchSize:Number(process.env.ORDER_BATCH_SIZE),
  confirmTimeoutMs:Number(process.env.CONFIRM_QUERY_TIMEOUT_MS),
  requestTimeoutMs:Number(process.env.REQUEST_TIMEOUT_MS),
  trackConcurrency:Number(process.env.TRACK_CONCURRENCY),
  strictEvidenceChunk:TRACK_CHUNK,
  strictEvidenceConcurrency:TRACK_CONCURRENCY,
  policy:'BOUNDED_PROGRESS_FAIL_FORWARD_RECHECK_INCOMPLETE_TERMINAL_POD'
}));