import express from 'express';
import { getDb, nowIso } from './db.js';

const PATCH_ID = '2026-08-16-v140-shopee-per-waybill-checkpoint-recovery-v2';
const RUN_ROUTES = new Set(['/api/shopee/run/start', '/api/shopee/run/resume']);
const WRAPPED = Symbol.for('ce-qc.v140-shopee-checkpoint-recovery');

function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}

function bill(value) {
  return String(value || '').trim().toUpperCase();
}

function rowBill(row = {}) {
  return bill(row.shipmentCode || row.运单号 || row.waybill);
}

function normalizeStatusRow(row = {}, reportDate = '') {
  const shipmentCode = rowBill(row);
  if (!shipmentCode) return null;
  const status = String(row.status || '').toLowerCase() === 'success' ? 'success' : 'failed';
  return {
    businessType: 'SHOPEE',
    reportDate,
    shipmentCode,
    status,
    resultCount: Number(row.resultCount || 0),
    errorMessage: status === 'success' ? '' : String(row.errorMessage || ''),
    checkedAt: row.checkedAt || nowIso()
  };
}

function mergeStatus(map, row, reportDate = '') {
  const normalized = normalizeStatusRow(row, reportDate);
  if (!normalized) return;
  const current = map.get(normalized.shipmentCode);
  // A proven success is authoritative. A later recovery pass must never demote
  // a successfully queried ticket back to failed merely because an old parent
  // batch audit row also exists.
  if (current?.status === 'success' && normalized.status !== 'success') return;
  map.set(normalized.shipmentCode, { ...(current || {}), ...normalized });
}

function batchStatusKey(apiName = '') {
  const name = String(apiName || '').toLowerCase();
  if (name.includes('confirm-query')) return 'scanQueryStatus';
  if (name.includes('shipment-event') || name.includes('track-query')) return 'eventQueryStatus';
  if (name.includes('exception-item') || name.includes('exception-query')) return 'exceptionQueryStatus';
  return '';
}

function recoverFromBatchAudit(db, reportDate, runId, maps) {
  const rows = runId
    ? db.prepare(`SELECT apiName,shipmentCodesJson,status,resultCount,errorMessage,updatedAt
        FROM business_api_batches
        WHERE businessType='SHOPEE' AND reportDate=? AND runId=?
        ORDER BY updatedAt`).all(reportDate, runId)
    : [];
  for (const row of rows) {
    const key = batchStatusKey(row.apiName);
    if (!key || !maps[key]) continue;
    const status = String(row.status || '').toLowerCase();
    if (!['success', 'failed'].includes(status)) continue;
    const codes = safeJson(row.shipmentCodesJson, []);
    for (const shipmentCode of Array.isArray(codes) ? codes : []) {
      // confirm-query can return HTTP 200 with only a subset of requested rows.
      // Therefore a successful parent batch is NOT per-waybill success evidence.
      // Scan success is recovered only from business_scan_results below. A failed
      // batch is still useful retry evidence until a real normalized row overrides it.
      if (key === 'scanQueryStatus' && status === 'success') continue;
      mergeStatus(maps[key], {
        shipmentCode,
        status,
        resultCount: Number(row.resultCount || 0),
        errorMessage: row.errorMessage || '',
        checkedAt: row.updatedAt || nowIso()
      }, reportDate);
    }
  }
}

function recoverNormalizedEvidence(db, reportDate, maps) {
  // A normalized confirm row only exists when CE returned a real row for that
  // waybill, therefore it is the ONLY recovered scan-success authority.
  for (const row of db.prepare(`SELECT shipmentCode FROM business_scan_results
      WHERE businessType='SHOPEE' AND reportDate=?`).all(reportDate)) {
    mergeStatus(maps.scanQueryStatus, { shipmentCode: row.shipmentCode, status: 'success' }, reportDate);
  }

  // Event/exception APIs are read-only lookups where a successful request may
  // legitimately return zero rows. Their successful batch audit therefore proves
  // the requested waybills were queried; normalized rows add the non-empty case.
  for (const row of db.prepare(`SELECT DISTINCT shipmentCode FROM business_track_events
      WHERE businessType='SHOPEE' AND reportDate=?`).all(reportDate)) {
    mergeStatus(maps.eventQueryStatus, { shipmentCode: row.shipmentCode, status: 'success' }, reportDate);
  }
  for (const row of db.prepare(`SELECT DISTINCT shipmentCode FROM business_exception_items
      WHERE businessType='SHOPEE' AND reportDate=?`).all(reportDate)) {
    mergeStatus(maps.exceptionQueryStatus, { shipmentCode: row.shipmentCode, status: 'success' }, reportDate);
  }
}

