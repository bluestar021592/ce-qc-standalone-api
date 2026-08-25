import express from 'express';
import { backfillV294StrictAttemptsFromSavedEvidence } from './v294AttemptSigningTruth.js';
import { repairV294CarryoverLifecycle } from './v294CarryoverLifecycleTruth.js';

export const V294_POST_PROCESS_ATTEMPT_BACKFILL_ID = '2026-08-25-v294-post-process-attempt-backfill-v5';
const previousPost = express.application.post;
const ROUTES = new Set(['/api/run','/api/run/start','/api/resume','/api/run/resume','/api/shopee/run/start','/api/shopee/run/resume']);
let inFlight = false;
let queued = null;

function typesForPath(path='') {
  if(String(path).startsWith('/api/shopee/'))return {carryTypes:['SHOPEECN','SHOPEEVN'],attemptTypes:['SHOPEECN','SHOPEEVN']};
  return {carryTypes:['CE','CEAF','TBKH','ALI1688'],attemptTypes:['TBKH']};
}
function responseReportDate(req, payload={}) {
  return String(payload?.run?.reportDate||payload?.summary?.reportDate||payload?.state?.reportDate||payload?.import?.reportDate||payload?.reportDate||req?.body?.reportDate||req?.body?.date||'').slice(0,10);
}

function runBackfill(reportDate, scopes={}) {
  const date = String(reportDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const carryTypes=[...new Set((scopes.carryTypes||[]).map(value=>String(value||'').toUpperCase()).filter(Boolean))];
  const attemptTypes=[...new Set((scopes.attemptTypes||[]).map(value=>String(value||'').toUpperCase()).filter(Boolean))];
  if (inFlight) {
    if (!queued || date >= queued.reportDate) queued = { reportDate: date, scopes:{carryTypes,attemptTypes} };
    return;
  }
  inFlight = true;
  setTimeout(() => {
    try {
      const carryLifecycle = repairV294CarryoverLifecycle({ reportDate: date, businessTypes: carryTypes, reason: 'V294_POST_PROCESS_ROUTE' });
      const result = attemptTypes.length
        ? backfillV294StrictAttemptsFromSavedEvidence({ reportDate: date, fromDate: date, businessTypes: attemptTypes, reason: 'V294_POST_PROCESS_ROUTE' })
        : {ok:true,skipped:true,reason:'NO_ATTEMPT_TYPES'};
      console.info('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL_DONE]', JSON.stringify({ carryLifecycle, attemptBackfill: result }));
      try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
    } catch (error) {
      console.error('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL_FAILED]', JSON.stringify({ reportDate: date, carryTypes, attemptTypes, error: error?.message || String(error) }));
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
  'successful processing repairs carryover closure truth for all completed family members (CCSL=CE/CEAF/TBKH/ALI1688; SHOPEE=CN/VN) while strict attempt/signing backfill remains scoped to TBKH + SHOPEE CN/VN only.');
