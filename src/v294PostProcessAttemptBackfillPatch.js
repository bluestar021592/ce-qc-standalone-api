import express from 'express';
import { backfillV294StrictAttemptsFromSavedEvidence } from './v294AttemptSigningTruth.js';
import { repairV294CarryoverLifecycle } from './v294CarryoverLifecycleTruth.js';
import { refreshV235CurrentDashboardCacheDate } from './v235DashboardCurrentCache.js';
import { requestV328EvidenceRepair } from './v328EvidenceRepairCoordinator.js';
import { requestV334GenericHistoryBuild } from './v334GenericHistoryCoordinator.js';

export const V294_POST_PROCESS_ATTEMPT_BACKFILL_ID = '2026-09-01-v294-finalize-persisted-dashboard-history-v2';
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

function typesForPath(path='') {
  const value=String(path||'');
  if(value.startsWith('/api/shopee/'))return {family:'SHOPEE',carryTypes:['SHOPEECN','SHOPEEVN'],attemptTypes:['SHOPEECN','SHOPEEVN']};
  return {family:'CCSL',carryTypes:['CE','CEAF','TBKH','ALI1688'],attemptTypes:['TBKH']};
}
function responseReportDate(req, payload={}) {
  return String(payload?.run?.reportDate||payload?.summary?.reportDate||payload?.state?.reportDate||payload?.import?.reportDate||payload?.reportDate||req?.body?.reportDate||req?.body?.date||'').slice(0,10);
}
function invalidateDashboardReadCaches(){
  for(const name of ['__CE_QC_INVALIDATE_V236_CURRENT_SUMMARY__','__CE_QC_INVALIDATE_V253_DASHBOARD_FAST_PATH__','__CE_QC_INVALIDATE_V284_DAILY_MEMBERSHIP__']){
    try{globalThis[name]?.();}catch{}
  }
  try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
}
function schedulePersistedHistoryBuild(reportDate){
  const date=String(reportDate||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  clearTimeout(historyTimer);
  historyTimer=setTimeout(()=>{
    for(const type of ATTEMPT_HISTORY_TYPES){try{requestV328EvidenceRepair(type,date);}catch(error){console.warn('[CE-QC][FINAL_HISTORY_THREE_QUEUE_FAILED]',type,date,error?.message||error);}}
    for(const type of GENERIC_HISTORY_TYPES){try{requestV334GenericHistoryBuild(type,date);}catch(error){console.warn('[CE-QC][FINAL_HISTORY_GENERIC_QUEUE_FAILED]',type,date,error?.message||error);}}
    console.info('[CE-QC][FINAL_HISTORY_MATERIALIZATION_QUEUED]',JSON.stringify({reportDate:date,attemptTypes:ATTEMPT_HISTORY_TYPES,genericTypes:GENERIC_HISTORY_TYPES,policy:'AFTER_ACTUAL_WHPP_FINALIZATION_ONLY'}));
  },1500);
  historyTimer.unref?.();
}

export function materializeV294CompletedUnifiedHistory(reportDate=''){
  const date=String(reportDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return{ok:false,skipped:true,reason:'REPORT_DATE_MISSING'};
  let dashboardCache={ok:true,skipped:true,reason:'CACHE_NOT_READY'};
  try{dashboardCache=refreshV235CurrentDashboardCacheDate(date,{force:true});}catch(error){dashboardCache={ok:false,error:error?.message||String(error)};}
  invalidateDashboardReadCaches();
  schedulePersistedHistoryBuild(date);
  return{ok:true,reportDate:date,dashboardCache,historyQueued:true,policy:'PERSIST_ONCE_THEN_READ_CACHE'};
}
globalThis.__CE_QC_FINALIZE_PERSISTED_DASHBOARD_HISTORY__=materializeV294CompletedUnifiedHistory;

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
      console.info('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL_DONE]', JSON.stringify({ family:scopes.family||'',reportDate:date,carryLifecycle,attemptBackfill:result,dashboardCache,historyQueued:false }));
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

console.info('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL]', V294_POST_PROCESS_ATTEMPT_BACKFILL_ID,
  'CCSL/SHOPEE completion backfills strict saved attempt/signing evidence and refreshes current persisted dashboard truth; actual WHPP finalization calls the single unified history materializer, which then queues isolated cache builders after foreground processing is over.');