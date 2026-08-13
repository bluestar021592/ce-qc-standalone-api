import { getDb, nowIso } from './db.js';

const PATCH_ID = '2026-08-13-v76-current-ceaf-split-repair-v3';
const CORE_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const WHPP_EVIDENCE_TABLES = Object.freeze([
  'business_scan_results',
  'business_shipment_tracks',
  'business_track_events',
  'business_exception_items',
  'business_final_rows',
  'business_carry_bills'
]);

function safeJson(value, fallback = {}) {
  try {
    if (value && typeof value === 'object') return value;
    return JSON.parse(String(value || '')) || fallback;
  } catch {
    return fallback;
  }
}

function normalizedToken(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/[\s_\-]+/g, '');
}

function isAirMarker(value) {
  const token = normalizedToken(value);
  return token === 'CCAF' || token === 'CEAF';
}

function hasExactAirSourceMarker(row = {}) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  return Object.values(raw).some(isAirMarker);
}

function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase();
}

function ceafRow(row = {}, reportDate = '') {
  return {
    ...row,
    shipmentCode: billOf(row),
    businessType: 'CEAF',
    reportDate: reportDate || row.reportDate || '',
    customerNameRaw: 'CCAF',
    customerNameNormalized: 'CCAF',
    classificationSource: 'SOURCE_MARKER_RECOVERY',
    classificationMatchedValue: 'CCAF',
    classificationReason: '源日报存在精确CCAF/CEAF标识，启动修复归类CEAF空运',
    classificationWarning: ''
  };
}

function tableExists(db, name) {
  try { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)); }
  catch { return false; }
}

function scalar(db, sql, ...params) {
  try { return Number(db.prepare(sql).get(...params)?.count || 0); }
  catch { return 0; }
}

function currentWhppCompletion(db, reportDate, batch) {
  if (!tableExists(db, 'business_export_snapshots')) return { current: false, row: null };
  const rows = db.prepare("SELECT snapshotId,payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC,id DESC").all(reportDate);
  for (const row of rows) {
    const payload = safeJson(row.payloadJson, {});
    const state = payload.state || {};
    const sourceSnapshotId = String(state.sourceSnapshotId || '');
    const sourceBatchId = String(state.batchId || '');
    if ((sourceSnapshotId && sourceSnapshotId === String(batch.snapshotId || '')) || (sourceBatchId && sourceBatchId === String(batch.batchId || ''))) {
      return { current: true, row };
    }
  }
  return { current: false, row: null };
}

function patchWhppState(state, reportDate, airBills) {
  if (!state || state.reportDate !== reportDate) return state;
  const air = new Set(airBills);
  const filterBills = values => (values || []).filter(value => !air.has(String(value || '').trim().toUpperCase()));
  const filterRows = values => (values || []).filter(row => !air.has(billOf(row)));
  const pnhBills = filterBills(state.pnhBills);
  return {
    ...state,
    snapshotId: '',
    snapshotStatus: 'IMPORTED',
    pnhBills,
    dailyParseRows: filterRows(state.dailyParseRows),
    scanResults: filterRows(state.scanResults),
    needTrackBills: filterBills(state.needTrackBills),
    trackResults: filterRows(state.trackResults),
    trackEvents: filterRows(state.trackEvents),
    finalRows: filterRows(state.finalRows),
    exceptionItems: filterRows(state.exceptionItems),
    scanPool: filterBills(state.scanPool),
    processing: { running: false, paused: false, phase: '待处理', batchIndex: 0, totalBatches: 0 },
    lastRunSummary: null,
    lastRun: null,
    currentRun: null,
    dailyParseSummary: {
      ...(state.dailyParseSummary || {}),
      totalRecognized: pnhBills.length,
      pnh: pnhBills.length
    }
  };
}

function patchCcslState(state, reportDate, rows, podBills = []) {
  if (!state || state.reportDate !== reportDate) return state;
  const byBill = new Map((state.dailyParseRows || []).map(row => [billOf(row), row]));
  for (const row of rows) byBill.set(billOf(row), { ...row, result: 'PNH', reason: row.classificationReason });
  const pnhBills = [...new Set([...(state.pnhBills || []).map(value => String(value || '').trim().toUpperCase()), ...rows.map(billOf)].filter(Boolean))];
  const podLocks = [...new Set([...(state.podLocks || []).map(value => String(value || '').trim().toUpperCase()), ...podBills].filter(Boolean))];
  return {
    ...state,
    pnhBills,
    podLocks,
    dailyParseRows: [...byBill.values()],
    dailyParseSummary: {
      ...(state.dailyParseSummary || {}),
      totalRecognized: pnhBills.length,
      pnh: pnhBills.length,
      nonPnh: Number(state.dailyParseSummary?.nonPnh || 0),
      excluded: Number(state.dailyParseSummary?.excluded || 0)
    }
  };
}

