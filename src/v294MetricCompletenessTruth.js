export const V294_METRIC_COMPLETENESS_ID = '2026-08-25-v294-complete-pod-evidence-before-metrics-v1';

const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const pct = (value, total) => total ? Number((n(value) * 100 / n(total)).toFixed(2)) : null;

export function enforceV294MetricCompleteness(row = {}) {
  const out = { ...row };
  const pod = Math.max(0, n(out.pod));
  const a1 = Math.max(0, n(out.attempt1));
  const a2 = Math.max(0, n(out.attempt2));
  const a3 = Math.max(0, n(out.attempt3));
  const known = a1 + a2 + a3;
  const unknown = Math.max(Math.max(0, n(out.attemptUnknown)), Math.max(0, pod - known));
  const signingCount = Math.max(0, n(out.signingDaysCount));
  const signingSum = Math.max(0, n(out.signingDaysSum));

  out.attemptUnknown = unknown;
  out.attemptEvidenceCount = Math.min(pod, known);
  out.attemptCoverageRate = pod ? pct(out.attemptEvidenceCount, pod) : null;
  out.attemptEvidenceComplete = pod === 0 || (unknown === 0 && known === pod);
  if (pod > 0 && out.attemptEvidenceComplete) {
    out.attempt1Rate = pct(a1, pod);
    out.attempt2Rate = pct(a2, pod);
    out.attempt3Rate = pct(a3, pod);
  } else {
    out.attempt1Rate = null;
    out.attempt2Rate = null;
    out.attempt3Rate = null;
  }

  out.signingEvidenceCount = Math.min(pod, signingCount);
  out.signingCoverageRate = pod ? pct(out.signingEvidenceCount, pod) : null;
  out.signingEvidenceComplete = pod === 0 || signingCount === pod;
  out.avgPodDays = pod > 0 && out.signingEvidenceComplete && signingCount > 0
    ? Number((signingSum / signingCount).toFixed(2))
    : null;
  out.metricCompletenessId = V294_METRIC_COMPLETENESS_ID;
  return out;
}

export function applyV294MetricCompletenessToLegacyTarget(target = {}, fact = {}) {
  if (!target || typeof target !== 'object') return target;
  const f = enforceV294MetricCompleteness(fact);
  Object.assign(target, {
    dispatchAttempt1: n(f.attempt1),
    dispatchAttempt2: n(f.attempt2),
    dispatchAttempt3: n(f.attempt3),
    dispatchAttemptUnclassifiedPod: n(f.attemptUnknown),
    dispatchAttemptDenominator: n(f.pod),
    dispatchAttempt1Rate: f.attempt1Rate,
    dispatchAttempt2Rate: f.attempt2Rate,
    dispatchAttempt3Rate: f.attempt3Rate,
    attemptEvidenceCoverage: f.attemptCoverageRate,
    attemptEvidenceComplete: f.attemptEvidenceComplete,
    avgPodDays: f.avgPodDays,
    averagePodDays: f.avgPodDays,
    signingEvidenceCoverage: f.signingCoverageRate,
    signingEvidenceComplete: f.signingEvidenceComplete,
    metricCompletenessId: V294_METRIC_COMPLETENESS_ID
  });
  return target;
}

console.info('[CE-QC][V294_METRIC_COMPLETENESS]', V294_METRIC_COMPLETENESS_ID,
  '1/2/3 attempt rates publish only when every POD has attempt evidence; average POD days publishes only when every POD has a real signing-day value.');
