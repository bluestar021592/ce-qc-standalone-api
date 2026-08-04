import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { SHOP_WHITELIST_SOURCE_SHA256, SHOP_WHITELIST_VERSION } from './shopWhitelist.js';
import { getDb, nowIso } from './db.js';
import { buildSnapshotHashes } from './snapshotHash.js';

export const SHOPEE = 'SHOPEE';

export function loadBusinessState(businessType = SHOPEE) {
  const type = normalizeType(businessType);
  const row = getDb().prepare('SELECT valueJson FROM business_states WHERE businessType=?').get(type);
  if (!row?.valueJson) return emptyState(type);
  try { return normalizeBusinessState(JSON.parse(row.valueJson), type); } catch { return emptyState(type); }
}

export function saveBusinessState(state = {}, businessType = state.businessType || SHOPEE) {
  const type = normalizeType(businessType);
  const normalized = normalizeBusinessState(state, type);
  const db = getDb();
  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO business_states(businessType,valueJson,updatedAt) VALUES(?,?,?)
      ON CONFLICT(businessType) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`)
      .run(type, JSON.stringify(normalized), now);
    mirrorBusinessTables(db, normalized, type, now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return normalized;
}

export function getBusinessCurrentReportDate(businessType = SHOPEE) {
  const state = loadBusinessState(businessType);
  if (state.reportDate && state.dailyReportReady) return state.reportDate;
  return '';
}

export function createOrRecoverBusinessRun(businessType, reportDate, options = {}) {
  const type = normalizeType(businessType);
  const date = String(reportDate || '').trim();
  const db = getDb();
  if (!date || !db.prepare('SELECT 1 FROM business_daily_reports WHERE businessType=? AND reportDate=?').get(type, date)) {
    return { ok: false, code: 'REPORT_DATE_MISSING', error: `当前未导入${type}当日日报Excel，请先导入后再开始处理。` };
  }
  const existing = db.prepare('SELECT * FROM business_run_locks WHERE businessType=? AND reportDate=?').get(type, date);
  if (existing && ['running', 'paused', 'failed'].includes(existing.status)) {
    if (existing.status === 'running' && options.rejectRunning) return { ok: false, code: 'RUN_ALREADY_ACTIVE', error: '当前任务正在运行，请勿重复启动。', run: existing };
    db.prepare("UPDATE business_run_locks SET status='running',errorMessage='',updatedAt=? WHERE businessType=? AND reportDate=?").run(nowIso(), type, date);
    return { ok: true, created: false, recovered: true, run: getBusinessRunStatus(type, date).lock };
  }
  if (existing?.status === 'finished') return { ok: false, code: 'RUN_ALREADY_COMPLETED', error: '当前任务已经完成，不能重复调用API。', run: existing };
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
  const snapshotState = { ...state, businessType: type, snapshotId };
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

export function getBusinessSnapshot(businessType, reportDate, runId = '') {
  const type = normalizeType(businessType);
  const row = runId
    ? getDb().prepare('SELECT payloadJson FROM business_export_snapshots WHERE businessType=? AND reportDate=? AND runId=? ORDER BY id DESC LIMIT 1').get(type, reportDate, runId)
    : getDb().prepare('SELECT payloadJson FROM business_export_snapshots WHERE businessType=? AND reportDate=? ORDER BY id DESC LIMIT 1').get(type, reportDate);
  try { return row?.payloadJson ? JSON.parse(row.payloadJson) : null; } catch { return null; }
}

export function getBusinessSnapshotById(businessType, snapshotId) {
  const type = normalizeType(businessType);
  const row = getDb().prepare('SELECT payloadJson FROM business_export_snapshots WHERE businessType=? AND snapshotId=?').get(type, String(snapshotId || '').trim());
  try { return row?.payloadJson ? JSON.parse(row.payloadJson) : null; } catch { return null; }
}

export function listBusinessHistoryDates(businessType, limit = 60) {
  return getDb().prepare(`SELECT reportDate,snapshotId,runId,generatedAt
    FROM business_export_snapshots WHERE businessType=? ORDER BY reportDate DESC,createdAt DESC LIMIT ?`)
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

export function normalizeBusinessState(state = {}, businessType = SHOPEE) {
  const type = normalizeType(businessType);
  const clean = list => [...new Set((list || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
  return {
    businessType: type,
    reportDate: state.reportDate || '', sourceName: state.sourceName || '', dailyReportReady: Boolean(state.dailyReportReady || state.daily?.summary?.totalRecognized),
    daily: state.daily || null, dailyParseSummary: state.dailyParseSummary || state.daily?.summary || null, dailyParseRows: state.dailyParseRows || state.daily?.importRows || state.daily?.details || [],
    recipientConflicts: state.recipientConflicts || state.daily?.conflicts || [], recipientReconciliation: state.recipientReconciliation || state.daily?.summary?.reconciliation || null,
    pnhBills: clean(state.pnhBills || state.bills || []), carryBills: clean(state.carryBills || []), podLocks: clean(state.podLocks || []),
    scanPool: clean(state.scanPool || []), scanResults: state.scanResults || [], shipmentTrackResults: state.shipmentTrackResults || [], shipmentQueryStatus: state.shipmentQueryStatus || [], needTrackBills: clean(state.needTrackBills || []),
    trackEvents: state.trackEvents || [], eventQueryStatus: state.eventQueryStatus || [], exceptionItems: state.exceptionItems || [], exceptionQueryStatus: state.exceptionQueryStatus || [],
    apiBatchStatus: state.apiBatchStatus || [], trackResults: state.trackResults || [], finalRows: state.finalRows || [], priorCarryRows: state.priorCarryRows || [], nextCarryBills: clean(state.nextCarryBills?.length ? state.nextCarryBills : (state.carryBills || [])),
    historySummary: (state.historySummary || []).slice(-30), processing: state.processing || { running: false, paused: false, phase: '' },
    currentRun: state.currentRun || null, lastRunSummary: state.lastRunSummary || state.lastRun || null, lastRun: state.lastRun || state.lastRunSummary || null,
    backupImportedAt: state.backupImportedAt || '', backupSummary: state.backupSummary || null, logs: (state.logs || []).slice(-300), snapshotId: state.snapshotId || ''
  };
}

function mirrorBusinessTables(db, state, type, now) {
  const date = state.reportDate;
  if (date && state.dailyReportReady) {
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
  const podStmt = db.prepare(`INSERT INTO business_pod_locks(businessType,shipmentCode,podTime,source,createdAt,updatedAt) VALUES(?,?,?,'state',?,?)
    ON CONFLICT(businessType,shipmentCode) DO UPDATE SET podTime=excluded.podTime,updatedAt=excluded.updatedAt`);
  for (const bill of state.podLocks) podStmt.run(type, bill, '', now, now);

  const active = new Set(state.nextCarryBills.length ? state.nextCarryBills : state.carryBills);
  const podSet = new Set(state.podLocks);
  for (const row of db.prepare("SELECT shipmentCode FROM business_carry_bills WHERE businessType=? AND status='active'").all(type)) {
    if (!active.has(row.shipmentCode) || podSet.has(row.shipmentCode)) db.prepare("UPDATE business_carry_bills SET status=?,updatedAt=? WHERE businessType=? AND shipmentCode=? AND status='active'").run(podSet.has(row.shipmentCode) ? 'closed_pod' : 'closed_normal', now, type, row.shipmentCode);
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
  db.prepare('DELETE FROM business_exception_items WHERE businessType=? AND reportDate=?').run(type, date);
  const exceptionStmt = db.prepare(`INSERT INTO business_exception_items(businessType,shipmentCode,reportDate,exceptionType,exceptionDesc,reportTime,statusCode,fileId,rawJson,createdAt)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  for (const row of state.exceptionItems) exceptionStmt.run(type, billOf(row), date, row.exceptionType || '', row.exceptionDesc || '', row.reportTime || '', String(row.statusCode ?? ''), String(row.fileId ?? ''), JSON.stringify(row), now);
  db.prepare('DELETE FROM business_api_batches WHERE businessType=? AND reportDate=? AND runId=?').run(type, date, state.currentRun?.runId || state.lastRunSummary?.runId || '');
  const batchStmt = db.prepare(`INSERT INTO business_api_batches(businessType,reportDate,runId,apiName,batchKey,shipmentCodesJson,status,attemptCount,resultCount,errorMessage,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of state.apiBatchStatus) batchStmt.run(type, date, row.runId || state.currentRun?.runId || state.lastRunSummary?.runId || '', row.apiName || '', row.batchKey || '', JSON.stringify(row.shipmentCodes || []), row.status || '', Number(row.attemptCount || 0), Number(row.resultCount || 0), row.errorMessage || '', row.createdAt || now, now);
  db.prepare('DELETE FROM business_final_rows WHERE businessType=? AND reportDate=?').run(type, date);
  const finalStmt = db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of state.finalRows) finalStmt.run(type, billOf(row), date, Number(row.是否POD === '是'), row.primaryCategory || row.异常分类 || '', row.API状态 || row.查询状态 || '', row.carry状态 || '', row.latestEventTime || row.最后节点时间 || '', row.latestEventDesc || row.最后节点 || '', row.latestNode || '', row.recipient_raw || '', row.recipient_normalized || '', recipientGroup(row), row.recipient_group_reason || '', Number(row.source_row_number || row.rowNumber || 0), JSON.stringify(row), now, now);
  for (const row of state.finalRows) persistStoreFields(db, 'business_final_rows', type, billOf(row), date, row);
  const historyStmt = db.prepare(`INSERT INTO business_history_summary(businessType,reportDate,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`);
  for (const item of state.historySummary) {
    const historyDate = item.reportDate || item.summary?.reportDate || '';
    if (historyDate) historyStmt.run(type, historyDate, JSON.stringify(item.summary || item), now, now);
  }
  const run = state.currentRun || state.lastRunSummary;
  if (run?.runId) {
    db.prepare(`UPDATE business_run_locks SET currentStage=?,batchIndex=?,totalBatches=?,errorMessage=?,updatedAt=? WHERE businessType=? AND reportDate=? AND runId=?`)
      .run(state.processing.phase || '', Number(state.processing.batchIndex || 0), Number(state.processing.totalBatches || 0), state.processing.error || '', now, type, date, run.runId);
    db.prepare('INSERT INTO business_run_checkpoints(businessType,runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(type, run.runId, date, state.processing.phase || '', Number(state.processing.batchIndex || 0), Number(state.processing.totalBatches || 0), state.processing.running ? 'running' : (state.processing.paused ? 'paused' : 'saved'), JSON.stringify({ scanDone: state.scanResults.length, trackDone: state.trackResults.length }), state.processing.error || '', now, now);
  }
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
