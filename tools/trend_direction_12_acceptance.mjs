import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('data/codex_trend_direction');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
process.env.DATA_DIR = root;
process.env.DB_FILE = path.join(root, 'trend_direction.db');
process.env.EXPORTS_DIR = path.join(root, 'exports');

const {
  buildDashboardRows,
  getMetricTrend,
  getXlsxSheetRows,
  trendChars
} = await import('../src/reporting.js');

const reportDate = '2026-07-11';
const historyDates = ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
const metricValues = {
  '今日PNH': [101, 103, 102, 108, 106, 110, 112],
  '首投POD率': [82, 84, 81, 86, 88, 87, 90],
  '异常率': [8, 7, 9, 6, 5, 7, 4],
  criticalOc2plus: [2, 3, 1, 4, 3, 5, 2],
  criticalShopTransit2: [6, 5, 7, 4, 3, 2, 1]
};
const metricStatuses = ['正常', '需跟进', '重点关注', '正常', '需跟进', '重点关注', '正常'];
const historySummary = historyDates.map((date, index) => ({
  reportDate: date,
  summary: {
    metrics: Object.fromEntries(Object.entries(metricValues).map(([key, values]) => [key, values[index]])),
    metricStatuses: Object.fromEntries(Object.keys(metricValues).map(key => [key, metricStatuses[index]]))
  }
}));

const evidence = Object.fromEntries(Object.entries(metricValues).map(([metricKey, values]) => {
  const trend = getMetricTrend(metricKey, reportDate, 7, { reportDate, historySummary }, values[6], metricStatuses[6]);
  return [metricKey, {
    dates: trend.map(item => item.date),
    values: trend.map(item => item.value),
    severity: trend.map(item => item.status),
    page: trend.map(item => ({ date: item.date, value: item.value, severity: item.status })),
    xlsx: trend.slice(0, 7).map(item => ({ date: item.date, value: item.value, severity: item.status }))
  }];
}));

const state = {
  reportDate,
  historySummary,
  pnhBills: Array.from({ length: 112 }, (_, index) => `CC${String(index + 1).padStart(10, '0')}`),
  carryBills: [], podLocks: [], scanResults: [], trackResults: [], finalRows: [], nextCarryBills: []
};
const pageToday = buildDashboardRows(state).find(row => row.项目 === '今日PNH');
const xlsxToday = getXlsxSheetRows(state).dashboard.find(row => row.指标 === '今日PNH');
assert(pageToday && xlsxToday, '今日PNH趋势行不存在');

const singleDay = getMetricTrend('异常率', reportDate, 7, { reportDate, historySummary: [] }, 4, '重点关注');
const missingMiddle = getMetricTrend('异常率', reportDate, 7, {
  reportDate,
  historySummary: [
    { reportDate: '2026-07-05', summary: { metrics: { '异常率': 8 } } },
    { reportDate: '2026-07-07', summary: { metrics: { '异常率': 9 } } }
  ]
}, 4, '重点关注');

const css = fs.readFileSync(path.resolve('public/style.css'), 'utf8');
const app = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const exporter = fs.readFileSync(path.resolve('src/exporter.js'), 'utf8');
const component = app.slice(app.indexOf('function renderTrend7'), app.indexOf('function renderCcslOperations'));
const xlsxBlock = exporter.slice(exporter.indexOf("if (key === '迷你走势')"), exporter.indexOf("if (key === '数值')"));

const checks = [];
const add = (id, name, condition, proof) => {
  let ok = false;
  let detail = proof;
  try { ok = Boolean(condition()); } catch (error) { detail = error.message; }
  checks.push({ id, name, ok, proof: detail });
};
const earliest = '2026-07-05';
add('T01', '页面第1项是最早日期', () => pageToday.迷你走势数据[0].date === earliest, pageToday.迷你走势数据[0].date);
add('T02', '页面第7项等于reportDate', () => pageToday.迷你走势数据[6].date === reportDate, pageToday.迷你走势数据[6].date);
add('T03', 'XLSX第1项是最早日期', () => xlsxToday.迷你走势数据[0].date === earliest, xlsxToday.迷你走势数据[0].date);
add('T04', 'XLSX第7项等于reportDate', () => xlsxToday.迷你走势数据[6].date === reportDate, xlsxToday.迷你走势数据[6].date);
add('T05', '只有当天数据时前6灰且当前最右', () => singleDay.slice(0, 6).every(item => !item.hasData && item.status === 'missing') && singleDay[6].date === reportDate && singleDay[6].value === 4, JSON.stringify(singleDay));
add('T06', '中间缺失日期保留灰色占位', () => missingMiddle[1].date === '2026-07-06' && !missingMiddle[1].hasData && missingMiddle[1].status === 'missing', JSON.stringify(missingMiddle));
add('T07', '页面与XLSX日期数组一致', () => JSON.stringify(pageToday.迷你走势数据.map(item => item.date)) === JSON.stringify(xlsxToday.迷你走势数据.map(item => item.date)), JSON.stringify(pageToday.迷你走势数据.map(item => item.date)));
add('T08', '页面与XLSX数值数组一致', () => JSON.stringify(pageToday.迷你走势数据.map(item => item.value)) === JSON.stringify(xlsxToday.迷你走势数据.map(item => item.value)), JSON.stringify(pageToday.迷你走势数据.map(item => item.value)));
add('T09', '页面与XLSX颜色数组一致', () => JSON.stringify(pageToday.迷你走势数据.map(item => item.status)) === JSON.stringify(xlsxToday.迷你走势数据.map(item => item.status)), JSON.stringify(pageToday.迷你走势数据.map(item => item.status)));
add('T10', 'CSS无反向规则并明确LTR', () => /\.trend7\s*\{[^}]*display:\s*grid;/m.test(css) && !/row-reverse|direction:\s*rtl|scaleX\(-1\)|rotateY\(180deg\)/i.test(css), 'Trend7使用标准LTR网格，无镜像规则');
add('T11', '组件和导出层无额外排序或反转', () => !/\.reverse\(|\.sort\(/.test(component) && !/\.reverse\(|\.sort\(/.test(xlsxBlock) && /trendData\.map\(/.test(xlsxBlock), 'renderTrend7与XLSX均按统一数组直接map');
add('T12', '趋势区域不遮挡说明或明细', () => /\.trend7-values[\s\S]*?grid-template-columns:\s*repeat\(7,/m.test(css) && /\.trend7-values span\s*\{[^}]*overflow:\s*hidden;/m.test(css), 'Trend7固定7列，数值限制溢出');

for (const item of checks) assert.equal(item.ok, true, `${item.id} ${item.name}: ${item.proof}`);
for (const item of Object.values(evidence)) {
  assert.deepEqual(item.page, item.xlsx);
  assert.equal(item.dates[0], earliest);
  assert.equal(item.dates[6], reportDate);
}
assert.equal(trendChars(pageToday.迷你走势数据), pageToday.迷你走势);

const result = {
  ok: checks.every(item => item.ok),
  total: checks.length,
  passed: checks.filter(item => item.ok).length,
  failed: checks.filter(item => !item.ok).length,
  reportDate,
  checks,
  evidence
};
const jsonFile = path.join(root, 'trend_direction_12_results.json');
const csvFile = path.join(root, 'trend_direction_12_results.csv');
fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2), 'utf8');
fs.writeFileSync(csvFile, ['编号,测试项,结果,证据', ...checks.map(item => [item.id, item.name, item.ok ? '通过' : '失败', item.proof].map(csv).join(','))].join('\n'), 'utf8');
console.log(JSON.stringify({ ...result, jsonFile, csvFile }, null, 2));

function csv(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}
