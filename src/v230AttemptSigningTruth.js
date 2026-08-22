import { getDb } from './db.js';

export const V230_ATTEMPT_SIGNING_TRUTH_ID = '2026-08-22-v230-shopee-attempt-signing-truth-v1';

const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const CYCLE_RE = /盘点|cycle\s*count/i;

function text(value) { return String(value ?? '').trim(); }
function billOf(row = {}) { return text(row.shipmentCode || row.运单号 || row.waybill).toUpperCase(); }
function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; }
}
function dateKey(value = '') {
  const match = text(value).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
function dayNumber(value = '') {
  const key = dateKey(value);
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function inclusiveNaturalDays(from, to) {
  const a = dayNumber(from), b = dayNumber(to);
  if (a === null || b === null || b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}
function eventCode(row = {}) {
  const raw = safeJson(row.rawJson, {});
  return text(row.eventCode || raw.eventCode || raw.trackingEventCode || raw.statusCode);
}
function eventTime(row = {}) {
  const raw = safeJson(row.rawJson, {});
  return text(row.eventTime || raw.eventTime || raw.creationDate || raw.lastUpdateDate);
}
function eventText(row = {}) {
  const raw = safeJson(row.rawJson, {});
  return [raw.trackingEventDescZh, raw.trackingEventDesc, raw.trackingEventDescKm, raw.statusText, raw.remark, raw.place, raw.eventShop]
    .map(text).filter(Boolean).join(' ');
}
function chunks(values = [], size = 300) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}
function validAttemptDates(values = [], podDate = '') {
  const pod = dateKey(podDate);
  return [...new Set(values.map(dateKey).filter(Boolean))].filter(date => !pod || date <= pod).sort();
}
export function resolveStrictShopeeAttempt({ pod = false, podDate = '', code70Dates = [], code60Dates = [], podAttemptNo = 0 } = {}) {
  if (!pod) return { attemptNo: 0, source: '', evidenceDates: [] };
  const delivery = validAttemptDates(code70Dates, podDate);
  if (delivery.length) return { attemptNo: Math.min(3, delivery.length), source: '轨迹70不同派送日期', evidenceDates: delivery };
  const assign = validAttemptDates(code60Dates, podDate);
  if (assign.length) return { attemptNo: Math.min(3, assign.length), source: '轨迹60不同分配日期', evidenceDates: assign };
  const explicit = Number(podAttemptNo || 0);
  if (Number.isFinite(explicit) && explicit > 0) return { attemptNo: Math.min(3, Math.floor(explicit)), source: 'POD锁定明确派次', evidenceDates: [] };
  return { attemptNo: 0, source: '无真实派次证据', evidenceDates: [] };
}

function loadShopeeTrackEvidence(rows = []) {
  const db = getDb();
  const byBill = new Map(rows.map(row => [billOf(row), { code70: [], code60: [] }]).filter(([bill]) => bill));
  const bills = [...byBill.keys()];
  for (const chunk of chunks(bills)) {
    const marks = chunk.map(() => '?').join(',');
    let events = [];
    try {
      events = db.prepare(`
        SELECT shipmentCode,eventTime,eventCode,rawJson
        FROM business_track_events
        WHERE shipmentCode IN (${marks})
        ORDER BY shipmentCode,eventTime,id
      `).all(...chunk);
    } catch {
      continue;
    }
    for (const event of events) {
      const evidence = byBill.get(billOf(event));
      if (!evidence) continue;
      const code = eventCode(event);
      const time = eventTime(event);
      const date = dateKey(time);
      if (!date || CYCLE_RE.test(eventText(event))) continue;
      if (code === '70') evidence.code70.push(date);
      else if (code === '60') evidence.code60.push(date);
    }
  }
  return byBill;
}

export function applyV230AttemptSigningTruth(businessType, rows = []) {
  const type = text(businessType).toUpperCase();
  const trackEvidence = SHOPEE_TYPES.has(type) ? loadShopeeTrackEvidence(rows) : new Map();
  for (const row of rows) {
    const podDate = dateKey(row.podDate || row.POD时间 || row.podTime);
    row.signingDays = row.pod && podDate ? inclusiveNaturalDays(row.firstReportDate, podDate) : 0;
    row.signingDaysSource = row.signingDays > 0 ? '首次日报归属日期→实际POD日期（含首尾自然日）' : '';

    if (!SHOPEE_TYPES.has(type)) continue;
    const evidence = trackEvidence.get(billOf(row)) || { code70: [], code60: [] };
    const strict = resolveStrictShopeeAttempt({
      pod: Boolean(row.pod),
      podDate,
      code70Dates: evidence.code70,
      code60Dates: evidence.code60,
      podAttemptNo: row.podAttemptNo
    });
    row.attemptNo = strict.attemptNo;
    row.attemptSource = strict.source;
    row.attemptEvidenceDates = strict.evidenceDates;
    row.trackAttemptNo = strict.attemptNo;
    row.track70Dates = validAttemptDates(evidence.code70, podDate);
    row.track60Dates = validAttemptDates(evidence.code60, podDate);
    row.firstDispatchDate = row.track70Dates[0] || row.track60Dates[0] || '';
    row.deliveryDays = row.pod && row.firstDispatchDate && podDate ? inclusiveNaturalDays(row.firstDispatchDate, podDate) : 0;
    row.deliveryDaysSource = row.deliveryDays > 0 ? '首次真实轨迹70/60日期→实际POD日期（含首尾自然日）' : '无真实派送日期，不计算派送天数';
  }
  return rows;
}
