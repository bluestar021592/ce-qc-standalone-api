import express from 'express';
import { getDb } from './db.js';

const VERSION = '2026-08-16-v149-tiny-run-progress-compat-v1';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}
function num(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
function phaseIsTrack(phase = '') { return /轨迹|track|shipment-event|exception-item/i.test(String(phase || '')); }

function ccslProgress(db) {
  const reportDate = db.prepare("SELECT value FROM app_meta WHERE key='last_processed_report_date'").get()?.value
    || db.prepare('SELECT reportDate FROM daily_reports ORDER BY updatedAt DESC,reportDate DESC LIMIT 1').get()?.reportDate
    || '';
  if (!reportDate) return emptyProgress('CCSL');
  const lock = db.prepare('SELECT * FROM run_locks WHERE reportDate=?').get(reportDate) || {};
  const checkpoint = lock.runId
    ? db.prepare('SELECT payloadJson,stage,batchIndex,totalBatches,status,errorMessage,updatedAt FROM run_checkpoints WHERE reportDate=? AND runId=? ORDER BY updatedAt DESC,rowid DESC LIMIT 1').get(reportDate, lock.runId)
    : null;
  const payload = parseJson(checkpoint?.payloadJson, {});
  const sourceTotal = num(db.prepare('SELECT pnhCount FROM daily_reports WHERE reportDate=?').get(reportDate)?.pnhCount);
  const phase = String(lock.currentStage || checkpoint?.stage || '').trim() || '待处理';
  const trackTotal = phaseIsTrack(phase)
    ? num(payload.trackTotal, db.prepare('SELECT COUNT(DISTINCT shipmentCode) count FROM scan_results WHERE reportDate=? AND COALESCE(isPod,0)=0').get(reportDate)?.count)
    : num(payload.trackTotal);
  return progressShape({ businessType:'CCSL', reportDate, lock, checkpoint, payload, sourceTotal, trackTotal });
}

function shopeeProgress(db) {
  const reportDate = db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='SHOPEE' ORDER BY updatedAt DESC,reportDate DESC LIMIT 1").get()?.reportDate || '';
  if (!reportDate) return emptyProgress('SHOPEE');
  const lock = db.prepare("SELECT * FROM business_run_locks WHERE businessType='SHOPEE' AND reportDate=?").get(reportDate) || {};
  const checkpoint = lock.runId
    ? db.prepare("SELECT payloadJson,stage,batchIndex,totalBatches,status,errorMessage,updatedAt FROM business_run_checkpoints WHERE businessType='SHOPEE' AND reportDate=? AND runId=? ORDER BY updatedAt DESC,id DESC LIMIT 1").get(reportDate, lock.runId)
    : null;
  const payload = parseJson(checkpoint?.payloadJson, {});
  const sourceTotal = num(db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='SHOPEE' AND reportDate=?").get(reportDate)?.totalCount);
  const phase = String(lock.currentStage || checkpoint?.stage || '').trim() || '待处理';
  const trackTotal = phaseIsTrack(phase)
    ? num(payload.trackTotal, db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_scan_results WHERE businessType='SHOPEE' AND reportDate=? AND COALESCE(isPod,0)=0").get(reportDate)?.count)
    : num(payload.trackTotal);
  return progressShape({ businessType:'SHOPEE', reportDate, lock, checkpoint, payload, sourceTotal, trackTotal });
}

function progressShape({ businessType, reportDate, lock = {}, checkpoint = null, payload = {}, sourceTotal = 0, trackTotal = 0 }) {
  const phase = String(lock.currentStage || checkpoint?.stage || '').trim() || '待处理';
  const running = String(lock.status || '').toLowerCase() === 'running';
  const paused = String(lock.status || '').toLowerCase() === 'paused';
  const isTrack = phaseIsTrack(phase);
  // Compatibility: V148 checkpoints stored scanResults/trackResults counts;
  // V149 core checkpoints store scanDone/trackDone plus retry/total fields.
  const scanDone = num(payload.scanDone, payload.scanResults);
  const scanRetry = num(payload.scanRetry);
  const scanObserved = num(payload.scanObserved, scanDone + scanRetry);
  const scanTotal = num(payload.scanTotal, sourceTotal);
  const trackDone = num(payload.trackDone, payload.trackResults);
  const trackRetry = num(payload.trackRetry);
  const trackObserved = num(payload.trackObserved, trackDone + trackRetry);
  const resolvedTrackTotal = num(trackTotal, payload.trackTotal, trackDone + trackRetry);
  return {
    ok: true,
    version: VERSION,
    progressRule: 'V149_RUN_LOCK_PLUS_TINY_CHECKPOINT_COMPAT',
    businessType,
    reportDate,
    running,
    paused,
    phase,
    batchIndex: num(lock.batchIndex, checkpoint?.batchIndex),
    totalBatches: num(lock.totalBatches, checkpoint?.totalBatches),
    scanDone, scanRetry, scanObserved, scanTotal,
    trackDone, trackRetry, trackObserved, trackTotal: resolvedTrackTotal,
    done: isTrack ? trackDone : scanDone,
    retry: isTrack ? trackRetry : scanRetry,
    total: isTrack ? resolvedTrackTotal : scanTotal,
    runId: String(lock.runId || ''),
    runStatus: String(payload.runStatus || payload.lastRunSummary?.runStatus || lock.status || checkpoint?.status || ''),
    lastMessage: String(lock.errorMessage || checkpoint?.errorMessage || ''),
    generatedAt: new Date().toISOString()
  };
}

function emptyProgress(businessType) {
  return { ok:true, version:VERSION, progressRule:'V149_RUN_LOCK_PLUS_TINY_CHECKPOINT_COMPAT', businessType, reportDate:'', running:false, paused:false, phase:'待处理', batchIndex:0, totalBatches:0, scanDone:0, scanRetry:0, scanObserved:0, scanTotal:0, trackDone:0, trackRetry:0, trackObserved:0, trackTotal:0, done:0, retry:0, total:0, runId:'', runStatus:'', lastMessage:'', generatedAt:new Date().toISOString() };
}

function progressHandler(req, res) {
  const type = String(req.query.businessType || 'CCSL').trim().toUpperCase() === 'SHOPEE' ? 'SHOPEE' : 'CCSL';
  const db = getDb();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json(type === 'SHOPEE' ? shopeeProgress(db) : ccslProgress(db));
}

let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v149TinyRunProgressCompatListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v33/run-progress', progressHandler);
  }
  return previousListen.apply(this, args);
};

export { ccslProgress, shopeeProgress, progressShape };
