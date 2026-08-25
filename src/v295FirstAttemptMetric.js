export const V295_FIRST_ATTEMPT_METRIC_ID = '2026-08-25-v295-first-attempt-success-truth-v1';

const n = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const pct = (value, total) => total > 0 ? Number((n(value) * 100 / n(total)).toFixed(2)) : null;

export function finalizeV295FirstAttemptFact(input = {}) {
  const total = n(input.total);
  const eligible = n(input.firstAttemptEligible ?? input.eligible);
  const success = Math.min(eligible, n(input.firstAttemptSuccess ?? input.success));
  const unknownPod = n(input.firstAttemptUnknownPod ?? input.unknownPod);
  const sourceReady = input.sourceReady !== false && input.ready !== false;
  const evidenceComplete = sourceReady && unknownPod === 0;
  return {
    ...input,
    total,
    firstAttemptEligible: eligible,
    firstAttemptSuccess: success,
    firstAttemptUnknownPod: unknownPod,
    firstAttemptEvidenceComplete: evidenceComplete,
    firstAttemptRate: evidenceComplete && eligible > 0 ? pct(success, eligible) : null,
    firstAttemptDefinition: '第一次派送成功票数/第一次派送尝试票数；第一次失败后进入第2派的票只进入分母；无真实START证据不伪造0%'
  };
}

export function summarizeV295FirstAttemptMembers(members = [], { businessType = '', reportDate = '', sourceReady = true } = {}) {
  let total = 0;
  let firstAttemptEligible = 0;
  let firstAttemptSuccess = 0;
  let firstAttemptUnknownPod = 0;
  for (const member of Array.isArray(members) ? members : []) {
    total += 1;
    const attemptNo = Math.max(0, Math.min(3, Math.floor(Number(member?.attemptNo || 0))));
    const pod = Boolean(member?.pod);
    if (attemptNo > 0) firstAttemptEligible += 1;
    if (pod && attemptNo === 1) firstAttemptSuccess += 1;
    if (pod && attemptNo === 0) firstAttemptUnknownPod += 1;
  }
  return finalizeV295FirstAttemptFact({
    businessType,
    reportDate,
    total,
    firstAttemptEligible,
    firstAttemptSuccess,
    firstAttemptUnknownPod,
    sourceReady
  });
}

export function mergeV295FirstAttemptFacts(businessType, rows = [], { reportDate = '' } = {}) {
  const valid = (Array.isArray(rows) ? rows : []).filter(Boolean);
  return finalizeV295FirstAttemptFact({
    businessType,
    reportDate: reportDate || valid.map(row => String(row.reportDate || '')).filter(Boolean).sort().at(-1) || '',
    total: valid.reduce((sum, row) => sum + n(row.total), 0),
    firstAttemptEligible: valid.reduce((sum, row) => sum + n(row.firstAttemptEligible), 0),
    firstAttemptSuccess: valid.reduce((sum, row) => sum + n(row.firstAttemptSuccess), 0),
    firstAttemptUnknownPod: valid.reduce((sum, row) => sum + n(row.firstAttemptUnknownPod), 0),
    sourceReady: valid.every(row => row.sourceReady !== false && row.ready !== false && row.firstAttemptEvidenceComplete !== false)
  });
}
