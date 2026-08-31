// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// keep the historical V295 -> V294 parity chain, while V320 adds one narrow
// single-day protection: a denominator-matched COMPLETED dashboard cache may
// override an unproven ledger admission so a completed day's POD cannot collapse.
// Compatibility contract markers: rangeDashboardStoreV295 / rangeDashboardStoreV294.
import { getDb } from './db.js';
import {
  markDashboardCacheDirty as markDashboardCacheDirtyLegacy,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  getDashboardCacheStatus as getDashboardCacheStatusLegacy,
  RANGE_DASHBOARD_BUSINESS_TYPES
} from './rangeDashboardStoreLegacy.js';

export const V386_DIRTY_DASHBOARD_CACHE_TRUTH_ID = '2026-08-31-v386-dirty-date-never-serves-stale-cache-v1';

// dashboard_daily_cache/dashboard_cache_dates are derived acceleration tables,
// never business facts. A dirty date must stop serving its previous derived rows
// immediately, even when the daily membership count is unchanged and the full
// multi-business cache cannot be rebuilt yet. Keep dashboard_cache_dirty itself
// until the normal worker successfully rebuilds the date and clears that marker.
export function invalidateV386DirtyDashboardCaches(reportDate = '', db = getDb()) {
  const requested = String(reportDate || '').trim();
  try {
    const dirty = requested
      ? db.prepare('SELECT reportDate FROM dashboard_cache_dirty WHERE reportDate=?').all(requested)
      : db.prepare('SELECT reportDate FROM dashboard_cache_dirty ORDER BY dirtyAt').all();
    const dates = [...new Set(dirty.map(row => String(row?.reportDate || '').trim()).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))];
    if (!dates.length) return { invalidated: 0, dates: [] };
    const dropDate = db.prepare('DELETE FROM dashboard_cache_dates WHERE reportDate=?');
    const dropRows = db.prepare('DELETE FROM dashboard_daily_cache WHERE reportDate=?');
    for (const date of dates) {
      // Remove the completion marker first. If the process were interrupted
      // between the two tiny derived-cache deletes, range readers fail closed to
      // direct SQLite truth instead of treating an incomplete cache as complete.
      dropDate.run(date);
      dropRows.run(date);
    }
    return { invalidated: dates.length, dates };
  } catch {
    // Fresh/test databases may not have cache tables yet. The preserved legacy
    // owner creates them on first cache use; never turn cache hygiene into a
    // startup failure.
    return { invalidated: 0, dates: [] };
  }
}

export function markDashboardCacheDirty(reportDate, reason = 'DATA_CHANGED') {
  const marked = markDashboardCacheDirtyLegacy(reportDate, reason);
  if (marked) invalidateV386DirtyDashboardCaches(reportDate);
  return marked;
}

export function getDashboardCacheStatus() {
  // Launcher/backend health reads this on startup. This also repairs dates that
  // were already dirty before V386 was installed, without re-upload or rerun.
  invalidateV386DirtyDashboardCaches();
  return getDashboardCacheStatusLegacy();
}

export {
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange,
  RANGE_DASHBOARD_BUSINESS_TYPES
};

export { loadRangeDashboard } from './rangeDashboardStoreV320.js';

console.info('[CE-QC][V386_DIRTY_DASHBOARD_CACHE_TRUTH]', V386_DIRTY_DASHBOARD_CACHE_TRUTH_ID,
  'dirty dates immediately drop derived dashboard rows/date markers; business facts and dirty markers remain untouched until the normal worker rebuild succeeds.');
