import express from 'express';
import crypto from 'node:crypto';
import { getDb } from './db.js';
import { CEClient } from './ceClient.js';
import {
  processCarryFamilyForRefresh,
  applySuccessfulCarryRefresh,
  activeBusinessProcessingDetails
} from './carryoverRefreshScheduler.js';

export const V227_MULTI_BUSINESS_HISTORY_REFRESH_ID = '2026-08-22-v227-multi-business-history-refresh-v1';

const SUMMARY_ROUTE = '/api/v227/history-refresh/summary';
const START_ROUTE = '/api/v227/history-refresh/start';
const JOB_ROUTE = '/api/v227/history-refresh/job/:jobId';
const SUPPORTED = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688', 'WHPP']);
const CHUNK_SIZE = Math.max(100, Math.min(350, Number(process.env.V227_HISTORY_REFRESH_CHUNK || 300)));
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const jobs = new Map();
const activeByKey = new Map();

function text(value) { return String(value ?? '').trim(); }
function billOf(row = {}) { return text(row.shipmentCode || row.运单号 || row.waybill).toUpperCase(); }
function dateKey(value = '') {
  const value10 = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value10) ? value10 : '';
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function validateSelection(input = {}) {
  const businessType = text(input.businessType).toUpperCase();
  const fromDate = dateKey(input.fromDate);
  const toDate = dateKey(input.toDate);
  if (!SUPPORTED.has(businessType)) throw new Error('该历史状态刷新接口仅支持 CE / CEAF / TBKH / ALI1688 / WHPP。');
  if (!fromDate || !toDate || fromDate > toDate) throw new Error('请选择有效的开始日期和结束日期。');
  const days = Math.floor((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000) + 1;
  if (days > 180) throw new Error('历史状态刷新单次最多180天。');
  return { businessType, fromDate, toDate };
}
function selectionKey(selection) { return `${selection.businessType}|${selection.fromDate}|${selection.toDate}`; }
function cambodiaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function pendingCountOf(state = {}) {
  const direct = [state.Pending当前次数, state.Pending次数, state.pendingDistinctDayCount, state.pendingCount, state.pendingTimes, state.pendingDays, state.pendingDayCount]
    .map(Number).find(value => Number.isFinite(value) && value >= 0);
  if (Number.isFinite(direct)) return direct;
  const dates = Array.isArray(state.pendingDates) ? state.pendingDates : [];
  return new Set(dates.map(value => text(value?.date || value?.eventTime || value).slice(0, 10)).filter(Boolean)).size;
}
function classifyState(row = {}) {
  const stateJson = safeJson(row.stateJson, {});
  const closeReason = text(row.closeReason).toUpperCase();
  const stateName = text(row.state || stateJson.currentState || stateJson.scanNormalizedState || stateJson.state || stateJson.primaryCategory || stateJson.主分类).toUpperCase();
  const orderStatus = text(stateJson.orderStatus);
  const latestCode = text(stateJson.latestTrackStatusCode || stateJson.lastEventCode || stateJson.eventCode || stateJson.trackingEventCode);
  const evidence = [
    closeReason, stateName, stateJson.退回状态, stateJson.primaryCategory, stateJson.currentMainCategory,
    stateJson.主分类, stateJson.异常分类, stateJson.latestEventDesc, stateJson.最后节点, stateJson.QC判断
  ].map(text).join(' ');
  const pod = closeReason === 'POD' || stateName === 'POD' || orderStatus === '85' || stateJson.是否POD === '是' || latestCode === '80';
  const returned = !pod && (
    ['RETURNED', 'RETURN_COMPLETED'].includes(closeReason)
    || ['RETURNED', 'RETURN_COMPLETED'].includes(stateName)
    || orderStatus === '100'
    || latestCode === '86'
    || stateJson.退回状态 === '已退回'
    || /RETURNED|RETURN_COMPLETED|已退回|退回完成|R退回/i.test(evidence)
  );
  const cancelled = !pod && !returned && (
    closeReason === 'ORDER_CANCELLED' || stateName === 'ORDER_CANCELLED' || orderStatus === '10' || stateJson.订单取消 === '是'
  );
  const pending = !pod && !returned && !cancelled && /PENDING/i.test(evidence);
  const delivering = !pod && !returned && !cancelled && !pending && /派送|派件|DELIVER|ASSIGN/i.test(evidence);
  return { pod, returned, cancelled, pending, delivering, pendingCount: pendingCountOf(stateJson), stateJson };
}

function selectedCcslUploadedBills(db, selection) {
  return db.prepare(`
    WITH ranked_batches AS (
      SELECT b.snapshotId,b.reportDate,b.createdAt,b.batchId,
             ROW_NUMBER() OVER (PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) AS rn
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ?
    )
    SELECT UPPER(TRIM(u.shipmentCode)) AS shipmentCode,
           MIN(r.reportDate) AS sourceReportDate,
           MAX(r.reportDate) AS lastImportedDate
    FROM ranked_batches r
    INNER JOIN unified_import_rows u ON u.snapshotId=r.snapshotId
    WHERE r.rn=1 AND UPPER(COALESCE(u.businessType,''))=? AND TRIM(COALESCE(u.shipmentCode,''))<>''
    GROUP BY UPPER(TRIM(u.shipmentCode))
    ORDER BY sourceReportDate,shipmentCode
  `).all(selection.fromDate, selection.toDate, selection.businessType);
}

function selectedWhppUploadedBills(db, selection) {
  try {
    return db.prepare(`
      SELECT UPPER(TRIM(p.shipmentCode)) AS shipmentCode,
             MIN(p.reportDate) AS sourceReportDate,
             MAX(p.reportDate) AS lastImportedDate
      FROM business_daily_parse_rows p
      WHERE UPPER(COALESCE(p.businessType,''))='WHPP'
        AND p.reportDate BETWEEN ? AND ?
        AND TRIM(COALESCE(p.shipmentCode,''))<>''
        AND NOT EXISTS (
          SELECT 1
          FROM unified_import_rows u
          WHERE UPPER(TRIM(u.shipmentCode))=UPPER(TRIM(p.shipmentCode))
            AND UPPER(COALESCE(u.businessType,''))='CEAF'
            AND u.reportDate=p.reportDate
        )
      GROUP BY UPPER(TRIM(p.shipmentCode))
      ORDER BY sourceReportDate,shipmentCode
    `).all(selection.fromDate, selection.toDate);
  } catch {
    return db.prepare(`
      SELECT UPPER(TRIM(shipmentCode)) AS shipmentCode,
             MIN(sourceReportDate) AS sourceReportDate,
             MAX(lastReportDate) AS lastImportedDate
      FROM carryover_open_items
      WHERE UPPER(COALESCE(businessType,''))='WHPP'
        AND sourceReportDate BETWEEN ? AND ?
        AND TRIM(COALESCE(shipmentCode,''))<>''
      GROUP BY UPPER(TRIM(shipmentCode))
      ORDER BY sourceReportDate,shipmentCode
    `).all(selection.fromDate, selection.toDate);
  }
}

function selectedUploadedRows(db, selection) {
  const uploaded = selection.businessType === 'WHPP'
    ? selectedWhppUploadedBills(db, selection)
    : selectedCcslUploadedBills(db, selection);
  if (!uploaded.length) return [];
  const carryStmt = db.prepare(`SELECT shipmentCode,businessType,sourceReportDate,lastReportDate,status,apiStatus,closeReason,stateJson,updatedAt FROM carryover_open_items WHERE shipmentCode=?`);
  const currentStmt = db.prepare(`SELECT shipmentCode,businessType,reportDate,state,apiStatus,lastEventTime,stateJson,updatedAt FROM shipment_current_state WHERE shipmentCode=?`);
  return uploaded.map(source => {
    const bill = billOf(source);
    const carry = carryStmt.get(bill) || {};
    const current = currentStmt.get(bill) || {};
    const carryJson = safeJson(carry.stateJson, {});
    const currentJson = safeJson(current.stateJson, {});
    const carryCls = classifyState({ closeReason: carry.closeReason, stateJson: carryJson });
    const currentCls = classifyState({ state: current.state, stateJson: currentJson });
    const terminal = currentCls.pod || currentCls.returned || currentCls.cancelled ? currentCls : carryCls;
    const terminalReason = terminal.pod ? 'POD' : terminal.returned ? 'RETURNED' : terminal.cancelled ? 'ORDER_CANCELLED' : '';
    const merged = {
      ...carryJson,
      ...currentJson,
      shipmentCode: bill,
      运单号: bill,
      businessType: selection.businessType
    };
    return {
      shipmentCode: bill,
      businessType: selection.businessType,
      sourceReportDate: source.sourceReportDate,
      lastReportDate: current.reportDate || carry.lastReportDate || source.lastImportedDate,
      status: terminalReason ? 'CLOSED' : 'OPEN',
      apiStatus: current.apiStatus || carry.apiStatus || '',
      closeReason: terminalReason || carry.closeReason || '',
      stateJson: JSON.stringify(merged),
      updatedAt: [current.updatedAt, carry.updatedAt].filter(Boolean).sort().at(-1) || ''
    };
  });
}

function refreshCandidates(rows) {
  return rows.filter(row => {
    const cls = classifyState(row);
    return !cls.pod && !cls.returned && !cls.cancelled;
  });
}
function buildSummary(selection, db = getDb()) {
  const rows = selectedUploadedRows(db, selection);
  let pod = 0, returned = 0, cancelled = 0, pending = 0, delivering = 0, failed = 0, pendingTimes = 0;
  let lastRefreshAt = '';
  for (const row of rows) {
    const cls = classifyState(row);
    if (cls.pod) pod += 1;
    else if (cls.returned) returned += 1;
    else if (cls.cancelled) cancelled += 1;
    else if (cls.pending) { pending += 1; pendingTimes += cls.pendingCount; }
    else if (cls.delivering) delivering += 1;
    if (/FAILED|RETRY|API_PENDING_RETRY/i.test(text(row.apiStatus))) failed += 1;
    if (row.updatedAt && row.updatedAt > lastRefreshAt) lastRefreshAt = row.updatedAt;
  }
  const toRefresh = refreshCandidates(rows).length;
  return {
    ok: true,
    version: V227_MULTI_BUSINESS_HISTORY_REFRESH_ID,
    source: selection.businessType === 'WHPP' ? 'WHPP_DAILY_PARSE_ROWS' : 'ALL_UPLOADED_VALID_COMPLETED_DAILY_SNAPSHOTS',
    ...selection,
    total: rows.length,
    pod,
    returned,
    cancelled,
    pending,
    delivering,
    open: toRefresh,
    toRefresh,
    failed,
    pendingTimes,
    terminal: pod + returned + cancelled,
    lastRefreshAt,
    generatedAt: new Date().toISOString()
  };
}
function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    const at = Date.parse(job.updatedAt || job.createdAt || '') || 0;
    if (at && at < cutoff && !['QUEUED', 'WAITING', 'RUNNING'].includes(text(job.status).toUpperCase())) jobs.delete(id);
  }
}
function writeJob(job, patch = {}) { Object.assign(job, patch, { updatedAt: new Date().toISOString() }); return job; }
function blockerText(blockers = []) {
  return blockers.slice(0, 3).map(row => [row.family || row.businessType || '任务', row.businessType || '', row.reportDate || '', row.currentStage || row.status || '处理中'].filter(Boolean).join(' · ')).join('；');
}

