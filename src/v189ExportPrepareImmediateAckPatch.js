import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { getRuntimeConfig } from './db.js';

const PATCH_ID = '2026-08-17-v189-export-prepare-immediate-ack-v1';
const EXPORT_CONTRACT_VERSION = 'ONE_WORKBOOK_PER_BUSINESS_V185_ONE_PASS_STREAM';
const PREPARE_PATH = '/api/export-period/prepare';
const STATUS_PATH = '/api/v84/export-job/:jobId';
const ALL_JOB_HEAP_MB = Math.max(256, Math.min(1024, Number(process.env.EXPORT_JOB_HEAP_MB || 512)));
const SINGLE_JOB_HEAP_MB = Math.max(384, Math.min(1024, Number(process.env.EXPORT_SINGLE_JOB_HEAP_MB || 768)));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allWorkerFile = path.join(__dirname, 'v84ExportJobWorker.js');
const singleWorkerFile = path.join(__dirname, 'v183SingleBusinessExportJobWorker.js');
const originalPost = express.application.post;
const originalGet = express.application.get;
const pendingJobs = new Map();
let installed = false;
let statusInstalled = false;

function runtimePaths() {
  const cfg = getRuntimeConfig();
  return { cfg, jobsDir: path.join(cfg.dataDir, 'export_jobs') };
}
function safeJobId(value) {
  const id = String(value || '').trim();
  return /^EXP-[A-Z0-9-]{10,80}$/i.test(id) ? id : '';
}
function jobFileFor(jobId) {
  const id = safeJobId(jobId);
  if (!id) return '';
  const { jobsDir } = runtimePaths();
  return path.join(jobsDir, `${id}.json`);
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
function payloadKey(payload) {
  return crypto.createHash('sha256').update(JSON.stringify({ ...payload, exportContractVersion: EXPORT_CONTRACT_VERSION })).digest('hex');
}
function publicPending(job) {
  return {
    ...job,
    status: String(job.status || 'QUEUED'),
    progress: Number(job.progress || 0),
    files: Array.isArray(job.files) ? job.files : [],
    statusPatchId: PATCH_ID
  };
}
async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.v189.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temp, file);
}
async function readJobAsync(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
}
async function markWorkerFailure(file, jobId, error, code = 'EXPORT_WORKER_PROCESS_FAILED') {
  try {
    const current = await readJobAsync(file) || pendingJobs.get(jobId)?.job;
    if (!current || String(current.jobId || '') !== String(jobId || '')) return;
    if (!['QUEUED', 'RUNNING'].includes(String(current.status || '').toUpperCase())) return;
    const now = new Date().toISOString();
    const failed = {
      ...current,
      status: 'FAILED',
      errorCode: code,
      message: `后台报表进程启动失败：${error?.message || String(error)}`,
      error: error?.stack || String(error),
      failedAt: now,
      updatedAt: now,
      immediateAckPatchId: PATCH_ID
    };
    pendingJobs.set(jobId, { job: failed, persisted: false, failed: true });
    try { await writeJsonAtomic(file, failed); } catch {}
  } catch (persistError) {
    console.error('[CE-QC][V189_EXPORT_ACK] failed to persist worker error:', persistError?.stack || persistError);
  }
}
function launchWorker(file, job) {
  const singleBusiness = String(job?.payload?.businessType || 'ALL').toUpperCase() !== 'ALL';
  const workerFile = singleBusiness ? singleWorkerFile : allWorkerFile;
  const heapMb = singleBusiness ? SINGLE_JOB_HEAP_MB : ALL_JOB_HEAP_MB;
  let child;
  try {
    child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, workerFile, file], {
      cwd: getRuntimeConfig().projectRoot,
      env: {
        ...process.env,
        CE_QC_EXPORT_WORKER_MODE: singleBusiness ? 'SINGLE_BUSINESS_DIRECT' : 'ALL_BUSINESS_ORCHESTRATOR',
        CE_QC_EXPORT_PREPARE_ACK_VERSION: PATCH_ID
      },
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch (error) {
    void markWorkerFailure(file, job.jobId, error, 'EXPORT_WORKER_SPAWN_FAILED');
    return;
  }
  child.once('error', error => { void markWorkerFailure(file, job.jobId, error, 'EXPORT_WORKER_SPAWN_FAILED'); });
  child.once('exit', (exitCode, signal) => {
    void (async () => {
      const current = await readJobAsync(file);
      if (!current || !['QUEUED', 'RUNNING'].includes(String(current.status || '').toUpperCase())) return;
      const reason = new Error(exitCode === 0
        ? '后台报表进程已结束，但任务没有写入完成状态。'
        : `后台报表进程异常退出（code=${exitCode ?? 'null'}${signal ? `, signal=${signal}` : ''}）。`);
      await markWorkerFailure(file, job.jobId, reason, 'EXPORT_WORKER_EXITED_EARLY');
    })();
  });
  child.unref();
}
async function persistAndLaunch(job) {
  const startedAt = Date.now();
  let file = '';
  try {
    const { jobsDir } = runtimePaths();
    await fsp.mkdir(jobsDir, { recursive: true });
    file = path.join(jobsDir, `${job.jobId}.json`);
    const persisted = {
      ...job,
      message: job.payload.businessType !== 'ALL'
        ? 'V189即时应答完成；任务已持久化，正在启动V185单业务独立后台进程'
        : 'V189即时应答完成；任务已持久化，正在启动7业务后台编排进程',
      persistedAt: new Date().toISOString(),
      persistMs: Date.now() - startedAt,
      updatedAt: new Date().toISOString()
    };
    await writeJsonAtomic(file, persisted);
    pendingJobs.set(job.jobId, { job: persisted, persisted: true, file });
    launchWorker(file, persisted);
  } catch (error) {
    const now = new Date().toISOString();
    const failed = {
      ...job,
      status: 'FAILED',
      errorCode: 'EXPORT_JOB_PERSIST_FAILED',
      message: `后台任务写入D盘失败：${error?.message || String(error)}`,
      error: error?.stack || String(error),
      failedAt: now,
      updatedAt: now,
      persistMs: Date.now() - startedAt,
      immediateAckPatchId: PATCH_ID
    };
    pendingJobs.set(job.jobId, { job: failed, persisted: false, failed: true, file });
    console.error('[CE-QC][V189_EXPORT_ACK] async persist failed:', error?.stack || error);
  }
}

async function immediateStatus(req, res) {
  const jobId = safeJobId(req.params?.jobId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-CE-QC-Export-Status', PATCH_ID);
  if (!jobId) return res.status(404).json({ ok: false, code: 'EXPORT_JOB_NOT_FOUND', error: '导出任务不存在或已过期。' });

  const pending = pendingJobs.get(jobId);
  if (pending && !pending.persisted) return res.json({ ok: true, ...publicPending(pending.job) });

  const file = pending?.file || jobFileFor(jobId);
  const diskJob = file ? await readJobAsync(file) : null;
  if (diskJob) {
    if (!['QUEUED', 'RUNNING'].includes(String(diskJob.status || '').toUpperCase())) pendingJobs.delete(jobId);
    return res.json({ ok: true, ...diskJob, statusPatchId: PATCH_ID });
  }
  if (pending?.job) return res.json({ ok: true, ...publicPending(pending.job) });
  return res.status(404).json({ ok: false, code: 'EXPORT_JOB_NOT_FOUND', error: '导出任务不存在或已过期。' });
}

function immediatePrepare(req, res) {
  const requestStartedAt = Date.now();
  const payload = normalizePayload(req.body || {});
  if (!validatePayload(payload, res)) return;

  const jobId = `EXP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const now = new Date().toISOString();
  const singleBusiness = payload.businessType !== 'ALL';
  const job = {
    version: PATCH_ID,
    immediateAckPatchId: PATCH_ID,
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    jobId,
    payloadKey: payloadKey(payload),
    status: 'QUEUED',
    progress: 0,
    message: singleBusiness
      ? 'V189即时应答：Job已在内存创建；正在异步写入任务文件，随后启动V185独立后台进程'
      : 'V189即时应答：Job已在内存创建；正在异步写入任务文件，随后启动7业务后台编排进程',
    payload,
    files: [],
    createdAt: now,
    updatedAt: now,
    requestedBy: req.user?.username || req.user?.email || '',
    launcherHeapMB: singleBusiness ? SINGLE_JOB_HEAP_MB : ALL_JOB_HEAP_MB,
    workerMode: singleBusiness ? 'SINGLE_BUSINESS_DIRECT' : 'ALL_BUSINESS_ORCHESTRATOR',
    prepareAckMode: 'MEMORY_ACK_THEN_ASYNC_PERSIST_THEN_SPAWN',
    prepareAckMs: Date.now() - requestStartedAt
  };

  pendingJobs.set(jobId, { job, persisted: false, file: '' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-CE-QC-Export-Prepare', PATCH_ID);
  res.status(202).json({
    ok: true,
    async: true,
    reused: false,
    jobId,
    status: 'QUEUED',
    progress: 0,
    message: job.message,
    pollUrl: `/api/v84/export-job/${encodeURIComponent(jobId)}`,
    workerMode: job.workerMode,
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    prepareAckMode: job.prepareAckMode,
    prepareAckMs: job.prepareAckMs,
    patchId: PATCH_ID
  });

  void persistAndLaunch(job);
}

express.application.post = function v189ExportPrepareImmediateAckRegistration(pathValue, ...handlers) {
  if (String(pathValue || '') === PREPARE_PATH) {
    if (!installed) {
      installed = true;
      this.route(PREPARE_PATH).post(immediatePrepare);
      if (!statusInstalled) {
        statusInstalled = true;
        originalGet.call(this, STATUS_PATH, immediateStatus);
      }
    }
    return this;
  }
  return originalPost.call(this, pathValue, ...handlers);
};

export function inspectV189ExportPrepareImmediateAck() {
  return {
    patchId: PATCH_ID,
    preparePath: PREPARE_PATH,
    statusPath: STATUS_PATH,
    installed,
    statusInstalled,
    pendingJobs: pendingJobs.size,
    mode: 'MEMORY_ACK_THEN_ASYNC_PERSIST_THEN_SPAWN',
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    singleJobHeapMB: SINGLE_JOB_HEAP_MB,
    allJobHeapMB: ALL_JOB_HEAP_MB
  };
}
export const V189_EXPORT_PREPARE_IMMEDIATE_ACK_ID = PATCH_ID;
