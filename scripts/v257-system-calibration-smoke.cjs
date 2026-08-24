const fs = require('fs');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');

const read = path => fs.readFileSync(path, 'utf8');
const dashboard = read('src/v253DashboardFastPath.js');
const shopee = read('src/v244ShopeeTrendRuntimePatch.js');
const v284 = read('src/v284DailyMembershipTruth.js');
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
assert.ok(v284.includes("p.businessType='WHPP'"), 'V284 WHPP daily membership must stay bound to WHPP parse rows');
assert.ok(v284.includes("u.businessType='CEAF'"), 'V284 must inherit the historical WHPP/CEAF overlap exclusion instead of losing it during truth consolidation');
assert.ok(v284.includes('NOT EXISTS'), 'V284 WHPP daily membership must exclude CEAF overlap before any metric is calculated');

// 2) Every daily percentage must use that same daily row as its denominator.
assert.ok(dashboard.includes('row.podRate=pct(row.pod,row.total);row.ocRate=pct(row.ocCurrent,row.total);row.sameDayPodRate=pct(row.sameDayPod,row.total);'), 'daily POD/OC/same-day POD rates must divide by the same row total');
assert.ok(dashboard.includes("definitions:{podRate:'POD/当日总票',ocRate:'当前真实OC/当日总票',sameDayPodRate:'首日报当日完成POD/当日总票'}"), 'dashboard API must publish locked daily denominator definitions');

// 3) Shopee 1/2/3-attempt percentages require real POD attempt evidence; missing evidence is null/—, never fake 0%.
assert.ok(shopee.includes('readV284ShopeeTrends'), 'Shopee compatibility route must delegate to V284 daily-membership truth');
assert.ok(v284.includes('LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=v.shipmentCode AND l.businessType=v.businessType'), 'daily membership must join V246 ledger by shipmentCode/businessType instead of grouping by firstReportDate');
assert.ok(v284.includes("CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.attemptNo,0)"), 'when V246 ledger exists, attempt number must come from locked ledger evidence');
assert.ok(v284.includes("WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(NULLIF(sf.podAttemptNo,0),NULLIF(sf.currentAttemptNo,0)"), 'legacy Shopee final-row attempt may be used only as fallback when the ledger row is absent');
assert.ok(v284.includes('SUM(CASE WHEN isPod=1 AND attemptNo=1 THEN 1 ELSE 0 END) attempt1'), 'attempt 1 must be counted only from POD rows with real attempt evidence');
assert.ok(v284.includes('SUM(CASE WHEN isPod=1 AND attemptNo=2 THEN 1 ELSE 0 END) attempt2'), 'attempt 2 must be counted only from POD rows with real attempt evidence');
assert.ok(v284.includes('SUM(CASE WHEN isPod=1 AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3'), 'attempt 3+ must be counted only from POD rows with real attempt evidence');
assert.ok(v284.includes('const hasAttempt=row.pod>0&&known>0;'), 'Shopee trend must distinguish POD from attempt evidence coverage');
assert.ok(v284.includes('row.attempt1Rate=hasAttempt?pct(row.attempt1,row.pod):null'), 'missing attempt-1 evidence must stay unavailable');
assert.ok(v284.includes('row.attempt2Rate=hasAttempt?pct(row.attempt2,row.pod):null'), 'missing attempt-2 evidence must stay unavailable');
assert.ok(v284.includes('row.attempt3Rate=hasAttempt?pct(row.attempt3,row.pod):null'), 'missing attempt-3 evidence must stay unavailable');
assert.ok(v284.includes('daily denominator=latest VALID report membership;'), 'V284 authority must explicitly retain latest-VALID daily membership');
assert.ok(v284.includes('status truth=V246 ledger first'), 'V284 authority must explicitly keep V246 lifecycle truth ahead of legacy final rows');

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

// 7) Lifecycle/export consolidation is part of the same production gate.
execFileSync(process.execPath, ['scripts/v268-lifecycle-export-smoke.cjs'], { stdio: 'inherit' });

console.log('[V257/V284/V286] system calibration gate passed: 7-board isolation + WHPP/CEAF de-dup inheritance + daily membership denominators + ledger-first Shopee evidence rates + terminal truth + special-node exclusions + Pending date de-dup + V268 lifecycle/export freshness');