async function runJob(job) {
  const db = getDb();
  const client = new CEClient();
  const selection = job.selection;
  const key = selectionKey(selection);
  try {
    const blockers = activeBusinessProcessingDetails(db);
    if (blockers.active) {
      throw new Error(`当前有其他业务处理任务正在运行：${blockerText(blockers.blockers)}。请等待完成后再刷新历史状态。`);
    }
    const before = buildSummary(selection, db);
    const rows = selectedUploadedRows(db, selection);
    const candidates = refreshCandidates(rows);
    writeJob(job, {
      status: 'RUNNING',
      before,
      total: candidates.length,
      completed: 0,
      refreshed: 0,
      failed: 0,
      progress: candidates.length ? 1 : 100,
      message: `已从所选区间全部上传数据读取 ${rows.length.toLocaleString('zh-CN')} 个唯一单号；排除POD/退回/取消终态后，${candidates.length.toLocaleString('zh-CN')}票将全部重新请求CE状态。`
    });
    if (!candidates.length) {
      const after = buildSummary(selection, db);
      return writeJob(job, { status: 'COMPLETED', after, progress: 100, message: '所选区间当前没有需要刷新的非终态票。' });
    }

    const family = selection.businessType === 'WHPP' ? 'WHPP' : 'CCSL';
    const refreshDate = cambodiaDate();
    const totalChunks = Math.ceil(candidates.length / CHUNK_SIZE);
    let refreshed = 0;
    let failed = 0;
    for (let offset = 0; offset < candidates.length; offset += CHUNK_SIZE) {
      const chunk = candidates.slice(offset, offset + CHUNK_SIZE);
      const chunkNo = Math.floor(offset / CHUNK_SIZE) + 1;
      writeJob(job, {
        status: 'RUNNING',
        progress: Math.max(1, Math.floor((offset / candidates.length) * 95)),
        completed: offset,
        refreshed,
        failed,
        message: `正在先扫描、再轨迹复核全部非终态 · 第 ${chunkNo}/${totalChunks} 批 · ${offset}/${candidates.length}`
      });
      const outcome = await processCarryFamilyForRefresh(family, chunk, {
        client,
        reportDate: refreshDate,
        refreshId: `${job.jobId}-${chunkNo}`
      });
      if (outcome.successfulRows.length) {
        applySuccessfulCarryRefresh(outcome.successfulRows, { snapshotId: job.jobId, reportDate: refreshDate });
      }
      refreshed += outcome.successfulRows.length;
      failed += outcome.failedBills.length;
      writeJob(job, {
        completed: Math.min(candidates.length, offset + chunk.length),
        refreshed,
        failed,
        progress: Math.min(96, Math.floor(((offset + chunk.length) / candidates.length) * 96))
      });
      if (!outcome.successfulRows.length && outcome.failedBills.length >= chunk.length) {
        throw new Error(`第${chunkNo}批 ${chunk.length} 票全部CE查询失败，已停止，避免错误覆盖状态。`);
      }
    }
    const after = buildSummary(selection, db);
    const newPod = Math.max(0, Number(after.pod || 0) - Number(before.pod || 0));
    const newReturned = Math.max(0, Number(after.returned || 0) - Number(before.returned || 0));
    writeJob(job, {
      status: 'COMPLETED',
      after,
      progress: 100,
      completed: candidates.length,
      refreshed,
      failed,
      newPod,
      newReturned,
      message: `复核完成 · ${selection.businessType} 本次重新查询 ${candidates.length.toLocaleString('zh-CN')} 票 · 新增POD ${newPod} · 新增退回 ${newReturned} · 仍非终态 ${Number(after.toRefresh || 0).toLocaleString('zh-CN')}`
    });
  } catch (error) {
    writeJob(job, { status: 'FAILED', progress: 100, error: text(error?.message || error), message: text(error?.message || error) });
  } finally {
    if (activeByKey.get(key) === job.jobId) activeByKey.delete(key);
  }
}

