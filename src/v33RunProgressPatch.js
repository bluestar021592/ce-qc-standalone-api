import express from 'express';
import { getDb } from './db.js';

const VERSION = '2026-08-16-v149-tiny-run-progress-compat-v2+v155-runtime-scan-pool-fallback-v2';

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
function targetTotal(primary, secondary, fallback = 0) {
  const first = Number(primary);
  const second = Number(secondary);
  if (Number.isFinite(first) && first > 0) return Math.max(0, first);
  if (Number.isFinite(second) && second > 0) return Math.max(0, second);
  if (Number.isFinite(first) && first === 0 && (!Number.isFinite(second) || second <= 0)) return 0;
  if (Number.isFinite(second) && second === 0) return 0;
  return Math.max(0, Number(fallback) || 0);
}
function boundedCounts(totalValue, doneValue, retryValue, observedValue) {
  const total = Math.max(0, Number(totalValue) || 0);
  const rawDone = Math.max(0, Number(doneValue) || 0);
  const rawRetry = Math.max(0, Number(retryValue) || 0);
  const rawObserved = Math.max(0, Number(observedValue) || 0);
  const done = Math.min(total, rawDone);
  const retry = Math.min(Math.max(0, total - done), rawRetry);
  const observed = Math.min(total, Math.max(done + retry, rawObserved));
  return { done, retry, observed, total };
}

function latestValidSnapshotId(db, reportDate) {
  return String(db.prepare(`
    SELECT snapshotId FROM unified_import_batches
    WHERE reportDate=? AND status='VALID'
    ORDER BY createdAt DESC,batchId DESC LIMIT 1
  `).get(reportDate)?.snapshotId || '');
}
function unifiedCcslTotal(db, reportDate) {
  const snapshotId = latestValidSnapshotId(db, reportDate);
  if (!snapshotId) return 0;
  return num(db.prepare(`
    SELECT COUNT(DISTINCT shipmentCode) count
    FROM unified_import_rows
    WHERE snapshotId=? AND reportDate=?
      AND businessType IN ('CE','CEAF','TBKH','ALI1688')
  `).get(snapshotId, reportDate)?.count);
}
function unifiedShopeeTotal(db, reportDate) {
  const snapshotId = latestValidSnapshotId(db, reportDate);
  if (!snapshotId) return 0;
  return num(db.prepare(`
    SELECT COUNT(DISTINCT shipmentCode) count
    FROM unified_import_rows
    WHERE snapshotId=? AND reportDate=?
      AND businessType IN ('SHOPEECN','SHOPEEVN')
  `).get(snapshotId, reportDate)?.count);
}

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
  const mirroredTotal = num(db.prepare('SELECT pnhCount FROM daily_reports WHERE reportDate=?').get(reportDate)?.pnhCount);
  const sourceTotal = targetTotal(mirroredTotal, unifiedCcslTotal(db, reportDate), 0);
  const phase = String(lock.currentStage || checkpoint?.stage || '').trim() || '待处理';
  const persistedTrackTotal = phaseIsTrack(phase)
    ? num(db.prepare('SELECT COUNT(DISTINCT shipmentCode) count FROM scan_results WHERE reportDate=? AND COALESCE(isPod,0)=0').get(reportDate)?.count)
    : 0;
  const trackTotal = targetTotal(persistedTrackTotal, payload.trackTotal, 0);
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
  const mirroredTotal = num(db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='SHOPEE' AND reportDate=?").get(reportDate)?.totalCount);
  const sourceTotal = targetTotal(mirroredTotal, unifiedShopeeTotal(db, reportDate), 0);
  const phase = String(lock.currentStage || checkpoint?.stage || '').trim() || '待处理';
  const persistedTrackTotal = phaseIsTrack(phase)
    ? num(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_scan_results WHERE businessType='SHOPEE' AND reportDate=? AND COALESCE(isPod,0)=0").get(reportDate)?.count)
    : 0;
  const trackTotal = targetTotal(persistedTrackTotal, payload.trackTotal, 0);
  return progressShape({ businessType:'SHOPEE', reportDate, lock, checkpoint, payload, sourceTotal, trackTotal });
}

function progressShape({ businessType, reportDate, lock = {}, checkpoint = null, payload = {}, sourceTotal = 0, trackTotal = 0 }) {
  const phase = String(lock.currentStage || checkpoint?.stage || '').trim() || '待处理';
  const running = String(lock.status || '').toLowerCase() === 'running';
  const paused = String(lock.status || '').toLowerCase() === 'paused';
  const isTrack = phaseIsTrack(phase);
  // Compatibility: V148 checkpoints stored scanResults/trackResults counts;
  // V149 core checkpoints store scanDone/trackDone plus retry/total fields.
  // The pipeline also stores the exact runtime scanPool inside lastRunSummary.
  const rawScanDone = num(payload.scanDone, payload.scanResults);
  const rawScanRetry = num(payload.scanRetry);
  const rawScanObserved = num(payload.scanObserved, rawScanDone + rawScanRetry);
  const runtimeScanPool = num(payload.lastRunSummary?.scanPool);
  const declaredScanTotal = targetTotal(payload.scanTotal, runtimeScanPool, sourceTotal);
  const scanTotal = targetTotal(declaredScanTotal, sourceTotal, rawScanDone + rawScanRetry);
  const scan = boundedCounts(scanTotal, rawScanDone, rawScanRetry, rawScanObserved);

  const rawTrackDone = num(payload.trackDone, payload.trackResults);
  const rawTrackRetry = num(payload.trackRetry);
  const rawTrackObserved = num(payload.trackObserved, rawTrackDone + rawTrackRetry);
  const resolvedTrackTotal = targetTotal(trackTotal, payload.trackTotal, rawTrackDone + rawTrackRetry);
  const track = boundedCounts(resolvedTrackTotal, rawTrackDone, rawTrackRetry, rawTrackObserved);

  return {
    ok: true,
    version: VERSION,
    progressRule: 'V149_RUN_LOCK_PLUS_TINY_CHECKPOINT_BOUNDED',
    businessType,
    reportDate,
    running,
    paused,
    phase,
    batchIndex: num(lock.batchIndex, checkpoint?.batchIndex),
    totalBatches: num(lock.totalBatches, checkpoint?.totalBatches),
    scanDone: scan.done,
    scanRetry: scan.retry,
    scanObserved: scan.observed,
    scanTotal: scan.total,
    trackDone: track.done,
    trackRetry: track.retry,
    trackObserved: track.observed,
    trackTotal: track.total,
    done: isTrack ? track.done : scan.done,
    retry: isTrack ? track.retry : scan.retry,
    total: isTrack ? track.total : scan.total,
    runId: String(lock.runId || ''),
    runStatus: String(payload.runStatus || payload.lastRunSummary?.runStatus || lock.status || checkpoint?.status || ''),
    lastMessage: String(lock.errorMessage || checkpoint?.errorMessage || ''),
    generatedAt: new Date().toISOString()
  };
}

function emptyProgress(businessType) {
  return { ok:true, version:VERSION, progressRule:'V149_RUN_LOCK_PLUS_TINY_CHECKPOINT_BOUNDED', businessType, reportDate:'', running:false, paused:false, phase:'待处理', batchIndex:0, totalBatches:0, scanDone:0, scanRetry:0, scanObserved:0, scanTotal:0, trackDone:0, trackRetry:0, trackObserved:0, trackTotal:0, done:0, retry:0, total:0, runId:'', runStatus:'', lastMessage:'', generatedAt:new Date().toISOString() };
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

export { ccslProgress, shopeeProgress, progressShape, boundedCounts };