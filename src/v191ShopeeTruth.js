import { getDb } from './db.js';

export const V191_SHOPEE_TRUTH_VERSION = '2026-08-17-v191-shopee-cross-day-attempt-truth-v1';
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const TERMINAL_POD = new Set(['85']);
const TERMINAL_RETURN = new Set(['100']);
const DELIVERY_RE = /delivery\s*assign|courier\s*assign|out\s*for\s*delivery|派件分配|分配快递员|分配派送|派送中|派件中|正在派送/i;
const POD_RE = /\bPOD\b|delivered|签收|妥投|已妥投/i;
const RETURN_RE = /return(?:ed|_completed)?|退回完成|已退回|退件完成/i;

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; }
}
function billOf(value = '') { return String(value || '').trim().toUpperCase(); }
function dateKey(value = '') {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
function positiveInt(...values) {
  for (const value of values) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return Math.min(3, Math.floor(n));
  }
  return 0;
}
function textOfEvent(row = {}) {
  const raw = safeJson(row.rawJson, {});
  return [
    row.eventCode, raw.eventCode, raw.trackingEventCode, raw.statusCode,
    raw.trackingEventDescZh, raw.trackingEventDesc, raw.trackingEventDescKm,
    raw.statusText, raw.remark, raw.place, raw.eventShop, raw.locationCode
  ].map(value => String(value || '').trim()).filter(Boolean).join(' ');
}
function timeOfEvent(row = {}) {
  const raw = safeJson(row.rawJson, {});
  return String(row.eventTime || raw.eventTime || raw.creationDate || raw.lastUpdateDate || '').trim();
}
function eventCodeOf(row = {}) {
  const raw = safeJson(row.rawJson, {});
  return String(row.eventCode || raw.eventCode || raw.trackingEventCode || raw.statusCode || '').trim();
}
function currentEvidence(row = {}) {
  if (!row || !billOf(row.shipmentCode)) return null;
  const parsed = safeJson(row.stateJson, {});
  const state = String(row.state || parsed.currentState || parsed.state || '').toUpperCase();
  const category = String(parsed.primaryCategory || parsed.主分类 || parsed.异常分类 || '').trim();
  const desc = String(parsed.latestEventDesc || parsed.最后节点 || parsed.QC判断 || category || '').trim();
  const node = String(parsed.latestNode || parsed.currentHub || parsed.currentShop || parsed.当前门店 || '').trim();
  const combined = `${state} ${category} ${desc} ${node}`;
  const pod = state === 'POD' || parsed.是否POD === '是' || String(parsed.orderStatus || '') === '85' || POD_RE.test(combined);
  const returned = !pod && (['RETURNED', 'RETURN_COMPLETED'].includes(state) || parsed.退回状态 === '已退回' || RETURN_RE.test(combined));
  const cancelled = !pod && !returned && (['CANCELLED', 'CANCELED', 'ORDER_CANCELLED'].includes(state) || /取消|CANCEL/i.test(combined));
  const pending = !pod && !returned && !cancelled && (state === 'PENDING' || /PENDING|Pending\d*次/i.test(combined));
  const delivering = !pod && !returned && !cancelled && !pending && DELIVERY_RE.test(combined);
  return {
    source: 'SHIPMENT_CURRENT_STATE', pod, returned, cancelled, pending, delivering,
    attemptNo: positiveInt(parsed.podAttemptNo, parsed.currentAttemptNo, parsed.派次, parsed.attemptNo),
    pendingCount: positiveInt(parsed.Pending当前次数, parsed.Pending次数, parsed.pendingDistinctDayCount, parsed.pendingCount, parsed.pendingTimes),
    eventTime: String(parsed.POD时间 || parsed.podTime || parsed.podClosedAt || parsed.退回完成时间 || parsed.latestEventTime || parsed.最后节点时间 || row.lastEventTime || '').trim(),
    eventDesc: desc, eventNode: node, category,
    updatedAt: String(row.updatedAt || ''), apiStatus: String(row.apiStatus || parsed.API状态 || parsed.查询状态 || '')
  };
}
function finalEvidence(row = {}) {
  if (!row || !billOf(row.shipmentCode)) return null;
  const raw = safeJson(row.rawJson, {});
  const state = String(raw.currentState || '').toUpperCase();
  const category = String(row.currentMainCategory || row.primaryCategory || raw.primaryCategory || raw.主分类 || '').trim();
  const desc = String(row.latestEventDesc || raw.latestEventDesc || raw.最后节点 || '').trim();
  const node = String(row.latestNode || raw.latestNode || raw.currentHub || '').trim();
  const combined = `${state} ${category} ${desc} ${node}`;
  const pod = Number(row.isPod || 0) === 1 || raw.是否POD === '是' || String(raw.orderStatus || '') === '85' || state === 'POD' || POD_RE.test(combined);
  const returned = !pod && (raw.退回状态 === '已退回' || ['RETURNED', 'RETURN_COMPLETED'].includes(state) || RETURN_RE.test(combined));
  const cancelled = !pod && !returned && (state === 'ORDER_CANCELLED' || /取消|CANCEL/i.test(combined));
  const pending = !pod && !returned && !cancelled && /PENDING|Pending\d*次/i.test(combined);
  const delivering = !pod && !returned && !cancelled && !pending && DELIVERY_RE.test(combined);
  return {
    source: 'BUSINESS_FINAL_ROWS', pod, returned, cancelled, pending, delivering,
    attemptNo: positiveInt(row.podAttemptNo, raw.podAttemptNo, row.currentAttemptNo, raw.currentAttemptNo),
    pendingCount: positiveInt(raw.Pending当前次数, raw.Pending次数, raw.pendingDistinctDayCount),
    eventTime: String(raw.POD时间 || raw.podTime || raw.podClosedAt || row.latestEventTime || raw.latestEventTime || '').trim(),
    eventDesc: desc, eventNode: node, category,
    updatedAt: String(row.updatedAt || ''), reportDate: String(row.reportDate || ''), apiStatus: String(row.apiStatus || raw.API状态 || '')
  };
}
function scanEvidence(row = {}) {
  if (!row || !billOf(row.shipmentCode)) return null;
  const raw = safeJson(row.rawJson, {});
  const orderStatus = String(row.orderStatus || raw.orderStatus || '').trim();
  const pod = TERMINAL_POD.has(orderStatus) || Number(row.isPod || 0) === 1;
  const returned = !pod && TERMINAL_RETURN.has(orderStatus);
  return {
    source: 'BUSINESS_SCAN_RESULTS', pod, returned, cancelled: false, pending: false, delivering: false,
    attemptNo: 0, pendingCount: 0,
    eventTime: String(raw.podTime || raw.updatedAt || row.updatedAt || '').trim(), eventDesc: `orderStatus=${orderStatus}`, eventNode: '', category: '',
    updatedAt: String(row.updatedAt || ''), reportDate: String(row.reportDate || ''), apiStatus: 'SUCCESS'
  };
}
function chooseState(current, final, scan, track) {
  const evidences = [current, final, scan, track].filter(Boolean);
  const pod = evidences.some(item => item.pod);
  const returned = !pod && evidences.some(item => item.returned);
  const cancelled = !pod && !returned && evidences.some(item => item.cancelled);
  const base = pod
    ? evidences.find(item => item.pod && item.source === 'SHIPMENT_CURRENT_STATE') || evidences.find(item => item.pod) || current || final || scan || track
    : returned
      ? evidences.find(item => item.returned && item.source === 'SHIPMENT_CURRENT_STATE') || evidences.find(item => item.returned) || current || final || scan || track
      : cancelled
        ? evidences.find(item => item.cancelled) || current || final || scan || track
        : current || final || track || scan || {};
  const explicitAttempt = pod ? positiveInt(current?.attemptNo, final?.attemptNo, base?.attemptNo) : 0;
  const trackAttempt = pod ? positiveInt(track?.attemptNo) : 0;
  const attemptNo = explicitAttempt || trackAttempt;
  const attemptSource = explicitAttempt
    ? (current?.attemptNo ? 'CURRENT_STATE_ATTEMPT' : 'FINAL_ROW_ATTEMPT')
    : trackAttempt ? 'TRACK_DELIVERY_DATES' : '';
  return {
    ...base,
    pod, returned, cancelled,
    pending: !pod && !returned && !cancelled && Boolean(base?.pending),
    delivering: !pod && !returned && !cancelled && !base?.pending && Boolean(base?.delivering),
    attemptNo,
    attemptSource,
    attemptUnknown: pod && !attemptNo,
    hasEvidence: evidences.length > 0,
    evidenceSources: [...new Set(evidences.map(item => item.source).filter(Boolean))]
  };
}

