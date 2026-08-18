import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import {
  ensureShopeeDeliveryTrackingSchema,
  SHOPEE_DELIVERY_TRACKER_VERSION,
  syncShopeeDeliveryTrackingForRange
} from './shopeeDeliveryTracker.js';

export const V201_TRACKER_SCHEDULER_VERSION = '2026-08-18-v201-shopee-delivery-tracker-scheduler-v1';
const INTERVAL_MS = Math.max(30 * 60_000, Number(process.env.SHOPEE_DELIVERY_TRACKER_INTERVAL_MS || 2 * 60 * 60_000));
const STARTUP_DELAY_MS = Math.max(60_000, Number(process.env.SHOPEE_DELIVERY_TRACKER_STARTUP_DELAY_MS || 180_000));
const BACKFILL_DAYS = Math.max(30, Math.min(365, Number(process.env.SHOPEE_DELIVERY_TRACKER_BACKFILL_DAYS || 120)));
const CE_HISTORY_BATCH = Math.max(50, Math.min(300, Number(process.env.SHOPEE_DELIVERY_HISTORY_BATCH || 200)));
const CE_HISTORY_MAX_BILLS = Math.max(0, Math.min(3000, Number(process.env.SHOPEE_DELIVERY_HISTORY_MAX_BILLS || 1200)));
let timer = null;
let startupTimer = null;
let inFlight = false;

function meta(db, key) {
  try { return String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value || ''); } catch { return ''; }
}
function setMeta(db, key, value) {
  db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(key, String(value ?? ''), nowIso());
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); } catch { return fallback; }
}
function dateMinusDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Math.max(0, Number(days || 0)));
  return d.toISOString().slice(0, 10);
}
function chunks(values = [], size = CE_HISTORY_BATCH) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
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
function carryAnalysisRows(db, range) {
  try {
    return db.prepare(`SELECT shipmentCode,businessType,sourceReportDate,lastReportDate,status,stateJson FROM carryover_open_items WHERE businessType IN ('SHOPEECN','SHOPEEVN') AND sourceReportDate<=? AND lastReportDate>=?`).all(range.to, range.from).map(row => ({
      ...safeJson(row.stateJson, {}),
      shipmentCode: row.shipmentCode,
      businessType: row.businessType,
      sourceReportDate: row.sourceReportDate,
      reportDate: row.lastReportDate,
      carryStatus: row.status
    }));
  } catch { return []; }
}
function missingAttemptBills(db, range) {
  if (!CE_HISTORY_MAX_BILLS) return [];
  try {
    return db.prepare(`SELECT businessType,shipmentCode FROM shopee_delivery_tracking
      WHERE businessType IN ('SHOPEECN','SHOPEEVN') AND firstReportDate BETWEEN ? AND ? AND podStatus=1 AND attemptNo=0
      ORDER BY firstReportDate,shipmentCode LIMIT ?`).all(range.from, range.to, CE_HISTORY_MAX_BILLS);
  } catch { return []; }
}
async function fetchMissingAttemptHistory(db, range) {
  const missing = missingAttemptBills(db, range);
  if (!missing.length) return { requested: 0, events: [], batches: 0, failedBatches: 0 };
  const client = new CEClient();
  const events = [];
  let batches = 0, failedBatches = 0;
  for (const batch of chunks(missing.map(row => row.shipmentCode))) {
    try {
      const rows = await client.trackQuery(batch);
      events.push(...(Array.isArray(rows) ? rows : []));
      batches += 1;
    } catch (error) {
      failedBatches += 1;
      console.warn('[CE-QC][V201_SHOPEE_TRACKER_HISTORY_BATCH_FAILED]', error?.message || error);
      if (/登录|401|403|AUTH/i.test(String(error?.message || error))) break;
    }
  }
  return { requested: missing.length, events, batches, failedBatches };
}

