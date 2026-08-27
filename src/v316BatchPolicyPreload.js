export const V316_BATCH_POLICY_PRELOAD_ID = '2026-08-27-v337-ccsl-confirm-hard-cap-preload-v1';

// This module must be the first dependency of v147TrackTimeoutConfig. The carryover
// scheduler imports pipeline.js during module evaluation, and pipeline snapshots its
// batch constants at import time. Set the bounded policy before any scheduler/server
// path can preload pipeline/trackBatching so daily and carryover runs are identical.
process.env.ORDER_BATCH_SIZE = '100';
process.env.CONFIRM_QUERY_BATCH_SIZE = '100';
process.env.REQUEST_TIMEOUT_MS = '12000';
process.env.CONFIRM_QUERY_TIMEOUT_MS = '12000';
process.env.CE_TRACK_BATCH_BUDGET_MS = '25000';
process.env.CE_CONFIRM_HARD_BUDGET_MS = '18000';
process.env.CE_TRANSIENT_RETRIES = '1';
process.env.CE_TRANSIENT_RETRY_DELAY_MS = '400';
process.env.TRACK_CONCURRENCY = '4';

console.info('[CE-QC][V337_BATCH_POLICY_PRELOAD]', JSON.stringify({
  id: V316_BATCH_POLICY_PRELOAD_ID,
  orderBatchSize: Number(process.env.ORDER_BATCH_SIZE),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS),
  batchBudgetMs: Number(process.env.CE_TRACK_BATCH_BUDGET_MS),
  confirmHardBudgetMs: Number(process.env.CE_CONFIRM_HARD_BUDGET_MS),
  transientRetries: Number(process.env.CE_TRANSIENT_RETRIES),
  trackConcurrency: Number(process.env.TRACK_CONCURRENCY),
  policy: 'CONFIRM_QUERY_CORE_HARD_CAP_18S_FAIL_FORWARD'
}));