function repairCompactShopeeState() {
  const db = getDb();
  const stored = db.prepare("SELECT valueJson FROM business_states WHERE businessType='SHOPEE' LIMIT 1").get();
  if (!stored?.valueJson) return { repaired: false, reason: 'NO_SHOPEE_STATE' };
  const state = safeJson(stored.valueJson, {});
  const reportDate = String(state.reportDate || db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='SHOPEE' ORDER BY reportDate DESC LIMIT 1").get()?.reportDate || '').trim();
  if (!reportDate) return { repaired: false, reason: 'NO_REPORT_DATE' };
  const lock = db.prepare("SELECT runId,status FROM business_run_locks WHERE businessType='SHOPEE' AND reportDate=? LIMIT 1").get(reportDate) || null;
  const runId = String(lock?.runId || state.currentRun?.runId || state.lastRunSummary?.runId || '').trim();

  const keys = ['scanQueryStatus', 'eventQueryStatus', 'exceptionQueryStatus'];
  const maps = Object.fromEntries(keys.map(key => [key, new Map()]));
  for (const key of keys) {
    for (const row of Array.isArray(state[key]) ? state[key] : []) mergeStatus(maps[key], row, reportDate);
  }

  // Preserve explicit failed scan tickets when the compact payload still has the
  // retry bill list, then allow normalized success evidence to override them.
  for (const shipmentCode of Array.isArray(state.scanRetryBills) ? state.scanRetryBills : []) {
    mergeStatus(maps.scanQueryStatus, { shipmentCode, status: 'failed', errorMessage: 'SCAN_RETRY_REQUIRED' }, reportDate);
  }

  recoverFromBatchAudit(db, reportDate, runId, maps);
  recoverNormalizedEvidence(db, reportDate, maps);

  const recovered = Object.fromEntries(keys.map(key => [key, [...maps[key].values()].sort((a, b) => a.shipmentCode.localeCompare(b.shipmentCode))]));
  const before = Object.fromEntries(keys.map(key => [key, Array.isArray(state[key]) ? state[key].length : 0]));
  Object.assign(state, recovered, {
    reportDate,
    v140CheckpointRecovery: {
      patchId: PATCH_ID,
      recoveredAt: nowIso(),
      runId,
      counts: Object.fromEntries(keys.map(key => [key, recovered[key].length]))
    }
  });
  db.prepare("UPDATE business_states SET valueJson=?,updatedAt=? WHERE businessType='SHOPEE'")
    .run(JSON.stringify(state), nowIso());
  return {
    repaired: true,
    reportDate,
    runId,
    before,
    after: Object.fromEntries(keys.map(key => [key, recovered[key].length]))
  };
}

function recoveryMiddleware(req, res, next) {
  try {
    req.ceQcV140CheckpointRecovery = repairCompactShopeeState();
    next();
  } catch (error) {
    console.error('[CE-QC][V140_CHECKPOINT_RECOVERY]', error?.stack || error);
    // Fail closed for a resume: if checkpoint recovery itself is corrupt, allowing
    // the old handler to run could re-query the entire day again.
    res.status(409).json({
      ok: false,
      code: 'SHOPEE_CHECKPOINT_RECOVERY_FAILED',
      error: `SHOPEE断点状态恢复失败，已阻止重复全量查询：${error?.message || String(error)}`
    });
  }
}

const previousPost = express.application.post;
if (typeof previousPost === 'function' && !previousPost[WRAPPED]) {
  const wrappedPost = function v140ShopeeCheckpointPost(pathValue, ...handlers) {
    const route = String(pathValue || '');
    if (!RUN_ROUTES.has(route) || handlers.length === 0) return previousPost.call(this, pathValue, ...handlers);
    // V139 is imported after V140 and injects its carry-isolation middleware before
    // this wrapper is invoked. Insert recovery immediately before the final run
    // handler so carry isolation can save first, then V140 restores the checkpoint.
    const finalHandler = handlers.pop();
    return previousPost.call(this, pathValue, ...handlers, recoveryMiddleware, finalHandler);
  };
  Object.defineProperty(wrappedPost, WRAPPED, { value: true });
  express.application.post = wrappedPost;
}

export { repairCompactShopeeState as repairV140ShopeeCheckpoint };
export const V140_SHOPEE_CHECKPOINT_RECOVERY_ID = PATCH_ID;
