import { DatabaseSync } from 'node:sqlite';
import * as originalStore from './businessStore.js';
import { getRuntimeConfig, nowIso } from './db.js';
import { V314_SHOPEE_THROUGHPUT_CORE_ID } from './v314ShopeeThroughputCore.js';
export * from './businessStore.js';

export const V314_FAST_CHECKPOINT_ID = '2026-08-30-v314-shopee-final-only-authoritative-mirror-v2';
const FULL_MIRROR_WARN_MS = 1000;
const CHECKPOINT_WARN_INTERVAL_MS = 30_000;

let progressDb = null;
let progressDbPath = '';
let liveState = null;
let lastCheckpointWarnAt = 0;

function normalizeType(businessType = '', state = null) {
  return String(businessType || state?.businessType || originalStore.SHOPEE || 'SHOPEE').toUpperCase();
}

function currentRunId(state = {}) {
  const run = state.currentRun || state.lastRunSummary || state.lastRun || {};
  return String(run.runId || state.processing?.runId || '').trim();
}

function countStatus(rows = [], status = 'success') {
  return (Array.isArray(rows) ? rows : []).filter(row => String(row?.status || '').toLowerCase() === status).length;
}

function progressCounts(state = {}) {
  const scanStatus = Array.isArray(state.scanQueryStatus) ? state.scanQueryStatus : [];
  const eventStatus = Array.isArray(state.eventQueryStatus) ? state.eventQueryStatus : [];
  const exceptionStatus = Array.isArray(state.exceptionQueryStatus) ? state.exceptionQueryStatus : [];
  return {
    scanDone: countStatus(scanStatus, 'success'),
    scanRetry: countStatus(scanStatus, 'failed'),
    scanObserved: scanStatus.length,
    scanResults: Number(state.scanResults?.length || 0),
    eventDone: countStatus(eventStatus, 'success'),
    eventRetry: countStatus(eventStatus, 'failed'),
    eventObserved: eventStatus.length,
    trackEvents: Number(state.trackEvents?.length || 0),
    exceptionDone: countStatus(exceptionStatus, 'success'),
    exceptionRetry: countStatus(exceptionStatus, 'failed'),
    exceptionObserved: exceptionStatus.length,
    exceptionItems: Number(state.exceptionItems?.length || 0)
  };
}

function getProgressDb() {
  const cfg = getRuntimeConfig();
  if (progressDb && progressDbPath === cfg.dbFile) return progressDb;
  try { progressDb?.close(); } catch {}
  progressDb = new DatabaseSync(cfg.dbFile);
  // Progress visibility must never own or wait on the production writer lock.
  // The authoritative business mirror is persisted at pause/error/finalization.
  progressDb.exec('PRAGMA busy_timeout = 0');
  progressDbPath = cfg.dbFile;
  return progressDb;
}

function shouldUseLightCheckpoint(state = {}, businessType = '') {
  const type = normalizeType(businessType, state);
  const processing = state.processing || {};
  return type === originalStore.SHOPEE
    && processing.running === true
    && processing.paused !== true
    && !processing.error;
}

function warnCheckpointSkipped(error, state, type, startedAt) {
  const nowMs = Date.now();
  if (nowMs - lastCheckpointWarnAt < CHECKPOINT_WARN_INTERVAL_MS) return;
  lastCheckpointWarnAt = nowMs;
  console.warn('[CE-QC][V314_SHOPEE_CHECKPOINT_SKIPPED]', JSON.stringify({
    businessType: type,
    reportDate: String(state.reportDate || ''),
    runId: currentRunId(state),
    phase: String(state.processing?.phase || ''),
    batchIndex: Number(state.processing?.batchIndex || 0),
    elapsedMs: nowMs - startedAt,
    code: String(error?.code || ''),
    message: String(error?.message || error || '').slice(0, 300),
    policy: 'ZERO_WAIT_FAIL_OPEN_SHOPEE_PIPELINE_CONTINUES'
  }));
}

