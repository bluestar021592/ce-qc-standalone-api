import 'dotenv/config';

import { closeDb, getDb, nowIso } from './db.js';
import {
  getDashboardCacheStatus,
  markDashboardCacheDirty,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange
} from './rangeDashboardStore.js';
import {
  latestCompletedDashboardDate,
  recentCompletedDashboardDates,
  refreshV235CurrentDashboardCacheDate,
  V235_DASHBOARD_CURRENT_CACHE_ID
} from './v235DashboardCurrentCache.js';
import { readV237DashboardTrends } from './v237DashboardTrendRead.js';

const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
};

const reportDate = valueAfter('--date');
const reason = valueAfter('--reason') || (reportDate ? 'EVENT_REFRESH' : 'SCHEDULED_REFRESH');
const warmDays = Math.max(1, Math.min(60, Number(process.env.DASHBOARD_CACHE_WARM_DAYS || 30)));
const WORKER_ACTIVE_KEY = 'dashboard_cache_worker_active';
const WORKER_ACTIVE_UNTIL_KEY = 'dashboard_cache_worker_active_until';
const PURGE_BLOCK_KEY = 'data_purge_block_until';
const WORKER_LEASE_MS = 5 * 60_000;
const TREND_AUDIT_ID = '2026-08-23-v243-post-rebuild-flat-series-audit-v1';
const TREND_AUDIT_META_KEY = 'v243_trend_audit_latest';
const AUDIT_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP','CCSL','SHOPEE','ALL'];
const workerId = `${process.pid}-${Date.now()}`;
const workerStartedAt = Date.now();
let workerLeaseOwned = false;

function writeResult(result) {
  process.stdout.write(`${JSON.stringify({ ok: true, reason, reportDate, cacheId: V235_DASHBOARD_CURRENT_CACHE_ID, elapsedMs: Date.now()-workerStartedAt, result })}\n`);
}
function writeSkip(skipReason) {
  writeResult({ skipped: true, reason: skipReason });
}

function activeForegroundRun(db = getDb()) {
  // A normal "paused" run has stopped scan/track writes and may safely coexist
  // with a read-only trend-cache build. Only actively running or paused_write
  // states still own the SQLite write path and should delay the cache child.
  if (db.prepare("SELECT 1 FROM run_locks WHERE status IN ('running','paused_write') LIMIT 1").get()) return true;
  return Boolean(db.prepare("SELECT 1 FROM business_run_locks WHERE status IN ('running','paused_write') LIMIT 1").get());
}

