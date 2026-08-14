import crypto from 'node:crypto';
import express from 'express';

const PATCH_ID = '2026-08-14-v105-async-purge-prepare-v1';
const PREPARE_PATH = '/api/admin/data-purge/prepare';
const STATUS_PATH = '/api/v105/data-purge/prepare/:jobId';
const JOB_TTL_MS = 30 * 60 * 1000;
const jobs = new Map();

function ownerKey(user = {}) {
  return String(user.id || user.email || user.username || '').trim().toLowerCase();
}

function publicJob(job) {
  const elapsedMs = Math.max(0, Date.now() - Number(job.startedAtMs || job.createdAtMs || Date.now()));
  return {
    ok: true,
    patchId: PATCH_ID,
    async: true,
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    elapsedMs,
    createdAt: job.createdAt,
    startedAt: job.startedAt || '',
    completedAt: job.completedAt || '',
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

function runLegacyPrepare(handler, req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = value => { if (!settled) { settled = true; resolve(value); } };
    const finishReject = error => { if (!settled) { settled = true; reject(error); } };
    const res = fakeResponse(finishResolve, finishReject);
    const next = error => error ? finishReject(error) : finishReject(new Error('Legacy purge prepare completed without a response.'));
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') result.catch(finishReject);
    } catch (error) { finishReject(error); }
  });
}

function startJob(req, legacyHandler) {
  pruneJobs();
  const jobId = `PURGE-PREP-${crypto.randomUUID().toUpperCase()}`;
  const now = Date.now();
  const job = {
    jobId,
    owner: ownerKey(req.user),
    status: 'QUEUED',
    progress: 1,
    message: '清空前安全备份任务已进入后台队列',
    createdAtMs: now,
    createdAt: new Date(now).toISOString(),
    startedAtMs: 0,
    result: null,
    error: ''
  };
  jobs.set(jobId, job);

  setImmediate(async () => {
    job.status = 'RUNNING';
    job.progress = 8;
    job.message = '正在后台创建 SQLite 在线安全备份；页面可继续响应';
    job.startedAtMs = Date.now();
    job.startedAt = new Date(job.startedAtMs).toISOString();
    try {
      const result = await runLegacyPrepare(legacyHandler, req);
      job.status = 'COMPLETED';
      job.progress = 100;
      job.message = '清空前备份和完整性校验已完成';
      job.result = result;
      job.completedAtMs = Date.now();
      job.completedAt = new Date(job.completedAtMs).toISOString();
    } catch (error) {
      job.status = 'FAILED';
      job.progress = 100;
      job.message = '清空前安全备份失败，未删除任何业务数据';
      job.error = error?.message || String(error);
      job.completedAtMs = Date.now();
      job.completedAt = new Date(job.completedAtMs).toISOString();
    }
  });
  return job;
}

function statusHandler(req, res) {
  pruneJobs();
  const job = jobs.get(String(req.params.jobId || ''));
  if (!job) return res.status(404).json({ ok: false, patchId: PATCH_ID, error: '清空前备份任务不存在或已过期。' });
  if (!job.owner || job.owner !== ownerKey(req.user) || String(req.user?.role || '').toUpperCase() !== 'ADMIN') {
    return res.status(403).json({ ok: false, patchId: PATCH_ID, error: '无权读取该清空任务。' });
  }
  if (job.status === 'RUNNING') {
    const seconds = Math.floor((Date.now() - job.startedAtMs) / 1000);
    job.progress = Math.min(92, 8 + Math.floor(seconds / 2));
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.json(publicJob(job));
}

const originalPost = express.application.post;
const originalGet = express.application.get;
let statusInstalled = false;

express.application.post = function v105AsyncPurgePost(pathValue, ...handlers) {
  if (pathValue !== PREPARE_PATH || !handlers.length) return originalPost.call(this, pathValue, ...handlers);
  const legacyHandler = handlers[handlers.length - 1];
  if (typeof legacyHandler !== 'function') return originalPost.call(this, pathValue, ...handlers);
  if (!statusInstalled) {
    statusInstalled = true;
    originalGet.call(this, STATUS_PATH, statusHandler);
  }
  const preserved = handlers.slice(0, -1);
  const enqueue = function v105PurgePrepareEnqueue(req, res) {
    const job = startJob(req, legacyHandler);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(202).json({
      ok: true,
      patchId: PATCH_ID,
      async: true,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      message: job.message,
      pollUrl: `/api/v105/data-purge/prepare/${encodeURIComponent(job.jobId)}`
    });
  };
  return originalPost.call(this, pathValue, ...preserved, enqueue);
};

export const V105_ASYNC_PURGE_PATCH_ID = PATCH_ID;
