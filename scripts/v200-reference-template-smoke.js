import fs from 'node:fs';
import { resolveV200Attempt, V200_EXPORT_VERSION, internalHyperlinkFormulaForV200 } from '../src/v200TemplateDashboardExporter.js';
import { referenceAverageDays } from '../src/v200Metrics.js';
import { V227_MULTI_BUSINESS_HISTORY_REFRESH_ID } from '../src/v227MultiBusinessHistoryRefreshPatch.js';
import { V228_MULTI_BUSINESS_HISTORY_ROUTE_INSTALLER_ID } from '../src/v228MultiBusinessHistoryRouteInstallerPatch.js';
import { resolveStrictShopeeAttempt, inclusiveNaturalDays, V230_ATTEMPT_SIGNING_TRUTH_ID, V232_ATTEMPT_CYCLE_TRUTH_ID } from '../src/v230AttemptSigningTruth.js';
import { V230_METRIC_TRUTH_ROUTE_ID, V232_DEEP_TRUTH_CACHE_ID } from '../src/v230MetricTruthPatch.js';
import { V231_METRIC_TRUTH_UI_INJECTION_ID } from '../src/v231MetricTruthUiInjectionPatch.js';
import { V232_FAST_DAILY_TREND_ID } from '../src/v214FastTrendRoutePatch.js';
import '../src/v230MetricTruthWorker.js';

function must(condition, message) { if (!condition) throw new Error(message); }
const event = (eventCode, eventTime, desc = '') => ({ eventCode, eventTime, rawJson: JSON.stringify({ eventCode, eventTime, trackingEventDescZh: desc }) });

must(resolveV200Attempt({ pod:true, deliveryDates:['2026-08-01','2026-08-02','2026-08-03'], currentAttemptNo:1, podDate:'2026-08-03' }).attemptNo === 3, 'legacy V200 resolver must still accept real delivery dates');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:['2026-08-01','2026-08-02'], podDate:'2026-08-02' }).attemptNo === 2, 'legacy V200 code60 fallback must remain available');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], podAttemptNo:2, podDate:'2026-08-02' }).attemptNo === 2, 'legacy podAttemptNo fallback must remain available');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], currentAttemptNo:1, podDate:'2026-08-04' }).attemptNo === 0, 'default currentAttemptNo=1 must not fabricate first-attempt success');
must(resolveV200Attempt({ pod:true, deliveryDates:[], assignDates:[], podDate:'2026-08-04' }).attemptNo === 0, 'elapsed days must not fabricate dispatch attempt');

must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', events:[event('70','2026-08-01 09:00:00'),event('70','2026-08-02 09:00:00'),event('70','2026-08-03 09:00:00')] }).attemptNo === 1, 'repeated START without a failure must remain first attempt');
must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', events:[event('70','2026-08-01 09:00:00'),event('150','2026-08-01 18:00:00','Pending: Delivery problem'),event('70','2026-08-02 09:00:00')] }).attemptNo === 2, 'failure followed by a new START must create second attempt');
must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', events:[event('70','2026-08-01 09:00:00'),event('150','2026-08-01 18:00:00','Pending'),event('70','2026-08-02 09:00:00'),event('150','2026-08-02 18:00:00','Pending'),event('70','2026-08-03 09:00:00')] }).attemptNo === 3, 'two failed cycles followed by new STARTs must create third attempt');
must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', events:[event('30','2026-08-01 09:00:00','Delivery Assign'),event('150','2026-08-01 18:00:00','Pending'),event('60','2026-08-02 09:00:00','Assigning courier')] }).attemptNo === 2, 'assignment cycle is fallback only when real START is absent');
must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', events:[], podAttemptNo:2 }).attemptNo === 2, 'explicit POD locked attempt may be the final fallback');
must(resolveStrictShopeeAttempt({ pod:true, podDate:'2026-08-03', events:[] }).attemptNo === 0, 'attempt must remain unknown without real evidence');

must(referenceAverageDays('2026-08-01','2026-08-01') === 1, 'reference same-day POD must equal one natural day');
must(referenceAverageDays('2026-08-01','2026-08-04') === 4, 'reference average must use dashboard date to actual POD date inclusive');
must(inclusiveNaturalDays('2026-07-01','2026-07-01') === 1, 'same-day signing must equal one natural day');
must(inclusiveNaturalDays('2026-07-01','2026-07-12') === 12, 'real long signing duration must stay literal; it must not be compressed or converted into attempt count');

const uiSource = fs.readFileSync('public/v230-metric-truth-ui.js','utf8');
new Function(uiSource);
must(uiSource.includes('每日百分比趋势明细'), 'fast daily percentage panel token missing');
must(uiSource.includes('cacheOnly'), 'live dashboard must use cache-only deep truth probe');
const cardSource=fs.readFileSync('public/v232-card-percentages.js','utf8');
new Function(cardSource);
must(cardSource.includes('占本业务'), 'numeric-card percentage runtime token missing');
const chartSource=fs.readFileSync('public/dashboard-chart-v18.js','utf8');
new Function(chartSource);
must(chartSource.includes('短区间每一天的数值直接标在节点上'), 'daily value chart-label token missing');
const outcomeSource=fs.readFileSync('public/v233-current-outcome-truth.js','utf8');
new Function(outcomeSource);
must(outcomeSource.includes('当前POD / 退回 / 未闭环真实状态'), 'V233 current-outcome truth token missing');
must(outcomeSource.includes("/api/business-state/"), 'V233 must fetch compact current business truth');

const formula = internalHyperlinkFormulaForV200('POD明细', 1718, 1115);
must(formula === 'HYPERLINK("#\'POD明细\'!A1718",1115)', 'WPS-safe internal hyperlink must match reference workbook formula syntax');
must(V200_EXPORT_VERSION === '2026-08-18-v200-reference-template-track-attempt-v1', 'unexpected V200 version');
must(V227_MULTI_BUSINESS_HISTORY_REFRESH_ID === '2026-08-22-v227-multi-business-history-refresh-v1', 'unexpected V227 multi-business history refresh version');
must(V228_MULTI_BUSINESS_HISTORY_ROUTE_INSTALLER_ID === '2026-08-22-v228-multi-business-history-route-installer-v1', 'unexpected V228 multi-business route installer version');
must(V230_ATTEMPT_SIGNING_TRUTH_ID === '2026-08-22-v230-shopee-attempt-signing-truth-v1', 'unexpected V230 attempt/signing truth version');
must(V232_ATTEMPT_CYCLE_TRUTH_ID === '2026-08-22-v232-shopee-real-delivery-cycle-v1', 'unexpected V232 attempt-cycle truth version');
must(V230_METRIC_TRUTH_ROUTE_ID === '2026-08-22-v230-daily-metric-truth-route-v1', 'unexpected V230 metric truth route version');
must(V232_DEEP_TRUTH_CACHE_ID === '2026-08-22-v232-deep-truth-explicit-cache-v1', 'unexpected V232 deep-cache version');
must(V232_FAST_DAILY_TREND_ID === '2026-08-22-v232-fast-seven-business-daily-trends-v1', 'unexpected V232 fast trend version');
// V231 is an HTML/UI delivery bridge and legitimately advances when canonical dashboard
// ownership changes. Gate the supported V263 family instead of pinning one obsolete build.
must(/^2026-08-23-v263-canonical-dashboard-delivery-v\d+$/.test(V231_METRIC_TRUTH_UI_INJECTION_ID), 'unexpected V231/V263 canonical dashboard UI family');
console.log('[V200/V230/V232/V233] fast trends + numeric percentages + strict attempt cycles + current outcome truth smoke passed');
