import express from 'express';
import crypto from 'node:crypto';
import { getDb } from './db.js';
import { CEClient } from './ceClient.js';
import {
  processCarryFamilyForRefresh,
  applySuccessfulCarryRefresh,
  hasActiveBusinessProcessing
} from './carryoverRefreshScheduler.js';

const VERSION = '2026-08-17-v183-historical-status-refresh-center-v1';
const ALLOWED_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const REFRESH_CHUNK = Math.max(100, Math.min(500, Number(process.env.HISTORY_REFRESH_CHUNK || 300)));
const JOB_TTL_MS = Math.max(10 * 60_000, Number(process.env.HISTORY_REFRESH_JOB_TTL_MS || 2 * 60 * 60_000));
const jobs = new Map();
const activeByKey = new Map();

function normalizeType(value = '') {
  const type = String(value || '').trim().toUpperCase();
  return ALLOWED_TYPES.has(type) ? type : '';
}
function dateKey(value = '') {
  const text = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}
function validateSelection(input = {}) {
  const businessType = normalizeType(input.businessType);
  const fromDate = dateKey(input.fromDate);
  const toDate = dateKey(input.toDate);
  if (!businessType) throw new Error('历史状态刷新当前仅支持 SHOPEE CN / SHOPEE VN。');
  if (!fromDate || !toDate || fromDate > toDate) throw new Error('请选择有效的开始日期和结束日期。');
  const days = Math.floor((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000) + 1;
  if (days > 180) throw new Error('历史状态刷新单次最多180天。');
  return { businessType, fromDate, toDate };
}
function selectionKey(selection = {}) {
  return `${selection.businessType}|${selection.fromDate}|${selection.toDate}`;
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}
function pendingCountOf(state = {}) {
  const direct = [
    state.pendingCount, state.pendingTimes, state.pendingDays, state.pendingDayCount,
    state.pending次数, state.Pending次数, state.Pending天数, state.pending_count
  ].map(Number).find(value => Number.isFinite(value) && value >= 0);
  if (Number.isFinite(direct)) return direct;
  const arrays = [state.pendingDates, state.pendingHistory, state.pendingEvents, state.pendingDaysList];
  for (const value of arrays) if (Array.isArray(value)) return new Set(value.map(item => String(item?.date || item?.eventTime || item || '').slice(0, 10)).filter(Boolean)).size;
  return 0;
}
function classifyCarry(row = {}) {
  const state = safeJson(row.stateJson, {});
  const closeReason = String(row.closeReason || '').trim().toUpperCase();
  const stateName = String(state.currentState || state.state || state.primaryCategory || state.主分类 || state.异常分类 || '').trim().toUpperCase();
  const evidence = `${closeReason} ${stateName} ${state.latestEventDesc || ''} ${state.最后节点 || ''} ${state.latestNode || ''}`;
  const pod = closeReason === 'POD' || state.是否POD === '是' || String(state.orderStatus || '') === '85' || /\bPOD\b|签收|妥投/i.test(evidence);
  const returned = !pod && (['RETURNED', 'RETURN_COMPLETED'].includes(closeReason) || state.退回状态 === '已退回' || /RETURNED|RETURN_COMPLETED|已退回|退回完成|R退回/i.test(evidence));
  const pending = !pod && !returned && /PENDING/i.test(evidence);
  const delivering = !pod && !returned && !pending && /派送|派件|DELIVER|ASSIGN/i.test(evidence);
  const pendingCount = pendingCountOf(state);
  return { pod, returned, pending, delivering, pendingCount, state };
}
function selectedCarryRows(db, selection, status = '') {
  const whereStatus = status ? ' AND status=?' : '';
  const params = [selection.businessType, selection.fromDate, selection.toDate];
  if (status) params.push(status);
  return db.prepare(`SELECT shipmentCode,businessType,sourceReportDate,lastReportDate,status,apiStatus,closeReason,stateJson,updatedAt
    FROM carryover_open_items
    WHERE UPPER(COALESCE(businessType,''))=? AND sourceReportDate BETWEEN ? AND ?${whereStatus}
    ORDER BY sourceReportDate,shipmentCode`).all(...params);
}
function buildSummary(selection, db = getDb()) {
  const rows = selectedCarryRows(db, selection);
  let pod = 0, returned = 0, pending = 0, delivering = 0, open = 0, failed = 0, pendingTimes = 0;
  let lastRefreshAt = '';
  for (const row of rows) {
    const cls = classifyCarry(row);
    if (String(row.status || '').toUpperCase() === 'OPEN') open += 1;
    if (/FAILED|RETRY|API_PENDING_RETRY/i.test(String(row.apiStatus || ''))) failed += 1;
    if (cls.pod) pod += 1;
    else if (cls.returned) returned += 1;
    else if (cls.pending) { pending += 1; pendingTimes += Number(cls.pendingCount || 0); }
    else if (cls.delivering) delivering += 1;
    const updatedAt = String(row.updatedAt || '');
    if (updatedAt && updatedAt > lastRefreshAt) lastRefreshAt = updatedAt;
  }
  return {
    ok: true,
    version: VERSION,
    ...selection,
    total: rows.length,
    pod,
    returned,
    pending,
    delivering,
    open,
    toRefresh: open,
    failed,
    pendingTimes,
    lastRefreshAt,
    terminal: Math.max(0, rows.length - open),
    generatedAt: new Date().toISOString()
  };
}
function cambodiaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    const at = Date.parse(job.updatedAt || job.createdAt || '') || 0;
    if (at && at < cutoff && !['QUEUED', 'RUNNING'].includes(String(job.status || ''))) jobs.delete(id);
  }
}
function writeJob(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}
async function runRefreshJob(job) {
  const db = getDb();
  const selection = job.selection;
  try {
    if (hasActiveBusinessProcessing(db)) {
      const error = new Error('当前七业务/扫描/轨迹任务仍在运行，请先等主任务结束再刷新历史状态。');
      error.code = 'FOREGROUND_PROCESSING_ACTIVE';
      throw error;
    }
    const before = buildSummary(selection, db);
    const rows = selectedCarryRows(db, selection, 'OPEN');
    if (!rows.length) {
      writeJob(job, { status: 'COMPLETED', progress: 100, message: '当前区间没有需要再次刷新的未闭环票。', before, after: before, refreshed: 0, failed: 0, completedAt: new Date().toISOString() });
      return;
    }
    writeJob(job, { status: 'RUNNING', progress: 2, message: `准备刷新 ${rows.length.toLocaleString('zh-CN')} 票未闭环状态`, before, total: rows.length });
    const client = new CEClient();
    let refreshed = 0;
    let failed = 0;
    const failedBills = new Set();
    const refreshDate = cambodiaDate();
    for (let offset = 0; offset < rows.length; offset += REFRESH_CHUNK) {
      const chunk = rows.slice(offset, offset + REFRESH_CHUNK);
      const chunkNo = Math.floor(offset / REFRESH_CHUNK) + 1;
      const totalChunks = Math.ceil(rows.length / REFRESH_CHUNK);
      writeJob(job, {
        status: 'RUNNING',
        progress: Math.max(3, Math.min(94, 3 + Math.floor((offset / rows.length) * 91))),
        message: `正在刷新 ${selection.businessType} 未闭环状态 · 第 ${chunkNo}/${totalChunks} 批 · 已完成 ${offset}/${rows.length}`,
        completed: offset,
        total: rows.length
      });
      const outcome = await processCarryFamilyForRefresh('SHOPEE', chunk, {
        client,
        reportDate: refreshDate,
        refreshId: `${job.jobId}-${chunkNo}`
      });
      if (outcome.successfulRows?.length) {
        applySuccessfulCarryRefresh(outcome.successfulRows, { snapshotId: job.jobId, reportDate: refreshDate });
        refreshed += outcome.successfulRows.length;
      }
      for (const bill of outcome.failedBills || []) failedBills.add(String(bill || '').trim().toUpperCase());
      failed = failedBills.size;
      writeJob(job, {
        progress: Math.max(5, Math.min(96, 5 + Math.floor(((offset + chunk.length) / rows.length) * 91))),
        completed: Math.min(offset + chunk.length, rows.length),
        refreshed,
        failed,
        message: `历史状态刷新中 · 已处理 ${Math.min(offset + chunk.length, rows.length)}/${rows.length} · 成功 ${refreshed} · 待重试 ${failed}`
      });
    }
    const after = buildSummary(selection, db);
    writeJob(job, {
      status: 'COMPLETED',
      progress: 100,
      completed: rows.length,
      refreshed,
      failed,
      before,
      after,
      newlyPod: Math.max(0, Number(after.pod || 0) - Number(before.pod || 0)),
      newlyReturned: Math.max(0, Number(after.returned || 0) - Number(before.returned || 0)),
      closedNow: Math.max(0, Number(before.open || 0) - Number(after.open || 0)),
      message: `刷新完成 · 新增POD ${Math.max(0, after.pod - before.pod)} · 新增退回 ${Math.max(0, after.returned - before.returned)} · 当前未闭环 ${after.open}`,
      completedAt: new Date().toISOString()
    });
  } catch (error) {
    writeJob(job, {
      status: 'FAILED',
      errorCode: error?.code || 'HISTORY_STATUS_REFRESH_FAILED',
      error: error?.stack || String(error),
      message: error?.message || String(error),
      failedAt: new Date().toISOString()
    });
  } finally {
    activeByKey.delete(selectionKey(selection));
  }
}

