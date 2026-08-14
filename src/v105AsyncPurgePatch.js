import crypto from 'node:crypto';
import express from 'express';
import { resealPurgeChallenge } from './dataPurge.js';

const PATCH_ID = '2026-08-14-v128-purge-submit-flush-v1';
const PREPARE_PATH = '/api/admin/data-purge/prepare';
const EXECUTE_PATH = '/api/admin/data-purge/execute';
const PREPARE_STATUS_PATH = '/api/v105/data-purge/prepare/:jobId';
const EXECUTE_STATUS_PATH = '/api/v105/data-purge/execute/:jobId';
const ACTIVE_STATUS_PATH = '/api/v105/data-purge/active';
const JOB_TTL_MS = 30 * 60 * 1000;
const JOB_START_DELAY_MS = Math.max(100, Math.min(2000, Number(process.env.PURGE_JOB_START_DELAY_MS || 350)));
const jobs = new Map();

function ownerKey(user = {}) {
  return String(user.id || user.email || user.username || '').trim().toLowerCase();
}

function pollUrlFor(job) {
  const base = job.kind === 'EXECUTE' ? '/api/v105/data-purge/execute/' : '/api/v105/data-purge/prepare/';
  return `${base}${encodeURIComponent(job.jobId)}`;
}

function publicJob(job) {
  const elapsedMs = Math.max(0, Date.now() - Number(job.startedAtMs || job.createdAtMs || Date.now()));
  return {
    ok: true,
    patchId: PATCH_ID,
    async: true,
    kind: job.kind,
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    elapsedMs,
    createdAt: job.createdAt,
    startedAt: job.startedAt || '',
    completedAt: job.completedAt || '',
    pollUrl: pollUrlFor(job),
    result: job.status === 'COMPLETED' ? job.result : undefined,
    error: job.status === 'FAILED' ? job.error : undefined
  };
}

function pruneJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    const stamp = Number(job.completedAtMs || job.createdAtMs || 0);
    if (stamp && stamp < cutoff) jobs.delete(id);
  }
}

function activeJobFor(owner, kind) {
  if (!owner) return null;
  pruneJobs();
  for (const job of jobs.values()) {
    if (job.owner === owner && job.kind === kind && ['QUEUED', 'RUNNING'].includes(String(job.status || ''))) return job;
  }
  return null;
}

function fakeResponse(resolve, reject) {
  let statusCode = 200;
  const headers = new Map();
  const response = {
    headersSent: false,
    status(code) { statusCode = Number(code || 500); return response; },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); return response; },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    json(payload) {
      response.headersSent = true;
      if (statusCode >= 400 || payload?.ok === false) {
        const error = new Error(payload?.error || payload?.message || `HTTP ${statusCode}`);
        error.status = statusCode;
        error.payload = payload;
        reject(error);
      } else resolve(payload);
      return response;
    },
    send(payload) { return response.json(payload); },
    end(payload) { return response.json(payload ? { ok: statusCode < 400, payload } : { ok: statusCode < 400 }); }
  };
  return response;
}

function runLegacyHandler(handler, req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = value => { if (!settled) { settled = true; resolve(value); } };
    const finishReject = error => { if (!settled) { settled = true; reject(error); } };
    const res = fakeResponse(finishResolve, finishReject);
    const next = error => error ? finishReject(error) : finishReject(new Error('Legacy purge handler completed without a response.'));
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') result.catch(finishReject);
    } catch (error) { finishReject(error); }
  });
}

function startJob(req, legacyHandler, kind) {
  pruneJobs();
  const owner = ownerKey(req.user);
  const existing = activeJobFor(owner, kind);
  if (existing) return { job: existing, reused: true };

  const prefix = kind === 'EXECUTE' ? 'PURGE-EXEC' : 'PURGE-PREP';
  const jobId = `${prefix}-${crypto.randomUUID().toUpperCase()}`;
  const now = Date.now();
  const job = {
    kind,
    jobId,
    owner,
    status: 'QUEUED',
    progress: 1,
    message: kind === 'EXECUTE' ? '安全清空任务已进入后台队列' : '清空前安全备份任务已进入后台队列',
    createdAtMs: now,
    createdAt: new Date(now).toISOString(),
    startedAtMs: 0,
    result: null,
    error: ''
  };
  jobs.set(jobId, job);

  // Do not start destructive synchronous SQLite work in the same event-loop turn
  // that is sending the HTTP 202 response. A short timer guarantees the browser
  // receives jobId/pollUrl before the fast delete transaction begins.
  const timer = setTimeout(async () => {
    job.status = 'RUNNING';
    job.progress = kind === 'EXECUTE' ? 12 : 8;
    job.message = kind === 'EXECUTE'
      ? '正在后台快速清空业务数据；账号、设置、白名单和安全备份不会删除'
      : '正在后台创建 SQLite 在线安全备份；页面可继续响应';
    job.startedAtMs = Date.now();
    job.startedAt = new Date(job.startedAtMs).toISOString();
    try {
      const result = await runLegacyHandler(legacyHandler, req);
      if (kind === 'PREPARE' && result?.challengeId) resealPurgeChallenge(result.challengeId, req.user);
      job.status = 'COMPLETED';
      job.progress = 100;
      job.message = kind === 'EXECUTE' ? '业务数据已安全清空' : '清空前备份和完整性校验已完成';
      job.result = result;
      job.completedAtMs = Date.now();
      job.completedAt = new Date(job.completedAtMs).toISOString();
    } catch (error) {
      job.status = 'FAILED';
      job.progress = 100;
      job.message = kind === 'EXECUTE'
        ? '安全清空失败；系统没有自动重复执行删除'
        : '清空前安全备份失败，未删除任何业务数据';
      job.error = error?.message || String(error);
      job.completedAtMs = Date.now();
      job.completedAt = new Date(job.completedAtMs).toISOString();
    }
  }, JOB_START_DELAY_MS);
  timer.unref?.();
  return { job, reused: false };
}

