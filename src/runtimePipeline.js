import { runQcPipeline as runOriginalQcPipeline } from './pipeline.js';
import {
  createUnifiedThroughputClient,
  V314_ALL_BUSINESS_THROUGHPUT_CORE_ID,
  V314_CONFIRM_CONCURRENCY,
  V314_EVENT_CONCURRENCY,
  V314_EXCEPTION_CONCURRENCY,
  V339_CCSL_CONFIRM_CONCURRENCY,
  V339_CCSL_CONFIRM_HARD_BUDGET_MS
} from './throughputCore.js';
import { createConfirmCompletenessClient, V349_CONFIRM_COMPLETENESS_ID } from './v349ConfirmCompletenessClient.js';
export * from './pipeline.js';

export const RUNTIME_PIPELINE_ID='system-runtime-pipeline-v1';
export const V314_PIPELINE_THROUGHPUT_ID='2026-08-28-v345-all-business-bounded-retry-throughput-pipeline-v1';
export const V339_CCSL_PIPELINE_THROUGHPUT_ID=V314_PIPELINE_THROUGHPUT_ID;

export async function runQcPipeline(options={}){
  const state=options.state||{};
  if(!options.client)return runOriginalQcPipeline(options);
  const businessType=String(state.businessType||'CCSL').toUpperCase();
  const completeClient=createConfirmCompletenessClient(options.client,{label:`${businessType}-confirm-completeness`});
  const client=createUnifiedThroughputClient(state,completeClient,{trackConcurrency:4});
  return runOriginalQcPipeline({...options,client});
}

console.info('[CE-QC][CORE_RUNTIME_PIPELINE]',JSON.stringify({
  id:RUNTIME_PIPELINE_ID,
  compatibilityId:V314_PIPELINE_THROUGHPUT_ID,
  throughputCore:V314_ALL_BUSINESS_THROUGHPUT_CORE_ID,
  confirmCompletenessOwner:V349_CONFIRM_COMPLETENESS_ID,
  scanBatchSize:350,
  shopeeScanConcurrency:V314_CONFIRM_CONCURRENCY,
  ccslScanRemoteConcurrency:V339_CCSL_CONFIRM_CONCURRENCY,
  trackBatchSize:50,
  trackConcurrency:4,
  exceptionBatchSize:50,
  exceptionConcurrency:V314_EXCEPTION_CONCURRENCY,
  ccslConfirmHardBudgetMs:V339_CCSL_CONFIRM_HARD_BUDGET_MS,
  trackRetryOwner:'trackBatching',
  confirmPartialOwner:'v349ConfirmCompletenessClient',
  policy:'UNVERSIONED_RUNTIME_PIPELINE_ONE_SCAN_OWNER_ONE_TRACK_RETRY_OWNER'
}));
void V314_EVENT_CONCURRENCY;