function summaryHandler(req, res) {
  try {
    const selection = validateSelection(req.query || {});
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildSummary(selection));
  } catch (error) {
    res.status(400).json({ ok: false, error: text(error?.message || error) });
  }
}
function startHandler(req, res) {
  try {
    cleanupJobs();
    const selection = validateSelection(req.body || {});
    const key = selectionKey(selection);
    const existingId = activeByKey.get(key);
    if (existingId) {
      const existing = jobs.get(existingId);
      if (existing && ['QUEUED', 'WAITING', 'RUNNING'].includes(text(existing.status).toUpperCase())) return res.json({ ok: true, ...existing });
    }
    const jobId = `V227-${selection.businessType}-${crypto.randomUUID()}`;
    const job = {
      jobId,
      selection,
      status: 'QUEUED',
      progress: 0,
      total: 0,
      completed: 0,
      refreshed: 0,
      failed: 0,
      message: '正在创建多业务历史非终态状态刷新任务…',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    jobs.set(jobId, job);
    activeByKey.set(key, jobId);
    setImmediate(() => { void runJob(job); });
    res.json({ ok: true, ...job });
  } catch (error) {
    res.status(400).json({ ok: false, error: text(error?.message || error) });
  }
}
function jobHandler(req, res) {
  cleanupJobs();
  const job = jobs.get(text(req.params?.jobId));
  if (!job) return res.status(404).json({ ok: false, error: '历史状态刷新任务不存在或已过期。' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, ...job });
}

const previousGet = express.application.get;
express.application.get = function v227MultiBusinessHistoryGet(pathValue, ...handlers) {
  const path = String(pathValue || '');
  if (path === SUMMARY_ROUTE && handlers.length) return this.route(pathValue).get(summaryHandler);
  if (path === JOB_ROUTE && handlers.length) return this.route(pathValue).get(jobHandler);
  return previousGet.call(this, pathValue, ...handlers);
};
const previousPost = express.application.post;
express.application.post = function v227MultiBusinessHistoryPost(pathValue, ...handlers) {
  if (String(pathValue || '') === START_ROUTE && handlers.length) return this.route(pathValue).post(startHandler);
  return previousPost.call(this, pathValue, ...handlers);
};

console.info('[CE-QC][V227_MULTI_BUSINESS_HISTORY_REFRESH]', V227_MULTI_BUSINESS_HISTORY_REFRESH_ID, 'CE/CEAF/TBKH/ALI1688/WHPP enabled; read is read-only, refresh scans then tracks only remaining non-terminal shipments');
