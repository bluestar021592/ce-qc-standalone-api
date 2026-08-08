import express from 'express';
import { SHOPEE, loadBusinessState, saveBusinessState } from './businessStore.js';

let installed = false;

function prepareShopeeResume(req, res, next) {
  try {
    const state = loadBusinessState(SHOPEE) || {};
    const reportDate = String(state.reportDate || '').trim();
    const runId = String(state.currentRun?.runId || state.lastRunSummary?.runId || state.lastRun?.runId || '').trim();
    const rows = Array.isArray(state.apiBatchStatus) ? state.apiBatchStatus : [];

    if (rows.length) {
      // apiBatchStatus is audit metadata only. Per-waybill scan/event/exception
      // statuses are the real resume checkpoint. A failed fallback can split one
      // logical batch into different payloads while keeping the same numeric batch
      // index, so retaining the old payload hash can falsely block a safe resume.
      // Remove only the current run/date audit keys before resume; successful
      // waybills remain protected by scanQueryStatus/eventQueryStatus/etc. and are
      // not queried again.
      const kept = rows.filter(row => {
        const rowRunId = String(row?.runId || '').trim();
        const rowDate = String(row?.reportDate || '').trim();
        if (runId && rowRunId === runId) return false;
        if (reportDate && rowDate === reportDate && (!runId || !rowRunId)) return false;
        return true;
      });
      if (kept.length !== rows.length) {
        state.apiBatchStatus = kept;
        state.resumeBatchAuditResetAt = new Date().toISOString();
        state.resumeBatchAuditResetCount = rows.length - kept.length;
        saveBusinessState(state, SHOPEE);
      }
    }
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
