import { getDb, nowIso } from './db.js';
import {
  ensureV246TrackingSchema,
  classifyV246Terminal,
  v246DateKey,
  v246InclusiveDays
} from './v246TrackingLedgerCore.js';

export const CARRY_LEDGER_SYNC_ID = '2026-09-03-carry-ledger-sync-v2-atomic';

const TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const EXACT_TERMINAL_REASONS = new Set(['POD','RETURNED','ORDER_CANCELLED']);
const text = value => String(value ?? '').trim();
const billOf = value => text(value).toUpperCase();
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function minDate(...values) { return values.map(v246DateKey).filter(Boolean).sort()[0] || ''; }
function maxDate(...values) { return values.map(v246DateKey).filter(Boolean).sort().at(-1) || ''; }
function firstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return '';
}
function preferredState(payload = {}, currentState = '') {
  const evidence = [
    payload.currentState,payload.scanNormalizedState,payload.退回状态,payload.primaryCategory,
    payload.currentMainCategory,payload.主分类,payload.异常分类,payload.latestEventDesc,payload.最后节点
  ].map(text).join(' ');
  if (/RETURN_IN_PROGRESS|退回处理中|退回待处理|正在退回|返仓处理中/i.test(evidence)) return 'RETURN_IN_PROGRESS';
  return text(payload.currentState || payload.scanNormalizedState || currentState || payload.primaryCategory || payload.主分类 || 'OPEN');
}
function observedAttempt(payload = {}) {
  for (const value of [payload.podAttemptNo,payload.currentAttemptNo,payload.attemptNo,payload.派次]) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return Math.min(3, Math.floor(n));
  }
  return 0;
}
function podDateOf(payload = {}, classification = {}, old = {}) {
  if (text(old.podDate)) return v246DateKey(old.podDate) || text(old.podDate);
  if (!classification.pod) return '';
  for (const key of ['POD时间','podTime','podClosedAt','podAt','deliveredAt','deliveryCompletedAt','签收时间']) {
    const value = v246DateKey(payload?.[key]);
    if (value) return value;
  }
  const latestCode = text(firstValue(payload,['latestTrackStatusCode','lastEventCode','eventCode','trackingEventCode','statusCode']));
  if (latestCode === '80') return v246DateKey(firstValue(payload,['latestEventTime','最后节点时间','lastEventTime']));
  return '';
}
function compact(row = {}) {
  return {
    trackingStatus:text(row.trackingStatus),terminalReason:text(row.terminalReason),currentState:text(row.currentState),
    currentCategory:text(row.currentCategory),podDate:text(row.podDate),attemptNo:Number(row.attemptNo || 0),attemptSource:text(row.attemptSource)
  };
}
export function invalidateCarryLedgerReadCaches() {
  for (const name of [
    '__CE_QC_INVALIDATE_V236_CURRENT_SUMMARY__',
    '__CE_QC_INVALIDATE_V253_DASHBOARD_FAST_PATH__',
    '__CE_QC_INVALIDATE_V284_DAILY_MEMBERSHIP__',
    '__CE_QC_REFRESH_V274_TRENDS__'
  ]) {
    try { globalThis[name]?.(); } catch {}
  }
}

