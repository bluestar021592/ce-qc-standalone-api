import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getRuntimeConfig } from './db.js';

const PATCH_ID = '2026-08-13-v84-async-large-range-export-v1';
const PREPARE_PATH = '/api/export-period/prepare';
const STATUS_PATH = '/api/v84/export-job/:jobId';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerFile = path.join(__dirname, 'v84ExportJobWorker.js');
const originalPost = express.application.post;
const originalGet = express.application.get;
let installed = false;

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

function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function readJob(jobId) {
  const file = jobPath(jobId);
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
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

function enqueueExport(req, res) {
  const payload = normalizePayload(req.body || {});
  if (payload.periodType === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.toDate)) {
      return res.status(400).json({ ok: false, error: '请选择有效的开始日期和结束日期。' });
    }
    if (payload.fromDate > payload.toDate) return res.status(400).json({ ok: false, error: '开始日期不能晚于结束日期。' });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return res.status(400).json({ ok: false, error: '请选择有效的基准日期。' });
  }

  const jobId = `EXP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const file = jobPath(jobId);
  const now = new Date().toISOString();
  const job = {
    version: PATCH_ID,
    jobId,
    status: 'QUEUED',
    progress: 0,
    message: '导出任务已进入后台队列',
    payload,
    files: [],
    createdAt: now,
    updatedAt: now,
    requestedBy: req.user?.username || req.user?.email || ''
  };
  writeJsonAtomic(file, job);

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
  // Suppress the legacy synchronous handler. Heavy Excel generation is now owned
  // by the detached export worker so a 200k+ range cannot block the API event loop.
  return this;
};

export const V84_ASYNC_EXPORT_PATCH_ID = PATCH_ID;
