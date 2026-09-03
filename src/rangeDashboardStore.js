// Final public facade.
// Cache-maintenance APIs stay on the preserved implementation. Dashboard reads
// keep V320 as the source/cache truth owner, then apply the final normal-flow
// business normalization layer (store Pending/OC, CECN/CEZT/580/self-pickup,
// dedicated abnormal thresholds) without falling back to the old V31 selector.
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
import { readV284DailyFacts } from './v284DailyMembershipTruth.js';

export const V386_DIRTY_DASHBOARD_CACHE_TRUTH_ID = '2026-08-31-v386-dirty-date-never-serves-stale-cache-v1';
export const V419_LEDGER_DERIVED_DASHBOARD_REFRESH_ID = '2026-09-03-v419-ledger-derived-dashboard-refresh-v1';

function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function validDates(values = []) {
  return [...new Set((values || []).map(value => String(value || '').slice(0, 10)).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
}
function writeWhppLedgerSummary(reportDate, db = getDb()) {
  let fact = null;
  try {
    fact = readV284DailyFacts(reportDate, reportDate, db)
      .find(row => row.reportDate === reportDate && row.businessType === 'WHPP') || null;
  } catch (error) {
    return { reportDate, refreshed: false, reason: 'WHPP_V284_READ_FAILED', error: error?.message || String(error) };
  }
  if (!fact || fact.ready !== true) return { reportDate, refreshed: false, reason: fact ? 'WHPP_LEDGER_NOT_READY' : 'NO_WHPP_MEMBERSHIP' };
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);
  const prior = safeJson(existing?.summaryJson, {});
  const metrics = {
    ...prior,
    total: Number(fact.total || 0), today: Number(fact.total || 0), pnh: Number(fact.total || 0), todayPnh: Number(fact.total || 0),
    pod: Number(fact.pod || 0), todayPod: Number(fact.pod || 0), scanPod: Number(fact.pod || 0), podRate: Number(fact.podRate || 0),
    returned: Number(fact.returned || 0), sameDayPod: Number(fact.sameDayPod || 0), firstDayPod: Number(fact.sameDayPod || 0), sameDayPodRate: Number(fact.sameDayPodRate || 0),
    pendingNonContinuous: Number(fact.pendingNonContinuous || 0), pending3: Number(fact.pending3 || 0), pending3plus: Number(fact.pending3 || 0),
    ocCurrent: Number(fact.ocCurrent || 0), oc1: Number(fact.oc1 || 0), oc2: Number(fact.oc2 || 0), cycle2: Number(fact.cycle2 || 0),
    shopRetention2: Number(fact.shopRetention2 || 0), workOrder: Number(fact.workOrder || 0), inboundNoScan: Number(fact.inboundNoScan || 0), provinceOpen: Number(fact.provinceOpen || 0),
    attempt1: Number(fact.attempt1 || 0), attempt2: Number(fact.attempt2 || 0), attempt3: Number(fact.attempt3 || 0), attemptUnknown: Number(fact.attemptUnknown || 0),
    dispatchAttempt1: Number(fact.attempt1 || 0), dispatchAttempt2: Number(fact.attempt2 || 0), dispatchAttempt3: Number(fact.attempt3 || 0),
    avgPodDays: fact.avgPodDays ?? prior.avgPodDays ?? null,
    analysisCoverageRate: Number(fact.coverageRate || 0),
    ledgerDerivedTruthId: V419_LEDGER_DERIVED_DASHBOARD_REFRESH_ID,
    ledgerDerivedAt: now
  };
  db.prepare(`INSERT INTO business_history_summary(businessType,reportDate,summaryJson,createdAt,updatedAt)
    VALUES('WHPP',?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`)
    .run(reportDate, JSON.stringify(metrics), now, now);
  const daily = db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);
  if (daily) {
    const dailySummary = { ...safeJson(daily.summaryJson, {}), ...metrics };
    db.prepare("UPDATE business_daily_reports SET summaryJson=?,updatedAt=? WHERE businessType='WHPP' AND reportDate=?")
      .run(JSON.stringify(dailySummary), now, reportDate);
  }
  return { reportDate, refreshed: true, total: metrics.total, pod: metrics.pod, returned: metrics.returned, source: V419_LEDGER_DERIVED_DASHBOARD_REFRESH_ID };
}

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

export function refreshLedgerDerivedDashboardDates(reportDates = [], reason = 'V246_LEDGER_CHANGED') {
  const dates = validDates(reportDates);
  if (!dates.length) return { ok: true, id: V419_LEDGER_DERIVED_DASHBOARD_REFRESH_ID, dates: [], refreshed: 0, results: [] };
  const db = getDb();
  const results = [];
  for (const date of dates) {
    let cache = null;
    try {
      cache = refreshDashboardCacheDate(date, { force: true });
      if (!cache?.refreshed && ['SNAPSHOT_NOT_COMPLETED','NO_VALID_IMPORT'].includes(String(cache?.reason || ''))) {
        markDashboardCacheDirty(date, `${reason}:WAIT_COMPLETED`);
      }
    } catch (error) {
      try { markDashboardCacheDirty(date, `${reason}:CACHE_REFRESH_FAILED`); } catch {}
      cache = { reportDate: date, refreshed: false, reason: 'CACHE_REFRESH_FAILED', error: error?.message || String(error) };
    }
    let whpp = null;
    try { whpp = writeWhppLedgerSummary(date, db); }
    catch (error) { whpp = { reportDate: date, refreshed: false, reason: 'WHPP_SUMMARY_REFRESH_FAILED', error: error?.message || String(error) }; }
    results.push({ reportDate: date, cache, whpp });
  }
  return {
    ok: true,
    id: V419_LEDGER_DERIVED_DASHBOARD_REFRESH_ID,
    dates,
    refreshed: results.filter(item => item.cache?.refreshed || item.whpp?.refreshed).length,
    results
  };
}

globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__ = refreshLedgerDerivedDashboardDates;

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

export { loadRangeDashboard } from './rangeDashboardStoreFinal.js';

console.info('[CE-QC][V386_DIRTY_DASHBOARD_CACHE_TRUTH]', V386_DIRTY_DASHBOARD_CACHE_TRUTH_ID,
  'dirty dates immediately drop derived dashboard rows/date markers; business facts and dirty markers remain untouched until the normal worker rebuild succeeds.');
console.info('[CE-QC][V419_LEDGER_DERIVED_DASHBOARD_REFRESH]', V419_LEDGER_DERIVED_DASHBOARD_REFRESH_ID,
  'post-ledger commit synchronously rebuilds affected derived dashboard dates and rewrites WHPP summary from V284/V246 truth; no CE API call.');
