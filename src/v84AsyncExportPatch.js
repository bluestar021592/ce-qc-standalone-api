import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { getRuntimeConfig } from './db.js';

const PATCH_ID = '2026-08-14-v121-export-job-read-cache-v1';
const PREPARE_PATH = '/api/export-period/prepare';
const STATUS_PATH = '/api/v84/export-job/:jobId';
const RECENT_REUSE_MS = Math.max(5 * 60_000, Number(process.env.EXPORT_RESULT_REUSE_MS || 30 * 60_000));
const MAX_JOB_SCAN = Math.max(20, Math.min(300, Number(process.env.EXPORT_JOB_SCAN_LIMIT || 100)));
const JOB_FILE_INDEX_CACHE_MS = Math.max(1000, Math.min(15_000, Number(process.env.EXPORT_JOB_FILE_INDEX_CACHE_MS || 5000)));
const JOB_READ_CACHE_MAX = Math.max(16, Math.min(256, Number(process.env.EXPORT_JOB_READ_CACHE_MAX || 64)));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerFile = path.join(__dirname, 'v84ExportJobWorker.js');
const originalPost = express.application.post;
const originalGet = express.application.get;
let installed = false;
let jobFileIndexCache = { at: 0, files: [] };
const activeJobs = new Map();
const jobReadCache = new Map();

