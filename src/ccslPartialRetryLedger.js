import { getDb } from './db.js';
import { updateCarryoverResults } from './unifiedImportStore.js';

export const CCSL_PARTIAL_RETRY_LEDGER_ID = '2026-08-30-ccsl-partial-retry-ledger-v1';

function cleanBill(value = '') {
  return String(value || '').trim().toUpperCase();
}

function safeJson(value, fallback = {}) {
  try {
    return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback);
  } catch {
    return fallback;
  }
}

function isFailedStatus(row = {}) {
  return String(row.status || '').trim().toLowerCase() === 'failed';
}

function retryRow(base = {}, shipmentCode = '', reportDate = '', stage = '接口待重试') {
  const code = cleanBill(shipmentCode);
  return {
    ...base,
    shipmentCode: code,
    运单号: code,
    reportDate,
    currentState: 'API_PENDING_RETRY',
    scanNormalizedState: stage === '订单扫描' ? 'SCAN_PENDING_RETRY' : (base.scanNormalizedState || base.currentState || ''),
    是否POD: '否',
    POD状态: '未POD',
    API状态: '失败',
    查询状态: 'refresh_failed',
    primaryCategory: stage === '订单扫描' ? '订单扫描待重试' : '接口待重试',
    主分类: stage === '订单扫描' ? '订单扫描待重试' : '接口待重试',
    异常分类: stage === '订单扫描' ? '订单扫描待重试' : '接口待重试',
    carry状态: 'active',
    跨日状态: '未闭环',
    partialRetryStage: stage,
    partialRetryLedgerAt: new Date().toISOString()
  };
}

export function collectCcslPartialLedgerRows(state = {}) {
  const reportDate = String(state.reportDate || '').trim();
  const finalRows = Array.isArray(state.finalRows) ? state.finalRows : [];
  const scanResults = Array.isArray(state.scanResults) ? state.scanResults : [];
  const trackResults = Array.isArray(state.trackResults) ? state.trackResults : [];
  const scanStatus = Array.isArray(state.scanQueryStatus) ? state.scanQueryStatus : [];
  const trackStatus = Array.isArray(state.trackQueryStatus) ? state.trackQueryStatus : [];
  const baseByBill = new Map();

  for (const row of [...scanResults, ...trackResults, ...finalRows]) {
    const code = cleanBill(row?.shipmentCode || row?.运单号 || row?.waybill);
    if (code) baseByBill.set(code, row);
  }

  const rowsByBill = new Map();
  for (const row of finalRows) {
    const code = cleanBill(row?.shipmentCode || row?.运单号 || row?.waybill);
    if (code) rowsByBill.set(code, { ...row, shipmentCode: code, 运单号: code, reportDate: row.reportDate || reportDate });
  }

  const failedScan = [];
  for (const row of scanStatus.filter(isFailedStatus)) {
    const code = cleanBill(row.shipmentCode || row.运单号);
    if (!code) continue;
    failedScan.push(code);
    rowsByBill.set(code, retryRow(baseByBill.get(code) || {}, code, reportDate, '订单扫描'));
  }

  const failedTrack = [];
  for (const row of trackStatus.filter(isFailedStatus)) {
    const code = cleanBill(row.shipmentCode || row.运单号);
    if (!code) continue;
    failedTrack.push(code);
    rowsByBill.set(code, retryRow(baseByBill.get(code) || {}, code, reportDate, '轨迹查询'));
  }

  return {
    reportDate,
    rows: [...rowsByBill.values()],
    failedScanBills: [...new Set(failedScan)],
    failedTrackBills: [...new Set(failedTrack)]
  };
}

export function reconcileCcslPartialRetryLedger() {
  const db = getDb();
  const stateRow = db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get();
  const state = safeJson(stateRow?.valueJson, {});
  const reportDate = String(state.reportDate || '').trim();
  if (!reportDate) return { ok: true, skipped: true, reason: 'NO_CCSL_REPORT_DATE', rowsApplied: 0, failedScan: 0, failedTrack: 0 };

  const runStatus = String(state.lastRunSummary?.runStatus || state.lastRun?.runStatus || '').trim().toUpperCase();
  const phase = String(state.processing?.phase || '').trim();
  const collected = collectCcslPartialLedgerRows(state);
  const failedCount = collected.failedScanBills.length + collected.failedTrackBills.length;
  const partial = runStatus === 'API_RETRY_REQUIRED' || /接口待重试/.test(phase) || failedCount > 0;
  if (!partial) return { ok: true, skipped: true, reason: 'NO_PARTIAL_API_FAILURE', rowsApplied: 0, failedScan: 0, failedTrack: 0 };
  if (!collected.rows.length) return { ok: true, skipped: true, reason: 'NO_PARTIAL_ROWS', rowsApplied: 0, failedScan: collected.failedScanBills.length, failedTrack: collected.failedTrackBills.length };

  const runId = String(state.currentRun?.runId || state.lastRunSummary?.runId || state.lastRun?.runId || 'RECOVERY').trim();
  const snapshotId = `PARTIAL-${reportDate}-${runId}`;
  const summary = updateCarryoverResults({ snapshotId, reportDate, rows: collected.rows });
  return {
    ok: true,
    skipped: false,
    patchId: CCSL_PARTIAL_RETRY_LEDGER_ID,
    reportDate,
    snapshotId,
    rowsApplied: collected.rows.length,
    failedScan: collected.failedScanBills.length,
    failedTrack: collected.failedTrackBills.length,
    retryBills: [...new Set([...collected.failedScanBills, ...collected.failedTrackBills])],
    carryover: summary
  };
}
