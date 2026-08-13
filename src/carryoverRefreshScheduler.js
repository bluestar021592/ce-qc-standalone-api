import { getDb, nowIso } from './db.js';

export const CARRY_REFRESH_TIMEZONE = 'Asia/Phnom_Penh';
export const CARRY_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const CARRY_REFRESH_POLL_MS = 60 * 1000;

let schedulerTimer = null;
let inFlight = false;

function getMeta(db, key) {
  try { return String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value || ''); }
  catch { return ''; }
}
function setMeta(db, key, value) {
  db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(key, String(value ?? ''), nowIso());
}

export function cambodiaClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: CARRY_REFRESH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const minuteOfDay = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  return { date: localDate, hour: Number(parts.hour || 0), minute: Number(parts.minute || 0), second: Number(parts.second || 0), minuteOfDay };
}

export function dueCarryRefreshReason(db = getDb(), date = new Date()) {
  const clock = cambodiaClock(date);
  const lastRollover = getMeta(db, 'carry_refresh_last_rollover_date');
  const lastSuccess = Date.parse(getMeta(db, 'carry_refresh_last_success_at') || '');
  if (clock.minuteOfDay >= 5 && lastRollover !== clock.date) return 'CAMBODIA_DAY_ROLLOVER_0005';
  if (!Number.isFinite(lastSuccess)) return clock.minuteOfDay >= 5 ? 'STARTUP_CATCHUP' : '';
  if (date.getTime() - lastSuccess >= CARRY_REFRESH_INTERVAL_MS) return 'TWO_HOUR_OPEN_REFRESH';
  return '';
}

export function hasActiveBusinessProcessing(db = getDb()) {
  if (db.prepare("SELECT 1 FROM run_locks WHERE status IN ('running','paused','paused_write') LIMIT 1").get()) return true;
  return Boolean(db.prepare("SELECT 1 FROM business_run_locks WHERE status IN ('running','paused','paused_write') LIMIT 1").get());
}

export function loadOpenCarryRows(db = getDb()) {
  return db.prepare(`SELECT shipmentCode,UPPER(COALESCE(businessType,'')) businessType,
      sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt
    FROM carryover_open_items WHERE status='OPEN' ORDER BY sourceReportDate,shipmentCode`).all();
}

export function recordCarryRefreshSuccess(db = getDb(), { date, openCount = 0, refreshed = 0, failed = 0, closed = 0, reason = '' } = {}) {
  setMeta(db, 'carry_refresh_last_success_at', nowIso());
  setMeta(db, 'carry_refresh_last_rollover_date', date || cambodiaClock().date);
  setMeta(db, 'carry_refresh_last_open_count', String(openCount));
  setMeta(db, 'carry_refresh_last_refreshed_count', String(refreshed));
  setMeta(db, 'carry_refresh_last_failed_count', String(failed));
  setMeta(db, 'carry_refresh_last_closed_count', String(closed));
  setMeta(db, 'carry_refresh_last_reason', reason);
}

export function schedulerStateForTests() { return { started: Boolean(schedulerTimer), inFlight }; }
export function stopCarryoverRefreshSchedulerForTests() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  inFlight = false;
}
