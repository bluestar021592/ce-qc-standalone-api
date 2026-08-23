import { getDb, nowIso } from './db.js';
import { v246PositivePodText } from './shopeeAttemptCycleV246.js';

export const V246_TRACKING_LEDGER_ID = '2026-08-23-v246-qc-tracking-ledger-v2';
export const V246_TRACKING_TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const TYPE_SET = new Set(V246_TRACKING_TYPES);
const RETURN_DONE_RE = /\bRETURNED\b|\bRETURN_COMPLETED\b|已退回|退回完成|退件完成|退货完成|返仓完成|R退回/i;
const RETURN_OPEN_RE = /RETURN_IN_PROGRESS|退回处理中|退回待处理|正在退回|返仓处理中/i;

function text(value = '') { return String(value ?? '').trim(); }
function billOf(value = '') { return text(value).toUpperCase(); }
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
export function v246DateKey(value = '') {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
function dayNumber(value = '') {
  const key = v246DateKey(value);
  if (!key) return null;
  const [y,m,d] = key.split('-').map(Number);
  return Date.UTC(y,m-1,d);
}
export function v246InclusiveDays(from, to) {
  const a = dayNumber(from), b = dayNumber(to);
  return a === null || b === null || b < a ? null : Math.floor((b-a)/86400000)+1;
}
function minDate(...values) { return values.map(v246DateKey).filter(Boolean).sort()[0] || ''; }
function maxDate(...values) { return values.map(v246DateKey).filter(Boolean).sort().at(-1) || ''; }
function firstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}
function nestedAttempt(value) {
  const root = safeJson(value, null);
  let best = 0;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const key of ['podAttemptNo','currentAttemptNo','attemptNo','派次']) {
      const n = Number(node[key] || 0);
      if (Number.isFinite(n) && n > 0) best = Math.max(best, Math.min(3, Math.floor(n)));
    }
    Object.values(node).forEach(child => { if (child && typeof child === 'object') visit(child); });
  };
  visit(root);
  return best;
}
function directAttempt(state = {}) {
  const values = [state.podAttemptNo,state.currentAttemptNo,state.attemptNo,state.派次,nestedAttempt(state.attemptHistoryJson)];
  for (const value of values) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return Math.min(3, Math.floor(n));
  }
  return 0;
}
function positiveReturnText(value = '') {
  const s = text(value);
  if (!s || RETURN_OPEN_RE.test(s)) return false;
  return RETURN_DONE_RE.test(s);
}
function latestCodeOf(state = {}) {
  return text(state.latestTrackStatusCode || state.lastEventCode || state.eventCode || state.trackingEventCode);
}
function extractPodDate(state = {}, terminal = {}) {
  if (!terminal.pod) return '';
  const explicit = firstValue(state, ['POD时间','podTime','podClosedAt','podAt','deliveredAt','deliveryCompletedAt','签收时间']);
  const explicitDate = v246DateKey(explicit);
  if (explicitDate) return explicitDate;
  const latestDesc = text(firstValue(state, ['latestEventDesc','最后节点','lastEventDesc','QC判断']));
  const latestTime = firstValue(state, ['latestEventTime','最后节点时间','lastEventTime']);
  if (latestCodeOf(state) === '80' || v246PositivePodText(latestDesc)) return v246DateKey(latestTime);
  // orderStatus=85 proves terminal POD, but without an explicit POD timestamp or
  // a code-80/positive POD node it does NOT prove the POD date. Keep it unknown
  // until strict trajectory backfill instead of fabricating a signing-day value.
  return '';
}