function updateUnifiedPayload(db, batch, addedRows, createdAt) {
  const counts = Object.fromEntries(CORE_TYPES.map(type => [type, scalar(db, 'SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=? AND businessType=?', batch.batchId, type)]));
  const coreTotal = Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0);
  const summary = safeJson(batch.summaryJson, {});
  summary.validUniqueWaybills = coreTotal;
  db.prepare('UPDATE unified_import_batches SET summaryJson=? WHERE batchId=?').run(JSON.stringify(summary), batch.batchId);

  const snapshot = db.prepare('SELECT * FROM unified_snapshots WHERE snapshotId=? LIMIT 1').get(batch.snapshotId);
  if (!snapshot) return { counts, coreTotal };
  const payload = safeJson(snapshot.payloadJson, {});
  const rows = new Map((payload.rows || []).map(row => [billOf(row), row]));
  for (const row of addedRows) rows.set(billOf(row), row);
  payload.rows = [...rows.values()];
  payload.classificationCounts = counts;
  payload.summary = { ...(payload.summary || {}), validUniqueWaybills: coreTotal };
  payload.sourceReconciliation = {
    businessTypes: [...CORE_TYPES],
    validUniqueWaybills: coreTotal,
    classifiedWaybills: coreTotal,
    difference: 0,
    balanced: true
  };
  payload.repair = {
    ...(payload.repair || {}),
    ceafSplit: { patchId: PATCH_ID, moved: addedRows.length, repairedAt: createdAt }
  };
  db.prepare('UPDATE unified_snapshots SET payloadJson=? WHERE snapshotId=?').run(JSON.stringify(payload), batch.snapshotId);
  return { counts, coreTotal };
}

