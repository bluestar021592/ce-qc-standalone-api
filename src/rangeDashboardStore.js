// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// use the latest VALID + COMPLETED source selection, Shopee attempt fallback and
// V36 final-location routing semantics. CCSLCN / CCSLZT / CCSL580 are mutually
// exclusive and are determined only by each parcel's latest effective node.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV36.js';
