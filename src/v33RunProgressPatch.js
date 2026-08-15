import express from 'express';
import { loadState } from './storage.js';
import { loadBusinessState, SHOPEE } from './businessStore.js';

function countRows(value) {
  return Array.isArray(value) ? value.length : Number(value || 0);
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
  return rows.reduce((sum, row) => sum + (isRetryRow(row, stage) ? 0 : 1), 0);
}

function retryCount(rows, stage) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, row) => sum + (isRetryRow(row, stage) ? 1 : 0), 0);
}

function summarize(state = {}, businessType = 'CCSL') {
  const processing = state.processing || {};
  const scanObserved = countRows(state.scanResults);
  const scanRetry = retryCount(state.scanResults, 'scan');
  const scanDone = successfulCount(state.scanResults, 'scan');
  const scanTotal = countRows(state.scanPool);
  const trackObserved = countRows(state.trackResults);
  const trackRetry = retryCount(state.trackResults, 'track');
  const trackDone = successfulCount(state.trackResults, 'track');
  const trackTotal = countRows(state.needTrackBills);
  const phase = String(processing.phase || '').trim() || (processing.running ? 'RUNNING' : 'IDLE');
  const phaseIsScan = /scan|order|\u626b\u63cf/i.test(phase);
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
express.application.listen = function v138RunProgressListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v33/run-progress', progressHandler);
  }
  return previousListen.apply(this, args);
};

export { summarize as summarizeRunProgressV33 };
