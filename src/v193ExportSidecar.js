import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessIdentity, requireRole } from './accessControl.js';
import { closeDb, getRuntimeConfig } from './db.js';

const VERSION = '2026-08-18-v193-isolated-export-sidecar-v1';
const PORT = Math.max(1024, Math.min(65535, Number(process.env.CE_QC_EXPORT_SIDECAR_PORT || 5178)));
const HOST = String(process.env.CE_QC_EXPORT_SIDECAR_HOST || '0.0.0.0');
const SINGLE_JOB_HEAP_MB = Math.max(384, Math.min(1024, Number(process.env.EXPORT_SINGLE_JOB_HEAP_MB || 768)));
const EXPORT_CONTRACT_VERSION = 'ONE_WORKBOOK_PER_BUSINESS_V191_CROSS_DAY_TRUTH';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const singleWorkerFile = path.join(__dirname, 'v183SingleBusinessExportJobWorker.js');
const pendingJobs = new Map();
const app = express();

function safeJobId(value) {
  const id = String(value || '').trim();
  return /^EXP-[A-Z0-9-]{10,80}$/i.test(id) ? id : '';
}
function dateKey(value = '') {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}
function normalizePayload(body = {}) {
  const periodType = ['daily', 'weekly', 'monthly', 'custom'].includes(String(body.periodType || '')) ? String(body.periodType) : 'daily';
  return {
    periodType,
    date: dateKey(body.date),
    fromDate: dateKey(body.fromDate),
    toDate: dateKey(body.toDate),
    businessType: String(body.businessType || '').trim().toUpperCase()
  };
}
function validatePayload(payload, res) {
  if (!payload.businessType || payload.businessType === 'ALL') {
    res.status(400).json({ ok: false, code: 'V193_SINGLE_BUSINESS_ONLY', error: 'V193独立导出通道仅用于单业务完整表。' });
    return false;
  }
  if (payload.periodType === 'custom') {
    if (!payload.fromDate || !payload.toDate || payload.fromDate > payload.toDate) {
      res.status(400).json({ ok: false, code: 'V193_INVALID_RANGE', error: '请选择有效的开始日期和结束日期。' });
      return false;
    }
    const days = Math.floor((Date.parse(`${payload.toDate}T00:00:00Z`) - Date.parse(`${payload.fromDate}T00:00:00Z`)) / 86400000) + 1;
    if (days > 180) {
      res.status(400).json({ ok: false, code: 'V193_RANGE_TOO_LARGE', error: '单次日期范围最多180天。' });
      return false;
    }
  } else if (!payload.date) {
    res.status(400).json({ ok: false, code: 'V193_INVALID_DATE', error: '请选择有效的基准日期。' });
    return false;
  }
  return true;
}
function payloadKey(payload) {
  return crypto.createHash('sha256').update(JSON.stringify({ ...payload, exportContractVersion: EXPORT_CONTRACT_VERSION })).digest('hex');
}
function jobsDir() {
  return path.join(getRuntimeConfig().dataDir, 'export_jobs');
}
function jobPath(jobId) {
  const safe = safeJobId(jobId);
  return safe ? path.join(jobsDir(), `${safe}.json`) : '';
}
async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.v193.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temp, file);
}
async function readJob(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
}
function publicPending(job = {}) {
  return { ...job, files: Array.isArray(job.files) ? job.files : [], sidecarVersion: VERSION };
}
async function markFailure(file, jobId, error, errorCode = 'V193_EXPORT_WORKER_FAILED') {
  const current = await readJob(file) || pendingJobs.get(jobId)?.job;
  if (!current || String(current.jobId || '') !== jobId) return;
  if (!['QUEUED', 'RUNNING'].includes(String(current.status || '').toUpperCase())) return;
  const now = new Date().toISOString();
  const failed = { ...current, status: 'FAILED', errorCode, message: error?.message || String(error), error: error?.stack || String(error), failedAt: now, updatedAt: now, sidecarVersion: VERSION };
  pendingJobs.set(jobId, { job: failed, file, persisted: Boolean(file) });
  try { if (file) await writeJsonAtomic(file, failed); } catch {}
}
function launchWorker(file, job) {
  let child;
  try {
    child = spawn(process.execPath, [`--max-old-space-size=${SINGLE_JOB_HEAP_MB}`, singleWorkerFile, file], {
      cwd: getRuntimeConfig().projectRoot,
      env: { ...process.env, CE_QC_EXPORT_WORKER_MODE: 'V193_ISOLATED_SINGLE_BUSINESS', CE_QC_EXPORT_PREPARE_ACK_VERSION: VERSION },
      detached: false,
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch (error) {
    void markFailure(file, job.jobId, error, 'V193_EXPORT_WORKER_SPAWN_FAILED');
    return;
  }
  child.once('error', error => { void markFailure(file, job.jobId, error, 'V193_EXPORT_WORKER_SPAWN_FAILED'); });
  child.once('exit', (code, signal) => {
    void (async () => {
      const current = await readJob(file);
      if (!current || !['QUEUED', 'RUNNING'].includes(String(current.status || '').toUpperCase())) return;
      const reason = new Error(code === 0
        ? 'V193后台报表进程已结束，但任务没有写入完成状态。'
        : `V193后台报表进程异常退出（code=${code ?? 'null'}${signal ? `, signal=${signal}` : ''}）。`);
      await markFailure(file, job.jobId, reason, 'V193_EXPORT_WORKER_EXITED_EARLY');
    })();
  });
  child.unref?.();
}
async function persistAndLaunch(job) {
  let file = '';
  try {
    const dir = jobsDir();
    await fsp.mkdir(dir, { recursive: true });
    file = jobPath(job.jobId);
    const persisted = { ...job, persistedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), message: 'V193独立导出通道已确认；正在启动V191跨日真实状态后台进程' };
    await writeJsonAtomic(file, persisted);
    pendingJobs.set(job.jobId, { job: persisted, file, persisted: true });
    launchWorker(file, persisted);
  } catch (error) {
    await markFailure(file, job.jobId, error, 'V193_EXPORT_JOB_PERSIST_FAILED');
  }
}
function originAllowed(req) {
  const raw = String(req.get('origin') || '').trim();
  if (!raw) return { ok: true, origin: '' };
  try {
    const origin = new URL(raw);
    const requestHost = String(req.hostname || '').toLowerCase();
    const sameHost = origin.hostname.toLowerCase() === requestHost;
    const appPort = origin.port === '5177' || (!origin.port && origin.protocol === 'https:');
    return { ok: sameHost && appPort, origin: raw };
  } catch { return { ok: false, origin: raw }; }
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const allowed = originAllowed(req);
  if (!allowed.ok) return res.status(403).json({ ok: false, code: 'V193_ORIGIN_DENIED', error: 'V193独立导出通道拒绝跨主机请求。' });
  if (allowed.origin) {
    res.setHeader('Access-Control-Allow-Origin', allowed.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(accessIdentity);
app.use('/api/v193', requireRole('OPERATOR'));

app.get('/api/v193/export-ping', (req, res) => {
  res.json({ ok: true, version: VERSION, port: PORT, pendingJobs: pendingJobs.size, worker: 'V191_CROSS_DAY_TRUTH' });
});
app.post('/api/v193/export-period/prepare', (req, res) => {
  const startedAt = Date.now();
  const payload = normalizePayload(req.body || {});
  console.log(`[CE-QC][V193_EXPORT_SIDECAR] PREPARE business=${payload.businessType || '-'} period=${payload.periodType}`);
  if (!validatePayload(payload, res)) return;
  const jobId = `EXP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const now = new Date().toISOString();
  const job = {
    version: VERSION,
    sidecarVersion: VERSION,
    exportContractVersion: EXPORT_CONTRACT_VERSION,
    jobId,
    payloadKey: payloadKey(payload),
    status: 'QUEUED',
    progress: 0,
    message: 'V193独立导出Job已在独立进程内存创建；正在异步持久化并启动V191真实状态导出',
    payload,
    files: [],
    createdAt: now,
    updatedAt: now,
    requestedBy: req.user?.username || req.user?.email || '',
    launcherHeapMB: SINGLE_JOB_HEAP_MB,
    workerMode: 'V193_ISOLATED_SINGLE_BUSINESS'
  };
  pendingJobs.set(jobId, { job, file: '', persisted: false });
  const ackMs = Date.now() - startedAt;
  res.status(202).json({ ok: true, async: true, jobId, status: 'QUEUED', progress: 0, message: job.message, pollUrl: `/api/v193/export-job/${encodeURIComponent(jobId)}`, sidecarVersion: VERSION, prepareAckMs: ackMs, workerMode: job.workerMode });
  console.log(`[CE-QC][V193_EXPORT_SIDECAR] ACK job=${jobId} ${ackMs}ms`);
  setImmediate(() => { void persistAndLaunch(job); });
});
app.get('/api/v193/export-job/:jobId', async (req, res) => {
  const jobId = safeJobId(req.params?.jobId);
  if (!jobId) return res.status(404).json({ ok: false, code: 'V193_JOB_NOT_FOUND', error: '导出任务不存在或已过期。' });
  const pending = pendingJobs.get(jobId);
  if (pending && !pending.persisted) return res.json({ ok: true, ...publicPending(pending.job) });
  const file = pending?.file || jobPath(jobId);
  const diskJob = await readJob(file);
  if (diskJob) {
    if (!['QUEUED', 'RUNNING'].includes(String(diskJob.status || '').toUpperCase())) pendingJobs.delete(jobId);
    return res.json({ ok: true, ...diskJob, sidecarVersion: VERSION });
  }
  if (pending?.job) return res.json({ ok: true, ...publicPending(pending.job) });
  return res.status(404).json({ ok: false, code: 'V193_JOB_NOT_FOUND', error: '导出任务不存在或已过期。' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[CE-QC][V193_EXPORT_SIDECAR] READY http://${HOST}:${PORT} · ${VERSION}`);
});
server.on('error', error => {
  console.error('[CE-QC][V193_EXPORT_SIDECAR] START FAILED:', error?.stack || error);
  process.exitCode = 1;
});
function shutdown() {
  try { server.close(); } catch {}
  try { closeDb(); } catch {}
}
process.once('SIGINT', () => { shutdown(); process.exit(0); });
process.once('SIGTERM', () => { shutdown(); process.exit(0); });
process.once('exit', shutdown);
