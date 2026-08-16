import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { SHOP_WHITELIST_SOURCE_SHA256, SHOP_WHITELIST_VERSION } from './shopWhitelist.js';
import { getDb, nowIso } from './db.js';
import { buildSnapshotHashes } from './snapshotHash.js';
import { persistPendingDailyMembers } from './pendingDays.js';

export const SHOPEE = 'SHOPEE';

export function loadBusinessState(businessType = SHOPEE) {
  const type = normalizeType(businessType);
  const db = getDb();
  const meta = db.prepare('SELECT length(valueJson) AS jsonLength FROM business_states WHERE businessType=?').get(type);
  let base = emptyState(type);
  const jsonLength = Number(meta?.jsonLength || 0);
  if (jsonLength > 0 && jsonLength <= 96 * 1024 * 1024) {
    const row = db.prepare('SELECT valueJson FROM business_states WHERE businessType=?').get(type);
    try { base = normalizeBusinessState(JSON.parse(row?.valueJson || '{}'), type); } catch { base = emptyState(type); }
  } else if (jsonLength > 0) {
    try {
      const row = db.prepare(`SELECT
        json_extract(valueJson,'$.reportDate') AS reportDate,
        json_extract(valueJson,'$.sourceName') AS sourceName,
        json_extract(valueJson,'$.snapshotId') AS snapshotId
        FROM business_states WHERE businessType=?`).get(type);
      base = normalizeBusinessState({ ...base, ...row }, type);
    } catch {}
  }
  const hydrated = hydrateBusinessStateFromTables(db, base, type);
  return restrictShopeeState(hydrated, type);
}

export function saveBusinessState(state = {}, businessType = state.businessType || SHOPEE, options = {}) {
  const type = normalizeType(businessType);
  const normalized = restrictShopeeState(normalizeBusinessState(state, type), type);
  const mode = String(options.mode || 'full').toLowerCase();
  const persisted = compactBusinessStatePayload(normalized, mode);
  const db = getDb();
  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO business_states(businessType,valueJson,updatedAt) VALUES(?,?,?)
      ON CONFLICT(businessType) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`)
      .run(type, JSON.stringify(persisted), now);
    if (mode === 'import') mirrorBusinessImportTables(db, normalized, type, now);
    else if (mode === 'checkpoint') mirrorBusinessProgress(db, normalized, type, now);
    else if (mode !== 'state-only') mirrorBusinessTables(db, normalized, type, now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return normalized;
}

export function saveBusinessRunProgress(state = {}, businessType = state.businessType || SHOPEE) {
  const type = normalizeType(businessType);
  const normalized = restrictShopeeState(normalizeBusinessState(state, type), type);
  const db = getDb();
  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    mirrorBusinessProgress(db, normalized, type, now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function getBusinessCurrentReportDate(businessType = SHOPEE) {
  const type = normalizeType(businessType);
  return getDb().prepare('SELECT reportDate FROM business_daily_reports WHERE businessType=? ORDER BY updatedAt DESC,reportDate DESC LIMIT 1').get(type)?.reportDate || '';
}

export function createOrRecoverBusinessRun(businessType, reportDate, options = {}) {
  const type = normalizeType(businessType);
  const date = String(reportDate || '').trim();
  const db = getDb();
  if (!date || !db.prepare('SELECT 1 FROM business_daily_reports WHERE businessType=? AND reportDate=?').get(type, date)) {
    return { ok: false, code: 'REPORT_DATE_MISSING', error: `当前未导入${type}当日日报Excel，请先导入后再开始处理。` };
  }
  const existing = db.prepare('SELECT * FROM business_run_locks WHERE businessType=? AND reportDate=?').get(type, date);
  if (existing && ['running', 'paused', 'failed'].includes(existing.status) && !(existing.status === 'failed' && options.repair)) {
    if (existing.status === 'running' && options.rejectRunning) return { ok: false, code: 'RUN_ALREADY_ACTIVE', error: '当前任务正在运行，请勿重复启动。', run: existing };
    db.prepare("UPDATE business_run_locks SET status='running',errorMessage='',updatedAt=? WHERE businessType=? AND reportDate=?").run(nowIso(), type, date);
    return { ok: true, created: false, recovered: true, run: getBusinessRunStatus(type, date).lock };
  }
  if (existing?.status === 'finished' && !options.repair) return { ok: false, code: 'RUN_ALREADY_COMPLETED', error: '当前任务已经完成，不能重复调用API。', run: existing };
  const runId = options.runId || randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO business_run_locks(businessType,reportDate,runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedBy,lockedAt,completedAt,updatedAt)
    VALUES(?,?,?,'running','准备处理',0,0,'',?,?, '',?)
    ON CONFLICT(businessType,reportDate) DO UPDATE SET runId=excluded.runId,status='running',currentStage='准备处理',batchIndex=0,totalBatches=0,errorMessage='',lockedBy=excluded.lockedBy,lockedAt=excluded.lockedAt,completedAt='',updatedAt=excluded.updatedAt`)
    .run(type, date, runId, options.lockedBy || '', now, now);
  return { ok: true, created: true, recovered: false, run: getBusinessRunStatus(type, date).lock };
}

export function getBusinessRunStatus(businessType, reportDate) {
  const type = normalizeType(businessType);
  const date = String(reportDate || '').trim();
  const db = getDb();
  return {
    businessType: type,
    reportDate: date,
    lock: date ? db.prepare('SELECT * FROM business_run_locks WHERE businessType=? AND reportDate=?').get(type, date) || null : null,
    checkpoints: date ? db.prepare('SELECT * FROM business_run_checkpoints WHERE businessType=? AND reportDate=? ORDER BY updatedAt DESC,id DESC LIMIT 50').all(type, date) : []
  };
}

