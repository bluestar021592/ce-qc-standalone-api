import express from 'express';
import { getDb } from './db.js';
import { backfillV294StrictAttemptsFromSavedEvidence } from './v294AttemptSigningTruth.js';
import { repairV294CarryoverLifecycle } from './v294CarryoverLifecycleTruth.js';
import { refreshV235CurrentDashboardCacheDate } from './v235DashboardCurrentCache.js';
import { requestV328EvidenceRepair } from './v328EvidenceRepairCoordinator.js';
import { requestV334GenericHistoryBuild } from './v334GenericHistoryCoordinator.js';
import { readV329ThreeBusinessDailyCache } from './v329ThreeBusinessDailyCache.js';
import { readV334GenericHistoryCache } from './v334GenericHistoryCache.js';

export const V294_POST_PROCESS_ATTEMPT_BACKFILL_ID = '2026-09-01-v294-finalize-persisted-dashboard-history-v3';
const previousPost = express.application.post;
const ROUTES = new Set([
  '/api/run','/api/run/start','/api/resume','/api/run/resume',
  '/api/shopee/run/start','/api/shopee/run/resume'
]);
const ATTEMPT_HISTORY_TYPES=['TBKH','SHOPEECN','SHOPEEVN'];
const GENERIC_HISTORY_TYPES=['CE','CEAF','ALI1688','WHPP','ALL'];
let inFlight = false;
let queued = null;
let historyTimer = null;
let whppWatchTimer = null;
let whppWatchDate = '';

