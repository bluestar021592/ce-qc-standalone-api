import { getDb } from './db.js';

export const V230_ATTEMPT_SIGNING_TRUTH_ID = '2026-08-22-v230-shopee-attempt-signing-truth-v1';
export const V232_ATTEMPT_CYCLE_TRUTH_ID = '2026-08-22-v232-shopee-real-delivery-cycle-v1';

const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const CYCLE_RE = /盘点|cycle\s*count/i;
const START_RE = /parcel\s*start\s*to\s*deliver|out\s*for\s*delivery|开始派送|派送中|正在派送|正在为您派送/i;
const ASSIGN_RE = /assigning\s*courier|delivery\s*assign|courier\s*assign|派件分配|分配快递员|分配派送|即将为您派送/i;
const FAILURE_RE = /\bpending\b|delivery\s*problem|delivery\s*fail|unsuccessful|派送异常|派送失败|派件异常|未妥投|拒收|\bOC\b/i;
const POD_RE = /\bPOD\b|delivered|successfully\s*delivered|签收|妥投|已妥投/i;

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
function timeKey(value = '') {
  const raw = text(value);
  const match = raw.match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]} ${match[4] || '00'}:${match[5] || '00'}:${match[6] || '00'}`;
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
function eventRaw(row = {}) { return safeJson(row.rawJson, {}); }
function eventCode(row = {}) {
  const raw = eventRaw(row);
  return text(row.eventCode || raw.eventCode || raw.statusCode);
}
function trackingCode(row = {}) {
  const raw = eventRaw(row);
  return text(row.trackingEventCode || raw.trackingEventCode);
}
function eventTime(row = {}) {
  const raw = eventRaw(row);
  return text(row.eventTime || raw.eventTime || raw.creationDate || raw.lastUpdateDate);
}
function eventText(row = {}) {
  const raw = eventRaw(row);
  return [row.trackingEventDescZh, row.trackingEventDesc, row.trackingEventDescKm,
    raw.trackingEventDescZh, raw.trackingEventDesc, raw.trackingEventDescKm,
    raw.statusText, raw.remark, raw.place, raw.eventShop]
    .map(text).filter(Boolean).join(' ');
}
function isRealStart(row = {}) {
  const code = eventCode(row);
  return code === '70' || START_RE.test(eventText(row));
}
function isAssign(row = {}) {
  const code = eventCode(row);
  return code === '60' || code === '30' || ASSIGN_RE.test(eventText(row));
}
function isFailure(row = {}) {
  const code = eventCode(row);
  return code === '150' || FAILURE_RE.test(eventText(row));
}
function isPodEvent(row = {}) {
  const code = eventCode(row);
  return code === '80' || code === '85' || POD_RE.test(eventText(row));
}
function chunks(values = [], size = 300) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}
function beforeOrOnPod(row, podDate = '') {
  const pod = dateKey(podDate);
  const d = dateKey(eventTime(row));
  return Boolean(d && (!pod || d <= pod));
}
function dedupeOrdered(events = [], podDate = '') {
  const seen = new Set();
  return events
    .filter(row => beforeOrOnPod(row, podDate) && !CYCLE_RE.test(eventText(row)))
    .sort((a, b) => timeKey(eventTime(a)).localeCompare(timeKey(eventTime(b))))
    .filter(row => {
      const signature = `${timeKey(eventTime(row))}|${eventCode(row)}|${trackingCode(row)}|${eventText(row)}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
}
function firstPodEvidence(events = []) {
  return [...events]
    .filter(isPodEvent)
    .filter(row => dateKey(eventTime(row)))
    .sort((a, b) => timeKey(eventTime(a)).localeCompare(timeKey(eventTime(b))))[0] || null;
}

export function resolveStrictShopeeAttempt({ pod = false, podDate = '', events = [], podAttemptNo = 0 } = {}) {
  if (!pod) return { attemptNo: 0, source: '', evidenceStarts: [], evidenceFailures: [] };
  const ordered = dedupeOrdered(events, podDate);
  const hasRealStart = ordered.some(isRealStart);
  const startPredicate = hasRealStart ? isRealStart : isAssign;
  const starts = [], failures = [];
  let attempt = 0;
  let active = false;
  let failedSinceStart = false;

  for (const event of ordered) {
    if (startPredicate(event)) {
      if (!active) {
        attempt = 1;
        active = true;
        starts.push(eventTime(event));
        failedSinceStart = false;
      } else if (failedSinceStart) {
        attempt = Math.min(3, attempt + 1);
        starts.push(eventTime(event));
        failedSinceStart = false;
      }
      continue;
    }
    if (active && isFailure(event)) {
      failedSinceStart = true;
      failures.push(eventTime(event));
    }
  }

  if (attempt > 0) {
    return {
      attemptNo: attempt,
      source: hasRealStart ? '真实派送循环：START→失败→新START' : '派件分配循环：ASSIGN→失败→新ASSIGN',
      evidenceStarts: starts,
      evidenceFailures: failures
    };
  }
  const explicit = Number(podAttemptNo || 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return { attemptNo: Math.min(3, Math.floor(explicit)), source: 'POD锁定明确派次', evidenceStarts: [], evidenceFailures: [] };
  }
  return { attemptNo: 0, source: '无真实派送循环证据', evidenceStarts: [], evidenceFailures: [] };
}

