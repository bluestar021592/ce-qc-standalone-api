import crypto from 'crypto';
import { getDb, nowIso } from './db.js';
import { SHOPEE, getMatchingBusinessSnapshot, loadBusinessState } from './businessStore.js';
import { analyzeStoreFlow } from './storeFlow.js';
import { loadAppState } from './store.js';

const BUSINESS_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP']);
let ccslSnapshotCache = { snapshotId: '', state: null };

export function saveUnifiedImport(parsed, sourceName, options = {}) {
  const stageStartedAt = Date.now();
  assertSourceReconciliation(parsed);
  const db = getDb();
  const previousValid = db.prepare("SELECT * FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(parsed.reportDate);
  const exactSameFile = Boolean(previousValid && String(previousValid.fileHash || '') === String(parsed.fileHash || ''));
  if (options?.reuseExactDuplicate === true && exactSameFile) {
    const hydrated = hydrateBatch(previousValid, true);
    console.log(`[CE-QC][UNIFIED_IMPORT_STAGE] sqlite_duplicate_explicit_reuse elapsedMs=${Date.now() - stageStartedAt} reportDate=${parsed.reportDate} batchId=${previousValid.batchId}`);
    return hydrated;
  }
  const batchId = `BATCH-${crypto.randomUUID()}`;
  const snapshotId = `SNAP-${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const payload = { reportDate: parsed.reportDate, dateDetectionSource: parsed.dateDetectionSource, dateCandidates: parsed.dateCandidates, dateConflict: parsed.dateConflict, containerFormat: parsed.containerFormat, classificationCounts: parsed.classificationCounts, sourceReconciliation: parsed.sourceReconciliation, regionCounts: parsed.regionCounts, summary: parsed.summary, sheetDiagnostics: parsed.sheetDiagnostics, rows: parsed.rows };
  const sqliteStartedAt = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE unified_snapshots SET status='SUPERSEDED' WHERE reportDate=? AND status IN ('IMPORTED','COMPLETED','INVALID_FAILED_RECONCILIATION')").run(parsed.reportDate);
    db.prepare("UPDATE unified_import_batches SET status='SUPERSEDED' WHERE reportDate=? AND status='VALID'").run(parsed.reportDate);
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson) VALUES(?,?,?,?,?,'VALID',?,?,?,?,?,?,?)`)
      .run(batchId, snapshotId, parsed.reportDate, sourceName, parsed.fileHash, JSON.stringify(parsed.summary), JSON.stringify(parsed.warnings), createdAt, parsed.dateDetectionSource || '', JSON.stringify(parsed.dateCandidates || []), parsed.dateWasManuallyCorrected ? 1 : 0, JSON.stringify(parsed.regionCounts || {}));
    const insertRow = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertDaily = db.prepare(`INSERT INTO shipment_daily_snapshots(snapshotId,batchId,reportDate,businessType,shipmentCode,regionCode,classificationSource,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)`);
    const upsertCurrent = db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt) VALUES(?,?,?,?,?,'PENDING_SCAN','',?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,snapshotId=excluded.snapshotId,state=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.state ELSE 'PENDING_SCAN' END,apiStatus=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.apiStatus ELSE 'PENDING_SCAN' END,lastEventTime=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.lastEventTime ELSE '' END,stateJson=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN shipment_current_state.stateJson ELSE excluded.stateJson END,updatedAt=excluded.updatedAt`);
    const upsertCarry = db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,'OPEN','PENDING_SCAN','',?,?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,lastReportDate=excluded.lastReportDate,lastSnapshotId=excluded.lastSnapshotId,status=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN 'CLOSED' ELSE 'OPEN' END,apiStatus=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN carryover_open_items.apiStatus ELSE 'PENDING_SCAN' END,closeReason=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN carryover_open_items.closeReason ELSE '' END,stateJson=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED') THEN carryover_open_items.stateJson ELSE excluded.stateJson END,updatedAt=excluded.updatedAt`);
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
    console.warn(`[CE-QC][UNIFIED_IMPORT_STAGE] sqlite_write_failed elapsedMs=${Date.now() - sqliteStartedAt} reportDate=${parsed.reportDate} rows=${parsed.rows.length} error=${error?.message || error}`);
    throw error;
  }
  const sqliteElapsedMs = Date.now() - sqliteStartedAt;
  console.log(`[CE-QC][UNIFIED_IMPORT_STAGE] sqlite_write elapsedMs=${sqliteElapsedMs} reportDate=${parsed.reportDate} rows=${parsed.rows.length} batchId=${batchId} overwrite=${previousValid ? 1 : 0} sameFile=${exactSameFile ? 1 : 0}`);
  const carryover = carryoverSummary(parsed.reportDate);
  console.log(`[CE-QC][UNIFIED_IMPORT_STAGE] store_done elapsedMs=${Date.now() - stageStartedAt} reportDate=${parsed.reportDate} rows=${parsed.rows.length} batchId=${batchId}`);
  return { batchId, snapshotId, reportDate: parsed.reportDate, dateDetectionSource: parsed.dateDetectionSource, dateCandidates: parsed.dateCandidates, dateConflict: parsed.dateConflict, dateWasManuallyCorrected: parsed.dateWasManuallyCorrected, containerFormat: parsed.containerFormat, fileHash: parsed.fileHash, classificationCounts: parsed.classificationCounts, sourceReconciliation: parsed.sourceReconciliation, regionCounts: parsed.regionCounts, summary: parsed.summary, sheetDiagnostics: parsed.sheetDiagnostics, warnings: parsed.warnings, carryover, duplicateFile: false, sameDateOverwrite: Boolean(previousValid), replacedSameFile: exactSameFile, replacedBatchId: previousValid?.batchId || '' };
}

