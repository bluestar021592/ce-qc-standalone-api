import express from 'express';
import { CEClient } from './ceClient.js';
import { getDb } from './db.js';
import { runWhppPipeline } from './whppPipeline.js';
import { WHPP, loadWhppState, saveWhppState, finalizeWhppState } from './whppStore.js';

const PATCH_ID = '2026-08-14-v134-whpp-run-supervisor-v1';
const BACKEND_CONTINUITY_REVISION = '2026-08-29-v357-whpp-backend-final-stage-continuity-v1';
const SELECTED_DATE_CONTINUITY_REVISION = '2026-08-29-v359-selected-date-whpp-backend-continuity-v1';
export const V378_WHPP_COMPLETION_LOCK_REVISION = '2026-08-31-v378-whpp-finalized-lifecycle-monotonic-v1';
const PROGRESS_PATH = '/api/whpp/progress';
const WHPP_REQUEST_TIMEOUT_MS = Math.max(8_000, Math.min(45_000, Number(process.env.WHPP_REQUEST_TIMEOUT_MS || 20_000)));
const AUTO_RESUME_POLL_MS = 5_000;
const AUTO_RESUME_COOLDOWN_MS = 30_000;
const LOG_LIMIT = 120;
const COMPLETE_SNAPSHOT = new Set(['COMPLETED', 'COMPLETED_WITH_RETRY']);

let runtimePromise = null;
let runtime = idleRuntime();
let lastRuntime = idleRuntime();
let autoResumeBusy = false;
let autoResumeTimer = null;
let lastAutoResumeAt = 0;
let lastAutoResumeKey = '';

function nowIso() { return new Date().toISOString(); }
function dateOnly(value = '') {
  const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function idleRuntime() {
  return {
    active: false,
    reportDate: '',
    mode: '',
    phase: '',
    lastMessage: '',
    batchIndex: 0,
    totalBatches: 0,
    startedAt: '',
    heartbeatAt: '',
    finishedAt: '',
    outcome: '',
    error: ''
  };
}
function stripHeavyRow(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...row };
  delete copy.rawJson;
  delete copy.raw;
  delete copy.events;
  delete copy.trackEvents;
  delete copy.scanRaw;
  return copy;
}
function compactCheckpointState(state = {}, log = []) {
  return {
    ...state,
    scanResults: (state.scanResults || []).map(stripHeavyRow),
    trackEvents: (state.trackEvents || []).map(stripHeavyRow),
    exceptionItems: (state.exceptionItems || []).map(stripHeavyRow),
    trackResults: [],
    progressLog: log.slice(-LOG_LIMIT),
    processing: {
      ...(state.processing || {}),
      lastCheckpointAt: nowIso()
    }
  };
}
function parseProgress(message = '') {
  const text = String(message || '');
  const scan = text.match(/WHPP订单扫描\s+(\d+)-(\d+)\s*\/\s*(\d+)/i);
  if (scan) {
    return { phase: text, batchIndex: Number(scan[2] || 0), totalBatches: Number(scan[3] || 0), progressKind: 'SCAN_WAYBILLS' };
  }
  const batch = text.match(/(WHPP[^：]*查询)\s+(\d+)\/(\d+)/i);
  if (batch) {
    return { phase: text, batchIndex: Number(batch[2] || 0), totalBatches: Number(batch[3] || 0), progressKind: 'API_BATCHES' };
  }
  return { phase: text };
}
function publicRuntime(value = runtime) {
  return {
    active: Boolean(value.active),
    reportDate: value.reportDate || '',
    mode: value.mode || '',
    phase: value.phase || '',
    lastMessage: value.lastMessage || '',
    batchIndex: Number(value.batchIndex || 0),
    totalBatches: Number(value.totalBatches || 0),
    startedAt: value.startedAt || '',
    heartbeatAt: value.heartbeatAt || '',
    finishedAt: value.finishedAt || '',
    outcome: value.outcome || '',
    error: value.error || ''
  };
}
function isAuthFailure(error) {
  return /401|403|未授权|unauthorized|登录.*失效|token/i.test(`${error?.ceStatus || ''} ${error?.ceCode || ''} ${error?.message || ''}`);
}

