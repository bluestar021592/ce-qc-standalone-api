import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { runQcPipeline } from './pipeline.js';
import { runWhppPipeline } from './whppPipeline.js';
import { updateCarryoverResults } from './unifiedImportStore.js';

export const CARRY_REFRESH_TIMEZONE = 'Asia/Phnom_Penh';
export const CARRY_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const CARRY_REFRESH_POLL_MS = 60 * 1000;
export const CARRY_REFRESH_STARTUP_DELAY_MS = Math.max(30_000, Math.min(10 * 60 * 1000, Number(process.env.CARRY_REFRESH_STARTUP_DELAY_MS || 90_000)));
const FAILURE_RETRY_MS = 15 * 60 * 1000;
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

let schedulerTimer = null;
let startupTimer = null;
let startupNotBefore = 0;
let inFlight = false;
let lastFailureAt = 0;

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
function normalizeDynamicCarryRow(row = {}) {
  const state = String(row.currentState || row.scanNormalizedState || '').toUpperCase();
  const category = String(row.primaryCategory || row.主分类 || row.异常分类 || '');
  const returnInProgress = state === 'RETURN_IN_PROGRESS' || row.退回状态 === '退回处理中' || /退回处理中/.test(category);
  if (returnInProgress) {
    return {
      ...row,
      dynamicOriginalCategory: category,
      primaryCategory: '逆向处理中',
      主分类: '逆向处理中',
      异常分类: '逆向处理中',
      currentState: 'RETURN_IN_PROGRESS',
      退回状态: '退回处理中',
      dynamicCarryRule: 'KEEP_OPEN_UNTIL_RETURN_86'
    };
  }
  const cancelled = state === 'ORDER_CANCELLED' || row.订单取消 === '是' || row.取消状态 === '已取消' || String(row.orderStatus || '') === '10' || /订单取消/.test(category);
  if (cancelled) {
    return { ...row, matchedRule: 'NORMAL_FINAL_HUB', dynamicTerminalReason: 'ORDER_CANCELLED', dynamicCarryRule: 'CLOSE_CANCELLED' };
  }
  return row;
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
  const purgeBlockUntil = Number(getMeta(db, 'data_purge_block_until') || 0);
  if (Number.isFinite(purgeBlockUntil) && purgeBlockUntil > Date.now()) return true;
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
    else { successfulRows.push(normalizeDynamicCarryRow(row)); success.add(bill); }
  }
  for (const row of rows) if (!success.has(row.shipmentCode)) failed.add(row.shipmentCode);
  return { successfulRows, failedBills: [...failed] };
}