function queryCurrent(db, businessType, bills) {
  const out = new Map();
  for (const chunk of chunks(bills, 350)) {
    if (!chunk.length) continue;
    const marks = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT shipmentCode,businessType,state,apiStatus,lastEventTime,stateJson,updatedAt
      FROM shipment_current_state
      WHERE shipmentCode IN (${marks}) AND (UPPER(COALESCE(businessType,''))=? OR UPPER(COALESCE(businessType,''))='SHOPEE')
      ORDER BY shipmentCode, CASE WHEN UPPER(COALESCE(businessType,''))=? THEN 0 ELSE 1 END, updatedAt DESC`).all(...chunk, businessType, businessType);
    for (const row of rows) {
      const bill = billOf(row.shipmentCode);
      if (!bill || out.has(bill)) continue;
      out.set(bill, currentEvidence(row));
    }
  }
  return out;
}
function queryFinal(db, bills) {
  const out = new Map();
  for (const chunk of chunks(bills, 350)) {
    if (!chunk.length) continue;
    const marks = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT shipmentCode,reportDate,isPod,primaryCategory,currentMainCategory,apiStatus,latestEventTime,latestEventDesc,latestNode,currentAttemptNo,podAttemptNo,rawJson,updatedAt
      FROM business_final_rows
      WHERE businessType='SHOPEE' AND shipmentCode IN (${marks})
      ORDER BY shipmentCode ASC, CASE WHEN COALESCE(isPod,0)=1 THEN 0 ELSE 1 END ASC,
        CASE WHEN COALESCE(podAttemptNo,currentAttemptNo,0)>0 THEN 0 ELSE 1 END ASC,
        reportDate DESC, updatedAt DESC`).all(...chunk);
    for (const row of rows) {
      const bill = billOf(row.shipmentCode);
      if (!bill || out.has(bill)) continue;
      out.set(bill, finalEvidence(row));
    }
  }
  return out;
}
function queryScan(db, bills) {
  const out = new Map();
  for (const chunk of chunks(bills, 350)) {
    if (!chunk.length) continue;
    const marks = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT shipmentCode,reportDate,isPod,orderStatus,rawJson,updatedAt
      FROM business_scan_results WHERE businessType='SHOPEE' AND shipmentCode IN (${marks})
      ORDER BY shipmentCode ASC, CASE WHEN COALESCE(isPod,0)=1 OR orderStatus IN ('85','100') THEN 0 ELSE 1 END ASC, reportDate DESC, updatedAt DESC`).all(...chunk);
    for (const row of rows) {
      const bill = billOf(row.shipmentCode);
      if (!bill || out.has(bill)) continue;
      out.set(bill, scanEvidence(row));
    }
  }
  return out;
}
function queryTrack(db, bills) {
  const byBill = new Map();
  for (const chunk of chunks(bills, 250)) {
    if (!chunk.length) continue;
    const marks = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt
      FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks})
      ORDER BY shipmentCode,eventTime,createdAt,id`).all(...chunk);
    for (const row of rows) {
      const bill = billOf(row.shipmentCode);
      if (!bill) continue;
      if (!byBill.has(bill)) byBill.set(bill, []);
      byBill.get(bill).push(row);
    }
  }
  const out = new Map();
  for (const [bill, events] of byBill) {
    const deliveryDates = new Set();
    let last = null;
    let latestPod = null;
    let latestReturn = null;
    for (const event of events) {
      const text = textOfEvent(event);
      const code = eventCodeOf(event);
      const time = timeOfEvent(event);
      const date = dateKey(time);
      if (date && DELIVERY_RE.test(text) && !/盘点|cycle\s*count/i.test(text)) deliveryDates.add(date);
      if (code === '80' || POD_RE.test(text)) latestPod = event;
      if (code === '86' || RETURN_RE.test(text)) latestReturn = event;
      last = event;
    }
    const lastCode = eventCodeOf(last || {});
    const lastText = textOfEvent(last || {});
    const pod = lastCode === '80' || POD_RE.test(lastText) || Boolean(latestPod && !latestReturn);
    const returned = !pod && (lastCode === '86' || RETURN_RE.test(lastText));
    out.set(bill, {
      source: 'BUSINESS_TRACK_EVENTS', pod, returned, cancelled: false,
      pending: !pod && !returned && (lastCode === '150' || /PENDING/i.test(lastText)),
      delivering: !pod && !returned && DELIVERY_RE.test(lastText),
      attemptNo: deliveryDates.size ? Math.min(3, deliveryDates.size) : 0,
      pendingCount: 0,
      eventTime: pod ? timeOfEvent(latestPod || last || {}) : timeOfEvent(last || {}),
      eventDesc: lastText, eventNode: '', category: '', updatedAt: String(last?.createdAt || ''), apiStatus: 'PERSISTED_TRACK'
    });
  }
  return out;
}
function chunks(values = [], size = 350) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export function collectShopeeShipmentTruth({ db = getDb(), businessType, bills = [] } = {}) {
  const type = String(businessType || '').trim().toUpperCase();
  if (!SHOPEE_TYPES.has(type)) throw new Error(`SHOPEE truth only supports SHOPEECN/SHOPEEVN: ${type}`);
  const normalized = [...new Set((bills || []).map(billOf).filter(Boolean))];
  const current = queryCurrent(db, type, normalized);
  const finals = queryFinal(db, normalized);
  const scans = queryScan(db, normalized);
  const trackNeeded = normalized.filter(bill => {
    const c = current.get(bill), f = finals.get(bill), s = scans.get(bill);
    const pod = Boolean(c?.pod || f?.pod || s?.pod);
    return !pod || !positiveInt(c?.attemptNo, f?.attemptNo);
  });
  const tracks = queryTrack(db, trackNeeded);
  const result = new Map();
  for (const bill of normalized) result.set(bill, chooseState(current.get(bill), finals.get(bill), scans.get(bill), tracks.get(bill)));
  return result;
}

