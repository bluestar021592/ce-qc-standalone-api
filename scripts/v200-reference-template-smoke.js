import { resolveV200Attempt, V200_EXPORT_VERSION, internalHyperlinkFormulaForV200 } from '../src/v200TemplateDashboardExporter.js';
import { referenceAverageDays } from '../src/v200Metrics.js';
import { V227_MULTI_BUSINESS_HISTORY_REFRESH_ID } from '../src/v227MultiBusinessHistoryRefreshPatch.js';
import { V228_MULTI_BUSINESS_HISTORY_ROUTE_INSTALLER_ID } from '../src/v228MultiBusinessHistoryRouteInstallerPatch.js';
import { resolveStrictShopeeAttempt, inclusiveNaturalDays, V230_ATTEMPT_SIGNING_TRUTH_ID } from '../src/v230AttemptSigningTruth.js';

function must(condition, message) { if (!condition) throw new Error(message); }

must(resolveV200Attempt({ pod:true, deliveryDates:['2026-08-01','2026-08-02','2026-08-03'], currentAttemptNo:1, podDate:'2026-08-03' }).attemptNo === 3, 'legacy V200 resolver must still accept real delivery dates');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:['2026-08-01','2026-08-02'], podDate:'2026-08-02' }).attemptNo === 2, 'legacy V200 code60 fallback must remain available');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], podAttemptNo:2, podDate:'2026-08-02' }).attemptNo === 2, 'legacy podAttemptNo fallback must remain available');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], currentAttemptNo:1, podDate:'2026-08-04' }).attemptNo === 0, 'default currentAttemptNo=1 must not fabricate first-attempt success');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], podDate:'2026-08-04' }).attemptNo === 0, 'elapsed days must not fabricate dispatch attempt');

must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', code70Dates:['2026-08-01','2026-08-02','2026-08-03'] }).attemptNo === 3, 'V230 must count distinct code70 dates as 1/2/3+ attempts');
must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', code70Dates:['2026-08-01','2026-08-01','2026-08-01'] }).attemptNo === 1, 'V230 duplicate code70 rows on one date must count once');
must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', code70Dates:[], code60Dates:['2026-08-01','2026-08-02'] }).attemptNo === 2, 'V230 must use distinct code60 dates only when code70 is absent');
must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', code70Dates:[], code60Dates:[], podAttemptNo:2 }).attemptNo === 2, 'V230 explicit POD locked attempt may be the final fallback');
must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', code70Dates:[], code60Dates:[] }).attemptNo === 0, 'V230 must leave attempt unknown without real evidence');

must(referenceAverageDays('2026-08-01','2026-08-01') === 1, 'reference same-day POD must equal one natural day');
must(referenceAverageDays('2026-08-01','2026-08-04') === 4, 'reference average must use dashboard date to actual POD date inclusive');
must(inclusiveNaturalDays('2026-07-01','2026-07-01') === 1, 'V230 same-day signing must equal one natural day');
must(inclusiveNaturalDays('2026-07-01','2026-07-12') === 12, 'V230 signing natural days must remain literal; long real POD durations must not be silently compressed');

const formula = internalHyperlinkFormulaForV200('POD明细', 1718, 1115);
must(formula === 'HYPERLINK("#\'POD明细\'!A1718",1115)', 'WPS-safe internal hyperlink must match reference workbook formula syntax');
must(V200_EXPORT_VERSION === '2026-08-18-v200-reference-template-track-attempt-v1', 'unexpected V200 version');
must(V227_MULTI_BUSINESS_HISTORY_REFRESH_ID === '2026-08-22-v227-multi-business-history-refresh-v1', 'unexpected V227 multi-business history refresh version');
must(V228_MULTI_BUSINESS_HISTORY_ROUTE_INSTALLER_ID === '2026-08-22-v228-multi-business-history-route-installer-v1', 'unexpected V228 multi-business route installer version');
must(V230_ATTEMPT_SIGNING_TRUTH_ID === '2026-08-22-v230-shopee-attempt-signing-truth-v1', 'unexpected V230 attempt/signing truth version');
console.log('[V200/V230] reference template + strict code70/code60 attempt + natural-day signing truth smoke passed');
