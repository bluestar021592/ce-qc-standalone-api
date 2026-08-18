import express from 'express';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { getRuntimeConfig } from './db.js';

const PATCH_ID = '2026-08-18-v192-direct-export-early-route-v1';
const EXPORT_CONTRACT_VERSION = 'ONE_WORKBOOK_PER_BUSINESS_V185_ONE_PASS_STREAM';
const LEGACY_PREPARE_PATH = '/api/export-period/prepare';
const PREPARE_PATH = '/api/v190/export-period/prepare';
const STATUS_PATH = '/api/v190/export-job/:jobId';
const PING_PATH = '/api/v190/export-ping';
const SINGLE_JOB_HEAP_MB = Math.max(384, Math.min(1024, Number(process.env.EXPORT_SINGLE_JOB_HEAP_MB || 768)));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const singleWorkerFile = path.join(__dirname, 'v183SingleBusinessExportJobWorker.js');
const previousPost = express.application.post;
const previousUse = express.application.use;
const pendingJobs = new Map();
let routesInjected = false;

function runtimePaths() {
  const cfg = getRuntimeConfig();
  return { cfg, jobsDir: path.join(cfg.dataDir, 'export_jobs') };
}
function safeJobId(value) {
  const id = String(value || '').trim();
  return /^EXP-[A-Z0-9-]{10,80}$/i.test(id) ? id : '';
}
function normalizePayload(body = {}) {
  const periodType = ['daily', 'weekly', 'monthly', 'custom'].includes(String(body.periodType || '')) ? String(body.periodType) : 'daily';
  return {
    periodType,
    date: String(body.date || '').slice(0, 10),
    fromDate: String(body.fromDate || '').slice(0, 10),
    toDate: String(body.toDate || '').slice(0, 10),
    businessType: String(body.businessType || '').trim().toUpperCase()
  };
}
function validatePayload(payload, res) {
  if (!payload.businessType || payload.businessType === 'ALL') {
    res.status(400).json({ ok: false, code: 'V190_SINGLE_BUSINESS_ONLY', error: 'V190直连导出仅用于单业务完整表。' });
    return false;
  }
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
function publicPending(job = {}) {
  return {
    ...job,
    status: String(job.status || 'QUEUED'),
    progress: Number(job.progress || 0),
    files: Array.isArray(job.files) ? job.files : [],
    directEndpointPatchId: PATCH_ID
  };
}
async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.v192.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temp, file);
}
async function readJobAsync(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
}
async function markWorkerFailure(file, jobId, error, code = 'EXPORT_WORKER_PROCESS_FAILED') {
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
    directEndpointPatchId: PATCH_ID
  };
  pendingJobs.set(jobId, { job: failed, persisted: false, failed: true, file });
  try { await writeJsonAtomic(file, failed); } catch {}
}
function launchWorker(file, job) {
  let child;
  try {
    child = spawn(process.execPath, [`--max-old-space-size=${SINGLE_JOB_HEAP_MB}`, singleWorkerFile, file], {
      cwd: getRuntimeConfig().projectRoot,
      env: {
        ...process.env,
        CE_QC_EXPORT_WORKER_MODE: 'SINGLE_BUSINESS_DIRECT',
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
      message: 'V192直连Job已确认；任务文件已持久化，正在启动V191单业务真实状态后台进程',
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
      directEndpointPatchId: PATCH_ID
    };
    pendingJobs.set(job.jobId, { job: failed, persisted: false, failed: true, file });
    console.error('[CE-QC][V192_EXPORT_DIRECT] async persist failed:', error?.stack || error);
  }
}

function directPrepare(req, res) {
  const requestStartedAt = Date.now();
  const payload = normalizePayload(req.body || {});
  console.log(`[CE-QC][V192_EXPORT_DIRECT] PREPARE enter business=${payload.businessType || '-'} period=${payload.periodType}`);
  if (!validatePayload(payload, res)) return;

  const jobId = `EXP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const now = new Date().toISOString();
  const job = {
    version: PATCH_ID,
    directEndpointPatchId: PATCH_ID,
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    jobId,
    payloadKey: payloadKey(payload),
    status: 'QUEUED',
    progress: 0,
    message: 'V192直连即时应答：Job已在内存创建；正在异步持久化并启动V191真实状态导出',
    payload,
    files: [],
    createdAt: now,
    updatedAt: now,
    requestedBy: req.user?.username || req.user?.email || '',
    launcherHeapMB: SINGLE_JOB_HEAP_MB,
    workerMode: 'SINGLE_BUSINESS_DIRECT',
    prepareAckMode: 'V192_DIRECT_ROUTE_MEMORY_ACK'
  };

  pendingJobs.set(jobId, { job, persisted: false, file: '' });
  const ackMs = Date.now() - requestStartedAt;
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
    pollUrl: `/api/v190/export-job/${encodeURIComponent(jobId)}`,
    workerMode: job.workerMode,
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    prepareAckMode: job.prepareAckMode,
    prepareAckMs: ackMs,
    patchId: PATCH_ID
  });
  console.log(`[CE-QC][V192_EXPORT_DIRECT] ACK job=${jobId} ${ackMs}ms`);
  void persistAndLaunch(job);
}

async function directStatus(req, res) {
  const jobId = safeJobId(req.params?.jobId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-CE-QC-Export-Status', PATCH_ID);
  if (!jobId) return res.status(404).json({ ok: false, code: 'EXPORT_JOB_NOT_FOUND', error: '导出任务不存在或已过期。' });

  const pending = pendingJobs.get(jobId);
  if (pending && !pending.persisted) return res.json({ ok: true, ...publicPending(pending.job) });
  const file = pending?.file || path.join(runtimePaths().jobsDir, `${jobId}.json`);
  const diskJob = await readJobAsync(file);
  if (diskJob) {
    if (!['QUEUED', 'RUNNING'].includes(String(diskJob.status || '').toUpperCase())) pendingJobs.delete(jobId);
    return res.json({ ok: true, ...diskJob, directEndpointPatchId: PATCH_ID });
  }
  if (pending?.job) return res.json({ ok: true, ...publicPending(pending.job) });
  return res.status(404).json({ ok: false, code: 'EXPORT_JOB_NOT_FOUND', error: '导出任务不存在或已过期。' });
}
function directPing(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, patchId: PATCH_ID, time: new Date().toISOString(), pendingJobs: pendingJobs.size, routesInjected });
}
function injectDirectRoutes(app) {
  if (routesInjected) return;
  routesInjected = true;
  app.route(PREPARE_PATH).post(directPrepare);
  app.route(STATUS_PATH).get(directStatus);
  app.route(PING_PATH).get(directPing);
  console.log(`[CE-QC][V192_EXPORT_DIRECT] routes injected early: ${PREPARE_PATH}, ${STATUS_PATH}, ${PING_PATH}`);
}

express.application.use = function v192ExportDirectEarlyRouteUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!routesInjected && candidates.some(fn => fn.name === 'serveStatic')) injectDirectRoutes(this);
  return previousUse.apply(this, args);
};

express.application.post = function v192ExportDirectEndpointRegistration(pathValue, ...handlers) {
  if (String(pathValue || '') === LEGACY_PREPARE_PATH) injectDirectRoutes(this);
  return previousPost.call(this, pathValue, ...handlers);
};

export function inspectV190ExportDirectEndpoint() {
  return {
    patchId: PATCH_ID,
    routesInjected,
    preparePath: PREPARE_PATH,
    statusPath: STATUS_PATH,
    pingPath: PING_PATH,
    pendingJobs: pendingJobs.size,
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    earlyRouteInstall: true
  };
}
export const V190_EXPORT_DIRECT_ENDPOINT_ID = PATCH_ID;