function ownerPid(owner = '') {
  const pid = Number(String(owner || '').split('-')[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function acquireWorkerLease() {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const purgeUntil = Number(db.prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_BLOCK_KEY)?.value || 0);
    if (Number.isFinite(purgeUntil) && purgeUntil > Date.now()) {
      db.exec('ROLLBACK');
      return false;
    }
    const existingUntil = Number(db.prepare('SELECT value FROM app_meta WHERE key=?').get(WORKER_ACTIVE_UNTIL_KEY)?.value || 0);
    const existingOwner = String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(WORKER_ACTIVE_KEY)?.value || '');
    const existingPid = ownerPid(existingOwner);
    const activeExistingLease = existingOwner && Number.isFinite(existingUntil) && existingUntil > Date.now() && existingOwner !== workerId;
    if (activeExistingLease && pidAlive(existingPid)) {
      db.exec('ROLLBACK');
      return false;
    }
    if (activeExistingLease && !pidAlive(existingPid)) {
      db.prepare('DELETE FROM app_meta WHERE key IN (?,?)').run(WORKER_ACTIVE_KEY, WORKER_ACTIVE_UNTIL_KEY);
      process.stderr.write(`[CE-QC][V239] cleared stale dashboard-cache lease owner=${existingOwner} until=${existingUntil}\n`);
    }
    const until = Date.now() + WORKER_LEASE_MS;
    const upsert = db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    upsert.run(WORKER_ACTIVE_KEY, workerId, nowIso());
    upsert.run(WORKER_ACTIVE_UNTIL_KEY, String(until), nowIso());
    db.exec('COMMIT');
    workerLeaseOwned = true;
    return true;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function releaseWorkerLease() {
  if (!workerLeaseOwned) return;
  try {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      const owner = String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(WORKER_ACTIVE_KEY)?.value || '');
      if (owner === workerId) db.prepare('DELETE FROM app_meta WHERE key IN (?,?)').run(WORKER_ACTIVE_KEY, WORKER_ACTIVE_UNTIL_KEY);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  } catch {}
  workerLeaseOwned = false;
}

function uniqueCount(rows, key) {
  return new Set(rows.map(row => row?.[key]).filter(value => value !== null && value !== undefined).map(value => String(value))).size;
}

function auditRecentTrendSeries(dates = []) {
  const ordered = [...new Set(dates.map(value => String(value || '').slice(0,10)).filter(Boolean))].sort();
  if (!ordered.length) return { auditId: TREND_AUDIT_ID, fromDate: '', toDate: '', dates: [], byType: {}, suspiciousFlatSeries: [] };
  const fromDate = ordered[0], toDate = ordered.at(-1);
  const byType = {};
  const suspiciousFlatSeries = [];
  for (const type of AUDIT_TYPES) {
    const trend = readV237DashboardTrends(type, fromDate, toDate);
    const ready = (trend.daily || []).filter(row => row?.ready);
    const flatRateKeys = ['podRate','ocRate','sameDayPodRate'].filter(key => ready.length >= 3 && uniqueCount(ready,key) <= 1);
    const suspicious = ready.length >= 3 && flatRateKeys.length === 3 && ready.some(row => Number(row.total || 0) > 0);
    const daily = ready.map(row => ({
      reportDate: row.reportDate,
      total: Number(row.total || 0),
      pod: Number(row.pod || 0),
      podRate: Number(row.podRate || 0),
      ocCurrent: Number(row.ocCurrent || 0),
      ocRate: Number(row.ocRate || 0),
      sameDayPod: Number(row.sameDayPod || 0),
      sameDayPodRate: Number(row.sameDayPodRate || 0)
    }));
    byType[type] = {
      readyDates: ready.length,
      missingDates: Array.isArray(trend.missingDates) ? trend.missingDates : [],
      unique: {
        total: uniqueCount(ready,'total'),
        podRate: uniqueCount(ready,'podRate'),
        ocRate: uniqueCount(ready,'ocRate'),
        sameDayPodRate: uniqueCount(ready,'sameDayPodRate')
      },
      flatRateKeys,
      status: suspicious ? 'SUSPICIOUS_FLAT_SERIES' : (ready.length ? 'OK' : 'NO_READY_DATES'),
      daily
    };
    if (suspicious) suspiciousFlatSeries.push(type);
  }
  const audit = { auditId: TREND_AUDIT_ID, fromDate, toDate, dates: ordered, byType, suspiciousFlatSeries };
  try {
    getDb().prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`)
      .run(TREND_AUDIT_META_KEY, JSON.stringify(audit), nowIso());
  } catch (error) {
    audit.persistError = error?.message || String(error);
  }
  return audit;
}

try {
  if (/^(?:UNIFIED_IMPORT|DAILY_IMPORT|SHOPEE_IMPORT)$/.test(reason)) {
    writeSkip('IMPORT_DIRTY_ONLY_WAIT_FOR_RUN_COMPLETED');
    process.exit(0);
  }

  if (activeForegroundRun()) {
    writeSkip('FOREGROUND_PROCESSING_ACTIVE');
    closeDb();
    process.exit(0);
  }
  if (!acquireWorkerLease()) {
    writeSkip('CACHE_OR_PURGE_WORKER_ALREADY_ACTIVE');
    closeDb();
    process.exit(0);
  }

  let result;
  if (reportDate) {
    markDashboardCacheDirty(reportDate, reason);
    result = refreshV235CurrentDashboardCacheDate(reportDate, { force: true });
  } else if (reason === 'V235_INTERACTIVE_STARTUP' || reason === 'STARTUP_WARM') {
    const dates = recentCompletedDashboardDates(7);
    const results = [];
    for (const date of dates) {
      const startedAt=Date.now();
      // V242 intentionally rebuilds startup history even when an older V240
      // marker says CURRENT_CACHE_READY. V240's formula fixes shared one cache
      // contract id, so an already-built historical row can otherwise survive
      // a code update and keep stale percentages indefinitely.
      const item=refreshV235CurrentDashboardCacheDate(date, { force: true });
      results.push({...item,elapsedMs:Date.now()-startedAt});
    }
    const audit = auditRecentTrendSeries(dates);
    result = {
      mode: 'V243_FORCED_RECENT_7_REBUILD_WITH_AUDIT',
      latestDate: dates[0] || latestCompletedDashboardDate(),
      checked: dates.length,
      refreshed: results.filter(item => item.refreshed).length,
      results,
      audit
    };
  } else {
    const status = getDashboardCacheStatus();
    if (Number(status.cachedDates || 0) === 0) result = warmDashboardCacheRange({ days: warmDays });
    else result = refreshDashboardCacheDirty({ limit: 24, recentDays: 30 });
  }

  writeResult(result);
  releaseWorkerLease();
  closeDb();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, reason, cacheId: V235_DASHBOARD_CURRENT_CACHE_ID, elapsedMs: Date.now()-workerStartedAt, error: error?.stack || error?.message || String(error) })}\n`);
  try { releaseWorkerLease(); } catch {}
  try { closeDb(); } catch {}
  process.exit(1);
}
