import express from 'express';
import { SHOPEE, loadBusinessState, saveBusinessState } from './businessStore.js';
import { getDb } from './db.js';

let installed = false;

function isBatchMismatchMessage(value = '') {
  return /BATCH_KEY_PAYLOAD_MISMATCH|批次.*运单内容与已保存记录不一致|批次.*保存内容不一致/i.test(String(value || ''));
}

function prepareShopeeResume(req, res, next) {
  try {
    const state = loadBusinessState(SHOPEE) || {};
    const reportDate = String(state.reportDate || '').trim();
    const runId = String(state.currentRun?.runId || state.lastRunSummary?.runId || state.lastRun?.runId || '').trim();
    const rows = Array.isArray(state.apiBatchStatus) ? state.apiBatchStatus : [];
    const db = getDb();

    // The normalized SQLite table is the source used to rehydrate apiBatchStatus.
    // Clearing only state.apiBatchStatus is not enough: the next load restores the
    // old hash and the same safe resume is blocked again. Delete only audit rows
    // for the current SHOPEE run/date. Per-waybill scan/event/exception checkpoints,
    // POD locks, report rows and final rows are untouched, so successful bills are
    // still skipped and only unfinished/failed bills are retried.
    let deleted = 0;
    if (reportDate && runId) {
      deleted = Number(db.prepare('DELETE FROM business_api_batches WHERE businessType=? AND reportDate=? AND runId=?').run(SHOPEE, reportDate, runId).changes || 0);
    } else if (reportDate) {
      deleted = Number(db.prepare('DELETE FROM business_api_batches WHERE businessType=? AND reportDate=?').run(SHOPEE, reportDate).changes || 0);
    }

    const kept = rows.filter(row => {
      const rowRunId = String(row?.runId || '').trim();
      const rowDate = String(row?.reportDate || '').trim();
      if (runId && rowRunId === runId) return false;
      if (reportDate && rowDate === reportDate && (!runId || !rowRunId)) return false;
      return true;
    });
    state.apiBatchStatus = kept;
    state.resumeBatchAuditResetAt = new Date().toISOString();
    state.resumeBatchAuditResetCount = Math.max(deleted, rows.length - kept.length);

    // Remove the stale user-facing error from the previous failed attempt. The run
    // lock itself is recovered by createOrRecoverBusinessRun; clearing this field
    // prevents the old red banner from surviving after the audit collision is gone.
    if (isBatchMismatchMessage(state.processing?.error)) {
      state.processing = { ...(state.processing || {}), running: false, paused: false, error: '', phase: '等待继续处理' };
    }
    if (isBatchMismatchMessage(state.lastRunSummary?.error || state.lastRunSummary?.errorMessage)) {
      state.lastRunSummary = { ...(state.lastRunSummary || {}), error: '', errorMessage: '' };
    }
    if (isBatchMismatchMessage(state.lastRun?.error || state.lastRun?.errorMessage)) {
      state.lastRun = { ...(state.lastRun || {}), error: '', errorMessage: '' };
    }
    if (reportDate) {
      if (runId) db.prepare('UPDATE business_run_locks SET errorMessage=?,updatedAt=? WHERE businessType=? AND reportDate=? AND runId=?').run('', new Date().toISOString(), SHOPEE, reportDate, runId);
      else db.prepare('UPDATE business_run_locks SET errorMessage=?,updatedAt=? WHERE businessType=? AND reportDate=?').run('', new Date().toISOString(), SHOPEE, reportDate);
    }

    saveBusinessState(state, SHOPEE);
    next();
  } catch (error) {
    console.error('[V28][SHOPEE_RESUME_GUARD]', error);
    next(error);
  }
}

const previousPost = express.application.post;
express.application.post = function v28ResumeGuardPost(...args) {
  if (!installed && args[0] === '/api/shopee/run/resume') {
    installed = true;
    return previousPost.apply(this, [args[0], prepareShopeeResume, ...args.slice(1)]);
  }
  return previousPost.apply(this, args);
};
