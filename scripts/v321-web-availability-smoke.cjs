const fs = require('fs');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');

const files = [
  'src/v319TrendCacheFastPatch.js',
  'src/v308DeliveryDailyFastPath.js',
  'src/v329ThreeBusinessDailyCache.js',
  'src/v328EvidenceRepairCoordinator.js',
  'scripts/v329-three-business-cache-worker.mjs',
  'src/shopeeHistoricalSigningTruth.js',
  'src/v334GenericTrendRoutePatch.js',
  'public/v320-history-trend-owner.js',
  'public/v308-dashboard-read-bridge.js',
  'public/v328-three-business-attempt-owner.js',
  'public/v295-first-attempt-ui.js',
  'src/v295FirstAttemptUiInjectionPatch.js',
  'src/v308DashboardReadBridgeInjection.js'
];
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

const trend = fs.readFileSync('src/v319TrendCacheFastPatch.js', 'utf8');
const daily = fs.readFileSync('src/v308DeliveryDailyFastPath.js', 'utf8');
const cache = fs.readFileSync('src/v329ThreeBusinessDailyCache.js', 'utf8');
const coordinator = fs.readFileSync('src/v328EvidenceRepairCoordinator.js', 'utf8');
const worker = fs.readFileSync('scripts/v329-three-business-cache-worker.mjs', 'utf8');
const signingTruth = fs.readFileSync('src/shopeeHistoricalSigningTruth.js', 'utf8');
const genericRoute = fs.readFileSync('src/v334GenericTrendRoutePatch.js', 'utf8');
const trendUi = fs.readFileSync('public/v320-history-trend-owner.js', 'utf8');
const dailyUi = fs.readFileSync('public/v308-dashboard-read-bridge.js', 'utf8');
const attemptUi = fs.readFileSync('public/v328-three-business-attempt-owner.js', 'utf8');
const firstUi = fs.readFileSync('public/v295-first-attempt-ui.js', 'utf8');
const inject = fs.readFileSync('src/v295FirstAttemptUiInjectionPatch.js', 'utf8');
const headInject = fs.readFileSync('src/v308DashboardReadBridgeInjection.js', 'utf8');

assert.match(trend, /readV236CurrentSummary\(date,\{cacheOnly:true\}\)/);
assert.match(trend, /ATTEMPT_SET=new Set\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/);
assert.match(trend, /options\.historyAll&&ATTEMPT_SET\.has\(type\)/);
assert.match(trend, /readV308DeliveryDaily\(type,from,to,db,\{historyAll:true\}\)/);
assert.match(trend, /source:'V329_SINGLE_DAY_DASHBOARD_CACHE_ONLY'/);

assert.match(daily, /readV236CurrentSummary\(date\)/, 'V308 must fall back to the selected business own current facts');
assert.doesNotMatch(daily, /readV236CurrentSummary\(date,\{cacheOnly:true\}\)/, 'foreign same-date cache ownership must not create fake zero current metrics');
assert.match(daily, /readV329ThreeBusinessDailyCache/);
assert.match(daily, /requestV328EvidenceRepair/);
assert.match(daily, /strictDailyEvidence/);
assert.match(daily, /attemptSource LIKE 'V246_STRICT_TRACK%'/);
assert.match(daily, /json_extract\(evidenceJson,'\$\.starts\[0\]\.time'\)/, 'current signing days must use saved strict START evidence');
assert.doesNotMatch(daily, /julianday\(podDay\)-julianday\(firstDay\)/, 'first report date must never drive current Shopee signing days');
assert.match(daily, /ppAvgSigningDays/);
assert.match(daily, /pvAvgSigningDays/);
assert.doesNotMatch(daily, /readV328ThreeBusinessHistory|readV320HistoricalDailyWithDispatch/, 'web delivery route must remain free of heavy history reconstruction');