function jobsDir() {
  const dir = path.join(getRuntimeConfig().dataDir, 'export_jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeJobId(value) {
  const id = String(value || '').trim();
  return /^EXP-[A-Z0-9-]{10,80}$/i.test(id) ? id : '';
}

function jobPath(jobId) {
  const safe = safeJobId(jobId);
  if (!safe) return '';
  return path.join(jobsDir(), `${safe}.json`);
}

function statSignature(stat = {}) {
  return `${Number(stat.size || 0)}|${Number(stat.mtimeMs || 0)}|${Number(stat.ctimeMs || 0)}`;
}

function cacheJobRead(file, stat, job) {
  if (!file || !job) return job;
  jobReadCache.delete(file);
  jobReadCache.set(file, { signature: statSignature(stat), job });
  while (jobReadCache.size > JOB_READ_CACHE_MAX) {
    const first = jobReadCache.keys().next().value;
    if (first === undefined) break;
    jobReadCache.delete(first);
  }
  return job;
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
  try { cacheJobRead(file, fs.statSync(file), value); } catch { jobReadCache.delete(file); }
}

function readJobFile(file) {
  if (!file) return null;
  let stat;
  try { stat = fs.statSync(file); }
  catch { jobReadCache.delete(file); return null; }
  const signature = statSignature(stat);
  const hit = jobReadCache.get(file);
  if (hit?.signature === signature) {
    jobReadCache.delete(file);
    jobReadCache.set(file, hit);
    return hit.job;
  }
  try { return cacheJobRead(file, stat, JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { jobReadCache.delete(file); return null; }
}

function readJob(jobId) {
  return readJobFile(jobPath(jobId));
}

function normalizePayload(body = {}) {
  const periodType = ['daily', 'weekly', 'monthly', 'custom'].includes(String(body.periodType || '')) ? String(body.periodType) : 'daily';
  const businessType = String(body.businessType || 'ALL').trim().toUpperCase() || 'ALL';
  return {
    periodType,
    date: String(body.date || '').slice(0, 10),
    fromDate: String(body.fromDate || '').slice(0, 10),
    toDate: String(body.toDate || '').slice(0, 10),
    businessType
  };
}

function payloadKey(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function activeSlot(key, requester = '') {
  return `${String(key || '')}|${String(requester || '')}`;
}

function rememberActive(job = {}) {
  if (!job?.jobId || !job?.payloadKey) return;
  activeJobs.set(activeSlot(job.payloadKey, job.requestedBy || ''), job.jobId);
}

function forgetActive(job = {}) {
  if (!job?.payloadKey) return;
  const slot = activeSlot(job.payloadKey, job.requestedBy || '');
  if (!job.jobId || activeJobs.get(slot) === job.jobId) activeJobs.delete(slot);
}

function jobFilesExist(job = {}) {
  if (!Array.isArray(job.files) || !job.files.length) return false;
  const exportDir = getRuntimeConfig().exportsDir;
  return job.files.every(item => {
    const name = path.basename(String(item?.name || ''));
    return name && fs.existsSync(path.join(exportDir, name));
  });
}

function recentJobFiles() {
  const now = Date.now();
  if (jobFileIndexCache.files.length && now - jobFileIndexCache.at < JOB_FILE_INDEX_CACHE_MS) return jobFileIndexCache.files;
  let files = [];
  try {
    files = fs.readdirSync(jobsDir(), { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => {
        const file = path.join(jobsDir(), entry.name);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(file).mtimeMs; } catch {}
        return { file, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_JOB_SCAN);
  } catch { files = []; }
  jobFileIndexCache = { at: now, files };
  return files;
}

function recentJobs() {
  const jobs = [];
  for (const item of recentJobFiles()) {
    const job = readJobFile(item.file);
    if (job) jobs.push(job);
  }
  return jobs;
}

function activeReusableJob(key, requester = '') {
  const id = activeJobs.get(activeSlot(key, requester));
  if (!id) return null;
  const job = readJob(id);
  if (!job || String(job.payloadKey || '') !== key || String(job.requestedBy || '') !== String(requester || '')) {
    activeJobs.delete(activeSlot(key, requester));
    return null;
  }
  if (['QUEUED', 'RUNNING'].includes(String(job.status || ''))) return { job, reused: 'ACTIVE' };
  forgetActive(job);
  return null;
}

function reusableJob(key, requester = '') {
  const active = activeReusableJob(key, requester);
  if (active) return active;
  const now = Date.now();
  for (const job of recentJobs()) {
    if (String(job.payloadKey || '') !== key) continue;
    if (requester && job.requestedBy && String(job.requestedBy) !== requester) continue;
    if (['QUEUED', 'RUNNING'].includes(String(job.status || ''))) {
      rememberActive(job);
      return { job, reused: 'ACTIVE' };
    }
    if (String(job.status || '') === 'COMPLETED') {
      const completedAt = Date.parse(job.completedAt || job.updatedAt || '');
      if (Number.isFinite(completedAt) && now - completedAt <= RECENT_REUSE_MS && jobFilesExist(job)) {
        return { job, reused: 'COMPLETED' };
      }
    }
  }
  return null;
}

function validatePayload(payload, res) {
  if (payload.periodType === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.toDate)) {
      res.status(400).json({ ok: false, error: '请选择有效的开始日期和结束日期。' });
      return false;
    }
    if (payload.fromDate > payload.toDate) {
      res.status(400).json({ ok: false, error: '开始日期不能晚于结束日期。' });
      return false;
    }
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    res.status(400).json({ ok: false, error: '请选择有效的基准日期。' });
    return false;
  }
  return true;
}

function enqueueExport(req, res) {
  const payload = normalizePayload(req.body || {});
  if (!validatePayload(payload, res)) return;
  const key = payloadKey(payload);
  const requester = req.user?.username || req.user?.email || '';
  const reusable = reusableJob(key, requester);
  if (reusable) {
    const job = reusable.job;
    const completed = reusable.reused === 'COMPLETED';
    return res.status(completed ? 200 : 202).json({
      ok: true,
      async: !completed,
      reused: reusable.reused,
      jobId: job.jobId,
      status: job.status,
      progress: Number(job.progress || 0),
      message: completed ? '相同条件报表已生成，直接复用现有文件' : '相同条件导出正在后台执行，已复用现有任务',
      files: completed ? (job.files || []) : undefined,
      pollUrl: `/api/v84/export-job/${encodeURIComponent(job.jobId)}`
    });
  }

  const jobId = `EXP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const file = jobPath(jobId);
  const now = new Date().toISOString();
  const job = {
    version: PATCH_ID,
    jobId,
    payloadKey: key,
    status: 'QUEUED',
    progress: 0,
    message: '导出任务已进入后台队列',
    payload,
    files: [],
    createdAt: now,
    updatedAt: now,
    requestedBy: requester
  };
  writeJsonAtomic(file, job);
  rememberActive(job);
  jobFileIndexCache = { at: 0, files: [] };

  const child = spawn(process.execPath, ['--max-old-space-size=1536', workerFile, file], {
    cwd: getRuntimeConfig().projectRoot,
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child.unref();

  res.status(202).json({
    ok: true,
    async: true,
    reused: false,
    jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    pollUrl: `/api/v84/export-job/${encodeURIComponent(jobId)}`
  });
}

function exportStatus(req, res) {
  const job = readJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: '导出任务不存在或已过期。' });
  if (['QUEUED', 'RUNNING'].includes(String(job.status || ''))) rememberActive(job);
  else forgetActive(job);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, ...job });
}

express.application.post = function v84AsyncExportRoute(...args) {
  if (args[0] !== PREPARE_PATH || args.length < 2) return originalPost.apply(this, args);
  if (!installed) {
    installed = true;
    originalPost.call(this, PREPARE_PATH, enqueueExport);
    originalGet.call(this, STATUS_PATH, exportStatus);
  }
  return this;
};

export function inspectV121ExportCaches(){return {activeJobs:activeJobs.size,fileIndexAgeMs:jobFileIndexCache.at?Date.now()-jobFileIndexCache.at:null,fileCount:jobFileIndexCache.files.length,fileIndexTtlMs:JOB_FILE_INDEX_CACHE_MS,jobReadCache:jobReadCache.size,jobReadCacheMax:JOB_READ_CACHE_MAX};}
export const V84_ASYNC_EXPORT_PATCH_ID = PATCH_ID;
