import { getDb, nowIso } from './db.js';
import {
  ensureV246TrackingSchema,
  classifyV246Terminal,
  v246DateKey,
  v246InclusiveDays
} from './v246TrackingLedgerCore.js';

export const CARRY_LEDGER_SYNC_ID = '2026-09-03-carry-ledger-sync-v5-derived-cache-mirror';

const TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const EXACT_TERMINAL_REASONS = new Set(['POD','RETURNED','ORDER_CANCELLED']);
const text = value => String(value ?? '').trim();
const billOf = value => text(value).toUpperCase();
let pendingDerivedDates = new Set();
let pendingDerivedDb = null;

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
function optionalNumber(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value === undefined || value === null || text(value) === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
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
  if (!classification.pod && text(old.terminalReason).toUpperCase() !== 'POD') return '';
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
function tableExists(db, table) {
  try { return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table)?.ok); }
  catch { return false; }
}
function tableColumns(db, table) {
  if (!tableExists(db, table)) return new Set();
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name || ''))); }
  catch { return new Set(); }
}
function normalizeCanonicalPayload(payload, terminalReason, currentState, currentCategory, podDate, attemptNo) {
  const out = { ...payload, currentState, primaryCategory: currentCategory };
  if (attemptNo > 0) {
    out.currentAttemptNo = attemptNo;
    out.podAttemptNo = attemptNo;
  }
  if (terminalReason === 'POD') {
    out.是否POD = '是';
    out.退回状态 = '';
    out.订单取消 = '';
    if (podDate && !v246DateKey(out.POD时间 || out.podTime || out.签收时间)) out.POD时间 = podDate;
  } else if (terminalReason === 'RETURNED') {
    out.是否POD = '否';
    out.退回状态 = '已退回';
    out.订单取消 = '';
  } else if (terminalReason === 'ORDER_CANCELLED') {
    out.是否POD = '否';
    out.退回状态 = '';
    out.订单取消 = '是';
  } else {
    out.是否POD = '否';
    if (currentState === 'RETURN_IN_PROGRESS') out.退回状态 = '退回处理中';
  }
  return out;
}
function mirrorValues(payload, ledger, apiStatus, lastEventTime) {
  const terminal = ledger.trackingStatus === 'TERMINAL';
  return {
    isPod: ledger.terminalReason === 'POD' ? 1 : 0,
    category: text(ledger.currentCategory || ledger.currentState || 'OPEN'),
    apiStatus: text(apiStatus || 'SUCCESS'),
    carryStatus: terminal ? 'CLOSED' : 'OPEN',
    lastEventTime: text(lastEventTime || ledger.lastEventTime || ''),
    latestEventDesc: text(payload.latestEventDesc || payload.最后节点 || payload.lastEventDesc || ''),
    rawJson: JSON.stringify(payload),
    pendingDays: terminal ? 0 : optionalNumber(payload,['pendingDays','Pending天数','Pending当前天数','Pending当前次数']),
    ocDays: terminal ? 0 : optionalNumber(payload,['ocDays','OC天数']),
    cycleDays: terminal ? 0 : optionalNumber(payload,['cycleCountDays','盘点天数']),
    assignDays: terminal ? 0 : optionalNumber(payload,['assignDays','分配天数']),
    deliveringDays: terminal ? 0 : optionalNumber(payload,['deliveringDays','派送中停留天数']),
    shopRetentionDays: terminal ? 0 : optionalNumber(payload,['shopRetentionNaturalDays','门店滞留天数']),
    shopState: terminal ? 'CLOSED' : text(payload.shopState || payload.门店状态 || ''),
    shopStateReason: terminal ? `V246_${ledger.terminalReason}` : text(payload.shopStateReason || ''),
    attemptNo: Number(ledger.attemptNo || 0),
    attemptSource: text(ledger.attemptSource || payload.attemptSource || payload.attemptStatus || '')
  };
}
function buildFinalMirrorUpdater(db) {
  const cols = tableColumns(db, 'final_rows');
  if (!cols.size) return null;
  const assignments = [];
  const keys = [];
  const set = (column, expression, ...valueKeys) => {
    if (!cols.has(column)) return;
    assignments.push(`${column}=${expression}`);
    keys.push(...valueKeys);
  };
  set('isPod','?','isPod');
  set('category','?','category');
  set('qcConclusion','?','category');
  set('lastEventTime',"COALESCE(NULLIF(?,''),lastEventTime)",'lastEventTime');
  set('primaryCategory','?','category');
  set('rawJson','?','rawJson');
  set('pendingDays','CASE WHEN ? IS NULL THEN pendingDays ELSE ? END','pendingDays','pendingDays');
  set('ocDays','CASE WHEN ? IS NULL THEN ocDays ELSE ? END','ocDays','ocDays');
  set('cycleCountDays','CASE WHEN ? IS NULL THEN cycleCountDays ELSE ? END','cycleDays','cycleDays');
  set('assignDays','CASE WHEN ? IS NULL THEN assignDays ELSE ? END','assignDays','assignDays');
  set('deliveringDays','CASE WHEN ? IS NULL THEN deliveringDays ELSE ? END','deliveringDays','deliveringDays');
  set('shopRetentionNaturalDays','CASE WHEN ? IS NULL THEN shopRetentionNaturalDays ELSE ? END','shopRetentionDays','shopRetentionDays');
  set('shopState',"CASE WHEN TRIM(COALESCE(?,''))='' THEN shopState ELSE ? END",'shopState','shopState');
  set('shopStateReason',"CASE WHEN TRIM(COALESCE(?,''))='' THEN shopStateReason ELSE ? END",'shopStateReason','shopStateReason');
  set('updatedAt','?','updatedAt');
  if (!assignments.length) return null;
  const stmt = db.prepare(`UPDATE final_rows SET ${assignments.join(',')} WHERE shipmentCode=?`);
  return (bill, values) => {
    const params = keys.map(key => values[key]);
    params.push(bill);
    return Number(stmt.run(...params)?.changes || 0);
  };
}
function buildBusinessMirrorUpdater(db) {
  const cols = tableColumns(db, 'business_final_rows');
  if (!cols.size) return null;
  const assignments = [];
  const keys = [];
  const set = (column, expression, ...valueKeys) => {
    if (!cols.has(column)) return;
    assignments.push(`${column}=${expression}`);
    keys.push(...valueKeys);
  };
  set('isPod','?','isPod');
  set('primaryCategory','?','category');
  set('currentMainCategory','?','category');
  set('apiStatus','?','apiStatus');
  set('carryStatus','?','carryStatus');
  set('latestEventTime',"COALESCE(NULLIF(?,''),latestEventTime)",'lastEventTime');
  set('latestEventDesc',"CASE WHEN TRIM(COALESCE(?,''))='' THEN latestEventDesc ELSE ? END",'latestEventDesc','latestEventDesc');
  set('rawJson','?','rawJson');
  set('shopRetentionNaturalDays','CASE WHEN ? IS NULL THEN shopRetentionNaturalDays ELSE ? END','shopRetentionDays','shopRetentionDays');
  set('shopState',"CASE WHEN TRIM(COALESCE(?,''))='' THEN shopState ELSE ? END",'shopState','shopState');
  set('shopStateReason',"CASE WHEN TRIM(COALESCE(?,''))='' THEN shopStateReason ELSE ? END",'shopStateReason','shopStateReason');
  set('currentAttemptNo','CASE WHEN ?>0 THEN ? ELSE currentAttemptNo END','attemptNo','attemptNo');
  set('podAttemptNo','CASE WHEN ?>0 THEN ? ELSE podAttemptNo END','attemptNo','attemptNo');
  set('attemptStatus',"CASE WHEN ?>0 AND TRIM(COALESCE(?,''))<>'' THEN ? ELSE attemptStatus END",'attemptNo','attemptSource','attemptSource');
  set('updatedAt','?','updatedAt');
  if (!assignments.length) return null;
  const stmt = db.prepare(`UPDATE business_final_rows SET ${assignments.join(',')} WHERE businessType=? AND shipmentCode=?`);
  return (storageType, bill, values) => {
    const params = keys.map(key => values[key]);
    params.push(storageType,bill);
    return Number(stmt.run(...params)?.changes || 0);
  };
}
function fallbackInvalidateDerivedDates(db, dates = [], reason = 'V246_LEDGER_CHANGED') {
  const normalized = [...new Set((dates || []).map(v246DateKey).filter(Boolean))];
  if (!normalized.length) return { invalidated: 0, dates: [] };
  const hasRows = tableExists(db,'dashboard_daily_cache');
  const hasDates = tableExists(db,'dashboard_cache_dates');
  const hasDirty = tableExists(db,'dashboard_cache_dirty');
  const dropRows = hasRows ? db.prepare('DELETE FROM dashboard_daily_cache WHERE reportDate=?') : null;
  const dropDates = hasDates ? db.prepare('DELETE FROM dashboard_cache_dates WHERE reportDate=?') : null;
  const dirty = hasDirty ? db.prepare(`INSERT INTO dashboard_cache_dirty(reportDate,reason,dirtyAt) VALUES(?,?,?)
    ON CONFLICT(reportDate) DO UPDATE SET reason=excluded.reason,dirtyAt=excluded.dirtyAt`) : null;
  const now = nowIso();
  for (const date of normalized) {
    try { dropDates?.run(date); } catch {}
    try { dropRows?.run(date); } catch {}
    try { dirty?.run(date,String(reason || 'V246_LEDGER_CHANGED').slice(0,120),now); } catch {}
  }
  return { invalidated: normalized.length, dates: normalized };
}
function stageDerivedDates(db, dates = []) {
  for (const date of dates.map(v246DateKey).filter(Boolean)) pendingDerivedDates.add(date);
  if (dates.length) pendingDerivedDb = db;
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
  const dates = [...pendingDerivedDates].sort();
  const db = pendingDerivedDb;
  pendingDerivedDates = new Set();
  pendingDerivedDb = null;
  if (!dates.length) return { dates: [], refreshed: false };
  try {
    const refresh = globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__;
    if (typeof refresh === 'function') return { dates, refreshed: true, result: refresh(dates,'V246_LEDGER_COMMIT') };
  } catch (error) {
    console.warn('[CE-QC][CARRY_LEDGER_DERIVED_REFRESH_FAILED]', error?.message || error);
  }
  return { dates, refreshed: false, fallback: db ? fallbackInvalidateDerivedDates(db,dates,'V246_LEDGER_COMMIT_FALLBACK') : null };
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
  if (!inputByBill.size) return { ok:true, version:CARRY_LEDGER_SYNC_ID, processed:0, terminal:0, open:0, reopened:0, changed:0, mirrorChanged:0, affectedDates:[] };

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
  const finalMirror = buildFinalMirrorUpdater(db);
  const businessMirror = buildBusinessMirrorUpdater(db);

  const now = nowIso();
  let processed=0, terminal=0, open=0, reopened=0, changed=0, mirrorChanged=0;
  const affectedDates = new Set();
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
      const oldReason = text(old?.terminalReason).toUpperCase();
      const explicitlyReturnInProgress = classifyState === 'RETURN_IN_PROGRESS';
      const oldExactTerminal = old?.trackingStatus === 'TERMINAL'
        && EXACT_TERMINAL_REASONS.has(oldReason)
        && !(oldReason === 'RETURNED' && explicitlyReturnInProgress);
      const terminalReason = oldExactTerminal ? oldReason : (classification.terminal ? classification.reason : '');
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
      const currentCategory = isTerminal
        ? (terminalReason === 'POD' ? 'POD' : terminalReason === 'RETURNED' ? '退回' : '订单取消')
        : text(payload.primaryCategory || payload.currentMainCategory || payload.主分类 || payload.异常分类 || currentState);
      const podDate = terminalReason === 'POD' ? podDateOf(payload, classification, old || {}) : text(old?.podDate || '');
      const strictAttempt = /^V246_STRICT_TRACK/i.test(text(old?.attemptSource));
      const attemptNo = strictAttempt ? Number(old?.attemptNo || 0) : observedAttempt(payload);
      const attemptSource = strictAttempt ? text(old?.attemptSource) : (attemptNo ? text(payload.attemptSource || payload.attemptStatus || 'CARRY_RESULT') : '');
      const signingDays = podDate ? v246InclusiveDays(firstReportDate,podDate) : (old?.signingDays ?? null);
      const terminalAt = isTerminal ? (text(old?.terminalAt) || lastEventTime || now) : '';
      const before = compact(old || {});
      const canonicalPayload = normalizeCanonicalPayload({ ...payload, businessType },terminalReason,currentState,currentCategory,podDate,attemptNo);
      const canonicalJson = JSON.stringify(canonicalPayload);

      carryUpdate.run(isTerminal ? 'CLOSED' : 'OPEN', apiStatus, terminalReason, canonicalJson, now, bill);
      if (current) currentUpdate.run(currentState, apiStatus, lastEventTime, canonicalJson, now, bill);
      ledgerUpsert.run(
        bill,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,
        currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,
        JSON.stringify({source:CARRY_LEDGER_SYNC_ID,reason,snapshotId:lastSnapshotId,checkedAt:now}),canonicalJson,now,reason,old?.createdAt || carry?.createdAt || now,now
      );
      const ledger = ledgerGet.get(bill) || {};
      const after = compact(ledger);
      const ledgerChanged = JSON.stringify(before) !== JSON.stringify(after);
      if (ledgerChanged) {
        changed += 1;
        audit.run(bill,businessType,'CARRY_RESULT_SYNC',reason,JSON.stringify(before),JSON.stringify(after),now);
      }

      const mirrorPayload = normalizeCanonicalPayload(canonicalPayload,text(ledger.terminalReason),text(ledger.currentState),text(ledger.currentCategory),text(ledger.podDate),Number(ledger.attemptNo || 0));
      const values = { ...mirrorValues(mirrorPayload,ledger,apiStatus,lastEventTime), updatedAt: now };
      let mirrored = 0;
      if (SHOPEE_TYPES.has(businessType)) mirrored += businessMirror?.('SHOPEE',bill,values) || 0;
      else if (businessType === 'WHPP') mirrored += businessMirror?.('WHPP',bill,values) || 0;
      else mirrored += finalMirror?.(bill,values) || 0;
      mirrorChanged += mirrored;

      if (ledgerChanged || mirrored > 0) {
        for (const value of [carry?.sourceReportDate,carry?.lastReportDate,current?.reportDate,payload.reportDate,firstReportDate,lastImportedDate]) {
          const date = v246DateKey(value);
          if (date) affectedDates.add(date);
        }
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
  const affected = [...affectedDates].sort();
  stageDerivedDates(db, affected);
  let cacheRefresh = null;
  if (invalidateCaches) cacheRefresh = invalidateCarryLedgerReadCaches();
  return { ok:true, version:CARRY_LEDGER_SYNC_ID, processed, terminal, open, reopened, changed, mirrorChanged, affectedDates:affected, cacheRefresh, syncedAt:now };
}
