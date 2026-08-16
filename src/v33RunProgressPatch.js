import express from 'express';
import { loadState } from './storage.js';
import { loadBusinessState, SHOPEE } from './businessStore.js';
import { getDb } from './db.js';

function countRows(value) {
  return Array.isArray(value) ? value.length : Number(value || 0);
}

function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}

function uniqueBills(values = []) {
  const rows = [];
  const seen = new Set();
  for (const value of values || []) {
    const code = typeof value === 'string' ? String(value).trim().toUpperCase() : billOf(value);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    rows.push(code);
  }
  return rows;
}

function isRetryRow(row = {}, stage = 'scan') {
  const state = String(row.currentState || row.scanNormalizedState || '').toUpperCase();
  const status = String(row.查询状态 || row.apiStatus || row.API状态 || '').toLowerCase();
  const category = String(row.primaryCategory || row.主分类 || row.异常分类 || '');
  if (stage === 'scan') {
    return state === 'SCAN_PENDING_RETRY'
      || /refresh_failed|scan_retry|pending_retry|待重试|失败/.test(status)
      || /订单扫描待重试/.test(category);
  }
  return /refresh_failed|track_retry|pending_retry|待重试|失败/.test(status)
    || /轨迹.*待重试|接口待重试/.test(category);
}

function successfulCount(rows, stage) {
  if (!Array.isArray(rows)) return Number(rows || 0);
  const byBill = new Map();
  for (const row of rows) {
    const code = billOf(row);
    if (code) byBill.set(code, row);
  }
  return [...byBill.values()].reduce((sum, row) => sum + (isRetryRow(row, stage) ? 0 : 1), 0);
}

function retryCount(rows, stage) {
  if (!Array.isArray(rows)) return 0;
  const byBill = new Map();
  for (const row of rows) {
    const code = billOf(row);
    if (code) byBill.set(code, row);
  }
  return [...byBill.values()].reduce((sum, row) => sum + (isRetryRow(row, stage) ? 1 : 0), 0);
}

