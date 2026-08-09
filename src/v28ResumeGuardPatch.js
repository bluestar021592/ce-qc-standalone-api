import express from 'express';
import { SHOPEE, loadBusinessState } from './businessStore.js';
import { getDb } from './db.js';

const guardedRoutes = new Set(['/api/shopee/run/start', '/api/shopee/run/resume']);
const installedRoutes = new Set();

function isBatchMismatchMessage(value = '') {
  return /BATCH_KEY_PAYLOAD_MISMATCH|批次.*运单内容与已保存记录不一致|批次.*保存内容不一致/i.test(String(value || ''));
}

function currentRunContext(db, state = {}) {
  const reportDate = String(state.reportDate || '').trim();
  let runId = String(state.currentRun?.runId || state.lastRunSummary?.runId || state.lastRun?.runId || '').trim();
  let lock = null;
  if (reportDate) {
    lock = db.prepare('SELECT * FROM business_run_locks WHERE businessType=? AND reportDate=?').get(SHOPEE, reportDate) || null;
    if (!runId) runId = String(lock?.runId || '').trim();
  }
  return { reportDate, runId, lock };
}

function shouldResetAudit(route, state = {}, lock = null) {
  if (route === '/api/shopee/run/resume') return true;
  if (isBatchMismatchMessage(state.processing?.error)) return true;
  if (isBatchMismatchMessage(state.lastRunSummary?.error || state.lastRunSummary?.errorMessage)) return true;
  if (isBatchMismatchMessage(state.lastRun?.error || state.lastRun?.errorMessage)) return true;
  if (isBatchMismatchMessage(lock?.errorMessage)) return true;
  // A failed/paused run is a recovery path. The per-waybill scan/event tables are
  // authoritative, while business_api_batches is only idempotency/audit metadata.
  // Resetting only the current run's audit rows prevents a stale batch key from
  // blocking recovery without re-requesting bills that already have saved results.
  return ['failed', 'paused'].includes(String(lock?.status || '').toLowerCase());
}

function prepareShopeeRun(route) {
  return function prepareShopeeRunMiddleware(req, res, next) {
    try {
      const state = loadBusinessState(SHOPEE) || {};
      const db = getDb();
      const { reportDate, runId, lock } = currentRunContext(db, state);

      if (!reportDate || !shouldResetAudit(route, state, lock)) return next();

      // The normalized SQLite table rehydrates apiBatchStatus. Remove only the
      // current run/date audit rows so the stale batch hash cannot block recovery.
      // Do NOT call saveBusinessState(state) here: loadBusinessState hydrates large
      // per-waybill/event arrays, and serializing that whole recovered state again
      // can exceed V8's maximum string size and throw "Invalid string length".
      // The next route handler reloads from normalized SQLite tables, so deleting
      // the audit metadata and clearing the run-lock error is sufficient.
      if (runId) {
        db.prepare('DELETE FROM business_api_batches WHERE businessType=? AND reportDate=? AND runId=?').run(SHOPEE, reportDate, runId);
      } else {
        db.prepare('DELETE FROM business_api_batches WHERE businessType=? AND reportDate=?').run(SHOPEE, reportDate);
      }

      const now = new Date().toISOString();
      if (runId) {
        db.prepare('UPDATE business_run_locks SET errorMessage=?,updatedAt=? WHERE businessType=? AND reportDate=? AND runId=?').run('', now, SHOPEE, reportDate, runId);
      } else {
        db.prepare('UPDATE business_run_locks SET errorMessage=?,updatedAt=? WHERE businessType=? AND reportDate=?').run('', now, SHOPEE, reportDate);
      }

      next();
    } catch (error) {
      console.error('[V28][SHOPEE_RUN_GUARD]', route, error);
      next(error);
    }
  };
}

const previousPost = express.application.post;
express.application.post = function v28ResumeGuardPost(...args) {
  const route = String(args[0] || '');
  if (guardedRoutes.has(route) && !installedRoutes.has(route)) {
    installedRoutes.add(route);
    return previousPost.apply(this, [args[0], prepareShopeeRun(route), ...args.slice(1)]);
  }
  return previousPost.apply(this, args);
};
