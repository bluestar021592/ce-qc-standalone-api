import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('V27 server routes and fast bootstrap are installed before server start', () => {
  const bootstrap=fs.readFileSync('bootstrap.js','utf8');
  const serverPatch=fs.readFileSync('src/v27ServerPatch.js','utf8');
  const trendPatch=fs.readFileSync('src/v27TrendPatch.js','utf8');
  assert.match(bootstrap,/v27ServerPatch\.js/);
  assert.match(bootstrap,/v27TrendPatch\.js/);
  assert.ok(bootstrap.indexOf('v27ServerPatch.js') < bootstrap.indexOf("import('./server.js')"));
  assert.match(serverPatch,/\/api\/v27\/metric-detail/);
  assert.match(serverPatch,/\/api\/v27\/carry-monitor/);
  assert.match(serverPatch,/v27BootstrapHandler/);
  assert.match(trendPatch,/\/api\/v27\/trends/);
});

test('V28 SHOPEE resume deletes persisted batch audit hashes but preserves per-waybill checkpoints', () => {
  const bootstrap=fs.readFileSync('bootstrap.js','utf8');
  const resumePatch=fs.readFileSync('src/v28ResumeGuardPatch.js','utf8');
  assert.match(bootstrap,/v28ResumeGuardPatch\.js/);
  assert.ok(bootstrap.indexOf('v28ResumeGuardPatch.js') < bootstrap.indexOf("import('./server.js')"));
  assert.match(resumePatch,/\/api\/shopee\/run\/resume/);
  assert.match(resumePatch,/DELETE FROM business_api_batches/);
  assert.match(resumePatch,/apiBatchStatus/);
  assert.doesNotMatch(resumePatch,/saveBusinessState\s*\(/);
  assert.match(resumePatch,/Invalid string length/);
  assert.match(resumePatch,/business_run_locks/);
  assert.doesNotMatch(resumePatch,/scanQueryStatus\s*=\s*\[\]/);
  assert.doesNotMatch(resumePatch,/eventQueryStatus\s*=\s*\[\]/);
  assert.doesNotMatch(resumePatch,/exceptionQueryStatus\s*=\s*\[\]/);
  assert.doesNotMatch(resumePatch,/podLocks\s*=\s*\[\]/);
});

test('V28 trends use up to seven completed valid report dates for a single-day dashboard', () => {
  const trendPatch=fs.readFileSync('src/v27TrendPatch.js','utf8');
  assert.match(trendPatch,/function resolveTrendWindow/);
  assert.match(trendPatch,/s\.status='COMPLETED'/);
  assert.match(trendPatch,/b\.status='VALID'/);
  assert.match(trendPatch,/LIMIT 7/);
  assert.match(trendPatch,/b\.reportDate<=\?/);
  assert.match(trendPatch,/loadRangeDashboard\(trendWindow\.from,trendWindow\.to\)/);
  assert.match(trendPatch,/attemptRows\(trendWindow\.from,trendWindow\.to\)/);
  assert.match(trendPatch,/trendWindowDates/);
});

test('V29 metric detail follows latest VALID import even before snapshot completion', () => {
  const bootstrap=fs.readFileSync('bootstrap.js','utf8');
  const rules=fs.readFileSync('src/v29BusinessRulesPatch.js','utf8');
  const aliases=fs.readFileSync('src/v29EndpointAliasPatch.js','utf8');
  assert.match(bootstrap,/v29BusinessRulesPatch\.js/);
  assert.match(bootstrap,/v29EndpointAliasPatch\.js/);
  assert.match(rules,/LATEST_VALID_IMPORT_V29/);
  assert.match(rules,/b\.status='VALID'/);
  assert.doesNotMatch(rules,/INNER JOIN unified_snapshots s[\s\S]{0,120}s\.status='COMPLETED'/);
  assert.match(rules,/pendingNonContinuous/);
  assert.match(rules,/shopStuck/);
  assert.match(aliases,/\/api\/v29\/metric-detail/);
  assert.match(aliases,/\/api\/v27\/metric-detail/);
});

test('V29 carry monitor heals terminal normal states and publishes only business abnormalities', () => {
  const rules=fs.readFileSync('src/v29BusinessRulesPatch.js','utf8');
  assert.match(rules,/healCarryTerminalRows/);
  assert.match(rules,/RETURN_COMPLETED/);
  assert.match(rules,/CEZT_RETENTION/);
  assert.match(rules,/CCSL580_RETENTION/);
  assert.match(rules,/三次Pending后未正常闭环/);
  assert.match(rules,/Pending不连续/);
  assert.match(rules,/OC2天\+/);
  assert.match(rules,/门店滞留2天\+/);
  assert.match(rules,/3天\+无新节点/);
  assert.match(rules,/BUSINESS_ABNORMAL_ONLY_V29/);
});

test('V27/V29 client uses lazy details and exposes carryover + SHOPEE attempt interaction', () => {
  const client=fs.readFileSync('public/v27-dashboard-fix.js','utf8');
  const v29Loader=fs.readFileSync('public/v29-data-consistency-fix.js','utf8');
  const v29Core=fs.existsSync('public/v29-data-consistency-core.js') ? fs.readFileSync('public/v29-data-consistency-core.js','utf8') : v29Loader;
  const v29=`${v29Loader}\n${v29Core}`;
  const loader=fs.readFileSync('public/v14-geometry-fixture.js','utf8');
  assert.match(loader,/v27-dashboard-fix\.js/);
  assert.match(loader,/v29-data-consistency-fix\.js/);
  assert.match(client,/\/api\/v27\/metric-detail/);
  assert.match(client,/\/api\/v27\/carry-monitor/);
  assert.match(client,/\/api\/v27\/trends/);
  assert.match(client,/遗留异常动态/);
  assert.match(client,/1\/2\/3派成功率趋势/);
  assert.match(v29,/\/api\/v29\/metric-detail/);
  assert.match(v29,/Pending不连续/);
  assert.match(v29,/外省未完结POD件/);
});

test('V27 forced trend mount cannot create a DOM mutation render loop', () => {
  const mountFix=fs.readFileSync('public/v27-trend-mount-fix.js','utf8');
  assert.doesNotMatch(mountFix,/new\s+MutationObserver\s*\(/);
  assert.match(mountFix,/v27TrendKey/);
  assert.match(mountFix,/v27TrendState/);
  assert.match(mountFix,/if\(!force&&section\.dataset\.v27TrendKey===key&&section\.dataset\.v27TrendState==='ready'\)return/);
  assert.match(mountFix,/topRangeQuery/);
});

test('V27 carry business filter cannot create a DOM mutation loop and caps first payload', () => {
  const carryClient=fs.readFileSync('public/v27-carry-business-filter.js','utf8');
  assert.doesNotMatch(carryClient,/new\s+MutationObserver\s*\(/);
  assert.match(carryClient,/carry-monitor-business/);
  assert.match(carryClient,/searchParams\.set\('limit','50'\)/);
  assert.match(carryClient,/\/api\/v29\/carry-monitor/);
});

test('V18 trend renderer tolerates series without tooltip numerator metadata', () => {
  const chart=fs.readFileSync('public/dashboard-chart-v18.js','utf8');
  assert.match(chart,/numerators:\s*Array\.isArray\(series\?\.numerators\)/);
  assert.match(chart,/denominators:\s*Array\.isArray\(series\?\.denominators\)/);
  assert.match(chart,/dates:\s*Array\.isArray\(chart\?\.dates\)/);
});

test('V29 does not replace locked V18 dashboard HTML/CSS files', () => {
  const html=fs.readFileSync('public/index.html','utf8');
  assert.match(html,/homeBusinessCards/);
  assert.match(html,/homeCoreMetrics/);
  assert.match(html,/homeShopeeSpecial/);
  assert.match(html,/homeDispatchDistribution/);
  assert.ok(fs.existsSync('public/dashboard-v18.css'));
  assert.ok(fs.existsSync('public/v16-blue-white-colors.css'));
  assert.ok(fs.existsSync('public/v17-page-lock.css'));
});
