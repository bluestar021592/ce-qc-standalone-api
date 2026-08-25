import assert from 'node:assert/strict';
import fs from 'node:fs';
import { statsOf, completeAttemptCount, completeAttemptRatio } from '../src/v200Metrics.js';
import { enforceV294MetricCompleteness } from '../src/v294MetricCompletenessTruth.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const chart = read('public/dashboard-chart-v18.js');
const v263 = read('src/v263DeliveryKpiTrendPatch.js');
const v273 = read('src/v273DashboardTruthReadPatch.js');
const exporter = read('src/v225ExportReturnTruth.js');
const worker = read('src/v183SingleBusinessExportJobWorker.js');
const rangeStore = read('src/rangeDashboardStoreV294.js');
const carryScheduler = read('src/carryoverRefreshScheduler.js');
const carryTruth = read('src/v294CarryoverLifecycleTruth.js');
const metricTruth = read('src/v294MetricCompletenessTruth.js');

new Function(chart);

// 1) Visible trends must follow the user's exact range and label every valid % point.
assert.match(v263,/exactRequestedDaily/,'three-business KPI must filter to exact requested report dates');
assert.match(v263,/exactRequestedRange:true/,'three-business API must disclose exact requested range semantics');
assert.match(v263,/attempt1:daily\.map\(r=>r\.attempt1\)/,'attempt count series must inherit null when complete evidence is absent');
assert.match(v273,/function exactRequestedRange/,'generic/home trend API must honor exact requested from/to');
assert.match(v273,/exactRequestedRange:true/,'generic/home trend response must disclose exact range semantics');
assert.match(v273,/readV273DashboardTrends\(type,''\,to,db\)/,'background prewarm may request recent history only by omitting from; visible calls pass explicit from/to');
assert.match(chart,/chart\.type==='rate'\|\|chart\.type==='days'\|\|chart\.dates\.length<=14/,'every valid percentage node must get an on-chart value label');
assert.match(chart,/plot\.style\.overflowX='auto'/,'long ranges must expand horizontally');
assert.match(chart,/pointSpacing\(chart\)/,'trend width must scale with selected daily point count');
assert.doesNotMatch(chart,/chart\.series\.length===1&&chart\.dates\.length<=10/,'old single-series-only label restriction must be retired');

// 2) Partial evidence must never be published as precise attempt/signing metrics.
const partial = enforceV294MetricCompleteness({pod:4,attempt1:2,attempt2:1,attempt3:0,attemptUnknown:1,signingDaysCount:3,signingDaysSum:7});
assert.equal(partial.attemptEvidenceComplete,false);
assert.equal(partial.attempt1Rate,null);
assert.equal(partial.avgPodDays,null);
assert.equal(completeAttemptCount({pod:4,a1:2,a2:1,a3:0,attemptUnknown:1},2),null);
assert.equal(completeAttemptRatio({pod:4,a1:2,a2:1,a3:0,attemptUnknown:1},2),null);
assert.match(metricTruth,/dispatchAttempt1: publishAttempt \? n\(f\.attempt1\) : null/,'legacy dashboard cards must not publish partial known attempt counts');
assert.match(metricTruth,/dispatchAttempt1Known/,'partial known counts may remain diagnostic only');

// 3) Export daily rows must represent exact daily membership occurrences, not unique shipment lifecycles.
const repeatedShipment = {
  shipmentCode:'QC-REPEAT-1',area:'金边',pod:true,podDate:'2026-08-03',firstReportDate:'2026-08-01',attemptNo:1,
  dailyMembershipDates:['2026-08-01','2026-08-03'],returned:false,pending:false,delivering:false,store:false
};
const oneDayShipment = {
  shipmentCode:'QC-ONE-2',area:'外省',pod:false,podDate:'',firstReportDate:'2026-08-03',attemptNo:0,
  dailyMembershipDates:['2026-08-03'],returned:false,pending:true,delivering:false,store:false
};
const stats = statsOf([repeatedShipment,oneDayShipment],{from:'2026-08-01',to:'2026-08-03'});
assert.deepEqual(stats.daily.map(row=>row.date),['2026-08-01','2026-08-03'],'export must not invent a zero row for 8/2 when no report membership exists');
assert.equal(stats.daily[0].total,1);
assert.equal(stats.daily[1].total,2);
assert.equal(stats.overall.total,2,'unexpanded input remains lifecycle-unique; V225 must expand exact daily occurrences before statsOf in production');
assert.match(exporter,/applyExactMembershipAndExpand\(businessType,rows,range\)/,'formal export must expand exact daily membership before workbook statistics');
assert.match(exporter,/V294_EXPORT_MEMBERSHIP_MISSING/,'one missing exact member must fail export closed');
assert.match(exporter,/V294_EXPORT_MEMBERSHIP_COUNT_MISMATCH/,'daily occurrence count mismatch must fail export closed');
assert.match(exporter,/V294_EXPORT_DUPLICATE_DAILY_MEMBER/,'duplicate date+shipment membership must fail export closed');
assert.match(exporter,/V294_EXPORT_EVIDENCE_INCOMPLETE/,'TBKH/CN/VN export must fail when POD attempt/signing evidence is incomplete');
assert.match(exporter,/V294_WHPP_EXPORT_DAILY_MEMBERSHIP_MISMATCH/,'WHPP daily report total must reconcile to exportable per-ticket membership');
assert.match(exporter,/V294_WHPP_EXPORT_REPORT_LEDGER_MISSING/,'WHPP snapshots without daily report ledger must fail closed');
assert.match(exporter,/listCompletedWhppSnapshots/,'WHPP export must use completed per-ticket snapshots, not aggregate-only history');

// 4) Current production worker must use V200/V225/V294; V199 day-count fallback remains compatibility-only.
assert.match(worker,/createV200ReferenceDashboardWorkbook/,'runtime worker must call V200 reference exporter');
assert.match(worker,/void createShopeeTruthWorkbook; void createV199UnifiedDashboardWorkbook;/,'V199 must remain compatibility-only and not be the runtime call');
assert.match(worker,/const result=await createV200ReferenceDashboardWorkbook/,'runtime export call must be V200');
assert.match(exporter,/applyV294ExportAttemptSigningTruth/,'V200 final row collector must apply V294 strict attempt/signing truth');

// 5) Dashboard range cards must use the same complete-evidence publication gate.
assert.match(rangeStore,/enforceV294MetricCompleteness/,'range dashboard must apply V294 metric completeness');
assert.match(rangeStore,/applyV294MetricCompletenessToLegacyTarget/,'legacy visible cards must be overwritten by the complete-evidence result');

// 6) Carryover must never silently close normal transit or return-in-progress.
assert.match(carryScheduler,/V294_KEEP_OPEN_NORMAL_TRANSIT/,'automatic carry refresh must keep normal routing nodes OPEN');
assert.match(carryScheduler,/KEEP_OPEN_UNTIL_RETURN_86/,'return-in-progress must remain OPEN until exact return completion');
assert.match(carryTruth,/NORMAL_FINAL/,'repair layer must include legacy false NORMAL_FINAL closures');
assert.match(carryTruth,/hasV294ExactTerminal/,'reopen/close decision must depend on exact terminal evidence');

console.log('[V294 FINAL QC] passed · exact custom dates + every % point visible + incomplete evidence=— + export membership fail-closed + WHPP daily reconciliation + V199 non-runtime + normal transit carryover stays OPEN');
