// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// use latest VALID daily membership as denominator and proven lifecycle truth as
// status authority. V294 adds the QC publication rule: 1/2/3 attempt rates and
// average signing days are not published from partial POD evidence.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV294.js';