function typesForPath(path='') {
  const value=String(path||'');
  if(value.startsWith('/api/shopee/'))return {family:'SHOPEE',carryTypes:['SHOPEECN','SHOPEEVN'],attemptTypes:['SHOPEECN','SHOPEEVN']};
  return {family:'CCSL',carryTypes:['CE','CEAF','TBKH','ALI1688'],attemptTypes:['TBKH']};
}
function responseReportDate(req, payload={}) {
  return String(payload?.run?.reportDate||payload?.summary?.reportDate||payload?.state?.reportDate||payload?.import?.reportDate||payload?.reportDate||req?.body?.reportDate||req?.body?.date||'').slice(0,10);
}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function latestUnifiedReportDate(){try{return String(getDb().prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,rowid DESC LIMIT 1").get()?.reportDate||'').slice(0,10);}catch{return'';}}
function whppFinalized(reportDate=''){
  const date=String(reportDate||'').slice(0,10);if(!date)return false;
  try{const row=getDb().prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date),summary=safeJson(row?.summaryJson,{}),status=String(summary.snapshotStatus||summary.reconciliationStatus||'').toUpperCase();return summary.completed===true&&['COMPLETED','COMPLETED_WITH_RETRY'].includes(status)&&Boolean(String(summary.finalizedSnapshotId||'').trim());}catch{return false;}
}
function invalidateDashboardReadCaches(){
  for(const name of ['__CE_QC_INVALIDATE_V236_CURRENT_SUMMARY__','__CE_QC_INVALIDATE_V253_DASHBOARD_FAST_PATH__','__CE_QC_INVALIDATE_V284_DAILY_MEMBERSHIP__']){
    try{globalThis[name]?.();}catch{}
  }
  try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
}
function attemptCacheReady(type,date){try{const data=readV329ThreeBusinessDailyCache(type,date,getDb(),date);return data?.dates?.includes(date)&&data.daily?.some(row=>row.reportDate===date&&row.ready!==false);}catch{return false;}}
function genericCacheReady(type,date){try{const data=readV334GenericHistoryCache(type,date,getDb(),date);return data?.dates?.includes(date)&&data.daily?.some(row=>row.reportDate===date&&row.ready!==false);}catch{return false;}}
function schedulePersistedHistoryBuild(reportDate){
  const date=String(reportDate||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!whppFinalized(date))return;
  clearTimeout(historyTimer);
  historyTimer=setTimeout(()=>{
    const queuedAttempt=[],queuedGeneric=[];
    for(const type of ATTEMPT_HISTORY_TYPES){if(attemptCacheReady(type,date))continue;try{requestV328EvidenceRepair(type,date);queuedAttempt.push(type);}catch(error){console.warn('[CE-QC][FINAL_HISTORY_THREE_QUEUE_FAILED]',type,date,error?.message||error);}}
    for(const type of GENERIC_HISTORY_TYPES){if(genericCacheReady(type,date))continue;try{requestV334GenericHistoryBuild(type,date);queuedGeneric.push(type);}catch(error){console.warn('[CE-QC][FINAL_HISTORY_GENERIC_QUEUE_FAILED]',type,date,error?.message||error);}}
    console.info('[CE-QC][FINAL_HISTORY_MATERIALIZATION_QUEUED]',JSON.stringify({reportDate:date,attemptTypes:queuedAttempt,genericTypes:queuedGeneric,policy:'AFTER_ACTUAL_WHPP_FINALIZATION_ONLY_MISSING_CACHE_ONLY'}));
  },1500);
  historyTimer.unref?.();
}
export function materializeV294CompletedUnifiedHistory(reportDate=''){
  const date=String(reportDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return{ok:false,skipped:true,reason:'REPORT_DATE_MISSING'};
  if(!whppFinalized(date))return{ok:true,skipped:true,reason:'WHPP_NOT_FINALIZED',reportDate:date};
  let dashboardCache={ok:true,skipped:true,reason:'CACHE_NOT_READY'};
  try{dashboardCache=refreshV235CurrentDashboardCacheDate(date,{force:true});}catch(error){dashboardCache={ok:false,error:error?.message||String(error)};}
  invalidateDashboardReadCaches();
  schedulePersistedHistoryBuild(date);
  return{ok:true,reportDate:date,dashboardCache,historyQueued:true,policy:'PERSIST_ONCE_THEN_READ_CACHE'};
}
globalThis.__CE_QC_FINALIZE_PERSISTED_DASHBOARD_HISTORY__=materializeV294CompletedUnifiedHistory;

function stopWhppWatch(){if(whppWatchTimer){clearInterval(whppWatchTimer);whppWatchTimer=null;}whppWatchDate='';}
function watchForWhppFinalization(reportDate=''){
  const date=String(reportDate||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  if(whppWatchTimer&&whppWatchDate===date)return;stopWhppWatch();whppWatchDate=date;
  const started=Date.now();
  const check=()=>{if(whppFinalized(date)){const result=materializeV294CompletedUnifiedHistory(date);console.info('[CE-QC][FINAL_HISTORY_WHPP_FINALIZED]',JSON.stringify(result));stopWhppWatch();return;}if(Date.now()-started>2*60*60*1000)stopWhppWatch();};
  setTimeout(check,1000).unref?.();whppWatchTimer=setInterval(check,5000);whppWatchTimer.unref?.();
}

function runBackfill(reportDate, scopes={}) {
  const date = String(reportDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const carryTypes=[...new Set((scopes.carryTypes||[]).map(value=>String(value||'').toUpperCase()).filter(Boolean))];
  const attemptTypes=[...new Set((scopes.attemptTypes||[]).map(value=>String(value||'').toUpperCase()).filter(Boolean))];
  if (inFlight) {
    if (!queued || date >= queued.reportDate) queued = { reportDate: date, scopes:{...scopes,carryTypes,attemptTypes} };
    return;
  }
  inFlight = true;
  setTimeout(() => {
    try {
      const carryLifecycle = carryTypes.length
        ? repairV294CarryoverLifecycle({ reportDate: date, businessTypes: carryTypes, reason: 'V294_POST_PROCESS_ROUTE' })
        : {ok:true,skipped:true,reason:'NO_CARRY_TYPES'};
      const result = attemptTypes.length
        ? backfillV294StrictAttemptsFromSavedEvidence({ reportDate: date, fromDate: date, businessTypes: attemptTypes, reason: 'V294_POST_PROCESS_ROUTE' })
        : {ok:true,skipped:true,reason:'NO_ATTEMPT_TYPES'};
      let dashboardCache={ok:true,skipped:true,reason:'SIX_BUSINESS_NOT_YET_COMPLETE'};
      try{dashboardCache=refreshV235CurrentDashboardCacheDate(date,{force:true});}catch(error){dashboardCache={ok:false,error:error?.message||String(error)};}
      invalidateDashboardReadCaches();
      if(scopes.family==='SHOPEE')watchForWhppFinalization(date);
      console.info('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL_DONE]', JSON.stringify({ family:scopes.family||'',reportDate:date,carryLifecycle,attemptBackfill:result,dashboardCache,whppFinalizationWatch:scopes.family==='SHOPEE' }));
    } catch (error) {
      console.error('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL_FAILED]', JSON.stringify({ reportDate: date, family:scopes.family||'',carryTypes, attemptTypes, error: error?.message || String(error) }));
    } finally {
      inFlight = false;
      const next = queued;
      queued = null;
      if (next) runBackfill(next.reportDate, next.scopes);
    }
  }, 250).unref?.();
}

function responseHook(req, res, next) {
  const originalJson = res.json.bind(res);
  let handled = false;
  res.json = function v294PostProcessJson(payload) {
    const success = res.statusCode < 400 && payload?.ok !== false;
    const reportDate = responseReportDate(req,payload);
    const out = originalJson(payload);
    if (success && reportDate && !handled) {
      handled = true;
      runBackfill(reportDate, typesForPath(req.path));
    }
    return out;
  };
  next();
}

express.application.post = function v294PostProcessAttemptRegistration(pathValue, ...handlers) {
  const path = String(pathValue || '');
  if (ROUTES.has(path) && handlers.length) return previousPost.call(this, pathValue, responseHook, ...handlers);
  return previousPost.call(this, pathValue, ...handlers);
};

// One bounded startup check only: if the latest imported date was already fully
// finalized before this code upgrade, build any missing lightweight caches from
// SQLite. It never calls CE APIs and never starts work for a newer unfinished day.
if(process.env.NODE_ENV!=='test'&&!process.env.CI){const timer=setTimeout(()=>{const date=latestUnifiedReportDate();if(date&&whppFinalized(date))materializeV294CompletedUnifiedHistory(date);},5000);timer.unref?.();}

console.info('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL]', V294_POST_PROCESS_ATTEMPT_BACKFILL_ID,
  'CCSL/SHOPEE completion backfills strict saved attempt/signing evidence and refreshes current materialized dashboard truth; a tiny SQLite-only WHPP finalization watch queues missing saved-history caches only after the full unified pipeline is actually complete.');