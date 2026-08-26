// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// keep the historical V295 -> V294 parity chain, while V320 adds one narrow
// single-day protection: a denominator-matched COMPLETED dashboard cache may
// override an unproven ledger admission so a completed day's POD cannot collapse.
// Compatibility contract markers: rangeDashboardStoreV295 / rangeDashboardStoreV294.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV320.js';
