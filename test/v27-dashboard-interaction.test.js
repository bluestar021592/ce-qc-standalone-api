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

test('V27 client uses lazy details and exposes carryover + SHOPEE attempt interaction', () => {
  const client=fs.readFileSync('public/v27-dashboard-fix.js','utf8');
  const loader=fs.readFileSync('public/v14-geometry-fixture.js','utf8');
  assert.match(loader,/v27-dashboard-fix\.js/);
  assert.match(client,/\/api\/v27\/metric-detail/);
  assert.match(client,/\/api\/v27\/carry-monitor/);
  assert.match(client,/\/api\/v27\/trends/);
  assert.match(client,/遗留异常动态/);
  assert.match(client,/1\/2\/3派成功率趋势/);
  assert.match(client,/pendingNonContinuous/);
  assert.match(client,/attempt:index\+1/);
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
  const carryServer=fs.readFileSync('src/v27CarryBusinessPatch.js','utf8');
  assert.doesNotMatch(carryClient,/new\s+MutationObserver\s*\(/);
  assert.match(carryClient,/carry-monitor-business/);
  assert.match(carryClient,/searchParams\.set\('limit','50'\)/);
  assert.match(carryServer,/Math\.min\(100/);
  assert.match(carryServer,/json_valid/);
  assert.match(carryServer,/Server-Timing/);
});

test('V27 does not replace locked V18 dashboard HTML/CSS files', () => {
  const html=fs.readFileSync('public/index.html','utf8');
  assert.match(html,/homeBusinessCards/);
  assert.match(html,/homeCoreMetrics/);
  assert.match(html,/homeShopeeSpecial/);
  assert.match(html,/homeDispatchDistribution/);
  assert.ok(fs.existsSync('public/dashboard-v18.css'));
  assert.ok(fs.existsSync('public/v16-blue-white-colors.css'));
  assert.ok(fs.existsSync('public/v17-page-lock.css'));
});
