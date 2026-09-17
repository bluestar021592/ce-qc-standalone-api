import { loadRangeDashboard as loadRangeDashboardV320 } from './rangeDashboardStoreV320.js';
import { loadRangeDashboard as loadRangeDashboardFinal } from './rangeDashboardStoreFinal.js';

export const INTERACTIVE_RANGE_READ_ID = '2026-09-17-stability-single-day-no-row-scan-v1';

function dateKey(value = '') {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

/**
 * Interactive range owner.
 *
 * Current/single-day pages must be instant and bounded: V320 already provides a
 * dashboard_daily_cache-only path for this case. Do not immediately follow that
 * cache read with the V402 row-level normalization queries, which rescan
 * unified_import_rows + final_rows/business_final_rows and defeat the cache on a
 * multi-GB production database.
 *
 * Explicit multi-day history/report ranges keep the existing final truth owner.
 * This changes only the request-time read path; no business rows, snapshots,
 * ledgers, or database schema are rewritten.
 */
export function loadRangeDashboard(fromDate, toDate) {
  const from = dateKey(fromDate);
  const to = dateKey(toDate);
  if (from && to && from === to) {
    const range = loadRangeDashboardV320(from, to);
    return {
      ...range,
      interactiveRangeReadId: INTERACTIVE_RANGE_READ_ID,
      finalNormalizationApplied: false,
      finalNormalizationMode: 'PRECOMPUTED_DASHBOARD_CACHE_ONLY',
      requestTimeShipmentScan: false
    };
  }
  const range = loadRangeDashboardFinal(fromDate, toDate);
  return {
    ...range,
    interactiveRangeReadId: INTERACTIVE_RANGE_READ_ID,
    finalNormalizationMode: 'EXPLICIT_MULTI_DAY_FINAL_NORMALIZATION',
    requestTimeShipmentScan: true
  };
}

console.info('[CE-QC][INTERACTIVE_RANGE_READ]', INTERACTIVE_RANGE_READ_ID,
  'single-day/current dashboards are cache-only; row-level final normalization remains available only for explicit multi-day range reads.');
