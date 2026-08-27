// Compatibility module only. Active production throughput is consolidated in
// v314ShopeeThroughputCore.js for every business. Keeping this filename avoids
// breaking old imports without maintaining a second implementation.
export {
  createCcslThroughputClient,
  createUnifiedThroughputClient,
  V339_CCSL_THROUGHPUT_CORE_ID,
  V339_CCSL_CONFIRM_CONCURRENCY,
  V339_CCSL_CONFIRM_HARD_BUDGET_MS,
  V314_EVENT_CONCURRENCY
} from './v314ShopeeThroughputCore.js';