function archiveDiagnostic(db, batch, reportDate, shipmentCode, tableName, row, createdAt) {
  if (!tableExists(db, 'reconciliation_diagnostics')) return;
  db.prepare(`INSERT INTO reconciliation_diagnostics(
      businessType,reportDate,snapshotId,shipmentCode,conflictMetrics,latestEvent,reason,payloadJson,createdAt
    ) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(
      'WHPP', reportDate, batch.snapshotId, shipmentCode,
      JSON.stringify({ sourceTable: tableName, reclassifiedTo: 'CEAF', patchId: PATCH_ID }),
      String(row?.latestEventTime || row?.eventTime || row?.latestEventDesc || ''),
      '原WHPP记录含CCAF/CEAF源标识，已归档并重置为CEAF重新处理',
      JSON.stringify(row || {}), createdAt
    );
}

function archiveAndRemoveWrongWhppEvidence(db, batch, reportDate, bills, createdAt) {
  if (!bills.length) return { archived: 0, podBills: [] };
  const marks = bills.map(() => '?').join(',');
  const params = [reportDate, ...bills];
  let archived = 0;

  for (const table of WHPP_EVIDENCE_TABLES) {
    if (!tableExists(db, table)) continue;
    const rows = db.prepare(`SELECT * FROM ${table} WHERE businessType='WHPP' AND reportDate=? AND shipmentCode IN (${marks})`).all(...params);
    for (const row of rows) {
      archiveDiagnostic(db, batch, reportDate, String(row.shipmentCode || '').toUpperCase(), table, row, createdAt);
      archived += 1;
    }
    db.prepare(`DELETE FROM ${table} WHERE businessType='WHPP' AND reportDate=? AND shipmentCode IN (${marks})`).run(...params);
  }

  const podBills = [];
  if (tableExists(db, 'business_pod_locks')) {
    const lockParams = [...bills];
    const locks = db.prepare(`SELECT * FROM business_pod_locks WHERE businessType='WHPP' AND shipmentCode IN (${marks})`).all(...lockParams);
    for (const lock of locks) {
      const bill = String(lock.shipmentCode || '').toUpperCase();
      podBills.push(bill);
      archiveDiagnostic(db, batch, reportDate, bill, 'business_pod_locks', lock, createdAt);
      archived += 1;
      if (tableExists(db, 'pod_locks')) {
        db.prepare(`INSERT INTO pod_locks(shipmentCode,source,podTime,evidenceType,evidenceText,lastSeenReportDate,createdAt,updatedAt)
          VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(shipmentCode) DO UPDATE SET source=excluded.source,podTime=CASE WHEN excluded.podTime<>'' THEN excluded.podTime ELSE pod_locks.podTime END,lastSeenReportDate=excluded.lastSeenReportDate,updatedAt=excluded.updatedAt`)
          .run(bill, 'V76_CEAF_REPAIR', String(lock.podTime || ''), 'WHPP_RECLASSIFIED', 'CCAF/CEAF源标识从WHPP纠正到CEAF', reportDate, lock.createdAt || createdAt, createdAt);
      }
    }
    db.prepare(`DELETE FROM business_pod_locks WHERE businessType='WHPP' AND shipmentCode IN (${marks})`).run(...lockParams);
  }

  return { archived, podBills: [...new Set(podBills)] };
}

export function repairLatestCeafSplit(database = null) {
  const db = database || getDb();
  if (!tableExists(db, 'unified_import_batches') || !tableExists(db, 'business_daily_parse_rows')) {
    return { repaired: false, reason: 'SCHEMA_NOT_READY' };
  }

  const batch = db.prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get();
  if (!batch) return { repaired: false, reason: 'NO_VALID_BATCH' };
  const reportDate = String(batch.reportDate || '');
  const snapshot = tableExists(db, 'unified_snapshots')
    ? db.prepare('SELECT status FROM unified_snapshots WHERE snapshotId=? LIMIT 1').get(batch.snapshotId)
    : null;
  if (String(snapshot?.status || '').toUpperCase() === 'COMPLETED') return { repaired: false, reason: 'IMMUTABLE_COMPLETED_SNAPSHOT', reportDate };

  const whppCompletion = currentWhppCompletion(db, reportDate, batch);
  const whppRows = db.prepare("SELECT * FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY rowNumber,id").all(reportDate);
  const candidates = whppRows
    .map(record => ({ record, row: safeJson(record.rowJson, {}) }))
    .filter(item => hasExactAirSourceMarker(item.row))
    .map(item => ({ ...item, row: ceafRow(item.row, reportDate), bill: billOf(item.row) }))
    .filter(item => item.bill);
  if (!candidates.length) return { repaired: false, reason: 'NO_CCAF_SOURCE_ROWS', reportDate };

  const existing = new Set(db.prepare("SELECT shipmentCode FROM unified_import_rows WHERE batchId=? AND businessType='CEAF'").all(batch.batchId).map(row => String(row.shipmentCode || '').toUpperCase()));
  const toMove = candidates.filter(item => !existing.has(item.bill));
  if (!toMove.length) return { repaired: false, reason: 'ALREADY_REPAIRED', reportDate, ceaf: existing.size };
  const airBills = toMove.map(item => item.bill);

  const createdAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    const evidence = archiveAndRemoveWrongWhppEvidence(db, batch, reportDate, airBills, createdAt);
    const insertUnified = db.prepare(`INSERT OR IGNORE INTO unified_import_rows(
      batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,
      classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertDailySnapshot = tableExists(db, 'shipment_daily_snapshots')
      ? db.prepare(`INSERT OR REPLACE INTO shipment_daily_snapshots(snapshotId,batchId,reportDate,businessType,shipmentCode,regionCode,classificationSource,rowJson,createdAt)
          VALUES(?,?,?,?,?,?,?,?,?)`)
      : null;

    for (const item of toMove) {
      const row = item.row;
      const rowJson = JSON.stringify(row);
      insertUnified.run(
        batch.batchId, batch.snapshotId, reportDate, 'CEAF', item.bill, row.regionCode || '', row.recipientRaw || '', row.recipientNormalized || '',
        row.sheetName || item.record.sheetName || '', Number(row.rowNumber || item.record.rowNumber || 0), row.classificationReason, rowJson, createdAt,
        row.classificationSource, row.classificationMatchedValue, row.classificationWarning || ''
      );
      insertDailySnapshot?.run(batch.snapshotId, batch.batchId, reportDate, 'CEAF', item.bill, row.regionCode || '', row.classificationSource, rowJson, createdAt);
      if (tableExists(db, 'shipment_current_state')) {
        db.prepare("UPDATE shipment_current_state SET businessType='CEAF',reportDate=?,snapshotId=?,stateJson=?,updatedAt=? WHERE shipmentCode=?")
          .run(reportDate, batch.snapshotId, rowJson, createdAt, item.bill);
      }
      if (tableExists(db, 'carryover_open_items')) {
        db.prepare("UPDATE carryover_open_items SET businessType='CEAF',lastReportDate=?,lastSnapshotId=?,stateJson=?,updatedAt=? WHERE shipmentCode=?")
          .run(reportDate, batch.snapshotId, rowJson, createdAt, item.bill);
      }
      db.prepare("DELETE FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=?").run(reportDate, item.bill);
    }

    const remainingWhpp = scalar(db, "SELECT COUNT(*) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?", reportDate);
    if (tableExists(db, 'business_daily_reports')) {
      const report = db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);
      const reportSummary = safeJson(report?.summaryJson, {});
      reportSummary.total = remainingWhpp;
      reportSummary.totalRecognized = remainingWhpp;
      db.prepare("UPDATE business_daily_reports SET totalCount=?,summaryJson=?,updatedAt=? WHERE businessType='WHPP' AND reportDate=?")
        .run(remainingWhpp, JSON.stringify(reportSummary), createdAt, reportDate);
    }

    // A same-date upload may leave an older or even already-completed WHPP summary
    // pointing at the wrong 276-member source set. Preserve every export snapshot as
    // immutable evidence, but clear the single current summary pointer so the fresh
    // corrected daily membership becomes authoritative immediately.
    if (tableExists(db, 'business_history_summary')) {
      db.prepare("DELETE FROM business_history_summary WHERE businessType='WHPP' AND reportDate=?").run(reportDate);
    }

    if (tableExists(db, 'business_states')) {
      const stateRow = db.prepare("SELECT valueJson FROM business_states WHERE businessType='WHPP' LIMIT 1").get();
      if (stateRow?.valueJson) {
        const state = patchWhppState(safeJson(stateRow.valueJson, {}), reportDate, airBills);
        db.prepare("UPDATE business_states SET valueJson=?,updatedAt=? WHERE businessType='WHPP'").run(JSON.stringify(state), createdAt);
      }
    }

    const movedRows = toMove.map(item => item.row);
    if (tableExists(db, 'app_state')) {
      const app = db.prepare("SELECT valueJson FROM app_state WHERE key='current' LIMIT 1").get();
      if (app?.valueJson) {
        const state = patchCcslState(safeJson(app.valueJson, {}), reportDate, movedRows, evidence.podBills);
        db.prepare("UPDATE app_state SET valueJson=?,updatedAt=? WHERE key='current'").run(JSON.stringify(state), createdAt);

        if (state.reportDate === reportDate && tableExists(db, 'daily_reports')) {
          const dailySummary = state.dailyParseSummary || {};
          db.prepare(`UPDATE daily_reports SET pnhCount=?,totalUniqueCount=?,summaryJson=?,updatedAt=? WHERE reportDate=?`)
            .run(state.pnhBills?.length || 0, state.pnhBills?.length || 0, JSON.stringify(dailySummary), createdAt, reportDate);
        }
        if (state.reportDate === reportDate && tableExists(db, 'daily_parse_rows')) {
          const insertDaily = db.prepare(`INSERT INTO daily_parse_rows(reportDate,sheetName,rowNumber,shipmentCode,result,reason,rawText,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)`);
          for (const row of movedRows) {
            db.prepare('DELETE FROM daily_parse_rows WHERE reportDate=? AND shipmentCode=?').run(reportDate, billOf(row));
            insertDaily.run(reportDate, row.sheetName || '', Number(row.rowNumber || 0), billOf(row), 'PNH', row.classificationReason, '', JSON.stringify({ ...row, result: 'PNH', reason: row.classificationReason }), createdAt);
          }
        }
      }
    }

    // A bootstrap has no in-memory pipeline left running. Any persisted lock for the
    // just-repaired source set is therefore stale relative to the corrected membership.
    // Reset locks/checkpoints only for this report date; shipment evidence is retained
    // outside the 80 wrong-business rows and those 80 rows were archived above.
    if (tableExists(db, 'run_locks')) db.prepare('DELETE FROM run_locks WHERE reportDate=?').run(reportDate);
    if (tableExists(db, 'run_checkpoints')) db.prepare('DELETE FROM run_checkpoints WHERE reportDate=?').run(reportDate);
    if (tableExists(db, 'business_run_locks')) db.prepare("DELETE FROM business_run_locks WHERE businessType='WHPP' AND reportDate=?").run(reportDate);
    if (tableExists(db, 'business_run_checkpoints')) db.prepare("DELETE FROM business_run_checkpoints WHERE businessType='WHPP' AND reportDate=?").run(reportDate);

    const unified = updateUnifiedPayload(db, batch, movedRows, createdAt);
    db.exec('COMMIT');
    console.warn(`[CE-QC][V76_CEAF_REPAIR] reportDate=${reportDate} moved=${toMove.length} CEAF=${unified.counts.CEAF || 0} WHPP=${remainingWhpp} archived=${evidence.archived}`);
    return {
      repaired: true,
      patchId: PATCH_ID,
      reportDate,
      moved: toMove.length,
      ceaf: Number(unified.counts.CEAF || 0),
      whpp: remainingWhpp,
      coreTotal: unified.coreTotal,
      archivedEvidence: evidence.archived,
      preservedPreviousWhppSnapshot: Boolean(whppCompletion.current)
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export const V76_CURRENT_CEAF_SPLIT_REPAIR_ID = PATCH_ID;
export const __test = { hasExactAirSourceMarker, ceafRow, patchWhppState, patchCcslState, currentWhppCompletion, archiveAndRemoveWrongWhppEvidence };
