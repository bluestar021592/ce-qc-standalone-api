import assert from 'node:assert/strict';
import fs from 'node:fs';
import { statsOf, completeAttemptCount, completeAttemptRatio } from '../src/v200Metrics.js';
import { enforceV294MetricCompleteness } from '../src/v294MetricCompletenessTruth.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const chart = read('public/dashboard-chart-v18.js');
const v263 = read('src/v263DeliveryKpiTrendPatch.js');
const v273 = read('src/v273DashboardTruthReadPatch.js');
const exporter = read('src/v225ExportReturnTruth.js');
const historicalExporter = read('src/v320HistoricalExportRows.js');
const dispatchTruth = read('src/v320DispatchSigningTruth.js');
const canonicalLedger = read('src/v419CanonicalExportLedgerTruth.js');
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

// 2) Legacy V294 publication helpers remain conservative. Non-strict workbook
// businesses may render unverified attempt/signing metrics as dash, while strict
// TBKH/CN/VN evidence gaps are repaired by V484/V483 and remain fail-closed if
// still unresolved. No path may fabricate missing attempt evidence.
const partial = enforceV294MetricCompleteness({pod:4,attempt1:2,attempt2:1,attempt3:0,attemptUnknown:1,signingDaysCount:3,signingDaysSum:7});
assert.equal(partial.attemptEvidenceComplete,false);
assert.equal(partial.attempt1Rate,null);
assert.equal(partial.avgPodDays,null);
assert.equal(completeAttemptCount({pod:4,a1:2,a2:1,a3:0,attemptUnknown:1},2),null);
assert.equal(completeAttemptRatio({pod:4,a1:2,a2:1,a3:0,attemptUnknown:1},2),null);
assert.match(metricTruth,/dispatchAttempt1: publishAttempt \? n\(f\.attempt1\) : null/,'legacy dashboard cards must not publish partial known attempt counts');
assert.match(metricTruth,/dispatchAttempt1Known/,'partial known counts may remain diagnostic only');

// 3) Formal export must use every persisted daily membership occurrence,
// not only current VALID batches and not unique shipment lifecycles. V489 retires
// the old V381/V320 full-member strict scans from the workbook hot path: V419
// canonical ledger hydrates saved POD/attempt/START truth by shipmentCode PK, then
// V484/V483 repairs only actual strict POD gaps before metric publication.
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
assert.equal(stats.overall.total,2,'unexpanded input remains lifecycle-unique; V320 collector expands exact daily occurrences before workbook statistics');
assert.match(exporter,/collectV320HistoricalExportRows\(businessType,range,onProgress\)/,'formal export must seed from the complete persisted-history membership collector');
assert.match(historicalExporter,/shipment_daily_snapshots/,'formal export must recover preserved historical daily snapshots');
assert.match(historicalExporter,/business_daily_parse_rows/,'formal export must recover legacy Shopee daily membership rows');
assert.match(exporter,/expandDailyMembership\(rows,range\)/,'formal export must expand each shipment into exact daily membership occurrences');
assert.match(exporter,/V320_EXPORT_DUPLICATE_DAILY_MEMBER/,'duplicate date+shipment membership must fail export closed');
assert.match(exporter,/V489_FORMAL_EXPORT_EVIDENCE_PATH_ID/,'formal export must expose the V489 canonical-ledger hot-path owner');
assert.match(exporter,/applyV419CanonicalExportLedgerTruth\(businessType,rows,\{db:getDb\(\),onProgress\}\)/,'formal export must hydrate canonical persisted ledger truth before actual-POD gap repair');
assert.doesNotMatch(exporter,/applyV320DispatchSigningTruth\s*\(/,'formal export must not re-run the retired V320 full-member event hydration');
assert.match(canonicalLedger,/V493_SCAN85_POD_DATE_RECOVERY_ID/,'V419 must expose the V493 saved-terminal POD-date recovery owner');
assert.match(canonicalLedger,/function strictSigningDays\(ledger=\{\},podOverride=''\)/,'V419 must own strict persisted START-to-POD signing truth and accept the locally recovered POD-date override');
assert.match(canonicalLedger,/scan85SavedPodDate\(ledger\)/,'V419 must recover a missing canonical POD date only from saved terminal state');
assert.match(canonicalLedger,/strictSigningDays\(ledger,podDate\)/,'V419 must calculate signing truth from the canonical or recovered POD date');
assert.match(canonicalLedger,/v246InclusiveDays\(first,pod\)/,'V419 strict START-to-POD duration must be inclusive natural days');
assert.doesNotMatch(canonicalLedger,/firstReportDate/,'V419 strict signing timing must never start from report membership date');
assert.match(dispatchTruth,/v246InclusiveDays\(dispatch,pod\)/,'compatibility V320 dispatch-to-POD duration must remain inclusive natural days');
assert.doesNotMatch(dispatchTruth,/firstReportDate/,'compatibility V320 dispatch timing must never start from report membership date');
assert.doesNotMatch(exporter,/V294_EXPORT_EVIDENCE_INCOMPLETE/,'legacy V294 incomplete marker must not replace the scoped V481/V484 strict evidence contract');
assert.match(exporter,/evidencePartial/,'evidence gaps must remain explicit export diagnostics before scoped workbook gating');
assert.match(historicalExporter,/businessType==='WHPP'\)return collectLegacyV200Rows/,'WHPP must retain its existing per-ticket export authority rather than aggregate-only history');

// 4) Current production worker must use V200/V225/V489; V199 day-count fallback
// and V320 full-member strict event hydration remain compatibility-only.
assert.match(worker,/createV200ReferenceDashboardWorkbook/,'runtime worker must call V200 reference exporter');
assert.match(worker,/void createShopeeTruthWorkbook; void createV199UnifiedDashboardWorkbook;/,'V199 must remain compatibility-only and not be the runtime call');
assert.match(worker,/const result=await createV200ReferenceDashboardWorkbook/,'runtime export call must be V200');
assert.match(exporter,/V489_FORMAL_EXPORT_EVIDENCE_PATH_ID/,'V200 final row collector must use V489 canonical-ledger formal-export truth');
assert.doesNotMatch(exporter,/applyV320DispatchSigningTruth\s*\(/,'V200 final row collector must not restore the retired V320 full-member scan');

// 5) Dashboard range cards keep the conservative V294 complete-evidence gate;
// V320 history/sample views layer corrected sample metrics without weakening cards.
assert.match(rangeStore,/enforceV294MetricCompleteness/,'range dashboard must apply V294 metric completeness');
assert.match(rangeStore,/applyV294MetricCompletenessToLegacyTarget/,'legacy visible cards must be overwritten by the complete-evidence result');

// 6) Carryover must never silently close normal transit or return-in-progress.
assert.match(carryScheduler,/V294_KEEP_OPEN_NORMAL_TRANSIT/,'automatic carry refresh must keep normal routing nodes OPEN');
assert.match(carryScheduler,/KEEP_OPEN_UNTIL_RETURN_86/,'return-in-progress must remain OPEN until exact return completion');
assert.match(carryTruth,/NORMAL_FINAL/,'repair layer must include legacy false NORMAL_FINAL closures');
assert.match(carryTruth,/hasV294ExactTerminal/,'reopen/close decision must depend on exact terminal evidence');

console.log('[V494/V493/V490 FINAL QC] passed · exact custom dates + full persisted history membership + V419 canonical START-to-POD truth + saved scan85 POD-date recovery + actual-POD gap repair + duplicate membership fail-closed + V199/V320 full-member scans non-runtime + normal transit carryover stays OPEN');
