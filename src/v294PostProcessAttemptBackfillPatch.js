import express from 'express';
import { backfillV294StrictAttemptsFromSavedEvidence } from './v294AttemptSigningTruth.js';
import { repairV294CarryoverLifecycle } from './v294CarryoverLifecycleTruth.js';

export const V294_POST_PROCESS_ATTEMPT_BACKFILL_ID = '2026-08-25-v294-post-process-attempt-backfill-v2';
const previousPost = express.application.post;
const ROUTES = new Set(['/api/run','/api/run/start','/api/resume','/api/run/resume','/api/shopee/run/start','/api/shopee/run/resume']);
let inFlight = false;
let queuedDate = '';

function runBackfill(reportDate) {
  const date = String(reportDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  if (inFlight) { if (!queuedDate || date > queuedDate) queuedDate = date; return; }
  inFlight = true;
  setImmediate(() => {
    try {
      const carryLifecycle = repairV294CarryoverLifecycle({ reportDate: date, reason: 'V294_POST_PROCESS_ROUTE' });
      const result = backfillV294StrictAttemptsFromSavedEvidence({ reportDate: date, reason: 'V294_POST_PROCESS_ROUTE' });
      console.info('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL_DONE]', JSON.stringify({ carryLifecycle, attemptBackfill: result }));
      try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
    } catch (error) {
      console.error('[CE-QC][V294_POST_PROCESS_ATTEMPT_BACKFILL_FAILED]', JSON.stringify({ reportDate: date, error: error?.message || String(error) }));
    } finally {
      inFlight = false;
      const next = queuedDate;
      queuedDate = '';
      if (next) runBackfill(next);
    }
  });
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
      runBackfill(reportDate);
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
  'successful CCSL/SHOPEE processing first repairs false return-in-progress closures, then reconciles saved-evidence strict attempts for TBKH + SHOPEE CN/VN; failed runs publish neither repair.');
