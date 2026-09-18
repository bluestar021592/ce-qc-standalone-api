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

for(const [name,source] of [['v234-dashboard-live',live],['v237-home-dashboard-owner',home],['v237-dashboard-owner-guard',guard],['v239-dashboard-request-coalescer',coalescer],['v253-dashboard-fast-owner',fastOwner]]) assert.doesNotThrow(()=>new Function(source),`${name} must compile as browser JavaScript`);

assert.match(guard,/__CE_QC_V237_DASHBOARD_OWNER__=true/,'head guard must still declare dashboard ownership');
assert.match(guard,/\/api\\\/v27\\\/trends/,'legacy V27 trend reads must remain retired on owner pages');
assert.match(guard,/\/api\\\/v55\\\/reconciliation/,'legacy passive reconciliation must remain retired on owner pages');
assert.match(route,/path\s*===\s*'\/api\/v234\/trends'/,'authenticated V234 trend registration point must remain present');
assert.match(route,/path\s*===\s*'\/api\/shopee\/state'/,'compact Shopee state ownership must remain present');
assert.match(coalescer,/CACHE_MS=15_000/,'current-summary reads must remain coalesced');

assert.match(current,/out\.ocRate=pct\(out\.ocCurrent,out\.total\)/,'OC rate must remain current OC / daily total');
assert.match(current,/out\.sameDayPodRate=pct\(out\.sameDayPod,out\.total\)/,'same-day POD rate must remain same-day POD / daily total');
assert.match(current,/latestBatchForType\(date,type\)/,'current cards must select latest VALID snapshots independently per business');
assert.match(current,/PER_BUSINESS_LATEST_VALID/,'current summary must expose per-business source ownership');
assert.match(cache,/AS ocCurrent/,'legacy cache maintenance must retain current OC evidence');
assert.match(cache,/AS sameDayPod/,'legacy cache maintenance must retain same-day POD evidence');
assert.match(trend,/V240_EXACT_DAILY_RATE_CACHE_ONLY/,'legacy cache reader remains available as maintenance/fallback evidence');

assert.match(current,/SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP'/,'V236 WHPP summary must start from the dedicated standard daily header');
assert.match(current,/COUNT\(DISTINCT shipmentCode\)[\s\S]*business_daily_parse_rows WHERE businessType='WHPP'/,'V236 must verify the exact distinct WHPP member count');
assert.match(current,/if\(expected!==actual\)[\s\S]*out\.membershipIncomplete=true[\s\S]*WHPP_STANDARD_DAILY_INCOMPLETE/,'V236 must mark 236\/235 as incomplete instead of merging historical metrics');
assert.match(current,/membershipSource=expected===0\?'WHPP_STANDARD_DAILY_ZERO':'WHPP_STANDARD_DAILY'/,'V236 must keep exact 0\/0 as a real current truth');
assert.match(route,/const singleDayRequest=!from\|\|from===to/,'reportDate and equivalent from=to requests must share single-day WHPP safety semantics');
assert.match(route,/if\(singleDayRequest&&data\.whpp\?\.membershipIncomplete\)[\s\S]*res\.status\(409\)/,'single-day V234 current-summary must expose WHPP membership damage as 409');
assert.match(route,/loadRangeDashboard\(from,to\)/,'multi-day current cards must use canonical range dashboard truth');
assert.match(route,/V419_CANONICAL_PERIOD_DASHBOARD_RANGE/,'multi-day current summary must disclose canonical range ownership');
assert.match(route,/function statePayload\(type,req,res\)[\s\S]*data\.business\[type\]/,'six-business compact states must continue reading their own metrics independently of WHPP');
assert.doesNotMatch(route,/function statePayload\(type,req,res\)[\s\S]*membershipIncomplete[\s\S]*return res\.json/,'WHPP damage must not be injected as a blocker into per-business compact state responses');

assert.match(runtime,/import '\.\/v253DashboardFastPath\.js';/,'V253 fast backend must activate before server registration');
assert.match(runtime,/CE_QC_BACKGROUND_MAINTENANCE_ENABLED[\s\S]*!== '1'/,'dashboard cache maintenance must be opt-in and disabled on normal startup');
assert.match(runtime,/DASHBOARD_CACHE_MAINTENANCE_DISABLED/,'normal startup must explicitly skip the delayed dashboard cache child');
assert.match(runtime,/MAX_PRIME_ATTEMPTS\s*=\s*4/,'opt-in maintenance retry count must remain bounded');
assert.match(runtime,/dashboard cache prime child exit code=/,'delayed cache maintenance must remain observable');
assert.match(runtime,/CE_QC_SKIP_STARTUP_POD_REPAIR/,'startup POD repair must remain outside interactive first paint');
assert.doesNotMatch(fastPath,/dashboard_daily_cache/,'V253 visible first-paint path must not trust legacy global dashboard cache');
assert.match(fastPath,/V253_V335_FIRST_PAINT_ID='2026-08-27-v335-per-business-first-paint-v1'/,'V253 must expose V335 per-business first-paint ownership');
assert.match(fastPath,/readV236CurrentSummary/,'same-day V253 truth must reuse per-business V236 current truth');
assert.match(fastPath,/PER_BUSINESS_SINGLE_DAY_FIRST_PAINT_NO_HISTORY_SCAN/,'same-day V253 must not scan saved history');
assert.match(fastPath,/readV284DashboardTrends/,'explicit multi-day ranges may use canonical daily membership truth');
assert.doesNotMatch(fastPath,/function latestBatches\(/,'retired one-global-snapshot-per-date helper must not return');
assert.doesNotMatch(fastPath,/PARTITION BY reportDate ORDER BY createdAt DESC/,'same-date businesses must never share one global latest snapshot');
assert.match(fastPath,/!registered\s*&&\s*path\s*===\s*'\/api\/v234\/trends'/,'V253 endpoints must register only when the authenticated dashboard route is registered');

assert.match(inject,/v253-dashboard-fast-owner\.js\?v=20260823-v253-1/,'V253 compatibility source marker must remain available');
assert.match(inject,/V253_FAST_MARKER/,'V253 final owner must be injected into delivered HTML');
assert.match(inject,/['"]v237-home-dashboard-owner\.js['"]/,'legacy V237 home DOM writer must be stripped from delivered HTML');
assert.match(inject,/X-CE-QC-V253-UI/,'V253 delivery must be observable in response headers');
assert.match(fastOwner,/\/api\/v89\/instant-dashboard/,'legacy slow first-paint summary must be intercepted');
assert.match(fastOwner,/\/api\/v253\/instant-dashboard/,'first-paint summary must use V253');
assert.match(fastOwner,/\/api\/v234\/trends/,'legacy cache-dependent trend reads must be intercepted');
assert.match(fastOwner,/\/api\/v253\/trends/,'visible same-day fast reads must use V253 before V334 history owner paints saved trends');
assert.match(fastOwner,/removeHomeLegacyAttempts/,'obsolete homepage dual attempt charts must be removed');
assert.match(fastOwner,/\/api\/period-dashboard\?from=/,'homepage visible totals must use the selected canonical from/to range');

assert.match(worker,/WORKER_LEASE_MS\s*=\s*5\s*\*\s*60_000/,'dashboard cache lease must remain bounded to five minutes');
assert.match(worker,/cleared stale dashboard-cache lease/,'worker must still recover stale cache leases');

console.log('[V419/V335/V253] per-business single-day safety + canonical multi-day range + membership-safe WHPP summary + one delivered visual owner passed');