export function classifyV246Terminal({ closeReason = '', state = '', stateJson = {} } = {}) {
  const payload = safeJson(stateJson, {});
  const stateName = text(state || payload.currentState || payload.scanNormalizedState || payload.state || payload.primaryCategory || payload.主分类).toUpperCase();
  const orderStatus = text(payload.orderStatus);
  const latestCode = latestCodeOf(payload);
  const evidence = [stateName,payload.退回状态,payload.primaryCategory,payload.currentMainCategory,payload.主分类,payload.异常分类,payload.latestEventDesc,payload.最后节点,payload.QC判断]
    .map(text).join(' ');
  // Legacy closeReason is deliberately not authoritative: older logic could
  // close NORMAL_FINAL_HUB / 580 / self-pickup / return-in-progress. V246 only
  // trusts exact current-state/scan/trajectory evidence and reopens everything else.
  const pod = stateName === 'POD' || orderStatus === '85' || latestCode === '80' || payload.是否POD === '是' || v246PositivePodText(evidence);
  const returned = !pod && (
    ['RETURNED','RETURN_COMPLETED'].includes(stateName)
    || orderStatus === '100'
    || latestCode === '86'
    || payload.退回状态 === '已退回'
    || positiveReturnText(evidence)
  );
  const cancelled = !pod && !returned && (
    stateName === 'ORDER_CANCELLED' || orderStatus === '10' || payload.订单取消 === '是' || payload.取消状态 === '已取消'
  );
  return {
    terminal: pod || returned || cancelled,
    pod, returned, cancelled,
    reason: pod ? 'POD' : returned ? 'RETURNED' : cancelled ? 'ORDER_CANCELLED' : '',
    ignoredLegacyCloseReason: text(closeReason)
  };
}

