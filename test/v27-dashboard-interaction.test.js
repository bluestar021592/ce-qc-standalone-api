import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path){return fs.readFileSync(path,'utf8');}

test('V27 server routes and fast bootstrap are installed before server start',()=>{
  const bootstrap=read('bootstrap.js');
  const patch=read('src/v27ServerPatch.js');
  assert.match(bootstrap,/v27ServerPatch\.js/);
  assert.match(bootstrap,/server\.js/);
  assert.ok(bootstrap.indexOf('v27ServerPatch.js')<bootstrap.indexOf('server.js'));
  assert.match(patch,/\/api\/v27\/metric-detail/);
  assert.match(patch,/\/api\/v27\/carry-monitor/);
  assert.match(patch,/\/api\/v27\/trends/);
  assert.match(patch,/\/api\/v27\/bootstrap/);
});

test('V28 SHOPEE resume deletes persisted batch audit hashes but preserves per-waybill checkpoints',()=>{
  const patch=read('src/v28ResumeGuardPatch.js');
  assert.match(patch,/DELETE FROM business_api_batches/);
  assert.match(patch,/SHOPEE/);
  assert.doesNotMatch(patch,/DELETE FROM business_api_query_status/);
});

test('V28 trends use up to seven completed valid report dates for a single-day dashboard',()=>{
  const patch=read('src/v27TrendPatch.js');
  assert.match(patch,/LIMIT 7/);
  assert.match(patch,/COMPLETED/);
  assert.match(patch,/VALID/);
});

test('V29 metric detail follows latest VALID import even before snapshot completion',()=>{
  const patch=read('src/v29DataConsistencyPatch.js');
  assert.match(patch,/VALID/);
  assert.match(patch,/metric-detail/);
});

test('V29 carry monitor heals terminal normal states and publishes only business abnormalities',()=>{
  const rules=read('src/v29BusinessRulesPatch.js');
  assert.match(rules,/SELF_PICKUP/);
  assert.match(rules,/CECN_RETENTION/);
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
  const client=read('public/v27-dashboard-fix.js');
  const v29Loader=read('public/v29-data-consistency-fix.js');
  const v29Core=fs.existsSync('public/v29-data-consistency-core.js')?read('public/v29-data-consistency-core.js'):v29Loader;
  const v29=`${v29Loader}\n${v29Core}`;
  const loader=read('public/v14-geometry-fixture.js');
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
  const mountFix=read('public/v27-trend-mount-fix.js');
  assert.doesNotMatch(mountFix,/new\s+MutationObserver\s*\(/);
  assert.match(mountFix,/v27TrendKey/);
  assert.match(mountFix,/v27TrendState/);
  assert.match(mountFix,/if\(!force&&section\.dataset\.v27TrendKey===key&&section\.dataset\.v27TrendState==='ready'\)return/);
  assert.match(mountFix,/topRangeQuery/);
});

test('V27 carry business filter cannot create a DOM mutation loop and caps first payload', () => {
  const filter=read('public/v27-carry-business-filter.js');
  assert.doesNotMatch(filter,/new\s+MutationObserver\s*\(/);
  assert.match(filter,/limit=100/);
  assert.match(filter,/v27CarryLoadedAt/);
});

test('V18 trend renderer tolerates series without tooltip numerator metadata', () => {
  const chart=read('public/dashboard-chart-v18.js');
  assert.match(chart,/point\.numerator/);
  assert.match(chart,/point\.denominator/);
});

test('V29 does not replace locked V18 dashboard HTML/CSS files', () => {
  const html=read('public/index.html');
  const css=read('public/styles.css');
  assert.match(html,/CE EXPRESS/);
  assert.match(css,/sidebar/);
});
