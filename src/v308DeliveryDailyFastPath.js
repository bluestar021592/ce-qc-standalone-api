import express from 'express';
import { getDb } from './db.js';
import { readV236CurrentSummary } from './v236DashboardCurrentRead.js';
import { readV320HistoricalDailyWithDispatch } from './v320DispatchMetricOverlay.js';
import { V320_HISTORICAL_DAILY_TRUTH_ID } from './v320HistoricalDailyTruth.js';
import { readV328ThreeBusinessHistory, V328_THREE_BUSINESS_HISTORY_ID } from './v328ThreeBusinessHistoryFast.js';
import { requestV328EvidenceRepair, inspectV328EvidenceRepair, V328_EVIDENCE_COORDINATOR_ID } from './v328EvidenceRepairCoordinator.js';

export const V308_DELIVERY_DAILY_FAST_ID='2026-08-26-v328-three-business-history-attempt-signing-v1';
const TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const previousGet=express.application.get;
const registeredApps=new WeakSet();
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):null;
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function latestSnapshotId(db,date){try{return String(db.prepare("SELECT snapshotId FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(date)?.snapshotId||'');}catch{return'';}}
function strictDailyEvidence(type,date,db){
  const snapshotId=latestSnapshotId(db,date);if(!snapshotId)return{attempt1:0,attempt2:0,attempt3:0,dispatchSigningDaysSum:0,dispatchSigningDaysCount:0};
  try{return db.prepare(`WITH facts AS (
    SELECT l.terminalReason,l.attemptNo,l.attemptSource,l.podDate,
      CASE WHEN json_valid(l.evidenceJson) THEN COALESCE(json_extract(l.evidenceJson,'$.starts[0].time'),'') ELSE '' END dispatchAt
    FROM unified_import_rows u
    LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=u.shipmentCode AND UPPER(TRIM(l.businessType))=?
    WHERE u.snapshotId=? AND UPPER(TRIM(u.businessType))=?
  ), normalized AS (
    SELECT *,REPLACE(SUBSTR(dispatchAt,1,10),'/','-') dispatchDate,REPLACE(SUBSTR(podDate,1,10),'/','-') podDay FROM facts
  ) SELECT
    SUM(CASE WHEN terminalReason='POD' AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo=1 THEN 1 ELSE 0 END) attempt1,
    SUM(CASE WHEN terminalReason='POD' AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo=2 THEN 1 ELSE 0 END) attempt2,
    SUM(CASE WHEN terminalReason='POD' AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3,
    SUM(CASE WHEN terminalReason='POD' AND dispatchDate<>'' AND podDay<>'' AND julianday(podDay)>=julianday(dispatchDate) THEN CAST(julianday(podDay)-julianday(dispatchDate)+1 AS INTEGER) ELSE 0 END) dispatchSigningDaysSum,
    SUM(CASE WHEN terminalReason='POD' AND dispatchDate<>'' AND podDay<>'' AND julianday(podDay)>=julianday(dispatchDate) THEN 1 ELSE 0 END) dispatchSigningDaysCount
  FROM normalized`).get(type,snapshotId,type)||{};}catch(error){console.warn('[CE-QC][V328_DELIVERY_EVIDENCE_FAST_READ_FAILED]',type,date,error?.message||error);return{attempt1:0,attempt2:0,attempt3:0,dispatchSigningDaysSum:0,dispatchSigningDaysCount:0};}
}
function singleDay(type,date,db){
  const summary=readV236CurrentSummary(date,{cacheOnly:true});
  const base=summary.business?.[type]||{businessType:type,reportDate:date,total:0,pod:0,ready:false};
  const evidence=strictDailyEvidence(type,date,db),pod=n(base.pod),attempt1=n(evidence.attempt1),attempt2=n(evidence.attempt2),attempt3=n(evidence.attempt3),attemptEvidenceCount=attempt1+attempt2+attempt3,attemptUnknown=Math.max(0,pod-attemptEvidenceCount),signingCount=n(evidence.dispatchSigningDaysCount),signingSum=n(evidence.dispatchSigningDaysSum),avg=signingCount?Number((signingSum/signingCount).toFixed(2)):null;
  const row={...base,businessType:type,reportDate:date,ledgerReady:base.ready!==false,podKnown:pod,ocKnown:n(base.ocCurrent),attempt1,attempt2,attempt3,attempt1Known:attempt1,attempt2Known:attempt2,attempt3Known:attempt3,attemptEvidenceCount,attemptUnknown,attemptCoverageRate:pct(attemptEvidenceCount,pod),attemptEvidenceComplete:pod===0||attemptUnknown===0,dispatchSigningDaysCount:signingCount,dispatchSigningDaysSum:signingSum,signingDaysCount:signingCount,signingDaysSum:signingSum,signingSampleCount:signingCount,signingCoverageRate:pct(signingCount,pod),signingEvidenceComplete:pod===0||signingCount>=pod,avgSigningDays:avg,avgDispatchSigningDays:avg,evidenceIncomplete:pod>0&&(attemptUnknown>0||signingCount<pod),source:'V328_SINGLE_DAY_CACHE_PLUS_STRICT_LEDGER'};
  return{ok:true,id:V308_DELIVERY_DAILY_FAST_ID,truthId:V320_HISTORICAL_DAILY_TRUTH_ID,businessType:type,requestedFromDate:date,requestedToDate:date,fromDate:date,toDate:date,dates:[date],daily:[row],avgSigningDays:[avg],avgDispatchSigningDays:[avg],attempt1:[attempt1],attempt2:[attempt2],attempt3:[attempt3],attempt1Rate:[pct(attempt1,pod)],attempt2Rate:[pct(attempt2,pod)],attempt3Rate:[pct(attempt3,pod)],attemptCoverageRate:[row.attemptCoverageRate],signingCoverageRate:[row.signingCoverageRate],signingSampleCount:[signingCount],evidenceIncomplete:row.evidenceIncomplete,historyExpanded:false,source:'V328_SINGLE_DAY_DASHBOARD_CACHE_PLUS_STRICT_LEDGER',definitions:{history:'顶部单日卡片保持极速单日读取。',attempts:'TBKH、SHOPEE CN、SHOPEE VN统一严格派次口径。',averageDays:'平均派件→签收天数=真实首次派件START日至真实POD日的自然日天数，同日=1天。',readPolicy:'不在页面请求内调用CE接口。'}};
}
function normalizeHistory(data){const daily=(data.daily||[]).map(row=>({...row,ledgerReady:row.ready!==false,podKnown:n(row.pod),ocKnown:n(row.ocCurrent),attempt1Known:n(row.attempt1),attempt2Known:n(row.attempt2),attempt3Known:n(row.attempt3),signingDaysCount:n(row.dispatchSigningDaysCount),signingDaysSum:n(row.dispatchSigningDaysSum),avgSigningDays:row.avgDispatchSigningDays,avgDispatchSigningDays:row.avgDispatchSigningDays,signingSampleCount:n(row.dispatchSigningDaysCount),evidenceIncomplete:Boolean(row.evidenceIncomplete)}));return{...data,id:V308_DELIVERY_DAILY_FAST_ID,truthId:data.id||V320_HISTORICAL_DAILY_TRUTH_ID,daily,avgSigningDays:daily.map(r=>r.avgDispatchSigningDays),avgDispatchSigningDays:daily.map(r=>r.avgDispatchSigningDays),attempt1:daily.map(r=>r.attempt1),attempt2:daily.map(r=>r.attempt2),attempt3:daily.map(r=>r.attempt3),attempt1Rate:daily.map(r=>r.pod&&r.attemptEvidenceCount?pct(r.attempt1,r.pod):null),attempt2Rate:daily.map(r=>r.pod&&r.attemptEvidenceCount?pct(r.attempt2,r.pod):null),attempt3Rate:daily.map(r=>r.pod&&r.attemptEvidenceCount?pct(r.attempt3,r.pod):null),attemptCoverageRate:daily.map(r=>r.attemptCoverageRate),signingCoverageRate:daily.map(r=>r.signingCoverageRate),signingSampleCount:daily.map(r=>r.signingSampleCount),evidenceIncomplete:daily.some(r=>r.evidenceIncomplete)};}

export function readV308DeliveryDaily(businessType='',fromDate='',toDate='',db=getDb(),options={}){
  const type=String(businessType||'').toUpperCase(),from=dateKey(fromDate),to=dateKey(toDate);
  if(!TYPES.has(type))throw new Error('V328每日派次明细仅支持TBKH、SHOPEECN、SHOPEEVN');
  if(!from||!to||from>to)throw new Error('日期范围无效');
  if(options.historyAll){const data=readV328ThreeBusinessHistory(type,to,db);return normalizeHistory({...data,requestedFromDate:from,requestedToDate:to,historyExpanded:true,historyFastId:V328_THREE_BUSINESS_HISTORY_ID});}
  if(from===to)return singleDay(type,to,db);
  const data=readV320HistoricalDailyWithDispatch(type,from,to,{db,expandSingle:false});
  return normalizeHistory({...data,source:'V328_EXPLICIT_MULTI_DAY_PERSISTED_HISTORY',definitions:{history:'用户明确选择多日范围时读取该范围。',attempts:'TBKH、SHOPEE CN、SHOPEE VN统一使用已保存真实派次证据。',averageDays:'平均派件→签收天数只使用真实首次派件START和真实POD日期样本，同日=1天。',readPolicy:'页面只读SQLite已保存数据，不在请求内调用CE接口。'}});
}
function dailyHandler(req,res){try{const started=Date.now(),historyAll=String(req.query.history||'').toLowerCase()==='all',type=String(req.query.businessType||'').toUpperCase(),to=dateKey(req.query.to),data=readV308DeliveryDaily(type,req.query.from,req.query.to,getDb(),{historyAll});const repair=historyAll&&TYPES.has(type)&&to?requestV328EvidenceRepair(type,to):inspectV328EvidenceRepair(type);data.evidenceRepair=repair;res.setHeader('Cache-Control','private,max-age=10');res.setHeader('X-CE-QC-V308',V308_DELIVERY_DAILY_FAST_ID);res.setHeader('X-CE-QC-V320',V320_HISTORICAL_DAILY_TRUTH_ID);res.setHeader('X-CE-QC-V328',historyAll?'THREE_BUSINESS_AUTO_HISTORY':'EXACT_RANGE');res.setHeader('Server-Timing',`v328daily;dur=${Date.now()-started}`);return res.json(data);}catch(error){return res.status(400).json({ok:false,id:V308_DELIVERY_DAILY_FAST_ID,error:error?.message||String(error)});}}
function statusHandler(req,res){const type=String(req.query.businessType||'').toUpperCase();res.setHeader('Cache-Control','no-store');res.setHeader('X-CE-QC-V328',V328_EVIDENCE_COORDINATOR_ID);return res.json({ok:true,...inspectV328EvidenceRepair(type)});}
function isRealApp(app){return Boolean(app&&app!==express.application&&typeof app.use==='function'&&typeof app.route==='function'&&app.settings&&typeof app.settings==='object');}
function register(app){if(!isRealApp(app)||registeredApps.has(app))return false;registeredApps.add(app);previousGet.call(app,'/api/v308/delivery-daily',dailyHandler);previousGet.call(app,'/api/v328/evidence-status',statusHandler);console.info('[CE-QC][V328_DELIVERY_DAILY]',V308_DELIVERY_DAILY_FAST_ID,'TBKH + SHOPEE CN/VN auto-history share one reader; missing START evidence is repaired in an isolated child process, never inline with page reads.');return true;}
express.application.get=function v328DeliveryDailyRoute(pathValue,...handlers){const path=typeof pathValue==='string'?pathValue:'';if(path.startsWith('/')&&!['/api/v308/delivery-daily','/api/v328/evidence-status'].includes(path))register(this);return previousGet.call(this,pathValue,...handlers);};
