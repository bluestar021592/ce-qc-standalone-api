import { runQcPipeline as runOriginalQcPipeline } from './pipeline.js';
import {
  createUnifiedThroughputClient,
  V314_ALL_BUSINESS_THROUGHPUT_CORE_ID,
  V314_CONFIRM_CONCURRENCY,
  V314_EVENT_CONCURRENCY,
  V314_EXCEPTION_CONCURRENCY,
  V339_CCSL_CONFIRM_CONCURRENCY,
  V339_CCSL_CONFIRM_HARD_BUDGET_MS
} from './v314ShopeeThroughputCore.js';
export * from './pipeline.js';

export const V314_PIPELINE_THROUGHPUT_ID='2026-08-28-v345-all-business-bounded-retry-throughput-pipeline-v1';
export const V339_CCSL_PIPELINE_THROUGHPUT_ID=V314_PIPELINE_THROUGHPUT_ID;

export async function runQcPipeline(options={}){
  const state=options.state||{};
  if(!options.client)return runOriginalQcPipeline(options);
  // Production policy is explicit instead of inheriting an old TRACK_CONCURRENCY=1
  // environment left by an earlier CCSL-only runtime.
  const client=createUnifiedThroughputClient(state,options.client,{trackConcurrency:4});
  return runOriginalQcPipeline({...options,client});
}

console.info('[CE-QC][V345_ALL_BUSINESS_THROUGHPUT]',JSON.stringify({
  id:V314_PIPELINE_THROUGHPUT_ID,
  core:V314_ALL_BUSINESS_THROUGHPUT_CORE_ID,
  scanBatchSize:350,
  shopeeScanConcurrency:V314_CONFIRM_CONCURRENCY,
  ccslScanRemoteConcurrency:V339_CCSL_CONFIRM_CONCURRENCY,
  trackBatchSize:50,
  trackConcurrency:4,
  exceptionBatchSize:50,
  exceptionConcurrency:V314_EXCEPTION_CONCURRENCY,
  ccslConfirmHardBudgetMs:V339_CCSL_CONFIRM_HARD_BUDGET_MS,
  retryChildrenBounded:true,
  ccslTrackResumeMode:'compact-pending',
  policy:'ONE_ACTIVE_THROUGHPUT_OWNER_ALL_BUSINESSES_SCAN_350_TRACK_50_X4_ALL_RETRY_CHILDREN_BOUNDED_CCSL_CONFIRM_SINGLE_REMOTE_LANE'
}));
void V314_EVENT_CONCURRENCY;
console.info('[CE-QC][V314_SHOPEE_THROUGHPUT]',V314_PIPELINE_THROUGHPUT_ID);
console.info('[CE-QC][V340_CCSL_THROUGHPUT]',V314_PIPELINE_THROUGHPUT_ID);
