const fs = require('fs');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');

const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
const bridge = fs.readFileSync('src/v161UnifiedImportRuntimeTruthPatch.js', 'utf8');
const runtime = fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js', 'utf8');
const route = fs.readFileSync('src/v236DashboardCurrentRoutePatch.js', 'utf8');
const worker = fs.readFileSync('src/dashboardCacheWorker.js', 'utf8');
const v246ShopeeRuntime = fs.readFileSync('src/v244ShopeeTrendRuntimePatch.js', 'utf8');
const v284 = fs.readFileSync('src/v284DailyMembershipTruth.js', 'utf8');
const v245Ui = fs.readFileSync('public/v244-shopee-trend-owner.js', 'utf8');
const inject = fs.readFileSync('src/v231MetricTruthUiInjectionPatch.js', 'utf8');
const trackingCore = fs.readFileSync('src/v246TrackingLedgerCore.js', 'utf8');
const trackingRuntime = fs.readFileSync('src/v246QcTrackingRuntimePatch.js', 'utf8');
const trackingUi = fs.readFileSync('public/v246-qc-tracking.js', 'utf8');
const attemptCycle = fs.readFileSync('src/shopeeAttemptCycleV246.js', 'utf8');
const shopeeAnalyzer = fs.readFileSync('src/shopeeAnalyzerV33.js', 'utf8');
const whppDetailUi = fs.readFileSync('public/v249-whpp-detail-owner.js', 'utf8');
const whppDetailRoute = fs.readFileSync('src/v172WhppDetailParityPatch.js', 'utf8');

for (const file of ['src/shopeeAttemptCycleV246.js','src/shopeeAnalyzerV33.js','src/v246TrackingLedgerCore.js','src/v246QcTrackingRuntimePatch.js','src/v244ShopeeTrendRuntimePatch.js','src/v284DailyMembershipTruth.js','public/v246-qc-tracking.js']) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

