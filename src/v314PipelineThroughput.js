import { runQcPipeline as runOriginalQcPipeline } from './pipeline.js';
import {
  createCcslThroughputClient,
  createShopeeThroughputClient,
  V314_SHOPEE_THROUGHPUT_CORE_ID,
  V339_CCSL_THROUGHPUT_CORE_ID,
  V314_CONFIRM_CONCURRENCY,
  V314_EVENT_CONCURRENCY,
  V314_EXCEPTION_CONCURRENCY,
  V339_CCSL_CONFIRM_CONCURRENCY
} from './v314ShopeeThroughputCore.js';
export * from './pipeline.js';

export const V314_PIPELINE_THROUGHPUT_ID = '2026-08-26-v314-shopee-prefetch-pipeline-v1';
export const V339_CCSL_PIPELINE_THROUGHPUT_ID = '2026-08-27-v339-ccsl-350x2-prefetch-track50x4-v1';

export async function runQcPipeline(options = {}) {
  const state = options.state || {};
  if (!options.client) return runOriginalQcPipeline(options);
  const isShopee = String(state.businessType || '').toUpperCase() === 'SHOPEE';
  const client = isShopee
    ? createShopeeThroughputClient(state, options.client)
    : createCcslThroughputClient(state, options.client);
  return runOriginalQcPipeline({ ...options, client });
}

console.info('[CE-QC][V314_SHOPEE_THROUGHPUT]', JSON.stringify({
  id: V314_PIPELINE_THROUGHPUT_ID,
  core: V314_SHOPEE_THROUGHPUT_CORE_ID,
  confirmConcurrency: V314_CONFIRM_CONCURRENCY,
  eventConcurrency: V314_EVENT_CONCURRENCY,
  exceptionConcurrency: V314_EXCEPTION_CONCURRENCY,
  eventBatchSize: 50,
  exceptionBatchSize: 50,
  policy: 'BOUNDED_PREFETCH_KEEP_NATIVE_BATCH_CHECKPOINT_RETRY_SEMANTICS'
}));

console.info('[CE-QC][V339_CCSL_THROUGHPUT]', JSON.stringify({
  id: V339_CCSL_PIPELINE_THROUGHPUT_ID,
  core: V339_CCSL_THROUGHPUT_CORE_ID,
  scanBatchSize: 350,
  scanConcurrency: V339_CCSL_CONFIRM_CONCURRENCY,
  trackBatchSize: 50,
  trackConcurrency: Math.max(1, Number(process.env.TRACK_CONCURRENCY || 4)),
  confirmHardBudgetMs: Math.max(1, Number(process.env.CE_CONFIRM_HARD_BUDGET_MS || 18000)),
  policy: 'CCSL_CONFIRM_350_X2_PREFETCH_ORDERED_NATIVE_COMMIT_TRACK_50_X4_FAIL_FORWARD'
}));
