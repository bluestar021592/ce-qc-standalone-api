import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

function loadAdapter() {
  const window = {};
  const context = vm.createContext({ window, console });
  vm.runInContext(fs.readFileSync(path.join(publicDir, 'dashboard-fixture-v18.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(publicDir, 'dashboard-data-adapter-v18.js'), 'utf8'), context);
  return window.DashboardDataAdapterV18;
}

test('V18 missing trend dates remain null and last value ignores gaps', () => {
  const adapter = loadAdapter();
  const values = adapter.values([10, { value: 11, hasData: true }, { value: 0, hasData: false }, null, 12]);
  assert.deepEqual(Array.from(values), [10, 11, null, null, 12]);
  assert.equal(adapter.last(values), 12);
});

test('V18 home preserves all seven business cards including ALI1688', () => {
  const adapter = loadAdapter();
  const businessCards = [
    ['total','总览',9540], ['ce','CE',2781], ['ceaf','CEAF空运',0], ['tbkh','TBKH',2067],
    ['shopeecn','SHOPEE CN',0], ['shopeevn','SHOPEE VN',4457], ['ali1688','ALI1688',235]
  ].map(([key,label,value]) => ({ key, label, value }));
  const model = adapter.mapSnapshotToDashboardModel({ businessCards, coreMetrics: [], topKpis: [] }, false);
  assert.equal(model.cards.length, 7);
  assert.equal(model.cards.at(-1).key, 'ali1688');
  assert.equal(model.cards.at(-1).value, 235);
});

test('V18 uses independent component files and clips chart drawing', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const chart = fs.readFileSync(path.join(publicDir, 'dashboard-chart-v18.js'), 'utf8');
  const css = fs.readFileSync(path.join(publicDir, 'dashboard-v18.css'), 'utf8');
  for (const file of ['dashboard-fixture-v18.js', 'dashboard-data-adapter-v18.js', 'dashboard-chart-v18.js', 'dashboard-v18.js']) {
    assert.match(html, new RegExp(file.replace('.', '\\.')));
  }
  assert.match(chart, /clipPath/);
  assert.match(chart, /lastValidSeriesValue|DashboardDataAdapterV18\.last/);
  assert.match(chart, /rawDate\.length > 5/);
  assert.match(chart, /placedLabels\.some/);
  assert.match(css, /\.v18-chart-plot\{[^}]*overflow:hidden/);
});

test('completed business snapshot wins over stale run-progress guard', () => {
  const dashboard = fs.readFileSync(path.join(publicDir, 'dashboard-v18.js'), 'utf8');
  assert.match(dashboard, /hasCompletedBusinessSnapshot/);
  assert.match(dashboard, /\/api\/business-state\/\$\{encodeURIComponent\(type\)\}\?compact=1/);
  assert.match(dashboard, /snapshotStatus === 'COMPLETED'/);
  assert.match(dashboard, /if \(await hasCompletedBusinessSnapshot\(model\)\) return;/);
});

test('unified Shopee pages prefer the latest completed business snapshot', () => {
  const store = fs.readFileSync(path.join(__dirname, '..', 'src', 'unifiedImportStore.js'), 'utf8');
  assert.match(store, /getMatchingBusinessSnapshot\(SHOPEE, liveState\)/);
  assert.match(store, /completedShopeeSnapshot\?\.reconciliationStatus === 'COMPLETED'/);
  assert.match(store, /completedShopeeState\s*\?\s*filterMembers\(completedShopeeState\.finalRows\)/);
});

test('V18 navigation contract has thirteen unique labels', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const labels = ['首页总看板','CE看板','TBKH看板','ALI1688看板','SHOPEE CN看板','SHOPEE VN看板','数据导入','轨迹查询','异常明细','报表导出','数据管理','系统设置','操作日志'];
  for (const label of labels) assert.match(app, new RegExp(`'${label}'`));
  assert.equal(new Set(labels).size, 13);
});

test('V18 normalizes object-shaped final rows and keeps dashboard metrics in Shopee export', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const reporting = fs.readFileSync(path.join(__dirname, '..', 'src', 'shopeeReporting.js'), 'utf8');
  const exporter = fs.readFileSync(path.join(__dirname, '..', 'src', 'shopeeExporter.js'), 'utf8');
  assert.match(app, /function normalizedFinalRows/);
  assert.match(app, /Object\.values\(value\)/);
  assert.match(reporting, /cycle2plus/);
  assert.match(exporter, /metrics\.cycle2plus/);
});

test('startup uses compact summaries and renders only the visible page', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(app, /api\/state\$\{needsFullAggregate \? '' : '\?compact=1'\}/);
  assert.match(app, /if \(currentPage === 'home'\) renderHome\(\)/);
  assert.match(app, /hydratePageData\(currentPage\)/);
  assert.match(server, /function compactDashboardState/);
});

test('business dashboard keeps a real detail preview target for metric navigation', () => {
  const dashboard = fs.readFileSync(path.join(publicDir, 'dashboard-v18.js'), 'utf8');
  assert.match(dashboard, /shopeePreviewPanel/);
  assert.match(dashboard, /ccslPreviewPanel/);
  assert.match(dashboard, /v18-detail-preview/);
});

test('business dashboard loads the exact V58 drilldown runtime before user interaction', () => {
  const dashboard = fs.readFileSync(path.join(publicDir, 'dashboard-v18.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(publicDir, 'v58-drilldown-runtime.js'), 'utf8');
  assert.match(dashboard, /v58-drilldown-runtime\.js\?v=20260811-v61-1/);
  assert.match(dashboard, /script\.async=false/);
  assert.match(runtime, /'金边门店':'phnomPenhShop'/);
  assert.match(runtime, /\/api\/v55\/metric-detail/);
  assert.match(runtime, /PATH_TYPES=new Map\(\[\['\/ce','CE'\]/);
});

test('business dashboards expose mutually exclusive accounting buckets', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(publicDir, 'dashboard-v18.js'), 'utf8');
  assert.match(app, /function businessAccounting/);
  assert.match(app, /total - pod - returned - open/);
  assert.match(app, /\['已退回件', accounting\.returned/);
  assert.match(app, /\['当前未闭环', accounting\.open/);
  assert.match(app, /占本业务.*toFixed\(2\).*%/);
  assert.match(dashboard, /row\.ratio\|\|'占总票数 0\.00%'/);
});

test('dashboard ratios are explicit and completed history drives trend lines', () => {
  const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const chart = fs.readFileSync(path.join(publicDir, 'dashboard-chart-v18.js'), 'utf8');
  assert.match(app, /占总票数/);
  assert.match(app, /state\.historySummary/);
  assert.match(app, /preferHistory\('podRate'/);
  assert.match(chart, /segment\.length >= 2/);
  assert.doesNotMatch(chart, /占比可追溯/);
});
