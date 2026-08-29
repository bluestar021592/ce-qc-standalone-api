export function average(values = []) {
  const usable = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  return usable.length ? Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2)) : 0;
}
export function ratio(a, b) { return b ? Number(a || 0) / Number(b) : 0; }
export function completeAttemptPublication(stat = {}, {
  podKey = 'pod', a1Key = 'a1', a2Key = 'a2', a3Key = 'a3', unknownKey = 'attemptUnknown'
} = {}) {
  const pod = Math.max(0, Number(stat[podKey] || 0));
  const a1 = Math.max(0, Number(stat[a1Key] || 0));
  const a2 = Math.max(0, Number(stat[a2Key] || 0));
  const a3 = Math.max(0, Number(stat[a3Key] || 0));
  const unknown = Math.max(0, Number(stat[unknownKey] || 0), pod - a1 - a2 - a3);
  return { pod, a1, a2, a3, unknown, complete: pod === 0 || (unknown === 0 && a1 + a2 + a3 === pod) };
}
export function completeAttemptRatio(stat = {}, numerator = 0, options = {}) {
  const publication = completeAttemptPublication(stat, options);
  if (!publication.pod || !publication.complete) return null;
  return ratio(numerator, publication.pod);
}
export function completeAttemptCount(stat = {}, numerator = 0, options = {}) {
  const publication = completeAttemptPublication(stat, options);
  if (publication.pod > 0 && !publication.complete) return null;
  return Number(numerator || 0);
}
// Exact workbook publication requires a real signing-day sample for every completed POD ticket.
// For TBKH/SHOPEE CN/VN those samples come from the same real dispatch START -> POD truth as 1/2/3派.
export function completeSigningAverage(values = [], pod = 0) {
  const expected = Math.max(0, Number(pod || 0));
  const usable = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  if (!expected) return null;
  if (usable.length !== expected) return null;
  return average(usable);
}
function dateKey(value = '') { const m = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; }
function dayNumber(value = '') { const k = dateKey(value); if (!k) return null; const [y,m,d] = k.split('-').map(Number); return Date.UTC(y,m-1,d); }
export function referenceAverageDays(firstReportDate,podDate){const a=dayNumber(firstReportDate),b=dayNumber(podDate);return a===null||b===null||b<a?0:Math.floor((b-a)/86400000)+1;}
const STRICT_SIGNING_TYPES = new Set(['TBKH','SHOPEECN','SHOPEEVN']);
function signingDaysForMetric(row = {}) {
  const type = String(row.businessType || '').trim().toUpperCase();
  if (STRICT_SIGNING_TYPES.has(type)) {
    const days = Number(row.signingDays || row.deliveryDays || 0);
    return Number.isFinite(days) && days > 0 ? days : 0;
  }
  return referenceAverageDays(row.firstReportDate || row.lifecycleFirstReportDate, row.podDate || row.podTime);
}
function emptyStat(date = '') {
  return {
    date, total: 0, pp: 0, pv: 0, unknown: 0, store: 0, pod: 0, notPod: 0, delivery: 0, pending: 0, returned: 0,
    a1: 0, a2: 0, a3: 0, attemptUnknown: 0, days: [],
    ppDays: [], pvDays: [], ppPod: 0, pvPod: 0,
    ppA1: 0, ppA2: 0, ppA3: 0, ppAttemptUnknown: 0,
    pvA1: 0, pvA2: 0, pvA3: 0, pvAttemptUnknown: 0
  };
}
function applyStat(stat, row) {
  stat.total++;
  if (row.area === '金边') stat.pp++; else if (row.area === '外省') stat.pv++; else stat.unknown++;
  if (row.store) stat.store++;
  if (row.pod) {
    stat.pod++;
    if (row.attemptNo === 1) stat.a1++; else if (row.attemptNo === 2) stat.a2++; else if (row.attemptNo >= 3) stat.a3++; else stat.attemptUnknown++;
    const signingDays = signingDaysForMetric(row);
    if (signingDays > 0) stat.days.push(signingDays);
    if (row.area === '金边') {
      stat.ppPod++;
      if (row.attemptNo === 1) stat.ppA1++; else if (row.attemptNo === 2) stat.ppA2++; else if (row.attemptNo >= 3) stat.ppA3++; else stat.ppAttemptUnknown++;
      if (signingDays > 0) stat.ppDays.push(signingDays);
    } else if (row.area === '外省') {
      stat.pvPod++;
      if (row.attemptNo === 1) stat.pvA1++; else if (row.attemptNo === 2) stat.pvA2++; else if (row.attemptNo >= 3) stat.pvA3++; else stat.pvAttemptUnknown++;
      if (signingDays > 0) stat.pvDays.push(signingDays);
    }
  } else if (!row.returned) stat.notPod++;
  if (!row.returned && row.delivering) stat.delivery++;
  if (!row.returned && row.pending) stat.pending++;
  if (row.returned) stat.returned++;
}
function membershipDatesForRow(row, range) {
  const from = dateKey(range?.from), to = dateKey(range?.to);
  const exact = [...new Set((Array.isArray(row?.dailyMembershipDates) ? row.dailyMembershipDates : []).map(dateKey).filter(Boolean))]
    .filter(date => (!from || date >= from) && (!to || date <= to)).sort();
  if (exact.length) return exact;
  const legacy = dateKey(row?.firstReportDate);
  return legacy && (!from || legacy >= from) && (!to || legacy <= to) ? [legacy] : [];
}
export function statsOf(rows, range) {
  const dailyMap = new Map();
  const overall = emptyStat(`${range.from} 至 ${range.to}`);
  for (const row of rows) {
    const membershipDates = membershipDatesForRow(row, range);
    for (const date of membershipDates) {
      if (!dailyMap.has(date)) dailyMap.set(date, emptyStat(date));
      applyStat(dailyMap.get(date), row);
    }
    applyStat(overall, row);
  }
  return { daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)), overall };
}
export function bucketRows(rows) {
  const filter = fn => rows.filter(fn);
  return {
    '全部明细': rows,
    '金边明细': filter(row => row.area === '金边'),
    '外省明细': filter(row => row.area === '外省'),
    '门店明细': filter(row => row.store),
    'POD明细': filter(row => row.pod),
    '未POD明细': filter(row => !row.pod && !row.returned),
    '分配派送中明细': filter(row => !row.returned && row.delivering),
    'Pending明细': filter(row => !row.returned && row.pending),
    '退回明细': filter(row => row.returned && !row.pod)
  };
}
export function anchorMaps(bucket) {
  const result = {};
  for (const [name, rows] of Object.entries(bucket)) {
    const map = new Map();
    for (let index = 0; index < rows.length; index++) {
      const dates = [...new Set((Array.isArray(rows[index]?.dailyMembershipDates) ? rows[index].dailyMembershipDates : [rows[index]?.firstReportDate]).map(dateKey).filter(Boolean))];
      for (const date of dates) if (!map.has(date)) map.set(date, index + 2);
    }
    result[name] = map;
  }
  return result;
}
export function anchor(anchors, sheet, date) { return anchors[sheet]?.get(date) || 2; }