function statusHandler(expectedKind) {
  return function v128PurgeStatus(req, res) {
    pruneJobs();
    const job = jobs.get(String(req.params.jobId || ''));
    if (!job || job.kind !== expectedKind) return res.status(404).json({ ok: false, patchId: PATCH_ID, error: '清空任务不存在或已过期。' });
    if (!job.owner || job.owner !== ownerKey(req.user) || String(req.user?.role || '').toUpperCase() !== 'ADMIN') {
      return res.status(403).json({ ok: false, patchId: PATCH_ID, error: '无权读取该清空任务。' });
    }
    if (job.status === 'RUNNING') {
      const seconds = Math.floor((Date.now() - job.startedAtMs) / 1000);
      const base = expectedKind === 'EXECUTE' ? 12 : 8;
      job.progress = Math.min(94, base + Math.floor(seconds / (expectedKind === 'EXECUTE' ? 1 : 2)));
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json(publicJob(job));
  };
}

function activeStatusHandler(req, res) {
  if (String(req.user?.role || '').toUpperCase() !== 'ADMIN') return res.status(403).json({ ok: false, patchId: PATCH_ID, error: '无权读取清空任务。' });
  const kind = String(req.query?.kind || 'EXECUTE').toUpperCase() === 'PREPARE' ? 'PREPARE' : 'EXECUTE';
  const job = activeJobFor(ownerKey(req.user), kind);
  res.setHeader('Cache-Control', 'no-store');
  if (!job) return res.status(404).json({ ok: false, patchId: PATCH_ID, error: '当前没有正在运行的清空任务。' });
  return res.json(publicJob(job));
}

const originalPost = express.application.post;
const originalGet = express.application.get;
let statusInstalled = false;

function installStatusRoutes(app) {
  if (statusInstalled) return;
  statusInstalled = true;
  originalGet.call(app, PREPARE_STATUS_PATH, statusHandler('PREPARE'));
  originalGet.call(app, EXECUTE_STATUS_PATH, statusHandler('EXECUTE'));
  originalGet.call(app, ACTIVE_STATUS_PATH, activeStatusHandler);
}

express.application.post = function v128AsyncPurgePost(pathValue, ...handlers) {
  if (![PREPARE_PATH, EXECUTE_PATH].includes(pathValue) || !handlers.length) return originalPost.call(this, pathValue, ...handlers);
  const legacyHandler = handlers[handlers.length - 1];
  if (typeof legacyHandler !== 'function') return originalPost.call(this, pathValue, ...handlers);
  installStatusRoutes(this);
  const preserved = handlers.slice(0, -1);
  const kind = pathValue === EXECUTE_PATH ? 'EXECUTE' : 'PREPARE';
  const enqueue = function v128PurgeJobEnqueue(req, res) {
    const started = startJob(req, legacyHandler, kind);
    const job = started.job;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(202).json({
      ok: true,
      patchId: PATCH_ID,
      async: true,
      reused: started.reused ? 'ACTIVE' : false,
      kind,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: started.reused ? '相同清空阶段正在后台执行，已复用当前任务' : job.message,
      pollUrl: pollUrlFor(job)
    });
  };
  return originalPost.call(this, pathValue, ...preserved, enqueue);
};

export function inspectV128PurgeJobs(){
  const active=[...jobs.values()].filter(job=>['QUEUED','RUNNING'].includes(String(job.status||'')));
  return {total:jobs.size,active:active.length,startDelayMs:JOB_START_DELAY_MS,byKind:{PREPARE:active.filter(job=>job.kind==='PREPARE').length,EXECUTE:active.filter(job=>job.kind==='EXECUTE').length}};
}
export const V105_ASYNC_PURGE_PATCH_ID = PATCH_ID;
