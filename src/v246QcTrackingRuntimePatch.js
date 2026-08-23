import express from 'express';
import crypto from 'node:crypto';
import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { collectV200Rows } from './v200EvidenceData.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import {
  activeBusinessProcessingDetails,
  processCarryFamilyForRefresh,
  applySuccessfulCarryRefresh,
  cambodiaClock
} from './carryoverRefreshScheduler.js';
import {
  V246_TRACKING_LEDGER_ID,
  V246_TRACKING_TYPES,
  ensureV246TrackingSchema,
  reconcileV246TrackingLedger,
  listV246OpenTrackingRows,
  applyV246EvidenceRows,
  listV246ShopeePodForStrictCheck,
  applyV246StrictAttemptEvidence,
  v246TrackingSummary,
  v246DateKey
} from './v246TrackingLedgerCore.js';

export const V246_QC_TRACKING_RUNTIME_ID = '2026-08-23-v246-continuous-qc-reconcile-0200-v3';
const TYPE_SET = new Set(['ALL',...V246_TRACKING_TYPES]);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const CHUNK_SIZE = Math.max(100,Math.min(350,Number(process.env.V246_TRACKING_CHUNK || 300)));
const STRICT_TRACK_CHUNK = Math.max(10,Math.min(100,Number(process.env.V246_STRICT_TRACK_CHUNK || 50)));
const MAX_RANGE_DAYS = 180;
const STARTUP_AUDIT_DELAY_MS = Math.max(30_000,Math.min(10*60_000,Number(process.env.V246_TRACKING_STARTUP_AUDIT_DELAY_MS || 180_000)));
const SCHEDULER_POLL_MS = 60_000;
const SCHEDULE_RETRY_MS = Math.max(10*60_000,Number(process.env.V246_0200_RETRY_MS || 30*60_000));
const jobs = new Map();
let activeJobId = '';
let schedulerTimer = null;
let startupTimer = null;
let hourlyAuditAt = 0;
let routesRegistered = false;

