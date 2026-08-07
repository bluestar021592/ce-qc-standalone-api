import { createHash, randomUUID } from 'crypto';

import { buildConsistencyReport } from './consistency.js';
import { getDb, nowIso } from './db.js';
import { buildCoreKpis, buildCriticalDashboard, buildDashboardData, buildDashboardRows, buildDetailTabs, getXlsxSheetRows } from './reporting.js';
import { buildSnapshotHashes } from './snapshotHash.js';
import { SHOP_WHITELIST_SOURCE_SHA256, SHOP_WHITELIST_VERSION } from './shopWhitelist.js';
import { analyzeShipment } from './analyzer.js';
import { getShopCodeMap } from './shopCodes.js';

export function createDashboardSnapshot(state = {}, context = {}) {
  const reportDate = String(context.reportDate || state.reportDate || '').trim();
  const runId = String(context.runId || resolveRunId(state, reportDate)).trim();
  if (!reportDate) throw snapshotError('REPORT_DATE_MISSING', '请先导入当日日报Excel。');
  if (!runId) throw snapshotError('RUN_CREATE_FAILED', '处理任务未正确创建，无法生成处理快照。');

  const existing = getSnapshot(reportDate, runId);
  if (existing) return existing;

  const snapshotId = `${reportDate}_${runId}_${randomUUID().slice(0, 8)}`;
  const generatedAt = nowIso();
  const snapshotState = clone({ ...state, snapshotId });
  const dashboardRows = buildDashboardRows(snapshotState);
  const coreKpis = buildCoreKpis(snapshotState);
  const criticalDashboard = buildCriticalDashboard(snapshotState);
  const detailTabs = buildDetailTabs(snapshotState);
  const dashboard = buildDashboardData(snapshotState);
  const xlsxRows = getXlsxSheetRows(snapshotState);
  const hashDetailTabs = Object.fromEntries(Object.entries(xlsxRows)
    .filter(([, rows]) => Array.isArray(rows))
    .map(([key, rows]) => [key, { rows }]));
  const snapshotHashes = buildSnapshotHashes({ dashboardRows, detailTabs: hashDetailTabs });
  const metrics = Object.fromEntries([
    ...dashboardRows.map(row => [row.metricKey || row.项目, row.数值]),
    ...criticalDashboard.rows.map(row => [row.metricKey || row.异常类型, row.数量])
  ]);
  const detailCounts = Object.fromEntries(Object.entries(detailTabs).map(([key, value]) => [key, Number(value?.total || 0)]));
  const dataHashes = {
    dailyParseRows: hash(snapshotState.dailyParseRows || []),
    scanResults: hash(snapshotState.scanResults || []),
    trackEvents: hash(snapshotState.trackEvents || []),
    finalRows: hash(snapshotState.finalRows || []),
    carryBills: hash(snapshotState.nextCarryBills || snapshotState.carryBills || []),
    podLocks: hash(snapshotState.podLocks || [])
  };
  const consistency = buildConsistencyReport(snapshotState);
  const payload = {
    snapshotId,
    reportDate,
    runId,
    generatedAt,
    metrics,
    detailCounts,
    dataHashes,
    consistency,
    coreKpis,
    dashboard,
    dashboardRows,
    criticalDashboard,
    detailTabs,
    xlsxRows,
    ...snapshotHashes,
    state: snapshotState
  };
  const reconciliationFailed = consistency?.status === 'error' || (consistency?.errors || []).length > 0;
  payload.status = reconciliationFailed ? 'INVALID_FAILED_RECONCILIATION' : 'VALID';
  payload.reconciliationStatus = reconciliationFailed ? 'FAILED' : 'COMPLETED';
  payload.whitelistVersion = SHOP_WHITELIST_VERSION;

  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO export_snapshots(
        snapshotId, reportDate, runId, snapshotType, payloadJson, metricsJson,
        detailCountsJson, dataHashesJson, consistencyJson, generatedAt, createdAt
      ) VALUES(?, ?, ?, 'dashboard', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      reportDate,
      runId,
      JSON.stringify(payload),
      JSON.stringify(metrics),
      JSON.stringify(detailCounts),
      JSON.stringify(dataHashes),
      JSON.stringify(consistency),
      generatedAt,
      generatedAt
    );
    db.prepare(`UPDATE export_snapshots SET status=?,reconciliationStatus=?,invalidReason=?,whitelistVersion=?,whitelistSha256=? WHERE snapshotId=?`)
      .run(payload.status, payload.reconciliationStatus, reconciliationFailed ? JSON.stringify(consistency) : '', SHOP_WHITELIST_VERSION, SHOP_WHITELIST_SOURCE_SHA256, snapshotId);
    db.prepare(`
      UPDATE run_locks SET status='finished', currentStage='完成', batchIndex=1, totalBatches=1,
        errorMessage='', completedAt=?, updatedAt=? WHERE reportDate=? AND runId=?
    `).run(generatedAt, generatedAt, reportDate, runId);
    db.prepare(`
      INSERT INTO app_meta(key, value, updatedAt) VALUES('current_snapshot_id', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt
    `).run(snapshotId, generatedAt);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return payload;
}

