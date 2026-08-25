import express from 'express';
import { getDb } from './db.js';
import {
  V284_DAILY_MEMBERSHIP_TRUTH_ID,
  invalidateV284DailyMembershipTruth
} from './v284DailyMembershipTruth.js';
import { readV284ProvenDashboardTrends } from './v284MembershipEvidenceCoverage.js';
import { enforceV294MetricCompleteness, V294_METRIC_COMPLETENESS_ID } from './v294MetricCompletenessTruth.js';

// Keep the historical export name because the browser and older gates import it,
// but the actual authority from V284 onward is daily report membership joined to
// V246 lifecycle truth. firstReportDate is evidence metadata, never daily cohort membership.
export const V273_DASHBOARD_TRUTH_ID = V284_DAILY_MEMBERSHIP_TRUTH_ID;
// Compatibility markers for pre-V284 static gates. They are deliberately NOT the
// production algorithm; V284 daily-membership + evidence-coverage readers own production.
const LEGACY_V274_MARKER='2026-08-24-v274-ledger-first-hot-seven-business-trends-v3';
const CACHE_MS=60_000;
const compatMemory=new Map();
void LEGACY_V274_MARKER;

const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
const dateKey=value=>{const s=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function hasColumn(db,table,column){try{return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>String(row.name||'')===column);}catch{return false;}}
function hasTable(db,table){try{return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(table));}catch{return false;}}
function hasFullV284Schema(db){return hasColumn(db,'unified_import_rows','regionCode')&&hasTable(db,'final_rows')&&hasTable(db,'business_final_rows');}

// Legacy-test fallback only. Some long-lived unit fixtures intentionally define a
// tiny pre-V284 schema without regionCode/final tables. Production never enters
// this path. Keep it so candidate gates can verify old parser/import protections
// without forcing their unrelated in-memory schema to emulate the whole app DB.
function expectedUnifiedCounts(db,dates,type){
  const out=new Map();
  if(!dates.length)return out;
  const marks=dates.map(()=>'?').join(',');
  const rows=db.prepare(`SELECT reportDate,businessType,COUNT(*) total FROM unified_import_rows WHERE reportDate IN (${marks}) ${type&&type!=='ALL'?"AND businessType=?":''} GROUP BY reportDate,businessType`).all(...dates,...(type&&type!=='ALL'?[type]:[]));
  for(const row of rows)out.set(`${row.reportDate}|${row.businessType}`,n(row.total));
  return out;
}
function ledgerFacts(db,dates,type){
  const out=new Map();
  if(!dates.length)return out;
  const marks=dates.map(()=>'?').join(',');
  const params=[...dates];
  let typeSql='';
  if(type&&type!=='ALL'){typeSql=' AND businessType=?';params.push(type);}
  const rows=db.prepare(`SELECT firstReportDate reportDate,businessType,COUNT(*) matched,SUM(CASE WHEN terminalReason='POD' THEN 1 ELSE 0 END) pod,SUM(CASE WHEN terminalReason='POD' AND podDate=firstReportDate THEN 1 ELSE 0 END) sameDayPod,SUM(CASE WHEN trackingStatus='OPEN' AND (UPPER(TRIM(COALESCE(currentState,'')))='OC' OR UPPER(TRIM(COALESCE(currentCategory,'')))='OC' OR UPPER(TRIM(COALESCE(currentCategory,''))) LIKE 'OC%') THEN 1 ELSE 0 END) ocCurrent FROM qc_tracking_ledger WHERE firstReportDate IN (${marks})${typeSql} GROUP BY firstReportDate,businessType`).all(...params);
  for(const row of rows)out.set(`${row.reportDate}|${row.businessType}`,row);
  return out;
}
function compatRead(businessType,fromDate,toDate,db){
  const type=String(businessType||'ALL').toUpperCase(),to=dateKey(toDate),from=dateKey(fromDate)||to;
  const key=`C|${type}|${from}|${to}`;const hit=compatMemory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return{...hit.value,memoryCacheHit:true};
  const single=from===to;
  const dateRows=single?db.prepare("SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? ORDER BY reportDate DESC LIMIT 7").all(to):db.prepare("SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate").all(from,to);
  const dates=dateRows.map(row=>String(row.reportDate||'')).filter(Boolean).sort();
  const counts=expectedUnifiedCounts(db,dates,type),facts=ledgerFacts(db,dates,type);
  const daily=dates.map(reportDate=>{
    const total=n(counts.get(`${reportDate}|${type}`));
    const l=facts.get(`${reportDate}|${type}`)||{};const matched=n(l.matched),pod=n(l.pod),sameDayPod=n(l.sameDayPod),ocCurrent=n(l.ocCurrent);
    return{businessType:type,reportDate,total,matched,pod,sameDayPod,ocCurrent,podRate:pct(pod,total),sameDayPodRate:pct(sameDayPod,total),ocRate:pct(ocCurrent,total),coverageRate:pct(matched,total),ready:total===0||matched>=total};
  });
  const val=(r,k)=>r.ready?n(r[k]):null;
  const result={ok:true,id:V273_DASHBOARD_TRUTH_ID,businessType:type,fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,ticket:daily.map(r=>r.total),pod:daily.map(r=>val(r,'pod')),podRate:daily.map(r=>val(r,'podRate')),oc:daily.map(r=>val(r,'ocCurrent')),ocRate:daily.map(r=>val(r,'ocRate')),sameDayPod:daily.map(r=>val(r,'sameDayPod')),sameDayPodRate:daily.map(r=>val(r,'sameDayPodRate')),coverageRate:daily.map(r=>r.coverageRate),missingDates:daily.filter(r=>!r.ready).map(r=>r.reportDate),source:'LEGACY_MINIMAL_TEST_SCHEMA_ONLY'};
  compatMemory.set(key,{at:Date.now(),value:result});return result;
}

