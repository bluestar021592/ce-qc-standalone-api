// Legacy CCSL throughput import path. The implementation is consolidated in the
// unversioned throughputCore.js module used by every business.
export {
  createCcslThroughputClient,
  createUnifiedThroughputClient,
  V339_CCSL_THROUGHPUT_CORE_ID,
  V339_CCSL_CONFIRM_CONCURRENCY,
  V339_CCSL_CONFIRM_HARD_BUDGET_MS,
  V314_EVENT_CONCURRENCY
} from './throughputCore.js';
