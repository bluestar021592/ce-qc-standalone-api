import { runQcPipeline as runOriginalQcPipeline } from './pipeline.js';
import {
  createShopeeThroughputClient,
  V314_SHOPEE_THROUGHPUT_CORE_ID,
  V314_CONFIRM_CONCURRENCY,
  V314_EVENT_CONCURRENCY,
  V314_EXCEPTION_CONCURRENCY
} from './v314ShopeeThroughputCore.js';
export * from './pipeline.js';

export const V314_PIPELINE_THROUGHPUT_ID = '2026-08-26-v314-shopee-prefetch-pipeline-v1';

export async function runQcPipeline(options = {}) {
  const state = options.state || {};
  const isShopee = String(state.businessType || '').toUpperCase() === 'SHOPEE';
  if (!isShopee || !options.client) return runOriginalQcPipeline(options);
  const client = createShopeeThroughputClient(state, options.client);
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
