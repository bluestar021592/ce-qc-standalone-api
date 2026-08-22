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

assert.match(live,/v238-dashboard-owner-client-v1/,'business owner must run V238 client');
assert.match(live,/__CE_QC_V237_DASHBOARD_OWNER__/,'single dashboard ownership flag must remain active');
assert.match(live,/scheduleTrendRetry/,'business trend cache misses must retry lightly');
assert.match(live,/missingDates/,'business trend retries must be driven by explicit missing dates');
assert.match(live,/trendRetryCount>=12/,'business trend retries must be bounded');
assert.doesNotMatch(live,/location\.reload\s*\(/,'business owner must never full-page reload while waiting for trend cache');
assert.match(live,/x\[key\]===null\|\|x\[key\]===undefined\?null/,'missing trend values must remain null rather than becoming zero');
assert.match(live,/nullablePct\(x\.firstRate\)/,'missing first-attempt evidence must display dash');

assert.match(home,/v238-home-dashboard-owner-v1/,'homepage/region owner must run the V238 client');
assert.match(home,/businessType=ALL/,'homepage charts must use aggregate V238 trend endpoint');
assert.match(home,/businessType=SHOPEE/,'homepage first-attempt trend must use SHOPEE truth');
assert.match(home,/pod=num\(region\.pod\)/,'dispatch percentages must use POD denominator');
assert.match(home,/REGION_KEYS/,'SHOPEE PP/PV visible cards must have explicit metric mapping');
assert.match(home,/scheduleCurrentRetry/,'stale snapshot-status must not freeze homepage current cards');
assert.match(home,/scheduleTrendRetry/,'homepage missing trend cache must retry without reload');
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
assert.match(legacyNav,/V239_SINGLE_DASHBOARD_OWNER/,'legacy hydratePageData must return without launching routing/CEAF reads on owner dashboards');
assert.match(legacyNav,/if\(ownerActive\(\)\)return \{ok:true,skipped:true,source:'V239_SINGLE_DASHBOARD_OWNER'\}/,'legacy CEAF fast-state request must be retired under owner mode');
assert.match(legacyV89,/v239-retired-by-dashboard-owner-v1/,'legacy V89 summary layer must be retired under owner mode');
assert.match(legacyV89,/if \(ownerActive\(\)\) return global\.__CE_QC_V237_LIVE_CURRENT__ \|\| null/,'legacy V89 fetchSummary must not hit instant-dashboard while owner is active');
assert.match(legacyV89,/V239_V89_RETIRED/,'runtime must log that legacy V89 polling is retired');
assert.match(legacyRouting,/v239-owner-retired-passive-routing-v1/,'legacy routing client must be retired under dashboard owner');
assert.match(legacyRouting,/V239_ROUTING_V48_RETIRED/,'legacy routing retirement must be observable');
assert.match(legacyClosure,/v239-owner-local-closure-v1/,'closure cards must use owner-local arithmetic');
assert.match(legacyClosure,/if\(ownerActive\(\)\)return null/,'closure owner mode must not call the legacy closure summary route');
assert.match(shell,/\/routing-v48\.js\?v=20260823-v239-1/,'owner shell must cache-bust retired routing client');
assert.match(shell,/\/v89-fast-dashboard\.js\?v=20260823-v239-1/,'owner shell must cache-bust retired V89 client');
assert.match(shell,/\/v109-instant-business-navigation\.js\?v=20260823-v239-1/,'owner shell must cache-bust retired hydration client');
assert.match(shell,/\/v133-closure-rate\.js\?v=20260823-v239-1/,'owner shell must cache-bust owner-local closure client');

assert.match(inject,/v238-dashboard-owner-ui-injection-v1/,'delivered HTML must preserve V238 owner compatibility');
assert.match(inject,/v239-dashboard-request-coalescer-ui-v1/,'delivered HTML must enable V239 request coalescing');
assert.match(inject,/v239-dashboard-request-coalescer\.js\?v=20260823-v239-1/,'browser must receive cache-busted V239 coalescer in head');
assert.match(inject,/v235-cache-ready-reload\.js/,'injector must explicitly strip the old cache-ready reload poller');
assert.match(inject,/v234-dashboard-live\.js\?v=20260822-v238-1/,'browser must receive cache-busted V238 business owner');
assert.match(inject,/v237-dashboard-owner-guard\.js\?v=20260822-v238-1/,'browser must receive head-first owner guard');
assert.match(inject,/v237-home-dashboard-owner\.js\?v=20260822-v238-1/,'browser must receive cache-busted V238 homepage owner');
assert.doesNotMatch(inject,/READY_MARKER/,'retired full-page cache poller must not be injected');

assert.match(route,/path==='\/api\/v234\/trends'/,'route patch must own V234 trend endpoint');
assert.match(route,/path==='\/api\/shopee\/state'/,'route patch must pre-handle old compact SHOPEE reads');
assert.match(current,/normalizedDashboardCoverageReady/,'current read must accept complete normalized coverage when snapshot status flag lags');
assert.match(current,/cacheOnly/,'current reader must expose cache-only mode for trend requests');
assert.match(current,/isPod=0 AND isReturned=0/,'terminal CCSL rows must be excluded from current abnormal metrics');
assert.match(current,/COALESCE\(f\.rawJson,''\) LIKE '%1203--派送异常%'/,'nested SHOPEE 1203 evidence must classify as return');
assert.match(cache,/normalizedDashboardCoverageReady/,'cache worker eligibility must use normalized coverage readiness');
assert.match(cache,/isPod=0 AND isReturned=0 AND isCancelled=0/,'terminal SHOPEE rows must be excluded from cached abnormal metrics');
assert.match(trend,/V238_EXACT_DASHBOARD_CACHE_ONLY/,'web trend reader must be exact cache-only');
assert.match(trend,/readV236CurrentSummary\(date,\{cacheOnly:true\}\)/,'trend endpoint must never perform per-day direct normalized scans in web process');
assert.match(runtime,/v239-interactive-first-cache-prime-observable-v1/,'runtime must install V239 observable cache-prime behavior');
assert.match(runtime,/3_000/,'background cache child should start after short first-paint grace period');
assert.match(runtime,/dashboard cache prime child exit code=/,'cache-prime completion/failure must be visible in startup log');
assert.match(runtime,/CE_QC_SKIP_STARTUP_POD_REPAIR/,'startup POD repair must remain outside interactive first paint');
assert.match(worker,/recentCompletedDashboardDates\(7\)/,'child worker must prepare recent seven valid ready dates');
assert.match(worker,/WORKER_LEASE_MS = 5 \* 60_000/,'dashboard cache lease must be bounded to five minutes');
assert.match(worker,/cleared stale dashboard-cache lease/,'worker must recover a crashed stale lease without waiting fifteen minutes');

console.log('[V239] single-owner + coalesced current summary + retired legacy hydration/V89/routing/closure + terminal-safe current + cache-only trend + observable prime smoke passed');
