import { loadRangeDashboard as loadRangeDashboardV284 } from './rangeDashboardStoreV284.js';
import { summarizeV284ProvenRange } from './v284MembershipEvidenceCoverage.js';
import {
  enforceV294MetricCompleteness,
  applyV294MetricCompletenessToLegacyTarget,
  V294_METRIC_COMPLETENESS_ID
} from './v294MetricCompletenessTruth.js';

export const V294_RANGE_METRIC_PARITY_ID = '2026-08-25-v294-range-dashboard-complete-metric-parity-v1';

const CCSL_TYPES = ['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES = ['SHOPEECN','SHOPEEVN'];

function patchTargets(state, fact) {
  if (!state || !fact) return;
  const complete = enforceV294MetricCompleteness(fact);
  const targets = [
    state,
    state.v55Summary,
    state.dashboard,
    state.dashboard?.v55Summary,
    state.dashboard?.metrics
  ].filter(Boolean);
  for (const target of targets) applyV294MetricCompletenessToLegacyTarget(target, complete);
}

function patchShopeeGroups(state, type, fact) {
  if (!state?.dashboard || !fact) return;
  const groups = state.dashboard.recipientGroups || {};
  patchTargets(state, fact);
  for (const target of [groups.ALL?.metrics, groups[type === 'SHOPEECN' ? 'CN' : 'VN']?.metrics].filter(Boolean)) {
    applyV294MetricCompletenessToLegacyTarget(target, fact);
  }
}

function patchShopeeAggregate(state, truth) {
  if (!state?.dashboard) return;
  patchTargets(state, truth.shopee);
  const groups = state.dashboard.recipientGroups || {};
  if (groups.ALL?.metrics) applyV294MetricCompletenessToLegacyTarget(groups.ALL.metrics, truth.shopee);
  if (groups.CN?.metrics) applyV294MetricCompletenessToLegacyTarget(groups.CN.metrics, truth.byType?.SHOPEECN || {});
  if (groups.VN?.metrics) applyV294MetricCompletenessToLegacyTarget(groups.VN.metrics, truth.byType?.SHOPEEVN || {});
}

export function loadRangeDashboard(fromDate, toDate) {
  const range = loadRangeDashboardV284(fromDate, toDate);
  const resolvedFrom = range.fromDate || fromDate;
  const resolvedTo = range.toDate || toDate;
  const truth = summarizeV284ProvenRange(resolvedFrom, resolvedTo);

  for (const type of CCSL_TYPES) patchTargets(range.states?.[type], truth.byType?.[type]);
  for (const type of SHOPEE_TYPES) patchShopeeGroups(range.states?.[type], type, truth.byType?.[type]);
  patchTargets(range.aggregates?.CCSL, truth.ccsl);
  patchShopeeAggregate(range.aggregates?.SHOPEE, truth);

  range.metricCompletenessId = V294_METRIC_COMPLETENESS_ID;
  range.rangeMetricParityId = V294_RANGE_METRIC_PARITY_ID;
  return range;
}

console.info('[CE-QC][V294_RANGE_METRIC_PARITY]', V294_RANGE_METRIC_PARITY_ID,
  'range dashboard overwrites legacy partial attempt/signing metrics with complete-POD evidence semantics for TBKH + SHOPEE CN/VN and aggregates.');
