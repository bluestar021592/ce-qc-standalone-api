import { getDb, nowIso } from './db.js';

const PATCH_ID = '2026-08-13-v76-current-ceaf-split-repair-v2';
const CORE_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const ACTIVE_RUN_STATES = new Set(['running', 'paused']);

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

function activeRunBlocksRepair(db, reportDate) {
  const coreRun = tableExists(db, 'run_locks')
    ? db.prepare('SELECT status FROM run_locks WHERE reportDate=? LIMIT 1').get(reportDate)
    : null;
  const whppRun = tableExists(db, 'business_run_locks')
    ? db.prepare("SELECT status FROM business_run_locks WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)
    : null;
  return ACTIVE_RUN_STATES.has(String(coreRun?.status || '').toLowerCase())
    || ACTIVE_RUN_STATES.has(String(whppRun?.status || '').toLowerCase());
}

function processedEvidenceBlocksRepair(db, reportDate, bills) {
  if (!bills.length) return false;
  const marks = bills.map(() => '?').join(',');
  const params = [reportDate, ...bills];
  for (const table of ['business_scan_results', 'business_final_rows', 'business_track_events', 'business_exception_items']) {
    if (!tableExists(db, table)) continue;
    if (scalar(db, `SELECT COUNT(*) count FROM ${table} WHERE businessType='WHPP' AND reportDate=? AND shipmentCode IN (${marks})`, ...params) > 0) return true;
  }
  return false;
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
  const next = {
    ...state,
    pnhBills: filterBills(state.pnhBills),
    dailyParseRows: filterRows(state.dailyParseRows),
    scanResults: filterRows(state.scanResults),
    needTrackBills: filterBills(state.needTrackBills),
    trackResults: filterRows(state.trackResults),
    trackEvents: filterRows(state.trackEvents),
    finalRows: filterRows(state.finalRows),
    exceptionItems: filterRows(state.exceptionItems),
    scanPool: filterBills(state.scanPool)
  };
  next.dailyParseSummary = {
    ...(state.dailyParseSummary || {}),
    totalRecognized: next.pnhBills.length,
    pnh: next.pnhBills.length
  };
  return next;
}

function patchCcslState(state, reportDate, rows) {
  if (!state || state.reportDate !== reportDate) return state;
  const byBill = new Map((state.dailyParseRows || []).map(row => [billOf(row), row]));
  for (const row of rows) byBill.set(billOf(row), { ...row, result: 'PNH', reason: row.classificationReason });
  const pnhBills = [...new Set([...(state.pnhBills || []).map(value => String(value || '').trim().toUpperCase()), ...rows.map(billOf)].filter(Boolean))];
  const next = { ...state, pnhBills, dailyParseRows: [...byBill.values()] };
  next.dailyParseSummary = {
    ...(state.dailyParseSummary || {}),
    totalRecognized: pnhBills.length,
    pnh: pnhBills.length,
    nonPnh: Number(state.dailyParseSummary?.nonPnh || 0),
    excluded: Number(state.dailyParseSummary?.excluded || 0)
  };
  return next;
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
  if (activeRunBlocksRepair(db, reportDate)) return { repaired: false, reason: 'RUN_CURRENTLY_ACTIVE', reportDate };

  const whppCompletion = currentWhppCompletion(db, reportDate, batch);
  if (whppCompletion.current) return { repaired: false, reason: 'CURRENT_WHPP_SNAPSHOT_ALREADY_COMPLETED', reportDate };

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
  if (processedEvidenceBlocksRepair(db, reportDate, airBills)) return { repaired: false, reason: 'WHPP_AIR_ROWS_ALREADY_PROCESSED', reportDate, detected: airBills.length };

  const createdAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
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

    // A same-date re-import can leave an older WHPP history row behind. V71 gives
    // that history row priority over the fresh daily report, which is why the WHPP
    // board could show 196 while the import page still showed 276. If no completed
    // WHPP snapshot belongs to the current source snapshot, remove only that stale
    // summary pointer; old immutable export snapshots themselves are retained.
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
        const state = patchCcslState(safeJson(app.valueJson, {}), reportDate, movedRows);
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

    // V42 clears current state on a new unified import but historically did not
    // clear an old finished run lock for the same report date. Once the source
    // membership is repaired, discard only that stale finished lock/checkpoints
    // so the corrected 80 CEAF parcels are eligible for the next normal run.
    if (tableExists(db, 'run_locks')) {
      const coreRun = db.prepare('SELECT status FROM run_locks WHERE reportDate=? LIMIT 1').get(reportDate);
      if (String(coreRun?.status || '').toLowerCase() === 'finished') {
        db.prepare('DELETE FROM run_locks WHERE reportDate=?').run(reportDate);
        if (tableExists(db, 'run_checkpoints')) db.prepare('DELETE FROM run_checkpoints WHERE reportDate=?').run(reportDate);
      }
    }

    const unified = updateUnifiedPayload(db, batch, movedRows, createdAt);
    db.exec('COMMIT');
    console.warn(`[CE-QC][V76_CEAF_REPAIR] reportDate=${reportDate} moved=${toMove.length} CEAF=${unified.counts.CEAF || 0} WHPP=${remainingWhpp}`);
    return {
      repaired: true,
      patchId: PATCH_ID,
      reportDate,
      moved: toMove.length,
      ceaf: Number(unified.counts.CEAF || 0),
      whpp: remainingWhpp,
      coreTotal: unified.coreTotal
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export const V76_CURRENT_CEAF_SPLIT_REPAIR_ID = PATCH_ID;
export const __test = { hasExactAirSourceMarker, ceafRow, patchWhppState, patchCcslState, currentWhppCompletion };
