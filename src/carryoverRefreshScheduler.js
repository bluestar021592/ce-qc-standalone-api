import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { runQcPipeline } from './pipeline.js';
import { runWhppPipeline } from './whppPipeline.js';
import { updateCarryoverResults } from './unifiedImportStore.js';

export const CARRY_REFRESH_TIMEZONE = 'Asia/Phnom_Penh';
export const CARRY_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const CARRY_REFRESH_POLL_MS = 60 * 1000;
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

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
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase(); }

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
      sourceReportDate,lastReportDate,status,apiStatus,stateJson
    FROM carryover_open_items WHERE status='OPEN' ORDER BY sourceReportDate,shipmentCode`).all();
}

export function buildCarryRefreshState(family, rows, reportDate, refreshId) {
  const prior = rows.map(row => ({ ...safeJson(row.stateJson, {}), shipmentCode: row.shipmentCode, 运单号: row.shipmentCode, businessType: row.businessType }));
  const bills = prior.map(billOf).filter(Boolean);
  return {
    businessType: family, reportDate, sourceName: 'AUTO_OPEN_CARRY_REFRESH', dailyReportReady: true,
    pnhBills: [], carryBills: bills, nextCarryBills: bills, podLocks: [],
    dailyParseRows: prior, priorCarryRows: prior,
    scanResults: [], scanQueryStatus: [], trackResults: [], trackQueryStatus: [], trackEvents: [],
    shipmentTracks: [], shipmentQueryStatus: [], exceptionItems: [], exceptionQueryStatus: [], eventQueryStatus: [], finalRows: [],
    currentRun: { runId: refreshId, reportDate, status: 'running' },
    lastRunSummary: { runId: refreshId, reportDate, runStatus: 'running' },
    processing: { running: true, paused: false, phase: 'AUTO_OPEN_CARRY_REFRESH', runId: refreshId }
  };
}

export async function processCarryFamilyForRefresh(family, rows, { client = new CEClient(), reportDate, refreshId } = {}) {
  if (!rows.length) return { successfulRows: [], failedBills: [] };
  const state = buildCarryRefreshState(family, rows, reportDate, refreshId);
  let outputState = state;
  try {
    const result = family === 'WHPP'
      ? await runWhppPipeline({ state, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false })
      : await runQcPipeline({ state, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false });
    outputState = result?.state || state;
  } catch (error) {
    outputState = error?.state || state;
  }
  const allowed = new Set(rows.map(row => row.shipmentCode));
  const successfulRows = [];
  const success = new Set();
  const failed = new Set();
  for (const row of outputState.finalRows || outputState.trackResults || []) {
    const bill = billOf(row);
    if (!bill || !allowed.has(bill)) continue;
    if (/失败|REFRESH_FAILED|API_PENDING_RETRY|RETRY/i.test(`${row.API状态 || ''} ${row.查询状态 || ''} ${row.apiStatus || ''}`)) failed.add(bill);
    else { successfulRows.push(row); success.add(bill); }
  }
  for (const row of rows) if (!success.has(row.shipmentCode)) failed.add(row.shipmentCode);
  return { successfulRows, failedBills: [...failed] };
}

export function applySuccessfulCarryRefresh(rows, { snapshotId, reportDate } = {}) {
  if (!rows?.length) return null;
  return updateCarryoverResults({ snapshotId, reportDate, rows });
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

export function schedulerStateForTests() { return { started: Boolean(schedulerTimer), inFlight, ccslTypes: [...CCSL_TYPES], shopeeTypes: [...SHOPEE_TYPES] }; }
export function stopCarryoverRefreshSchedulerForTests() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  inFlight = false;
}