export function inspectV378WhppCompletionLock(reportDate = '', state = null, db = getDb()) {
  const date = dateOnly(reportDate || state?.reportDate || '');
  if (!date) return { locked: false, reportDate: '', reason: 'REPORT_DATE_MISSING', revision: V378_WHPP_COMPLETION_LOCK_REVISION };
  const daily = db.prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);
  if (!daily) return { locked: false, reportDate: date, reason: 'NO_NORMALIZED_DAILY', revision: V378_WHPP_COMPLETION_LOCK_REVISION };
  const summary = safeJson(daily.summaryJson, {});
  const status = String(summary.snapshotStatus || summary.reconciliationStatus || '').toUpperCase();
  const finalizedSnapshotId = String(summary.finalizedSnapshotId || '').trim();
  const sourceSnapshotId = String(summary.snapshotId || summary.batchId || '').trim();
  const stateSourceSnapshotId = String(state?.sourceSnapshotId || state?.batchId || '').trim();
  const sourceMatches = !stateSourceSnapshotId || !sourceSnapshotId || stateSourceSnapshotId === sourceSnapshotId;
  const finalized = Boolean(summary.completed === true && COMPLETE_SNAPSHOT.has(status) && finalizedSnapshotId);
  return {
    locked: Boolean(finalized && sourceMatches),
    finalized,
    sourceMatches,
    reportDate: date,
    total: Number(daily.totalCount || 0),
    sourceSnapshotId,
    stateSourceSnapshotId,
    finalizedSnapshotId,
    snapshotStatus: status,
    finalizedAt: String(summary.finalizedAt || ''),
    reason: finalized && sourceMatches ? 'CURRENT_DAILY_ALREADY_FINALIZED' : finalized ? 'FINALIZED_OTHER_SOURCE' : 'CURRENT_DAILY_NOT_FINALIZED',
    revision: V378_WHPP_COMPLETION_LOCK_REVISION
  };
}

function persistFailure(error, log) {
  try {
    const current = loadWhppState();
    const partial = error?.code === 'WHPP_PARTIAL_API_FAILURE';
    const auth = isAuthFailure(error);
    current.processing = {
      ...(current.processing || {}),
      running: false,
      paused: false,
      phase: partial ? 'WHPP待重试' : auth ? '等待CE重新登录' : 'WHPP执行失败',
      error: error?.message || String(error || 'WHPP_RUN_FAILED'),
      lastCheckpointAt: nowIso()
    };
    saveWhppState(compactCheckpointState(current, log));
  } catch (persistError) {
    console.error('[CE-QC][V134] failed to persist WHPP failure state:', persistError?.stack || persistError);
  }
}

