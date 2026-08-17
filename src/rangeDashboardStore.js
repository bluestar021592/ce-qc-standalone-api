// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// keep the compact V58 reconciliation base, then apply V191 cross-day SHOPEE truth:
// latest VALID source membership is preserved even when analysis is still pending,
// and later POD/dispatch evidence is reconciled back to the original report day.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV191.js';
