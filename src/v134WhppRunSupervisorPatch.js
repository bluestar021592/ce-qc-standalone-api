import express from 'express';
import { CEClient } from './ceClient.js';
import { runWhppPipeline } from './whppPipeline.js';
import { WHPP, loadWhppState, saveWhppState, finalizeWhppState } from './whppStore.js';

const PATCH_ID = '2026-08-14-v134-whpp-run-supervisor-v1';
const START_PATHS = new Set(['/api/whpp/run/start', '/api/whpp/run/resume']);
const PROGRESS_PATH = '/api/whpp/progress';
const WHPP_REQUEST_TIMEOUT_MS = Math.max(8_000, Math.min(45_000, Number(process.env.WHPP_REQUEST_TIMEOUT_MS || 20_000)));
const LOG_LIMIT = 120;

let runtimePromise = null;
let runtime = idleRuntime();
let lastRuntime = idleRuntime();

function nowIso() { return new Date().toISOString(); }
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
    const end = Number(scan[2] || 0);
    const total = Number(scan[3] || 0);
    return {
      phase: text,
      batchIndex: end,
      totalBatches: total,
      progressKind: 'SCAN_WAYBILLS'
    };
  }
  const batch = text.match(/(WHPP[^：]*查询)\s+(\d+)\/(\d+)/i);
  if (batch) {
    return {
      phase: text,
      batchIndex: Number(batch[2] || 0),
      totalBatches: Number(batch[3] || 0),
      progressKind: 'API_BATCHES'
    };
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
  const client = new CEClient();
  // WHPP uses a dedicated CEClient instance. Shortening only this instance prevents
  // one remote confirm-query from holding a 350-waybill batch for the global 45s
  // timeout before fallback/resume can make progress.
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
        const parsed = parseProgress(text);
        runtime = {
          ...runtime,
          ...parsed,
          active: true,
          lastMessage: text,
          heartbeatAt: nowIso()
        };
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
        reportDate: started.reportDate,
        processing: { running: true, phase: started.phase },
        runtime: started,
        message: 'WHPP任务已进入后台执行；页面可继续响应，进度由 /api/whpp/progress 查询。'
      });
    } catch (error) {
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
    // A persisted running=true can survive a backend restart. Expose it as not
    // running so V132 immediately calls resume instead of waiting five minutes for
    // a Promise that no longer exists.
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
    reportDate: state.reportDate,
    processing,
    runtimeActive,
    stale,
    runtime: publicRuntime(runtimeActive ? runtime : lastRuntime),
    requestTimeoutMs: WHPP_REQUEST_TIMEOUT_MS,
    summary: state.lastRunSummary,
    log: (state.progressLog || []).slice(-50)
  });
}

const previousListen = express.application.listen;
let installed = false;
express.application.listen = function v134WhppRunSupervisorListen(...args) {
  if (!installed) {
    installed = true;
    // Register before the V42 listen wrapper adds its legacy long-request routes;
    // Express uses the first matching handler, so these supervised routes win while
    // the legacy routes remain available as a compatibility fallback in source.
    this.get(PROGRESS_PATH, progressHandler);
    this.post('/api/whpp/run/start', startHandler('start'));
    this.post('/api/whpp/run/resume', startHandler('resume'));
  }
  return previousListen.apply(this, args);
};

export function inspectV134WhppRuntime() {
  return {
    patchId: PATCH_ID,
    requestTimeoutMs: WHPP_REQUEST_TIMEOUT_MS,
    runtimeActive: Boolean(runtimePromise && runtime.active),
    runtime: publicRuntime(runtimePromise && runtime.active ? runtime : lastRuntime)
  };
}
export const V134_WHPP_RUN_SUPERVISOR_PATCH_ID = PATCH_ID;
