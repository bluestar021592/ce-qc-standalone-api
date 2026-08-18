import { getDb } from './db.js';
import { collectV200Rows } from './v200EvidenceData.js';

export const V202_DELIVERY_TRUTH_VERSION = '2026-08-18-v202-real-delivery-cycle-and-order-to-pod-v2';
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const POD_RE = /\bPOD\b|DELIVERED|签收|妥投|已妥投|Successfully delivered|4004/i;
const RETURN_RE = /RETURN(?:ED|_COMPLETED)?|退回完成|已退回|退件完成|R退回|P4008/i;
const CANCEL_RE = /ORDER_CANCELLED|CANCELLED|CANCELED|订单取消|已取消|取消订单/i;
const PENDING_RE = /\bPENDING\b|Pending|150/i;
const DELIVERY_RE = /Parcel start to deliver|out\s*for\s*delivery|派送中|派件中|正在为您派送|正在派送|Deliver to Buyer|4003/i;

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; }
}
function billOf(value = '') { return String(value || '').trim().toUpperCase(); }
function keyOf(value = '') { return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, ''); }
function dateKey(value = '') {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
export function v202NaturalDays(from, to) {
  const a = dateKey(from), b = dateKey(to);
  if (!a || !b || b < a) return 0;
  const start = Date.parse(`${a}T00:00:00Z`), end = Date.parse(`${b}T00:00:00Z`);
  return Math.floor((end - start) / 86400000) + 1;
}
function chunks(values = [], size = 250) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
function rawEvent(row = {}) { return safeJson(row.rawJson, {}); }
function eventCode(row = {}) {
  const raw = rawEvent(row);
  return String(row.eventCode || row.shipmentStatus || raw.eventCode || raw.trackingEventCode || raw.statusCode || raw.shipmentStatus || raw.status || '').trim();
}
function eventTime(row = {}) {
  const raw = rawEvent(row);
  return String(row.eventTime || raw.eventTime || raw.creationDate || raw.lastUpdateDate || row.updatedAt || row.createdAt || '').trim();
}
function eventText(row = {}) {
  const raw = rawEvent(row);
  return [row.eventCode,row.shipmentStatus,row.statusText,raw.eventCode,raw.trackingEventCode,raw.statusCode,raw.shipmentStatus,raw.status,raw.statusText,raw.trackingEventDescZh,raw.trackingEventDesc,raw.trackingEventDescKm,raw.remark,raw.place]
    .map(value => String(value || '').trim()).filter(Boolean).join(' ');
}
function eventKind(row = {}) {
  const code = eventCode(row).toUpperCase();
  const text = eventText(row);
  if (code === '80' || code === '4004' || POD_RE.test(text)) return 'POD';
  if (code === '86' || code === 'P4008' || RETURN_RE.test(text)) return 'RETURN';
  if (code === '150' || PENDING_RE.test(text)) return 'FAIL';
  if (code === '70' || code === '4003' || DELIVERY_RE.test(text)) return 'START';
  return '';
}
function eventSortKey(event = {}) {
  const time = String(event.time || '');
  const priority = ({ START: '1', FAIL: '2', POD: '3', RETURN: '4' })[event.kind] || '9';
  return `${time.padEnd(30, '0')}|${priority}|${String(event.source || '')}`;
}
function normalizeSyntheticTime(date = '', suffix = '12:00:00') { return dateKey(date) ? `${dateKey(date)} ${suffix}` : ''; }

/**
 * Real attempt-cycle rule:
 * - A START (4003 / code70 / daily W/Y confirmed dispatch-state date) opens attempt 1.
 * - Repeated START scans while the same attempt is still open never create a new attempt.
 * - Pending/150 closes that attempt as failed; repeated Pending on the same day is one failure fact.
 * - Only a NEW START after a failed attempt opens attempt 2/3+.
 * - POD/4004/80 is attributed to the currently open attempt.
 * - Elapsed calendar days, code60 assignment and raw Pending count NEVER manufacture an attempt.
 */
export function resolveV202AttemptCycle(events = []) {
  const sorted = [...events].filter(event => event?.kind && event?.time).sort((a,b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  let attempt = 0;
  let open = false;
  let failed = false;
  let lastFailureDate = '';
  let podAttempt = 0;
  let podAt = '';
  const attemptStarts = [];
  const failureDates = [];
  const evidence = [];
  for (const event of sorted) {
    const d = dateKey(event.time);
    if (event.kind === 'START') {
      if (attempt === 0) {
        attempt = 1; open = true; failed = false; attemptStarts.push(event.time); evidence.push(`1派开始:${event.source}`);
      } else if (failed) {
        attempt = Math.min(3, attempt + 1); open = true; failed = false; attemptStarts.push(event.time); evidence.push(`${attempt >= 3 ? '3派+' : `${attempt}派`}开始:${event.source}`);
      }
      continue;
    }
    if (event.kind === 'FAIL') {
      if (!d || d === lastFailureDate) continue;
      lastFailureDate = d;
      failureDates.push(d);
      if (attempt > 0 && open) { open = false; failed = true; evidence.push(`派送失败:${event.source}`); }
      continue;
    }
    if (event.kind === 'POD') {
      podAt = event.time;
      if (attempt > 0 && open) podAttempt = attempt;
      evidence.push(`POD:${event.source}`);
      break;
    }
    if (event.kind === 'RETURN') break;
  }
  return {
    attemptNo: podAttempt,
    currentAttemptNo: attempt,
    attemptStarts,
    failureDates,
    podAt,
    source: podAttempt ? '真实派送周期（4003/70/日报W-Y派送状态→失败Pending→重新派送→POD）' : '派次证据不足，不强制归为1派',
    evidence
  };
}

function parseDailyRaw(rowJson = {}) {
  const parsed = safeJson(rowJson, {});
  const raw = parsed?.raw && typeof parsed.raw === 'object' ? parsed.raw : parsed;
  const map = new Map(Object.entries(raw || {}).map(([key, value]) => [keyOf(key), value]));
  const get = aliases => {
    for (const alias of aliases) {
      const value = map.get(keyOf(alias));
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  return { parsed, get };
}
function dailyDispatchEvidence(db, businessType, rows = []) {
  const byBill = new Map(rows.map(row => [billOf(row.shipmentCode), []]));
  const entries = new Map(rows.map(row => [billOf(row.shipmentCode), row]));
  const bills = [...byBill.keys()].filter(Boolean);
  for (const chunk of chunks(bills, 300)) {
    const marks = chunk.map(() => '?').join(','); if (!marks) continue;
    let sourceRows = [];
    try {
      sourceRows = db.prepare(`SELECT shipmentCode,reportDate,rowJson FROM unified_import_rows WHERE businessType=? AND shipmentCode IN (${marks}) ORDER BY shipmentCode,reportDate,rowNumber`).all(businessType, ...chunk);
    } catch {}
    for (const source of sourceRows) {
      const bill = billOf(source.shipmentCode), entry = entries.get(bill); if (!entry) continue;
      const d = dateKey(source.reportDate); if (!d || d < dateKey(entry.firstReportDate) || (dateKey(entry.podDate) && d > dateKey(entry.podDate))) continue;
      const { get } = parseDailyRaw(source.rowJson);
      const status = get(['状态标识','状态代码','status','statuscode']).toUpperCase();
      const desc = get(['状态说明','状态描述','statusdesc','statusdescription','statusname']);
      // W/Y are established JT dispatch-state evidence in this project's daily
      // report. Assignment-only text is deliberately excluded here; code60 never
      // becomes a delivery attempt by itself.
      if (status === 'W' || status === 'Y' || (DELIVERY_RE.test(desc) && !/assign|分配/i.test(desc))) {
        byBill.get(bill).push({ kind:'START', time:normalizeSyntheticTime(d,'12:00:00'), source:`日报${status || '派送中'}真实派送状态` });
      }
    }
  }
  return byBill;
}
function evidenceForBills(db, bills = []) {
  const map = new Map(bills.map(bill => [bill, []]));
  for (const chunk of chunks(bills)) {
    const marks = chunk.map(() => '?').join(','); if (!marks) continue;
    let tracks = [], shipment = [];
    try { tracks = db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,createdAt FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,createdAt,id`).all(...chunk); } catch {}
    try { shipment = db.prepare(`SELECT shipmentCode,shipmentStatus,statusText,rawJson,createdAt,updatedAt FROM business_shipment_tracks WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,createdAt,updatedAt`).all(...chunk); } catch {}
    for (const row of [...tracks, ...shipment]) {
      const bill = billOf(row.shipmentCode); if (!map.has(bill)) continue;
      const kind = eventKind(row), time = eventTime(row); if (!kind || !dateKey(time)) continue;
      map.get(bill).push({ kind, time, source: `CE轨迹${eventCode(row) || kind}`, raw: row });
    }
  }
  return map;
}
function finalRowEvidence(db, bills = []) {
  const map = new Map();
  for (const chunk of chunks(bills)) {
    const marks = chunk.map(() => '?').join(','); if (!marks) continue;
    let rows = [];
    try { rows = db.prepare(`SELECT shipmentCode,rawJson FROM business_final_rows WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY reportDate`).all(...chunk); } catch {}
    for (const row of rows) {
      const bill = billOf(row.shipmentCode), raw = safeJson(row.rawJson, {});
      if (!map.has(bill)) map.set(bill, []);
      const list = map.get(bill);
      const pendingDates = Array.isArray(raw.pendingDates) ? raw.pendingDates : String(raw.Pending全部日期 || raw.Pending日期 || '').split(/[、,|;\s]+/);
      for (const value of pendingDates) { const d = dateKey(value); if (d) list.push({ kind:'FAIL', time:normalizeSyntheticTime(d,'23:00:00'), source:'保存的Pending事实日' }); }
      const podTime = String(raw.POD时间 || raw.podTime || '');
      if (dateKey(podTime)) list.push({ kind:'POD', time:podTime, source:'保存的POD时间' });
    }
  }
  return map;
}
function isCancelled(row = {}) {
  const text = [row.currentState,row.scanNormalizedState,row.statusCode,row.statusDesc,row.exceptionDesc,row.remark,row.primaryCategory,row.主分类,row.异常分类,row.QC判断].map(v=>String(v||'')).join(' ');
  return String(row.orderStatus || '') === '10' || row.订单取消 === '是' || CANCEL_RE.test(text);
}
function normalizeTerminal(row = {}) {
  const cancelled = isCancelled(row);
  const returned = Boolean(row.returned) || RETURN_RE.test([row.statusDesc,row.currentState,row.primaryCategory,row.主分类,row.异常分类].join(' '));
  const pod = Boolean(row.pod);
  return {
    ...row,
    pod,
    returned: !pod && returned,
    cancelled: !pod && !returned && cancelled,
    terminalNormal: pod || returned || cancelled,
    openUnpod: !pod && !returned && !cancelled,
    pending: !pod && !returned && !cancelled && Boolean(row.pending),
    delivering: !pod && !returned && !cancelled && Boolean(row.delivering)
  };
}

export async function collectV202Rows(type, range, onProgress = () => {}) {
  const businessType = String(type || '').trim().toUpperCase();
  let rows = await collectV200Rows(businessType, range, onProgress);
  rows = rows.map(normalizeTerminal);
  if (!SHOPEE_TYPES.has(businessType) || !rows.length) {
    for (const row of rows) {
      row.deliveryDays = row.pod ? v202NaturalDays(row.orderTime, row.podTime || row.podDate) : 0;
      row.signNaturalDays = row.deliveryDays;
      row.signDaySource = row.deliveryDays ? '下单时间→真实POD时间（自然日，首尾计1天）' : '缺少下单时间或真实POD时间';
    }
    return rows;
  }
  const db = getDb();
  const bills = rows.map(row => billOf(row.shipmentCode)).filter(Boolean);
  const live = evidenceForBills(db, bills);
  const saved = finalRowEvidence(db, bills);
  const daily = dailyDispatchEvidence(db, businessType, rows);
  let classified = 0, unknown = 0, validDays = 0;
  for (const row of rows) {
    const bill = billOf(row.shipmentCode);
    const events = [...(live.get(bill) || []), ...(saved.get(bill) || []), ...(daily.get(bill) || [])];
    if (row.pod && dateKey(row.podTime || row.podDate)) events.push({ kind:'POD', time:row.podTime || normalizeSyntheticTime(row.podDate,'23:59:59'), source:row.podSource || 'POD事实' });
    const cycle = resolveV202AttemptCycle(events);
    row.attemptNo = row.pod ? cycle.attemptNo : 0;
    row.currentAttemptNo = cycle.currentAttemptNo;
    row.attemptSource = cycle.source;
    row.attemptEvidence = cycle.evidence.join('｜');
    row.attemptStartTimes = cycle.attemptStarts;
    row.failedAttemptDates = cycle.failureDates;
    row.trackAttemptNo = row.attemptNo;
    row.deliveryDays = row.pod ? v202NaturalDays(row.orderTime, row.podTime || row.podDate) : 0;
    row.signNaturalDays = row.deliveryDays;
    row.signDaySource = row.deliveryDays ? '下单时间→真实POD时间（自然日，首尾计1天）' : '缺少下单时间或真实POD时间';
    row.deliveryTruthVersion = V202_DELIVERY_TRUTH_VERSION;
    if (row.pod && row.attemptNo) classified += 1;
    else if (row.pod) unknown += 1;
    if (row.deliveryDays > 0) validDays += 1;
  }
  onProgress({ phase:'v202Truth', completed:rows.length, total:rows.length, classifiedAttempts:classified, attemptUnknown:unknown, validSignDays:validDays, version:V202_DELIVERY_TRUTH_VERSION });
  return rows;
}
