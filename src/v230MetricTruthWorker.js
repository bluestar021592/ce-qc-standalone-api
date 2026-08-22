import { collectV200Rows } from './v225ExportReturnTruth.js';

const TYPES = ['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

function n(value) { const x = Number(value); return Number.isFinite(x) ? x : 0; }
function pct(a, b) { return b ? Number((n(a) * 100 / n(b)).toFixed(2)) : 0; }
function average(values = []) {
  const usable = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  return usable.length ? Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2)) : 0;
}
function dateKey(value = '') {
  const m = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function empty(date) {
  return { date, total:0, pod:0, returned:0, pending:0, delivering:0, activeNotPod:0, attemptPodBase:0, a1:0, a2:0, a3:0, attemptUnknown:0, signingDays:[], deliveryDays:[], dispatchToPodDays:[] };
}
function apply(stat, row) {
  stat.total += 1;
  if (row.pod) {
    stat.pod += 1;
    const sourceType = String(row.__metricBusinessType || row.businessType || '').toUpperCase();
    if (SHOPEE_TYPES.has(sourceType)) {
      stat.attemptPodBase += 1;
      const attempt = Number(row.attemptNo || 0);
      if (attempt === 1) stat.a1 += 1;
      else if (attempt === 2) stat.a2 += 1;
      else if (attempt >= 3) stat.a3 += 1;
      else stat.attemptUnknown += 1;
    }
    if (Number(row.signingDays || 0) > 0) stat.signingDays.push(Number(row.signingDays));
    if (Number(row.deliveryDays || 0) > 0) stat.deliveryDays.push(Number(row.deliveryDays));
    if (Number(row.realDispatchToPodDays || 0) > 0) stat.dispatchToPodDays.push(Number(row.realDispatchToPodDays));
  } else if (row.returned) {
    stat.returned += 1;
  } else {
    stat.activeNotPod += 1;
    if (row.pending) stat.pending += 1;
    if (row.delivering) stat.delivering += 1;
  }
}
function finish(stat) {
  const attemptBase = stat.attemptPodBase;
  return {
    date: stat.date,
    total: stat.total,
    pod: stat.pod,
    podRate: pct(stat.pod, stat.total),
    returned: stat.returned,
    returnRate: pct(stat.returned, stat.total),
    pending: stat.pending,
    pendingRate: pct(stat.pending, stat.total),
    delivering: stat.delivering,
    deliveringRate: pct(stat.delivering, stat.total),
    activeNotPod: stat.activeNotPod,
    activeNotPodRate: pct(stat.activeNotPod, stat.total),
    attempt1Count: stat.a1,
    attempt2Count: stat.a2,
    attempt3Count: stat.a3,
    attemptUnknownPod: stat.attemptUnknown,
    attemptDenominator: attemptBase,
    attempt1Rate: pct(stat.a1, attemptBase),
    attempt2Rate: pct(stat.a2, attemptBase),
    attempt3Rate: pct(stat.a3, attemptBase),
    firstAttemptPodRateOfTotal: pct(stat.a1, stat.total),
    averageSigningDays: average(stat.signingDays),
    averageDeliveryDays: average(stat.deliveryDays),
    averageRealDispatchToPodDays: average(stat.dispatchToPodDays)
  };
}
function summarizeRows(rows = []) {
  const daily = new Map();
  const overall = empty('区间汇总');
  for (const row of rows) {
    const date = dateKey(row.firstReportDate);
    if (!date) continue;
    if (!daily.has(date)) daily.set(date, empty(date));
    apply(daily.get(date), row);
    apply(overall, row);
  }
  return { daily: [...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(finish), overall: finish(overall) };
}

async function run(input = {}) {
  const from = dateKey(input.from);
  const to = dateKey(input.to);
  const requested = String(input.businessType || '').trim().toUpperCase();
  if (!from || !to || from > to) throw new Error('日期范围无效');
  const types = requested === 'ALL' ? TYPES : [requested];
  if (!types.every(type => TYPES.includes(type))) throw new Error(`业务板块无效：${requested}`);
  const allRows = [];
  const business = {};
  for (const type of types) {
    const rows = await collectV200Rows(type, { from, to }, () => {});
    const taggedRows = rows.map(row => ({ ...row, __metricBusinessType: type }));
    const summary = summarizeRows(taggedRows);
    business[type] = summary;
    allRows.push(...taggedRows);
  }
  const aggregate = requested === 'ALL' ? summarizeRows(allRows) : business[requested];
  return {
    ok: true,
    version: '2026-08-22-v232-daily-metric-truth-v2',
    businessType: requested,
    from,
    to,
    formula: {
      attempt: 'SHOPEE按真实派送循环识别：首次START=1派；只有出现失败/Pending后再次START才增加一派；重复START本身不增加派次。没有START时才使用ASSIGN→失败→新ASSIGN兜底；无真实循环再使用明确POD锁定派次。',
      attemptRate: '1/2/3派占比 = 对应派次POD件数 ÷ 当日SHOPEE已POD件数；无证据POD单独列为派次未识别。',
      signingDays: '平均签收天数 = 首次日报归属日期→实际POD日期，含首尾自然日；同日POD=1天。',
      deliveryDays: '看板/报表派送天数沿用日报批次签收时效口径：首次日报归属日期→实际POD日期；不得拿自然天数反推1/2/3派。',
      realDispatchToPodDays: '另保留诊断值：首次真实START/ASSIGN日期→实际POD日期，用于判断真实派送后到签收用了几天，不与日报批次签收时效混算。',
      dailyRates: 'POD/退回/Pending/派送中百分比 = 当日对应件数 ÷ 当日总票数。'
    },
    daily: aggregate.daily,
    overall: aggregate.overall,
    business
  };
}

process.on('message', async message => {
  try {
    const payload = await run(message || {});
    process.send?.({ ok:true, payload });
  } catch (error) {
    process.send?.({ ok:false, error:error?.stack || error?.message || String(error) });
  } finally {
    setTimeout(() => process.exit(0), 10).unref?.();
  }
});
