const fs=require('fs');
const assert=require('assert/strict');
const read=p=>fs.readFileSync(p,'utf8');

const live=read('public/v234-dashboard-live.js');
const home=read('public/v237-home-dashboard-owner.js');
const guard=read('public/v237-dashboard-owner-guard.js');
const coalescer=read('public/v239-dashboard-request-coalescer.js');
const fastOwner=read('public/v253-dashboard-fast-owner.js');
const inject=read('src/v231MetricTruthUiInjectionPatch.js');
const route=read('src/v236DashboardCurrentRoutePatch.js');
const current=read('src/v236DashboardCurrentRead.js');
const cache=read('src/v235DashboardCurrentCache.js');
const trend=read('src/v237DashboardTrendRead.js');
const runtime=read('src/v206InteractiveFirstRuntimePatch.js');
const fastPath=read('src/v253DashboardFastPath.js');
const worker=read('src/dashboardCacheWorker.js');

for(const [name,source] of [
  ['v234-dashboard-live',live],
  ['v237-home-dashboard-owner',home],
  ['v237-dashboard-owner-guard',guard],
  ['v239-dashboard-request-coalescer',coalescer],
  ['v253-dashboard-fast-owner',fastOwner]
]) assert.doesNotThrow(()=>new Function(source),`${name} must compile as browser JavaScript`);

// Retain the established single-owner/authenticated dashboard contract.
assert.match(guard,/__CE_QC_V237_DASHBOARD_OWNER__=true/,'head guard must still declare dashboard ownership');
assert.match(guard,/\/api\\\/v27\\\/trends/,'legacy V27 trend reads must remain retired on owner pages');
assert.match(guard,/\/api\\\/v55\\\/reconciliation/,'legacy passive reconciliation must remain retired on owner pages');
assert.match(route,/path==='\/api\/v234\/trends'/,'authenticated V234 trend registration point must remain present');
assert.match(route,/path==='\/api\/shopee\/state'/,'compact Shopee state ownership must remain present');
assert.match(coalescer,/CACHE_MS=15_000/,'current-summary reads must remain coalesced');

// Preserve metric definitions. V253 changes the read path, not the business denominator.
assert.match(current,/out\.ocRate=pct\(out\.ocCurrent,out\.total\)/,'OC rate must remain current OC / daily total');
assert.match(current,/out\.sameDayPodRate=pct\(out\.sameDayPod,out\.total\)/,'same-day POD rate must remain same-day POD / daily total');
assert.match(cache,/AS ocCurrent/,'cache maintenance must retain current OC evidence');
assert.match(cache,/AS sameDayPod/,'cache maintenance must retain same-day POD evidence');
assert.match(trend,/V240_EXACT_DAILY_RATE_CACHE_ONLY/,'legacy cache reader remains available as maintenance/fallback evidence');

// V253 owns visible first paint. It must not wait for dashboard_daily_cache.
assert.match(runtime,/import '\.\/v253DashboardFastPath\.js';/,'V253 fast backend must activate before server registration');
assert.match(runtime,/primeDashboardCacheInChild\(delayMs = 60_000\)/,'cache maintenance must be delayed away from first paint');
assert.match(runtime,/MAX_PRIME_ATTEMPTS = 4/,'delayed maintenance retry count must remain bounded');
assert.match(runtime,/dashboard cache prime child exit code=/,'delayed cache maintenance must remain observable');
assert.match(runtime,/CE_QC_SKIP_STARTUP_POD_REPAIR/,'startup POD repair must remain outside interactive first paint');
assert.doesNotMatch(fastPath,/dashboard_daily_cache/,'V253 visible trend path must be cache-independent');
assert.match(fastPath,/V253_BULK_NORMALIZED_READ_NO_DASHBOARD_CACHE/,'V253 must expose cache-independent trend ownership');
assert.match(fastPath,/path === '\/api\/v234\/trends'/,'V253 endpoints must register only when the authenticated dashboard route is registered');

// V253 must arrive in <head> before older dashboard clients and redirect their slow reads.
assert.match(inject,/v253-dashboard-fast-owner\.js\?v=20260823-v253-1/,'V253 owner must be cache-busted into delivered HTML');
assert.match(inject,/X-CE-QC-V253-UI/,'V253 delivery must be observable in response headers');
assert.match(fastOwner,/\/api\/v89\/instant-dashboard/,'legacy slow first-paint summary must be intercepted');
assert.match(fastOwner,/\/api\/v253\/instant-dashboard/,'first-paint summary must use V253');
assert.match(fastOwner,/\/api\/v234\/trends/,'legacy cache-dependent trend reads must be intercepted');
assert.match(fastOwner,/\/api\/v253\/trends/,'visible trend reads must use V253');
assert.match(fastOwner,/sessionStorage/,'repeat navigation must reuse last confirmed data while refreshing');
assert.match(fastOwner,/removeHomeLegacyAttempts/,'obsolete homepage dual attempt charts must be removed');

// The old cache worker remains a bounded background maintenance job only.
assert.match(worker,/WORKER_LEASE_MS = 5 \* 60_000/,'dashboard cache lease must remain bounded to five minutes');
assert.match(worker,/cleared stale dashboard-cache lease/,'worker must still recover stale cache leases');

console.log('[V253/V247] cache-independent first paint + retained V240 metric contract + single-owner performance guards passed');
