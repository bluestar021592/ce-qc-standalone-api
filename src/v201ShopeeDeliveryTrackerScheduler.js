import { getDb, nowIso } from './db.js';
import {
  ensureShopeeDeliveryTrackingSchema,
  SHOPEE_DELIVERY_TRACKER_VERSION,
  syncShopeeDeliveryTrackingForRange
} from './shopeeDeliveryTracker.js';

export const V201_TRACKER_SCHEDULER_VERSION = '2026-08-18-v201-shopee-delivery-tracker-scheduler-v1';
const INTERVAL_MS = Math.max(30 * 60_000, Number(process.env.SHOPEE_DELIVERY_TRACKER_INTERVAL_MS || 2 * 60 * 60_000));
const STARTUP_DELAY_MS = Math.max(60_000, Number(process.env.SHOPEE_DELIVERY_TRACKER_STARTUP_DELAY_MS || 180_000));
const BACKFILL_DAYS = Math.max(30, Math.min(365, Number(process.env.SHOPEE_DELIVERY_TRACKER_BACKFILL_DAYS || 120)));
let timer = null;
let startupTimer = null;
let inFlight = false;

function meta(db, key) {
  try { return String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value || ''); } catch { return ''; }
}
function setMeta(db, key, value) {
  db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(key, String(value ?? ''), nowIso());
}
function dateMinusDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Math.max(0, Number(days || 0)));
  return d.toISOString().slice(0, 10);
}
function latestCompletedRange(db) {
  let latest = '';
  try {
    latest = String(db.prepare(`SELECT MAX(b.reportDate) reportDate FROM unified_import_batches b INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' AND s.status='COMPLETED' AND EXISTS(SELECT 1 FROM unified_import_rows r WHERE r.snapshotId=b.snapshotId AND r.businessType IN ('SHOPEECN','SHOPEEVN'))`).get()?.reportDate || '');
  } catch {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) return null;
  const currentVersion = meta(db, 'shopee_delivery_tracker_version');
  const trackedCount = Number(db.prepare(`SELECT COUNT(*) count FROM shopee_delivery_tracking`).get()?.count || 0);
  if (currentVersion !== SHOPEE_DELIVERY_TRACKER_VERSION || !trackedCount) return { from: dateMinusDays(latest, BACKFILL_DAYS - 1), to: latest, mode: 'INITIAL_BACKFILL' };
  return { from: dateMinusDays(latest, 7), to: latest, mode: 'INCREMENTAL_8_DAYS' };
}

export function runShopeeDeliveryTrackerSync({ reason = 'SCHEDULED' } = {}) {
  if (inFlight) return { ok: true, skipped: true, reason: 'ALREADY_RUNNING' };
  inFlight = true;
  const db = getDb();
  try {
    ensureShopeeDeliveryTrackingSchema(db);
    const range = latestCompletedRange(db);
    if (!range) return { ok: true, skipped: true, reason: 'NO_SHOPEE_COMPLETED_SNAPSHOT' };
    const result = syncShopeeDeliveryTrackingForRange({
      db,
      fromDate: range.from,
      toDate: range.to,
      businessTypes: ['SHOPEECN','SHOPEEVN'],
      reason: `${reason}:${range.mode}`
    });
    setMeta(db, 'shopee_delivery_tracker_scheduler_last_at', nowIso());
    setMeta(db, 'shopee_delivery_tracker_scheduler_last_result', JSON.stringify({ ...result, mode: range.mode }).slice(0, 4000));
    console.log('[CE-QC][V201_SHOPEE_TRACKER]', JSON.stringify({ reason, mode: range.mode, from: range.from, to: range.to, tracked: result.tracked, pod: result.pod, a1: result.a1, a2: result.a2, a3: result.a3, unknown: result.attemptUnknown, validSignDays: result.validSignDays }));
    return { ok: true, ...result, mode: range.mode };
  } catch (error) {
    try { setMeta(db, 'shopee_delivery_tracker_scheduler_last_error', String(error?.message || error).slice(0, 2000)); } catch {}
    console.error('[CE-QC][V201_SHOPEE_TRACKER_FAILED]', error?.stack || error);
    return { ok: false, error: error?.message || String(error) };
  } finally { inFlight = false; }
}

export function startShopeeDeliveryTrackerScheduler() {
  if (timer || startupTimer) return { started: false, reason: 'ALREADY_STARTED' };
  if (process.env.CI || process.env.NODE_ENV === 'test' || String(process.env.CE_QC_DISABLE_SHOPEE_DELIVERY_TRACKER || '') === '1') return { started: false, reason: 'DISABLED_BY_ENV' };
  ensureShopeeDeliveryTrackingSchema(getDb());
  startupTimer = setTimeout(() => {
    startupTimer = null;
    runShopeeDeliveryTrackerSync({ reason: 'STARTUP' });
  }, STARTUP_DELAY_MS);
  startupTimer.unref?.();
  timer = setInterval(() => runShopeeDeliveryTrackerSync({ reason: 'TWO_HOUR' }), INTERVAL_MS);
  timer.unref?.();
  console.log(`[CE-QC][V201_SHOPEE_TRACKER] scheduler ready; startupDelay=${STARTUP_DELAY_MS}ms interval=${INTERVAL_MS}ms backfillDays=${BACKFILL_DAYS}`);
  return { started: true, startupDelayMs: STARTUP_DELAY_MS, intervalMs: INTERVAL_MS, backfillDays: BACKFILL_DAYS };
}

export function shopeeDeliveryTrackerSchedulerState() { return { started: Boolean(timer || startupTimer), inFlight, intervalMs: INTERVAL_MS, startupDelayMs: STARTUP_DELAY_MS, version: V201_TRACKER_SCHEDULER_VERSION }; }
