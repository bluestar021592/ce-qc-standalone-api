import express from 'express';
import { SHOPEE, loadBusinessState, saveBusinessState } from './businessStore.js';
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

function clearMismatchState(state = {}) {
  if (isBatchMismatchMessage(state.processing?.error)) {
    state.processing = { ...(state.processing || {}), running: false, paused: false, error: '', phase: '等待继续处理' };
  }
  if (isBatchMismatchMessage(state.lastRunSummary?.error || state.lastRunSummary?.errorMessage)) {
    state.lastRunSummary = { ...(state.lastRunSummary || {}), error: '', errorMessage: '' };
  }
  if (isBatchMismatchMessage(state.lastRun?.error || state.lastRun?.errorMessage)) {
    state.lastRun = { ...(state.lastRun || {}), error: '', errorMessage: '' };
  }
}

function prepareShopeeRun(route) {
  return function prepareShopeeRunMiddleware(req, res, next) {
    try {
      const state = loadBusinessState(SHOPEE) || {};
      const rows = Array.isArray(state.apiBatchStatus) ? state.apiBatchStatus : [];
      const db = getDb();
      const { reportDate, runId, lock } = currentRunContext(db, state);

      if (!reportDate || !shouldResetAudit(route, state, lock)) return next();

      // The normalized SQLite table rehydrates apiBatchStatus. A prior build
      // accidentally dropped payloadHash while hydrating it, so after a restart
      // the same batch key could be paired with a different bill list and the
      // subsequent save aborted with BATCH_KEY_PAYLOAD_MISMATCH. On recovery we
      // remove only audit rows for the current SHOPEE run/date. Per-waybill scan,
      // event, exception, POD, report and final-row checkpoints are untouched.
      let deleted = 0;
      if (runId) {
        deleted = Number(db.prepare('DELETE FROM business_api_batches WHERE businessType=? AND reportDate=? AND runId=?').run(SHOPEE, reportDate, runId).changes || 0);
      } else {
        deleted = Number(db.prepare('DELETE FROM business_api_batches WHERE businessType=? AND reportDate=?').run(SHOPEE, reportDate).changes || 0);
      }

      const kept = rows.filter(row => {
        const rowRunId = String(row?.runId || '').trim();
        const rowDate = String(row?.reportDate || '').trim();
        if (runId && rowRunId === runId) return false;
        if (!runId && reportDate && (!rowDate || rowDate === reportDate)) return false;
        return true;
      });
      state.apiBatchStatus = kept;
      state.resumeBatchAuditResetAt = new Date().toISOString();
      state.resumeBatchAuditResetCount = Math.max(deleted, rows.length - kept.length);
      clearMismatchState(state);

      const now = new Date().toISOString();
      if (runId) {
        db.prepare('UPDATE business_run_locks SET errorMessage=?,updatedAt=? WHERE businessType=? AND reportDate=? AND runId=?').run('', now, SHOPEE, reportDate, runId);
      } else {
        db.prepare('UPDATE business_run_locks SET errorMessage=?,updatedAt=? WHERE businessType=? AND reportDate=?').run('', now, SHOPEE, reportDate);
      }

      saveBusinessState(state, SHOPEE);
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
