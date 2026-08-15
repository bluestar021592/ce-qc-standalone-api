import express from 'express';
import { loadState } from './storage.js';
import { loadBusinessState, SHOPEE } from './businessStore.js';

function countRows(value) {
  return Array.isArray(value) ? value.length : Number(value || 0);
}
function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}
function countSuccessfulStatuses(value = []) {
  const bills = new Set();
  for (const row of Array.isArray(value) ? value : []) {
    const status = String(row?.status || '').toLowerCase();
    if (!['success','skipped_pod','skipped_terminal'].includes(status)) continue;
    const bill = billOf(row);
    if (bill) bills.add(bill);
  }
  return bills.size;
}
function clampDone(done, total) {
  const safeTotal = Math.max(0, Number(total || 0));
  return Math.max(0, Math.min(safeTotal, Number(done || 0)));
}

function summarize(state = {}, businessType = 'CCSL') {
  const processing = state.processing || {};
  const phase = String(processing.phase || '').trim() || (processing.running ? 'RUNNING' : 'IDLE');
  const scanTotal = countRows(state.scanPool);
  const scanDone = clampDone(countSuccessfulStatuses(state.scanQueryStatus), scanTotal);
  const trackTotal = countRows(state.needTrackBills);
  const eventDone = clampDone(countSuccessfulStatuses(state.eventQueryStatus || state.trackQueryStatus), trackTotal);
  const exceptionDone = clampDone(countSuccessfulStatuses(state.exceptionQueryStatus), trackTotal);
  const finalDone = clampDone(new Set((state.finalRows || []).map(billOf).filter(Boolean)).size, Math.max(scanTotal, countRows(state.pnhBills)));

  let phaseLabel = phase;
  let done = finalDone;
  let total = Math.max(scanTotal, countRows(state.pnhBills));
  if (/扫描|scan|order/i.test(phase)) {
    phaseLabel = '订单扫描'; done = scanDone; total = scanTotal;
  } else if (/exception-item|取消|异常查询/i.test(phase)) {
    phaseLabel = '订单取消/异常查询'; done = exceptionDone; total = trackTotal;
  } else if (/轨迹|track|shipment-event/i.test(phase)) {
    phaseLabel = '轨迹查询'; done = eventDone; total = trackTotal;
  }
  done = clampDone(done, total);
  const logs = Array.isArray(state.logs) ? state.logs : [];
  const type = String(businessType || '').toUpperCase() === 'SHOPEE' ? 'SHOPEE' : 'CCSL';
  return {
    ok: true,
    businessType: type,
    displayBusinessType: type === 'SHOPEE' ? 'SHOPEE CN + SHOPEE VN' : 'CE / CEAF / TBKH / ALI1688',
    reportDate: state.reportDate || '',
    running: Boolean(processing.running),
    paused: Boolean(processing.paused),
    phase,
    phaseLabel,
    batchIndex: Number(processing.batchIndex || 0),
    totalBatches: Number(processing.totalBatches || 0),
    scanDone,
    scanTotal,
    trackDone: eventDone,
    trackTotal,
    exceptionDone,
    exceptionTotal: trackTotal,
    finalDone,
    done,
    total,
    foregroundToday: countRows(state.pnhBills),
    historicalCarryStored: countRows(state.carryBills || state.nextCarryBills),
    runId: processing.runId || state.currentRun?.runId || state.lastRunSummary?.runId || '',
    runStatus: state.lastRunSummary?.runStatus || state.currentRun?.status || (processing.running ? 'running' : ''),
    lastMessage: logs.length ? String(logs[logs.length - 1] || '') : '',
    progressPolicy: 'PER_WAYBILL_STATUS_CLAMPED',
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
express.application.listen = function v136RunProgressListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v33/run-progress', progressHandler);
  }
  return previousListen.apply(this, args);
};

export { summarize as summarizeRunProgressV33 };