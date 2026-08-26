import * as originalStore from './businessStore.js';
import { getDb, nowIso } from './db.js';
import { shouldUseFastCheckpoint, V314_SHOPEE_THROUGHPUT_CORE_ID } from './v314ShopeeThroughputCore.js';
export * from './businessStore.js';

export const V314_FAST_CHECKPOINT_ID = '2026-08-26-v314-shopee-throttled-full-mirror-v1';

function lightCheckpoint(state = {}, businessType = '') {
  const type = String(businessType || state.businessType || 'SHOPEE').toUpperCase();
  const date = String(state.reportDate || '').trim();
  const run = state.currentRun || state.lastRunSummary || {};
  const runId = String(run.runId || '').trim();
  if (!date || !runId) return state;
  const processing = state.processing || {};
  const now = nowIso();
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE business_run_locks
      SET currentStage=?,batchIndex=?,totalBatches=?,errorMessage=?,updatedAt=?
      WHERE businessType=? AND reportDate=? AND runId=?`)
      .run(processing.phase || '', Number(processing.batchIndex || 0), Number(processing.totalBatches || 0), processing.error || '', now, type, date, runId);
    db.prepare(`INSERT INTO business_run_checkpoints(
      businessType,runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(type, runId, date, processing.phase || '', Number(processing.batchIndex || 0), Number(processing.totalBatches || 0), 'running', JSON.stringify({
        fastCheckpoint: true,
        scanDone: Number(state.scanResults?.length || 0),
        trackDone: Number(state.trackResults?.length || 0),
        eventStatusDone: Number((state.eventQueryStatus || []).filter(row => row?.status === 'success').length),
        exceptionStatusDone: Number((state.exceptionQueryStatus || []).filter(row => row?.status === 'success').length)
      }), processing.error || '', now, now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return state;
}

export function saveBusinessState(state = {}, businessType = state.businessType || originalStore.SHOPEE) {
  if (shouldUseFastCheckpoint(state, businessType)) return lightCheckpoint(state, businessType);
  return originalStore.saveBusinessState(state, businessType);
}

console.info('[CE-QC][V314_FAST_CHECKPOINT]', JSON.stringify({
  id: V314_FAST_CHECKPOINT_ID,
  core: V314_SHOPEE_THROUGHPUT_CORE_ID,
  scanFullMirrorEveryBatches: 2,
  eventExceptionFullMirrorEveryBatches: 4,
  finalBatchAlwaysFullMirror: true,
  lightweightProgressKeepsRunLockCurrent: true
}));