export async function runShopeeDeliveryTrackerSync({ reason = 'SCHEDULED' } = {}) {
  if (inFlight) return { ok: true, skipped: true, reason: 'ALREADY_RUNNING' };
  inFlight = true;
  const db = getDb();
  try {
    ensureShopeeDeliveryTrackingSchema(db);
    const range = latestCompletedRange(db);
    if (!range) return { ok: true, skipped: true, reason: 'NO_SHOPEE_COMPLETED_SNAPSHOT' };
    const carryRows = carryAnalysisRows(db, range);
    let result = syncShopeeDeliveryTrackingForRange({
      db,
      fromDate: range.from,
      toDate: range.to,
      businessTypes: ['SHOPEECN','SHOPEEVN'],
      analysisRows: carryRows,
      reason: `${reason}:${range.mode}:CARRY_ROWS=${carryRows.length}`
    });

    // Historical problem repair: older completed POD rows may never have had their
    // dispatch trajectory persisted because terminal scan status skipped tracking.
    // Only those POD rows whose attempt is still unknown are queried here. The CE
    // history is then reduced into persistent 60/70/80 facts; export never has to
    // call CE API to invent or recover an attempt.
    const history = await fetchMissingAttemptHistory(db, range);
    if (history.events.length) {
      result = syncShopeeDeliveryTrackingForRange({
        db,
        fromDate: range.from,
        toDate: range.to,
        businessTypes: ['SHOPEECN','SHOPEEVN'],
        analysisRows: carryRows,
        events: history.events,
        reason: `${reason}:${range.mode}:CE_HISTORY_BACKFILL=${history.requested}`
      });
    }

    setMeta(db, 'shopee_delivery_tracker_scheduler_last_at', nowIso());
    setMeta(db, 'shopee_delivery_tracker_scheduler_last_result', JSON.stringify({ ...result, mode: range.mode, carryRows: carryRows.length, historyRequested: history.requested, historyEvents: history.events.length, historyBatches: history.batches, historyFailedBatches: history.failedBatches }).slice(0, 4000));
    console.log('[CE-QC][V201_SHOPEE_TRACKER]', JSON.stringify({ reason, mode: range.mode, from: range.from, to: range.to, carryRows: carryRows.length, historyRequested: history.requested, historyEvents: history.events.length, historyFailedBatches: history.failedBatches, tracked: result.tracked, pod: result.pod, a1: result.a1, a2: result.a2, a3: result.a3, unknown: result.attemptUnknown, validSignDays: result.validSignDays }));
    return { ok: true, ...result, mode: range.mode, carryRows: carryRows.length, historyRequested: history.requested, historyEvents: history.events.length, historyFailedBatches: history.failedBatches };
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
    runShopeeDeliveryTrackerSync({ reason: 'STARTUP' }).catch(error => console.error('[CE-QC][V201_SHOPEE_TRACKER_STARTUP]', error?.stack || error));
  }, STARTUP_DELAY_MS);
  startupTimer.unref?.();
  timer = setInterval(() => runShopeeDeliveryTrackerSync({ reason: 'TWO_HOUR' }).catch(error => console.error('[CE-QC][V201_SHOPEE_TRACKER_INTERVAL]', error?.stack || error)), INTERVAL_MS);
  timer.unref?.();
  console.log(`[CE-QC][V201_SHOPEE_TRACKER] scheduler ready; startupDelay=${STARTUP_DELAY_MS}ms interval=${INTERVAL_MS}ms backfillDays=${BACKFILL_DAYS} historyMaxBills=${CE_HISTORY_MAX_BILLS}`);
  return { started: true, startupDelayMs: STARTUP_DELAY_MS, intervalMs: INTERVAL_MS, backfillDays: BACKFILL_DAYS, historyMaxBills: CE_HISTORY_MAX_BILLS };
}

export function shopeeDeliveryTrackerSchedulerState() { return { started: Boolean(timer || startupTimer), inFlight, intervalMs: INTERVAL_MS, startupDelayMs: STARTUP_DELAY_MS, historyMaxBills: CE_HISTORY_MAX_BILLS, version: V201_TRACKER_SCHEDULER_VERSION }; }
