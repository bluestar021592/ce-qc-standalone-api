import 'dotenv/config';

import { closeDb, getDb, nowIso } from './db.js';
import {
  getDashboardCacheStatus,
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange
} from './rangeDashboardStore.js';

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
const workerId = `${process.pid}-${Date.now()}`;
let workerLeaseOwned = false;

function acquireWorkerLease() {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const purgeUntil = Number(db.prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_BLOCK_KEY)?.value || 0);
    if (Number.isFinite(purgeUntil) && purgeUntil > Date.now()) {
      db.exec('ROLLBACK');
      return false;
    }
    const until = Date.now() + 15 * 60_000;
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
      if (owner === workerId) {
        db.prepare('DELETE FROM app_meta WHERE key IN (?,?)').run(WORKER_ACTIVE_KEY, WORKER_ACTIVE_UNTIL_KEY);
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  } catch {}
  workerLeaseOwned = false;
}

try {
  // STARTUP_WARM is intentionally a true no-op. Return before asking for cache
  // status, because getDashboardCacheStatus() itself opens SQLite. On the large
  // local CE QC database that second connection used to compete with the first
  // browser reads ~1.5s after startup and made the UI feel frozen again.
  if (!reportDate && reason === 'STARTUP_WARM') {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      reason,
      result: { skipped: true, reason: 'STARTUP_WARM_DISABLED_FOR_FAST_FIRST_PAINT' },
      cache: { skipped: true, reason: 'STARTUP_SQLITE_LAZY' }
    })}\n`);
    process.exit(0);
  }

  if (!acquireWorkerLease()) {
    process.stdout.write(`${JSON.stringify({ ok: true, reason, result: { skipped: true, reason: 'FULL_DATA_PURGE_ACTIVE' } })}\n`);
    closeDb();
    process.exit(0);
  }

  let result;
  if (reportDate) {
    markDashboardCacheDirty(reportDate, reason);
    result = refreshDashboardCacheDate(reportDate, { force: true });
  } else {
    const status = getDashboardCacheStatus();
    if (Number(status.cachedDates || 0) === 0) {
      // If a later scheduled refresh finds an empty cache, warm only a bounded
      // recent window instead of scanning 180 historical days in one burst.
      result = warmDashboardCacheRange({ days: warmDays });
    } else {
      result = refreshDashboardCacheDirty({ limit: 24, recentDays: 30 });
    }
  }
  process.stdout.write(`${JSON.stringify({ ok: true, reason, result, cache: getDashboardCacheStatus() })}\n`);
  releaseWorkerLease();
  closeDb();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, reason, error: error?.message || String(error) })}\n`);
  try { releaseWorkerLease(); } catch {}
  try { closeDb(); } catch {}
  process.exit(1);
}
