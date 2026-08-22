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
      const item=refreshV235CurrentDashboardCacheDate(date, { force: false });
      results.push({...item,elapsedMs:Date.now()-startedAt});
    }
    result = { mode: 'LATEST_PLUS_RECENT_7', latestDate: dates[0] || latestCompletedDashboardDate(), checked: dates.length, refreshed: results.filter(item => item.refreshed).length, results };
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
