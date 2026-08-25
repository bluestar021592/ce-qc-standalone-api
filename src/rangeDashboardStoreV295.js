import { loadRangeDashboard as loadRangeDashboardV294 } from './rangeDashboardStoreV294.js';
import { summarizeV295FirstAttemptRange, V295_FIRST_ATTEMPT_TRUTH_ID } from './v295FirstAttemptTruth.js';
import { V295_FIRST_ATTEMPT_METRIC_ID } from './v295FirstAttemptMetric.js';

export const V295_RANGE_FIRST_ATTEMPT_ID = '2026-08-25-v295-range-first-attempt-publication-v1';
const CCSL_TYPES = ['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES = ['SHOPEECN','SHOPEEVN'];

function patchMetricTarget(target, fact) {
  if (!target || !fact) return;
  Object.assign(target, {
    firstAttemptSuccess: fact.firstAttemptSuccess,
    firstAttemptCount: fact.firstAttemptSuccess,
    firstAttemptEligible: fact.firstAttemptEligible,
    firstAttemptDenominator: fact.firstAttemptEligible,
    firstAttemptUnknownPod: fact.firstAttemptUnknownPod,
    firstAttemptEvidenceComplete: fact.firstAttemptEvidenceComplete,
    firstAttemptRate: fact.firstAttemptRate,
    firstDeliverySuccessRate: fact.firstAttemptRate,
    firstAttemptDefinition: fact.firstAttemptDefinition,
    firstAttemptTruthId: V295_FIRST_ATTEMPT_TRUTH_ID,
    firstAttemptMetricId: V295_FIRST_ATTEMPT_METRIC_ID
  });
}
function patchRows(rows, fact) {
  if (!Array.isArray(rows) || !fact) return;
  for (const row of rows) {
    const label = String(row?.项目 || row?.metricKey || row?.label || '').trim();
    if (label !== '首次妥投率') continue;
    const value = fact.firstAttemptRate;
    row.数值 = value;
    row.数值原值 = value;
    row.value = value;
    row.unit = '%';
    row.口径 = fact.firstAttemptDefinition;
    row.description = fact.firstAttemptDefinition;
  }
}
function patchState(state, fact) {
  if (!state || !fact) return;
  const sourceReady = state.analysisComplete !== false;
  const visible = sourceReady ? fact : { ...fact, firstAttemptRate: null, firstAttemptEvidenceComplete: false };
  for (const target of [state, state.v55Summary, state.dashboard, state.dashboard?.v55Summary, state.dashboard?.metrics].filter(Boolean)) patchMetricTarget(target, visible);
  patchRows(state.detailTabs?.dashboard?.rows, visible);
  patchRows(state.dashboard?.detailTabs?.dashboard?.rows, visible);
}
function patchShopeeNested(state, type, fact) {
  patchState(state, fact);
  const groups = state?.dashboard?.recipientGroups || {};
  const group = type === 'SHOPEECN' ? 'CN' : 'VN';
  for (const target of [groups.ALL?.metrics, groups[group]?.metrics].filter(Boolean)) patchMetricTarget(target, fact);
}
function patchShopeeAggregate(state, truth) {
  patchState(state, truth.shopee);
  const groups = state?.dashboard?.recipientGroups || {};
  if (groups.ALL?.metrics) patchMetricTarget(groups.ALL.metrics, truth.shopee);
  if (groups.CN?.metrics) patchMetricTarget(groups.CN.metrics, truth.byType.SHOPEECN);
  if (groups.VN?.metrics) patchMetricTarget(groups.VN.metrics, truth.byType.SHOPEEVN);
}

export function loadRangeDashboard(fromDate, toDate) {
  const range = loadRangeDashboardV294(fromDate, toDate);
  const from = range.fromDate || fromDate;
  const to = range.toDate || toDate;
  const truth = summarizeV295FirstAttemptRange(from, to);
  for (const type of CCSL_TYPES) patchState(range.states?.[type], truth.byType[type]);
  for (const type of SHOPEE_TYPES) patchShopeeNested(range.states?.[type], type, truth.byType[type]);
  patchState(range.states?.WHPP, truth.byType.WHPP);
  patchState(range.aggregates?.CCSL, truth.ccsl);
  patchShopeeAggregate(range.aggregates?.SHOPEE, truth);
  patchState(range.aggregates?.HOME, truth.home);
  range.firstAttemptTruthId = V295_FIRST_ATTEMPT_TRUTH_ID;
  range.firstAttemptMetricId = V295_FIRST_ATTEMPT_METRIC_ID;
  range.rangeFirstAttemptId = V295_RANGE_FIRST_ATTEMPT_ID;
  range.firstAttemptDefinition = truth.home.firstAttemptDefinition;
  range.firstAttemptSummary = { HOME: truth.home, CCSL: truth.ccsl, SHOPEE: truth.shopee, byType: truth.byType };
  return range;
}

console.info('[CE-QC][V295_RANGE_FIRST_ATTEMPT]', V295_RANGE_FIRST_ATTEMPT_ID, 'period-dashboard overwrites legacy same-day-POD fallback: 首次妥投率 uses first real delivery attempt success/eligible, while 首日POD妥投率 remains independent.');