function launchWhpp(mode = 'start') {
  const state = loadWhppState();
  if (!state.reportDate || !state.dailyReportReady) {
    const error = new Error('当前未导入WHPP本土日报数据。');
    error.code = 'WHPP_REPORT_MISSING';
    throw error;
  }
  const completionLock = inspectV378WhppCompletionLock(state.reportDate, state);
  if (completionLock.locked) {
    const error = new Error('WHPP本土当前日报已正式完成；同一日报生命周期禁止重复启动。');
    error.code = 'WHPP_ALREADY_FINALIZED';
    error.completionLock = completionLock;
    throw error;
  }

  const client = new CEClient();
  if (client?.http?.defaults) client.http.defaults.timeout = WHPP_REQUEST_TIMEOUT_MS;
  const log = [];
  const startedAt = nowIso();
  runtime = {
    ...idleRuntime(),
    active: true,
    reportDate: state.reportDate,
    mode,
    phase: 'WHPP启动处理中',
    lastMessage: 'WHPP后台任务已启动',
    startedAt,
    heartbeatAt: startedAt
  };

  runtimePromise = Promise.resolve().then(async () => {
    const result = await runWhppPipeline({
      state,
      client,
      onProgress: async message => {
        const text = String(message || '');
        log.push({ at: nowIso(), message: text });
        if (log.length > LOG_LIMIT) log.shift();
        runtime = { ...runtime, ...parseProgress(text), active: true, lastMessage: text, heartbeatAt: nowIso() };
      },
      onCheckpoint: async current => {
        const processing = current.processing || {};
        runtime = {
          ...runtime,
          active: true,
          phase: runtime.lastMessage || processing.phase || runtime.phase,
          batchIndex: runtime.batchIndex || Number(processing.batchIndex || 0),
          totalBatches: runtime.totalBatches || Number(processing.totalBatches || 0),
          heartbeatAt: nowIso()
        };
        saveWhppState(compactCheckpointState(current, log));
      },
      isPaused: async () => Boolean(loadWhppState().processing?.paused)
    });
    const finalized = finalizeWhppState(result.state);
    runtime = {
      ...runtime,
      active: false,
      phase: '完成',
      lastMessage: `WHPP完成：POD ${Number(result.summary?.pod || 0)}票，退回 ${Number(result.summary?.returned || 0)}票，未闭环 ${Number(result.summary?.nextCarry || 0)}票`,
      heartbeatAt: nowIso(),
      finishedAt: nowIso(),
      outcome: 'COMPLETED',
      error: ''
    };
    return { ok: true, ...finalized, summary: result.summary, log };
  }).catch(error => {
    persistFailure(error, log);
    runtime = {
      ...runtime,
      active: false,
      heartbeatAt: nowIso(),
      finishedAt: nowIso(),
      outcome: error?.code === 'WHPP_PARTIAL_API_FAILURE' ? 'RETRY_REQUIRED' : isAuthFailure(error) ? 'AUTH_REQUIRED' : 'FAILED',
      error: error?.message || String(error || 'WHPP_RUN_FAILED')
    };
    console.error('[CE-QC][V134][WHPP_BACKGROUND]', error?.stack || error);
    return { ok: false, code: error?.code || 'WHPP_RUN_FAILED', error: runtime.error };
  }).finally(() => {
    lastRuntime = { ...runtime, active: false };
    runtimePromise = null;
  });

  return publicRuntime(runtime);
}

async function maybeAutoResumeWhpp(reason = 'backend-watch') {
  if (autoResumeBusy || (runtimePromise && runtime.active)) return false;
  autoResumeBusy = true;
  try {
    const [ccslModule, shopeeModule, summaryModule, recoveryModule] = await Promise.all([
      import('./v317CcslIncompleteRecoveryPatch.js'),
      import('./v311ShopeeIncompleteRecoveryPatch.js'),
      import('./v132WhppFastIntegrationPatch.js'),
      import('./v165WhppRunStateRecoveryPatch.js')
    ]);
    const selectedHint = typeof ccslModule.inspectV317ExplicitReportDateHint === 'function'
      ? ccslModule.inspectV317ExplicitReportDateHint({ maxAgeMs: 60_000 })
      : null;
    const hintedDate = selectedHint?.fresh ? dateOnly(selectedHint.reportDate) : '';
    const ccsl = ccslModule.inspectV317CcslRecovery({ reportDate: hintedDate });
    const reportDate = dateOnly(ccsl?.reportDate);
    if (!reportDate || ccsl?.complete !== true) return false;

    const shopee = shopeeModule.inspectV311ShopeeRecovery({ reportDate });
    if (shopee?.complete !== true) return false;

    const persistedCompletion = inspectV378WhppCompletionLock(reportDate, loadWhppState());
    if (persistedCompletion.locked) return false;

    const before = summaryModule.inspectV132WhppFastSummary(reportDate);
    const beforeStatus = String(before?.snapshotStatus || before?.state?.snapshotStatus || '').toUpperCase();
    if (before?.completed === true || COMPLETE_SNAPSHOT.has(beforeStatus)) return false;

    const key = `${reportDate}:${Number(before?.total || 0)}:${Number(before?.finalEvidenceRows || 0)}:${beforeStatus}`;
    const now = Date.now();
    if (key === lastAutoResumeKey && now - lastAutoResumeAt < AUTO_RESUME_COOLDOWN_MS) return false;

    const recovered = recoveryModule.recoverV165WhppRunState(reportDate);
    if (String(recovered?.reason || '') === 'NO_NORMALIZED_DAILY') return false;

    const afterRecovery = summaryModule.inspectV132WhppFastSummary(reportDate);
    const afterStatus = String(afterRecovery?.snapshotStatus || afterRecovery?.state?.snapshotStatus || '').toUpperCase();
    if (afterRecovery?.completed === true || COMPLETE_SNAPSHOT.has(afterStatus)) return false;
    const afterPersistedCompletion = inspectV378WhppCompletionLock(reportDate, loadWhppState());
    if (afterPersistedCompletion.locked) return false;

    lastAutoResumeKey = key;
    lastAutoResumeAt = now;
    const started = launchWhpp('resume');
    console.log('[CE-QC][V357_WHPP_BACKEND_CONTINUITY]', JSON.stringify({
      revision: BACKEND_CONTINUITY_REVISION,
      selectedDateRevision: SELECTED_DATE_CONTINUITY_REVISION,
      completionLockRevision: V378_WHPP_COMPLETION_LOCK_REVISION,
      reportDate,
      reportDateSource: hintedDate ? 'VISIBLE_BROWSER_STATUS_HINT' : 'CANONICAL_FALLBACK',
      hintAgeMs: Number(selectedHint?.ageMs || 0),
      reason,
      ccslComplete: true,
      shopeeComplete: true,
      whppSnapshotStatus: afterStatus || 'PENDING',
      whppTotal: Number(afterRecovery?.total || 0),
      runtime: started
    }));
    return true;
  } catch (error) {
    if (error?.code !== 'WHPP_ALREADY_FINALIZED') console.warn('[CE-QC][V357_WHPP_BACKEND_CONTINUITY] skipped:', error?.message || error);
    return false;
  } finally {
    autoResumeBusy = false;
  }
}

