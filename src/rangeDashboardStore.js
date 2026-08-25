// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// use latest VALID daily membership as denominator and proven lifecycle truth as
// status authority. V294 adds complete-POD publication gates for attempt/signing
// metrics. V295 separates real first-attempt delivery success from same-day POD.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV295.js';