function parseJson(value, fallback = []) {
  try { return JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}

function statusEvidence(reportDate = '', runId = '', apiPattern = '', normalizedTable = '', options = {}) {
  const success = new Set();
  const failed = new Set();
  if (!reportDate) return { success, failed };
  const db = getDb();
  const allowBatchSuccess = options.allowBatchSuccess !== false;
  try {
    const rows = runId
      ? db.prepare(`SELECT shipmentCodesJson,status FROM business_api_batches
          WHERE businessType='SHOPEE' AND reportDate=? AND runId=? AND LOWER(apiName) LIKE ?
          ORDER BY updatedAt`).all(reportDate, runId, apiPattern)
      : [];
    for (const row of rows) {
      const codes = parseJson(row.shipmentCodesJson, []);
      const status = String(row.status || '').toLowerCase();
      for (const codeValue of Array.isArray(codes) ? codes : []) {
        const code = String(codeValue || '').trim().toUpperCase();
        if (!code) continue;
        // confirm-query may resolve HTTP 200 with a partial body. Its batch-level
        // success cannot prove every requested waybill returned a scan row.
        if (status === 'success' && allowBatchSuccess) { success.add(code); failed.delete(code); }
        else if (status === 'failed' && !success.has(code)) failed.add(code);
      }
    }
  } catch {}
  if (normalizedTable) {
    try {
      for (const row of db.prepare(`SELECT DISTINCT shipmentCode FROM ${normalizedTable} WHERE businessType='SHOPEE' AND reportDate=?`).all(reportDate)) {
        const code = String(row.shipmentCode || '').trim().toUpperCase();
        if (code) { success.add(code); failed.delete(code); }
      }
    } catch {}
  }
  return { success, failed };
}

function mergeStateStatuses(evidence, rows = []) {
  for (const row of rows || []) {
    const code = billOf(row);
    if (!code) continue;
    const status = String(row.status || '').toLowerCase();
    if (status === 'success' || status === 'skipped_pod') { evidence.success.add(code); evidence.failed.delete(code); }
    else if (status === 'failed' && !evidence.success.has(code)) evidence.failed.add(code);
  }
  return evidence;
}

function boundedCounts(targetBills, evidence) {
  const targets = new Set(uniqueBills(targetBills));
  const success = [...evidence.success].filter(code => targets.has(code)).length;
  const failed = [...evidence.failed].filter(code => targets.has(code) && !evidence.success.has(code)).length;
  const total = targets.size;
  return {
    done: Math.min(total, success),
    retry: Math.min(Math.max(0, total - Math.min(total, success)), failed),
    observed: Math.min(total, success + failed),
    total
  };
}

function summarizeShopee(state = {}) {
  const processing = state.processing || {};
  const reportDate = String(state.reportDate || '').trim();
  const runId = processing.runId || state.currentRun?.runId || state.lastRunSummary?.runId || '';
  const phase = String(processing.phase || '').trim() || (processing.running ? 'RUNNING' : 'IDLE');

  const scanTargets = uniqueBills(state.scanPool || state.pnhBills || []);
  const scanEvidence = mergeStateStatuses(
    statusEvidence(reportDate, runId, '%confirm-query%', 'business_scan_results', { allowBatchSuccess: false }),
    state.scanQueryStatus || []
  );
  // Explicit scan retry rows are failure evidence only when no success exists.
  for (const code of uniqueBills(state.scanRetryBills || [])) if (!scanEvidence.success.has(code)) scanEvidence.failed.add(code);
  const scan = boundedCounts(scanTargets, scanEvidence);

  const trackTargets = uniqueBills(state.needTrackBills || []);
  const eventEvidence = mergeStateStatuses(
    statusEvidence(reportDate, runId, '%shipment-event%', 'business_track_events'),
    state.eventQueryStatus || []
  );
  const exceptionEvidence = mergeStateStatuses(
    statusEvidence(reportDate, runId, '%exception-item%', 'business_exception_items'),
    state.exceptionQueryStatus || []
  );
  const event = boundedCounts(trackTargets, eventEvidence);
  const exception = boundedCounts(trackTargets, exceptionEvidence);

  let active = null;
  if (/shipment-event|track-query/i.test(phase)) active = event;
  else if (/exception-item|exception-query/i.test(phase)) active = exception;
  else if (/scan|order|扫描/i.test(phase)) active = scan;
  else {
    const finalByBill = new Map();
    for (const row of state.trackResults || []) {
      const code = billOf(row);
      if (code) finalByBill.set(code, row);
    }
    const finalDone = [...finalByBill.values()].filter(row => !isRetryRow(row, 'track')).map(billOf);
    const finalRetry = [...finalByBill.values()].filter(row => isRetryRow(row, 'track')).map(billOf);
    active = boundedCounts(trackTargets, { success: new Set(finalDone), failed: new Set(finalRetry) });
  }

  const logs = Array.isArray(state.logs) ? state.logs : [];
  return {
    ok: true,
    businessType: 'SHOPEE',
    reportDate,
    running: Boolean(processing.running),
    paused: Boolean(processing.paused),
    phase,
    batchIndex: Number(processing.batchIndex || 0),
    totalBatches: Number(processing.totalBatches || 0),
    scanDone: scan.done,
    scanRetry: scan.retry,
    scanObserved: scan.observed,
    scanTotal: scan.total,
    trackDone: active.done,
    trackRetry: active.retry,
    trackObserved: active.observed,
    trackTotal: active.total,
    done: active.done,
    total: active.total,
    retry: active.retry,
    runId,
    runStatus: state.lastRunSummary?.runStatus || state.currentRun?.status || (processing.running ? 'running' : ''),
    lastMessage: logs.length ? String(logs[logs.length - 1] || '') : '',
    progressRule: 'V140_UNIQUE_WAYBILL_ACTIVE_API_STATUS',
    generatedAt: new Date().toISOString()
  };
}

function summarize(state = {}, businessType = 'CCSL') {
  if (String(businessType || '').toUpperCase() === 'SHOPEE') return summarizeShopee(state);
  const processing = state.processing || {};
  const scanObserved = uniqueBills(state.scanResults).length;
  const scanRetry = retryCount(state.scanResults, 'scan');
  const scanDone = successfulCount(state.scanResults, 'scan');
  const scanTotal = uniqueBills(state.scanPool).length;
  const trackObserved = uniqueBills(state.trackResults).length;
  const trackRetry = retryCount(state.trackResults, 'track');
  const trackDone = successfulCount(state.trackResults, 'track');
  const trackTotal = uniqueBills(state.needTrackBills).length;
  const phase = String(processing.phase || '').trim() || (processing.running ? 'RUNNING' : 'IDLE');
  const phaseIsScan = /scan|order|扫描/i.test(phase);
  const done = phaseIsScan ? scanDone : trackDone;
  const total = phaseIsScan ? scanTotal : trackTotal;
  const retry = phaseIsScan ? scanRetry : trackRetry;
  const logs = Array.isArray(state.logs) ? state.logs : [];
  return {
    ok: true,
    businessType,
    reportDate: state.reportDate || '',
    running: Boolean(processing.running),
    paused: Boolean(processing.paused),
    phase,
    batchIndex: Number(processing.batchIndex || 0),
    totalBatches: Number(processing.totalBatches || 0),
    scanDone,
    scanRetry,
    scanObserved,
    scanTotal,
    trackDone,
    trackRetry,
    trackObserved,
    trackTotal,
    done,
    total,
    retry,
    runId: processing.runId || state.currentRun?.runId || state.lastRunSummary?.runId || '',
    runStatus: state.lastRunSummary?.runStatus || state.currentRun?.status || (processing.running ? 'running' : ''),
    lastMessage: logs.length ? String(logs[logs.length - 1] || '') : '',
    generatedAt: new Date().toISOString()
  };
}

async function progressHandler(req, res) {
  const type = String(req.query.businessType || 'CCSL').trim().toUpperCase();
  const state = type === 'SHOPEE' ? loadBusinessState(SHOPEE) : await loadState();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json(summarize(state || {}, type === 'SHOPEE' ? 'SHOPEE' : 'CCSL'));
}

let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v140RunProgressListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v33/run-progress', progressHandler);
  }
  return previousListen.apply(this, args);
};

export { summarize as summarizeRunProgressV33 };
