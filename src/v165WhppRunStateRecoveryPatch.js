import express from 'express';
import { getDb } from './db.js';
import { loadWhppState, saveWhppState } from './whppStore.js';
import { ensureV351WhppNormalizedDaily } from './v351WhppUnifiedDashboardBridgePatch.js';
import './v134WhppRunSupervisorPatch.js';

const PATCH_ID = '2026-09-02-v414-whpp-run-state-restart-proof-v1';
const NORMALIZED_BRIDGE_REVISION = '2026-08-29-v358-whpp-requested-date-normalized-bridge-v1';
export const V414_WHPP_RESTART_PROOF_REVISION = '2026-09-02-v414-whpp-process-restart-proof-v1';
const RUN_ROUTES = new Set(['/api/whpp/run/start', '/api/whpp/run/resume']);
const WRAPPED = Symbol.for('ce-qc.v165-whpp-run-state-recovery');
const INTERRUPTED_RUN_REASON = 'PROCESS_RESTART_INTERRUPTED';

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
function runIdOf(state = {}) {
  return String(state?.processing?.runId || state?.lastRunSummary?.runId || state?.lastRun?.runId || '').trim();
}
function finalizedState(state = {}) {
  const status = String(state?.snapshotStatus || '').toUpperCase();
  return ['COMPLETED', 'COMPLETED_WITH_RETRY'].includes(status) && Boolean(String(state?.snapshotId || '').trim());
}

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

function recoverInterruptedWhppState() {
  try {
    const state = loadWhppState();
    const reportDate = dateOnly(state?.reportDate);
    const processing = state?.processing || {};
    const runId = runIdOf(state);
    if (!reportDate || processing.running !== true || !runId || finalizedState(state)) {
      return {
        recovered: false,
        reportDate,
        runId,
        reason: !reportDate ? 'REPORT_DATE_MISSING' : finalizedState(state) ? 'WHPP_ALREADY_FINALIZED' : processing.running !== true ? 'NO_PERSISTED_RUNNING_WHPP' : 'RUN_ID_MISSING',
        revision: V414_WHPP_RESTART_PROOF_REVISION
      };
    }
    const detectedAt = new Date().toISOString();
    const restartRecovery = {
      reason: INTERRUPTED_RUN_REASON,
      reportDate,
      runId,
      detectedAt,
      source: 'V165_STARTUP_PERSISTED_RUNNING_STATE',
      revision: V414_WHPP_RESTART_PROOF_REVISION
    };
    saveWhppState({
      ...state,
      processing: {
        ...processing,
        running: false,
        paused: false,
        phase: 'WHPP等待断点恢复',
        error: INTERRUPTED_RUN_REASON,
        runId,
        lastCheckpointAt: processing.lastCheckpointAt || detectedAt
      },
      restartRecovery
    });
    console.log('[CE-QC][V414_WHPP_RESTART_PROOF]', JSON.stringify(restartRecovery));
    return { recovered: true, ...restartRecovery };
  } catch (error) {
    console.warn('[CE-QC][V414_WHPP_RESTART_PROOF] startup recovery skipped:', error?.message || error);
    return { recovered: false, reason: 'WHPP_RESTART_PROOF_FAILED', error: error?.message || String(error), revision: V414_WHPP_RESTART_PROOF_REVISION };
  }
}

export function inspectV165WhppRestartInterruption(reportDate = '') {
  try {
    const state = loadWhppState();
    const requested = dateOnly(reportDate || state?.reportDate);
    const marker = state?.restartRecovery && typeof state.restartRecovery === 'object' ? state.restartRecovery : {};
    const markerDate = dateOnly(marker.reportDate);
    const markerRunId = String(marker.runId || '').trim();
    const stateRunId = runIdOf(state);
    const interrupted = Boolean(
      requested
      && dateOnly(state?.reportDate) === requested
      && markerDate === requested
      && String(marker.reason || '').toUpperCase() === INTERRUPTED_RUN_REASON
      && markerRunId
      && stateRunId === markerRunId
      && state?.processing?.running !== true
      && !finalizedState(state)
    );
    return {
      interrupted,
      reportDate: requested,
      runId: markerRunId,
      reason: interrupted ? INTERRUPTED_RUN_REASON : 'NO_EXACT_WHPP_RESTART_INTERRUPTION',
      detectedAt: String(marker.detectedAt || ''),
      source: String(marker.source || ''),
      marker: interrupted ? marker : null,
      revision: V414_WHPP_RESTART_PROOF_REVISION
    };
  } catch (error) {
    return { interrupted: false, reportDate: dateOnly(reportDate), runId: '', reason: 'WHPP_RESTART_PROOF_READ_FAILED', error: error?.message || String(error), revision: V414_WHPP_RESTART_PROOF_REVISION };
  }
}

