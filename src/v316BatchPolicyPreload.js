export const V316_BATCH_POLICY_PRELOAD_ID = '2026-08-27-v338-ccsl-350-scan-50-track-preload-v1';

// This module must be the first dependency of v147TrackTimeoutConfig. The carryover
// scheduler imports pipeline.js during module evaluation, and pipeline snapshots its
// batch constants at import time. Keep one canonical policy here so daily and
// carryover runs cannot drift: order/confirm scan=350 tickets, trajectory=50 tickets.
process.env.ORDER_BATCH_SIZE = '350';
process.env.CONFIRM_QUERY_BATCH_SIZE = '350';
process.env.REQUEST_TIMEOUT_MS = '12000';
process.env.CONFIRM_QUERY_TIMEOUT_MS = '12000';
process.env.CE_TRACK_BATCH_BUDGET_MS = '25000';
process.env.CE_CONFIRM_HARD_BUDGET_MS = '18000';
process.env.CE_TRANSIENT_RETRIES = '1';
process.env.CE_TRANSIENT_RETRY_DELAY_MS = '400';
process.env.TRACK_CONCURRENCY = '4';

console.info('[CE-QC][V338_BATCH_POLICY_PRELOAD]', JSON.stringify({
  id: V316_BATCH_POLICY_PRELOAD_ID,
  orderBatchSize: Number(process.env.ORDER_BATCH_SIZE),
  confirmQueryBatchSize: Number(process.env.CONFIRM_QUERY_BATCH_SIZE),
  trackBatchSize: 50,
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS),
  batchBudgetMs: Number(process.env.CE_TRACK_BATCH_BUDGET_MS),
  confirmHardBudgetMs: Number(process.env.CE_CONFIRM_HARD_BUDGET_MS),
  transientRetries: Number(process.env.CE_TRANSIENT_RETRIES),
  trackConcurrency: Number(process.env.TRACK_CONCURRENCY),
  policy: 'CCSL_SCAN_350_TRACK_50_CONFIRM_HARD_CAP_18S_FAIL_FORWARD'
}));