export function updateBusinessRunLock(businessType, reportDate, status, errorMessage = '') {
  const now = nowIso();
  getDb().prepare(`UPDATE business_run_locks SET status=?,errorMessage=?,completedAt=CASE WHEN ?='finished' THEN ? ELSE completedAt END,updatedAt=? WHERE businessType=? AND reportDate=?`)
    .run(status, errorMessage, status, now, now, normalizeType(businessType), reportDate);
}

export function resetBusinessRunForReport(businessType, reportDate) {
  const type = normalizeType(businessType);
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM business_run_checkpoints WHERE businessType=? AND reportDate=?').run(type, reportDate);
    db.prepare('DELETE FROM business_export_snapshots WHERE businessType=? AND reportDate=?').run(type, reportDate);
    db.prepare('DELETE FROM business_run_locks WHERE businessType=? AND reportDate=?').run(type, reportDate);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

export function saveBusinessSnapshot(businessType, state, view) {
  const type = normalizeType(businessType);
  const reportDate = String(state.reportDate || '').trim();
  const runId = String(state.currentRun?.runId || state.lastRunSummary?.runId || '').trim();
  if (!reportDate || !runId) throw new Error('缺少reportDate或runId，不能生成处理快照。');
  if (type === SHOPEE && view?.recipientReconciliation?.status !== 'PASSED') {
    const error = new Error('SHOPEE收件人分组对账失败，不能生成正式快照。');
    error.code = 'FAILED_RECONCILIATION';
    throw error;
  }
  const existing = getBusinessSnapshot(type, reportDate, runId);
  if (existing) return existing;
  const snapshotId = `${type}_${reportDate}_${runId}_${randomUUID().slice(0, 8)}`;
  const generatedAt = nowIso();
  const snapshotState = {
    ...compactBusinessStatePayload(normalizeBusinessState(state, type), 'full'),
    businessType: type,
    snapshotId,
    finalRows: (state.finalRows || []).map(stripHeavyBusinessRow),
    trackResults: [],
    trackEvents: [],
    scanResults: [],
    shipmentTrackResults: [],
    exceptionItems: [],
    dailyParseRows: []
  };
  const snapshotHashes = buildSnapshotHashes(view || {});
  const payload = { snapshotId, businessType: type, reportDate, runId, generatedAt, view, ...snapshotHashes, state: snapshotState };
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const payloadJson = JSON.stringify({ ...payload, status: 'VALID', reconciliationStatus: 'COMPLETED', whitelistVersion: SHOP_WHITELIST_VERSION });
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    db.prepare(`INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt,status,reconciliationStatus,invalidReason,whitelistVersion,whitelistSha256,payloadHash)
      VALUES(?,?,?,?,?,?,?,'VALID','COMPLETED','',?,?,?)`)
      .run(snapshotId, type, reportDate, runId, payloadJson, generatedAt, generatedAt, SHOP_WHITELIST_VERSION, SHOP_WHITELIST_SOURCE_SHA256, payloadHash);
    db.prepare("UPDATE business_run_locks SET status='finished',currentStage='完成',completedAt=?,updatedAt=? WHERE businessType=? AND reportDate=? AND runId=?")
      .run(generatedAt, generatedAt, type, reportDate, runId);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  return payload;
}

export function invalidateBusinessSnapshots(businessType, reportDate, reason = {}) {
  const type = normalizeType(businessType);
  const date = String(reportDate || '').trim();
  if (!date) return { changed: 0 };
  const info = JSON.stringify({ ...reason, invalidatedAt: nowIso() });
  const result = getDb().prepare(`
    UPDATE business_export_snapshots
    SET status='INVALID', reconciliationStatus='FAILED', invalidReason=?
    WHERE businessType=? AND reportDate=? AND COALESCE(status,'VALID')='VALID'
  `).run(info, type, date);
  return { changed: result.changes || 0 };
}

export function getBusinessSnapshot(businessType, reportDate, runId = '') {
  const type = normalizeType(businessType);
  const row = runId
    ? getDb().prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType=? AND reportDate=? AND runId=? AND COALESCE(status,'VALID')='VALID' ORDER BY id DESC LIMIT 1").get(type, reportDate, runId)
    : getDb().prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType=? AND reportDate=? AND COALESCE(status,'VALID')='VALID' ORDER BY id DESC LIMIT 1").get(type, reportDate);
  try { return row?.payloadJson ? JSON.parse(row.payloadJson) : null; } catch { return null; }
}

export function getBusinessSnapshotById(businessType, snapshotId) {
  const type = normalizeType(businessType);
  const row = getDb().prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType=? AND snapshotId=? AND COALESCE(status,'VALID')='VALID'").get(type, String(snapshotId || '').trim());
  try { return row?.payloadJson ? JSON.parse(row.payloadJson) : null; } catch { return null; }
}

export function listBusinessHistoryDates(businessType, limit = 60) {
  return getDb().prepare(`SELECT reportDate,snapshotId,runId,generatedAt
    FROM business_export_snapshots WHERE businessType=? AND COALESCE(status,'VALID')='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT ?`)
    .all(normalizeType(businessType), Math.max(1, Math.min(365, Number(limit || 60))));
}

export function getMatchingBusinessSnapshot(businessType, state = {}) {
  const type = normalizeType(businessType);
  const runId = state.currentRun?.runId || state.lastRunSummary?.runId || '';
  return state.reportDate ? getBusinessSnapshot(type, state.reportDate, runId) : null;
}

export function recordBusinessExport({ businessType, reportDate, snapshotId, exportType, fileName, rowCount }) {
  getDb().prepare('INSERT INTO business_export_records(businessType,reportDate,snapshotId,exportType,fileName,rowCount,createdAt) VALUES(?,?,?,?,?,?,?)')
    .run(normalizeType(businessType), reportDate || '', snapshotId || '', exportType || '', fileName || '', Number(rowCount || 0), nowIso());
}

export function loadBusinessDetail(businessType, reportDate, shipmentCode) {
  const type = normalizeType(businessType);
  const bill = String(shipmentCode || '').trim().toUpperCase();
  const db = getDb();
  const inflate = row => row?.rawJson ? JSON.parse(row.rawJson) : row || null;
  return {
    businessType: type, reportDate, shipmentCode: bill,
    scan: inflate(db.prepare('SELECT * FROM business_scan_results WHERE businessType=? AND reportDate=? AND shipmentCode=?').get(type, reportDate, bill)),
    shipmentTrack: inflate(db.prepare('SELECT * FROM business_shipment_tracks WHERE businessType=? AND reportDate=? AND shipmentCode=?').get(type, reportDate, bill)),
    finalRow: inflate(db.prepare('SELECT * FROM business_final_rows WHERE businessType=? AND reportDate=? AND shipmentCode=?').get(type, reportDate, bill)),
    events: db.prepare('SELECT * FROM business_track_events WHERE businessType=? AND reportDate=? AND shipmentCode=? ORDER BY eventTime').all(type, reportDate, bill).map(inflate),
    exceptions: db.prepare('SELECT * FROM business_exception_items WHERE businessType=? AND reportDate=? AND shipmentCode=? ORDER BY reportTime').all(type, reportDate, bill).map(inflate),
    apiBatches: db.prepare('SELECT apiName,status,attemptCount,resultCount,errorMessage,updatedAt FROM business_api_batches WHERE businessType=? AND reportDate=? AND shipmentCodesJson LIKE ? ORDER BY updatedAt').all(type, reportDate, `%${bill}%`),
    podLock: db.prepare('SELECT * FROM business_pod_locks WHERE businessType=? AND shipmentCode=?').get(type, bill) || null,
    carry: db.prepare('SELECT * FROM business_carry_bills WHERE businessType=? AND shipmentCode=? ORDER BY updatedAt DESC').all(type, bill)
  };
}

function parseJsonSafe(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function stripHeavyBusinessRow(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...row };
  delete copy.rawJson;
  delete copy.raw;
  delete copy.events;
  delete copy.trackEvents;
  delete copy.exceptionItems;
  delete copy.scanRaw;
  return copy;
}

function compactBusinessStatePayload(state = {}, mode = 'full') {
  const summary = state.dailyParseSummary || state.daily?.summary || null;
  const compactDaily = state.daily ? {
    reportDate: state.reportDate || state.daily.reportDate || '',
    sourceName: state.sourceName || state.daily.sourceName || '',
    importedAt: state.daily.importedAt || summary?.importedAt || '',
    summary
  } : null;
  const checkpoint = mode === 'checkpoint';
  return {
    ...state,
    checkpointMode: checkpoint,
    currentDayOnly: state.currentDayOnly !== false,
    daily: compactDaily,
    dailyParseRows: [],
    recipientConflicts: [],
    scanResults: checkpoint ? (state.scanResults || []).map(stripHeavyBusinessRow) : [],
    scanQueryStatus: checkpoint ? (state.scanQueryStatus || []).map(stripHeavyBusinessRow) : [],
    shipmentTrackResults: checkpoint ? (state.shipmentTrackResults || []).map(stripHeavyBusinessRow) : [],
    shipmentQueryStatus: checkpoint ? (state.shipmentQueryStatus || []).map(stripHeavyBusinessRow) : [],
    trackEvents: checkpoint ? (state.trackEvents || []).map(stripHeavyBusinessRow) : [],
    eventQueryStatus: checkpoint ? (state.eventQueryStatus || []).map(stripHeavyBusinessRow) : [],
    exceptionItems: checkpoint ? (state.exceptionItems || []).map(stripHeavyBusinessRow) : [],
    exceptionQueryStatus: checkpoint ? (state.exceptionQueryStatus || []).map(stripHeavyBusinessRow) : [],
    apiBatchStatus: checkpoint ? (state.apiBatchStatus || []).map(stripHeavyBusinessRow) : [],
    trackResults: (state.trackResults || []).map(stripHeavyBusinessRow),
    finalRows: checkpoint ? (state.finalRows || []).map(stripHeavyBusinessRow) : [],
    priorCarryRows: [],
    historicalCarryBills: []
  };
}

function rowsFromJson(db, sql, params = [], field = 'rawJson') {
  try {
    return db.prepare(sql).all(...params)
      .map(row => parseJsonSafe(row?.[field], null))
      .filter(Boolean)
      .map(stripHeavyBusinessRow);
  } catch {
    return [];
  }
}

function hydrateBusinessStateFromTables(db, state = {}, type = SHOPEE) {
  let date = String(state.reportDate || '').trim();
  if (!date) {
    const latest = db.prepare('SELECT reportDate,sourceFile,summaryJson FROM business_daily_reports WHERE businessType=? ORDER BY updatedAt DESC,reportDate DESC LIMIT 1').get(type);
    if (!latest?.reportDate) return state;
    date = latest.reportDate;
    state = { ...state, reportDate: date, sourceName: latest.sourceFile || state.sourceName || '' };
  }

  const report = db.prepare('SELECT sourceFile,totalCount,summaryJson FROM business_daily_reports WHERE businessType=? AND reportDate=?').get(type, date);
  const dailySummary = parseJsonSafe(report?.summaryJson, state.dailyParseSummary || null);
  const dailyRows = rowsFromJson(db,
    'SELECT rowJson FROM business_daily_parse_rows WHERE businessType=? AND reportDate=? ORDER BY id',
    [type, date], 'rowJson');
  const persistedScanResults = rowsFromJson(db,
    'SELECT rawJson FROM business_scan_results WHERE businessType=? AND reportDate=? ORDER BY shipmentCode',
    [type, date]);
  const persistedShipmentTracks = rowsFromJson(db,
    'SELECT rawJson FROM business_shipment_tracks WHERE businessType=? AND reportDate=? ORDER BY shipmentCode',
    [type, date]);
  const persistedTrackEvents = rowsFromJson(db,
    'SELECT rawJson FROM business_track_events WHERE businessType=? AND reportDate=? ORDER BY eventTime,id',
    [type, date]);
  const persistedExceptions = rowsFromJson(db,
    'SELECT rawJson FROM business_exception_items WHERE businessType=? AND reportDate=? ORDER BY reportTime,id',
    [type, date]);
  const persistedFinalRows = rowsFromJson(db,
    'SELECT rawJson FROM business_final_rows WHERE businessType=? AND reportDate=? ORDER BY shipmentCode',
    [type, date]);

  const conflictRows = db.prepare('SELECT shipmentCode,groupsJson,rowsJson,status FROM business_recipient_conflicts WHERE businessType=? AND reportDate=? ORDER BY id').all(type, date)
    .map(row => ({ shipmentCode: row.shipmentCode, groups: parseJsonSafe(row.groupsJson, []), rows: parseJsonSafe(row.rowsJson, []), status: row.status || '' }));
  const persistedApiBatchStatus = db.prepare('SELECT runId,apiName,batchKey,shipmentCodesJson,status,attemptCount,resultCount,errorMessage,createdAt,updatedAt FROM business_api_batches WHERE businessType=? AND reportDate=? ORDER BY updatedAt').all(type, date)
    .map(row => ({ ...row, shipmentCodes: parseJsonSafe(row.shipmentCodesJson, []) }));
  const podLocks = db.prepare(`SELECT p.shipmentCode
    FROM business_pod_locks p
    WHERE p.businessType=? AND (
      EXISTS (SELECT 1 FROM business_daily_parse_rows d WHERE d.businessType=? AND d.reportDate=? AND d.shipmentCode=p.shipmentCode)
      OR EXISTS (SELECT 1 FROM business_carry_bills c WHERE c.businessType=? AND c.status='active' AND c.shipmentCode=p.shipmentCode)
    ) ORDER BY p.shipmentCode`).all(type, type, date, type).map(row => row.shipmentCode);
  const carryRowsRaw = rowsFromJson(db,
    "SELECT rawJson FROM business_carry_bills WHERE businessType=? AND status='active' ORDER BY updatedAt DESC",
    [type]);
  const carryByBill = new Map();
  for (const row of carryRowsRaw) {
    const bill = billOf(row);
    if (bill && !carryByBill.has(bill)) carryByBill.set(bill, row);
  }
  const historicalCarryRows = [...carryByBill.values()];
  const historicalCarryBills = historicalCarryRows.map(billOf).filter(Boolean);
  const run = db.prepare('SELECT * FROM business_run_locks WHERE businessType=? AND reportDate=?').get(type, date) || null;
  const historyRows = db.prepare('SELECT summaryJson FROM business_history_summary WHERE businessType=? ORDER BY reportDate DESC LIMIT 30').all(type)
    .map(row => parseJsonSafe(row.summaryJson, null)).filter(Boolean).reverse();
  const latestSnapshot = db.prepare("SELECT snapshotId FROM business_export_snapshots WHERE businessType=? AND reportDate=? AND COALESCE(status,'VALID')='VALID' ORDER BY id DESC LIMIT 1").get(type, date);
  const pnhBills = dailyRows.map(billOf).filter(Boolean);
  const checkpoint = Boolean(state.checkpointMode);
  const scanResults = checkpoint && (state.scanResults || []).length ? state.scanResults : persistedScanResults;
  const shipmentTrackResults = checkpoint && (state.shipmentTrackResults || []).length ? state.shipmentTrackResults : persistedShipmentTracks;
  const trackEvents = checkpoint && (state.trackEvents || []).length ? state.trackEvents : persistedTrackEvents;
  const exceptionItems = checkpoint && (state.exceptionItems || []).length ? state.exceptionItems : persistedExceptions;
  const finalRows = checkpoint && (state.finalRows || []).length ? state.finalRows : persistedFinalRows;
  const apiBatchStatus = checkpoint && (state.apiBatchStatus || []).length ? state.apiBatchStatus : persistedApiBatchStatus;
  const currentCarryBills = state.currentDayOnly ? (state.carryBills || []) : historicalCarryBills;
  const podSet = new Set([...(state.podLocks || []), ...podLocks]);
  const scanPool = [...new Set([...pnhBills, ...currentCarryBills])].filter(bill => !podSet.has(bill));
  const needTrackBills = (state.needTrackBills || []).length
    ? state.needTrackBills
    : scanResults.filter(row => row.trackRequired === true && row.是否POD !== '是').map(billOf).filter(Boolean);
  const currentSummary = historyRows.find(item => String(item?.reportDate || '') === date) || state.lastRunSummary || null;

  return normalizeBusinessState({
    ...state,
    businessType: type,
    reportDate: date,
    sourceName: report?.sourceFile || state.sourceName || '',
    dailyReportReady: Boolean(report || dailyRows.length),
    dailyParseSummary: dailySummary,
    daily: state.daily || (report ? { reportDate: date, sourceName: report.sourceFile || '', summary: dailySummary } : null),
    dailyParseRows: dailyRows,
    recipientConflicts: conflictRows,
    recipientReconciliation: state.recipientReconciliation || dailySummary?.reconciliation || null,
    pnhBills: pnhBills.length ? pnhBills : state.pnhBills,
    podLocks: [...podSet],
    carryBills: currentCarryBills,
    historicalCarryBills,
    priorCarryRows: state.currentDayOnly ? (state.priorCarryRows || []) : historicalCarryRows,
    scanPool,
    scanResults,
    shipmentTrackResults,
    trackEvents,
    exceptionItems,
    apiBatchStatus,
    finalRows,
    needTrackBills,
    historySummary: historyRows.length ? historyRows : state.historySummary,
    processing: run ? {
      running: run.status === 'running',
      paused: run.status === 'paused',
      phase: run.currentStage || '',
      batchIndex: Number(run.batchIndex || 0),
      totalBatches: Number(run.totalBatches || 0),
      error: run.errorMessage || '',
      runId: run.runId || ''
    } : state.processing,
    currentRun: run || state.currentRun,
    lastRunSummary: currentSummary,
    lastRun: currentSummary,
    snapshotId: latestSnapshot?.snapshotId || state.snapshotId || ''
  }, type);
}

export function normalizeBusinessState(state = {}, businessType = SHOPEE) {
  const type = normalizeType(businessType);
  const clean = list => [...new Set((list || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
  return {
    businessType: type,
    reportDate: state.reportDate || '', sourceName: state.sourceName || '', dailyReportReady: Boolean(state.dailyReportReady || state.daily?.summary?.totalRecognized),
    currentDayOnly: state.currentDayOnly !== false,
    checkpointMode: Boolean(state.checkpointMode),
    daily: state.daily || null, dailyParseSummary: state.dailyParseSummary || state.daily?.summary || null, dailyParseRows: state.dailyParseRows || state.daily?.importRows || state.daily?.details || [],
    recipientConflicts: state.recipientConflicts || state.daily?.conflicts || [], recipientReconciliation: state.recipientReconciliation || state.daily?.summary?.reconciliation || null,
    pnhBills: clean(state.pnhBills || state.bills || []), carryBills: clean(state.carryBills || []), historicalCarryBills: clean(state.historicalCarryBills || []), podLocks: clean(state.podLocks || []),
    scanPool: clean(state.scanPool || []), scanRetryBills: clean(state.scanRetryBills || []), scanResults: state.scanResults || [], scanQueryStatus: state.scanQueryStatus || [], shipmentTrackResults: state.shipmentTrackResults || [], shipmentQueryStatus: state.shipmentQueryStatus || [], needTrackBills: clean(state.needTrackBills || []),
    trackEvents: state.trackEvents || [], eventQueryStatus: state.eventQueryStatus || [], exceptionItems: state.exceptionItems || [], exceptionQueryStatus: state.exceptionQueryStatus || [],
    apiBatchStatus: state.apiBatchStatus || [], trackResults: state.trackResults || [], finalRows: state.finalRows || [], priorCarryRows: state.priorCarryRows || [], nextCarryBills: clean(state.nextCarryBills?.length ? state.nextCarryBills : (state.carryBills || [])),
    historySummary: (state.historySummary || []).slice(-30), processing: state.processing || { running: false, paused: false, phase: '' },
    currentRun: state.currentRun || null, lastRunSummary: state.lastRunSummary || state.lastRun || null, lastRun: state.lastRun || state.lastRunSummary || null,
    backupImportedAt: state.backupImportedAt || '', backupSummary: state.backupSummary || null, apiDiagnostic: state.apiDiagnostic || null, logs: (state.logs || []).slice(-300), snapshotId: state.snapshotId || ''
  };
}

function restrictShopeeState(state, type) {
  if (type !== SHOPEE) return state;
  const isEligible = row => ['CN', 'VN'].includes(recipientGroup(row));
  const eligibleBills = new Set((state.dailyParseRows || []).filter(isEligible).map(billOf).filter(Boolean));
  const rows = key => (state[key] || []).filter(row => isEligible(row) || eligibleBills.has(billOf(row)));
  const priorByBill = new Map([...rows('finalRows'), ...rows('priorCarryRows')].map(row => [billOf(row), row]));
  const keepBill = bill => eligibleBills.has(bill) || isEligible(priorByBill.get(bill) || {});
  return {
    ...state,
    dailyParseRows: (state.dailyParseRows || []).filter(isEligible),
    dailyParseSummary: sanitizeShopeeDailySummary(state.dailyParseSummary),
    daily: state.daily ? { ...state.daily, importRows: (state.daily.importRows || []).filter(isEligible), preview: (state.daily.preview || []).filter(isEligible), excludedRows: [] } : state.daily,
    pnhBills: (state.pnhBills || []).filter(keepBill),
    carryBills: (state.carryBills || []).filter(keepBill),
    nextCarryBills: (state.nextCarryBills || []).filter(keepBill),
    podLocks: (state.podLocks || []).filter(keepBill),
    scanPool: (state.scanPool || []).filter(keepBill),
    scanRetryBills: (state.scanRetryBills || []).filter(keepBill),
    needTrackBills: (state.needTrackBills || []).filter(keepBill),
    scanResults: rows('scanResults'),
    shipmentTrackResults: rows('shipmentTrackResults'),
    trackEvents: rows('trackEvents'),
    exceptionItems: rows('exceptionItems'),
    trackResults: rows('trackResults'),
    finalRows: rows('finalRows'),
    priorCarryRows: rows('priorCarryRows')
  };
}

function mirrorBusinessImportTables(db, state, type, now) {
  const date = state.reportDate;
  if (!date) return;
  clearCurrentBusinessDateProcessing(db, type, date);
  mirrorBusinessDailyTables(db, state, type, now);
  mirrorBusinessPodLocks(db, state, type, now);
}

function clearCurrentBusinessDateProcessing(db, type, date) {
  for (const table of ['business_scan_results','business_shipment_tracks','business_track_events','business_exception_items','business_final_rows','business_api_batches']) {
    db.prepare(`DELETE FROM ${table} WHERE businessType=? AND reportDate=?`).run(type, date);
  }
  db.prepare('DELETE FROM pending_daily_members WHERE businessType=? AND reportDate=?').run(type, date);
}

function mirrorBusinessDailyTables(db, state, type, now) {
  const date = state.reportDate;
  if (!date || !state.dailyReportReady) return;
  db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(businessType,reportDate) DO UPDATE SET sourceFile=excluded.sourceFile,totalCount=excluded.totalCount,summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`)
    .run(type, date, state.sourceName, state.pnhBills.length, JSON.stringify(state.dailyParseSummary || {}), now, now);
  db.prepare('DELETE FROM business_daily_parse_rows WHERE businessType=? AND reportDate=?').run(type, date);
  const dailyStmt = db.prepare(`INSERT INTO business_daily_parse_rows(
    businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,
    recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of state.dailyParseRows) dailyStmt.run(
    type, date, billOf(row), row.sheetName || '', Number(row.rowNumber || row.source_row_number || 0), Number(row.source_row_number || row.rowNumber || 0),
    row.recipient_raw || '', row.recipient_normalized || '', recipientGroup(row), row.recipient_group_reason || '', row.rawText || '', JSON.stringify(row), now
  );
  db.prepare('DELETE FROM business_recipient_conflicts WHERE businessType=? AND reportDate=?').run(type, date);
  const conflictStmt = db.prepare(`INSERT INTO business_recipient_conflicts(
    businessType,reportDate,shipmentCode,groupsJson,rowsJson,status,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,'unresolved',?,?)`);
  for (const conflict of state.recipientConflicts || []) conflictStmt.run(type, date, billOf(conflict), JSON.stringify(conflict.groups || []), JSON.stringify(conflict.rows || []), now, now);
}

function mirrorBusinessPodLocks(db, state, type, now) {
  const podStmt = db.prepare(`INSERT INTO business_pod_locks(businessType,shipmentCode,podTime,source,createdAt,updatedAt) VALUES(?,?,?,'state',?,?)
    ON CONFLICT(businessType,shipmentCode) DO UPDATE SET podTime=excluded.podTime,updatedAt=excluded.updatedAt`);
  for (const bill of state.podLocks) podStmt.run(type, bill, '', now, now);
}

function mirrorBusinessTables(db, state, type, now) {
  const date = state.reportDate;
  mirrorBusinessDailyTables(db, state, type, now);
  mirrorBusinessPodLocks(db, state, type, now);

  const active = new Set(state.nextCarryBills.length ? state.nextCarryBills : state.carryBills);
  const podSet = new Set(state.podLocks);
  // Historical carry is not closed merely because it is absent from today's
  // auto-run state. It closes only with explicit terminal evidence.
  for (const bill of podSet) {
    db.prepare("UPDATE business_carry_bills SET status='closed_pod',updatedAt=? WHERE businessType=? AND shipmentCode=? AND status='active'").run(now, type, bill);
  }
  const carryStmt = db.prepare(`INSERT INTO business_carry_bills(businessType,shipmentCode,reportDate,sourceDate,status,primaryCategory,tagsJson,lastEventTime,lastEventDesc,lastCheckedDate,lastRunId,retryStatus,reason,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(businessType,shipmentCode,reportDate) DO UPDATE SET status='active',primaryCategory=excluded.primaryCategory,lastEventTime=excluded.lastEventTime,lastEventDesc=excluded.lastEventDesc,lastCheckedDate=excluded.lastCheckedDate,lastRunId=excluded.lastRunId,retryStatus=excluded.retryStatus,reason=excluded.reason,recipient_raw=excluded.recipient_raw,recipient_normalized=excluded.recipient_normalized,recipient_group=excluded.recipient_group,recipient_group_reason=excluded.recipient_group_reason,source_row_number=excluded.source_row_number,rawJson=excluded.rawJson,updatedAt=excluded.updatedAt`);
  for (const bill of active) {
    if (podSet.has(bill)) continue;
    const final = state.finalRows.find(row => billOf(row) === bill) || state.priorCarryRows.find(row => billOf(row) === bill) || {};
    carryStmt.run(type, bill, date || '__active__', final.sourceDate || date, 'active', final.primaryCategory || final.异常分类 || '', JSON.stringify(final.tags || []), final.latestEventTime || final.最后节点时间 || '', final.latestEventDesc || final.最后节点 || '', date, state.currentRun?.runId || state.lastRunSummary?.runId || '', final.查询状态 === 'refresh_failed' ? 'refresh_failed' : '', final.QC判断 || '', final.recipient_raw || '', final.recipient_normalized || '', recipientGroup(final), final.recipient_group_reason || '', Number(final.source_row_number || final.rowNumber || 0), JSON.stringify(final), now, now);
  }
  for (const row of state.finalRows) {
    const bill = billOf(row);
    if (bill && active.has(bill)) persistStoreFields(db, 'business_carry_bills', type, bill, date || '__active__', row);
  }
  if (!date) return;
  mirrorRows(db, 'business_scan_results', type, date, state.scanResults, now, row => [Number(row.是否POD === '是'), String(row.orderStatus || ''), JSON.stringify(row)]);
  db.prepare('DELETE FROM business_shipment_tracks WHERE businessType=? AND reportDate=?').run(type, date);
  const shipmentStmt = db.prepare(`INSERT INTO business_shipment_tracks(businessType,shipmentCode,reportDate,shipmentStatus,statusText,apiStatus,rawJson,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  for (const row of state.shipmentTrackResults) shipmentStmt.run(type, billOf(row), date, String(row.shipmentStatus ?? row.statusCode ?? ''), row.statusText || row.shipmentStatusDesc || '', row.apiStatus || row.API状态 || 'success', JSON.stringify(row), now, now);
  db.prepare('DELETE FROM business_track_events WHERE businessType=? AND reportDate=?').run(type, date);
  const eventStmt = db.prepare('INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES(?,?,?,?,?,?,?)');
  for (const row of state.trackEvents) eventStmt.run(type, billOf(row), date, row.eventTime || '', row.eventCode || '', JSON.stringify(row), now);
  persistPendingDailyMembers(db, { businessType: type, reportDate: date, snapshotId: state.snapshotId || '', events: state.trackEvents, createdAt: now });
  db.prepare('DELETE FROM business_exception_items WHERE businessType=? AND reportDate=?').run(type, date);
  const exceptionStmt = db.prepare(`INSERT INTO business_exception_items(businessType,shipmentCode,reportDate,exceptionType,exceptionDesc,reportTime,statusCode,fileId,rawJson,createdAt)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  for (const row of state.exceptionItems) exceptionStmt.run(type, billOf(row), date, row.exceptionType || '', row.exceptionDesc || '', row.reportTime || '', String(row.statusCode ?? ''), String(row.fileId ?? ''), JSON.stringify(row), now);
  mirrorBusinessApiBatches(db, state, type, now);
  db.prepare('DELETE FROM business_final_rows WHERE businessType=? AND reportDate=?').run(type, date);
  const finalStmt = db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of state.finalRows) finalStmt.run(type, billOf(row), date, Number(row.是否POD === '是'), row.primaryCategory || row.异常分类 || '', row.API状态 || row.查询状态 || '', row.carry状态 || '', row.latestEventTime || row.最后节点时间 || '', row.latestEventDesc || row.最后节点 || '', row.latestNode || '', row.recipient_raw || '', row.recipient_normalized || '', recipientGroup(row), row.recipient_group_reason || '', Number(row.source_row_number || row.rowNumber || 0), JSON.stringify(row), now, now);
  for (const row of state.finalRows) persistStoreFields(db, 'business_final_rows', type, billOf(row), date, row);
  const historyStmt = db.prepare(`INSERT INTO business_history_summary(businessType,reportDate,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`);
  for (const item of state.historySummary) {
    const historyDate = item.reportDate || item.summary?.reportDate || '';
    if (historyDate) historyStmt.run(type, historyDate, JSON.stringify(item.summary || item), now, now);
  }
  mirrorBusinessProgress(db, state, type, now, { skipApiBatches: true });
}

function mirrorBusinessProgress(db, state, type, now, options = {}) {
  const date = state.reportDate;
  const run = state.currentRun || state.lastRunSummary;
  if (!date || !run?.runId) return;
  if (!options.skipApiBatches) mirrorBusinessApiBatches(db, state, type, now);
  const processing = state.processing || {};
  const scanStatus = queryStatusCounts(state.scanQueryStatus, state.scanResults);
  const eventStatus = queryStatusCounts(state.eventQueryStatus, state.trackEvents);
  const exceptionStatus = queryStatusCounts(state.exceptionQueryStatus, state.exceptionItems);
  const trackStage = /exception/i.test(String(processing.phase || '')) ? exceptionStatus : eventStatus;
  const payload = {
    scanDone: scanStatus.done,
    scanRetry: scanStatus.retry,
    scanObserved: scanStatus.observed,
    scanTotal: state.scanPool.length || state.pnhBills.length,
    trackDone: trackStage.done,
    trackRetry: trackStage.retry,
    trackObserved: trackStage.observed,
    trackTotal: state.needTrackBills.length,
    finalRows: state.finalRows.length,
    runStatus: state.lastRunSummary?.runStatus || ''
  };
  db.prepare(`UPDATE business_run_locks SET currentStage=?,batchIndex=?,totalBatches=?,errorMessage=?,updatedAt=? WHERE businessType=? AND reportDate=? AND runId=?`)
    .run(processing.phase || '', Number(processing.batchIndex || 0), Number(processing.totalBatches || 0), processing.error || '', now, type, date, run.runId);
  db.prepare('INSERT INTO business_run_checkpoints(businessType,runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(type, run.runId, date, processing.phase || '', Number(processing.batchIndex || 0), Number(processing.totalBatches || 0), processing.running ? 'running' : (processing.paused ? 'paused' : 'saved'), JSON.stringify(payload), processing.error || '', now, now);
}

function mirrorBusinessApiBatches(db, state, type, now) {
  const date = state.reportDate;
  if (!date) return;
  const batchRows = new Map();
  for (const row of state.apiBatchStatus || []) {
    const runId = row.runId || state.currentRun?.runId || state.lastRunSummary?.runId || '';
    const key = [type, date, runId, row.apiName || '', row.batchKey || ''].join('|');
    const existing = batchRows.get(key);
    if (existing?.payloadHash && row.payloadHash && existing.payloadHash !== row.payloadHash) {
      const error = new Error(`批次${row.batchKey}的保存内容不一致，已停止写入。`);
      error.code = 'BATCH_KEY_PAYLOAD_MISMATCH';
      throw error;
    }
    batchRows.set(key, { ...(existing || {}), ...row, runId });
  }
  const batchStmt = db.prepare(`INSERT INTO business_api_batches(
    businessType,reportDate,runId,apiName,batchKey,shipmentCodesJson,status,attemptCount,resultCount,errorMessage,createdAt,updatedAt,
    payloadHash,shipmentCount,firstShipmentCode,lastShipmentCode,heartbeatAt,startedAt,completedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(businessType,reportDate,runId,apiName,batchKey) DO UPDATE SET
    status=excluded.status,attemptCount=excluded.attemptCount,resultCount=excluded.resultCount,errorMessage=excluded.errorMessage,
    updatedAt=excluded.updatedAt,heartbeatAt=excluded.heartbeatAt,completedAt=excluded.completedAt
  WHERE business_api_batches.payloadHash IS NULL OR business_api_batches.payloadHash=excluded.payloadHash`);
  const existingBatchStmt = db.prepare('SELECT payloadHash FROM business_api_batches WHERE businessType=? AND reportDate=? AND runId=? AND apiName=? AND batchKey=?');
  for (const row of batchRows.values()) {
    const previous = existingBatchStmt.get(type, date, row.runId, row.apiName || '', row.batchKey || '');
    if (previous?.payloadHash && row.payloadHash && previous.payloadHash !== row.payloadHash) {
      const error = new Error(`批次${row.batchKey}的运单内容与已保存记录不一致。`);
      error.code = 'BATCH_KEY_PAYLOAD_MISMATCH';
      throw error;
    }
    batchStmt.run(
      type, date, row.runId, row.apiName || '', row.batchKey || '', JSON.stringify(row.shipmentCodes || []), row.status || '',
      Number(row.attemptCount || 0), Number(row.resultCount || 0), row.errorMessage || '', row.createdAt || now, now,
      row.payloadHash || '', Number(row.shipmentCount || (row.shipmentCodes || []).length), row.firstShipmentCode || '', row.lastShipmentCode || '',
      row.updatedAt || now, row.createdAt || now, ['success', 'failed'].includes(row.status) ? (row.updatedAt || now) : ''
    );
  }
}

function queryStatusCounts(statusRows = [], fallbackRows = []) {
  const statuses = new Map();
  for (const row of statusRows || []) {
    const bill = billOf(row);
    if (!bill) continue;
    statuses.set(bill, String(row.status || row.查询状态 || row.API状态 || '').toLowerCase());
  }
  if (!statuses.size) {
    for (const row of fallbackRows || []) {
      const bill = billOf(row);
      if (!bill) continue;
      const text = String(row.查询状态 || row.API状态 || row.status || '').toLowerCase();
      statuses.set(bill, /failed|retry|失败|待重试/.test(text) ? 'failed' : 'success');
    }
  }
  let done = 0;
  let retry = 0;
  for (const status of statuses.values()) {
    if (/failed|retry|失败|待重试/.test(status)) retry += 1;
    else done += 1;
  }
  return { done, retry, observed: done + retry };
}

function mirrorRows(db, table, type, date, rows, now, values) {
  db.prepare(`DELETE FROM ${table} WHERE businessType=? AND reportDate=?`).run(type, date);
  const stmt = db.prepare(`INSERT INTO ${table}(businessType,shipmentCode,reportDate,isPod,orderStatus,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of rows) {
    const [isPod, orderStatus, rawJson] = values(row);
    stmt.run(type, billOf(row), date, isPod, orderStatus, row.recipient_raw || '', row.recipient_normalized || '', recipientGroup(row), row.recipient_group_reason || '', Number(row.source_row_number || row.rowNumber || 0), rawJson, now, now);
  }
}

function persistStoreFields(db, table, type, shipmentCode, reportDate, row = {}) {
  if (!shipmentCode) return;
  db.prepare(`UPDATE ${table} SET
    targetShopCode=?,currentShopCode=?,shopName=?,shopCycleId=?,shopTransferStartedAt=?,shopArrivedAt=?,
    shopLastEventAt=?,shopPendingAt=?,shopPendingReason=?,shopRetentionNaturalDays=?,shopState=?,shopStateReason=?,
    whitelistVersion=?,currentMainCategory=?,auxiliaryFlagsJson=?,firstAttemptAt=?,currentAttemptNo=?,podAttemptNo=?,
    attemptStatus=?,attemptConfidence=?,attemptUnknownReason=?,attemptHistoryJson=?,attemptCalculatedAt=?
    WHERE businessType=? AND shipmentCode=? AND reportDate=?`).run(
    row.targetShopCode || '', row.currentShopCode || '', row.shopName || '', row.shopCycleId || '',
    row.shopTransferStartedAt || '', row.shopArrivedAt || '', row.shopLastEventAt || '', row.shopPendingAt || '',
    row.shopPendingReason || '', Number(row.shopRetentionNaturalDays || 0), row.shopState || '', row.shopStateReason || '',
    row.whitelistVersion || '', row.currentMainCategory || row.primaryCategory || '',
    JSON.stringify(row.auxiliaryFlags || row.tags || []), row.firstAttemptAt || '', Number(row.currentAttemptNo || 0),
    Number(row.podAttemptNo || 0), row.attemptStatus || '', row.attemptConfidence || '', row.attemptUnknownReason || '',
    JSON.stringify(row.attemptHistory || []), row.attemptCalculatedAt || '', type, shipmentCode, reportDate
  );
}

function emptyState(type) { return normalizeBusinessState({ businessType: type }, type); }
function normalizeType(value) { return String(value || '').toUpperCase() === 'SHOPEE' ? 'SHOPEE' : 'CCSL'; }
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase(); }
function recipientGroup(row = {}) { const value = String(row.recipient_group || row.recipientGroup || '').toUpperCase(); return ['CN', 'VN', 'OTHER'].includes(value) ? value : 'OTHER'; }

function sanitizeShopeeDailySummary(summary = null) {
  if (!summary || typeof summary !== 'object') return summary;
  const groupCounts = summary.groupCounts && typeof summary.groupCounts === 'object'
    ? { CN: Number(summary.groupCounts.CN || 0), VN: Number(summary.groupCounts.VN || 0) }
    : summary.groupCounts;
  const reconciliation = summary.reconciliation && typeof summary.reconciliation === 'object'
    ? {
        ...summary.reconciliation,
        CN: Number(summary.reconciliation.CN || groupCounts?.CN || 0),
        VN: Number(summary.reconciliation.VN || groupCounts?.VN || 0),
        total: Number(summary.reconciliation.total || 0)
      }
    : summary.reconciliation;
  if (reconciliation && 'OTHER' in reconciliation) delete reconciliation.OTHER;
  return {
    eligibleUniqueShipments: Number(summary.eligibleUniqueShipments || summary.totalRecognized || reconciliation?.total || 0),
    totalRecognized: Number(summary.totalRecognized || summary.eligibleUniqueShipments || reconciliation?.total || 0),
    conflictCount: Number(summary.conflictCount || 0),
    recipientHeader: summary.recipientHeader || '',
    groupCounts,
    reconciliation,
    warnings: (summary.warnings || []).filter(text => !/OTHER|其他|待确认/.test(String(text || ''))),
    failedRows: summary.failedRows || [],
    actualHeaders: summary.actualHeaders || []
  };
}