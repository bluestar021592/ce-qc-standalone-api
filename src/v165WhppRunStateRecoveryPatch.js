import express from 'express';
import { getDb } from './db.js';
import { loadWhppState, saveWhppState } from './whppStore.js';

const PATCH_ID = '2026-08-17-v165-whpp-run-state-recovery-v2';
const RUN_ROUTES = new Set(['/api/whpp/run/start', '/api/whpp/run/resume']);
const WRAPPED = Symbol.for('ce-qc.v165-whpp-run-state-recovery');
const INTERRUPTED_RUN_REASON = 'PROCESS_RESTART_INTERRUPTED';

function recoverInterruptedRunLocks() {
  const db = getDb();
  const now = new Date().toISOString();
  let ccsl = 0;
  let business = 0;
  try {
    const result = db.prepare(`UPDATE run_locks
      SET status='failed',
          errorMessage=CASE
            WHEN TRIM(COALESCE(errorMessage,''))='' THEN ?
            ELSE errorMessage || ' | ' || ?
          END,
          updatedAt=?
      WHERE status='running'`).run(INTERRUPTED_RUN_REASON, INTERRUPTED_RUN_REASON, now);
    ccsl = Number(result?.changes || 0);
  } catch (error) {
    console.warn('[CE-QC][V165] interrupted CCSL run-lock recovery skipped:', error?.message || error);
  }
  try {
    const result = db.prepare(`UPDATE business_run_locks
      SET status='failed',
          errorMessage=CASE
            WHEN TRIM(COALESCE(errorMessage,''))='' THEN ?
            ELSE errorMessage || ' | ' || ?
          END,
          updatedAt=?
      WHERE status='running'`).run(INTERRUPTED_RUN_REASON, INTERRUPTED_RUN_REASON, now);
    business = Number(result?.changes || 0);
  } catch (error) {
    console.warn('[CE-QC][V165] interrupted business run-lock recovery skipped:', error?.message || error);
  }
  if (ccsl || business) {
    console.log(`[CE-QC][V165] recovered stale running locks after process restart: CCSL=${ccsl}, business=${business}`);
  }
  return { ccsl, business, recoveredAt: now };
}

// This module is loaded before server.js. At this moment no new foreground run can
// exist in the current process yet. Therefore any persisted status='running' row
// belongs to a previous process and must not block V183 history refresh forever.
// Paused / paused_write locks are deliberately preserved because the user may
// intentionally resume them later.
export const V165_STARTUP_RUN_LOCK_RECOVERY = recoverInterruptedRunLocks();