export function ensureV246TrackingSchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS qc_tracking_ledger (
      shipmentCode TEXT PRIMARY KEY,
      businessType TEXT NOT NULL,
      firstReportDate TEXT NOT NULL,
      lastImportedDate TEXT NOT NULL,
      sourceSnapshotId TEXT NOT NULL DEFAULT '',
      lastSnapshotId TEXT NOT NULL DEFAULT '',
      trackingStatus TEXT NOT NULL DEFAULT 'OPEN',
      terminalReason TEXT NOT NULL DEFAULT '',
      terminalAt TEXT NOT NULL DEFAULT '',
      currentState TEXT NOT NULL DEFAULT '',
      currentCategory TEXT NOT NULL DEFAULT '',
      lastEventTime TEXT NOT NULL DEFAULT '',
      podDate TEXT NOT NULL DEFAULT '',
      attemptNo INTEGER NOT NULL DEFAULT 0,
      attemptSource TEXT NOT NULL DEFAULT '',
      signingDays REAL,
      evidenceJson TEXT NOT NULL DEFAULT '{}',
      currentStateJson TEXT NOT NULL DEFAULT '{}',
      lastCheckedAt TEXT NOT NULL DEFAULT '',
      lastRepairReason TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_qc_tracking_business_first ON qc_tracking_ledger(businessType,firstReportDate);
    CREATE INDEX IF NOT EXISTS idx_qc_tracking_status_last ON qc_tracking_ledger(trackingStatus,lastImportedDate);
    CREATE TABLE IF NOT EXISTS qc_tracking_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipmentCode TEXT NOT NULL,
      businessType TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      beforeJson TEXT NOT NULL DEFAULT '{}',
      afterJson TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_qc_tracking_audit_bill ON qc_tracking_audit(shipmentCode,createdAt);
  `);
  return true;
}

function unifiedSources(db, { businessType, fromDate, toDate }) {
  const typeFilter = businessType === 'ALL' ? '' : 'AND UPPER(COALESCE(u.businessType,\'\'))=?';
  const params = businessType === 'ALL' ? [fromDate,toDate] : [fromDate,toDate,businessType];
  return db.prepare(`
    WITH ranked_batches AS (
      SELECT b.snapshotId,b.reportDate,b.createdAt,b.batchId,
             ROW_NUMBER() OVER (PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) AS rn
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ?
    )
    SELECT UPPER(TRIM(u.businessType)) AS businessType,
           UPPER(TRIM(u.shipmentCode)) AS shipmentCode,
           MIN(r.reportDate) AS firstReportDate,
           MAX(r.reportDate) AS lastImportedDate,
           MIN(r.snapshotId) AS anySnapshotId
    FROM ranked_batches r
    INNER JOIN unified_import_rows u ON u.snapshotId=r.snapshotId
    WHERE r.rn=1
      AND UPPER(COALESCE(u.businessType,'')) IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN')
      AND TRIM(COALESCE(u.shipmentCode,''))<>''
      ${typeFilter}
    GROUP BY UPPER(TRIM(u.businessType)),UPPER(TRIM(u.shipmentCode))
  `).all(...params);
}
function whppSources(db, { businessType, fromDate, toDate }) {
  if (businessType !== 'ALL' && businessType !== 'WHPP') return [];
  try {
    return db.prepare(`
      SELECT 'WHPP' AS businessType,UPPER(TRIM(shipmentCode)) AS shipmentCode,
             MIN(reportDate) AS firstReportDate,MAX(reportDate) AS lastImportedDate,'V246-WHPP' AS anySnapshotId
      FROM business_daily_parse_rows
      WHERE UPPER(COALESCE(businessType,''))='WHPP' AND reportDate BETWEEN ? AND ?
        AND TRIM(COALESCE(shipmentCode,''))<>''
      GROUP BY UPPER(TRIM(shipmentCode))
    `).all(fromDate,toDate);
  } catch { return []; }
}
function carryoverSources(db, { businessType, fromDate, toDate }) {
  const typeSql = businessType === 'ALL' ? '' : 'AND UPPER(COALESCE(businessType,\'\'))=?';
  const params = businessType === 'ALL' ? [fromDate,toDate] : [fromDate,toDate,businessType];
  try {
    return db.prepare(`SELECT UPPER(TRIM(businessType)) AS businessType,UPPER(TRIM(shipmentCode)) AS shipmentCode,
      sourceReportDate AS firstReportDate,lastReportDate AS lastImportedDate,sourceSnapshotId AS anySnapshotId
      FROM carryover_open_items
      WHERE sourceReportDate BETWEEN ? AND ? AND TRIM(COALESCE(shipmentCode,''))<>'' ${typeSql}`).all(...params);
  } catch { return []; }
}
export function listV246UploadedSources(selection, db = getDb()) {
  ensureV246TrackingSchema(db);
  // The source ledger is intentionally a UNION of current valid daily snapshots
  // and every shipment already admitted into carryover. A later re-upload must
  // never make a previously valid shipment silently disappear from QC tracking.
  const merged = new Map();
  for (const row of [...unifiedSources(db, selection), ...whppSources(db, selection), ...carryoverSources(db, selection)]) {
    const bill = billOf(row.shipmentCode);
    const type = text(row.businessType).toUpperCase();
    if (!bill || !TYPE_SET.has(type)) continue;
    const old = merged.get(bill);
    if (!old) {
      merged.set(bill,{...row,shipmentCode:bill,businessType:type,firstReportDate:v246DateKey(row.firstReportDate),lastImportedDate:v246DateKey(row.lastImportedDate)});
      continue;
    }
    old.firstReportDate = minDate(old.firstReportDate,row.firstReportDate) || old.firstReportDate;
    old.lastImportedDate = maxDate(old.lastImportedDate,row.lastImportedDate) || old.lastImportedDate;
    if (!old.anySnapshotId && row.anySnapshotId) old.anySnapshotId = row.anySnapshotId;
  }
  return [...merged.values()].filter(row => row.firstReportDate && row.lastImportedDate);
}

function compactLedger(row = {}) {
  return {
    businessType: row.businessType || '', firstReportDate: row.firstReportDate || '', lastImportedDate: row.lastImportedDate || '',
    trackingStatus: row.trackingStatus || '', terminalReason: row.terminalReason || '', podDate: row.podDate || '',
    attemptNo: Number(row.attemptNo || 0), attemptSource: row.attemptSource || '', signingDays: row.signingDays ?? null, currentState: row.currentState || ''
  };
}
function strictAttemptSource(value=''){ return /^V246_STRICT_TRACK/i.test(text(value)) || /严格START|严格派送/i.test(text(value)); }

export function reconcileV246TrackingLedger(selection, { db = getDb(), reason = 'RECONCILE' } = {}) {
  ensureV246TrackingSchema(db);
  const sources = listV246UploadedSources(selection, db);
  const carryGet = db.prepare('SELECT * FROM carryover_open_items WHERE shipmentCode=?');
  const currentGet = db.prepare('SELECT * FROM shipment_current_state WHERE shipmentCode=?');
  const ledgerGet = db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?');
  const carryUpsert = db.prepare(`INSERT INTO carryover_open_items(
      shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(shipmentCode) DO UPDATE SET
      businessType=excluded.businessType,
      sourceReportDate=CASE WHEN excluded.sourceReportDate<carryover_open_items.sourceReportDate THEN excluded.sourceReportDate ELSE carryover_open_items.sourceReportDate END,
      lastReportDate=CASE WHEN excluded.lastReportDate>carryover_open_items.lastReportDate THEN excluded.lastReportDate ELSE carryover_open_items.lastReportDate END,
      lastSnapshotId=CASE WHEN excluded.lastSnapshotId<>'' THEN excluded.lastSnapshotId ELSE carryover_open_items.lastSnapshotId END,
      status=excluded.status,apiStatus=excluded.apiStatus,closeReason=excluded.closeReason,
      stateJson=CASE WHEN excluded.stateJson<>'{}' THEN excluded.stateJson ELSE carryover_open_items.stateJson END,
      updatedAt=excluded.updatedAt`);
  const ledgerUpsert = db.prepare(`INSERT INTO qc_tracking_ledger(
      shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,
      currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(shipmentCode) DO UPDATE SET
      businessType=excluded.businessType,
      firstReportDate=CASE WHEN excluded.firstReportDate<qc_tracking_ledger.firstReportDate THEN excluded.firstReportDate ELSE qc_tracking_ledger.firstReportDate END,
      lastImportedDate=CASE WHEN excluded.lastImportedDate>qc_tracking_ledger.lastImportedDate THEN excluded.lastImportedDate ELSE qc_tracking_ledger.lastImportedDate END,
      lastSnapshotId=CASE WHEN excluded.lastSnapshotId<>'' THEN excluded.lastSnapshotId ELSE qc_tracking_ledger.lastSnapshotId END,
      trackingStatus=CASE WHEN qc_tracking_ledger.trackingStatus='TERMINAL' THEN 'TERMINAL' ELSE excluded.trackingStatus END,
      terminalReason=CASE WHEN qc_tracking_ledger.trackingStatus='TERMINAL' AND qc_tracking_ledger.terminalReason<>'' THEN qc_tracking_ledger.terminalReason ELSE excluded.terminalReason END,
      terminalAt=CASE WHEN qc_tracking_ledger.trackingStatus='TERMINAL' AND qc_tracking_ledger.terminalAt<>'' THEN qc_tracking_ledger.terminalAt ELSE excluded.terminalAt END,
      currentState=excluded.currentState,currentCategory=excluded.currentCategory,lastEventTime=excluded.lastEventTime,
      podDate=CASE WHEN qc_tracking_ledger.podDate<>'' THEN qc_tracking_ledger.podDate ELSE excluded.podDate END,
      attemptNo=CASE WHEN qc_tracking_ledger.attemptSource LIKE 'V246_STRICT_TRACK%' THEN qc_tracking_ledger.attemptNo ELSE excluded.attemptNo END,
      attemptSource=CASE WHEN qc_tracking_ledger.attemptSource LIKE 'V246_STRICT_TRACK%' THEN qc_tracking_ledger.attemptSource ELSE excluded.attemptSource END,
      signingDays=CASE WHEN excluded.signingDays IS NOT NULL THEN excluded.signingDays ELSE qc_tracking_ledger.signingDays END,
      evidenceJson=excluded.evidenceJson,currentStateJson=excluded.currentStateJson,lastCheckedAt=CASE WHEN excluded.lastCheckedAt<>'' THEN excluded.lastCheckedAt ELSE qc_tracking_ledger.lastCheckedAt END,
      lastRepairReason=excluded.lastRepairReason,updatedAt=excluded.updatedAt`);
  const auditInsert = db.prepare('INSERT INTO qc_tracking_audit(shipmentCode,businessType,action,reason,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?)');
  const now = nowIso();
  let missingLedger = 0, missingCarry = 0, reopened = 0, terminal = 0, open = 0;
  const repairedSamples = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const source of sources) {
      const bill = billOf(source.shipmentCode);
      const type = text(source.businessType).toUpperCase();
      const carry = carryGet.get(bill) || null;
      const current = currentGet.get(bill) || null;
      const oldLedger = ledgerGet.get(bill) || null;
      const carryJson = safeJson(carry?.stateJson, {});
      const currentJson = safeJson(current?.stateJson, {});
      const payload = { ...carryJson, ...currentJson, shipmentCode: bill, 运单号: bill, businessType: type };
      const clsCurrent = classifyV246Terminal({ state: current?.state, stateJson: currentJson });
      const clsCarry = classifyV246Terminal({ closeReason: carry?.closeReason, stateJson: carryJson });
      const cls = clsCurrent.terminal ? clsCurrent : clsCarry;
      const firstReportDate = minDate(oldLedger?.firstReportDate, carry?.sourceReportDate, source.firstReportDate) || source.firstReportDate;
      const lastImportedDate = maxDate(oldLedger?.lastImportedDate, source.lastImportedDate, carry?.lastReportDate) || source.lastImportedDate;
      const sourceSnapshotId = text(oldLedger?.sourceSnapshotId || carry?.sourceSnapshotId || source.anySnapshotId || 'V246-RECOVERED');
      const lastSnapshotId = text(current?.snapshotId || carry?.lastSnapshotId || source.anySnapshotId || sourceSnapshotId);
      const podDate = text(oldLedger?.podDate) || extractPodDate(payload, cls) || '';
      const oldStrict = strictAttemptSource(oldLedger?.attemptSource);
      const observedAttempt = directAttempt(payload);
      const attemptNo = oldStrict ? Number(oldLedger?.attemptNo || 0) : observedAttempt;
      const attemptSource = oldStrict ? text(oldLedger?.attemptSource) : (attemptNo ? text(payload.attemptSource || payload.attemptStatus || '现有派次证据') : '');
      const signingDays = podDate ? v246InclusiveDays(firstReportDate,podDate) : null;
      const stateName = text(current?.state || payload.currentState || payload.scanNormalizedState || payload.primaryCategory || payload.主分类 || 'OPEN');
      const category = text(payload.primaryCategory || payload.currentMainCategory || payload.主分类 || payload.异常分类 || stateName);
      const lastEventTime = text(current?.lastEventTime || payload.latestEventTime || payload.最后节点时间 || '');
      const trackingStatus = cls.terminal ? 'TERMINAL' : 'OPEN';
      const closeReason = cls.reason;
      if (!oldLedger) missingLedger += 1;
      if (!carry) missingCarry += 1;
      if (!cls.terminal && carry && (text(carry.status).toUpperCase() === 'CLOSED' || text(carry.closeReason))) reopened += 1;
      if (cls.terminal) terminal += 1; else open += 1;
      const apiStatus = text(current?.apiStatus || carry?.apiStatus || 'PENDING_SCAN');
      const before = compactLedger(oldLedger || carry || {});
      carryUpsert.run(bill,type,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus === 'TERMINAL' ? 'CLOSED' : 'OPEN',apiStatus,closeReason,JSON.stringify(payload),carry?.createdAt || now,now);
      ledgerUpsert.run(
        bill,type,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,closeReason,
        cls.terminal ? (text(oldLedger?.terminalAt) || lastEventTime || now) : '',stateName,category,lastEventTime,podDate,attemptNo,attemptSource,signingDays,
        JSON.stringify({ source:'V246_RECONCILE', reason, sourceFirstReportDate:source.firstReportDate, sourceLastImportedDate:source.lastImportedDate }),
        JSON.stringify(payload),text(oldLedger?.lastCheckedAt || current?.updatedAt || carry?.updatedAt || ''),reason,oldLedger?.createdAt || carry?.createdAt || now,now
      );
      if (!oldLedger || !carry || (!cls.terminal && carry && (text(carry.status).toUpperCase() === 'CLOSED' || text(carry.closeReason)))) {
        const after = compactLedger(ledgerGet.get(bill) || {});
        const action = !oldLedger ? 'ADD_LEDGER' : !carry ? 'RECOVER_CARRY' : 'REOPEN_NON_TERMINAL';
        auditInsert.run(bill,type,action,reason,JSON.stringify(before),JSON.stringify(after),now);
        if (repairedSamples.length < 20) repairedSamples.push(bill);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { ok:true, version:V246_TRACKING_LEDGER_ID, ...selection, expected:sources.length, missingLedger, missingCarry, reopened, terminal, open, repaired:missingLedger+missingCarry+reopened, repairedSamples, reconciledAt:now };
}

export function listV246OpenTrackingRows(selection, db = getDb()) {
  ensureV246TrackingSchema(db);
  const typeSql = selection.businessType === 'ALL' ? '' : 'AND businessType=?';
  const params = selection.businessType === 'ALL'
    ? [selection.toDate,selection.fromDate]
    : [selection.toDate,selection.fromDate,selection.businessType];
  return db.prepare(`SELECT shipmentCode,businessType,firstReportDate AS sourceReportDate,lastImportedDate AS lastReportDate,
      trackingStatus AS status,'SUCCESS' AS apiStatus,currentStateJson AS stateJson,lastCheckedAt
    FROM qc_tracking_ledger
    WHERE trackingStatus='OPEN' AND firstReportDate<=? AND lastImportedDate>=? ${typeSql}
    ORDER BY firstReportDate,shipmentCode`).all(...params);
}

function reliableV200Pod(row = {}) {
  if (!row.pod || !v246DateKey(row.podDate)) return false;
  const source = text(row.podSource || row.podEvidenceSource || '');
  return /POD锁|轨迹POD|状态码80|显式POD时间/i.test(source);
}
export function applyV246EvidenceRows(rows = [], { db = getDb(), reason = 'EVIDENCE_REFRESH' } = {}) {
  ensureV246TrackingSchema(db);
  const get = db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?');
  const update = db.prepare(`UPDATE qc_tracking_ledger SET
    businessType=?,firstReportDate=?,lastImportedDate=?,trackingStatus=?,terminalReason=?,terminalAt=?,currentState=?,currentCategory=?,
    podDate=?,attemptNo=?,attemptSource=?,signingDays=?,evidenceJson=?,lastCheckedAt=?,lastRepairReason=?,updatedAt=? WHERE shipmentCode=?`);
  const carry = db.prepare(`UPDATE carryover_open_items SET status=?,closeReason=?,apiStatus='SUCCESS',stateJson=CASE WHEN ?<>'' THEN ? ELSE stateJson END,updatedAt=? WHERE shipmentCode=?`);
  const now = nowIso();
  let updated = 0, pod = 0, returned = 0, attemptKnown = 0, signingKnown = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const bill = billOf(row.shipmentCode);
      const old = get.get(bill);
      if (!bill || !old) continue;
      const firstReportDate = minDate(old.firstReportDate,row.firstReportDate) || old.firstReportDate;
      const lastImportedDate = maxDate(old.lastImportedDate,row.lastReportDate) || old.lastImportedDate;
      const isPod = reliableV200Pod(row);
      const exactReturned = !isPod && Boolean(row.returned) && (text(row.statusCode).toUpperCase()==='R' || /RETURN_COMPLETED|已退回|退回完成/i.test(text(row.statusDesc)));
      const oldTerminal = ['POD','RETURNED','ORDER_CANCELLED'].includes(text(old.terminalReason));
      const terminalReason = oldTerminal ? text(old.terminalReason) : isPod ? 'POD' : exactReturned ? 'RETURNED' : '';
      const terminal = Boolean(terminalReason);
      const podDate = terminalReason === 'POD' ? (v246DateKey(row.podDate) || text(old.podDate)) : text(old.podDate);
      // V200 is used only to enrich POD date/signing-day evidence here. Attempt
      // number is authoritative only after V246 strict START/failure backfill.
      const attemptNo = Number(old.attemptNo || 0);
      const attemptSource = text(old.attemptSource);
      const signingDays = podDate ? v246InclusiveDays(firstReportDate,podDate) : (old.signingDays ?? null);
      const stateName = terminalReason === 'POD' ? 'POD' : terminalReason === 'RETURNED' ? 'RETURNED' : text(row.statusDesc || old.currentState || 'OPEN');
      const category = text(row.statusDesc || row.exceptionDesc || old.currentCategory || stateName);
      const evidence = JSON.stringify({ source:'V200_EVIDENCE_SAFE', reason, podSource:row.podSource || '', firstReportDate, podDate });
      update.run(row.businessType || old.businessType,firstReportDate,lastImportedDate,terminal?'TERMINAL':'OPEN',terminalReason,
        terminal ? (text(old.terminalAt) || text(row.podTime) || now) : '',stateName,category,podDate,attemptNo,attemptSource,signingDays,evidence,now,reason,now,bill);
      const statePayload = JSON.stringify({ shipmentCode:bill,businessType:row.businessType||old.businessType,currentState:stateName,primaryCategory:category,是否POD:terminalReason==='POD'?'是':'否',POD时间:row.podTime||'',podTime:row.podTime||'',podAttemptNo:attemptNo,attemptSource });
      carry.run(terminal?'CLOSED':'OPEN',terminalReason,statePayload,statePayload,now,bill);
      updated += 1;
      if (terminalReason === 'POD') pod += 1;
      if (terminalReason === 'RETURNED') returned += 1;
      if (attemptNo > 0) attemptKnown += 1;
      if (signingDays) signingKnown += 1;
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { updated,pod,returned,attemptKnown,signingKnown };
}

export function listV246ShopeePodForStrictCheck(selection, db = getDb()) {
  ensureV246TrackingSchema(db);
  const types = selection.businessType === 'ALL' ? ['SHOPEECN','SHOPEEVN'] : [selection.businessType].filter(type => ['SHOPEECN','SHOPEEVN'].includes(type));
  if (!types.length) return [];
  const marks = types.map(()=>'?').join(',');
  return db.prepare(`SELECT shipmentCode,businessType,firstReportDate,lastImportedDate,podDate,attemptNo,attemptSource,lastCheckedAt
    FROM qc_tracking_ledger
    WHERE terminalReason='POD' AND businessType IN (${marks})
      AND firstReportDate<=? AND lastImportedDate>=?
    ORDER BY firstReportDate,shipmentCode`).all(...types,selection.toDate,selection.fromDate);
}

export function applyV246StrictAttemptEvidence(rows = [], { db = getDb(), reason = 'V246_STRICT_TRACK_QUERY' } = {}) {
  ensureV246TrackingSchema(db);
  const get = db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?');
  const update = db.prepare(`UPDATE qc_tracking_ledger SET podDate=?,attemptNo=?,attemptSource=?,signingDays=?,evidenceJson=?,lastCheckedAt=?,lastRepairReason=?,updatedAt=? WHERE shipmentCode=?`);
  const audit = db.prepare('INSERT INTO qc_tracking_audit(shipmentCode,businessType,action,reason,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?)');
  const now = nowIso();
  let updated=0,known=0,unknown=0,podDateFilled=0,corrected=0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const row of rows){
      const bill=billOf(row.shipmentCode);const old=get.get(bill);if(!bill||!old||old.terminalReason!=='POD')continue;
      const before=compactLedger(old);
      const podDate=v246DateKey(row.podDate)||text(old.podDate);
      const attemptNo=Math.max(0,Math.min(3,Number(row.attemptNo||0)));
      const source=`V246_STRICT_TRACK:${text(row.source||'START_FAILURE_CYCLE')}`;
      const signingDays=podDate?v246InclusiveDays(old.firstReportDate,podDate):(old.signingDays??null);
      const evidence=JSON.stringify({source,reason,podDate,attemptNo,startMode:row.startMode||'',starts:row.starts||[],failures:row.failures||[],checkedAt:now});
      if(!old.podDate&&podDate)podDateFilled+=1;
      if(Number(old.attemptNo||0)!==attemptNo&&text(old.attemptSource))corrected+=1;
      update.run(podDate,attemptNo,source,signingDays,evidence,now,reason,now,bill);
      const after=compactLedger(get.get(bill)||{});
      if(JSON.stringify(before)!==JSON.stringify(after))audit.run(bill,old.businessType,'STRICT_ATTEMPT_EVIDENCE',reason,JSON.stringify(before),JSON.stringify(after),now);
      updated+=1;if(attemptNo>0)known+=1;else unknown+=1;
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return{updated,known,unknown,podDateFilled,corrected};
}

export function readV246ShopeeDailyTruth(businessType, dates = [], db = getDb()) {
  ensureV246TrackingSchema(db);
  const type = text(businessType).toUpperCase();
  const validDates = [...new Set(dates.map(v246DateKey).filter(Boolean))];
  if (!['SHOPEECN','SHOPEEVN'].includes(type) || !validDates.length) return new Map();
  const placeholders = validDates.map(() => '?').join(',');
  const rows = db.prepare(`SELECT firstReportDate,
      SUM(CASE WHEN terminalReason='POD' THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=1 THEN 1 ELSE 0 END) AS attempt1,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=2 THEN 1 ELSE 0 END) AS attempt2,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo>=3 THEN 1 ELSE 0 END) AS attempt3,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=0 THEN 1 ELSE 0 END) AS attemptUnknown,
      SUM(CASE WHEN terminalReason='POD' AND signingDays>0 THEN signingDays ELSE 0 END) AS signingDaysSum,
      SUM(CASE WHEN terminalReason='POD' AND signingDays>0 THEN 1 ELSE 0 END) AS signingDaysCount
    FROM qc_tracking_ledger WHERE businessType=? AND firstReportDate IN (${placeholders}) GROUP BY firstReportDate`).all(type,...validDates);
  return new Map(rows.map(row => [row.firstReportDate, {
    pod:Number(row.pod||0),attempt1:Number(row.attempt1||0),attempt2:Number(row.attempt2||0),attempt3:Number(row.attempt3||0),
    attemptUnknown:Number(row.attemptUnknown||0),signingDaysSum:Number(row.signingDaysSum||0),signingDaysCount:Number(row.signingDaysCount||0)
  }]));
}

export function v246TrackingSummary(selection, db = getDb()) {
  ensureV246TrackingSchema(db);
  const typeSql = selection.businessType === 'ALL' ? '' : 'AND businessType=?';
  const params = selection.businessType === 'ALL'
    ? [selection.toDate,selection.fromDate]
    : [selection.toDate,selection.fromDate,selection.businessType];
  const row = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN trackingStatus='OPEN' THEN 1 ELSE 0 END) open,
      SUM(CASE WHEN terminalReason='POD' THEN 1 ELSE 0 END) pod,
      SUM(CASE WHEN terminalReason='RETURNED' THEN 1 ELSE 0 END) returned,
      SUM(CASE WHEN terminalReason='ORDER_CANCELLED' THEN 1 ELSE 0 END) cancelled,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo>0 THEN 1 ELSE 0 END) attemptKnown,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=0 THEN 1 ELSE 0 END) attemptUnknown,
      SUM(CASE WHEN terminalReason='POD' AND signingDays>0 THEN 1 ELSE 0 END) signingKnown,
      MAX(updatedAt) lastUpdatedAt
    FROM qc_tracking_ledger WHERE firstReportDate<=? AND lastImportedDate>=? ${typeSql}`).get(...params) || {};
  return { ok:true,version:V246_TRACKING_LEDGER_ID,...selection,total:Number(row.total||0),open:Number(row.open||0),pod:Number(row.pod||0),returned:Number(row.returned||0),cancelled:Number(row.cancelled||0),attemptKnown:Number(row.attemptKnown||0),attemptUnknown:Number(row.attemptUnknown||0),signingKnown:Number(row.signingKnown||0),lastUpdatedAt:row.lastUpdatedAt||'' };
}
