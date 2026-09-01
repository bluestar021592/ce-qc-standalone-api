import crypto from 'crypto';
import { getDb, nowIso } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';
import { isWhppCancelledRow } from './whppAnalyzer.js';
import { isSpecialCategory } from './specialNode.js';

export const WHPP = 'WHPP';

export function loadWhppState() {
  const row = getDb().prepare('SELECT valueJson FROM business_states WHERE businessType=?').get(WHPP);
  if (!row) return emptyWhppState();
  try { return { ...emptyWhppState(), ...JSON.parse(row.valueJson || '{}'), businessType: WHPP }; }
  catch { return emptyWhppState(); }
}

export function saveWhppState(state = {}) {
  const normalized = { ...emptyWhppState(), ...state, businessType: WHPP };
  const now = nowIso();
  getDb().prepare(`INSERT INTO business_states(businessType,valueJson,updatedAt) VALUES(?,?,?)
    ON CONFLICT(businessType) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`)
    .run(WHPP, JSON.stringify(normalized), now);
  return normalized;
}

function isFinalizedWhppDaily(summary = {}) {
  const status = String(summary.snapshotStatus || summary.reconciliationStatus || '').toUpperCase();
  return Boolean(
    summary.completed === true
    && ['COMPLETED', 'COMPLETED_WITH_RETRY'].includes(status)
    && String(summary.finalizedSnapshotId || '').trim()
  );
}

function restoreFinalizedWhppState(reportDate, summary, reason = 'EXPLICIT_REHYDRATE') {
  const finalizedSnapshotId = String(summary.finalizedSnapshotId || '').trim();
  const payload = loadWhppSnapshot(finalizedSnapshotId);
  const persisted = payload?.state && typeof payload.state === 'object' ? payload.state : null;
  if (!persisted) {
    const error = new Error(`WHPP ${reportDate} 已完成，但完成快照 ${finalizedSnapshotId} 无法恢复；已阻止把完成态覆盖为待处理。`);
    error.code = 'WHPP_FINALIZED_REHYDRATE_SNAPSHOT_MISSING';
    error.reportDate = reportDate;
    error.finalizedSnapshotId = finalizedSnapshotId;
    throw error;
  }
  const restored = saveWhppState({
    ...persisted,
    reportDate,
    dailyReportReady: true,
    snapshotId: finalizedSnapshotId || persisted.snapshotId || '',
    snapshotStatus: 'COMPLETED',
    processing: {
      ...(persisted.processing || {}),
      running: false,
      paused: false,
      phase: '完成'
    }
  });
  restored.finalizedLifecyclePreserved = true;
  restored.finalizedLifecyclePreserveReason = reason;
  console.log(`[CE-QC][WHPP_FINALIZED_REHYDRATE_NOOP] reportDate=${reportDate} snapshot=${finalizedSnapshotId} reason=${reason}`);
  return restored;
}

function inspectExistingWhppDaily(db, reportDate, incomingRows = []) {
  const daily = db.prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);
  const summary = safeJson(daily?.summaryJson, {});
  if (!daily) return { exists: false, finalized: false, identicalMembership: false, summary };
  const incoming = uniqueRows(incomingRows).map(billOf).filter(Boolean).sort();
  const stored = db.prepare("SELECT DISTINCT shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY shipmentCode").all(reportDate)
    .map(row => String(row.shipmentCode || '').trim().toUpperCase()).filter(Boolean);
  const headerCount = Number(daily.totalCount || 0);
  const identicalMembership = headerCount === incoming.length
    && stored.length === incoming.length
    && stored.every((bill, index) => bill === incoming[index]);
  return { exists: true, finalized: isFinalizedWhppDaily(summary), identicalMembership, summary };
}

