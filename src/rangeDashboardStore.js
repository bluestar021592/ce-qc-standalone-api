// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation, while dashboard
// reads use V31 source/snapshot selection, V33 Shopee dispatch-attempt timestamp
// fallback, V34 Phnom Penh store/routing semantics, and V35 CCSL580 normal
// diversion semantics.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV35.js';