function lightCheckpoint(state = {}, businessType = '') {
  const type = normalizeType(businessType, state);
  const date = String(state.reportDate || '').trim();
  const runId = currentRunId(state);
  if (!date || !runId) return state;
  const processing = state.processing || {};
  const now = nowIso();
  const startedAt = Date.now();
  try {
    const db = getProgressDb();
    // Do not wrap progress-only writes in BEGIN IMMEDIATE. Each statement is tiny,
    // zero-wait and disposable. A busy database must never hold up CE API batches.
    db.prepare(`UPDATE business_run_locks
      SET status='running',currentStage=?,batchIndex=?,totalBatches=?,errorMessage='',updatedAt=?
      WHERE businessType=? AND reportDate=? AND runId=?`)
      .run(processing.phase || '', Number(processing.batchIndex || 0), Number(processing.totalBatches || 0), now, type, date, runId);
    db.prepare(`INSERT INTO business_run_checkpoints(
      businessType,runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt
    ) VALUES(?,?,?,?,?,?,'running',?,'',?,?)`)
      .run(type, runId, date, processing.phase || '', Number(processing.batchIndex || 0), Number(processing.totalBatches || 0), JSON.stringify({
        fastCheckpoint: true,
        checkpointOwner: V314_FAST_CHECKPOINT_ID,
        finalOnlyMirror: true,
        ...progressCounts(state)
      }), now, now);
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= 250) {
      console.warn('[CE-QC][V314_SHOPEE_LIGHT_CHECKPOINT_SLOW]', JSON.stringify({
        businessType: type,
        reportDate: date,
        runId,
        phase: String(processing.phase || ''),
        batchIndex: Number(processing.batchIndex || 0),
        elapsedMs
      }));
    }
  } catch (error) {
    // Checkpoint visibility is not business truth. If SQLite is busy, skip it and
    // let the 350 scan / 50x4 tracking pipeline continue. Final persistence remains
    // fail-closed and is never swallowed below.
    warnCheckpointSkipped(error, state, type, startedAt);
  }
  return state;
}

export function loadBusinessState(businessType = originalStore.SHOPEE) {
  const type = normalizeType(businessType);
  // server.js calls loadBusinessState() before every batch only to observe pause.
  // The same process owns pause/resume, so rehydrating the complete SHOPEE state
  // from SQLite here adds no truth and can dominate runtime on large days.
  if (type === originalStore.SHOPEE && liveState?.processing?.running && !liveState?.processing?.error) return liveState;
  const loaded = originalStore.loadBusinessState(type);
  if (type === originalStore.SHOPEE && loaded?.processing?.running && !loaded?.processing?.error) liveState = loaded;
  return loaded;
}

export function saveBusinessState(state = {}, businessType = state.businessType || originalStore.SHOPEE) {
  const type = normalizeType(businessType, state);
  if (type !== originalStore.SHOPEE) return originalStore.saveBusinessState(state, type);

  if (state && typeof state === 'object' && state.processing?.running && !state.processing?.error) liveState = state;

  // Every active SHOPEE checkpoint is lightweight. There is no longer a periodic
  // 2-scan / 4-track full mirror cadence. This keeps CE requests moving while the
  // normalized result arrays grow to thousands of rows.
  if (shouldUseLightCheckpoint(state, type)) return lightCheckpoint(state, type);

  // Pause, terminal error and normal completion are authoritative boundaries.
  // These writes remain synchronous/fail-closed: if final persistence fails, the
  // run must not be reported as safely completed.
  const startedAt = Date.now();
  const result = originalStore.saveBusinessState(state, type);
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= FULL_MIRROR_WARN_MS) {
    console.warn('[CE-QC][V314_SHOPEE_FINAL_MIRROR_TIMING]', JSON.stringify({
      businessType: type,
      reportDate: String(state.reportDate || ''),
      runId: currentRunId(state),
      phase: String(state.processing?.phase || ''),
      running: Boolean(state.processing?.running),
      paused: Boolean(state.processing?.paused),
      elapsedMs,
      ...progressCounts(state)
    }));
  }
  if (!state?.processing?.running) liveState = null;
  return result;
}

export function resetV314CheckpointRuntimeForTest() {
  try { progressDb?.close(); } catch {}
  progressDb = null;
  progressDbPath = '';
  liveState = null;
  lastCheckpointWarnAt = 0;
}

console.info('[CE-QC][V314_FAST_CHECKPOINT]', JSON.stringify({
  id: V314_FAST_CHECKPOINT_ID,
  core: V314_SHOPEE_THROUGHPUT_CORE_ID,
  inRunFullMirror: false,
  authoritativeFullMirrorPolicy: 'PAUSE_ERROR_OR_FINAL_ONLY',
  lightCheckpointBusyTimeoutMs: 0,
  pauseReadPolicy: 'IN_MEMORY_WHILE_ACTIVE',
  lightCheckpointWrites: 'business_run_locks+business_run_checkpoints only',
  lightCheckpointFailurePolicy: 'ZERO_WAIT_FAIL_OPEN_NEVER_ABORT_SHOPEE',
  finalMirrorFailurePolicy: 'FAIL_CLOSED',
  scanBatchSize: 350,
  trackBatchSize: 50,
  trackConcurrency: 4,
  policy: 'LARGE_DB_ACTIVE_SHOPEE_PIPELINE_NEVER_RUNS_SYNCHRONOUS_FULL_MIRROR'
}));
