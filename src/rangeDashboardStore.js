// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// use latest VALID/COMPLETED membership plus V136's current-terminal overlay so a
// later POD/return/order-cancel closure cannot remain classified as historical
// unresolved/Pending/OC.
export {
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export { loadRangeDashboard } from './rangeDashboardStoreV136TerminalOverlay.js';
