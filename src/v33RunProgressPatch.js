import express from 'express';
import { getDb } from './db.js';

const VERSION = '2026-08-27-v331-ccsl-progress-selected-date-zero-ticket-v1';
const CCSL_RUN_ROUTES = new Set(['/api/run','/api/run/start','/api/resume','/api/run/resume']);

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
function hasCount(value) {
  if (value === undefined || value === null || value === '') return false;
  return Number.isFinite(Number(value));
}
function exactCount(...values) {
  for (const value of values) {
    if (hasCount(value)) return Math.max(0, Number(value));
  }
  return 0;
}
function cleanBills(values = []) {
  return [...new Set((values || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
}
function sameMembers(left = [], right = []) {
  const a = cleanBills(left), b = cleanBills(right);
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(value => set.has(value));
}
function normalizeReportDate(value) {
  const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
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
function latestValidReportDate(db) {
  return String(db.prepare(`
    SELECT reportDate FROM unified_import_batches
    WHERE status='VALID'
    ORDER BY reportDate DESC,createdAt DESC,batchId DESC LIMIT 1
  `).get()?.reportDate || '');
}
function unifiedCcslMembers(db, reportDate) {
  const snapshotId = latestValidSnapshotId(db, reportDate);
  if (!snapshotId) return [];
  return cleanBills(db.prepare(`
    SELECT shipmentCode
    FROM unified_import_rows
    WHERE snapshotId=? AND reportDate=?
      AND businessType IN ('CE','CEAF','TBKH','ALI1688')
    ORDER BY shipmentCode
  `).all(snapshotId, reportDate).map(row => row.shipmentCode));
}
function unifiedCcslTotal(db, reportDate) { return unifiedCcslMembers(db, reportDate).length; }
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

function repairCcslMembershipBeforeRun(req, res, next) {
  try {
    const db = getDb();
    const reportDate = String(db.prepare("SELECT value FROM app_meta WHERE key='last_processed_report_date'").get()?.value || latestValidReportDate(db)).trim();
    if (!reportDate) return next();
    const authoritative = unifiedCcslMembers(db, reportDate);
    if (!authoritative.length) return next();
    const row = db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get();
    const state = parseJson(row?.valueJson, {});
    if (String(state.reportDate || '') === reportDate && sameMembers(state.pnhBills, authoritative)) return next();

    const snapshotId = latestValidSnapshotId(db, reportDate);
    const importedRows = db.prepare(`
      SELECT shipmentCode,businessType,rowJson
      FROM unified_import_rows
      WHERE snapshotId=? AND reportDate=?
        AND businessType IN ('CE','CEAF','TBKH','ALI1688')
      ORDER BY shipmentCode
    `).all(snapshotId, reportDate).map(item => ({
      ...parseJson(item.rowJson, {}),
      shipmentCode: String(item.shipmentCode || '').trim().toUpperCase(),
      运单号: String(item.shipmentCode || '').trim().toUpperCase(),
      businessType: item.businessType,
      result: 'PNH'
    }));
    const businessCounts = Object.fromEntries(['CE','CEAF','TBKH','ALI1688'].map(type => [type, importedRows.filter(item => item.businessType === type).length]));
    const summary = {
      ...(state.dailyParseSummary || {}),
      totalRecognized: authoritative.length,
      pnh: authoritative.length,
      pnhCount: authoritative.length,
      nonPnh: 0,
      excluded: 0,
      businessCounts,
      sourceAuthority: 'V156_LATEST_VALID_UNIFIED_MEMBERSHIP_REPAIR'
    };
    const repaired = {
      ...state,
      businessType: 'CCSL',
      reportDate,
      dailyReportReady: true,
      pnhBills: authoritative,
      dailyParseRows: importedRows,
      dailyParseSummary: summary
    };
    const now = new Date().toISOString();
    db.prepare("UPDATE app_state SET valueJson=?,updatedAt=? WHERE key='current'").run(JSON.stringify(repaired), now);
    db.prepare(`
      UPDATE daily_reports
      SET pnhCount=?,totalUniqueCount=?,summaryJson=?,updatedAt=?
      WHERE reportDate=?
    `).run(authoritative.length, authoritative.length, JSON.stringify(summary), now, reportDate);
    console.warn(`[CE-QC][V156] repaired CCSL run membership for ${reportDate}: ${authoritative.length} bills from VALID unified snapshot ${snapshotId}`);
    next();
  } catch (error) {
    console.error('[CE-QC][V156] CCSL membership repair failed:', error);
    next(error);
  }
}

function ccslProgress(db, requestedReportDate = '') {
  const requested = normalizeReportDate(requestedReportDate);
  const reportDate = requested
    || latestValidReportDate(db)
    || db.prepare("SELECT value FROM app_meta WHERE key='last_processed_report_date'").get()?.value
    || db.prepare('SELECT reportDate FROM daily_reports ORDER BY updatedAt DESC,reportDate DESC LIMIT 1').get()?.reportDate
    || '';
  if (!reportDate) return emptyProgress('CCSL');
  const validSnapshotId = latestValidSnapshotId(db, reportDate);
  const lock = db.prepare('SELECT * FROM run_locks WHERE reportDate=?').get(reportDate) || {};
  const checkpoint = lock.runId
    ? db.prepare('SELECT payloadJson,stage,batchIndex,totalBatches,status,errorMessage,updatedAt FROM run_checkpoints WHERE reportDate=? AND runId=? ORDER BY updatedAt DESC,rowid DESC LIMIT 1').get(reportDate, lock.runId)
    : null;
  const payload = parseJson(checkpoint?.payloadJson, {});
  const mirroredTotal = db.prepare('SELECT pnhCount FROM daily_reports WHERE reportDate=?').get(reportDate)?.pnhCount;
  const unifiedTotal = validSnapshotId ? unifiedCcslTotal(db, reportDate) : 0;
  const sourceTotal = validSnapshotId
    ? unifiedTotal
    : (hasCount(mirroredTotal) ? Math.max(0, Number(mirroredTotal)) : 0);
  const zeroTicketDay = Boolean(validSnapshotId) && sourceTotal === 0;

  if (zeroTicketDay) {
    const completed = progressShape({
      businessType:'CCSL',
      reportDate,
      lock:{},
      checkpoint:null,
      payload:{ runStatus:'completed' },
      sourceTotal:0,
      persistedTrackTotal:0
    });
    return {
      ...completed,
      progressRule:'V331_SELECTED_DATE_VALID_UNIFIED_ZERO_TICKET_COMPLETE',
      canonicalSource:'LATEST_VALID_UNIFIED',
      complete:true,
      zeroTicketDay:true,
      running:false,
      paused:false,
      phase:'已完成',
      runStatus:'completed',
      lastMessage:'当日有效日报CCSL为0票，无需启动订单扫描或轨迹查询。'
    };
  }

  const phase = String(lock.currentStage || checkpoint?.stage || '').trim() || '待处理';
  const persistedTrackTotal = phaseIsTrack(phase)
    ? num(db.prepare('SELECT COUNT(DISTINCT shipmentCode) count FROM scan_results WHERE reportDate=? AND COALESCE(isPod,0)=0').get(reportDate)?.count)
    : undefined;
  return {
    ...progressShape({ businessType:'CCSL', reportDate, lock, checkpoint, payload, sourceTotal, persistedTrackTotal }),
    progressRule:'V331_SELECTED_DATE_VALID_UNIFIED_PROGRESS',
    canonicalSource:validSnapshotId ? 'LATEST_VALID_UNIFIED' : 'LEGACY_DAILY',
    complete:false,
    zeroTicketDay:false
  };
}

function shopeeProgress(db) {
  const reportDate = db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='SHOPEE' ORDER BY updatedAt DESC,reportDate DESC LIMIT 1").get()?.reportDate || '';
  if (!reportDate) return emptyProgress('SHOPEE');
  const lock = db.prepare("SELECT * FROM business_run_locks WHERE businessType='SHOPEE' AND reportDate=?").get(reportDate) || {};
  const checkpoint = lock.runId
    ? db.prepare("SELECT payloadJson,stage,batchIndex,totalBatches,status,errorMessage,updatedAt FROM business_run_checkpoints WHERE businessType='SHOPEE' AND reportDate=? AND runId=? ORDER BY updatedAt DESC,id DESC LIMIT 1").get(reportDate, lock.runId)
    : null;
  const payload = parseJson(checkpoint?.payloadJson, {});
  const mirroredTotal = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='SHOPEE' AND reportDate=?").get(reportDate)?.totalCount;
  const unifiedTotal = unifiedShopeeTotal(db, reportDate);
  const sourceTotal = hasCount(mirroredTotal) && Number(mirroredTotal) > 0 ? Number(mirroredTotal) : unifiedTotal;
  const phase = String(lock.currentStage || checkpoint?.stage || '').trim() || '待处理';
  const persistedTrackTotal = phaseIsTrack(phase)
    ? num(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_scan_results WHERE businessType='SHOPEE' AND reportDate=? AND COALESCE(isPod,0)=0").get(reportDate)?.count)
    : undefined;
  return progressShape({ businessType:'SHOPEE', reportDate, lock, checkpoint, payload, sourceTotal, persistedTrackTotal });
}

function progressShape({ businessType, reportDate, lock = {}, checkpoint = null, payload = {}, sourceTotal = 0, persistedTrackTotal }) {
  const phase = String(lock.currentStage || checkpoint?.stage || '').trim() || '待处理';
  const running = String(lock.status || '').toLowerCase() === 'running';
  const paused = String(lock.status || '').toLowerCase() === 'paused';
  const isTrack = phaseIsTrack(phase);
  const last = payload.lastRunSummary || {};

  const rawScanDone = num(payload.scanDone, payload.scanResults);
  const rawScanRetry = num(payload.scanRetry, last.scanRetry);
  const rawScanObserved = num(payload.scanObserved, rawScanDone + rawScanRetry);
  const scanTotal = hasCount(payload.scanTotal)
    ? exactCount(payload.scanTotal)
    : hasCount(last.scanPool)
      ? exactCount(last.scanPool)
      : Math.max(0, Number(sourceTotal) || rawScanDone + rawScanRetry);
  const scan = boundedCounts(scanTotal, rawScanDone, rawScanRetry, rawScanObserved);

  const rawTrackDone = num(payload.trackDone, payload.trackResults);
  const rawTrackRetry = num(payload.trackRetry, last.trackRetry);
  const rawTrackObserved = num(payload.trackObserved, rawTrackDone + rawTrackRetry);
  const trackTotal = hasCount(payload.trackTotal)
    ? exactCount(payload.trackTotal)
    : hasCount(last.needTrack)
      ? exactCount(last.needTrack)
      : hasCount(persistedTrackTotal)
        ? exactCount(persistedTrackTotal)
        : Math.max(0, rawTrackDone + rawTrackRetry);
  const track = boundedCounts(trackTotal, rawTrackDone, rawTrackRetry, rawTrackObserved);
  const runStatus = String(payload.runStatus || last.runStatus || lock.status || checkpoint?.status || '');

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
    dailyTotal: Math.max(0, Number(sourceTotal) || 0),
    podLockSkipped: Math.max(0, (Number(sourceTotal) || 0) - scan.total),
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
    runStatus,
    lastMessage: String(lock.errorMessage || checkpoint?.errorMessage || ''),
    generatedAt: new Date().toISOString()
  };
}

function emptyProgress(businessType) {
  return { ok:true, version:VERSION, progressRule:'V149_RUN_LOCK_PLUS_TINY_CHECKPOINT_BOUNDED', businessType, reportDate:'', running:false, paused:false, phase:'待处理', batchIndex:0, totalBatches:0, dailyTotal:0, podLockSkipped:0, scanDone:0, scanRetry:0, scanObserved:0, scanTotal:0, trackDone:0, trackRetry:0, trackObserved:0, trackTotal:0, done:0, retry:0, total:0, runId:'', runStatus:'', complete:false, zeroTicketDay:false, lastMessage:'', generatedAt:new Date().toISOString() };
}

function progressHandler(req, res) {
  const type = String(req.query.businessType || 'CCSL').trim().toUpperCase() === 'SHOPEE' ? 'SHOPEE' : 'CCSL';
  const db = getDb();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json(type === 'SHOPEE' ? shopeeProgress(db) : ccslProgress(db, req.query.reportDate));
}

const previousPost = express.application.post;
express.application.post = function v156CcslRunMembershipRepairPost(pathValue, ...handlers) {
  if (CCSL_RUN_ROUTES.has(String(pathValue || ''))) {
    return previousPost.call(this, pathValue, repairCcslMembershipBeforeRun, ...handlers);
  }
  return previousPost.call(this, pathValue, ...handlers);
};

let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v149TinyRunProgressCompatListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v33/run-progress', progressHandler);
  }
  return previousListen.apply(this, args);
};

export { ccslProgress, shopeeProgress, progressShape, boundedCounts, repairCcslMembershipBeforeRun };