export function getLatestUnifiedImport() {
  const row = getDb().prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get();
  return row ? hydrateBatch(row, false) : null;
}

export function listUnifiedImportHistory(limit = 120) {
  // One report date must resolve to the newest currently VALID import batch.
  // A superseded COMPLETED snapshot belongs to an older upload of the same date
  // and must never replace the latest imported classification on business pages.
  const rows = getDb().prepare(`SELECT b.*, s.status snapshotStatus, s.createdAt snapshotCreatedAt
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID'
    ORDER BY b.reportDate DESC, b.createdAt DESC
    LIMIT ?`).all(Math.max(1, Math.min(500, Number(limit) || 120)));
  const seen = new Set();
  return rows.filter(row => {
    if (!row.reportDate || seen.has(row.reportDate)) return false;
    seen.add(row.reportDate);
    return true;
  }).map(row => ({ ...hydrateBatch(row, false), snapshotStatus: row.snapshotStatus || 'IMPORTED', createdAt: row.snapshotCreatedAt || row.createdAt }));
}

function hydrateBatch(row, duplicateFile) {
  const counts = getDb().prepare('SELECT businessType, COUNT(*) count FROM unified_import_rows WHERE batchId=? GROUP BY businessType').all(row.batchId);
  const classificationCounts = Object.assign(Object.fromEntries(BUSINESS_TYPES.map(type => [type, 0])), Object.fromEntries(counts.map(item => [item.businessType, Number(item.count)])));
  const summary = JSON.parse(row.summaryJson || '{}');
  const sourceReconciliation = buildSourceReconciliation(classificationCounts, summary.validUniqueWaybills);
  return {
    batchId: row.batchId, snapshotId: row.snapshotId, reportDate: row.reportDate, fileHash: row.fileHash,
    classificationCounts,
    sourceReconciliation,
    dateDetectionSource: row.dateDetectionSource || '', dateCandidates: JSON.parse(row.dateCandidatesJson || '[]'), dateConflict: JSON.parse(row.dateCandidatesJson || '[]').length > 1, dateWasManuallyCorrected: Boolean(row.dateWasManuallyCorrected),
    regionCounts: JSON.parse(row.regionCountsJson || '{}'), summary, warnings: JSON.parse(row.warningsJson || '[]'), carryover: carryoverSummary(row.reportDate), duplicateFile
  };
}