export function saveWhppDailyImport({ reportDate, sourceName = '', rows = [], batchId = '', snapshotId = '', preserveFinalizedLifecycle = false }) {
  const db = getDb();
  const now = nowIso();
  const unique = uniqueRows(rows).map(row => ({ ...row, businessType: WHPP, reportDate }));
  const todayBills = new Set(unique.map(billOf));
  const prior = loadWhppState();

  // V399: a finalized WHPP daily is immutable when the exact same shipment
  // membership is uploaded again. This covers both the explicit V366 rehydrate
  // path and a normal same-date workbook reupload that still contains WHPP rows.
  // Only a real membership change is allowed to clear the completion lifecycle.
  const existingDaily = inspectExistingWhppDaily(db, reportDate, unique);
  if (existingDaily.finalized && (preserveFinalizedLifecycle === true || existingDaily.identicalMembership)) {
    return restoreFinalizedWhppState(
      reportDate,
      existingDaily.summary,
      preserveFinalizedLifecycle === true ? 'EXPLICIT_REHYDRATE' : 'IDENTICAL_MEMBERSHIP_REUPLOAD'
    );
  }

  const carryBills = db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE businessType='WHPP' AND status='OPEN' ORDER BY shipmentCode").all().map(row => row.shipmentCode);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET sourceFile=excluded.sourceFile,totalCount=excluded.totalCount,summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`)
      .run(WHPP, reportDate, sourceName, unique.length, JSON.stringify({ batchId, snapshotId, total: unique.length }), now, now);
    db.prepare('DELETE FROM business_daily_parse_rows WHERE businessType=? AND reportDate=?').run(WHPP, reportDate);
    const insertParse = db.prepare(`INSERT INTO business_daily_parse_rows(
      businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const upsertCurrent = db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt)
      VALUES(?,?,?,?,?,'PENDING_SCAN','',?,?)
      ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,snapshotId=excluded.snapshotId,
        state=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN shipment_current_state.state ELSE 'PENDING_SCAN' END,
        apiStatus=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN shipment_current_state.apiStatus ELSE 'PENDING_SCAN' END,
        lastEventTime=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN shipment_current_state.lastEventTime ELSE '' END,
        stateJson=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN shipment_current_state.stateJson ELSE excluded.stateJson END,
        updatedAt=excluded.updatedAt`);
    const upsertCarry = db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,'OPEN','PENDING_SCAN','',?,?,?)
      ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,lastReportDate=excluded.lastReportDate,lastSnapshotId=excluded.lastSnapshotId,
        status=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP','NORMAL_FINAL') THEN 'CLOSED' ELSE 'OPEN' END,
        apiStatus=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP','NORMAL_FINAL') THEN carryover_open_items.apiStatus ELSE 'PENDING_SCAN' END,
        closeReason=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP','NORMAL_FINAL') THEN carryover_open_items.closeReason ELSE '' END,
        stateJson=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP','NORMAL_FINAL') THEN carryover_open_items.stateJson ELSE excluded.stateJson END,
        updatedAt=excluded.updatedAt`);

    for (const row of unique) {
      const bill = billOf(row);
      const rawJson = JSON.stringify(row);
      insertParse.run(WHPP, reportDate, bill, row.sheetName || '', Number(row.rowNumber || 0), Number(row.rowNumber || 0), row.recipientRaw || '', row.recipientNormalized || '', 'WHPP', 'SHIPMENT_PREFIX_CE', '', rawJson, now);
      upsertCurrent.run(bill, WHPP, reportDate, snapshotId || batchId || '', 'PENDING_SCAN', rawJson, now);
      upsertCarry.run(bill, WHPP, reportDate, reportDate, snapshotId || batchId || '', snapshotId || batchId || '', rawJson, now, now);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  // POD locks are needed only for today's WHPP members (plus any defensive OPEN
  // carry inconsistency), never for every WHPP shipment ever seen. The old global
  // businessType/state scan became unbounded as the 18+ GiB database accumulated.
  // Both sides below start from small indexed membership sets and probe the
  // shipmentCode primary key, keeping a new daily import proportional to the day.
  const podLocks = db.prepare(`
    SELECT d.shipmentCode
    FROM business_daily_parse_rows d
    JOIN shipment_current_state s ON s.shipmentCode=d.shipmentCode
    WHERE d.businessType='WHPP' AND d.reportDate=? AND UPPER(COALESCE(s.state,''))='POD'
    UNION
    SELECT c.shipmentCode
    FROM carryover_open_items c
    JOIN shipment_current_state s ON s.shipmentCode=c.shipmentCode
    WHERE c.businessType='WHPP' AND c.status='OPEN' AND UPPER(COALESCE(s.state,''))='POD'
    ORDER BY 1
  `).all(reportDate).map(row => row.shipmentCode);

  const state = saveWhppState({
    ...emptyWhppState(),
    reportDate,
    sourceName,
    batchId,
    sourceSnapshotId: snapshotId,
    dailyReportReady: true,
    pnhBills: unique.map(billOf),
    dailyParseRows: unique,
    carryBills: [...new Set(carryBills.filter(bill => !todayBills.has(bill)))],
    nextCarryBills: [...new Set(carryBills)],
    podLocks,
    previousReportDate: prior.reportDate || '',
    processing: { running: false, paused: false, phase: '待处理', batchIndex: 0, totalBatches: 0 },
    lastRunSummary: null,
    lastRun: null
  });
  return state;
}

export function finalizeWhppState(state = {}) {
  const db = getDb();
  const normalized = { ...state, businessType: WHPP };
  const reportDate = normalized.reportDate || '';
  const now = nowIso();
  const dashboard = buildWhppDashboard(normalized);
  if (!dashboard.accounting.balanced) {
    const error = new Error(`WHPP对账失败：总票${dashboard.accounting.total}，已核算${dashboard.accounting.accounted}，差额${dashboard.accounting.difference}`);
    error.code = 'WHPP_ACCOUNTING_RECONCILIATION_FAILED';
    error.accounting = dashboard.accounting;
    throw error;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['business_scan_results','business_track_events','business_exception_items','business_final_rows']) {
      db.prepare(`DELETE FROM ${table} WHERE businessType=? AND reportDate=?`).run(WHPP, reportDate);
    }

    const insertScan = db.prepare(`INSERT INTO business_scan_results(businessType,shipmentCode,reportDate,isPod,orderStatus,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of uniqueRows(normalized.scanResults || [])) {
      insertScan.run(WHPP, billOf(row), reportDate, isPod(row) ? 1 : 0, String(row.orderStatus ?? ''), row.recipient_raw || row.recipientRaw || '', row.recipient_normalized || row.recipientNormalized || '', 'WHPP', 'SHIPMENT_PREFIX_CE', Number(row.source_row_number || row.rowNumber || 0), JSON.stringify(row), now, now);
    }

    const insertEvent = db.prepare(`INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES(?,?,?,?,?,?,?)`);
    for (const row of normalized.trackEvents || []) insertEvent.run(WHPP, billOf(row), reportDate, row.eventTime || '', String(row.eventCode ?? ''), JSON.stringify(row), now);

    const insertException = db.prepare(`INSERT INTO business_exception_items(businessType,shipmentCode,reportDate,exceptionType,exceptionDesc,reportTime,statusCode,fileId,rawJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)`);
    for (const row of normalized.exceptionItems || []) insertException.run(WHPP, billOf(row), reportDate, String(row.exceptionType ?? ''), row.exceptionDesc || row.exceptionReason || '', row.reportTime || '', String(row.statusCode ?? ''), String(row.fileId ?? ''), JSON.stringify(row), now);

    const insertFinal = db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const updateCurrent = db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,snapshotId=excluded.snapshotId,state=excluded.state,apiStatus=excluded.apiStatus,lastEventTime=excluded.lastEventTime,stateJson=excluded.stateJson,updatedAt=excluded.updatedAt`);
    const updateCarry = db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,lastReportDate=excluded.lastReportDate,lastSnapshotId=excluded.lastSnapshotId,status=excluded.status,apiStatus=excluded.apiStatus,closeReason=excluded.closeReason,stateJson=excluded.stateJson,updatedAt=excluded.updatedAt`);

    const snapshotId = `WHPP-${reportDate}-${crypto.randomUUID()}`;
    for (const row of uniqueRows(normalized.finalRows || [])) {
      const terminal = terminalReason(row);
      const status = terminal ? 'CLOSED' : 'OPEN';
      const apiStatus = /失败|retry/i.test(String(row.API状态 || row.查询状态 || '')) ? 'API_PENDING_RETRY' : 'SUCCESS';
      const rawJson = JSON.stringify(row);
      insertFinal.run(WHPP, billOf(row), reportDate, isPod(row) ? 1 : 0, categoryOf(row), apiStatus, status, row.latestEventTime || row.最后节点时间 || '', row.latestEventDesc || row.最后节点 || '', row.latestNode || row.latestNodeCode || '', row.recipient_raw || row.recipientRaw || '', row.recipient_normalized || row.recipientNormalized || '', 'WHPP', 'SHIPMENT_PREFIX_CE', Number(row.source_row_number || row.rowNumber || 0), rawJson, now, now);
      updateCurrent.run(billOf(row), WHPP, reportDate, snapshotId, terminal || String(row.currentState || categoryOf(row) || 'OPEN'), apiStatus, row.latestEventTime || row.最后节点时间 || '', rawJson, now);
      updateCarry.run(billOf(row), WHPP, row.sourceReportDate || reportDate, reportDate, normalized.sourceSnapshotId || snapshotId, snapshotId, status, apiStatus, terminal, rawJson, now, now);
    }

    const payload = { state: { ...normalized, snapshotId }, dashboard, status: 'VALID', reconciliationStatus: 'COMPLETED' };
    db.prepare(`INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt) VALUES(?,?,?,?,?,?,?)`)
      .run(snapshotId, WHPP, reportDate, normalized.lastRunSummary?.runId || '', JSON.stringify(payload), now, now);
    db.prepare(`INSERT INTO business_history_summary(businessType,reportDate,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?)
      ON CONFLICT(businessType,reportDate) DO UPDATE SET summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`)
      .run(WHPP, reportDate, JSON.stringify({ ...dashboard.metrics, accounting: dashboard.accounting, snapshotId }), now, now);

    const dailyMetaRow = db.prepare('SELECT summaryJson FROM business_daily_reports WHERE businessType=? AND reportDate=? LIMIT 1').get(WHPP, reportDate);
    const dailyMeta = safeJson(dailyMetaRow?.summaryJson, {});
    db.prepare('UPDATE business_daily_reports SET summaryJson=?,updatedAt=? WHERE businessType=? AND reportDate=?')
      .run(JSON.stringify({
        ...dailyMeta,
        total: Number(dashboard.metrics?.total || 0),
        completed: true,
        snapshotStatus: 'COMPLETED',
        finalizedSnapshotId: snapshotId,
        finalizedAt: now
      }), now, WHPP, reportDate);

    normalized.snapshotId = snapshotId;
    normalized.snapshotStatus = 'COMPLETED';
    db.prepare(`INSERT INTO business_states(businessType,valueJson,updatedAt) VALUES(?,?,?) ON CONFLICT(businessType) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`)
      .run(WHPP, JSON.stringify(normalized), now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { state: normalized, dashboard: buildWhppDashboard(normalized), snapshotId: normalized.snapshotId };
}