function evidenceRange(rows = []) {
  const dates = [];
  for (const row of rows) {
    for (const value of [row.firstReportDate, row.lastReportDate, row.podDate, row.podTime]) {
      const d = dateKey(value);
      if (d) dates.push(d);
    }
  }
  dates.sort();
  return { from: dates[0] || '2000-01-01', to: dates.at(-1) || '2099-12-31' };
}

function loadShopeeTrackEvidence(rows = []) {
  const db = getDb();
  const byBill = new Map(rows.map(row => [billOf(row), []]).filter(([bill]) => bill));
  const bills = [...byBill.keys()];
  const range = evidenceRange(rows);
  for (const chunk of chunks(bills)) {
    const marks = chunk.map(() => '?').join(',');
    let events = [];
    try {
      events = db.prepare(`
        SELECT shipmentCode,reportDate,eventTime,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,rawJson
        FROM business_track_events
        WHERE businessType='SHOPEE'
          AND reportDate BETWEEN ? AND ?
          AND shipmentCode IN (${marks})
        ORDER BY shipmentCode,eventTime,id
      `).all(range.from, range.to, ...chunk);
    } catch {
      try {
        events = db.prepare(`
          SELECT shipmentCode,reportDate,eventTime,eventCode,rawJson
          FROM business_track_events
          WHERE businessType='SHOPEE'
            AND reportDate BETWEEN ? AND ?
            AND shipmentCode IN (${marks})
          ORDER BY shipmentCode,eventTime,id
        `).all(range.from, range.to, ...chunk);
      } catch {
        continue;
      }
    }
    for (const event of events) {
      const target = byBill.get(billOf(event));
      if (target) target.push(event);
    }
  }
  return byBill;
}

export function applyV230AttemptSigningTruth(businessType, rows = []) {
  const type = text(businessType).toUpperCase();
  const trackEvidence = SHOPEE_TYPES.has(type) ? loadShopeeTrackEvidence(rows) : new Map();
  for (const row of rows) {
    const events = SHOPEE_TYPES.has(type) ? (trackEvidence.get(billOf(row)) || []) : [];
    let podDate = dateKey(row.podDate || row.POD时间 || row.podTime);
    if (row.pod && !podDate && events.length) {
      const podEvent = firstPodEvidence(events);
      const recoveredTime = podEvent ? eventTime(podEvent) : '';
      const recoveredDate = dateKey(recoveredTime);
      if (recoveredDate) {
        podDate = recoveredDate;
        row.podDate = recoveredDate;
        row.podTime = recoveredTime || recoveredDate;
        row.podSource = row.podSource || '已保存轨迹真实POD节点';
        row.podDateRecoveredFromTrack = true;
      }
    }
    row.signingDays = row.pod && podDate ? inclusiveNaturalDays(row.firstReportDate, podDate) : 0;
    row.signingDaysSource = row.signingDays > 0 ? '首次日报归属日期→实际POD日期（含首尾自然日）' : '';

    if (!SHOPEE_TYPES.has(type)) continue;
    const strict = resolveStrictShopeeAttempt({
      pod: Boolean(row.pod),
      podDate,
      events,
      podAttemptNo: Math.max(Number(row.podAttemptNo || 0), Number(row.currentAttemptNo || 0), Number(row.attemptNo || 0))
    });
    row.attemptNo = strict.attemptNo;
    row.attemptSource = strict.source;
    row.attemptEvidenceStarts = strict.evidenceStarts;
    row.attemptEvidenceFailures = strict.evidenceFailures;
    row.trackAttemptNo = strict.attemptNo;

    const ordered = dedupeOrdered(events, podDate);
    const firstRealStart = ordered.find(isRealStart) || ordered.find(isAssign) || null;
    row.firstDispatchDate = firstRealStart ? dateKey(eventTime(firstRealStart)) : '';
    row.realDispatchToPodDays = row.pod && row.firstDispatchDate && podDate ? inclusiveNaturalDays(row.firstDispatchDate, podDate) : 0;
    row.realDispatchToPodDaysSource = row.realDispatchToPodDays > 0 ? '首次真实派送/分配节点→实际POD日期（诊断值）' : '';
    row.deliveryDays = row.signingDays;
    row.deliveryDaysSource = row.signingDaysSource;
  }
  return rows;
}
