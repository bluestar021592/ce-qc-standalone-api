import express from 'express';

const PATCH_ID = '2026-08-22-v220-history-read-vs-refresh-semantics-v1';
const SUMMARY_ROUTE = '/api/v183/history-refresh/summary';

// "读取当前状态" must be a pure read. It summarizes the selected uploaded
// date range from the current database state and must never trigger CE API
// calls or mutate terminal/open state. V219 intentionally prepares local
// terminal evidence only when the refresh POST is created; this patch bypasses
// the V219 GET-registration wrapper so the summary route stays read-only.
const previousGet = express.application.get;
express.application.get = function v220PureHistorySummaryGet(pathValue, ...handlers) {
  if (String(pathValue || '') === SUMMARY_ROUTE && handlers.length) {
    return this.route(pathValue).get(...handlers);
  }
  return previousGet.call(this, pathValue, ...handlers);
};

console.log(`[CE-QC][V220] history summary is read-only; terminal reconciliation remains refresh-only.`);

export const V220_HISTORY_REFRESH_SEMANTICS_ID = PATCH_ID;
