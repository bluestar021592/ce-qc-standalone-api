// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// use the latest VALID + COMPLETED source selection plus V55 reconciliation.
// The compact facade keeps bootstrap fast; full card rows are read on demand by
// the V55 metric-detail endpoint.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV55Compact.js';