export function applySuccessfulCarryRefresh(rows, { snapshotId, reportDate } = {}) {
  if (!rows?.length) return null;
  // Reuse the exact persistence path already used by successful normal processing.
  // Failed API bills are never passed here, so their previous current state is untouched.
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

export async function refreshOpenCarryNow({ reason = 'INTERNAL', client = new CEClient(), date = new Date(), db = getDb() } = {}) {
  if (inFlight) return { ok: true, skipped: true, reason: 'ALREADY_RUNNING' };
  if (hasActiveBusinessProcessing(db)) return { ok: true, skipped: true, reason: 'FOREGROUND_PROCESSING_ACTIVE' };
  inFlight = true;
  const clock = cambodiaClock(date);
  const refreshId = `AUTO-CARRY-${clock.date}-${Date.now()}`;
  try {
    const open = loadOpenCarryRows(db);
    if (!open.length) {
      recordCarryRefreshSuccess(db, { date: clock.date, reason, openCount: 0 });
      return { ok: true, refreshId, reason, openBefore: 0, openAfter: 0, refreshed: 0, failed: 0, closed: 0 };
    }

    const ccslRows = open.filter(row => CCSL_TYPES.has(row.businessType));
    const shopeeRows = open.filter(row => SHOPEE_TYPES.has(row.businessType));
    const whppRows = open.filter(row => row.businessType === 'WHPP');
    const outcomes = [
      await processCarryFamilyForRefresh('CCSL', ccslRows, { client, reportDate: clock.date, refreshId: `${refreshId}-CCSL` }),
      await processCarryFamilyForRefresh('SHOPEE', shopeeRows, { client, reportDate: clock.date, refreshId: `${refreshId}-SHOPEE` }),
      await processCarryFamilyForRefresh('WHPP', whppRows, { client, reportDate: clock.date, refreshId: `${refreshId}-WHPP` })
    ];
    const successfulRows = outcomes.flatMap(item => item.successfulRows);
    const failedBills = new Set(outcomes.flatMap(item => item.failedBills));
    for (const row of open) {
      if (!CCSL_TYPES.has(row.businessType) && !SHOPEE_TYPES.has(row.businessType) && row.businessType !== 'WHPP') failedBills.add(row.shipmentCode);
    }

    if (successfulRows.length) applySuccessfulCarryRefresh(successfulRows, { snapshotId: refreshId, reportDate: clock.date });
    const openAfter = Number(db.prepare("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN'").get()?.count || 0);
    const closed = Math.max(0, open.length - openAfter);

    // A total API outage does not change any shipment state and is retried after a short throttle.
    if (!successfulRows.length && failedBills.size) throw new Error(`OPEN_CARRY_REFRESH_ALL_FAILED:${failedBills.size}`);

    recordCarryRefreshSuccess(db, { date: clock.date, reason, openCount: openAfter, refreshed: successfulRows.length, failed: failedBills.size, closed });
    return { ok: true, refreshId, reason, openBefore: open.length, openAfter, refreshed: successfulRows.length, failed: failedBills.size, closed };
  } catch (error) {
    lastFailureAt = Date.now();
    try {
      setMeta(db, 'carry_refresh_last_error_at', nowIso());
      setMeta(db, 'carry_refresh_last_error', String(error?.message || error).slice(0, 1000));
    } catch {}
    throw error;
  } finally { inFlight = false; }
}

async function schedulerTick() {
  if (inFlight) return;
  if (startupNotBefore && Date.now() < startupNotBefore) return;
  if (lastFailureAt && Date.now() - lastFailureAt < FAILURE_RETRY_MS) return;
  const db = getDb();
  const reason = dueCarryRefreshReason(db, new Date());
  if (!reason || hasActiveBusinessProcessing(db)) return;
  try {
    const result = await refreshOpenCarryNow({ reason, db });
    console.log('[CE-QC][CARRY_REFRESH]', JSON.stringify(result));
    lastFailureAt = 0;
  } catch (error) {
    console.error('[CE-QC][CARRY_REFRESH_FAILED]', error?.message || error);
  }
}

export function startCarryoverRefreshScheduler() {
  if (schedulerTimer) return { started: false, reason: 'ALREADY_STARTED' };
  if (process.env.CI || process.env.NODE_ENV === 'test' || String(process.env.CE_QC_DISABLE_CARRY_REFRESH || '') === '1') {
    return { started: false, reason: 'DISABLED_BY_ENV' };
  }
  startupNotBefore = Date.now() + CARRY_REFRESH_STARTUP_DELAY_MS;
  schedulerTimer = setInterval(() => { schedulerTick().catch(error => console.error('[CE-QC][CARRY_REFRESH_TICK]', error?.message || error)); }, CARRY_REFRESH_POLL_MS);
  schedulerTimer.unref?.();
  // Startup catch-up is intentionally deferred so first paint, navigation and the
  // user's initial import are not competing with historical OPEN parcel refresh.
  startupTimer = setTimeout(() => { schedulerTick().catch(error => console.error('[CE-QC][CARRY_REFRESH_STARTUP]', error?.message || error)); }, CARRY_REFRESH_STARTUP_DELAY_MS);
  startupTimer.unref?.();
  console.log(`[CE-QC][CARRY_REFRESH] interactive startup protected for ${CARRY_REFRESH_STARTUP_DELAY_MS}ms; then Cambodia 00:05 + every 2 hours; OPEN carry only.`);
  return { started: true, pollMs: CARRY_REFRESH_POLL_MS, refreshMs: CARRY_REFRESH_INTERVAL_MS, startupDelayMs: CARRY_REFRESH_STARTUP_DELAY_MS, timezone: CARRY_REFRESH_TIMEZONE };
}

export function schedulerStateForTests() { return { started: Boolean(schedulerTimer), inFlight, startupNotBefore, startupDelayMs: CARRY_REFRESH_STARTUP_DELAY_MS, ccslTypes: [...CCSL_TYPES], shopeeTypes: [...SHOPEE_TYPES] }; }
export function stopCarryoverRefreshSchedulerForTests() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (startupTimer) clearTimeout(startupTimer);
  schedulerTimer = null;
  startupTimer = null;
  startupNotBefore = 0;
  inFlight = false;
  lastFailureAt = 0;
}