// This module is loaded before server.js. At this moment no new foreground run can
// exist in the current process yet. Therefore any persisted status='running' row
// belongs to a previous process. Paused / paused_write locks are deliberately
// preserved. WHPP is different from CCSL/SHOPEE run-lock tables, so V414 also
// converts only a persisted WHPP processing.running=true + runId into a durable,
// exact PROCESS_RESTART_INTERRUPTED marker. A fresh pending import never qualifies.
export const V165_STARTUP_RUN_LOCK_RECOVERY = recoverInterruptedRunLocks();
export const V165_STARTUP_WHPP_RUN_STATE_RECOVERY = recoverInterruptedWhppState();

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

function ensureRequestedNormalizedDaily(reportDate = '') {
  const requested = dateOnly(reportDate);
  if (!requested) return { attempted: false, repaired: false, reason: 'REPORT_DATE_MISSING' };
  if (normalizedDaily(requested)) return { attempted: false, repaired: false, reason: 'STANDARD_DAILY_ALREADY_PRESENT', reportDate: requested };
  const bridge = ensureV351WhppNormalizedDaily(requested);
  if (bridge?.repaired) {
    console.log('[CE-QC][V358_WHPP_NORMALIZED_BRIDGE]', JSON.stringify({
      revision: NORMALIZED_BRIDGE_REVISION,
      reportDate: requested,
      repaired: true,
      reason: bridge.reason || '',
      total: Number(bridge.total || 0)
    }));
  } else {
    console.log('[CE-QC][V358_WHPP_NORMALIZED_BRIDGE]', JSON.stringify({
      revision: NORMALIZED_BRIDGE_REVISION,
      reportDate: requested,
      repaired: false,
      reason: bridge?.reason || 'NO_SAFE_MEMBERSHIP'
    }));
  }
  return { attempted: true, ...bridge };
}

function recoverWhppState(reportDate = '') {
  const requested = dateOnly(reportDate);
  let normalized = normalizedDaily(requested);
  let bridge = null;
  if (!normalized && requested) {
    bridge = ensureRequestedNormalizedDaily(requested);
    normalized = normalizedDaily(requested);
  }
  if (!normalized) return { recovered: false, reason: 'NO_NORMALIZED_DAILY', reportDate: requested, bridge };
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
    return { recovered: false, reason: 'STATE_ALREADY_CURRENT', state: current, expected, bridge };
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
    restartRecovery: null,
    v165RecoveredFromNormalizedDaily: { patchId: PATCH_ID, revision: NORMALIZED_BRIDGE_REVISION, reportDate: normalized.daily.reportDate, expected, recoveredAt: now }
  });
  return { recovered: true, reason: 'NORMALIZED_SQLITE_REHYDRATE', state, expected, bridge };
}

function recoverMiddleware(req, res, next) {
  try {
    const requested = dateOnly(req.body?.reportDate || req.query?.reportDate || '');
    const result = recoverWhppState(requested);
    if (requested && result.reason === 'NO_NORMALIZED_DAILY') {
      return res.status(409).json({
        ok: false,
        code: 'WHPP_REPORT_MISSING',
        error: `WHPP本土${requested}日报成员无法从当前有效日报安全恢复，已停止错误日期运行。`,
        patchId: PATCH_ID,
        normalizedBridgeRevision: NORMALIZED_BRIDGE_REVISION,
        recovery: result
      });
    }
    req.ceQcV165WhppRecovery = result;
    next();
  } catch (error) {
    res.status(409).json({ ok: false, code: error.code || 'WHPP_RUN_STATE_RECOVERY_FAILED', error: error.message || String(error), patchId: PATCH_ID, normalizedBridgeRevision: NORMALIZED_BRIDGE_REVISION });
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
export const V165_WHPP_NORMALIZED_BRIDGE_REVISION = NORMALIZED_BRIDGE_REVISION;
