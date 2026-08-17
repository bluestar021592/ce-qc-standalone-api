import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { getRuntimeConfig } from './db.js';

const PATCH_ID = '2026-08-17-v188-export-prepare-fast-ack-v1';
const EXPORT_CONTRACT_VERSION = 'ONE_WORKBOOK_PER_BUSINESS_V185_ONE_PASS_STREAM';
const PREPARE_PATH = '/api/export-period/prepare';
const ALL_JOB_HEAP_MB = Math.max(256, Math.min(1024, Number(process.env.EXPORT_JOB_HEAP_MB || 512)));
const SINGLE_JOB_HEAP_MB = Math.max(384, Math.min(1024, Number(process.env.EXPORT_SINGLE_JOB_HEAP_MB || 768)));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allWorkerFile = path.join(__dirname, 'v84ExportJobWorker.js');
const singleWorkerFile = path.join(__dirname, 'v183SingleBusinessExportJobWorker.js');
const originalPost = express.application.post;
let installed = false;

function jobsDir() {
  const dir = path.join(getRuntimeConfig().dataDir, 'export_jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.v188.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}
function readJob(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function markWorkerFailure(file, jobId, error, code = 'EXPORT_WORKER_PROCESS_FAILED') {
  try {
    const current = readJob(file);
    if (!current || String(current.jobId || '') !== String(jobId || '')) return;
    if (!['QUEUED', 'RUNNING'].includes(String(current.status || '').toUpperCase())) return;
    const now = new Date().toISOString();
    writeJsonAtomic(file, {
      ...current,
      status: 'FAILED',
      errorCode: code,
      message: `后台报表进程启动失败：${error?.message || String(error)}`,
      error: error?.stack || String(error),
      failedAt: now,
      updatedAt: now,
      fastAckPatchId: PATCH_ID
    });
  } catch (persistError) {
    console.error('[CE-QC][V188_EXPORT_ACK] failed to persist worker error:', persistError?.stack || persistError);
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
    markWorkerFailure(file, job.jobId, error, 'EXPORT_WORKER_SPAWN_FAILED');
    return;
  }
  child.once('error', error => markWorkerFailure(file, job.jobId, error, 'EXPORT_WORKER_SPAWN_FAILED'));
  child.once('exit', (exitCode, signal) => {
    const current = readJob(file);
    if (!current || !['QUEUED', 'RUNNING'].includes(String(current.status || '').toUpperCase())) return;
    const reason = new Error(exitCode === 0
      ? '后台报表进程已结束，但任务没有写入完成状态。'
      : `后台报表进程异常退出（code=${exitCode ?? 'null'}${signal ? `, signal=${signal}` : ''}）。`);
    markWorkerFailure(file, job.jobId, reason, 'EXPORT_WORKER_EXITED_EARLY');
  });
  child.unref();
}
function fastPrepare(req, res) {
  const requestStartedAt = Date.now();
  const payload = normalizePayload(req.body || {});
  if (!validatePayload(payload, res)) return;

  const jobId = `EXP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const file = path.join(jobsDir(), `${jobId}.json`);
  const now = new Date().toISOString();
  const singleBusiness = payload.businessType !== 'ALL';
  const job = {
    version: PATCH_ID,
    fastAckPatchId: PATCH_ID,
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    jobId,
    payloadKey: payloadKey(payload),
    status: 'QUEUED',
    progress: 0,
    message: singleBusiness
      ? 'V188快速应答：V185单业务流式完整报表任务已创建，正在启动独立后台进程'
      : 'V188快速应答：7业务完整报表任务已创建，正在启动后台编排进程',
    payload,
    files: [],
    createdAt: now,
    updatedAt: now,
    requestedBy: req.user?.username || req.user?.email || '',
    launcherHeapMB: singleBusiness ? SINGLE_JOB_HEAP_MB : ALL_JOB_HEAP_MB,
    workerMode: singleBusiness ? 'SINGLE_BUSINESS_DIRECT' : 'ALL_BUSINESS_ORCHESTRATOR',
    prepareAckMode: 'WRITE_JOB_THEN_ACK_THEN_SPAWN',
    prepareAckMs: 0
  };

  try {
    writeJsonAtomic(file, job);
  } catch (error) {
    console.error('[CE-QC][V188_EXPORT_ACK] failed to create job file:', error?.stack || error);
    res.status(500).json({ ok: false, code: 'EXPORT_JOB_CREATE_FAILED', error: `创建后台导出任务失败：${error?.message || String(error)}` });
    return;
  }

  const ackMs = Date.now() - requestStartedAt;
  try {
    const persisted = { ...job, prepareAckMs: ackMs };
    writeJsonAtomic(file, persisted);
  } catch {}

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
    prepareAckMs: ackMs,
    patchId: PATCH_ID
  });

  setImmediate(() => launchWorker(file, { ...job, prepareAckMs: ackMs }));
}

express.application.post = function v188ExportPrepareFastAckRegistration(pathValue, ...handlers) {
  if (String(pathValue || '') === PREPARE_PATH) {
    if (!installed) {
      installed = true;
      return originalPost.call(this, PREPARE_PATH, fastPrepare);
    }
    return this;
  }
  return originalPost.call(this, pathValue, ...handlers);
};

export function inspectV188ExportPrepareFastAck() {
  return {
    patchId: PATCH_ID,
    preparePath: PREPARE_PATH,
    installed,
    mode: 'WRITE_JOB_THEN_ACK_THEN_SPAWN',
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    singleJobHeapMB: SINGLE_JOB_HEAP_MB,
    allJobHeapMB: ALL_JOB_HEAP_MB
  };
}
export const V188_EXPORT_PREPARE_FAST_ACK_ID = PATCH_ID;
