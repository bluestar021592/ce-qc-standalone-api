// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation, while dashboard
// reads use V31 source/snapshot selection plus the final business-rule
// normalization layer.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreFinal.js';
