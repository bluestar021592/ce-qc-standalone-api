export function average(values = []) {
  const usable = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  return usable.length ? Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2)) : 0;
}
export function ratio(a, b) { return b ? Number(a || 0) / Number(b) : 0; }
function dateKey(value = '') { const m = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; }
function dayNumber(value = '') { const k = dateKey(value); if (!k) return null; const [y,m,d] = k.split('-').map(Number); return Date.UTC(y,m-1,d); }
function listDates(from,to){ const a=dayNumber(from),b=dayNumber(to),out=[]; if(a===null||b===null||b<a)return out; for(let t=a;t<=b;t+=86400000)out.push(new Date(t).toISOString().slice(0,10)); return out; }
export function referenceAverageDays(orderDate,podDate){const a=dayNumber(orderDate),b=dayNumber(podDate);return a===null||b===null||b<a?0:Math.floor((b-a)/86400000)+1;}
function isTerminalNormal(row = {}) { return Boolean(row.pod || row.returned || row.cancelled || row.terminalNormal); }
function openUnpod(row = {}) { return !isTerminalNormal(row); }
function isShopeePrecisionRow(row = {}) {
  const type = String(row.businessType || '').trim().toUpperCase();
  return type === 'SHOPEECN' || type === 'SHOPEEVN' || Boolean(row.timingEvidenceStatus) || /shopee-3001-pod/i.test(String(row.precisionTruthVersion || row.deliveryTruthVersion || ''));
}
function signingDays(row = {}) {
  const direct = Number(row.signNaturalDays || row.deliveryDays || 0);
  if (isShopeePrecisionRow(row)) {
    // V209 hard rule: Shopee末端时效只能来自已经闭合的3001→真实POD证据。
    // 缺3001/缺POD/时间倒序时保持0并退出，绝不再回退到下单日期→POD。
    if (String(row.timingEvidenceStatus || '').toUpperCase() !== 'OK') return 0;
    return Number.isFinite(direct) && direct > 0 ? direct : 0;
  }
  if (Number.isFinite(direct) && direct > 0) return direct;
  return referenceAverageDays(row.orderTime, row.podTime || row.podDate);
}
function emptyStat(date = '') {
  return { date, total: 0, evidenceOnly: 0, pp: 0, pv: 0, unknown: 0, store: 0, pod: 0, notPod: 0, delivery: 0, pending: 0, returned: 0, cancelled: 0, terminal: 0, a1: 0, a2: 0, a3: 0, attemptUnknown: 0, days: [], ppDays: [], pvDays: [], ppPod: 0, pvPod: 0, ppA1: 0, ppA2: 0, ppA3: 0, pvA1: 0, pvA2: 0, pvA3: 0 };
}
function applyStat(stat, row) {
  // Manual-query / track-evidence rows must be present in exported detail and
  // tracking views, but they were not members of that official daily report. They
  // therefore cannot change the official daily KPI denominator retroactively.
  if (row.metricEligible === false) { stat.evidenceOnly++; return; }
  stat.total++;
  if (row.area === '金边') stat.pp++; else if (row.area === '外省') stat.pv++; else stat.unknown++;
  if (row.store) stat.store++;
  if (row.pod) {
    stat.pod++; stat.terminal++;
    if (row.attemptNo === 1) stat.a1++; else if (row.attemptNo === 2) stat.a2++; else if (row.attemptNo >= 3) stat.a3++; else stat.attemptUnknown++;
    const days=signingDays(row);
    if (days > 0) stat.days.push(days);
    if (row.area === '金边') {
      stat.ppPod++;
      if (row.attemptNo === 1) stat.ppA1++; else if (row.attemptNo === 2) stat.ppA2++; else if (row.attemptNo >= 3) stat.ppA3++;
      if (days > 0) stat.ppDays.push(days);
    } else if (row.area === '外省') {
      stat.pvPod++;
      if (row.attemptNo === 1) stat.pvA1++; else if (row.attemptNo === 2) stat.pvA2++; else if (row.attemptNo >= 3) stat.pvA3++;
      if (days > 0) stat.pvDays.push(days);
    }
  } else if (row.returned) { stat.returned++; stat.terminal++; }
  else if (row.cancelled) { stat.cancelled++; stat.terminal++; }
  else stat.notPod++;
  if (openUnpod(row) && row.delivering) stat.delivery++;
  if (openUnpod(row) && row.pending) stat.pending++;
}
export function statsOf(rows, range) {
  const dailyMap = new Map(listDates(range.from, range.to).map(date => [date, emptyStat(date)]));
  const overall = emptyStat(`${range.from} 至 ${range.to}`);
  for (const row of rows) {
    if (!dailyMap.has(row.firstReportDate)) dailyMap.set(row.firstReportDate, emptyStat(row.firstReportDate));
    applyStat(dailyMap.get(row.firstReportDate), row);
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
    '门店明细': filter(row => row.store && openUnpod(row)),
    'POD明细': filter(row => row.pod),
    '未POD明细': filter(openUnpod),
    '分配派送中明细': filter(row => openUnpod(row) && row.delivering),
    'Pending明细': filter(row => openUnpod(row) && row.pending),
    '退回明细': filter(row => row.returned)
  };
}
export function anchorMaps(bucket) {
  const result = {};
  for (const [name, rows] of Object.entries(bucket)) {
    const map = new Map();
    for (let index = 0; index < rows.length; index++) if (!map.has(rows[index].firstReportDate)) map.set(rows[index].firstReportDate, index + 2);
    result[name] = map;
  }
  return result;
}
export function anchor(anchors, sheet, date) { return anchors[sheet]?.get(date) || 2; }
