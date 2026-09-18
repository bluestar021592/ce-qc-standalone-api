const fs = require('fs');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');

const files = [
  'src/v319TrendCacheFastPatch.js',
  'src/v308DeliveryDailyFastPath.js',
  'src/v329ThreeBusinessDailyCache.js',
  'src/historyCacheCoordinators.js',
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
const canonicalCoordinator = fs.readFileSync('src/historyCacheCoordinators.js', 'utf8');
const coordinatorCompat = fs.readFileSync('src/v328EvidenceRepairCoordinator.js', 'utf8');
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
assert.match(trend, /if\(ATTEMPT_SET\.has\(type\)\)/);
assert.match(trend, /return attemptHistory\(type,from,to,db,Boolean\(options\.historyAll\)\)/,'three-business history must remain a direct saved V329-cache read');
assert.doesNotMatch(trend, /readV308DeliveryDaily|readV328ThreeBusinessHistory|requestV328EvidenceRepair/,'V319 browser trend GET must not enter V308 or evidence repair paths');
assert.match(trend, /V329_SINGLE_DAY_DASHBOARD_PLUS_SAVED_ATTEMPT_CACHE/);
assert.match(trend, /V329_SAVED_DERIVED_CACHE_READ_ONLY|READ_ONLY_SAVED_CACHE/);

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

assert.match(coordinatorCompat, /from '\.\/historyCacheCoordinators\.js'/, 'V328 compatibility entry must point to the single canonical coordinator owner');
assert.doesNotMatch(coordinatorCompat, /node:child_process|fork\(|DELETE FROM|setTimeout\(/, 'V328 compatibility entry must not retain a duplicate coordinator implementation');
assert.match(canonicalCoordinator, /HISTORY_CACHE_COORDINATORS_ID='2026-09-02-unified-history-cache-coordinators-v1'/);
assert.match(canonicalCoordinator, /function createCoordinator\(config\)/);
assert.match(canonicalCoordinator, /v329-three-business-cache-worker\.mjs/);
assert.match(canonicalCoordinator, /const WORKER_TIMEOUT_MS=120_000/);
assert.match(canonicalCoordinator, /REPORT_DATE_ONLY/);
assert.match(canonicalCoordinator, /ALL_HISTORY/);
assert.match(worker, /THREE_BUSINESS_HISTORY_WORKER_ID='2026-09-02-single-process-three-business-history-worker-v1'/);
assert.match(worker, /repairHistoricalEvidence/);
assert.match(worker, /analyzeV246ShopeeAttemptCycle/);
assert.doesNotMatch(worker, /node:child_process|fork\(|v328-three-business-evidence-worker/, 'history cache owner must perform saved evidence repair in the same isolated worker instead of spawning another patch worker');
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

console.log('[V321] web availability behavior gate passed · canonical history coordinator · one three-business history worker process · strict START/POD signing · PP/PV signing · shared cache-only history · SPA title ownership · no duplicate patch worker');