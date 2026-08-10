// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation, while dashboard
// reads use V31 source/snapshot selection, final business-rule normalization,
// V33 Shopee dispatch-attempt timestamp fallback, and V34 routing-location rules.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV34.js';