function dateOnly(value = '') {
  const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function codeOf(value = {}) {
  return String(typeof value === 'string' ? value : (value.shipmentCode || value.运单号 || value.waybill || '')).trim().toUpperCase();
}
function unique(values = []) { return [...new Set((values || []).map(codeOf).filter(Boolean))]; }
function sameSet(left = [], right = []) {
  const a = unique(left), b = unique(right);
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(code => set.has(code));
}

function normalizedDaily(reportDate = '') {
  const db = getDb();
  const requested = dateOnly(reportDate);
  const daily = requested
    ? db.prepare("SELECT * FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(requested)
    : db.prepare("SELECT * FROM business_daily_reports WHERE businessType='WHPP' ORDER BY reportDate DESC LIMIT 1").get();
  if (!daily) return null;
  const rows = db.prepare(`SELECT shipmentCode,rowNumber,source_row_number,rowJson FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(daily.reportDate).map(row => ({
      ...safeJson(row.rowJson, {}),
      shipmentCode: String(row.shipmentCode || '').trim().toUpperCase(),
      运单号: String(row.shipmentCode || '').trim().toUpperCase(),
      businessType: 'WHPP',
      reportDate: daily.reportDate,
      rowNumber: Number(row.rowNumber || row.source_row_number || 0),
      source_row_number: Number(row.source_row_number || row.rowNumber || 0)
    }));
  const bills = unique(rows);
  return { daily, rows, bills, summary: safeJson(daily.summaryJson, {}) };
}

function recoverWhppState(reportDate = '') {
  const normalized = normalizedDaily(reportDate);
  if (!normalized) return { recovered: false, reason: 'NO_NORMALIZED_DAILY' };
  const expected = Number(normalized.daily.totalCount || 0);
  if (normalized.bills.length !== expected) {
    const error = new Error(`WHPP标准日报成员对账失败：日报${expected}票，成员表${normalized.bills.length}票。`);
    error.code = 'WHPP_NORMALIZED_DAILY_MISMATCH';
    throw error;
  }
  const current = loadWhppState();
  const sameDate = dateOnly(current.reportDate) === dateOnly(normalized.daily.reportDate);
  const sameMembers = sameSet(current.pnhBills || [], normalized.bills);
  if (sameDate && current.dailyReportReady && sameMembers) {
    return { recovered: false, reason: 'STATE_ALREADY_CURRENT', state: current, expected };
  }

  const db = getDb();
  const podLocks = db.prepare(`SELECT c.shipmentCode FROM shipment_current_state c
    INNER JOIN business_daily_parse_rows d ON d.shipmentCode=c.shipmentCode AND d.businessType='WHPP' AND d.reportDate=?
    WHERE c.businessType='WHPP' AND UPPER(COALESCE(c.state,''))='POD' ORDER BY c.shipmentCode`).all(normalized.daily.reportDate).map(row => row.shipmentCode);
  const now = new Date().toISOString();
  const state = saveWhppState({
    ...current,
    businessType: 'WHPP',
    reportDate: normalized.daily.reportDate,
    sourceName: normalized.daily.sourceFile || current.sourceName || '',
    batchId: normalized.summary.batchId || current.batchId || '',
    sourceSnapshotId: normalized.summary.snapshotId || current.sourceSnapshotId || '',
    dailyReportReady: true,
    pnhBills: normalized.bills,
    dailyParseRows: normalized.rows,
    // Current-day automatic processing must never reattach historical carry.
    // V141 also enforces this after this middleware.
    carryBills: [],
    nextCarryBills: [],
    podLocks: unique(podLocks),
    scanPool: [],
    scanResults: [],
    scanQueryStatus: [],
    needTrackBills: [],
    trackEvents: [],
    eventQueryStatus: [],
    exceptionItems: [],
    exceptionQueryStatus: [],
    trackResults: [],
    finalRows: [],
    processing: { running: false, paused: false, phase: '待处理', batchIndex: 0, totalBatches: 0 },
    currentRun: null,
    lastRunSummary: null,
    lastRun: null,
    v165RecoveredFromNormalizedDaily: { patchId: PATCH_ID, reportDate: normalized.daily.reportDate, expected, recoveredAt: now }
  });
  return { recovered: true, reason: 'NORMALIZED_SQLITE_REHYDRATE', state, expected };
}

function recoverMiddleware(req, res, next) {
  try {
    const requested = dateOnly(req.body?.reportDate || req.query?.reportDate || '');
    const result = recoverWhppState(requested);
    req.ceQcV165WhppRecovery = result;
    next();
  } catch (error) {
    res.status(409).json({ ok: false, code: error.code || 'WHPP_RUN_STATE_RECOVERY_FAILED', error: error.message || String(error), patchId: PATCH_ID });
  }
}

const previousPost = express.application.post;
if (typeof previousPost === 'function' && !previousPost[WRAPPED]) {
  const wrappedPost = function v165WhppRunStateRecoveryPost(pathValue, ...handlers) {
    const route = String(pathValue || '');
    if (!RUN_ROUTES.has(route)) return previousPost.call(this, pathValue, ...handlers);
    return previousPost.call(this, pathValue, recoverMiddleware, ...handlers);
  };
  Object.defineProperty(wrappedPost, WRAPPED, { value: true });
  express.application.post = wrappedPost;
}

export { recoverWhppState as recoverV165WhppRunState };
export const V165_WHPP_RUN_STATE_RECOVERY_ID = PATCH_ID;