function scheduleBackendContinuity(server) {
  if (autoResumeTimer) return;
  [1200, 3500, 8000].forEach(ms => {
    const timer = setTimeout(() => { void maybeAutoResumeWhpp(`server-ready-${ms}`); }, ms);
    timer.unref?.();
  });
  autoResumeTimer = setInterval(() => { void maybeAutoResumeWhpp('backend-watch'); }, AUTO_RESUME_POLL_MS);
  autoResumeTimer.unref?.();
  server?.once?.('close', () => {
    if (autoResumeTimer) clearInterval(autoResumeTimer);
    autoResumeTimer = null;
  });
}

function startHandler(mode) {
  return (req, res) => {
    try {
      if (runtimePromise && runtime.active) {
        return res.status(409).json({
          ok: false,
          code: 'WHPP_RUN_ALREADY_ACTIVE',
          error: 'WHPP当前任务正在后台运行，请勿重复启动。',
          runtime: publicRuntime(runtime)
        });
      }
      const started = launchWhpp(mode);
      return res.status(202).json({
        ok: true,
        accepted: true,
        patchId: PATCH_ID,
        backendContinuityRevision: BACKEND_CONTINUITY_REVISION,
        selectedDateContinuityRevision: SELECTED_DATE_CONTINUITY_REVISION,
        completionLockRevision: V378_WHPP_COMPLETION_LOCK_REVISION,
        reportDate: started.reportDate,
        processing: { running: true, phase: started.phase },
        runtime: started,
        message: 'WHPP任务已进入后台执行；页面可继续响应，进度由 /api/whpp/progress 查询。'
      });
    } catch (error) {
      if (error?.code === 'WHPP_ALREADY_FINALIZED') {
        return res.status(200).json({
          ok: true,
          accepted: false,
          completed: true,
          code: 'WHPP_ALREADY_FINALIZED',
          patchId: PATCH_ID,
          completionLockRevision: V378_WHPP_COMPLETION_LOCK_REVISION,
          reportDate: error.completionLock?.reportDate || '',
          snapshotStatus: error.completionLock?.snapshotStatus || 'COMPLETED',
          finalizedSnapshotId: error.completionLock?.finalizedSnapshotId || '',
          message: 'WHPP本土当前日报已经正式完成，本次重复启动已安全忽略。'
        });
      }
      const status = error?.code === 'WHPP_REPORT_MISSING' ? 400 : 500;
      return res.status(status).json({ ok: false, code: error?.code || 'WHPP_RUN_START_FAILED', error: error?.message || String(error) });
    }
  };
}

