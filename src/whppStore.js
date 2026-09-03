import crypto from 'crypto';
import { getDb, nowIso } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';
import { isWhppCancelledRow } from './whppAnalyzer.js';
import { isSpecialCategory } from './specialNode.js';

export const WHPP = 'WHPP';
export const V419_WHPP_REIMPORT_LIFECYCLE_ID = '2026-09-03-v419-whpp-reimport-invalidates-old-completion-v1';
export const V419_WHPP_REIMPORT_CARRY_RETIRE_ID = '2026-09-03-v419-whpp-reimport-retires-removed-same-day-carry-and-ledger-v2';
export const V419_WHPP_FINAL_SNAPSHOT_AUTHORITY_ID = '2026-09-03-v419-whpp-final-snapshot-valid-completed-v1';

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

function immutableMemberBills(state = {}) {
  const pnh = [...new Set((state.pnhBills || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))].sort();
  if (pnh.length) return pnh;
  return [...new Set((state.dailyParseRows || []).map(billOf).filter(Boolean))].sort();
}

function loadLegacyFinalizedWhppSnapshot(reportDate, summary = {}) {
  const db = getDb();
  const snapshotId = String(summary.finalizedSnapshotId || '').trim();
  if (!snapshotId || !isFinalizedWhppDaily(summary)) return null;
  const row = db.prepare(`SELECT reportDate,status,reconciliationStatus,payloadJson FROM business_export_snapshots
    WHERE businessType='WHPP' AND snapshotId=? LIMIT 1`).get(snapshotId);
  if (!row || String(row.reportDate || '') !== String(reportDate || '')) return null;
  const status = String(row.status || '').toUpperCase();
  const reconciliationStatus = String(row.reconciliationStatus || '').toUpperCase();
  if (status === 'INVALID' || reconciliationStatus === 'FAILED') return null;
  const payload = safeJson(row.payloadJson, null);
  const state = payload?.state && typeof payload.state === 'object' ? payload.state : null;
  if (!state || String(state.reportDate || '') !== String(reportDate || '')) return null;
  const stored = db.prepare("SELECT DISTINCT UPPER(TRIM(shipmentCode)) shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY shipmentCode")
    .all(reportDate).map(item => String(item.shipmentCode || '').trim().toUpperCase()).filter(Boolean);
  const header = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);
  const snapshotMembers = immutableMemberBills(state);
  if (!header || Number(header.totalCount || 0) !== stored.length || snapshotMembers.length !== stored.length) return null;
  if (!stored.every((bill, index) => bill === snapshotMembers[index])) return null;
  return { ...payload, legacyFinalizedSnapshotAttested: true, finalSnapshotAuthority: V419_WHPP_FINAL_SNAPSHOT_AUTHORITY_ID };
}

function restoreFinalizedWhppState(reportDate, summary, reason = 'EXPLICIT_REHYDRATE') {
  const finalizedSnapshotId = String(summary.finalizedSnapshotId || '').trim();
  const payload = loadWhppSnapshot(finalizedSnapshotId) || loadLegacyFinalizedWhppSnapshot(reportDate, summary);
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
  restored.legacyFinalizedSnapshotAttested = Boolean(payload?.legacyFinalizedSnapshotAttested);
  console.log(`[CE-QC][WHPP_FINALIZED_REHYDRATE_NOOP] reportDate=${reportDate} snapshot=${finalizedSnapshotId} reason=${reason} legacyAttested=${restored.legacyFinalizedSnapshotAttested ? 1 : 0}`);
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
  return { exists: true, finalized: isFinalizedWhppDaily(summary), identicalMembership, summary, storedCount: stored.length, incomingCount: incoming.length };
}