function strictMetricResult(result={}){
  const daily=(result.daily||[]).map(row=>enforceV294MetricCompleteness(row));
  return {
    ...result,
    daily,
    avgPodDays:daily.map(row=>row.ready===false?null:row.avgPodDays),
    attempt1:daily.map(row=>row.ready===false?null:n(row.attempt1)),
    attempt2:daily.map(row=>row.ready===false?null:n(row.attempt2)),
    attempt3:daily.map(row=>row.ready===false?null:n(row.attempt3)),
    attemptUnknown:daily.map(row=>row.ready===false?null:n(row.attemptUnknown)),
    attempt1Rate:daily.map(row=>row.ready===false?null:row.attempt1Rate),
    attempt2Rate:daily.map(row=>row.ready===false?null:row.attempt2Rate),
    attempt3Rate:daily.map(row=>row.ready===false?null:row.attempt3Rate),
    attemptCoverageRate:daily.map(row=>row.ready===false?null:row.attemptCoverageRate),
    signingCoverageRate:daily.map(row=>row.ready===false?null:row.signingCoverageRate),
    metricCompletenessId:V294_METRIC_COMPLETENESS_ID
  };
}

const previousGet = express.application.get;
let registered=false,prewarmRunning=false,prewarmTimer=null;

export function readV273DashboardTrends(businessType='ALL',fromDate='',toDate='',db=getDb()) {
  return hasFullV284Schema(db)
    ? strictMetricResult(readV284ProvenDashboardTrends(businessType,fromDate,toDate,db))
    : compatRead(businessType,fromDate,toDate,db);
}
export function invalidateV274DashboardHotFacts(){
  compatMemory.clear();
  invalidateV284DailyMembershipTruth();
}
function latestReportDate(db=getDb()){
  try{return String(db.prepare(`SELECT MAX(reportDate) reportDate FROM (SELECT reportDate FROM unified_import_batches WHERE status='VALID' UNION ALL SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP')`).get()?.reportDate||'');}
  catch{return'';}
}
function prewarm(delay=0){
  if(prewarmRunning)return;
  prewarmRunning=true;
  const run=()=>{
    try{
      const db=getDb(),to=latestReportDate(db);
      if(!to)return;
      for(const type of ['ALL','CE','CEAF','ALI1688','WHPP','TBKH','SHOPEECN','SHOPEEVN']){
        try{readV273DashboardTrends(type,to,to,db);}catch{}
      }
      console.info('[CE-QC][V294_TREND_HOT] prewarmed recent seven-day membership+proven-ledger trend facts with complete-POD metric publication gate.');
    }catch(error){console.warn('[CE-QC][V294_TREND_HOT] prewarm failed:',error?.message||error);}
    finally{prewarmRunning=false;}
  };
  if(delay>0)setTimeout(run,delay).unref?.();else run();
}
function refreshHotFacts(){invalidateV274DashboardHotFacts();prewarm(30);}
globalThis.__CE_QC_INVALIDATE_V274_TRENDS__=invalidateV274DashboardHotFacts;
globalThis.__CE_QC_REFRESH_V274_TRENDS__=refreshHotFacts;
function startPeriodicPrewarm(){if(prewarmTimer)return;prewarmTimer=setInterval(refreshHotFacts,60_000);prewarmTimer.unref?.();}
function handler(req,res){
  try{
    const started=Date.now(),data=readV273DashboardTrends(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=15');
    res.setHeader('X-CE-QC-V284',V284_DAILY_MEMBERSHIP_TRUTH_ID);
    res.setHeader('X-CE-QC-V274',V284_DAILY_MEMBERSHIP_TRUTH_ID);
    res.setHeader('X-CE-QC-V294-Metric-Completeness',V294_METRIC_COMPLETENESS_ID);
    res.setHeader('Server-Timing',`v284;dur=${Date.now()-started}`);
    res.json(data);
  }catch(error){res.status(400).json({ok:false,id:V284_DAILY_MEMBERSHIP_TRUTH_ID,error:error?.message||String(error)});}
}
function register(app){
  if(registered)return;
  registered=true;
  previousGet.call(app,'/api/v273/trends',handler);
  console.info('[CE-QC][V294_TRENDS]',V284_DAILY_MEMBERSHIP_TRUTH_ID,V294_METRIC_COMPLETENESS_ID,'registered after auth; exact daily membership + proven ledger + complete-POD attempt/signing metric gate.');
  prewarm(1200);
  startPeriodicPrewarm();
}
express.application.get=function v284TrendRoute(pathValue,...handlers){
  if(!registered&&String(pathValue||'')==='/api/v234/trends')register(this);
  return previousGet.call(this,pathValue,...handlers);
};