function progressHandler(req, res) {
  const state = loadWhppState();
  const runtimeActive = Boolean(runtimePromise && runtime.active && runtime.reportDate === state.reportDate);
  const persisted = { ...(state.processing || {}) };
  const stale = Boolean(persisted.running && !runtimeActive);
  let processing;
  if (runtimeActive) {
    processing = {
      ...persisted,
      running: true,
      paused: Boolean(persisted.paused),
      phase: runtime.lastMessage || runtime.phase || persisted.phase || 'WHPP处理中',
      batchIndex: Number(runtime.batchIndex || persisted.batchIndex || 0),
      totalBatches: Number(runtime.totalBatches || persisted.totalBatches || 0),
      heartbeatAt: runtime.heartbeatAt || persisted.lastCheckpointAt || ''
    };
  } else if (stale) {
    processing = {
      ...persisted,
      running: false,
      paused: false,
      phase: 'WHPP等待断点恢复',
      error: '检测到上次后台任务已中断，将从已保存断点继续。'
    };
  } else {
    processing = persisted;
  }
  res.json({
    ok: true,
    patchId: PATCH_ID,
    backendContinuityRevision: BACKEND_CONTINUITY_REVISION,
    selectedDateContinuityRevision: SELECTED_DATE_CONTINUITY_REVISION,
    completionLockRevision: V378_WHPP_COMPLETION_LOCK_REVISION,
    reportDate: state.reportDate,
    processing,
    runtimeActive,
    stale,
    runtime: publicRuntime(runtimeActive ? runtime : lastRuntime),
    requestTimeoutMs: WHPP_REQUEST_TIMEOUT_MS,
    backendContinuity: {
      enabled: true,
      pollMs: AUTO_RESUME_POLL_MS,
      cooldownMs: AUTO_RESUME_COOLDOWN_MS,
      busy: autoResumeBusy,
      lastAttemptAt: lastAutoResumeAt,
      lastKey: lastAutoResumeKey
    },
    completionLock: inspectV378WhppCompletionLock(state.reportDate, state),
    summary: state.lastRunSummary,
    log: (state.progressLog || []).slice(-50)
  });
}

const previousListen = express.application.listen;
let installed = false;
express.application.listen = function v134WhppRunSupervisorListen(...args) {
  if (!installed) {
    installed = true;
    this.get(PROGRESS_PATH, progressHandler);
    this.post('/api/whpp/run/start', startHandler('start'));
    this.post('/api/whpp/run/resume', startHandler('resume'));
  }
  const server = previousListen.apply(this, args);
  scheduleBackendContinuity(server);
  return server;
};

export function inspectV134WhppRuntime() {
  const state = loadWhppState();
  return {
    patchId: PATCH_ID,
    backendContinuityRevision: BACKEND_CONTINUITY_REVISION,
    selectedDateContinuityRevision: SELECTED_DATE_CONTINUITY_REVISION,
    completionLockRevision: V378_WHPP_COMPLETION_LOCK_REVISION,
    requestTimeoutMs: WHPP_REQUEST_TIMEOUT_MS,
    runtimeActive: Boolean(runtimePromise && runtime.active),
    runtime: publicRuntime(runtimePromise && runtime.active ? runtime : lastRuntime),
    completionLock: inspectV378WhppCompletionLock(state.reportDate, state),
    backendContinuity: {
      enabled: true,
      pollMs: AUTO_RESUME_POLL_MS,
      cooldownMs: AUTO_RESUME_COOLDOWN_MS,
      busy: autoResumeBusy,
      lastAttemptAt: lastAutoResumeAt,
      lastKey: lastAutoResumeKey
    }
  };
}
export { maybeAutoResumeWhpp as recoverV357PendingWhppFinalStage };
export const V134_WHPP_RUN_SUPERVISOR_PATCH_ID = PATCH_ID;
export const V357_WHPP_BACKEND_CONTINUITY_REVISION = BACKEND_CONTINUITY_REVISION;
export const V359_WHPP_SELECTED_DATE_CONTINUITY_REVISION = SELECTED_DATE_CONTINUITY_REVISION;
