import express from 'express';
import { getDb } from './db.js';
import { readV236CurrentSummary } from './v236DashboardCurrentRead.js';
import { V320_HISTORICAL_DAILY_TRUTH_ID } from './v320HistoricalDailyTruth.js';
import { readV329ThreeBusinessDailyCache, V329_THREE_BUSINESS_DAILY_CACHE_ID } from './v329ThreeBusinessDailyCache.js';
import { requestV328EvidenceRepair, inspectV328EvidenceRepair, V328_EVIDENCE_COORDINATOR_ID } from './v328EvidenceRepairCoordinator.js';

export const V308_DELIVERY_DAILY_FAST_ID='2026-08-27-v329-three-business-nonblocking-attempt-signing-v1';
const TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const previousGet=express.application.get;
const registeredApps=new WeakSet();
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):null;
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function latestSnapshotId(db,date,type){try{return String(db.prepare(`SELECT b.snapshotId FROM unified_import_batches b WHERE b.reportDate=? AND b.status='VALID' AND EXISTS (SELECT 1 FROM unified_import_rows u WHERE u.snapshotId=b.snapshotId AND u.reportDate=b.reportDate AND UPPER(TRIM(u.businessType))=? AND TRIM(COALESCE(u.shipmentCode,''))<>'') ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(date,type)?.snapshotId||'');}catch{return'';}}
function strictDailyEvidence(type,date,db){
  const snapshotId=latestSnapshotId(db,date,type);if(!snapshotId)return{attempt1:0,attempt2:0,attempt3:0,signingDaysSum:0,signingDaysCount:0};
  try{return db.prepare(`WITH facts AS (
    SELECT l.terminalReason,l.attemptNo,l.attemptSource,l.firstReportDate,l.podDate
    FROM unified_import_rows u
    LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=u.shipmentCode AND UPPER(TRIM(l.businessType))=?
    WHERE u.snapshotId=? AND UPPER(TRIM(u.businessType))=?
  ), normalized AS (
    SELECT *,REPLACE(SUBSTR(firstReportDate,1,10),'/','-') firstDay,REPLACE(SUBSTR(podDate,1,10),'/','-') podDay FROM facts
  ) SELECT
    SUM(CASE WHEN terminalReason='POD' AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo=1 THEN 1 ELSE 0 END) attempt1,
    SUM(CASE WHEN terminalReason='POD' AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo=2 THEN 1 ELSE 0 END) attempt2,
    SUM(CASE WHEN terminalReason='POD' AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3,
    SUM(CASE WHEN terminalReason='POD' AND firstDay<>'' AND podDay<>'' AND julianday(podDay)>=julianday(firstDay) THEN CAST(julianday(podDay)-julianday(firstDay)+1 AS INTEGER) ELSE 0 END) signingDaysSum,
    SUM(CASE WHEN terminalReason='POD' AND firstDay<>'' AND podDay<>'' AND julianday(podDay)>=julianday(firstDay) THEN 1 ELSE 0 END) signingDaysCount
  FROM normalized`).get(type,snapshotId,type)||{};}catch(error){console.warn('[CE-QC][V329_DELIVERY_EVIDENCE_FAST_READ_FAILED]',type,date,error?.message||error);return{attempt1:0,attempt2:0,attempt3:0,signingDaysSum:0,signingDaysCount:0};}
}
function singleDay(type,date,db){
  const summary=readV236CurrentSummary(date,{cacheOnly:true});
  const base=summary.business?.[type]||{businessType:type,reportDate:date,total:0,pod:0,ready:false};
  const evidence=strictDailyEvidence(type,date,db),pod=n(base.pod),attempt1=n(evidence.attempt1),attempt2=n(evidence.attempt2),attempt3=n(evidence.attempt3),attemptEvidenceCount=attempt1+attempt2+attempt3,attemptUnknown=Math.max(0,pod-attemptEvidenceCount),signingCount=n(evidence.signingDaysCount),signingSum=n(evidence.signingDaysSum),signingComplete=pod===0||signingCount>=pod,signingSampleAvailable=pod>0&&signingCount>0,avg=signingSampleAvailable?Number((signingSum/signingCount).toFixed(2)):null;
  const row={...base,businessType:type,reportDate:date,ledgerReady:base.ready!==false,podKnown:pod,ocKnown:n(base.ocCurrent),attempt1,attempt2,attempt3,attempt1Known:attempt1,attempt2Known:attempt2,attempt3Known:attempt3,attemptEvidenceCount,attemptUnknown,attemptCoverageRate:pct(attemptEvidenceCount,pod),attemptEvidenceComplete:pod===0||attemptUnknown===0,signingDaysCount:signingCount,signingDaysSum:signingSum,signingSampleCount:signingCount,signingCoverageRate:pct(signingCount,pod),signingEvidenceComplete:signingComplete,signingSampleAvailable,avgSigningDays:avg,avgDispatchSigningDays:avg,evidenceIncomplete:pod>0&&(attemptUnknown>0||!signingComplete),source:'V335_SINGLE_DAY_PER_BUSINESS_CACHE_PLUS_STRICT_LEDGER'};
  return{ok:true,id:V308_DELIVERY_DAILY_FAST_ID,truthId:V329_THREE_BUSINESS_DAILY_CACHE_ID,businessType:type,requestedFromDate:date,requestedToDate:date,fromDate:date,toDate:date,dates:[date],daily:[row],avgSigningDays:[avg],avgDispatchSigningDays:[avg],attempt1:[attempt1],attempt2:[attempt2],attempt3:[attempt3],attempt1Rate:[pct(attempt1,pod)],attempt2Rate:[pct(attempt2,pod)],attempt3Rate:[pct(attempt3,pod)],attemptCoverageRate:[row.attemptCoverageRate],signingCoverageRate:[row.signingCoverageRate],signingSampleCount:[signingCount],evidenceIncomplete:row.evidenceIncomplete,historyExpanded:false,source:'V335_SINGLE_DAY_PER_BUSINESS_DASHBOARD_CACHE_PLUS_STRICT_LEDGER',definitions:{history:'顶部单日卡片保持极速单日读取。',attempts:'TBKH、SHOPEE CN、SHOPEE VN统一：初始1派；仅Pending/失败后再次START才进入下一派。',averageDays:'平均签收天数=有真实POD日期样本的已完成POD包裹签收天数总和÷真实签收样本数，同日=1天；缺少真实POD日期的票不参与平均。',readPolicy:'同一天每个业务独立选择自己的最新VALID日报；页面请求不扫描历史大表、不调用CE接口。'}};
}
function normalizeHistory(data){const daily=(data.daily||[]).map(row=>({...row,ledgerReady:row.ready!==false,podKnown:n(row.pod),ocKnown:n(row.ocCurrent),attempt1Known:n(row.attempt1),attempt2Known:n(row.attempt2),attempt3Known:n(row.attempt3),signingDaysCount:n(row.signingDaysCount),signingDaysSum:n(row.signingDaysSum),avgSigningDays:row.avgSigningDays??row.avgDispatchSigningDays,avgDispatchSigningDays:row.avgSigningDays??row.avgDispatchSigningDays,signingSampleCount:n(row.signingDaysCount),evidenceIncomplete:Boolean(row.evidenceIncomplete)}));return{...data,id:V308_DELIVERY_DAILY_FAST_ID,truthId:data.id||V329_THREE_BUSINESS_DAILY_CACHE_ID,daily,avgSigningDays:daily.map(r=>r.avgSigningDays),avgDispatchSigningDays:daily.map(r=>r.avgSigningDays),attempt1:daily.map(r=>r.attempt1),attempt2:daily.map(r=>r.attempt2),attempt3:daily.map(r=>r.attempt3),attempt1Rate:daily.map(r=>r.pod&&r.attemptEvidenceCount?pct(r.attempt1,r.pod):null),attempt2Rate:daily.map(r=>r.pod&&r.attemptEvidenceCount?pct(r.attempt2,r.pod):null),attempt3Rate:daily.map(r=>r.pod&&r.attemptEvidenceCount?pct(r.attempt3,r.pod):null),attemptCoverageRate:daily.map(r=>r.attemptCoverageRate),signingCoverageRate:daily.map(r=>r.signingCoverageRate),signingSampleCount:daily.map(r=>r.signingSampleCount),evidenceIncomplete:daily.some(r=>r.evidenceIncomplete)};}
function cachedHistory(type,from,to,db,all=false){const data=readV329ThreeBusinessDailyCache(type,to,db,all?'':from);if(data.daily.length)return normalizeHistory({...data,requestedFromDate:from,requestedToDate:to,historyExpanded:all||from!==to});const fallback=singleDay(type,to,db);return normalizeHistory({...fallback,historyExpanded:Boolean(all||from!==to),historyCachePending:true,source:'V329_CACHE_PENDING_CURRENT_DAY_FALLBACK',definitions:{...fallback.definitions,history:'历史缓存正在独立子进程建立；当前页面先显示当天数据，不阻塞网页。'}});}
function blockedHistory(type,from,to,db){const fallback=singleDay(type,to,db);return normalizeHistory({...fallback,requestedFromDate:from,requestedToDate:to,historyExpanded:true,historyCachePending:true,historyCacheBlocked:true,source:'V334_INVALIDATED_HISTORY_WAITING_REBUILD',definitions:{...fallback.definitions,history:'历史成员刚刚发生变化，旧历史缓存已封锁；当前只显示当天真值，等待独立worker重新建立历史缓存。'}});}

export function readV308DeliveryDaily(businessType='',fromDate='',toDate='',db=getDb(),options={}){
  const type=String(businessType||'').toUpperCase(),from=dateKey(fromDate),to=dateKey(toDate);
  if(!TYPES.has(type))throw new Error('每日派次明细仅支持TBKH、SHOPEECN、SHOPEEVN');
  if(!from||!to||from>to)throw new Error('日期范围无效');
  if(options.historyAll)return cachedHistory(type,from,to,db,true);
  if(from===to)return singleDay(type,to,db);
  return cachedHistory(type,from,to,db,false);
}
function dailyHandler(req,res){try{const started=Date.now(),historyAll=String(req.query.history||'').toLowerCase()==='all',type=String(req.query.businessType||'').toUpperCase(),from=dateKey(req.query.from),to=dateKey(req.query.to),needsHistory=historyAll||Boolean(from&&to&&from!==to),repair=needsHistory&&TYPES.has(type)&&to?requestV328EvidenceRepair(type,to):inspectV328EvidenceRepair(type),db=getDb(),data=needsHistory&&repair?.cacheBlocked?blockedHistory(type,from,to,db):readV308DeliveryDaily(type,from,to,db,{historyAll});data.evidenceRepair=repair;res.setHeader('Cache-Control','private,max-age=5');res.setHeader('X-CE-QC-V308',V308_DELIVERY_DAILY_FAST_ID);res.setHeader('X-CE-QC-V320',V320_HISTORICAL_DAILY_TRUTH_ID);res.setHeader('X-CE-QC-V329',V329_THREE_BUSINESS_DAILY_CACHE_ID);res.setHeader('Server-Timing',`v329daily;dur=${Date.now()-started}`);return res.json(data);}catch(error){return res.status(400).json({ok:false,id:V308_DELIVERY_DAILY_FAST_ID,error:error?.message||String(error)});}}
function statusHandler(req,res){const type=String(req.query.businessType||'').toUpperCase();res.setHeader('Cache-Control','no-store');res.setHeader('X-CE-QC-V329',V328_EVIDENCE_COORDINATOR_ID);return res.json({ok:true,...inspectV328EvidenceRepair(type)});}
function isRealApp(app){return Boolean(app&&app!==express.application&&typeof app.use==='function'&&typeof app.route==='function'&&app.settings&&typeof app.settings==='object');}
function register(app){if(!isRealApp(app)||registeredApps.has(app))return false;registeredApps.add(app);previousGet.call(app,'/api/v308/delivery-daily',dailyHandler);previousGet.call(app,'/api/v328/evidence-status',statusHandler);console.info('[CE-QC][V329_DELIVERY_DAILY]',V308_DELIVERY_DAILY_FAST_ID,'TBKH/CN/VN single-day evidence selects the latest VALID snapshot per business; history remains cache-only on the web process.');return true;}
express.application.get=function v329DeliveryDailyRoute(pathValue,...handlers){const path=typeof pathValue==='string'?pathValue:'';if(path.startsWith('/')&&!['/api/v308/delivery-daily','/api/v328/evidence-status'].includes(path))register(this);return previousGet.call(this,pathValue,...handlers);};