export function getUnifiedProcessingQueue(batchId) {
  const stageStartedAt = Date.now();
  const db = getDb();
  const batch = db.prepare('SELECT * FROM unified_import_batches WHERE batchId=?').get(batchId);
  if (!batch) throw new Error('导入批次不存在');
  const queryStartedAt = Date.now();
  const rows = db.prepare(`SELECT c.shipmentCode,c.businessType,c.sourceReportDate,c.lastReportDate,c.status,c.apiStatus,c.stateJson,
    CASE WHEN c.sourceReportDate=? THEN 'TODAY' ELSE 'HISTORICAL_CARRY' END sourceType
    FROM carryover_open_items c WHERE c.status='OPEN' ORDER BY c.sourceReportDate,c.shipmentCode`).all(batch.reportDate);
  const queryElapsedMs = Date.now() - queryStartedAt;
  const summary = carryoverSummary(batch.reportDate);
  console.log(`[CE-QC][UNIFIED_IMPORT_STAGE] carryover_queue elapsedMs=${Date.now() - stageStartedAt} queryMs=${queryElapsedMs} reportDate=${batch.reportDate} rows=${rows.length} historical=${summary.historicalOpen} today=${summary.todayOpen}`);
  return { batchId, snapshotId: batch.snapshotId, reportDate: batch.reportDate, rows, summary };
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
      const specialState = String(row.specialState || row.primaryCategory || row.主分类 || '').trim().toUpperCase();
      const specialClosed = ['SELF_PICKUP', 'CECN_RETENTION', 'CEZT_RETENTION', 'CCSL580_RETENTION'].includes(specialState) || row.主分类 === '仓库自提';
      const normal = row.primaryCategory === '正常分流节点' || row.matchedRule === 'NORMAL_FINAL_HUB';
      const apiFailed = /失败|retry/i.test(String(row.API状态 || row.查询状态 || ''));
      const closed = pod || returned || specialClosed || normal;
      const status = closed ? 'CLOSED' : 'OPEN';
      const reason = pod ? 'POD' : returned ? 'RETURNED' : specialClosed ? (specialState || 'SELF_PICKUP') : normal ? 'NORMAL_FINAL' : '';
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
  const startedAt = Date.now();
  const row = getDb().prepare(`SELECT
    COALESCE(SUM(CASE WHEN status='OPEN' AND sourceReportDate=? THEN 1 ELSE 0 END),0) todayOpen,
    COALESCE(SUM(CASE WHEN status='OPEN' AND sourceReportDate<? THEN 1 ELSE 0 END),0) historicalOpen,
    COALESCE(SUM(CASE WHEN lastReportDate=? AND sourceReportDate<? THEN 1 ELSE 0 END),0) rechecked,
    COALESCE(SUM(CASE WHEN status='OPEN' AND lastReportDate<=? THEN 1 ELSE 0 END),0) currentOpen
    FROM carryover_open_items`).get(reportDate, reportDate, reportDate, reportDate, reportDate) || {};
  const summary = {
    todayOpen: Number(row.todayOpen || 0),
    historicalOpen: Number(row.historicalOpen || 0),
    rechecked: Number(row.rechecked || 0),
    currentOpen: Number(row.currentOpen || 0)
  };
  console.log(`[CE-QC][UNIFIED_IMPORT_STAGE] carryover_summary elapsedMs=${Date.now() - startedAt} reportDate=${reportDate} today=${summary.todayOpen} historical=${summary.historicalOpen} current=${summary.currentOpen}`);
  return summary;
}

