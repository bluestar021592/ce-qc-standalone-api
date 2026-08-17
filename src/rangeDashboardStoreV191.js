import { loadRangeDashboard as loadBaseRangeDashboard } from './rangeDashboardStoreV55Compact.js';
import { queryShopeeAttemptFacts, V191_SHOPEE_TRUTH_VERSION } from './v191ShopeeTruth.js';

const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);

function sum(rows = [], key = '') { return rows.reduce((n, row) => n + Number(row?.[key] || 0), 0); }
function pct(value, total) { return total ? Number((Number(value || 0) * 100 / Number(total)).toFixed(2)) : 0; }
function summarize(rows = []) {
  const total = sum(rows, 'total');
  const pod = sum(rows, 'pod');
  const attempt1 = sum(rows, 'attempt1');
  const attempt2 = sum(rows, 'attempt2');
  const attempt3 = sum(rows, 'attempt3');
  const attemptUnknown = sum(rows, 'attemptUnknown');
  const returned = sum(rows, 'returned');
  const cancelled = sum(rows, 'cancelled');
  const pending = sum(rows, 'pending');
  const delivering = sum(rows, 'delivering');
  const evidenceCount = sum(rows, 'evidenceCount');
  return {
    total, pod, returned, cancelled, pending, delivering, evidenceCount,
    unresolved: Math.max(0, total - pod - returned - cancelled),
    attempt1, attempt2, attempt3, attemptUnknown,
    podRate: pct(pod, total),
    firstAttemptRate: pct(attempt1, total),
    attempt1Share: pct(attempt1, pod),
    attempt2Share: pct(attempt2, pod),
    attempt3Share: pct(attempt3, pod),
    attemptUnknownShare: pct(attemptUnknown, pod),
    evidenceCoverage: pct(evidenceCount, total),
    hasSource: total > 0,
    hasAttemptEvidence: pod === 0 ? evidenceCount > 0 : (attempt1 + attempt2 + attempt3 + attemptUnknown) > 0
  };
}
function patchMetrics(metrics, s) {
  if (!metrics || !s) return;
  Object.assign(metrics, {
    total: s.total,
    pod: s.pod,
    podRate: s.podRate,
    unresolved: s.unresolved,
    returned: s.returned,
    pending: s.pending,
    delivering: s.delivering,
    cancelled: s.cancelled,
    dispatchAttempt1: s.attempt1,
    dispatchAttempt2: s.attempt2,
    dispatchAttempt3: s.attempt3,
    dispatchAttemptUnclassifiedPod: s.attemptUnknown,
    dispatchAttemptDenominator: s.total,
    dispatchAttempt1Rate: s.attempt1Share,
    dispatchAttempt2Rate: s.attempt2Share,
    dispatchAttempt3Rate: s.attempt3Share,
    firstAttemptCount: s.attempt1,
    firstAttemptEligible: s.total,
    firstAttemptRate: s.firstAttemptRate,
    attemptEvidenceCoverage: s.evidenceCoverage,
    attemptEvidenceStatus: !s.hasSource ? 'NO_SOURCE' : s.evidenceCoverage >= 99.999 ? 'COMPLETE' : s.evidenceCoverage > 0 ? 'PARTIAL' : 'PENDING'
  });
}
function patchDashboardCore(dashboard, s) {
  if (!dashboard) return;
  dashboard.sourceTotal = Math.max(Number(dashboard.sourceTotal || 0), s.total);
  dashboard.totalMonitored = s.total;
  dashboard.todayPod = s.pod;
  dashboard.podRate = s.podRate;
  dashboard.analysisPending = Math.max(Number(dashboard.analysisPending || 0), s.total - s.evidenceCount);
  dashboard.v191Truth = { ...s, engine: V191_SHOPEE_TRUTH_VERSION };
  patchMetrics(dashboard.metrics, s);
}
function patchGroup(group, rows) {
  if (!group) return;
  const all = summarize(rows);
  patchMetrics(group.metrics, all);
  for (const region of ['PP', 'PV', 'UNKNOWN']) patchMetrics(group.regions?.[region], summarize(rows.filter(row => row.regionCode === region)));
}
function ensureHistory(state, rows, groupType = '') {
  if (!state) return;
  const relevant = groupType ? rows.filter(row => row.businessType === groupType) : rows;
  const dates = [...new Set(relevant.map(row => row.reportDate).filter(Boolean))].sort();
  if (!Array.isArray(state.historySummary)) state.historySummary = [];
  const byDate = new Map(state.historySummary.map(item => [String(item?.reportDate || item?.summary?.reportDate || ''), item]));
  for (const date of dates) {
    if (!byDate.has(date)) {
      const item = { reportDate: date, summary: { reportDate: date, metrics: {} } };
      state.historySummary.push(item); byDate.set(date, item);
    }
    const item = byDate.get(date);
    item.summary ||= { reportDate: date, metrics: {} };
    item.summary.metrics ||= {};
    const dayRows = relevant.filter(row => row.reportDate === date);
    const s = summarize(dayRows);
    const cn = summarize(rows.filter(row => row.reportDate === date && row.businessType === 'SHOPEECN'));
    const vn = summarize(rows.filter(row => row.reportDate === date && row.businessType === 'SHOPEEVN'));
    item.summary.today = s.total;
    item.summary.todayPod = s.pod;
    item.summary.podRate = s.podRate;
    item.summary.firstPodRate = s.firstAttemptRate;
    item.summary.attemptEvidenceCoverage = s.evidenceCoverage;
    item.summary.metrics['ALL_首派成功率'] = summarize(rows.filter(row => row.reportDate === date)).firstAttemptRate;
    item.summary.metrics['CN_首派成功率'] = cn.firstAttemptRate;
    item.summary.metrics['VN_首派成功率'] = vn.firstAttemptRate;
    item.summary.metrics['ALL_1派签收件数'] = summarize(rows.filter(row => row.reportDate === date)).attempt1;
    item.summary.metrics['ALL_2派签收件数'] = summarize(rows.filter(row => row.reportDate === date)).attempt2;
    item.summary.metrics['ALL_3派签收件数'] = summarize(rows.filter(row => row.reportDate === date)).attempt3;
    item.summary.metrics['ALL_派次未识别'] = summarize(rows.filter(row => row.reportDate === date)).attemptUnknown;
  }
  state.historySummary.sort((a, b) => String(a.reportDate || '').localeCompare(String(b.reportDate || '')));
}
function patchTrends(dashboard, rows) {
  if (!dashboard) return;
  dashboard.recipientTrends ||= {};
  for (const [group, type] of [['CN', 'SHOPEECN'], ['VN', 'SHOPEEVN']]) {
    dashboard.recipientTrends[group] ||= {};
    const dates = [...new Set(rows.filter(row => row.businessType === type).map(row => row.reportDate))].sort();
    const points = dates.map(date => {
      const s = summarize(rows.filter(row => row.businessType === type && row.reportDate === date));
      return {
        date,
        value: s.evidenceCount > 0 ? s.firstAttemptRate : null,
        hasData: s.evidenceCount > 0,
        status: s.evidenceCount === 0 ? 'pending' : s.firstAttemptRate >= 90 ? 'normal' : 'warning',
        attempt1: s.attempt1,
        attempt2: s.attempt2,
        attempt3: s.attempt3,
        unknown: s.attemptUnknown,
        pod: s.pod,
        total: s.total,
        coverage: s.evidenceCoverage
      };
    });
    dashboard.recipientTrends[group].firstAttemptRate = points;
    dashboard.recipientTrends[group].dispatchAttempts = points;
  }
}
function patchState(state, rows, type = '') {
  if (!state?.dashboard) return;
  const scoped = type && SHOPEE_TYPES.has(type) ? rows.filter(row => row.businessType === type) : rows;
  const all = summarize(scoped);
  patchDashboardCore(state.dashboard, all);
  patchMetrics(state.v55Summary, all);
  patchMetrics(state.dashboard.v55Summary, all);
  const groups = state.dashboard.recipientGroups || {};
  patchGroup(groups.ALL, scoped);
  patchGroup(groups.CN, scoped.filter(row => row.businessType === 'SHOPEECN'));
  patchGroup(groups.VN, scoped.filter(row => row.businessType === 'SHOPEEVN'));
  for (const region of ['PP', 'PV', 'UNKNOWN']) patchMetrics(state.dashboard.regions?.[region], summarize(scoped.filter(row => row.regionCode === region)));
  ensureHistory(state, scoped, type);
  patchTrends(state.dashboard, scoped);
}

export function loadRangeDashboard(fromDate, toDate) {
  const range = loadBaseRangeDashboard(fromDate, toDate);
  const facts = queryShopeeAttemptFacts({ fromDate: range.fromDate || fromDate, toDate: range.toDate || toDate });
  patchState(range.states?.SHOPEECN, facts, 'SHOPEECN');
  patchState(range.states?.SHOPEEVN, facts, 'SHOPEEVN');
  patchState(range.aggregates?.SHOPEE, facts, '');
  return {
    ...range,
    queryMode: `${range.queryMode || 'SQL'}+SHOPEE_CROSS_DAY_TRUTH_V191`,
    v191ShopeeTruthVersion: V191_SHOPEE_TRUTH_VERSION
  };
}