for (const token of [
  'v329_three_business_daily_cache','cacheRevision','firstAttemptEligible','firstAttemptSuccess','firstAttemptUnknownPod',
  'ppSigningDaysSum','ppSigningDaysCount','pvSigningDaysSum','pvSigningDaysCount'
]) assert.ok(cache.includes(token), `three-business cache missing ${token}`);
assert.match(cache,/真实首次派送START时间/);
assert.match(cache,/真实POD时间/);
assert.doesNotMatch(cache,/首次日报锁定日期/);
assert.doesNotMatch(cache, /fetch\(|axios|trackQuery|confirmQuery/);

assert.match(coordinator, /v329-three-business-cache-worker\.mjs/);
assert.match(worker, /v328-three-business-evidence-worker-v2\.mjs/);
assert.doesNotMatch(worker, /readV295FirstAttemptTrends|v295FirstAttemptTruth/, 'history worker must not depend on current VALID V295 truth');
for (const token of [
  'listV328HistoricalMembers','strict(l.attemptSource)','firstAttemptEligible','firstAttemptSuccess','firstAttemptUnknownPod',
  'resolveShopeeHistoricalRegions','resolveShopeeSigningSamples','ppSigningDaysSum','pvSigningDaysSum','writeV329ThreeBusinessDailyCache','cacheVersion:1','cacheVersion:2'
]) assert.ok(worker.includes(token), `history worker missing behavior token ${token}`);
assert.match(signingTruth,/strictLedgerStart/);
assert.match(signingTruth,/inclusive\(start,pod\)/,'historical Shopee signing owner must use the exact same real START-to-POD sample');

assert.match(genericRoute, /V334_GENERIC_CACHE_ONLY/);
assert.doesNotMatch(genericRoute, /readV320HistoricalDaily|readV320HistoricalDailyWithDispatch/);

assert.match(trendUi, /__CE_QC_V328_HISTORY_PAYLOADS__/);
assert.match(trendUi, /function specialCached/);
assert.match(trendUi, /readGenericHistory[\s\S]*history=all/);
assert.doesNotMatch(trendUi, /fetch\(`\/api\/v308\/delivery-daily[^`]*history=all/, 'TBKH/CN/VN history owner must not issue a second V308 history request');
assert.match(trendUi, /setInterval\(enforceHistoryOwner,750\)/);
assert.match(trendUi, /claimV272Ownership/);
assert.match(trendUi, /owner\.rehydrateVisible=function/);

assert.match(dailyUi, /document\.getElementById\('pageTitle'\)/);
for (const label of ['SHOPEE CN', 'SHOPEE VN', 'TBKH']) assert.ok(dailyUi.includes(`title.includes('${label}')`), `V308 SPA title routing missing ${label}`);
assert.match(dailyUi, /location\.pathname/);
assert.match(dailyUi, /history=all/);
assert.match(dailyUi, /\/api\/v328\/evidence-status/);
for (const label of ['平均签收天数', '金边PP平均签收天数', '外省PV平均签收天数', '真实首次派送START']) assert.ok(dailyUi.includes(label), `V308 history UI missing ${label}`);
assert.doesNotMatch(dailyUi,/首次日报锁定日期/,'visible Shopee signing explanation must not advertise the retired first-report timing formula');
assert.match(dailyUi, /ppAvgSigningDays/);
assert.match(dailyUi, /pvAvgSigningDays/);
assert.match(dailyUi, /5000/);
assert.doesNotMatch(dailyUi, /setInterval\(/);

assert.match(attemptUi, /document\.getElementById\('pageTitle'\)/);
for (const label of ['SHOPEE CN', 'SHOPEE VN', 'TBKH']) assert.ok(attemptUi.includes(`t.includes('${label}')`), `V328 SPA title routing missing ${label}`);
assert.match(attemptUi, /location\.pathname/);
assert.match(attemptUi, /__CE_QC_V328_HISTORY_PAYLOADS__/);
assert.match(attemptUi, /1\/2\/3派签收占POD趋势/);
assert.match(firstUi, /cachedHistoryTrend/);
assert.match(firstUi, /__CE_QC_V328_HISTORY_PAYLOADS__/);
assert.match(firstUi, /firstAttemptEligible/);
assert.match(firstUi, /firstAttemptSuccess/);

for (const script of ['v320-history-trend-owner.js', 'v328-three-business-attempt-owner.js', 'v295-first-attempt-ui.js']) assert.ok(inject.includes(script), `UI injection missing ${script}`);
assert.ok(headInject.includes('v308-dashboard-read-bridge.js'), 'head injection must deliver V308 dashboard bridge');
assert.match(headInject, /X-CE-QC-V308-UI/);

console.log('[V321] web availability behavior gate passed · per-business current truth · strict START/POD signing · PP/PV signing · shared cache-only history · SPA title ownership · no release-name coupling');