export function completeUnifiedSnapshot({ reportDate, ccslSnapshot = null, shopeeSnapshot = null }) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM unified_snapshots WHERE reportDate=? AND status IN ('IMPORTED','COMPLETED','INVALID_FAILED_RECONCILIATION') ORDER BY createdAt DESC LIMIT 1").get(reportDate);
  if (!row) return null;
  const payload = JSON.parse(row.payloadJson || '{}');
  const typeByBill = new Map(db.prepare('SELECT shipmentCode,businessType FROM unified_import_rows WHERE snapshotId=?').all(row.snapshotId).map(item => [item.shipmentCode, item.businessType]));
  const partitionedRows = partitionUnifiedRows(
    [...(ccslSnapshot?.state?.finalRows || []), ...(shopeeSnapshot?.state?.finalRows || [])],
    typeByBill
  );
  const completedAt = nowIso();
  payload.completedAt = completedAt;
  payload.sourceSnapshots = { CCSL: ccslSnapshot?.snapshotId || '', SHOPEE: shopeeSnapshot?.snapshotId || '' };
  payload.finalRows = partitionedRows.dailyRows;
  payload.historicalCarryRows = partitionedRows.historicalCarryRows;
  payload.dashboard = { CCSL: ccslSnapshot?.view || null, SHOPEE: shopeeSnapshot?.view || null };
  const expectedCounts = Object.fromEntries(BUSINESS_TYPES.map(type => [type, 0]));
  for (const item of db.prepare('SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType').all(row.snapshotId)) {
    expectedCounts[item.businessType] = Number(item.count);
  }
  const actualCounts = Object.fromEntries(BUSINESS_TYPES.map(type => [type, payload.finalRows.filter(item => item.businessType === type).length]));
  const uniqueBills = new Set(payload.finalRows.map(codeOf).filter(Boolean));
  const podRows = payload.finalRows.filter(isPodRow);
  const returnedRows = payload.finalRows.filter(isReturnCompletedRow);
  const inboundNoScanRows = payload.finalRows.filter(isInboundNoScanRow);
  const inboundSet = new Set(inboundNoScanRows.map(codeOf));
  const podInboundIntersection = podRows.filter(item => inboundSet.has(codeOf(item))).map(codeOf);
  const returnInboundIntersection = returnedRows.filter(item => inboundSet.has(codeOf(item))).map(codeOf);
  const sourceSnapshotsValid = Boolean(
    ccslSnapshot?.snapshotId && shopeeSnapshot?.snapshotId
    && String(ccslSnapshot.status || 'VALID') === 'VALID'
    && String(ccslSnapshot.reconciliationStatus || 'COMPLETED') === 'COMPLETED'
    && String(shopeeSnapshot.status || 'VALID') === 'VALID'
    && String(shopeeSnapshot.reconciliationStatus || 'COMPLETED') === 'COMPLETED'
  );
  const countChecks = Object.fromEntries(BUSINESS_TYPES.map(type => [type, actualCounts[type] === Number(expectedCounts[type] || 0)]));
  const retryCount = payload.finalRows.filter(isRetryRow).length;
  const sourceReconciliation = buildSourceReconciliation(expectedCounts, typeByBill.size);
  const validationPassed = sourceSnapshotsValid
    && sourceReconciliation.balanced
    && uniqueBills.size === payload.finalRows.length
    && payload.finalRows.length === sourceReconciliation.validUniqueWaybills
    && Object.values(countChecks).every(Boolean)
    && podInboundIntersection.length === 0
    && returnInboundIntersection.length === 0;
  const parentRunId = payload.parentRun?.runId || `UNIFIED-${row.batchId}`;
  payload.parentRun = {
    runId: parentRunId,
    reportDate,
    status: validationPassed ? 'COMPLETED' : 'FAILED_RECONCILIATION',
    children: Object.fromEntries(BUSINESS_TYPES.map(type => [type, {
      businessType: type,
      expected: Number(expectedCounts[type] || 0),
      completed: actualCounts[type],
      status: countChecks[type] ? 'COMPLETED' : 'FAILED_RECONCILIATION'
    }]))
  };
  payload.lifecycle = [
    { status: 'IMPORTED', at: row.createdAt },
    { status: 'PROCESSING', at: ccslSnapshot?.createdAt || row.createdAt },
    { status: 'SCAN_COMPLETED', at: completedAt },
    { status: 'TRACK_COMPLETED', at: completedAt },
    { status: 'RECONCILING', at: completedAt },
    { status: validationPassed ? 'VALID_COMPLETED' : 'INVALID_FAILED_RECONCILIATION', at: completedAt }
  ];
  payload.validationStatus = validationPassed ? 'VALID' : 'INVALID';
  payload.reconciliationStatus = validationPassed ? 'COMPLETED' : 'FAILED';
  payload.sourceReconciliation = sourceReconciliation;
  payload.reconciliation = {
    expectedCounts, actualCounts, uniqueFinalRows: uniqueBills.size, retryCount,
    sourceReconciliation,
    podCount: podRows.length, returnCompletedCount: returnedRows.length,
    inboundNoScanCount: inboundNoScanRows.length,
    podInboundIntersection, returnInboundIntersection,
    sourceSnapshotsValid, countChecks, passed: validationPassed
  };
  if (!validationPassed) {
    db.prepare("UPDATE unified_snapshots SET status='INVALID_FAILED_RECONCILIATION',payloadJson=? WHERE snapshotId=?").run(JSON.stringify(payload), row.snapshotId);
    const error = new Error('统一快照一致性检查失败，已阻止正式完成与导出。');
    error.code = 'UNIFIED_RECONCILIATION_FAILED';
    error.reconciliation = payload.reconciliation;
    throw error;
  }
  db.prepare("UPDATE unified_snapshots SET status='COMPLETED',payloadJson=? WHERE snapshotId=?").run(JSON.stringify(payload), row.snapshotId);
  return { snapshotId: row.snapshotId, reportDate, finalRowCount: payload.finalRows.length, parentRun: payload.parentRun, reconciliation: payload.reconciliation };
}