export function getMatchingSnapshot(state = {}) {
  const reportDate = String(state.reportDate || '').trim();
  const runId = String(resolveRunId(state, reportDate)).trim();
  if (!reportDate || !runId) return null;
  return getSnapshot(reportDate, runId);
}

export function repairSnapshotFromStoredData(snapshot = {}) {
  const source = clone(snapshot?.state || {});
  if (!source.reportDate || !Array.isArray(source.finalRows)) throw new Error('Stored snapshot data is incomplete and cannot be repaired locally.');
  const eventsByBill = new Map();
  for (const event of source.trackEvents || []) {
    const bill = String(event?.shipmentCode || event?.运单号 || '').trim().toUpperCase();
    if (!bill) continue;
    if (!eventsByBill.has(bill)) eventsByBill.set(bill, []);
    eventsByBill.get(bill).push(event);
  }
  const scansByBill = new Map((source.scanResults || []).map(row => [String(row?.运单号 || row?.shipmentCode || '').trim().toUpperCase(), row]));
  const shopCodeMap = getShopCodeMap();
  source.finalRows = source.finalRows.map(row => {
    const bill = String(row?.运单号 || row?.shipmentCode || '').trim().toUpperCase();
    if (!bill || row?.是否POD === '是') return row;
    return analyzeShipment({ waybill: bill, scanRow: scansByBill.get(bill) || row, events: eventsByBill.get(bill) || [], shopCodeMap, reportDate: source.reportDate });
  });
  source.trackResults = source.finalRows.filter(row => row?.是否POD !== '是');
  const repairRunId = `${snapshot.runId || source.lastRunSummary?.runId || 'stored'}_repair_${Date.now()}`;
  source.currentRun = { ...(source.currentRun || {}), runId: repairRunId };
  source.lastRunSummary = { ...(source.lastRunSummary || {}), runId: repairRunId, repairSource: 'STORED_SQLITE_DATA', ceApiCallsDuringRepair: 0 };
  getDb().prepare("UPDATE export_snapshots SET status='INVALID_FAILED_RECONCILIATION',reconciliationStatus='FAILED',invalidReason=? WHERE snapshotId=?")
    .run(JSON.stringify({ reason: 'CLASSIFICATION_CONFLICT', repairedFromStoredData: true }), snapshot.snapshotId);
  const repaired = createDashboardSnapshot(source, { reportDate: source.reportDate, runId: repairRunId });
  const completedAt = nowIso();
  getDb().prepare(`INSERT OR REPLACE INTO run_locks(reportDate,runId,status,lockedBy,lockedAt,updatedAt,currentStage,batchIndex,totalBatches,errorMessage,completedAt)
    VALUES(?,?,'finished','LOCAL_RECONCILIATION',?,?,'完成',1,1,'',?)`)
    .run(source.reportDate, repairRunId, completedAt, completedAt, completedAt);
  repaired.state.currentRun = { ...repaired.state.currentRun, runId: repairRunId, reportDate: source.reportDate, status: 'finished', currentStage: '完成', completedAt };
  repaired.state.snapshotId = repaired.snapshotId;
  return repaired;
}

function resolveRunId(state, reportDate) {
  const stateRunId = state?.currentRun?.runId || state?.lastRunSummary?.runId || state?.lastRun?.runId || '';
  if (stateRunId) return stateRunId;
  if (!reportDate) return '';
  return getDb().prepare('SELECT runId FROM run_locks WHERE reportDate=? ORDER BY updatedAt DESC LIMIT 1').get(reportDate)?.runId || '';
}

function snapshotError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function getSnapshot(reportDate, runId = '') {
  const db = getDb();
  const row = runId
    ? db.prepare(`
        SELECT payloadJson FROM export_snapshots
        WHERE reportDate=? AND runId=? AND snapshotType='dashboard'
        ORDER BY id DESC LIMIT 1
      `).get(reportDate, runId)
    : db.prepare(`
        SELECT payloadJson FROM export_snapshots
        WHERE reportDate=? AND snapshotType='dashboard'
        ORDER BY id DESC LIMIT 1
      `).get(reportDate);
  if (!row?.payloadJson) return null;
  try {
    return JSON.parse(row.payloadJson);
  } catch {
    return null;
  }
}

export function getSnapshotById(snapshotId) {
  const row = getDb().prepare("SELECT payloadJson FROM export_snapshots WHERE snapshotId=? AND snapshotType='dashboard'").get(String(snapshotId || '').trim());
  if (!row?.payloadJson) return null;
  try { return JSON.parse(row.payloadJson); } catch { return null; }
}

export function listSnapshotHistory(limit = 60) {
  return getDb().prepare(`SELECT reportDate,snapshotId,runId,generatedAt
    FROM export_snapshots WHERE snapshotType='dashboard' ORDER BY reportDate DESC,createdAt DESC LIMIT ?`)
    .all(Math.max(1, Math.min(365, Number(limit || 60))));
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
