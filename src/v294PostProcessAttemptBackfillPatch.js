import express from 'express';
import { backfillV294StrictAttemptsFromSavedEvidence } from './v294AttemptSigningTruth.js';
import { repairV294CarryoverLifecycle } from './v294CarryoverLifecycleTruth.js';

export const V294_POST_PROCESS_ATTEMPT_BACKFILL_ID = '2026-08-25-v294-post-process-attempt-backfill-v3';
const previousPost = express.application.post;
const ROUTES = new Set(['/api/run','/api/run/start','/api/resume','/api/run/resume','/api/shopee/run/start','/api/shopee/run/resume']);
let inFlight = false;
let queued = null;

function typesForPath(path='') {
  return String(path).startsWith('/api/shopee/') ? ['SHOPEECN','SHOPEEVN'] : ['TBKH'];
}

function runBackfill(reportDate, businessTypes) {
  const date = String(reportDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const types = [...new Set((businessTypes || []).map(value => String(value || '').toUpperCase()).filter(Boolean))];
  if (inFlight) {
    if (!queued || date >= queued.reportDate) queued = { reportDate: date, businessTypes: types };
    return;
  }
  inFlight = true;
  // Response is already sent before this task starts. Keep the automatic repair
  // strictly scoped to the completed report date so the 25GB production DB is
  // never synchronously rescanned across its full history after every run.
  setTimeout(() => {
    try {
      const carryLifecycle = repairV294CarryoverLifecycle({ reportDate: date, businessTypes: types, reason: 'V294_POST_PROCESS_ROUTE' });
      const result = backfillV294StrictAttemptsFromSavedEvidence({ reportDate: date, fromDate: date, businessTypes: types, reason: 'V294_POST_PROCESS_ROUTE' });
      console.info('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL_DONE]', JSON.stringify({ carryLifecycle, attemptBackfill: result }));
      try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
    } catch (error) {
      console.error('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL_FAILED]', JSON.stringify({ reportDate: date, businessTypes: types, error: error?.message || String(error) }));
    } finally {
      inFlight = false;
      const next = queued;
      queued = null;
      if (next) runBackfill(next.reportDate, next.businessTypes);
    }
  }, 250).unref?.();
}

function responseHook(req, res, next) {
  const originalJson = res.json.bind(res);
  let handled = false;
  res.json = function v294PostProcessJson(payload) {
    const success = res.statusCode < 400 && payload?.ok !== false;
    const reportDate = String(payload?.run?.reportDate || payload?.summary?.reportDate || payload?.state?.reportDate || '').slice(0, 10);
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
  'successful CCSL/SHOPEE processing repairs only the completed day after response: CCSL→TBKH, SHOPEE→CN/VN; return-in-progress is reopened and strict attempt/signing evidence is reconciled without a full-history main-thread scan.');
