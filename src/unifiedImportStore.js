import crypto from 'crypto';
import { getDb, nowIso } from './db.js';

let ccslSnapshotCache = { snapshotId: '', state: null };

export function saveUnifiedImport(parsed, sourceName) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM unified_import_batches WHERE reportDate=? AND fileHash=? AND status=? ORDER BY createdAt DESC LIMIT 1').get(parsed.reportDate, parsed.fileHash, 'VALID');
  if (existing) return hydrateBatch(existing, true);
  const batchId = `BATCH-${crypto.randomUUID()}`;
  const snapshotId = `SNAP-${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const payload = { reportDate: parsed.reportDate, dateDetectionSource: parsed.dateDetectionSource, dateCandidates: parsed.dateCandidates, dateConflict: parsed.dateConflict, containerFormat: parsed.containerFormat, classificationCounts: parsed.classificationCounts, regionCounts: parsed.regionCounts, summary: parsed.summary, sheetDiagnostics: parsed.sheetDiagnostics, rows: parsed.rows };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE unified_import_batches SET status='SUPERSEDED' WHERE reportDate=? AND status='VALID'").run(parsed.reportDate);
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson) VALUES(?,?,?,?,?,'VALID',?,?,?,?,?,?,?)`)
      .run(batchId, snapshotId, parsed.reportDate, sourceName, parsed.fileHash, JSON.stringify(parsed.summary), JSON.stringify(parsed.warnings), createdAt, parsed.dateDetectionSource || '', JSON.stringify(parsed.dateCandidates || []), parsed.dateWasManuallyCorrected ? 1 : 0, JSON.stringify(parsed.regionCounts || {}));
    const insertRow = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertDaily = db.prepare(`INSERT INTO shipment_daily_snapshots(snapshotId,batchId,reportDate,businessType,shipmentCode,regionCode,classificationSource,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)`);
    const upsertCurrent = db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt) VALUES(?,?,?,?,?,'PENDING_SCAN','',?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,snapshotId=excluded.snapshotId,state='PENDING_SCAN',apiStatus='PENDING_SCAN',stateJson=excluded.stateJson,updatedAt=excluded.updatedAt`);
    const upsertCarry = db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,'OPEN','PENDING_SCAN','',?,?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,lastReportDate=excluded.lastReportDate,lastSnapshotId=excluded.lastSnapshotId,status='OPEN',apiStatus='PENDING_SCAN',closeReason='',stateJson=excluded.stateJson,updatedAt=excluded.updatedAt`);
    for (const row of parsed.rows) {
      const rowJson = JSON.stringify(row);
      insertRow.run(batchId, snapshotId, parsed.reportDate, row.businessType, row.shipmentCode, row.regionCode, row.recipientRaw, row.recipientNormalized, row.sheetName, row.rowNumber, row.classificationReason, rowJson, createdAt, row.classificationSource || '', row.classificationMatchedValue || '', row.classificationWarning || '');
      insertDaily.run(snapshotId, batchId, parsed.reportDate, row.businessType, row.shipmentCode, row.regionCode, row.classificationSource || '', rowJson, createdAt);
      upsertCurrent.run(row.shipmentCode, row.businessType, parsed.reportDate, snapshotId, 'PENDING_SCAN', rowJson, createdAt);
      upsertCarry.run(row.shipmentCode, row.businessType, parsed.reportDate, parsed.reportDate, snapshotId, snapshotId, rowJson, createdAt, createdAt);
    }
    db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,'IMPORTED',?,?)`).run(snapshotId, batchId, parsed.reportDate, JSON.stringify(payload), createdAt);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { batchId, snapshotId, reportDate: parsed.reportDate, dateDetectionSource: parsed.dateDetectionSource, dateCandidates: parsed.dateCandidates, dateConflict: parsed.dateConflict, dateWasManuallyCorrected: parsed.dateWasManuallyCorrected, containerFormat: parsed.containerFormat, fileHash: parsed.fileHash, classificationCounts: parsed.classificationCounts, regionCounts: parsed.regionCounts, summary: parsed.summary, sheetDiagnostics: parsed.sheetDiagnostics, warnings: parsed.warnings, carryover: carryoverSummary(parsed.reportDate), duplicateFile: false };
}

export function getLatestUnifiedImport() {
  const row = getDb().prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get();
  return row ? hydrateBatch(row, false) : null;
}

function hydrateBatch(row, duplicateFile) {
  const counts = getDb().prepare('SELECT businessType, COUNT(*) count FROM unified_import_rows WHERE batchId=? GROUP BY businessType').all(row.batchId);
  return {
    batchId: row.batchId, snapshotId: row.snapshotId, reportDate: row.reportDate, fileHash: row.fileHash,
    classificationCounts: Object.assign({ CE: 0, TBKH: 0, ALI1688: 0, SHOPEECN: 0, SHOPEEVN: 0 }, Object.fromEntries(counts.map(item => [item.businessType, Number(item.count)]))),
    dateDetectionSource: row.dateDetectionSource || '', dateCandidates: JSON.parse(row.dateCandidatesJson || '[]'), dateConflict: JSON.parse(row.dateCandidatesJson || '[]').length > 1, dateWasManuallyCorrected: Boolean(row.dateWasManuallyCorrected),
    regionCounts: JSON.parse(row.regionCountsJson || '{}'), summary: JSON.parse(row.summaryJson || '{}'), warnings: JSON.parse(row.warningsJson || '[]'), carryover: carryoverSummary(row.reportDate), duplicateFile
  };
}

export function getUnifiedProcessingQueue(batchId) {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM unified_import_batches WHERE batchId=?').get(batchId);
  if (!batch) throw new Error('导入批次不存在');
  const rows = db.prepare(`SELECT c.shipmentCode,c.businessType,c.sourceReportDate,c.lastReportDate,c.status,c.apiStatus,c.stateJson,
    CASE WHEN c.sourceReportDate=? THEN 'TODAY' ELSE 'HISTORICAL_CARRY' END sourceType
    FROM carryover_open_items c WHERE c.status='OPEN' ORDER BY c.sourceReportDate,c.shipmentCode`).all(batch.reportDate);
  return { batchId, snapshotId: batch.snapshotId, reportDate: batch.reportDate, rows, summary: carryoverSummary(batch.reportDate) };
}

export function updateCarryoverResults({ snapshotId, reportDate, rows = [] }) {
  const db = getDb();
  const update = db.prepare(`UPDATE carryover_open_items SET status=?,apiStatus=?,closeReason=?,lastReportDate=?,lastSnapshotId=?,stateJson=?,updatedAt=? WHERE shipmentCode=?`);
  const current = db.prepare(`UPDATE shipment_current_state SET state=?,apiStatus=?,reportDate=?,snapshotId=?,lastEventTime=?,stateJson=?,updatedAt=? WHERE shipmentCode=?`);
  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const bill = String(row.shipmentCode || row.运单号 || '').trim().toUpperCase();
      if (!bill) continue;
      const pod = row.是否POD === '是' || String(row.orderStatus || '') === '85';
      const returned = row.退回状态 === '已退回' || /退回|RETURN/i.test(String(row.primaryCategory || row.主分类 || ''));
      const selfPickup = row.primaryCategory === 'SELF_PICKUP' || row.主分类 === '仓库自提';
      const normal = row.primaryCategory === '正常分流节点';
      const apiFailed = /失败|retry/i.test(String(row.API状态 || row.查询状态 || ''));
      const closed = pod || returned || selfPickup || normal;
      const status = closed ? 'CLOSED' : 'OPEN';
      const reason = pod ? 'POD' : returned ? 'RETURNED' : selfPickup ? 'SELF_PICKUP' : normal ? 'NORMAL_FINAL' : '';
      const apiStatus = apiFailed ? 'API_PENDING_RETRY' : 'SUCCESS';
      const json = JSON.stringify(row);
      update.run(status, apiStatus, reason, reportDate, snapshotId, json, now, bill);
      current.run(closed ? reason : String(row.primaryCategory || row.主分类 || 'OPEN'), apiStatus, reportDate, snapshotId, row.latestEventTime || row.最后节点时间 || '', json, now, bill);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return carryoverSummary(reportDate);
}

export function carryoverSummary(reportDate) {
  const db = getDb();
  const one = (sql, ...params) => Number(db.prepare(sql).get(...params)?.count || 0);
  return {
    todayOpen: one("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate=?", reportDate),
    historicalOpen: one("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate<?", reportDate),
    rechecked: one("SELECT COUNT(*) count FROM carryover_open_items WHERE lastReportDate=? AND sourceReportDate<?", reportDate, reportDate),
    currentOpen: one("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND lastReportDate<=?", reportDate)
  };
}

export function completeUnifiedSnapshot({ reportDate, ccslSnapshot = null, shopeeSnapshot = null }) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM unified_snapshots WHERE reportDate=? AND status IN ('IMPORTED','COMPLETED') ORDER BY createdAt DESC LIMIT 1").get(reportDate);
  if (!row) return null;
  const payload = JSON.parse(row.payloadJson || '{}');
  const typeByBill = new Map(db.prepare('SELECT shipmentCode,businessType FROM unified_import_rows WHERE snapshotId=?').all(row.snapshotId).map(item => [item.shipmentCode, item.businessType]));
  const normalizeRows = rows => (rows || []).map(item => {
    const shipmentCode = String(item.shipmentCode || item.运单号 || '').trim().toUpperCase();
    return { ...item, shipmentCode, 运单号: shipmentCode, businessType: typeByBill.get(shipmentCode) || item.businessType || 'CE' };
  });
  payload.completedAt = nowIso();
  payload.sourceSnapshots = { CCSL: ccslSnapshot?.snapshotId || '', SHOPEE: shopeeSnapshot?.snapshotId || '' };
  payload.finalRows = [...normalizeRows(ccslSnapshot?.state?.finalRows), ...normalizeRows(shopeeSnapshot?.state?.finalRows)];
  payload.dashboard = { CCSL: ccslSnapshot?.view || null, SHOPEE: shopeeSnapshot?.view || null };
  db.prepare("UPDATE unified_snapshots SET status='COMPLETED',payloadJson=? WHERE snapshotId=?").run(JSON.stringify(payload), row.snapshotId);
  return { snapshotId: row.snapshotId, reportDate, finalRowCount: payload.finalRows.length };
}

export function listCompletedUnifiedSnapshots(fromDate, toDate) {
  return getDb().prepare("SELECT snapshotId,reportDate,payloadJson,createdAt FROM unified_snapshots WHERE status='COMPLETED' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC,createdAt ASC").all(fromDate, toDate).map(row => ({ ...row, payload: JSON.parse(row.payloadJson || '{}') }));
}

export function loadUnifiedBusinessState(businessType, snapshotId = '') {
  const type = normalizeBusinessType(businessType);
  const db = getDb();
  const batch = snapshotId
    ? db.prepare('SELECT * FROM unified_import_batches WHERE snapshotId=?').get(snapshotId)
    : db.prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get();
  if (!batch) return emptyBusinessState(type);
  const dailyRows = db.prepare('SELECT rowJson FROM unified_import_rows WHERE snapshotId=? AND businessType=? ORDER BY shipmentCode').all(batch.snapshotId, type).map(row => JSON.parse(row.rowJson || '{}'));
  const bills = dailyRows.map(row => row.shipmentCode).filter(Boolean);
  const memberSet = new Set(bills);
  const unified = db.prepare('SELECT status,payloadJson FROM unified_snapshots WHERE snapshotId=?').get(batch.snapshotId);
  const payload = JSON.parse(unified?.payloadJson || '{}');
  let finalRows = (payload.finalRows || []).filter(row => String(row.businessType || '').toUpperCase() === type);
  const ccslSnapshotState = !type.startsWith('SHOPEE') ? latestCcslSnapshotState(db, batch.reportDate) : null;
  if (!finalRows.length && !type.startsWith('SHOPEE')) {
    finalRows = (ccslSnapshotState?.finalRows || []).filter(row => memberSet.has(codeOf(row))).map(row => ({ ...row, businessType: type }));
  }
  const carryBills = db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE businessType=? AND status='OPEN' ORDER BY shipmentCode").all(type).map(row => row.shipmentCode);
  const podLocks = db.prepare("SELECT shipmentCode FROM shipment_current_state WHERE businessType=? AND state='POD' ORDER BY shipmentCode").all(type).map(row => row.shipmentCode);
  return {
    businessType: type,
    reportDate: batch.reportDate,
    sourceName: batch.sourceName,
    batchId: batch.batchId,
    snapshotId: batch.snapshotId,
    snapshotStatus: unified?.status || 'IMPORTED',
    dailyReportReady: true,
    pnhBills: bills,
    dailyParseRows: dailyRows.map(row => ({ ...row, recipient_group: type === 'SHOPEECN' ? 'CN' : type === 'SHOPEEVN' ? 'VN' : row.recipient_group })),
    dailyParseSummary: { totalRecognized: bills.length, groupCounts: { CN: type === 'SHOPEECN' ? bills.length : 0, VN: type === 'SHOPEEVN' ? bills.length : 0 } },
    finalRows,
    scanResults: (payload.scanResults || []).filter(row => memberSet.has(codeOf(row))).length
      ? (payload.scanResults || []).filter(row => memberSet.has(codeOf(row)))
      : (!type.startsWith('SHOPEE') ? (ccslSnapshotState?.scanResults || []).filter(row => memberSet.has(codeOf(row))).map(row => ({ ...row, businessType: type })) : []),
    trackResults: finalRows,
    trackEvents: (payload.trackEvents || []).filter(row => memberSet.has(codeOf(row))),
    carryBills,
    nextCarryBills: carryBills,
    podLocks: [...new Set([...podLocks, ...finalRows.filter(row => row.是否POD === '是').map(codeOf).filter(Boolean)])],
    historySummary: []
  };
}

function normalizeBusinessType(value) {
  const type = String(value || '').toUpperCase();
  if (!['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].includes(type)) throw new Error('不支持的业务类型');
  return type;
}

function emptyBusinessState(businessType) {
  return { businessType, reportDate: '', snapshotId: '', snapshotStatus: 'EMPTY', pnhBills: [], dailyParseRows: [], finalRows: [], scanResults: [], trackResults: [], trackEvents: [], carryBills: [], nextCarryBills: [], podLocks: [], historySummary: [] };
}

function latestCcslSnapshotState(db, reportDate) {
  const row = db.prepare("SELECT snapshotId,payloadJson FROM export_snapshots WHERE reportDate=? AND status='VALID' AND reconciliationStatus='COMPLETED' ORDER BY id DESC LIMIT 1").get(reportDate);
  if (!row) return null;
  if (ccslSnapshotCache.snapshotId === row.snapshotId) return ccslSnapshotCache.state;
  const state = JSON.parse(row.payloadJson || '{}').state || null;
  ccslSnapshotCache = { snapshotId: row.snapshotId, state };
  return state;
}

function codeOf(row = {}) { return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase(); }