export function partitionUnifiedRows(rows = [], typeByBill = new Map()) {
  const dailyByBill = new Map();
  const carryByBill = new Map();
  for (const item of rows || []) {
    const shipmentCode = codeOf(item);
    if (!shipmentCode) continue;
    const importedType = typeByBill.get(shipmentCode);
    const normalized = {
      ...item,
      shipmentCode,
      运单号: shipmentCode,
      businessType: importedType || item.businessType || 'CE'
    };
    if (importedType) dailyByBill.set(shipmentCode, normalized);
    else carryByBill.set(shipmentCode, normalized);
  }
  return {
    dailyRows: [...dailyByBill.values()],
    historicalCarryRows: [...carryByBill.values()]
  };
}

export function listCompletedUnifiedSnapshots(fromDate, toDate) {
  return getDb().prepare("SELECT snapshotId,reportDate,payloadJson,createdAt FROM unified_snapshots WHERE status='COMPLETED' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC,createdAt ASC").all(fromDate, toDate).map(row => ({ ...row, payload: JSON.parse(row.payloadJson || '{}') }));
}

export function listUnifiedBusinessHistory(businessType, throughDate, limit = 30) {
  const type = normalizeBusinessType(businessType);
  const rows = getDb().prepare("SELECT snapshotId,reportDate,payloadJson FROM unified_snapshots WHERE status='COMPLETED' AND reportDate<=? ORDER BY reportDate DESC,createdAt DESC").all(throughDate || '9999-12-31');
  const byDate = new Map();
  for (const item of rows) {
    if (byDate.has(item.reportDate)) continue;
    const payload = JSON.parse(item.payloadJson || '{}');
    const members = (payload.finalRows || []).filter(row => String(row.businessType || '').toUpperCase() === type);
    const total = members.length;
    const pod = members.filter(isPodRow).length;
    const oc = members.filter(row => Number(row.ocDays || row.OC天数 || 0) > 0).length;
    byDate.set(item.reportDate, {
      reportDate: item.reportDate,
      businessType: type,
      summary: {
        reportDate: item.reportDate,
        today: total,
        pnh: total,
        todayPnh: total,
        scanPod: pod,
        todayPod: pod,
        podRate: total ? (pod / total) * 100 : 0,
        firstPodRate: total ? (pod / total) * 100 : 0,
        ocRate: total ? (oc / total) * 100 : 0
      }
    });
    if (byDate.size >= Number(limit || 30)) break;
  }
  return [...byDate.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

export function loadUnifiedBusinessState(businessType, snapshotId = '') {
  const type = normalizeBusinessType(businessType);
  const exactSnapshotRequested = Boolean(String(snapshotId || '').trim());
  const db = getDb();
  const batch = snapshotId
    ? db.prepare('SELECT * FROM unified_import_batches WHERE snapshotId=?').get(snapshotId)
    : db.prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get();
  if (!batch) return emptyBusinessState(type);
  const latestBatch = db.prepare("SELECT snapshotId FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get();
  const isCurrentSnapshot = latestBatch?.snapshotId === batch.snapshotId;
  const dailyRows = db.prepare('SELECT rowJson FROM unified_import_rows WHERE snapshotId=? AND businessType=? ORDER BY shipmentCode').all(batch.snapshotId, type).map(row => JSON.parse(row.rowJson || '{}'));
  const bills = dailyRows.map(row => row.shipmentCode).filter(Boolean);
  const memberSet = new Set(bills);
  const unified = db.prepare('SELECT status,payloadJson FROM unified_snapshots WHERE snapshotId=?').get(batch.snapshotId);
  const payload = JSON.parse(unified?.payloadJson || '{}');
  // Historical views stay immutable. The exact currently active snapshot may
  // use live progress so a freshly imported report does not display stale data.
  const mayUseLiveState = !exactSnapshotRequested || isCurrentSnapshot;
  const liveShopeeState = mayUseLiveState && type.startsWith('SHOPEE') ? loadBusinessState(SHOPEE) : null;
  const liveState = liveShopeeState?.reportDate === batch.reportDate ? liveShopeeState : null;
  const completedShopeeSnapshot = liveState ? getMatchingBusinessSnapshot(SHOPEE, liveState) : null;
  const completedShopeeState = completedShopeeSnapshot?.reconciliationStatus === 'COMPLETED'
    ? completedShopeeSnapshot.state
    : null;
  const filterMembers = rows => (rows || []).filter(row => memberSet.has(codeOf(row)));
  let finalRows = completedShopeeState
    ? filterMembers(completedShopeeState.finalRows)
    : (payload.finalRows || []).filter(row => String(row.businessType || '').toUpperCase() === type);
  if (!finalRows.length && liveState) finalRows = filterMembers(liveState.finalRows);
  if (!finalRows.length && liveState?.processing?.running) {
    finalRows = filterMembers(liveState.scanResults).map(row => ({
      ...row,
      businessType: type,
      apiStatus: row.apiStatus || row.API状态 || 'success',
      provisional: true
    }));
  }
  const ccslSnapshotState = mayUseLiveState && !type.startsWith('SHOPEE')
    ? latestCcslSnapshotState(db, batch.reportDate)
    : null;
  const currentCcslState = mayUseLiveState && !type.startsWith('SHOPEE')
    ? loadAppState()
    : null;
  const liveCcslState = currentCcslState?.reportDate === batch.reportDate ? currentCcslState : null;
  const activeLiveState = type.startsWith('SHOPEE') ? liveState : liveCcslState;
  if (!finalRows.length && !type.startsWith('SHOPEE')) {
    const ccslRows = liveCcslState?.finalRows?.length ? liveCcslState.finalRows : ccslSnapshotState?.finalRows;
    finalRows = (ccslRows || []).filter(row => memberSet.has(codeOf(row))).map(row => ({ ...row, businessType: type }));
  }
  const persistedTrackEvents = loadPersistedTrackEvents(db, batch.reportDate, memberSet);
  if (persistedTrackEvents.length) {
    const eventsByBill = groupEventsByBill(persistedTrackEvents);
    finalRows = finalRows.map(row => enrichStoreFlow(row, eventsByBill.get(codeOf(row)) || [], batch.reportDate));
  }
  const carryBills = db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE businessType=? AND status='OPEN' ORDER BY shipmentCode").all(type).map(row => row.shipmentCode);
  const podLocks = db.prepare("SELECT shipmentCode FROM shipment_current_state WHERE businessType=? AND state='POD' ORDER BY shipmentCode").all(type).map(row => row.shipmentCode);
  return {
    businessType: type,
    reportDate: batch.reportDate,
    sourceName: batch.sourceName,
    batchId: batch.batchId,
    snapshotId: batch.snapshotId,
    snapshotStatus: completedShopeeSnapshot ? 'COMPLETED' : (unified?.status || 'IMPORTED'),
    dailyReportReady: true,
    pnhBills: bills,
    dailyParseRows: dailyRows.map(row => ({ ...row, recipient_group: type === 'SHOPEECN' ? 'CN' : type === 'SHOPEEVN' ? 'VN' : row.recipient_group })),
    dailyParseSummary: { totalRecognized: bills.length, groupCounts: { CN: type === 'SHOPEECN' ? bills.length : 0, VN: type === 'SHOPEEVN' ? bills.length : 0 } },
    finalRows,
    scanResults: filterMembers(payload.scanResults).length
      ? filterMembers(payload.scanResults)
      : (liveState
          ? filterMembers(liveState.scanResults)
          : (!type.startsWith('SHOPEE') ? filterMembers(liveCcslState?.scanResults?.length ? liveCcslState.scanResults : ccslSnapshotState?.scanResults).map(row => ({ ...row, businessType: type })) : [])),
    trackResults: finalRows,
    trackEvents: filterMembers(payload.trackEvents).length
      ? filterMembers(payload.trackEvents)
      : (persistedTrackEvents.length ? persistedTrackEvents : filterMembers(liveState?.trackEvents)),
    carryBills,
    nextCarryBills: carryBills,
    podLocks: [...new Set([
      ...podLocks,
      ...filterMembers(activeLiveState?.scanResults).filter(isPodRow).map(codeOf),
      ...finalRows.filter(isPodRow).map(codeOf)
    ].filter(Boolean))],
    historySummary: listUnifiedBusinessHistory(type, batch.reportDate, 30),
    processing: activeLiveState?.processing || { running: false, paused: false, phase: '' },
    currentRun: activeLiveState?.currentRun || null,
    lastRunSummary: activeLiveState?.lastRunSummary || null,
    logs: activeLiveState?.logs || []
  };
}

export function loadUnifiedPeriodBusinessState(businessType, fromDate, toDate) {
  const type = normalizeBusinessType(businessType);
  const rows = getDb().prepare(`SELECT b.snapshotId,b.reportDate
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.reportDate BETWEEN ? AND ?
      AND s.status='COMPLETED'
    ORDER BY b.reportDate ASC,b.createdAt DESC`).all(fromDate, toDate);
  const byDate = new Map();
  for (const row of rows) if (!byDate.has(row.reportDate)) byDate.set(row.reportDate, row);
  const states = [...byDate.values()].map(row => loadUnifiedBusinessState(type, row.snapshotId));
  const finalRows = states.flatMap(state => (state.finalRows || []).map(item => ({ ...item, reportDate: item.reportDate || state.reportDate })));
  const scanResults = states.flatMap(state => state.scanResults || []);
  const trackEvents = states.flatMap(state => state.trackEvents || []);
  return {
    ...emptyBusinessState(type),
    businessType: type,
    reportDate: toDate,
    periodStart: fromDate,
    periodEnd: toDate,
    periodDates: [...byDate.keys()],
    snapshotId: `PERIOD:${type}:${fromDate}:${toDate}`,
    snapshotStatus: states.length ? 'COMPLETED' : 'EMPTY',
    dailyReportReady: states.length > 0,
    pnhBills: states.flatMap(state => state.pnhBills || []),
    finalRows,
    trackResults: finalRows,
    scanResults,
    trackEvents,
    historySummary: states.flatMap(state => state.historySummary || [])
  };
}

function normalizeBusinessType(value) {
  const type = String(value || '').toUpperCase();
  if (!BUSINESS_TYPES.includes(type)) throw new Error('不支持的业务类型');
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

function isPodRow(row = {}) {
  return String(row.currentState || row.scanNormalizedState || '').toUpperCase() === 'POD'
    || String(row.orderStatus || '') === '85' || row.是否POD === '是';
}

function loadPersistedTrackEvents(db, reportDate, memberSet) {
  if (!reportDate || !memberSet.size) return [];
  return db.prepare('SELECT * FROM track_events WHERE reportDate=? ORDER BY eventTime,id')
    .all(reportDate)
    .filter(row => memberSet.has(codeOf(row)))
    .map(row => {
      try { return { ...JSON.parse(row.rawJson || '{}'), ...row }; }
      catch { return row; }
    });
}

function groupEventsByBill(events) {
  const grouped = new Map();
  for (const event of events || []) {
    const bill = codeOf(event);
    if (!bill) continue;
    if (!grouped.has(bill)) grouped.set(bill, []);
    grouped.get(bill).push(event);
  }
  return grouped;
}

function enrichStoreFlow(row, events, reportDate) {
  const state = String(row.currentState || row.scanNormalizedState || '').toUpperCase();
  const returned = state === 'RETURN_COMPLETED' || row.isReturned === true || row.是否退回 === '是';
  const storeFlow = analyzeStoreFlow({
    shipmentCode: codeOf(row),
    events,
    reportDate,
    isPod: isPodRow(row),
    isReturned: returned
  });
  if (!storeFlow.shopState || storeFlow.shopState === 'CLOSED') return row;
  return {
    ...row,
    ...storeFlow,
    门店状态: storeFlow.shopState,
    门店编码: storeFlow.currentShopCode || storeFlow.targetShopCode,
    门店名称: storeFlow.shopName,
    门店发往时间: storeFlow.shopTransferStartedAt,
    门店入库时间: storeFlow.shopArrivedAt,
    门店滞留天数: storeFlow.shopRetentionNaturalDays
  };
}

function isReturnCompletedRow(row = {}) {
  return String(row.currentState || row.scanNormalizedState || '').toUpperCase() === 'RETURN_COMPLETED'
    || ['R', 'P4008'].includes(String(row.orderStatus || '').toUpperCase())
    || row.退回状态 === '已退回';
}

function isInboundNoScanRow(row = {}) {
  return row.入库无扫描节点 === '是'
    || String(row.primaryCategory || row.主分类 || row.异常分类 || '').includes('入库无扫描');
}

function isRetryRow(row = {}) {
  return /RETRY|FAILED|失败|待重试/i.test(String(row.apiStatus || row.API状态 || row.查询状态 || ''));
}

function buildSourceReconciliation(classificationCounts = {}, validUniqueWaybills = 0) {
  const normalizedCounts = Object.fromEntries(BUSINESS_TYPES.map(type => [type, Number(classificationCounts[type] || 0)]));
  const classifiedWaybills = Object.values(normalizedCounts).reduce((sum, count) => sum + count, 0);
  const validUnique = Number(validUniqueWaybills || 0);
  return {
    businessTypes: [...BUSINESS_TYPES],
    validUniqueWaybills: validUnique,
    classifiedWaybills,
    difference: classifiedWaybills - validUnique,
    balanced: classifiedWaybills === validUnique
  };
}

function assertSourceReconciliation(parsed = {}) {
  const sourceReconciliation = parsed.sourceReconciliation || buildSourceReconciliation(parsed.classificationCounts, parsed.summary?.validUniqueWaybills);
  if (sourceReconciliation.balanced === true) return;
  const error = new Error(`日报源数据分类守恒失败：有效唯一运单${Number(sourceReconciliation.validUniqueWaybills || 0)}票，七板块合计${Number(sourceReconciliation.classifiedWaybills || 0)}票`);
  error.code = 'SOURCE_CLASSIFICATION_RECONCILIATION_FAILED';
  error.sourceReconciliation = sourceReconciliation;
  throw error;
}