export function queryShopeeAttemptFacts({ db = getDb(), fromDate, toDate } = {}) {
  const from = dateKey(fromDate), to = dateKey(toDate);
  if (!from || !to || from > to) return [];
  const rows = db.prepare(`WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
        ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ), latest AS (SELECT reportDate,snapshotId FROM ranked WHERE rn=1)
    SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode,
      CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP' WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV' ELSE 'UNKNOWN' END regionCode
    FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
    WHERE u.businessType IN ('SHOPEECN','SHOPEEVN')
    ORDER BY u.reportDate,u.businessType,u.shipmentCode`).all(from, to);
  const byType = new Map([['SHOPEECN', []], ['SHOPEEVN', []]]);
  for (const row of rows) byType.get(row.businessType)?.push(row);
  const truthByType = new Map();
  for (const type of SHOPEE_TYPES) truthByType.set(type, collectShopeeShipmentTruth({ db, businessType: type, bills: byType.get(type).map(row => row.shipmentCode) }));
  const grouped = new Map();
  for (const row of rows) {
    const truth = truthByType.get(row.businessType)?.get(billOf(row.shipmentCode)) || {};
    const key = `${row.reportDate}|${row.businessType}|${row.regionCode}`;
    if (!grouped.has(key)) grouped.set(key, { reportDate: row.reportDate, businessType: row.businessType, regionCode: row.regionCode, total: 0, pod: 0, returned: 0, cancelled: 0, pending: 0, delivering: 0, attempt1: 0, attempt2: 0, attempt3: 0, attemptUnknown: 0, evidenceCount: 0 });
    const stat = grouped.get(key);
    stat.total += 1;
    if (truth.hasEvidence) stat.evidenceCount += 1;
    if (truth.returned) stat.returned += 1;
    if (truth.cancelled) stat.cancelled += 1;
    if (truth.pending) stat.pending += 1;
    if (truth.delivering) stat.delivering += 1;
    if (truth.pod) {
      stat.pod += 1;
      if (truth.attemptNo === 1) stat.attempt1 += 1;
      else if (truth.attemptNo === 2) stat.attempt2 += 1;
      else if (truth.attemptNo >= 3) stat.attempt3 += 1;
      else stat.attemptUnknown += 1;
    }
  }
  return [...grouped.values()].sort((a, b) => `${a.reportDate}|${a.businessType}|${a.regionCode}`.localeCompare(`${b.reportDate}|${b.businessType}|${b.regionCode}`));
}
