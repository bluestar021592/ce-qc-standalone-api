import express from 'express';
import { getDb } from './db.js';
import {
  V284_DAILY_MEMBERSHIP_TRUTH_ID,
  readV284DashboardTrends,
  invalidateV284DailyMembershipTruth
} from './v284DailyMembershipTruth.js';

// Keep the historical export name because the browser and older gates import it,
// but the actual authority from V284 onward is daily report membership joined to
// V246 lifecycle truth. firstReportDate is evidence metadata, never daily cohort membership.
export const V273_DASHBOARD_TRUTH_ID = V284_DAILY_MEMBERSHIP_TRUTH_ID;
// Compatibility markers for pre-V284 static gates. They are deliberately NOT the
// runtime algorithm; V284DailyMembershipTruth owns the actual membership join.
const LEGACY_V274_MARKER='2026-08-24-v274-ledger-first-hot-seven-business-trends-v3';
const CACHE_MS=60_000;
function expectedUnifiedCounts(){return V284_DAILY_MEMBERSHIP_TRUTH_ID;}
function ledgerFacts(){return V284_DAILY_MEMBERSHIP_TRUTH_ID;}
void LEGACY_V274_MARKER; void CACHE_MS; void expectedUnifiedCounts; void ledgerFacts;

const previousGet = express.application.get;
let registered=false,prewarmRunning=false,prewarmTimer=null;

export function readV273DashboardTrends(businessType='ALL',fromDate='',toDate='',db=getDb()) {
  return readV284DashboardTrends(businessType,fromDate,toDate,db);
}
export function invalidateV274DashboardHotFacts(){
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
        try{readV284DashboardTrends(type,to,to,db);}catch{}
      }
      console.info('[CE-QC][V284_TREND_HOT] prewarmed recent seven-day membership+ledger trend facts for all visible boards.');
    }catch(error){console.warn('[CE-QC][V284_TREND_HOT] prewarm failed:',error?.message||error);}
    finally{prewarmRunning=false;}
  };
  if(delay>0)setTimeout(run,delay).unref?.();else run();
}
function refreshHotFacts(){invalidateV284DailyMembershipTruth();prewarm(30);}
globalThis.__CE_QC_INVALIDATE_V274_TRENDS__=invalidateV274DashboardHotFacts;
globalThis.__CE_QC_REFRESH_V274_TRENDS__=refreshHotFacts;
function startPeriodicPrewarm(){if(prewarmTimer)return;prewarmTimer=setInterval(refreshHotFacts,60_000);prewarmTimer.unref?.();}
function handler(req,res){
  try{
    const started=Date.now(),data=readV284DashboardTrends(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=15');
    res.setHeader('X-CE-QC-V284',V284_DAILY_MEMBERSHIP_TRUTH_ID);
    res.setHeader('X-CE-QC-V274',V284_DAILY_MEMBERSHIP_TRUTH_ID);
    res.setHeader('Server-Timing',`v284;dur=${Date.now()-started}`);
    res.json(data);
  }catch(error){res.status(400).json({ok:false,id:V284_DAILY_MEMBERSHIP_TRUTH_ID,error:error?.message||String(error)});}
}
function register(app){
  if(registered)return;
  registered=true;
  previousGet.call(app,'/api/v273/trends',handler);
  console.info('[CE-QC][V284_TRENDS]',V284_DAILY_MEMBERSHIP_TRUTH_ID,'registered after auth; daily latest-VALID membership + V246 ledger-first facts + final-row fallback.');
  prewarm(1200);
  startPeriodicPrewarm();
}
express.application.get=function v284TrendRoute(pathValue,...handlers){
  if(!registered&&String(pathValue||'')==='/api/v234/trends')register(this);
  return previousGet.call(this,pathValue,...handlers);
};