const v161Load = bootstrap.match(/^\s*await importPhase\('v161UnifiedImportRuntimeTruthPatch'[^\n]*$/m);
const serverStartCalls = [...bootstrap.matchAll(/^\s*await importServerInteractiveFirst\(\);\s*$/gm)];
assert.ok(v161Load, 'bootstrap must load V161 before server');
assert.equal(serverStartCalls.length, 1, 'bootstrap must invoke importServerInteractiveFirst exactly once');
assert.ok(v161Load.index < serverStartCalls[0].index, 'V161 runtime bridge must load before the actual server startup call');
assert.match(bridge, /^import '\.\/v206InteractiveFirstRuntimePatch\.js';/m, 'V161 must activate the V206 dashboard runtime bridge');
assert.match(runtime, /import '\.\/v234DashboardLiveTruthPatch\.js';/, 'V206 must activate V234 live truth');
assert.match(runtime, /import '\.\/v236DashboardCurrentRoutePatch\.js';/, 'V206 must activate V236 route owner');
assert.match(runtime, /import '\.\/v231MetricTruthUiInjectionPatch\.js';/, 'V206 must activate dashboard UI injection');
assert.match(runtime, /import '\.\/v244ShopeeTrendRuntimePatch\.js';/, 'V206 must activate Shopee trend runtime');
assert.match(runtime, /import '\.\/v246QcTrackingRuntimePatch\.js';/, 'V206 must activate V246 continuous QC tracking runtime');
assert.match(runtime, /dashboard cache prime child exit code=/, 'cache-prime child completion must remain observable');
assert.match(runtime, /MAX_PRIME_ATTEMPTS = 4/, 'transient startup skips must retry with a bounded attempt count');
assert.match(runtime, /FOREGROUND_PROCESSING_ACTIVE\|CACHE_OR_PURGE_WORKER_ALREADY_ACTIVE/, 'runtime must recognize retryable cache-prime skips');
assert.match(worker, /getDashboardCacheStatus\(\)/, 'startup worker must inspect persisted dashboard cache state');
assert.match(worker, /INITIAL_CACHE_WARM_ONCE/, 'a brand-new database may warm persisted dashboard cache exactly once');
assert.match(worker, /PERSISTED_CACHE_STARTUP_READ_ONLY/, 'normal startup must reuse persisted dashboard cache instead of rebuilding history');
assert.match(worker, /refreshDashboardCacheDirty\(\{ limit: 24, recentDays: 30 \}\)/, 'normal startup may rebuild only dates explicitly marked dirty by real fact changes');
assert.doesNotMatch(worker, /V243_FORCED_RECENT_7_REBUILD_WITH_AUDIT/, 'forced recent-seven rebuild mode must stay retired');
assert.doesNotMatch(worker, /recentCompletedDashboardDates\(7\)/, 'normal startup must not scan/rebuild the recent seven completed dates');
assert.match(worker, /readV237DashboardTrends/, 'worker must retain the same trend audit reader for explicit diagnostics');
assert.match(worker, /SUSPICIOUS_FLAT_SERIES/, 'worker must retain suspicious-flat-series diagnostics without forcing them on every startup');
assert.match(route, /path==='\/api\/v234\/trends'/, 'V236 must own the V234 trend endpoint');

assert.match(attemptCycle,/first real delivery START/,'V246 attempt helper must document the locked START rule');
assert.match(attemptCycle,/eventCode\(event\) === '70'/,'V246 attempt helper must prefer exact track code 70 as START');
assert.match(attemptCycle,/eventCode\(event\) === '60'/,'V246 attempt helper must provide code 60 fallback only when 70 is absent');
assert.match(attemptCycle,/eventCode\(event\) === '150'/,'V246 attempt helper must recognize exact Pending code 150 as failure evidence');
assert.match(attemptCycle,/failedSinceStart/,'V246 attempt increment must require failure since the previous START');
assert.match(attemptCycle,/NEGATIVE_POD_RE/,'V246 must reject 未签收/未妥投/failed-delivery text as POD evidence');
assert.match(shopeeAnalyzer,/analyzeV246ShopeeAttemptCycle/,'live Shopee analyzer must use V246 strict attempt cycles');
assert.match(shopeeAnalyzer,/V246_STRICT_START_FAILURE_CYCLE/,'live Shopee rows must expose strict attempt ownership');

assert.match(trackingCore,/CREATE TABLE IF NOT EXISTS qc_tracking_ledger/,'V246 must create a persistent per-shipment QC ledger');
assert.match(trackingCore,/CREATE TABLE IF NOT EXISTS qc_tracking_audit/,'V246 must preserve repair/reopen audit evidence');
assert.match(trackingCore,/carryoverSources/,'V246 source truth must union historical carryover so a later re-upload cannot silently drop an admitted shipment');
assert.match(trackingCore,/sourceReportDate/,'V246 reconciliation must retain the original carry source date');
assert.match(trackingCore,/firstReportDate/,'V246 must lock the first report date per shipment');
assert.match(trackingCore,/trackingStatus='OPEN'/,'V246 open-candidate reader must only refresh non-terminal ledger rows');
assert.doesNotMatch(trackingCore,/normal\s*\?\s*'NORMAL_FINAL'/,'V246 must never close a shipment merely because it is a normal final hub');
assert.match(trackingCore,/Legacy closeReason is deliberately not authoritative/,'V246 must ignore contaminated legacy closeReason when deciding terminal truth');
assert.match(trackingCore,/RETURN_OPEN_RE/,'V246 must keep return-in-progress open');
assert.match(trackingCore,/v246PositivePodText/,'V246 terminal truth must reject negative POD wording');
assert.match(trackingCore,/\['POD','RETURNED','ORDER_CANCELLED'\]/,'V246 terminal lock must be restricted to real terminal outcomes');
assert.match(trackingCore,/v246InclusiveDays\(firstReportDate,podDate\)/,'average signing days must use immutable firstReportDate to actual POD date');
assert.match(trackingCore,/listV246ShopeePodForStrictCheck/,'V246 must enumerate POD rows requiring strict track evidence');
assert.match(trackingCore,/applyV246StrictAttemptEvidence/,'V246 must support authoritative strict-attempt corrections, including downward correction');
assert.match(trackingCore,/V246_STRICT_TRACK:/,'V246 strict track evidence must be persisted with explicit ownership');
assert.match(trackingCore,/readV246ShopeeDailyTruth/,'V246 ledger core must retain its per-first-admission lifecycle truth helper for tracking/export compatibility');

assert.match(trackingRuntime,/CAMBODIA_0200_30DAY_AUTO/,'V246 must own a Cambodia 02:00 rolling 30-day reconciliation');
assert.match(trackingRuntime,/clock\.minuteOfDay<120/,'V246 scheduler must not run the daily deep refresh before 02:00');
assert.match(trackingRuntime,/v246_daily_0200_success_date/,'V246 must remember the successful 02:00 day and support missed-run catch-up');
assert.match(trackingRuntime,/v246_daily_0200_failed_at/,'V246 must persist failed 02:00 attempts for retry backoff');
assert.match(trackingRuntime,/SCHEDULE_RETRY_MS/,'V246 must cool down repeated automatic failures instead of retrying every minute');
assert.match(trackingRuntime,/scheduledFailureCoolingDown/,'V246 scheduler must enforce failure cooldown');
assert.match(trackingRuntime,/STARTUP_90DAY_ANTI_LEAK/,'V246 must seed recent historical omissions on startup before daily catch-up');
assert.match(trackingRuntime,/HOURLY_ANTI_LEAK_RECONCILE/,'V246 must continuously audit missing/reopened tracking rows while the app is running');
assert.match(trackingRuntime,/listAllOpenTrackingRows/,'nightly tracking must continue all admitted OPEN parcels even after they age beyond 30 days');
assert.match(trackingRuntime,/automaticAllOpen/,'02:00 job must use all-open candidates after the rolling 30-day reconciliation');
assert.match(trackingRuntime,/collectV200Rows/,'V246 must enrich safe POD/signing evidence after status refresh');
assert.match(trackingRuntime,/backfillShopeeStrictTrack/,'V246 must actively backfill real Shopee attempt cycles from historical trajectory');
assert.match(trackingRuntime,/queryTrackWithFallback/,'strict attempt backfill must isolate failing track batches rather than fail the whole range');
assert.match(trackingRuntime,/\/api\/v246\/tracking\/reconcile/,'V246 must expose one-click/custom-range reconciliation');
assert.match(trackingRuntime,/\/api\/v246\/tracking\/bill\/:shipmentCode/,'V246 must expose per-waybill QC diagnosis');

// V284 owns visible Shopee daily cohorts. The compatibility route keeps the old
// endpoint/export names, while V246 ledger remains the first status/attempt source.
assert.match(v246ShopeeRuntime,/V246_SHOPEE_TREND_ID/,'Shopee backend must retain the historical V246 trend export name');
assert.match(v246ShopeeRuntime,/readV284ShopeeTrends/,'Shopee compatibility endpoint must delegate to V284 daily-membership truth');
assert.match(v246ShopeeRuntime,/legacyCoverage/,'old Shopee UI evidence-coverage fields must be preserved without changing truth');
assert.match(v246ShopeeRuntime,/attemptEvidenceComplete/,'Shopee compatibility response must expose attempt evidence completeness');
assert.match(v246ShopeeRuntime,/\/api\/v246\/shopee-trends/,'V246 Shopee endpoint must remain registered');
assert.match(v284,/LEFT JOIN qc_tracking_ledger l ON l\.shipmentCode=v\.shipmentCode AND l\.businessType=v\.businessType/,'V284 daily members must join the V246 ledger by shipment/business');
assert.match(v284,/CASE WHEN l\.shipmentCode IS NOT NULL THEN COALESCE\(l\.attemptNo,0\)/,'ledger attemptNo must outrank legacy final-row attempt fields');
assert.match(v284,/row\.attempt1Rate=hasAttempt\?pct\(row\.attempt1,row\.pod\):null/,'Shopee must not fabricate 1-pai zero without evidence');
assert.match(v284,/source:'LATEST_VALID_DAILY_MEMBERSHIP_JOIN_V246_LEDGER_FINAL_FALLBACK'/,'visible daily truth must disclose latest-VALID membership + ledger-first ownership');

assert.doesNotThrow(()=>new Function(v245Ui),'Shopee trend UI must compile as browser JavaScript');
for(const label of ['票数趋势','POD数量趋势','平均签收天数趋势','OC数量趋势','1/2/3派签收占POD趋势','派次未识别POD'])assert.ok(v245Ui.includes(label),`Shopee UI missing ${label}`);
assert.match(v245Ui,/<th>平均签收天数<\/th>/,'Shopee daily detail must keep average signing days');
assert.doesNotMatch(v245Ui,/<th>首日POD<\/th>/,'Shopee daily detail must not restore duplicate first-day POD column');
assert.doesNotMatch(v245Ui,/<th>首日妥投率<\/th>/,'Shopee daily detail must not restore duplicate first-day POD-rate column');
assert.match(v245Ui,/v248-shopee-spa-operational-trend-owner-v1/,'Shopee owner must be the V248 SPA-aware owner');
assert.match(v245Ui,/activateIfShopee/,'V248 Shopee owner must reactivate after SPA navigation');

assert.doesNotThrow(()=>new Function(trackingUi),'V246 QC tracking UI must compile as browser JavaScript');
for(const label of ['最近7天核查','最近30天核查','核查自定义区间','单号追踪诊断'])assert.ok(trackingUi.includes(label),`V246 tracking UI missing ${label}`);

assert.doesNotThrow(()=>new Function(whppDetailUi),'V249 WHPP exact drilldown owner must compile as browser JavaScript');
assert.match(whppDetailUi,/\/api\/v172\/whpp-metric-detail/,'V249 WHPP clicks must use the existing exact V172 per-ticket detail route');
assert.match(whppDetailUi,/__CE_QC_V132_WHPP_FAST__/,'V249 must hand stale WHPP fallback pages back to the canonical V132 page');
assert.match(whppDetailUi,/WHPP页面已切换完成\|区域\\\/趋势数据正在后台更新/,'V249 must recognize the stale V90 placeholder page');
assert.match(whppDetailUi,/'订单取消':'cancelled'/,'V249 WHPP detail mapping must include cancelled shipments');
assert.match(whppDetailUi,/'闭环率':'closed'/,'V249 WHPP detail mapping must expose closed tickets');
assert.match(whppDetailUi,/pod\+returned\+cancelled/,'V249 closure arithmetic must be POD + returned + cancelled');
assert.match(whppDetailRoute,/\/api\/v172\/whpp-metric-detail/,'V172 exact WHPP detail route must remain registered');

assert.match(inject,/v244-shopee-trend-owner\.js\?v=20260823-v248-1/,'Shopee owner must be cache-busted for V248 SPA activation');
assert.match(inject,/v246-qc-tracking\.js\?v=20260823-v246-1/,'V246 tracking control must be injected');
assert.match(inject,/v249-whpp-detail-owner\.js\?v=20260823-v249-1/,'V249 WHPP exact drilldown owner must be injected after legacy UI');
assert.match(inject,/X-CE-QC-V246-UI/,'V246 UI response header must be observable');
assert.match(inject,/X-CE-QC-V248-UI/,'V248 UI response header must be observable');
assert.match(inject,/X-CE-QC-V249-UI/,'V249 UI response header must be observable');

console.log('[V284/V249] daily-membership Shopee truth + continuous QC tracking + persisted-cache startup + V248 SPA owner + WHPP exact drilldown/canonical handoff gate passed');
