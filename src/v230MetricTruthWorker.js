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
  return { date, total:0, pod:0, returned:0, pending:0, delivering:0, activeNotPod:0, attemptPodBase:0, a1:0, a2:0, a3:0, attemptUnknown:0, signingDays:[], deliveryDays:[] };
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
    averageDeliveryDays: average(stat.deliveryDays)
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
    version: '2026-08-22-v230-daily-metric-truth-v1',
    businessType: requested,
    from,
    to,
    formula: {
      attempt: 'SHOPEE仅使用轨迹70不同日期；无70时使用轨迹60不同日期；POD锁定明确派次仅作最后兜底；不使用日报W/Y或经过天数猜派次。',
      attemptRate: '1/2/3派占比 = 对应派次POD件数 ÷ 当日SHOPEE已POD件数。',
      signingDays: '签收自然天数 = 首次日报归属日期→实际POD日期，含首尾自然日；当日平均仅统计已POD且日期有效的票。',
      deliveryDays: '派送天数 = 首次真实轨迹70/60日期→实际POD日期，含首尾自然日；无真实派送节点则留空/不参与平均。',
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
