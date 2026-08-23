const fs=require('fs');
const assert=require('assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const live=read('public/v234-dashboard-live.js');
const home=read('public/v237-home-dashboard-owner.js');
const guard=read('public/v237-dashboard-owner-guard.js');
const coalescer=read('public/v239-dashboard-request-coalescer.js');
const drill=read('public/v58-drilldown-runtime.js');
const legacyNav=read('public/v109-instant-business-navigation.js');
const legacyV89=read('public/v89-fast-dashboard.js');
const legacyRouting=read('public/routing-v48.js');
const legacyClosure=read('public/v133-closure-rate.js');
const shell=read('src/v44WhppUiPatch.js');
const inject=read('src/v231MetricTruthUiInjectionPatch.js');
const route=read('src/v236DashboardCurrentRoutePatch.js');
const current=read('src/v236DashboardCurrentRead.js');
const cache=read('src/v235DashboardCurrentCache.js');
const trend=read('src/v237DashboardTrendRead.js');
const runtime=read('src/v206InteractiveFirstRuntimePatch.js');
const worker=read('src/dashboardCacheWorker.js');

for(const [name,source] of [['v234-dashboard-live',live],['v237-home-dashboard-owner',home],['v237-dashboard-owner-guard',guard],['v239-dashboard-request-coalescer',coalescer],['v109-instant-business-navigation',legacyNav],['v89-fast-dashboard',legacyV89],['routing-v48',legacyRouting],['v133-closure-rate',legacyClosure]]){
  assert.doesNotThrow(()=>new Function(source),`${name} must compile as browser JavaScript`);
}

assert.match(live,/v240-daily-rate-ui-v1/,'business owner must run V240 daily-rate UI');
assert.match(live,/__CE_QC_V237_DASHBOARD_OWNER__/,'single dashboard ownership flag must remain active');
assert.match(live,/scheduleTrendRetry/,'business trend cache misses must retry lightly');
assert.match(live,/missingDates/,'business trend retries must be driven by explicit missing dates');
assert.match(live,/trendRetryCount>=12/,'business trend retries must be bounded');
assert.doesNotMatch(live,/location\.reload\s*\(/,'business owner must never full-page reload while waiting for trend cache');
assert.match(live,/POD率 = POD ÷ 当日总票/,'daily table must show the explicit POD denominator');
assert.match(live,/OC率 = 当日真实OC票数 ÷ 当日总票/,'daily table must show current-day OC denominator');
assert.match(live,/首日妥投率 = 首日完成POD票数 ÷ 当日总票/,'business daily table must preserve the V240 same-day POD denominator');
assert.match(live,/pick\('sameDayPodRate',d\.sameDayPodRate\)/,'business fourth trend must use same-day POD rather than attempt-1');
assert.doesNotMatch(live,/首次妥投率趋势/,'attempt-1 wording must not remain on the business daily-rate trend card');
assert.match(live,/class="v240-table"/,'daily detail must render as compact styled table');

// V247 homepage intentionally supersedes the old V240 homepage-only assessment.
// Business pages retain the V240 daily-rate contract above; homepage replaces the
// duplicate same-day assessment with locked-ledger Shopee truth and operational trends.
assert.match(home,/v247-home-ledger-truth-owner-v2/,'homepage owner must run the V247 locked-ledger truth contract');
assert.match(home,/businessType=ALL/,'homepage charts must still read the aggregate trend endpoint');
assert.match(home,/\/api\/v246\/shopee-trends\?businessType=/,'homepage must read locked Shopee truth from the V246\/V247 endpoint');
assert.match(home,/correctedAllTrend/,'homepage aggregate trend must replace stale Shopee contribution with locked-ledger truth');
assert.match(home,/homeTruthPayload/,'homepage current cards must merge locked Shopee truth before rendering');
assert.match(home,/ledgerMetric/,'homepage Shopee card correction must require ledger-ready truth');
assert.match(home,/POD数量趋势/,'homepage second trend must be POD quantity');
assert.match(home,/POD率趋势/,'homepage must retain POD rate as an operational trend');
assert.match(home,/OC数量趋势/,'homepage fourth trend must be current OC quantity');
assert.doesNotMatch(home,/title:'首日POD妥投率趋势'/,'homepage must not restore the duplicate first-day POD trend');
assert.match(home,/removeDuplicateHomeAssessment/,'homepage must remove duplicate first-day POD assessment cards');
assert.match(home,/attemptRates/,'SHOPEE 1\/2\/3 dispatch distribution must remain a separate evidence-based calculation');
assert.match(home,/pod=num\(region\.pod\)/,'dispatch percentages must use POD denominator');
assert.match(home,/REGION_KEYS/,'SHOPEE PP\/PV visible cards must have explicit metric mapping');
assert.match(home,/scheduleCurrentRetry/,'stale snapshot-status must not freeze homepage current cards');
assert.match(home,/scheduleTrendRetry/,'homepage missing trend cache must retry without reload');
assert.match(home,/scheduleLedgerRetry/,'homepage incomplete locked ledger must retry without fabricating partial truth');
assert.match(home,/trendRetryCount>=12/,'homepage trend retries must be bounded');
assert.doesNotMatch(home,/location\.reload\s*\(/,'homepage owner must never full-page reload while cache warms');

assert.match(guard,/__CE_QC_V237_DASHBOARD_OWNER__=true/,'head guard must declare ownership before legacy scripts execute');
assert.match(guard,/\/api\\\/v27\\\/trends/,'legacy V232 trend network read must be retired');
assert.match(guard,/\/api\\\/v55\\\/reconciliation/,'legacy passive reconciliation read must be retired');
assert.match(coalescer,/v239-current-summary-coalescer-v1/,'current-summary coalescer must be installed before dashboard clients');
assert.match(coalescer,/CACHE_MS=15_000/,'current-summary coalescer must reuse the same fresh response for 15 seconds');
assert.match(coalescer,/inflight\.has\(key\)/,'simultaneous current-summary reads must share one in-flight request');
assert.match(coalescer,/url\.pathname!=='\/api\/v234\/current-summary'/,'coalescer must be narrowly scoped to current-summary only');
assert.match(drill,/__CE_QC_V237_DASHBOARD_OWNER__/,'legacy drilldown observer must skip passive reconciliation on owner pages');
assert.match(legacyNav,/v239-single-owner-navigation-v1/,'legacy navigation layer must recognize V239 single-owner mode');
assert.match(legacyNav,/V239_SINGLE_DASHBOARD_OWNER/,'legacy hydratePageData must return without launching routing\/CEAF reads on owner dashboards');
assert.match(legacyV89,/v239-retired-by-dashboard-owner-v1/,'legacy V89 summary layer must be retired under owner mode');
assert.match(legacyRouting,/v239-owner-retired-passive-routing-v1/,'legacy routing client must be retired under dashboard owner');
assert.match(legacyClosure,/v239-owner-local-closure-v1/,'closure cards must use owner-local arithmetic');
assert.match(shell,/\/routing-v48\.js\?v=20260823-v239-1/,'owner shell must cache-bust retired routing client');
assert.match(shell,/\/v89-fast-dashboard\.js\?v=20260823-v239-1/,'owner shell must cache-bust retired V89 client');
assert.match(shell,/\/v109-instant-business-navigation\.js\?v=20260823-v239-1/,'owner shell must cache-bust retired hydration client');
assert.match(shell,/\/v133-closure-rate\.js\?v=20260823-v239-1/,'owner shell must cache-bust owner-local closure client');

assert.match(inject,/v240-daily-rate-ui-injection-v1/,'delivered HTML must preserve the V240 business daily-rate UI');
assert.match(inject,/v247-home-ledger-truth-ui-v1/,'delivered HTML must enable V247 homepage locked-ledger truth');
assert.match(inject,/v239-dashboard-request-coalescer-ui-v1/,'delivered HTML must preserve V239 request coalescing');
assert.match(inject,/v239-dashboard-request-coalescer\.js\?v=20260823-v239-1/,'browser must receive cache-busted V239 coalescer in head');
assert.match(inject,/v235-cache-ready-reload\.js/,'injector must explicitly strip the old cache-ready reload poller');
assert.match(inject,/v234-dashboard-live\.js\?v=20260823-v240-1/,'browser must receive cache-busted V240 business owner');
assert.match(inject,/v237-dashboard-owner-guard\.js\?v=20260822-v238-1/,'browser must receive head-first owner guard');
assert.match(inject,/v237-home-dashboard-owner\.js\?v=20260823-v247-1/,'browser must receive cache-busted V247 homepage owner');
assert.match(inject,/X-CE-QC-V247-UI/,'V247 homepage delivery must remain observable in response headers');
assert.doesNotMatch(inject,/READY_MARKER/,'retired full-page cache poller must not be injected');

assert.match(route,/path==='\/api\/v234\/trends'/,'route patch must own V234 trend endpoint');
assert.match(route,/path==='\/api\/shopee\/state'/,'route patch must pre-handle old compact SHOPEE reads');
assert.match(current,/v240-daily-rate-contract-v1/,'current reader must expose V240 metric contract');
assert.match(current,/out\.ocRate=pct\(out\.ocCurrent,out\.total\)/,'OC rate must divide current OC tickets by daily total');
assert.match(current,/out\.sameDayPodRate=pct\(out\.sameDayPod,out\.total\)/,'same-day POD rate must divide same-day POD tickets by daily total');
assert.match(current,/normalizedDashboardCoverageReady/,'current read must accept complete normalized coverage when snapshot status flag lags');
assert.match(current,/cacheOnly/,'current reader must expose cache-only mode for trend requests');
assert.match(current,/isPod=0 AND isReturned=0/,'terminal CCSL rows must be excluded from current abnormal metrics');
assert.match(current,/COALESCE\(f\.rawJson,''\) LIKE '%1203--派送异常%'/,'nested SHOPEE 1203 evidence must classify as return');
assert.match(cache,/v240-daily-rate-contract-v1/,'cache worker must build V240 daily-rate metrics');
assert.match(cache,/AS ocCurrent/,'cache must persist current OC count separately from OC1+ aging');
assert.match(cache,/AS sameDayPod/,'cache must persist same-day POD count');
assert.match(cache,/eventCode='70'/,'SHOPEE attempt evidence must prefer real delivery event dates');
assert.match(cache,/eventCode='60'/,'SHOPEE attempt evidence must fall back to real assignment event dates');
assert.match(cache,/businessType='WHPP'/,'WHPP must also receive exact daily-rate cache metrics');
assert.match(cache,/isPod=0 AND isReturned=0 AND isCancelled=0/,'terminal SHOPEE rows must be excluded from cached abnormal metrics');
assert.match(trend,/V240_EXACT_DAILY_RATE_CACHE_ONLY/,'trend reader must identify the corrected daily-rate source');
assert.match(trend,/ocRate:'当日当前OC票数\/当日总票'/,'trend response must publish OC definition');
assert.match(trend,/sameDayPodRate:'首日完成POD票数\/当日总票'/,'trend response must publish same-day POD definition');
assert.match(trend,/readV236CurrentSummary\(date,\{cacheOnly:true\}\)/,'trend endpoint must never perform per-day direct normalized scans in web process');
assert.match(runtime,/v239-interactive-first-cache-prime-observable-v1/,'runtime must preserve V239 observable cache-prime behavior');
assert.match(runtime,/3_000/,'background cache child should start after short first-paint grace period');
assert.match(runtime,/dashboard cache prime child exit code=/,'cache-prime completion\/failure must be visible in startup log');
assert.match(runtime,/CE_QC_SKIP_STARTUP_POD_REPAIR/,'startup POD repair must remain outside interactive first paint');
assert.match(worker,/recentCompletedDashboardDates\(7\)/,'child worker must prepare recent seven valid ready dates');
assert.match(worker,/WORKER_LEASE_MS = 5 \* 60_000/,'dashboard cache lease must be bounded to five minutes');
assert.match(worker,/cleared stale dashboard-cache lease/,'worker must recover a crashed stale lease without waiting fifteen minutes');

console.log('[V247] V240 business contract + V247 locked-ledger homepage + evidence-only attempts + single-owner performance guards passed');
