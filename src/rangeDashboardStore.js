// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// now finish with V284: latest VALID daily membership is the denominator and V246
// lifecycle ledger is the primary status truth; legacy completed/final rows are
// fallback evidence only and may no longer turn a whole historical day into zero.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV284.js';