export function listWhppHistory(limit = 120) {
  return getDb().prepare(`SELECT snapshotId,reportDate,runId,generatedAt,createdAt FROM business_export_snapshots WHERE businessType=? ORDER BY reportDate DESC,createdAt DESC LIMIT ?`)
    .all(WHPP, Math.max(1, Math.min(500, Number(limit) || 120)));
}

export function loadWhppSnapshot(snapshotId) {
  const row = getDb().prepare('SELECT payloadJson FROM business_export_snapshots WHERE businessType=? AND snapshotId=?').get(WHPP, snapshotId);
  if (!row) return null;
  try { return JSON.parse(row.payloadJson || '{}'); } catch { return null; }
}

export function buildCurrentWhppView() {
  const state = loadWhppState();
  return { state, dashboard: buildWhppDashboard(state) };
}

function terminalReason(row = {}) {
  if (isPod(row)) return 'POD';
  if (isReturned(row)) return 'RETURNED';
  if (isWhppCancelledRow(row)) return 'ORDER_CANCELLED';
  const special = String(row.specialState || row.primaryCategory || row.主分类 || '').toUpperCase();
  if (['CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP'].includes(special)) return special;
  if (['CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION'].includes(special)) return special === 'CCSL580_RETENTION' ? 'CCSL580_DIVERSION' : special;
  if (isSpecialCategory(row)) return special || 'NORMAL_FINAL';
  if (row.primaryCategory === '正常分流节点' || row.matchedRule === 'NORMAL_FINAL_HUB') return 'NORMAL_FINAL';
  return '';
}

