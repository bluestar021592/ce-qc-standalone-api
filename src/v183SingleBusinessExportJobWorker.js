import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeConfig, closeDb } from './db.js';
import { createCompactPeriodBusinessWorkbook } from './v177CompactPeriodExporter.js';
import { createShopeeCurrentStateStreamWorkbook } from './v185ShopeeCurrentStateStreamExporter.js';
import { listCompletedWhppSnapshots } from './v87WhppExportStore.js';
import { createShopeeTemplateWorkbook } from './shopeeTemplateExporter.js';

const VERSION = '2026-08-17-v185-single-business-stream-worker-v1';
const HEARTBEAT_MS = Math.max(3000, Math.min(15000, Number(process.env.EXPORT_SINGLE_HEARTBEAT_MS || 5000)));
const jobFile = path.resolve(String(process.argv[2] || ''));
const ALLOWED = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);

function readJob() {
  if (!jobFile || !fs.existsSync(jobFile)) throw new Error('导出任务文件不存在。');
  return JSON.parse(fs.readFileSync(jobFile, 'utf8'));
}
function writeJob(patch = {}) {
  const current = readJob();
  const nextStatus = String(patch.status || '').toUpperCase();
  if (current.cancelRequested && !['FAILED', 'CANCELLED'].includes(nextStatus)) {
    const error = new Error('EXPORT_JOB_CANCELLED');
    error.code = 'EXPORT_JOB_CANCELLED';
    throw error;
  }
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const temp = `${jobFile}.${process.pid}.v185.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(temp, jobFile);
  return next;
}
function dateKey(value = '') { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : ''; }
function formatCambodia(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function validateRange(from, to) {
  if (!dateKey(from) || !dateKey(to) || from > to) throw new Error('导出日期范围无效。');
  const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > 180) throw new Error('单次日期范围最多180天。');
  return { from, to, key: `${from}_${to}` };
}
function rangeOf(payload = {}) {
  if (payload.periodType === 'custom') return validateRange(payload.fromDate, payload.toDate);
  const base = dateKey(payload.date) ? new Date(`${payload.date}T12:00:00+07:00`) : new Date();
  if (payload.periodType === 'weekly') {
    const day = (base.getDay() + 6) % 7;
    const from = new Date(base); from.setDate(base.getDate() - day);
    const to = new Date(from); to.setDate(from.getDate() + 6);
    return validateRange(formatCambodia(from), formatCambodia(to));
  }
  if (payload.periodType === 'monthly') {
    const from = new Date(base.getFullYear(), base.getMonth(), 1, 12);
    const to = new Date(base.getFullYear(), base.getMonth() + 1, 0, 12);
    return validateRange(formatCambodia(from), formatCambodia(to));
  }
  const day = formatCambodia(base);
  return { from: day, to: day, key: day };
}
function memoryText() {
  const m = process.memoryUsage();
  const mb = value => Math.max(0, Math.round(Number(value || 0) / 1024 / 1024));
  return `RSS ${mb(m.rss)}MB / Heap ${mb(m.heapUsed)}MB`;
}
function fileItem(file) {
  const name = path.basename(String(file || ''));
  return { name, url: `/api/export-file?name=${encodeURIComponent(name)}`, completeWorkbook: true };
}

let heartbeat = null;
let stage = '准备中';
let progress = 2;
let startedAt = Date.now();

try {
  const job = readJob();
  const payload = job.payload || {};
  const type = String(payload.businessType || '').trim().toUpperCase();
  if (!ALLOWED.has(type)) throw new Error(`V185单业务导出不支持：${type || '空业务'}`);
  const range = rangeOf(payload);
  startedAt = Date.now();
  stage = `正在生成 ${type} 完整表格`;
  progress = 5;
  writeJob({
    status: 'RUNNING', progress, range, currentBusiness: type, currentPart: 1, businessParts: 1,
    heartbeatAt: new Date().toISOString(), workerPid: process.pid, workerMode: 'SINGLE_BUSINESS_DIRECT',
    workerVersion: VERSION, message: `${stage} · ${range.from} 至 ${range.to} · ${memoryText()}`
  });

  heartbeat = setInterval(() => {
    try {
      writeJob({
        status: 'RUNNING', progress, heartbeatAt: new Date().toISOString(), currentBusiness: type,
        currentPart: 1, businessParts: 1, workerPid: process.pid, workerMode: 'SINGLE_BUSINESS_DIRECT',
        workerVersion: VERSION, message: `${stage} · 已运行${Math.max(1, Math.floor((Date.now() - startedAt) / 1000))}秒 · ${memoryText()}`
      });
    } catch (error) { if (error?.code === 'EXPORT_JOB_CANCELLED') process.exitCode = 2; }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  let file = '';
  let summary = {};
  if (type === 'WHPP') {
    stage = '正在读取 WHPP 已完成快照并写入完整Excel'; progress = 20;
    const snapshots = listCompletedWhppSnapshots(range.from, range.to);
    if (!snapshots.length) throw new Error(`${range.from} 至 ${range.to} 没有 WHPP VALID + COMPLETED 数据。`);
    const result = await createShopeeTemplateWorkbook({ type, periodType: payload.periodType || 'custom', range, snapshots, outputDir: getRuntimeConfig().exportsDir });
    file = result.file;
  } else if (SHOPEE_TYPES.has(type)) {
    stage = `正在读取 ${type} 首日报唯一票`; progress = 8;
    const result = await createShopeeCurrentStateStreamWorkbook({
      type,
      periodType: payload.periodType || 'custom',
      range,
      outputDir: getRuntimeConfig().exportsDir,
      onProgress(info = {}) {
        const phase = String(info.phase || '');
        const completed = Math.max(0, Number(info.completed || 0));
        const total = Math.max(1, Number(info.total || 1));
        if (phase === 'start') {
          progress = 8;
          stage = `正在准备 ${type} 首日报唯一归属`;
        } else if (phase === 'sourceRows') {
          progress = Math.max(10, Math.min(35, 10 + Math.floor((completed / total) * 25)));
          stage = `读取 ${type} 首日报唯一票 ${completed}/${total} · 已归属${Number(info.entries || 0).toLocaleString()}票`;
        } else if (phase === 'currentStates') {
          progress = Math.max(36, Math.min(58, 36 + Math.floor((completed / total) * 22)));
          stage = `匹配 ${type} 最新刷新状态 ${Math.min(completed, total)}/${total}`;
        } else if (phase === 'finalStates') {
          progress = Math.max(59, Math.min(66, 59 + Math.floor((completed / total) * 7)));
          stage = `补充 ${type} 历史完成状态 ${Math.min(completed, total)}/${total}`;
        } else if (phase === 'writing') {
          progress = Math.max(67, Math.min(97, 67 + Math.floor((completed / total) * 30)));
          stage = `一次流式写入10-Sheet完整Excel ${Math.min(completed, total).toLocaleString()}/${total.toLocaleString()}`;
        }
        writeJob({
          status: 'RUNNING', progress, heartbeatAt: new Date().toISOString(), currentBusiness: type,
          currentPart: 1, businessParts: 1, workerPid: process.pid, workerMode: 'SINGLE_BUSINESS_DIRECT',
          workerVersion: VERSION, sourceRowJsonRead: true, currentStateOverlay: true,
          onePassStreaming: true, outputContract: 'LEGACY_10_SHEETS_ONE_PASS_STREAM',
          message: `${stage} · ${memoryText()}`
        });
      }
    });
    file = result.file;
    summary = result.summary || {};
  } else {
    stage = `正在读取 ${type} 日快照并写入同一个完整Excel`; progress = 20;
    const result = await createCompactPeriodBusinessWorkbook({ type, periodType: payload.periodType || 'custom', range, outputDir: getRuntimeConfig().exportsDir });
    file = result.file;
    summary = result.summary || {};
  }

  if (!file || !fs.existsSync(file)) throw new Error(`${type} 完整表生成结束，但输出文件不存在。`);
  progress = 100; stage = '生成完成';
  writeJob({
    status: 'COMPLETED', progress: 100, heartbeatAt: new Date().toISOString(), currentBusiness: '',
    currentPart: 0, businessParts: 0, workerPid: process.pid, workerMode: 'SINGLE_BUSINESS_DIRECT',
    workerVersion: VERSION, outputContract: summary?.outputContract || 'ONE_WORKBOOK_PER_BUSINESS', summary,
    message: `导出完成：${type} ${range.from} 至 ${range.to}；首日报唯一归属 + 最新状态已一次流式写入`,
    files: [fileItem(file)], completedAt: new Date().toISOString()
  });
} catch (error) {
  try {
    const cancelled = error?.code === 'EXPORT_JOB_CANCELLED';
    writeJob({
      status: cancelled ? 'CANCELLED' : 'FAILED', progress: Number(progress || 0), heartbeatAt: new Date().toISOString(),
      workerPid: process.pid, workerMode: 'SINGLE_BUSINESS_DIRECT', workerVersion: VERSION,
      errorCode: error?.code || 'EXPORT_SINGLE_BUSINESS_FAILED',
      message: cancelled ? '后台单业务导出已取消。' : (error?.message || String(error)),
      error: error?.stack || String(error), failedAt: new Date().toISOString()
    });
  } catch {}
  process.exitCode = 1;
} finally {
  if (heartbeat) clearInterval(heartbeat);
  try { closeDb(); } catch {}
}
