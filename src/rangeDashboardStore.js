// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// use the latest VALID + COMPLETED source selection plus the V55 reconciliation
// layer. Cards, drill-down details, external unfinished parcels, normal routing
// destinations and residual abnormalities now share one canonical row set.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV55.js';