function isPod(row = {}) {
  return row.是否POD === '是' || row.POD状态 === 'POD' || String(row.currentState || '').toUpperCase() === 'POD';
}
function isReturned(row = {}) {
  return row.退回状态 === '已退回' || ['RETURNED','RETURN_COMPLETED'].includes(String(row.currentState || '').toUpperCase()) || categoryOf(row) === '退回';
}
function categoryOf(row = {}) { return String(row.primaryCategory || row.主分类 || row.异常分类 || ''); }
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase(); }
function uniqueRows(rows = []) {
  const map = new Map();
  for (const row of rows || []) { const bill = billOf(row); if (bill) map.set(bill, row); }
  return [...map.values()];
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function emptyWhppState() {
  return {
    businessType: WHPP, reportDate: '', sourceName: '', batchId: '', sourceSnapshotId: '', snapshotId: '', snapshotStatus: 'EMPTY',
    dailyReportReady: false, pnhBills: [], dailyParseRows: [], carryBills: [], nextCarryBills: [], podLocks: [],
    scanResults: [], scanQueryStatus: [], trackEvents: [], eventQueryStatus: [], exceptionItems: [], exceptionQueryStatus: [],
    finalRows: [], trackResults: [], processing: { running: false, paused: false, phase: '' }, lastRunSummary: null, lastRun: null
  };
}
