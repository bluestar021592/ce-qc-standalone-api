import express from 'express';
import { loadState } from './storage.js';
import { loadBusinessState, SHOPEE } from './businessStore.js';

function countRows(value) {
  return Array.isArray(value) ? value.length : Number(value || 0);
}

function summarize(state = {}, businessType = 'CCSL') {
  const processing = state.processing || {};
  const scanDone = countRows(state.scanResults);
  const scanTotal = countRows(state.scanPool);
  const trackDone = countRows(state.trackResults);
  const trackTotal = countRows(state.needTrackBills);
  const phase = String(processing.phase || '').trim() || (processing.running ? 'RUNNING' : 'IDLE');
  const phaseIsScan = /scan|order|\u626b\u63cf/i.test(phase);
  const done = phaseIsScan ? scanDone : trackDone;
  const total = phaseIsScan ? scanTotal : trackTotal;
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
    scanTotal,
    trackDone,
    trackTotal,
    done,
    total,
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
express.application.listen = function v33RunProgressListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v33/run-progress', progressHandler);
  }
  return previousListen.apply(this, args);
};

export { summarize as summarizeRunProgressV33 };
