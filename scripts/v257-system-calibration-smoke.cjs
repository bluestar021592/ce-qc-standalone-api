const fs = require('fs');
const assert = require('assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const dashboard = read('src/v253DashboardFastPath.js');
const shopee = read('src/v244ShopeeTrendRuntimePatch.js');
const tracking = read('src/v246TrackingLedgerCore.js');
const analyzer = read('src/analyzerV30.js');
const facts = read('src/trajectoryFacts.js');
const special = read('src/specialNode.js');

// 1) Seven physical business boards must remain isolated. Aggregates are explicit only.
assert.ok(dashboard.includes("const TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP','CCSL','SHOPEE','ALL']);"), 'V253 must expose seven physical boards plus explicit aggregates');
assert.ok(dashboard.includes("const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];"), 'CCSL aggregate must contain CE/CEAF/TBKH/ALI1688 only');
assert.ok(dashboard.includes("const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];"), 'Shopee aggregate must keep CN/VN separate');
assert.ok(dashboard.includes("p.businessType='WHPP'"), 'WHPP must read only WHPP daily parse rows');
assert.ok(dashboard.includes("u.businessType='CEAF'"), 'WHPP fallback must explicitly de-duplicate CEAF overlap');
assert.ok(dashboard.includes('NOT EXISTS'), 'WHPP/CEAF overlap must be excluded instead of double-counted');

// 2) Every daily percentage must use that same daily row as its denominator.
assert.ok(dashboard.includes('row.podRate=pct(row.pod,row.total);row.ocRate=pct(row.ocCurrent,row.total);row.sameDayPodRate=pct(row.sameDayPod,row.total);'), 'daily POD/OC/same-day POD rates must divide by the same row total');
assert.ok(dashboard.includes("definitions:{podRate:'POD/当日总票',ocRate:'当前真实OC/当日总票',sameDayPodRate:'首日报当日完成POD/当日总票'}"), 'dashboard API must publish locked daily denominator definitions');

// 3) Shopee 1/2/3-attempt percentages require real POD attempt evidence; missing evidence is null/—, never fake 0%.
assert.ok(shopee.includes("SUM(CASE WHEN terminalReason='POD' AND attemptNo=1 THEN 1 ELSE 0 END) AS attempt1"), 'attempt 1 must come from locked POD ledger evidence');
assert.ok(shopee.includes("SUM(CASE WHEN terminalReason='POD' AND attemptNo=2 THEN 1 ELSE 0 END) AS attempt2"), 'attempt 2 must come from locked POD ledger evidence');
assert.ok(shopee.includes("SUM(CASE WHEN terminalReason='POD' AND attemptNo>=3 THEN 1 ELSE 0 END) AS attempt3"), 'attempt 3+ must come from locked POD ledger evidence');
assert.ok(shopee.includes('const hasAttemptEvidence=pod>0&&attemptEvidenceCount>0;'), 'Shopee trend must distinguish POD from attempt evidence coverage');
assert.ok(shopee.includes('attempt1Rate:hasAttemptEvidence ? pct(attempt1,pod) : null'), 'missing attempt-1 evidence must stay unavailable');
assert.ok(shopee.includes('attempt2Rate:hasAttemptEvidence ? pct(attempt2,pod) : null'), 'missing attempt-2 evidence must stay unavailable');
assert.ok(shopee.includes('attempt3Rate:hasAttemptEvidence ? pct(attempt3,pod) : null'), 'missing attempt-3 evidence must stay unavailable');
assert.ok(shopee.includes("evidenceSource:ledgerReady?'V246_LOCKED_TRACKING_LEDGER':'V246_LEDGER_PREPARING_NO_PARTIAL_TRUTH'"), 'partial ledger must never masquerade as historical truth');

// 4) Tracking admission and terminal truth must cover all seven boards and close only real terminal evidence.
assert.ok(tracking.includes("export const V246_TRACKING_TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);"), 'tracking ledger must cover all seven physical boards');
assert.ok(tracking.includes("orderStatus === '85'"), 'scan orderStatus=85 must remain POD lock evidence');
assert.ok(tracking.includes("orderStatus === '100'"), 'scan orderStatus=100 must remain completed-return evidence');
assert.ok(tracking.includes("latestCode === '80'"), 'trajectory code 80 must remain POD evidence');
assert.ok(tracking.includes("latestCode === '86'"), 'trajectory code 86 must remain completed-return evidence');

// 5) Special destinations are normal/special destinations and must be evaluated before ordinary anomalies.
assert.ok(facts.includes('? classifyLatestSpecialNode(sortedEvents)'), 'trajectory facts must classify the latest special destination');
assert.ok(analyzer.includes('} else if (special) {'), 'special destination must be handled before ordinary Pending/OC/cycle/inbound anomalies');
assert.ok(analyzer.includes('const ordinaryOpen = !terminal && !returnInProgress && !special && !storeFlow.shopState && !unknownShopCode;'), 'ordinary anomaly flags must exclude terminal/return/special/store destinations');
assert.match(special, /SELF_PICKUP_RE\s*=\s*\/[^\n]*仓库自提/, 'warehouse self-pickup must remain a special normal destination');
for (const node of ['CCSL580','580','CECN','CEZT']) {
  assert.ok(special.includes(`['${node}',`), `${node} must remain an explicit special destination`);
}
assert.ok(special.includes("['CCSL580', { state: 'CCSL580_RETENTION', label: '580滞留包裹' }]"), '580 must remain its own retained-parcel category');

// 6) Pending continuity must use distinct calendar dates, not repeated same-day events.
assert.ok(facts.includes('const pendingDates = distinctEventDates(pendingEvents);'), 'Pending must de-duplicate repeated events by calendar date');
assert.ok(facts.includes('pendingNonContinuous: pendingDates.length >= 2 && !pendingDateContinuity'), 'Pending discontinuity must be based on distinct dates');

console.log('[V257] system calibration gate passed: 7-board isolation + daily denominators + Shopee evidence rates + terminal truth + special-node exclusions + Pending date de-dup');
