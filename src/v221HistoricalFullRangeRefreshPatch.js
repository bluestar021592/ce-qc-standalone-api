import express from 'express';
import crypto from 'node:crypto';
import { getDb } from './db.js';
import { CEClient } from './ceClient.js';
import { runQcPipeline } from './pipeline.js';
import {
  buildCarryRefreshState,
  applySuccessfulCarryRefresh,
  activeBusinessProcessingDetails
} from './carryoverRefreshScheduler.js';

const VERSION = '2026-08-22-v223-full-upload-terminal-event-lock-v1';
const SUMMARY_ROUTE = '/api/v183/history-refresh/summary';
const START_ROUTE = '/api/v183/history-refresh/start';
const JOB_ROUTE = '/api/v183/history-refresh/job/:jobId';
const ALLOWED_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const CHUNK_SIZE = Math.max(100, Math.min(350, Number(process.env.HISTORY_FULL_REFRESH_CHUNK || 300)));
const SHIPMENT_TRACK_BATCH = Math.max(20, Math.min(100, Number(process.env.HISTORY_SHIPMENT_TRACK_BATCH || 50)));
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const jobs = new Map();
const activeByKey = new Map();

function text(value) { return String(value ?? '').trim(); }
function billOf(row = {}) { return text(row.shipmentCode || row.运单号 || row.waybill).toUpperCase(); }
function dateKey(value = '') {
  const v = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function validateSelection(input = {}) {
  const businessType = text(input.businessType).toUpperCase();
  const fromDate = dateKey(input.fromDate);
  const toDate = dateKey(input.toDate);
  if (!ALLOWED_TYPES.has(businessType)) throw new Error('历史状态刷新当前仅支持 SHOPEE CN / SHOPEE VN。');
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
  return new Set(dates.map(value => text(value).slice(0, 10)).filter(Boolean)).size;
}
function classifyState(row = {}) {
  const stateJson = safeJson(row.stateJson, {});
  const closeReason = text(row.closeReason).toUpperCase();
  const stateName = text(row.state || stateJson.currentState || stateJson.scanNormalizedState || stateJson.state).toUpperCase();
  const orderStatus = text(stateJson.orderStatus);
  const latestCode = text(stateJson.latestTrackStatusCode || stateJson.lastEventCode || stateJson.eventCode || stateJson.trackingEventCode);
  const evidence = [
    closeReason, stateName, stateJson.退回状态, stateJson.primaryCategory, stateJson.currentMainCategory,
    stateJson.主分类, stateJson.异常分类, stateJson.latestEventDesc, stateJson.最后节点
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

function selectedUploadedRows(db, selection) {
  const rows = db.prepare(`
    WITH ranked_batches AS (
      SELECT b.snapshotId,b.reportDate,b.createdAt,b.batchId,
             ROW_NUMBER() OVER (PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) AS rn
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.status='VALID' AND s.status='COMPLETED'
        AND b.reportDate BETWEEN ? AND ?
    ), uploaded AS (
      SELECT UPPER(TRIM(u.shipmentCode)) AS shipmentCode,
             MIN(r.reportDate) AS sourceReportDate,
             MAX(r.reportDate) AS lastImportedDate
      FROM ranked_batches r
      INNER JOIN unified_import_rows u ON u.snapshotId=r.snapshotId
      WHERE r.rn=1 AND u.businessType=? AND TRIM(COALESCE(u.shipmentCode,''))<>''
      GROUP BY UPPER(TRIM(u.shipmentCode))
    )
    SELECT u.shipmentCode,u.sourceReportDate,u.lastImportedDate,
           c.status AS carryStatus,c.apiStatus AS carryApiStatus,c.closeReason AS carryCloseReason,
           c.stateJson AS carryStateJson,c.updatedAt AS carryUpdatedAt,c.lastReportDate AS carryLastReportDate,
           s.state AS currentState,s.apiStatus AS currentApiStatus,s.stateJson AS currentStateJson,
           s.updatedAt AS currentUpdatedAt,s.lastEventTime AS currentLastEventTime,s.reportDate AS currentReportDate
    FROM uploaded u
    LEFT JOIN carryover_open_items c ON c.shipmentCode=u.shipmentCode
    LEFT JOIN shipment_current_state s ON s.shipmentCode=u.shipmentCode
    ORDER BY u.sourceReportDate,u.shipmentCode
  `).all(selection.fromDate, selection.toDate, selection.businessType);

  return rows.map(row => {
    const carryJson = safeJson(row.carryStateJson, {});
    const currentJson = safeJson(row.currentStateJson, {});
    const carryProbe = { closeReason: row.carryCloseReason, state: '', stateJson: carryJson };
    const currentProbe = { closeReason: '', state: row.currentState, stateJson: currentJson };
    const carryCls = classifyState(carryProbe);
    const currentCls = classifyState(currentProbe);
    const terminal = currentCls.pod || currentCls.returned || currentCls.cancelled ? currentCls : carryCls;
    const terminalReason = terminal.pod ? 'POD' : terminal.returned ? 'RETURNED' : terminal.cancelled ? 'ORDER_CANCELLED' : '';
    const mergedState = { ...carryJson, ...currentJson, shipmentCode: row.shipmentCode, businessType: selection.businessType };
    return {
      shipmentCode: row.shipmentCode,
      businessType: selection.businessType,
      sourceReportDate: row.sourceReportDate,
      lastReportDate: row.currentReportDate || row.carryLastReportDate || row.lastImportedDate,
      status: terminalReason ? 'CLOSED' : (text(row.carryStatus).toUpperCase() === 'CLOSED' && ['POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED'].includes(text(row.carryCloseReason).toUpperCase()) ? 'CLOSED' : 'OPEN'),
      apiStatus: row.currentApiStatus || row.carryApiStatus || '',
      closeReason: terminalReason || row.carryCloseReason || '',
      stateJson: JSON.stringify(mergedState),
      updatedAt: [row.currentUpdatedAt, row.carryUpdatedAt].filter(Boolean).sort().at(-1) || ''
    };
  });
}
function refreshCandidates(rows) { return rows.filter(row => { const cls = classifyState(row); return !cls.pod && !cls.returned && !cls.cancelled; }); }
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
    ok: true, version: VERSION, source: 'ALL_UPLOADED_VALID_COMPLETED_DAILY_SNAPSHOTS', ...selection,
    total: rows.length, pod, returned, cancelled, pending, delivering, open: toRefresh, toRefresh,
    failed, pendingTimes, terminal: pod + returned + cancelled, lastRefreshAt, generatedAt: new Date().toISOString()
  };
}
function sortFreshEvents(rows = []) {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(text(a.eventTime || a.creationDate || a.lastUpdateDate)) || 0;
    const tb = Date.parse(text(b.eventTime || b.creationDate || b.lastUpdateDate)) || 0;
    if (ta !== tb) return ta - tb;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}
function freshTrackEventText(row = {}) {
  return [
    row.trackingEventDescZh,row.trackingEventDesc,row.trackingEventDescKm,row.statusText,row.statusDesc,row.statusDescription,
    row.remark,row.place,row.eventShop,row.locationCode
  ].map(text).filter(Boolean).join(' ').toUpperCase();
}
function terminalText(row = {}) {
  return [
    row.currentState,row.state,row.status,row.statusName,row.statusDesc,row.statusDescription,row.shipmentStatusName,row.shipmentStatusDesc,
    row.trackStatus,row.trackStatusName,row.trackStatusDesc,row.returnStatus,row.returnState,row.退回状态,row.状态说明,row.latestEventDesc,row.lastEventDesc
  ].map(text).filter(Boolean).join(' ');
}
function terminalFromShipmentTrackRows(rows = [], shipmentCode) {
  const bill = text(shipmentCode).toUpperCase();
  const matched = rows.filter(row => billOf(row) === bill);
  for (const row of matched) {
    const orderStatus = text(row.orderStatus);
    const code = text(row.eventCode || row.trackingEventCode || row.statusCode || row.latestTrackStatusCode || row.lastEventCode);
    const statusText = terminalText(row).toUpperCase();
    const returnInProgress = /RETURN_IN_PROGRESS|退回处理中|正在退回/.test(statusText);
    if (orderStatus === '85' || code === '80' || /(^|\s)POD($|\s)|已签收|签收成功/.test(statusText)) {
      return { reason: 'POD', source: 'CE_SHIPMENT_TRACK_POD', time: text(row.podTime || row.POD时间 || row.lastEventTime || row.latestEventTime || row.updateTime) };
    }
    if (!returnInProgress && (orderStatus === '100' || code === '86' || /RETURN_COMPLETED|RETURNED|已退回|退回完成/.test(statusText))) {
      return { reason: 'RETURNED', source: 'CE_SHIPMENT_TRACK_RETURN', time: text(row.returnTime || row.退回完成时间 || row.lastEventTime || row.latestEventTime || row.updateTime) };
    }
  }
  return null;
}
async function queryShipmentTrackEvidence(client, bills = []) {
  const rows = [];
  let failedBatches = 0;
  for (let index = 0; index < bills.length; index += SHIPMENT_TRACK_BATCH) {
    const batch = bills.slice(index, index + SHIPMENT_TRACK_BATCH);
    try {
      const result = await client.shipmentTrack(batch);
      if (Array.isArray(result)) rows.push(...result);
    } catch (error) {
      failedBatches += 1;
      console.warn('[CE-QC][V223] shipment-track supplemental probe failed:', error?.message || error);
    }
  }
  return { rows, failedBatches };
}
function freshTerminalEvidence(state, shipmentTrackRows, shipmentCode) {
  const bill = text(shipmentCode).toUpperCase();
  const scans = (state.scanResults || []).filter(row => billOf(row) === bill);
  for (const row of scans) {
    const orderStatus = text(row.orderStatus);
    if (orderStatus === '85') return { reason: 'POD', source: 'CE_CONFIRM_ORDER_STATUS_85', time: text(row.POD时间 || row.latestEventTime) };
    if (orderStatus === '100') return { reason: 'RETURNED', source: 'CE_CONFIRM_ORDER_STATUS_100', time: text(row.退回完成时间 || row.latestEventTime) };
  }

  // POD/return are terminal locks. CE can append later administrative/non-terminal
  // trajectory rows after a genuine code80/code86. Historical refresh must not
  // reopen that parcel merely because 80/86 is not the literal last row.
  const events = sortFreshEvents((state.trackEvents || []).filter(row => billOf(row) === bill));
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const code = text(event?.eventCode || event?.trackingEventCode || event?.statusCode);
    const eventText = freshTrackEventText(event);
    const eventTime = text(event?.eventTime || event?.creationDate || event?.lastUpdateDate);
    if (code === '80') return { reason: 'POD', source: 'CE_TRACK_TERMINAL_CODE_80', time: eventTime };
    if (code === '86') return { reason: 'RETURNED', source: 'CE_TRACK_TERMINAL_CODE_86', time: eventTime };
    if (/RETURN_COMPLETED|(^|\s)RETURNED($|\s)|已退回|退回完成/.test(eventText) && !/RETURN_IN_PROGRESS|退回处理中|正在退回/.test(eventText)) {
      return { reason: 'RETURNED', source: 'CE_TRACK_TERMINAL_TEXT_RETURN', time: eventTime };
    }
  }
  return terminalFromShipmentTrackRows(shipmentTrackRows, bill);
}
function normalizeFreshTerminal(row, evidence) {
  if (!evidence) return row;
  if (evidence.reason === 'POD') {
    return {
      ...row, 是否POD: '是', POD状态: 'POD', currentState: 'POD', scanNormalizedState: row.scanNormalizedState || 'POD',
      POD时间: row.POD时间 || evidence.time || '', 退回状态: '未退回', primaryCategory: 'POD', 主分类: 'POD', 异常分类: 'POD',
      carry状态: 'closed_pod', 跨日状态: '已闭环', freshTerminalSource: evidence.source
    };
  }
  return {
    ...row, 是否POD: '否', POD状态: '未POD', currentState: 'RETURN_COMPLETED', 退回状态: '已退回',
    退回完成时间: row.退回完成时间 || evidence.time || '', 退回时间: row.退回时间 || evidence.time || '',
    primaryCategory: '退回', 主分类: '退回', 异常分类: '退回', carry状态: 'closed_return', 跨日状态: '已闭环',
    freshTerminalSource: evidence.source
  };
}
function stripUnverifiedTerminal(row = {}) {
  const state = text(row.currentState).toUpperCase();
  const claimsPod = row.是否POD === '是' || state === 'POD';
  const claimsReturn = row.退回状态 === '已退回' || ['RETURNED','RETURN_COMPLETED'].includes(state);
  if (!claimsPod && !claimsReturn) return row;
  return {
    ...row,
    是否POD: '否', POD状态: '未POD', POD时间: '',
    currentState: 'OPEN_RECHECK_REQUIRED', 退回状态: '未退回', 退回完成时间: '', 退回时间: '',
    primaryCategory: '需人工复核', 主分类: '需人工复核', 异常分类: '需人工复核',
    carry状态: 'active', 跨日状态: '待复核', freshTerminalMismatch: true,
    QC判断: '分析结果声称终态，但本次CE扫描/轨迹/shipment-track均无对应终态证据，保持非终态等待复核'
  };
}
function currentRowFailed(row = {}) {
  return /失败|REFRESH_FAILED|PENDING_RETRY|SCAN_RETRY|TRACK_RETRY|待重试/i.test(`${row.API状态 || ''} ${row.查询状态 || ''} ${row.apiStatus || ''}`);
}
async function processChunk(rows, { client, reportDate, refreshId }) {
  const state = buildCarryRefreshState('SHOPEE', rows, reportDate, refreshId);
  let pipelineError = null;
  try { await runQcPipeline({ state, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false }); }
  catch (error) { pipelineError = error; }

  const bills = rows.map(row => billOf(row)).filter(Boolean);
  const shipmentTrackProbe = await queryShipmentTrackEvidence(client, bills);
  const allowed = new Set(bills);
  const byBill = new Map();
  for (const row of (state.finalRows?.length ? state.finalRows : state.trackResults || [])) {
    const bill = billOf(row);
    if (bill && allowed.has(bill) && !currentRowFailed(row)) byBill.set(bill, row);
  }
  const successfulRows = [];
  const failedBills = [];
  let freshPod = 0, freshReturned = 0, scanReturn100 = 0, trackReturn86 = 0, trackReturnText = 0, shipmentTrackReturned = 0, shipmentTrackPod = 0, terminalMismatch = 0;
  for (const source of rows) {
    const bill = billOf(source);
    const row = byBill.get(bill);
    if (!row) { failedBills.push(bill); continue; }
    const evidence = freshTerminalEvidence(state, shipmentTrackProbe.rows, bill);
    const normalized = evidence ? normalizeFreshTerminal(row, evidence) : stripUnverifiedTerminal(row);
    if (normalized.freshTerminalMismatch) terminalMismatch += 1;
    successfulRows.push(normalized);
    if (evidence?.reason === 'POD') {
      freshPod += 1;
      if (evidence.source === 'CE_SHIPMENT_TRACK_POD') shipmentTrackPod += 1;
    }
    if (evidence?.reason === 'RETURNED') {
      freshReturned += 1;
      if (evidence.source === 'CE_CONFIRM_ORDER_STATUS_100') scanReturn100 += 1;
      if (evidence.source === 'CE_TRACK_TERMINAL_CODE_86') trackReturn86 += 1;
      if (evidence.source === 'CE_TRACK_TERMINAL_TEXT_RETURN') trackReturnText += 1;
      if (evidence.source === 'CE_SHIPMENT_TRACK_RETURN') shipmentTrackReturned += 1;
    }
  }
  return {
    successfulRows, failedBills, freshPod, freshReturned, scanReturn100, trackReturn86, trackReturnText,
    shipmentTrackReturned, shipmentTrackPod, shipmentTrackFailedBatches: shipmentTrackProbe.failedBatches,
    terminalMismatch, pipelineError
  };
}
function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    const stamp = Date.parse(job.updatedAt || job.createdAt || '') || 0;
    if (stamp && stamp < cutoff && !['QUEUED','WAITING','RUNNING'].includes(text(job.status).toUpperCase())) jobs.delete(id);
  }
}
function writeJob(job, patch = {}) { Object.assign(job, patch, { updatedAt: new Date().toISOString() }); return job; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function runJob(job) {
  const db = getDb();
  const selection = job.selection;
  try {
    const before = buildSummary(selection, db);
    const allUploadedRows = selectedUploadedRows(db, selection);
    const candidates = refreshCandidates(allUploadedRows);
    writeJob(job, {
      status: 'WAITING', progress: 0, before, total: candidates.length, completed: 0, refreshed: 0, failed: 0,
      uploadedTotal: allUploadedRows.length, terminalSkipped: allUploadedRows.length - candidates.length,
      message: `已从所选区间全部上传日报读取 ${allUploadedRows.length.toLocaleString('zh-CN')} 个唯一单号；排除POD/退回/取消终态后，${candidates.length.toLocaleString('zh-CN')} 票将全部重新请求CE扫描+轨迹+shipment-track状态。`
    });
    if (!candidates.length) {
      writeJob(job, { status: 'COMPLETED', progress: 100, after: before, message: '所选区间全部上传单号都已进入POD/退回/取消终态，无需刷新。', completedAt: new Date().toISOString() });
      return;
    }
    while (true) {
      const active = activeBusinessProcessingDetails(db);
      if (!active.active) break;
      writeJob(job, { status: 'WAITING', message: '历史全量非终态复核已排队，正在等待当前业务处理任务结束；释放后自动开始。' });
      await wait(2000);
    }
    const client = new CEClient();
    const refreshDate = cambodiaDate();
    let refreshed = 0, failed = 0, freshPod = 0, freshReturned = 0, scanReturn100 = 0, trackReturn86 = 0, trackReturnText = 0;
    let shipmentTrackReturned = 0, shipmentTrackPod = 0, shipmentTrackFailedBatches = 0, terminalMismatch = 0;
    const failedSet = new Set();
    for (let offset = 0; offset < candidates.length; offset += CHUNK_SIZE) {
      const chunk = candidates.slice(offset, offset + CHUNK_SIZE);
      const chunkNo = Math.floor(offset / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(candidates.length / CHUNK_SIZE);
      writeJob(job, {
        status: 'RUNNING', progress: Math.max(1, Math.floor((offset / candidates.length) * 95)),
        completed: offset, total: candidates.length,
        message: `正在逐票复核全部非终态 · 第 ${chunkNo}/${totalChunks} 批 · ${offset}/${candidates.length}`
      });
      const outcome = await processChunk(chunk, { client, reportDate: refreshDate, refreshId: `${job.jobId}-${chunkNo}` });
      if (!outcome.successfulRows.length && outcome.failedBills.length >= chunk.length) {
        const reason = outcome.pipelineError?.message || '本批全部CE查询失败';
        throw new Error(`第${chunkNo}批 ${chunk.length} 票成功0票，已停止：${reason}`);
      }
      if (outcome.successfulRows.length) applySuccessfulCarryRefresh(outcome.successfulRows, { snapshotId: job.jobId, reportDate: refreshDate });
      refreshed += outcome.successfulRows.length;
      freshPod += outcome.freshPod;
      freshReturned += outcome.freshReturned;
      scanReturn100 += outcome.scanReturn100;
      trackReturn86 += outcome.trackReturn86;
      trackReturnText += outcome.trackReturnText;
      shipmentTrackReturned += outcome.shipmentTrackReturned;
      shipmentTrackPod += outcome.shipmentTrackPod;
      shipmentTrackFailedBatches += outcome.shipmentTrackFailedBatches;
      terminalMismatch += outcome.terminalMismatch;
      for (const bill of outcome.failedBills) failedSet.add(bill);
      failed = failedSet.size;
      writeJob(job, {
        status: 'RUNNING', progress: Math.max(2, Math.min(98, Math.floor(((offset + chunk.length) / candidates.length) * 98))),
        completed: Math.min(offset + chunk.length, candidates.length), refreshed, failed,
        freshPod, freshReturned, scanReturn100, trackReturn86, trackReturnText, shipmentTrackReturned, shipmentTrackPod, shipmentTrackFailedBatches, terminalMismatch,
        message: `全量非终态复核中 · 已处理 ${Math.min(offset + chunk.length, candidates.length)}/${candidates.length} · CE确认POD ${freshPod} · CE确认退回 ${freshReturned} · 轨迹86 ${trackReturn86} · 轨迹退回文本 ${trackReturnText} · 待重试 ${failed}`
      });
    }
    const after = buildSummary(selection, db);
    writeJob(job, {
      status: 'COMPLETED', progress: 100, completed: candidates.length, refreshed, failed, before, after,
      freshPod, freshReturned, scanReturn100, trackReturn86, trackReturnText, shipmentTrackReturned, shipmentTrackPod, shipmentTrackFailedBatches, terminalMismatch,
      newlyPod: Math.max(0, after.pod - before.pod), newlyReturned: Math.max(0, after.returned - before.returned),
      message: `复核完成 · 本次从全部上传数据中重新查询 ${candidates.length.toLocaleString('zh-CN')} 票 · 新增POD ${Math.max(0, after.pod - before.pod)} · 新增退回 ${Math.max(0, after.returned - before.returned)} · CE退回证据 ${freshReturned}（扫描100=${scanReturn100}，轨迹86=${trackReturn86}，轨迹退回文本=${trackReturnText}，shipment-track=${shipmentTrackReturned}）· CE确认POD ${freshPod}（shipment-track=${shipmentTrackPod}）· 无新鲜终态证据但分析曾声称终态 ${terminalMismatch} · shipment-track失败批次 ${shipmentTrackFailedBatches} · 仍非终态 ${after.toRefresh}`,
      completedAt: new Date().toISOString()
    });
  } catch (error) {
    writeJob(job, { status: 'FAILED', message: error?.message || String(error), error: error?.stack || String(error), failedAt: new Date().toISOString() });
  } finally {
    activeByKey.delete(selectionKey(selection));
  }
}
function summaryHandler(req, res) {
  try {
    const selection = validateSelection(req.query || {});
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-CE-QC-History-Authority', 'V223-UPLOADED-RANGE');
    res.json(buildSummary(selection));
  } catch (error) { res.status(400).json({ ok: false, error: error?.message || String(error) }); }
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
    const jobId = `HREF223-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const job = { ok: true, version: VERSION, jobId, selection, status: 'QUEUED', progress: 0, message: '已创建全上传区间非终态复核任务（终态事件锁）', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    jobs.set(jobId, job); activeByKey.set(key, jobId); setImmediate(() => runJob(job));
    res.status(202).json({ ok: true, jobId, status: job.status, progress: 0, message: job.message });
  } catch (error) { res.status(400).json({ ok: false, error: error?.message || String(error) }); }
}
function jobHandler(req, res) {
  cleanupJobs();
  const job = jobs.get(text(req.params?.jobId));
  if (!job) return res.status(404).json({ ok: false, error: '历史状态刷新任务不存在或已过期。' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, ...job });
}

const previousGet = express.application.get;
express.application.get = function v223HistoryGet(pathValue, ...handlers) {
  const path = String(pathValue || '');
  if (path === SUMMARY_ROUTE && handlers.length) {
    console.log('[CE-QC][V223] replaced history summary with uploaded-range authority');
    return this.route(pathValue).get(summaryHandler);
  }
  if (path === JOB_ROUTE && handlers.length) return this.route(pathValue).get(jobHandler);
  return previousGet.call(this, pathValue, ...handlers);
};
const previousPost = express.application.post;
express.application.post = function v223HistoryPost(pathValue, ...handlers) {
  if (String(pathValue || '') === START_ROUTE && handlers.length) {
    console.log('[CE-QC][V223] terminal POD/return events remain locked even when later administrative track rows exist');
    return this.route(pathValue).post(startHandler);
  }
  return previousPost.call(this, pathValue, ...handlers);
};

export const V221_HISTORICAL_FULL_RANGE_REFRESH_ID = VERSION;