function invalidatePriorWhppLifecycle(db, reportDate, context = {}, now = nowIso()) {
  const reason = JSON.stringify({
    code: 'WHPP_DAILY_REIMPORT_NEW_LIFECYCLE',
    revision: V419_WHPP_REIMPORT_LIFECYCLE_ID,
    reportDate,
    priorFinalized: Boolean(context.finalized),
    priorIdenticalMembership: Boolean(context.identicalMembership),
    priorStoredCount: Number(context.storedCount || 0),
    incomingCount: Number(context.incomingCount || 0),
    invalidatedAt: now
  });
  let invalidatedSnapshots = 0;
  try {
    invalidatedSnapshots = Number(db.prepare(`UPDATE business_export_snapshots
      SET status='INVALID',reconciliationStatus='FAILED',invalidReason=?
      WHERE businessType='WHPP' AND reportDate=? AND UPPER(COALESCE(status,''))<>'INVALID'`).run(reason, reportDate)?.changes || 0);
  } catch {}
  try { db.prepare("DELETE FROM business_history_summary WHERE businessType='WHPP' AND reportDate=?").run(reportDate); } catch {}
  for (const table of ['business_scan_results','business_track_events','business_exception_items','business_final_rows']) {
    try { db.prepare(`DELETE FROM ${table} WHERE businessType='WHPP' AND reportDate=?`).run(reportDate); } catch {}
  }
  return { invalidatedSnapshots, reason };
}

function retireRemovedWhppDailyCarry(db, reportDate, incomingBills = [], now = nowIso()) {
  const keep = new Set((incomingBills || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean));
  const rows = db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE status='OPEN' AND businessType='WHPP' AND sourceReportDate=? ORDER BY shipmentCode").all(reportDate);
  const retiredBills = rows
    .map(row => String(row.shipmentCode || '').trim().toUpperCase())
    .filter(bill => bill && !keep.has(bill));
  if (!retiredBills.length) return { retired: 0, retiredLedger: 0, bills: [] };

  const removeCarry = db.prepare("DELETE FROM carryover_open_items WHERE shipmentCode=? AND businessType='WHPP' AND status='OPEN' AND sourceReportDate=?");
  let ledgerGet = null, removeLedger = null, ledgerAudit = null;
  try {
    const hasLedger = Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='qc_tracking_ledger' LIMIT 1").get()?.ok);
    if (hasLedger) {
      ledgerGet = db.prepare("SELECT * FROM qc_tracking_ledger WHERE shipmentCode=? AND businessType='WHPP' LIMIT 1");
      removeLedger = db.prepare("DELETE FROM qc_tracking_ledger WHERE shipmentCode=? AND businessType='WHPP' AND firstReportDate=?");
      const hasAudit = Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='qc_tracking_audit' LIMIT 1").get()?.ok);
      if (hasAudit) ledgerAudit = db.prepare("INSERT INTO qc_tracking_audit(shipmentCode,businessType,action,reason,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?)");
    }
  } catch {}

  let retired = 0, retiredLedger = 0;
  for (const bill of retiredBills) {
    const ledger = ledgerGet?.get(bill) || null;
    if (ledger && String(ledger.firstReportDate || '') === String(reportDate || '')) {
      try {
        ledgerAudit?.run(bill, WHPP, 'WHPP_REIMPORT_RETIRE_REMOVED_MEMBER', V419_WHPP_REIMPORT_CARRY_RETIRE_ID, JSON.stringify(ledger), JSON.stringify({ removedFromActiveTruth: true, reportDate }), now);
      } catch {}
      retiredLedger += Number(removeLedger?.run(bill, reportDate)?.changes || 0);
    }
    retired += Number(removeCarry.run(bill, reportDate)?.changes || 0);
  }
  return { retired, retiredLedger, bills: retiredBills };
}