export function syncCarryRowsToV246Ledger(rows = [], {
  db = getDb(),
  reason = 'CARRY_RESULT_COMMIT',
  manageTransaction = true,
  invalidateCaches = true
} = {}) {
  ensureV246TrackingSchema(db);
  const inputByBill = new Map();
  for (const row of rows || []) {
    const bill = billOf(row?.shipmentCode || row?.运单号 || row?.waybill);
    if (bill) inputByBill.set(bill, row || {});
  }
  if (!inputByBill.size) return { ok:true, version:CARRY_LEDGER_SYNC_ID, processed:0, terminal:0, open:0, reopened:0, changed:0 };

  const carryGet = db.prepare('SELECT * FROM carryover_open_items WHERE shipmentCode=?');
  const currentGet = db.prepare('SELECT * FROM shipment_current_state WHERE shipmentCode=?');
  const ledgerGet = db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?');
  const carryUpdate = db.prepare(`UPDATE carryover_open_items SET status=?,apiStatus=?,closeReason=?,stateJson=?,updatedAt=? WHERE shipmentCode=?`);
  const currentUpdate = db.prepare(`UPDATE shipment_current_state SET state=?,apiStatus=?,lastEventTime=?,stateJson=?,updatedAt=? WHERE shipmentCode=?`);
  const ledgerUpsert = db.prepare(`INSERT INTO qc_tracking_ledger(
      shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,
      currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(shipmentCode) DO UPDATE SET
      businessType=excluded.businessType,
      firstReportDate=CASE WHEN excluded.firstReportDate<qc_tracking_ledger.firstReportDate THEN excluded.firstReportDate ELSE qc_tracking_ledger.firstReportDate END,
      lastImportedDate=CASE WHEN excluded.lastImportedDate>qc_tracking_ledger.lastImportedDate THEN excluded.lastImportedDate ELSE qc_tracking_ledger.lastImportedDate END,
      lastSnapshotId=CASE WHEN excluded.lastSnapshotId<>'' THEN excluded.lastSnapshotId ELSE qc_tracking_ledger.lastSnapshotId END,
      trackingStatus=excluded.trackingStatus,terminalReason=excluded.terminalReason,terminalAt=excluded.terminalAt,
      currentState=excluded.currentState,currentCategory=excluded.currentCategory,lastEventTime=excluded.lastEventTime,
      podDate=CASE WHEN qc_tracking_ledger.podDate<>'' THEN qc_tracking_ledger.podDate ELSE excluded.podDate END,
      attemptNo=CASE WHEN qc_tracking_ledger.attemptSource LIKE 'V246_STRICT_TRACK%' THEN qc_tracking_ledger.attemptNo ELSE excluded.attemptNo END,
      attemptSource=CASE WHEN qc_tracking_ledger.attemptSource LIKE 'V246_STRICT_TRACK%' THEN qc_tracking_ledger.attemptSource ELSE excluded.attemptSource END,
      signingDays=CASE WHEN excluded.signingDays IS NOT NULL THEN excluded.signingDays ELSE qc_tracking_ledger.signingDays END,
      evidenceJson=excluded.evidenceJson,currentStateJson=excluded.currentStateJson,lastCheckedAt=excluded.lastCheckedAt,
      lastRepairReason=excluded.lastRepairReason,updatedAt=excluded.updatedAt`);
  const audit = db.prepare(`INSERT INTO qc_tracking_audit(shipmentCode,businessType,action,reason,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?)`);

  const now = nowIso();
  let processed=0, terminal=0, open=0, reopened=0, changed=0;
  if (manageTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    for (const [bill,input] of inputByBill) {
      const carry = carryGet.get(bill) || null;
      const current = currentGet.get(bill) || null;
      const old = ledgerGet.get(bill) || null;
      if (!carry && !current) continue;
      const carryJson = safeJson(carry?.stateJson, {});
      const currentJson = safeJson(current?.stateJson, {});
      const payload = { ...carryJson, ...currentJson, ...input, shipmentCode:bill, 运单号:bill };
      const businessType = text(current?.businessType || carry?.businessType || payload.businessType).toUpperCase();
      if (!TYPES.has(businessType)) continue;

      const classifyState = preferredState(payload, current?.state);
      const classification = classifyV246Terminal({ closeReason:carry?.closeReason || '', state:classifyState, stateJson:payload });
      const oldExactTerminal = old?.trackingStatus === 'TERMINAL' && EXACT_TERMINAL_REASONS.has(text(old?.terminalReason).toUpperCase());
      const terminalReason = classification.terminal ? classification.reason : (oldExactTerminal ? text(old.terminalReason).toUpperCase() : '');
      const isTerminal = Boolean(terminalReason);
      const trackingStatus = isTerminal ? 'TERMINAL' : 'OPEN';
      const firstReportDate = minDate(old?.firstReportDate, carry?.sourceReportDate, payload.sourceReportDate, current?.reportDate) || v246DateKey(current?.reportDate) || v246DateKey(carry?.lastReportDate);
      const lastImportedDate = maxDate(old?.lastImportedDate, carry?.lastReportDate, current?.reportDate, payload.reportDate) || firstReportDate;
      if (!firstReportDate || !lastImportedDate) continue;
      const sourceSnapshotId = text(old?.sourceSnapshotId || carry?.sourceSnapshotId || current?.snapshotId || 'CARRY-SYNC');
      const lastSnapshotId = text(current?.snapshotId || carry?.lastSnapshotId || old?.lastSnapshotId || sourceSnapshotId);
      const apiStatus = text(current?.apiStatus || carry?.apiStatus || payload.apiStatus || payload.API状态 || 'SUCCESS');
      const lastEventTime = text(current?.lastEventTime || payload.latestEventTime || payload.最后节点时间 || old?.lastEventTime || '');
      const currentState = isTerminal
        ? (terminalReason === 'POD' ? 'POD' : terminalReason === 'RETURNED' ? 'RETURNED' : 'ORDER_CANCELLED')
        : classifyState;
      const currentCategory = text(payload.primaryCategory || payload.currentMainCategory || payload.主分类 || payload.异常分类 || currentState);
      const podDate = terminalReason === 'POD' ? podDateOf(payload, classification, old || {}) : text(old?.podDate || '');
      const strictAttempt = /^V246_STRICT_TRACK/i.test(text(old?.attemptSource));
      const attemptNo = strictAttempt ? Number(old?.attemptNo || 0) : observedAttempt(payload);
      const attemptSource = strictAttempt ? text(old?.attemptSource) : (attemptNo ? text(payload.attemptSource || payload.attemptStatus || 'CARRY_RESULT') : '');
      const signingDays = podDate ? v246InclusiveDays(firstReportDate,podDate) : (old?.signingDays ?? null);
      const terminalAt = isTerminal ? (text(old?.terminalAt) || lastEventTime || now) : '';
      const before = compact(old || {});
      const normalizedPayload = { ...payload, businessType, currentState, primaryCategory:currentCategory };
      const normalizedJson = JSON.stringify(normalizedPayload);

      carryUpdate.run(isTerminal ? 'CLOSED' : 'OPEN', apiStatus, terminalReason, normalizedJson, now, bill);
      if (current) currentUpdate.run(currentState, apiStatus, lastEventTime, normalizedJson, now, bill);
      ledgerUpsert.run(
        bill,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,
        currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,
        JSON.stringify({source:CARRY_LEDGER_SYNC_ID,reason,snapshotId:lastSnapshotId,checkedAt:now}),normalizedJson,now,reason,old?.createdAt || carry?.createdAt || now,now
      );
      const after = compact(ledgerGet.get(bill) || {});
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changed += 1;
        audit.run(bill,businessType,'CARRY_RESULT_SYNC',reason,JSON.stringify(before),JSON.stringify(after),now);
      }
      if (old?.trackingStatus === 'TERMINAL' && trackingStatus === 'OPEN') reopened += 1;
      if (isTerminal) terminal += 1; else open += 1;
      processed += 1;
    }
    if (manageTransaction) db.exec('COMMIT');
  } catch (error) {
    if (manageTransaction) {
      try { db.exec('ROLLBACK'); } catch {}
    }
    throw error;
  }
  if (invalidateCaches) invalidateCarryLedgerReadCaches();
  return { ok:true, version:CARRY_LEDGER_SYNC_ID, processed, terminal, open, reopened, changed, syncedAt:now };
}