function text(value=''){return String(value??'').trim();}
function dateKey(value=''){return v246DateKey(value);}
function billOf(value=''){return text(value).toUpperCase();}
function addDays(date,days){const key=dateKey(date);if(!key)return '';const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function daysBetween(from,to){const a=Date.parse(`${from}T00:00:00Z`),b=Date.parse(`${to}T00:00:00Z`);return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.floor((b-a)/86400000)+1:0;}
function getMeta(db,key){try{return text(db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value);}catch{return '';}}
function setMeta(db,key,value){db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(key,String(value??''),nowIso());}
function selectionOf(input={}){
  const businessType=text(input.businessType||'ALL').toUpperCase();
  const fromDate=dateKey(input.fromDate||input.from);
  const toDate=dateKey(input.toDate||input.to);
  if(!TYPE_SET.has(businessType))throw new Error('V246业务范围仅支持 ALL / CE / CEAF / TBKH / ALI1688 / SHOPEECN / SHOPEEVN / WHPP。');
  if(!fromDate||!toDate||fromDate>toDate)throw new Error('请选择有效开始日期和结束日期。');
  const days=daysBetween(fromDate,toDate);
  if(!days||days>MAX_RANGE_DAYS)throw new Error(`单次QC追踪核查最多${MAX_RANGE_DAYS}天。`);
  return{businessType,fromDate,toDate,days};
}
function familyOf(type){if(['CE','CEAF','TBKH','ALI1688'].includes(type))return'CCSL';if(SHOPEE_TYPES.has(type))return'SHOPEE';if(type==='WHPP')return'WHPP';return'';}
function jobPublic(job){return{...job,selection:job.selection,client:undefined};}
function writeJob(job,patch={}){Object.assign(job,patch,{updatedAt:nowIso()});return job;}
function cleanupJobs(){const cutoff=Date.now()-6*60*60_000;for(const[id,job]of jobs){if(!['QUEUED','RUNNING'].includes(job.status)&&Date.parse(job.updatedAt||job.createdAt||'')<cutoff)jobs.delete(id);}}
function eventBill(row={}){return billOf(row.shipmentCode||row.运单号||row.waybill||row.waybillNo||row.billCode||row.trackingNo);}
function flattenTrackResult(value){
  if(Array.isArray(value))return value;
  if(!value||typeof value!=='object')return[];
  for(const key of ['data','rows','list','records','events','result']){
    const child=value[key];if(Array.isArray(child))return child.flatMap(item=>Array.isArray(item)?item:[item]);
    if(child&&typeof child==='object'){const nested=flattenTrackResult(child);if(nested.length)return nested;}
  }
  return[];
}
function listAllOpenTrackingRows(db){
  ensureV246TrackingSchema(db);
  return db.prepare(`SELECT shipmentCode,businessType,firstReportDate AS sourceReportDate,lastImportedDate AS lastReportDate,
      trackingStatus AS status,'SUCCESS' AS apiStatus,currentStateJson AS stateJson,lastCheckedAt
    FROM qc_tracking_ledger WHERE trackingStatus='OPEN' ORDER BY firstReportDate,shipmentCode`).all();
}
async function queryTrackWithFallback(client,bills){
  if(!bills.length)return{events:[],failed:[]};
  try{return{events:flattenTrackResult(await client.trackQuery(bills)),failed:[]};}
  catch(error){
    if(bills.length===1)return{events:[],failed:[{shipmentCode:bills[0],error:error?.message||String(error)}]};
    const mid=Math.ceil(bills.length/2);
    const left=await queryTrackWithFallback(client,bills.slice(0,mid));
    const right=await queryTrackWithFallback(client,bills.slice(mid));
    return{events:[...left.events,...right.events],failed:[...left.failed,...right.failed]};
  }
}

async function backfillShopeeStrictTrack(selection,client,job){
  const db=getDb();
  const all=listV246ShopeePodForStrictCheck(selection,db);
  const candidates=all.filter(row=>!/^V246_STRICT_TRACK:/i.test(text(row.attemptSource)));
  if(!candidates.length)return{candidates:0,queried:0,failed:0,updated:0,known:0,unknown:0,podDateFilled:0,corrected:0};
  let queried=0,failed=0;const evidenceRows=[];
  for(let offset=0;offset<candidates.length;offset+=STRICT_TRACK_CHUNK){
    const chunk=candidates.slice(offset,offset+STRICT_TRACK_CHUNK);const bills=chunk.map(row=>billOf(row.shipmentCode)).filter(Boolean);
    writeJob(job,{message:`正在补查Shopee历史派次轨迹 ${Math.min(offset+chunk.length,candidates.length)}/${candidates.length}：严格70 START→失败/Pending→新START…`});
    const outcome=await queryTrackWithFallback(client,bills);queried+=bills.length;failed+=outcome.failed.length;
    const byBill=new Map();
    for(const event of outcome.events){const bill=eventBill(event);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(event);}
    const failedBills=new Set(outcome.failed.map(row=>billOf(row.shipmentCode)));
    for(const row of chunk){
      const bill=billOf(row.shipmentCode);if(!bill||failedBills.has(bill))continue;
      const strict=analyzeV246ShopeeAttemptCycle(byBill.get(bill)||[],{podDate:row.podDate||''});
      evidenceRows.push({shipmentCode:bill,businessType:row.businessType,attemptNo:strict.attemptNo,source:strict.source,startMode:strict.startMode,starts:strict.starts,failures:strict.failures,podDate:strict.podDate||row.podDate||''});
    }
  }
  const applied=applyV246StrictAttemptEvidence(evidenceRows,{db,reason:`${job.jobId}:STRICT_TRACK_BACKFILL`});
  return{candidates:candidates.length,queried,failed,...applied};
}

async function enrichShopeeEvidence(selection,job,client){
  const types=selection.businessType==='ALL'?[...SHOPEE_TYPES]:SHOPEE_TYPES.has(selection.businessType)?[selection.businessType]:[];
  const evidence=[];const warnings=[];
  for(const type of types){
    try{
      writeJob(job,{message:`正在重建 ${type} 锁定首次日报日期与真实POD日期…`});
      const rows=await collectV200Rows(type,{from:selection.fromDate,to:selection.toDate},()=>{});
      const applied=applyV246EvidenceRows(rows,{reason:`${job.jobId}:${type}:SAFE_POD_EVIDENCE`});
      evidence.push({businessType:type,rows:rows.length,...applied});
    }catch(error){warnings.push(`${type}:${error?.message||error}`);}
  }
  let strictTrack={candidates:0,queried:0,failed:0,updated:0,known:0,unknown:0,podDateFilled:0,corrected:0};
  if(types.length){
    try{strictTrack=await backfillShopeeStrictTrack(selection,client,job);}
    catch(error){warnings.push(`STRICT_TRACK:${error?.message||error}`);}
  }
  return{evidence,strictTrack,warnings};
}

export async function runV246TrackingReconcile(selectionInput,{reason='MANUAL',job=null,client=new CEClient()}={}){
  const selection=selectionOf(selectionInput);const db=getDb();ensureV246TrackingSchema(db);
  const blockers=activeBusinessProcessingDetails(db);
  if(blockers.active)throw new Error(`当前有其他业务任务运行，QC持续追踪暂缓：${blockers.blockers.slice(0,3).map(x=>[x.family,x.businessType,x.reportDate,x.currentStage].filter(Boolean).join('·')).join('；')}`);
  const working=job||{jobId:`V246-${crypto.randomUUID()}`,selection,status:'RUNNING',createdAt:nowIso(),updatedAt:nowIso()};
  const beforeRepair=reconcileV246TrackingLedger(selection,{db,reason:`${reason}:PRE_REFRESH_RECONCILE`});
  const before=v246TrackingSummary(selection,db);
  const automaticAllOpen=reason==='CAMBODIA_0200_30DAY_AUTO';
  const candidates=automaticAllOpen?listAllOpenTrackingRows(db):listV246OpenTrackingRows(selection,db);
  writeJob(working,{status:'RUNNING',phase:'REFRESH',total:candidates.length,completed:0,refreshed:0,failed:0,progress:candidates.length?2:70,before,beforeRepair,message:`日报/历史账本对账完成：应追踪${beforeRepair.expected}票，补回/重开${beforeRepair.repaired}票；准备刷新${candidates.length}票${automaticAllOpen?'全部未终态':'所选区间非终态'}。`});
  const groups=new Map();
  for(const row of candidates){const family=familyOf(text(row.businessType).toUpperCase());if(!family)continue;if(!groups.has(family))groups.set(family,[]);groups.get(family).push(row);}
  let completed=0,refreshed=0,failed=0;
  const refreshDate=cambodiaClock().date;
  for(const[family,rows]of groups){
    for(let offset=0;offset<rows.length;offset+=CHUNK_SIZE){
      const chunk=rows.slice(offset,offset+CHUNK_SIZE);const chunkNo=Math.floor(offset/CHUNK_SIZE)+1;const chunks=Math.ceil(rows.length/CHUNK_SIZE);
      writeJob(working,{message:`${family} 非终态追踪 ${chunkNo}/${chunks} · 已处理 ${completed}/${candidates.length}`,progress:Math.min(68,2+Math.floor((completed/Math.max(1,candidates.length))*66))});
      const outcome=await processCarryFamilyForRefresh(family,chunk,{client,reportDate:refreshDate,refreshId:`${working.jobId}-${family}-${chunkNo}`});
      if(outcome.successfulRows.length)applySuccessfulCarryRefresh(outcome.successfulRows,{snapshotId:working.jobId,reportDate:refreshDate});
      refreshed+=outcome.successfulRows.length;failed+=outcome.failedBills.length;completed+=chunk.length;
      writeJob(working,{completed,refreshed,failed});
      if(!outcome.successfulRows.length&&outcome.failedBills.length===chunk.length&&chunk.length){
        throw new Error(`${family} 第${chunkNo}批 ${chunk.length}票全部接口查询失败，已停止，避免用失败结果覆盖QC账本。`);
      }
    }
  }
  writeJob(working,{phase:'EVIDENCE',progress:72,message:'状态刷新完成，正在重新锁定首次日报日期并重建Shopee真实POD/派次证据…'});
  const afterRefreshRepair=reconcileV246TrackingLedger(selection,{db,reason:`${reason}:POST_REFRESH_RECONCILE`});
  const strict=await enrichShopeeEvidence(selection,working,client);
  const finalRepair=reconcileV246TrackingLedger(selection,{db,reason:`${reason}:POST_EVIDENCE_RECONCILE`});
  const after=v246TrackingSummary(selection,db);
  return{ok:true,version:V246_QC_TRACKING_RUNTIME_ID,ledgerVersion:V246_TRACKING_LEDGER_ID,reason,selection,automaticAllOpen,before,beforeRepair,candidates:candidates.length,refreshed,failed,strictEvidence:strict.evidence,strictTrack:strict.strictTrack,warnings:strict.warnings,afterRefreshRepair,finalRepair,after,completedAt:nowIso()};
}

async function executeJob(job,reason){
  activeJobId=job.jobId;writeJob(job,{status:'RUNNING',progress:1,message:'正在从已上传日报/历史遗留建立应追踪清单并检查漏票…'});
  try{
    const result=await runV246TrackingReconcile(job.selection,{reason,job});
    writeJob(job,{status:'COMPLETED',progress:100,result,after:result.after,refreshed:result.refreshed,failed:result.failed,message:`QC核查完成：${result.candidates}票非终态已进入追踪，接口成功${result.refreshed}票，待重试${result.failed}票；防漏对账修复${result.finalRepair.repaired}票；严格派次补查${result.strictTrack?.queried||0}票。`});
    return job;
  }catch(error){writeJob(job,{status:'FAILED',error:error?.message||String(error),message:`QC核查失败：${error?.message||error}`});throw error;
  }finally{if(activeJobId===job.jobId)activeJobId='';}
}
function startJob(selection,reason='MANUAL'){
  cleanupJobs();if(activeJobId){const active=jobs.get(activeJobId);if(active)return active;}
  const job={jobId:`V246-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,selection,status:'QUEUED',phase:'QUEUED',progress:0,total:0,completed:0,refreshed:0,failed:0,message:'等待QC追踪核查',createdAt:nowIso(),updatedAt:nowIso()};
  jobs.set(job.jobId,job);setImmediate(()=>executeJob(job,reason).catch(error=>console.error('[CE-QC][V246_TRACKING_JOB_FAILED]',error?.message||error)));return job;
}

function summaryHandler(req,res){try{const selection=selectionOf(req.query);const db=getDb();const repair=String(req.query.repair||'')==='1'?reconcileV246TrackingLedger(selection,{db,reason:'SUMMARY_REPAIR'}):null;return res.json({...v246TrackingSummary(selection,db),repair});}catch(error){return res.status(400).json({ok:false,version:V246_QC_TRACKING_RUNTIME_ID,error:error?.message||String(error)});}}
function startHandler(req,res){try{const selection=selectionOf(req.body||{});const job=startJob(selection,'MANUAL_ONE_CLICK');return res.status(202).json({ok:true,version:V246_QC_TRACKING_RUNTIME_ID,job:jobPublic(job)});}catch(error){return res.status(400).json({ok:false,version:V246_QC_TRACKING_RUNTIME_ID,error:error?.message||String(error)});}}
function jobHandler(req,res){const job=jobs.get(text(req.params?.jobId));if(!job)return res.status(404).json({ok:false,error:'QC追踪任务不存在或已过期'});return res.json({ok:true,version:V246_QC_TRACKING_RUNTIME_ID,job:jobPublic(job)});}
function billHandler(req,res){
  try{const bill=billOf(req.params?.shipmentCode);const db=getDb();ensureV246TrackingSchema(db);const ledger=db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?').get(bill)||null;const carry=db.prepare('SELECT * FROM carryover_open_items WHERE shipmentCode=?').get(bill)||null;const current=db.prepare('SELECT * FROM shipment_current_state WHERE shipmentCode=?').get(bill)||null;const audits=db.prepare('SELECT action,reason,beforeJson,afterJson,createdAt FROM qc_tracking_audit WHERE shipmentCode=? ORDER BY id DESC LIMIT 50').all(bill);return res.json({ok:true,version:V246_QC_TRACKING_RUNTIME_ID,shipmentCode:bill,ledger,carry,current,audits});
  }catch(error){return res.status(500).json({ok:false,error:error?.message||String(error)});}
}

async function lightweightAudit(reason){
  const db=getDb();const clock=cambodiaClock();const windowDays=String(reason||'').startsWith('STARTUP_')?90:30;const fromDate=addDays(clock.date,-(windowDays-1));const selection={businessType:'ALL',fromDate,toDate:clock.date,days:windowDays};
  if(activeBusinessProcessingDetails(db).active||activeJobId)return null;
  const result=reconcileV246TrackingLedger(selection,{db,reason});
  console.log('[CE-QC][V246_TRACKING_AUDIT]',JSON.stringify({reason,windowDays,expected:result.expected,repaired:result.repaired,reopened:result.reopened,open:result.open}));return result;
}
function scheduledFailureCoolingDown(db){
  const failedAt=Date.parse(getMeta(db,'v246_daily_0200_failed_at')||'');
  return Number.isFinite(failedAt)&&Date.now()-failedAt<SCHEDULE_RETRY_MS;
}
async function scheduledTick(){
  if(activeJobId)return;const db=getDb();const clock=cambodiaClock();
  if(Date.now()-hourlyAuditAt>=60*60_000){hourlyAuditAt=Date.now();try{await lightweightAudit('HOURLY_ANTI_LEAK_RECONCILE');}catch(error){console.warn('[CE-QC][V246_TRACKING_AUDIT_FAILED]',error?.message||error);}}
  if(clock.minuteOfDay<120)return;
  if(getMeta(db,'v246_daily_0200_success_date')===clock.date)return;
  if(scheduledFailureCoolingDown(db))return;
  if(activeBusinessProcessingDetails(db).active)return;
  const selection={businessType:'ALL',fromDate:addDays(clock.date,-29),toDate:clock.date,days:30};
  const job=startJob(selection,'CAMBODIA_0200_30DAY_AUTO');
  try{
    while(['QUEUED','RUNNING'].includes(job.status))await new Promise(resolve=>setTimeout(resolve,2000));
    if(job.status==='COMPLETED'){
      setMeta(db,'v246_daily_0200_success_date',clock.date);setMeta(db,'v246_daily_0200_success_at',nowIso());setMeta(db,'v246_daily_0200_failed_at','');
      console.log('[CE-QC][V246_0200]',JSON.stringify({date:clock.date,status:job.status,allOpen:true,refreshed:job.refreshed,failed:job.failed,strictTrack:job.result?.strictTrack||{}}));
    }else if(job.status==='FAILED'){
      setMeta(db,'v246_daily_0200_failed_at',nowIso());
      console.warn(`[CE-QC][V246_0200_FAILED] ${job.error||job.message||'unknown'}; retry is cooled down for ${Math.round(SCHEDULE_RETRY_MS/60000)} minutes.`);
    }
  }catch(error){setMeta(db,'v246_daily_0200_failed_at',nowIso());console.error('[CE-QC][V246_0200_FAILED]',error?.message||error);}
}
function startScheduler(){
  if(schedulerTimer||process.env.CI||process.env.NODE_ENV==='test'||String(process.env.CE_QC_DISABLE_V246_TRACKING||'')==='1')return;
  startupTimer=setTimeout(()=>{lightweightAudit('STARTUP_90DAY_ANTI_LEAK').catch(error=>console.warn('[CE-QC][V246_STARTUP_AUDIT_FAILED]',error?.message||error));scheduledTick().catch(error=>console.warn('[CE-QC][V246_STARTUP_TICK_FAILED]',error?.message||error));},STARTUP_AUDIT_DELAY_MS);startupTimer.unref?.();
  schedulerTimer=setInterval(()=>scheduledTick().catch(error=>console.error('[CE-QC][V246_SCHEDULER_FAILED]',error?.message||error)),SCHEDULER_POLL_MS);schedulerTimer.unref?.();
  console.log(`[CE-QC][V246_TRACKING] ${V246_QC_TRACKING_RUNTIME_ID} enabled: startup 90-day anti-leak seed + hourly 30-day anti-leak audit + Cambodia 02:00 rolling 30-day reconciliation followed by ALL-OPEN refresh + missed-run catch-up + ${Math.round(SCHEDULE_RETRY_MS/60000)}m failure backoff.`);
}

const previousGet=express.application.get;const previousPost=express.application.post;
function registerRoutes(app){
  if(routesRegistered)return;routesRegistered=true;
  previousGet.call(app,'/api/v246/tracking/summary',summaryHandler);
  previousGet.call(app,'/api/v246/tracking/job/:jobId',jobHandler);
  previousGet.call(app,'/api/v246/tracking/bill/:shipmentCode',billHandler);
  previousPost.call(app,'/api/v246/tracking/reconcile',startHandler);
  console.info('[CE-QC][V246_TRACKING_ROUTES] registered summary/reconcile/job/bill routes');
}
express.application.get=function v246TrackingGet(pathValue,...handlers){if(!routesRegistered&&String(pathValue||'')==='/api/v234/trends')registerRoutes(this);return previousGet.call(this,pathValue,...handlers);};
express.application.post=function v246TrackingPost(pathValue,...handlers){return previousPost.call(this,pathValue,...handlers);};
startScheduler();
