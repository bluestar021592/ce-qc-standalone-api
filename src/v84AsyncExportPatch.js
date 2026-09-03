import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { getRuntimeConfig } from './db.js';

const PATCH_ID = '2026-08-17-v185-one-pass-stream-export-launch-v1';
const TRUTH_REUSE_ID = '2026-09-03-v419-export-reuse-persisted-truth-watermark-v1';
const EXPORT_CONTRACT_VERSION = 'ONE_WORKBOOK_PER_BUSINESS_V185_ONE_PASS_STREAM';
const PREPARE_PATH = '/api/export-period/prepare';
const STATUS_PATH = '/api/v84/export-job/:jobId';
const RECENT_REUSE_MS = Math.max(5 * 60_000, Number(process.env.EXPORT_RESULT_REUSE_MS || 30 * 60_000));
const MAX_JOB_SCAN = Math.max(20, Math.min(300, Number(process.env.EXPORT_JOB_SCAN_LIMIT || 100)));
const JOB_FILE_INDEX_CACHE_MS = Math.max(1000, Math.min(15_000, Number(process.env.EXPORT_JOB_FILE_INDEX_CACHE_MS || 5000)));
const JOB_READ_CACHE_MAX = Math.max(16, Math.min(256, Number(process.env.EXPORT_JOB_READ_CACHE_MAX || 64)));
const ALL_JOB_HEAP_MB = Math.max(256, Math.min(1024, Number(process.env.EXPORT_JOB_HEAP_MB || 512)));
const SINGLE_JOB_HEAP_MB = Math.max(384, Math.min(1024, Number(process.env.EXPORT_SINGLE_JOB_HEAP_MB || 768)));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerFile = path.join(__dirname, 'v84ExportJobWorker.js');
const singleWorkerFile = path.join(__dirname, 'v183SingleBusinessExportJobWorker.js');
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
function safeJobId(value) { const id = String(value || '').trim(); return /^EXP-[A-Z0-9-]{10,80}$/i.test(id) ? id : ''; }
function jobPath(jobId) { const safe = safeJobId(jobId); return safe ? path.join(jobsDir(), `${safe}.json`) : ''; }
function statSignature(stat = {}) { return `${Number(stat.size || 0)}|${Number(stat.mtimeMs || 0)}|${Number(stat.ctimeMs || 0)}`; }
function cacheJobRead(file, stat, job) {
  if (!file || !job) return job;
  jobReadCache.delete(file); jobReadCache.set(file, { signature: statSignature(stat), job });
  while (jobReadCache.size > JOB_READ_CACHE_MAX) { const first = jobReadCache.keys().next().value; if (first === undefined) break; jobReadCache.delete(first); }
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
  try { stat = fs.statSync(file); } catch { jobReadCache.delete(file); return null; }
  const signature = statSignature(stat);
  const hit = jobReadCache.get(file);
  if (hit?.signature === signature) { jobReadCache.delete(file); jobReadCache.set(file, hit); return hit.job; }
  try { return cacheJobRead(file, stat, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { jobReadCache.delete(file); return null; }
}
function readJob(jobId) { return readJobFile(jobPath(jobId)); }
function normalizePayload(body = {}) {
  const periodType = ['daily', 'weekly', 'monthly', 'custom'].includes(String(body.periodType || '')) ? String(body.periodType) : 'daily';
  const businessType = String(body.businessType || 'ALL').trim().toUpperCase() || 'ALL';
  return { periodType, date: String(body.date || '').slice(0, 10), fromDate: String(body.fromDate || '').slice(0, 10), toDate: String(body.toDate || '').slice(0, 10), businessType };
}
function persistedTruthWatermarkMs() {
  const dbFile = String(getRuntimeConfig().dbFile || '').trim();
  if (!dbFile) return 0;
  let watermark = 0;
  for (const file of [dbFile, `${dbFile}-wal`]) {
    try { watermark = Math.max(watermark, Number(fs.statSync(file).mtimeMs || 0)); } catch {}
  }
  return Math.floor(watermark);
}
function payloadKey(payload, truthWatermarkMs = persistedTruthWatermarkMs()) {
  return crypto.createHash('sha256').update(JSON.stringify({ ...payload, exportContractVersion: EXPORT_CONTRACT_VERSION, truthReuseId: TRUTH_REUSE_ID, truthWatermarkMs })).digest('hex');
}
function activeSlot(key, requester = '') { return `${String(key || '')}|${String(requester || '')}`; }
function rememberActive(job = {}) { if (job?.jobId && job?.payloadKey) activeJobs.set(activeSlot(job.payloadKey, job.requestedBy || ''), job.jobId); }
function forgetActive(job = {}) {
  if (!job?.payloadKey) return;
  const slot = activeSlot(job.payloadKey, job.requestedBy || '');
  if (!job.jobId || activeJobs.get(slot) === job.jobId) activeJobs.delete(slot);
}
function jobFilesExist(job = {}) {
  if (!Array.isArray(job.files) || !job.files.length) return false;
  const exportDir = getRuntimeConfig().exportsDir;
  return job.files.every(item => { const name = path.basename(String(item?.name || '')); return name && fs.existsSync(path.join(exportDir, name)); });
}
function recentJobFiles() {
  const now = Date.now();
  if (jobFileIndexCache.files.length && now - jobFileIndexCache.at < JOB_FILE_INDEX_CACHE_MS) return jobFileIndexCache.files;
  let files = [];
  try {
    files = fs.readdirSync(jobsDir(), { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => {
      const file = path.join(jobsDir(), entry.name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(file).mtimeMs; } catch {}
      return { file, mtimeMs };
    }).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_JOB_SCAN);
  } catch { files = []; }
  jobFileIndexCache = { at: now, files };
  return files;
}
function recentJobs() {
  const jobs = [];
  for (const item of recentJobFiles()) { const job = readJobFile(item.file); if (job) jobs.push(job); }
  return jobs;
}
function activeReusableJob(key, requester = '') {
  const id = activeJobs.get(activeSlot(key, requester));
  if (!id) return null;
  const job = readJob(id);
  if (!job || String(job.payloadKey || '') !== key || String(job.requestedBy || '') !== String(requester || '') || String(job.exportContractVersion || '') !== EXPORT_CONTRACT_VERSION || String(job.truthReuseId || '') !== TRUTH_REUSE_ID) { activeJobs.delete(activeSlot(key, requester)); return null; }
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
    if (String(job.exportContractVersion || '') !== EXPORT_CONTRACT_VERSION) continue;
    if (String(job.truthReuseId || '') !== TRUTH_REUSE_ID) continue;
    if (['QUEUED', 'RUNNING'].includes(String(job.status || ''))) { rememberActive(job); return { job, reused: 'ACTIVE' }; }
    if (String(job.status || '') === 'COMPLETED') {
      const completedAt = Date.parse(job.completedAt || job.updatedAt || '');
      if (Number.isFinite(completedAt) && now - completedAt <= RECENT_REUSE_MS && jobFilesExist(job)) return { job, reused: 'COMPLETED' };
    }
  }
  return null;
}
function validatePayload(payload, res) {
  if (payload.periodType === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.toDate)) { res.status(400).json({ ok: false, error: '请选择有效的开始日期和结束日期。' }); return false; }
    if (payload.fromDate > payload.toDate) { res.status(400).json({ ok: false, error: '开始日期不能晚于结束日期。' }); return false; }
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    res.status(400).json({ ok: false, error: '请选择有效的基准日期。' });
    return false;
  }
  return true;
}
function failWorkerJob(file, jobId, message, errorCode = 'EXPORT_WORKER_PROCESS_FAILED', detail = '') {
  try {
    const current = readJobFile(file);
    if (!current || String(current.jobId || '') !== String(jobId || '')) return;
    if (!['QUEUED', 'RUNNING'].includes(String(current.status || '').toUpperCase())) return;
    const now = new Date().toISOString();
    const next = { ...current, status: 'FAILED', errorCode, message, error: detail || message, failedAt: now, updatedAt: now, launcherPatchId: PATCH_ID };
    writeJsonAtomic(file, next);
    forgetActive(next);
    jobFileIndexCache = { at: 0, files: [] };
  } catch (error) {
    console.error('[CE-QC][V185_EXPORT] failed to persist worker failure:', error?.stack || error);
  }
}
function launchExportWorker(file, job) {
  let child;
  const singleBusiness = String(job?.payload?.businessType || 'ALL').toUpperCase() !== 'ALL';
  const selectedWorker = singleBusiness ? singleWorkerFile : workerFile;
  const heapMb = singleBusiness ? SINGLE_JOB_HEAP_MB : ALL_JOB_HEAP_MB;
  try {
    child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, selectedWorker, file], {
      cwd: getRuntimeConfig().projectRoot,
      env: { ...process.env, CE_QC_EXPORT_WORKER_MODE: singleBusiness ? 'SINGLE_BUSINESS_DIRECT' : 'ALL_BUSINESS_ORCHESTRATOR' },
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch (error) {
    failWorkerJob(file, job.jobId, `后台报表进程启动失败：${error?.message || String(error)}`, 'EXPORT_WORKER_SPAWN_FAILED', error?.stack || String(error));
    return null;
  }
  child.once('error', error => {
    console.error('[CE-QC][V185_EXPORT] worker spawn error:', error?.stack || error);
    failWorkerJob(file, job.jobId, `后台报表进程启动失败：${error?.message || String(error)}`, 'EXPORT_WORKER_SPAWN_FAILED', error?.stack || String(error));
  });
  child.once('exit', (code, signal) => {
    const current = readJobFile(file);
    if (!current || !['QUEUED', 'RUNNING'].includes(String(current.status || '').toUpperCase())) return;
    const reason = code === 0 ? '后台报表进程已结束，但任务没有写入完成状态。' : `后台报表进程异常退出（code=${code ?? 'null'}${signal ? `, signal=${signal}` : ''}）。`;
    failWorkerJob(file, job.jobId, `${reason} 请重新发起导出。`, 'EXPORT_WORKER_EXITED_EARLY', reason);
  });
  child.unref();
  return { child, singleBusiness, heapMb, selectedWorker };
}
function enqueueExport(req, res) {
  const payload = normalizePayload(req.body || {});
  if (!validatePayload(payload, res)) return;
  const truthWatermarkMs = persistedTruthWatermarkMs();
  const key = payloadKey(payload, truthWatermarkMs);
  const requester = req.user?.username || req.user?.email || '';
  const reusable = reusableJob(key, requester);
  if (reusable) {
    const job = reusable.job;
    const completed = reusable.reused === 'COMPLETED';
    return res.status(completed ? 200 : 202).json({
      ok: true, async: !completed, reused: reusable.reused, jobId: job.jobId, status: job.status,
      progress: Number(job.progress || 0), truthReuseId: TRUTH_REUSE_ID, truthWatermarkMs,
      message: completed ? '相同条件且数据未变化的完整报表已生成，直接复用现有文件' : '相同条件且数据未变化的完整报表正在后台执行，已复用当前任务',
      files: completed ? (job.files || []) : undefined,
      pollUrl: `/api/v84/export-job/${encodeURIComponent(job.jobId)}`
    });
  }
  const jobId = `EXP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const file = jobPath(jobId);
  const now = new Date().toISOString();
  const singleBusiness = payload.businessType !== 'ALL';
  const job = {
    version: PATCH_ID,
    truthReuseId: TRUTH_REUSE_ID,
    truthWatermarkMs,
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    jobId,
    payloadKey: key,
    status: 'QUEUED',
    progress: 0,
    message: singleBusiness ? 'V185单业务一次流式完整报表已进入全新独立后台进程' : 'V185 7业务完整报表任务已进入后台队列',
    payload,
    files: [],
    createdAt: now,
    updatedAt: now,
    requestedBy: requester,
    launcherHeapMB: singleBusiness ? SINGLE_JOB_HEAP_MB : ALL_JOB_HEAP_MB,
    workerMode: singleBusiness ? 'SINGLE_BUSINESS_DIRECT' : 'ALL_BUSINESS_ORCHESTRATOR'
  };
  writeJsonAtomic(file, job);
  rememberActive(job);
  jobFileIndexCache = { at: 0, files: [] };
  launchExportWorker(file, job);
  res.status(202).json({ ok: true, async: true, reused: false, jobId, status: job.status, progress: job.progress, message: job.message, pollUrl: `/api/v84/export-job/${encodeURIComponent(jobId)}`, workerMode: job.workerMode, exportContractVersion: EXPORT_CONTRACT_VERSION, truthReuseId: TRUTH_REUSE_ID, truthWatermarkMs });
}
function exportStatus(req, res) {
  const job = readJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: '导出任务不存在或已过期。' });
  if (['QUEUED', 'RUNNING'].includes(String(job.status || ''))) rememberActive(job); else forgetActive(job);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, ...job });
}
express.application.post = function v185AsyncExportRoute(...args) {
  if (args[0] !== PREPARE_PATH || args.length < 2) return originalPost.apply(this, args);
  if (!installed) {
    installed = true;
    originalPost.call(this, PREPARE_PATH, enqueueExport);
    originalGet.call(this, STATUS_PATH, exportStatus);
  }
  return this;
};
export function inspectV180ExportCaches() {
  return {
    activeJobs: activeJobs.size,
    fileIndexAgeMs: jobFileIndexCache.at ? Date.now() - jobFileIndexCache.at : null,
    fileCount: jobFileIndexCache.files.length,
    fileIndexTtlMs: JOB_FILE_INDEX_CACHE_MS,
    jobReadCache: jobReadCache.size,
    jobReadCacheMax: JOB_READ_CACHE_MAX,
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    truthReuseId: TRUTH_REUSE_ID,
    truthWatermarkMs: persistedTruthWatermarkMs(),
    allJobHeapMB: ALL_JOB_HEAP_MB,
    singleJobHeapMB: SINGLE_JOB_HEAP_MB,
    patchId: PATCH_ID
  };
}
export const V84_ASYNC_EXPORT_PATCH_ID = PATCH_ID;
export const V419_EXPORT_TRUTH_REUSE_ID = TRUTH_REUSE_ID;