function summaryHandler(req, res) {
  try {
    const selection = validateSelection(req.query || {});
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildSummary(selection));
  } catch (error) {
    res.status(400).json({ ok: false, error: error?.message || String(error) });
  }
}
function startHandler(req, res) {
  try {
    cleanupJobs();
    const selection = validateSelection(req.body || {});
    const key = selectionKey(selection);
    const activeId = activeByKey.get(key);
    if (activeId && jobs.has(activeId)) {
      const active = jobs.get(activeId);
      return res.status(202).json({ ok: true, reused: true, jobId: active.jobId, status: active.status, progress: active.progress, message: active.message });
    }
    const jobId = `HREF-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const job = {
      ok: true,
      version: VERSION,
      jobId,
      selection,
      status: 'QUEUED',
      progress: 0,
      message: '历史状态刷新任务已进入后台',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestedBy: req.user?.username || req.user?.email || ''
    };
    jobs.set(jobId, job);
    activeByKey.set(key, jobId);
    setImmediate(() => runRefreshJob(job));
    res.status(202).json({ ok: true, reused: false, jobId, status: job.status, progress: 0, message: job.message });
  } catch (error) {
    res.status(400).json({ ok: false, error: error?.message || String(error) });
  }
}
function jobHandler(req, res) {
  cleanupJobs();
  const job = jobs.get(String(req.params?.jobId || ''));
  if (!job) return res.status(404).json({ ok: false, error: '历史状态刷新任务不存在或已过期。' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, ...job });
}

let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v183HistoricalStatusRefreshListen(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v183/history-refresh/summary', summaryHandler);
    this.post('/api/v183/history-refresh/start', startHandler);
    this.get('/api/v183/history-refresh/job/:jobId', jobHandler);
  }
  return previousListen.apply(this, args);
};

export function inspectV183HistoryRefresh() {
  return { version: VERSION, jobs: jobs.size, active: activeByKey.size, chunk: REFRESH_CHUNK, types: [...ALLOWED_TYPES] };
}
export const V183_HISTORICAL_STATUS_REFRESH_ID = VERSION;