export function saveWhppDailyImport({ reportDate, sourceName = '', rows = [], batchId = '', snapshotId = '', preserveFinalizedLifecycle = false }) {
  const db = getDb();
  const now = nowIso();
  const unique = uniqueRows(rows).map(row => ({ ...row, businessType: WHPP, reportDate }));
  const todayBills = new Set(unique.map(billOf));
  const prior = loadWhppState();

  // V419/V399: a finalized WHPP daily is immutable only when the exact same
  // membership is uploaded again, or an explicit rehydrate contains no new WHPP
  // members at all. A non-empty changed membership always starts a new lifecycle.
  const existingDaily = inspectExistingWhppDaily(db, reportDate, unique);
  const explicitEmptyRehydrate = preserveFinalizedLifecycle === true && unique.length === 0;
  if (existingDaily.finalized && (existingDaily.identicalMembership || explicitEmptyRehydrate)) {
    return restoreFinalizedWhppState(
      reportDate,
      existingDaily.summary,
      explicitEmptyRehydrate ? 'EXPLICIT_REHYDRATE' : 'IDENTICAL_MEMBERSHIP_REUPLOAD'
    );
  }

  const carryBills = db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE businessType='WHPP' AND status='OPEN' ORDER BY shipmentCode").all().map(row => row.shipmentCode);

  db.exec('BEGIN IMMEDIATE');
  let lifecycleReset = { invalidatedSnapshots: 0, reason: '' };
  let carryRetirement = { retired: 0, retiredLedger: 0, bills: [] };
  try {
    // This call is reached only for a real new lifecycle. Old completed snapshots
    // and derived history must become ineligible before the new membership is
    // published, otherwise an export between re-upload and re-processing could
    // incorrectly reuse stale completion evidence.
    lifecycleReset = invalidatePriorWhppLifecycle(db, reportDate, existingDaily, now);
    // A corrected same-day reupload removes the superseded day's own OPEN carry
    // from active truth. It also retires a V246 ledger row only when that ledger
    // originated on the superseded date. Real earlier-day carry/ledger survives.
    if (existingDaily.exists) carryRetirement = retireRemovedWhppDailyCarry(db, reportDate, unique.map(billOf), now);
    db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET sourceFile=excluded.sourceFile,totalCount=excluded.totalCount,summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`)
      .run(WHPP, reportDate, sourceName, unique.length, JSON.stringify({ batchId, snapshotId, total: unique.length, lifecycleRevision: V419_WHPP_REIMPORT_LIFECYCLE_ID }), now, now);
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
  if (lifecycleReset.invalidatedSnapshots > 0) {
    console.log('[CE-QC][WHPP_REIMPORT_LIFECYCLE_INVALIDATED]', JSON.stringify({ revision: V419_WHPP_REIMPORT_LIFECYCLE_ID, reportDate, invalidatedSnapshots: lifecycleReset.invalidatedSnapshots, incoming: unique.length }));
  }
  if (carryRetirement.retired > 0 || carryRetirement.retiredLedger > 0) {
    console.log('[CE-QC][WHPP_REIMPORT_REMOVED_CARRY_RETIRED]', JSON.stringify({ revision: V419_WHPP_REIMPORT_CARRY_RETIRE_ID, reportDate, retiredCarry: carryRetirement.retired, retiredLedger: carryRetirement.retiredLedger }));
  }

  const retiredCarrySet = new Set(carryRetirement.bills.map(value => String(value || '').trim().toUpperCase()));
  const activeCarryBills = carryBills.filter(bill => !retiredCarrySet.has(String(bill || '').trim().toUpperCase()));

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
    carryBills: [...new Set(activeCarryBills.filter(bill => !todayBills.has(bill)))],
    nextCarryBills: [...new Set(activeCarryBills)],
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

    const payload = {
      state: { ...normalized, snapshotId },
      dashboard,
      status: 'VALID',
      reconciliationStatus: 'COMPLETED',
      finalSnapshotAuthority: V419_WHPP_FINAL_SNAPSHOT_AUTHORITY_ID
    };
    db.prepare(`INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt,status,reconciliationStatus,invalidReason)
      VALUES(?,?,?,?,?,?,?,'VALID','COMPLETED','')`)
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
        reconciliationStatus: 'COMPLETED',
        finalizedSnapshotId: snapshotId,
        finalizedAt: now,
        finalSnapshotAuthority: V419_WHPP_FINAL_SNAPSHOT_AUTHORITY_ID
      }), now, WHPP, reportDate);

    normalized.snapshotId = snapshotId;
    normalized.snapshotStatus = 'COMPLETED';
    normalized.finalSnapshotAuthority = V419_WHPP_FINAL_SNAPSHOT_AUTHORITY_ID;
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
  return getDb().prepare(`SELECT snapshotId,reportDate,runId,generatedAt,createdAt FROM business_export_snapshots
    WHERE businessType=? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
    ORDER BY reportDate DESC,createdAt DESC LIMIT ?`)
    .all(WHPP, Math.max(1, Math.min(500, Number(limit) || 120)));
}

export function loadWhppSnapshot(snapshotId) {
  const row = getDb().prepare(`SELECT payloadJson FROM business_export_snapshots
    WHERE businessType=? AND snapshotId=? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'`).get(WHPP, snapshotId);
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
