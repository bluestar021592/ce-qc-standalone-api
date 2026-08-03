import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const testDir = path.resolve('data/codex_final_lock/metrics');
fs.mkdirSync(testDir, { recursive: true });
process.env.DATA_DIR = testDir;
process.env.DB_FILE = path.join(testDir, 'metric_acceptance.db');
process.env.EXPORTS_DIR = path.join(testDir, 'exports');

const { buildCoreKpis, buildDashboardData, buildDashboardRows, buildCriticalDashboard } = await import('../src/reporting.js');

const state = {
  reportDate: '2026-07-07',
  scanResults: ['CCA', 'CCB', 'CCC', 'CCD', 'CCE'].map(shipmentCode => ({ shipmentCode, orderStatus: 10 })),
  finalRows: [
    { '运单号': 'CCA', '是否POD': '否', '异常分类': 'OC', 'OC天数': 2 },
    { '运单号': 'CCA', '是否POD': '否', '异常分类': '盘点', '盘点天数': 2 },
    { '运单号': 'CCB', '是否POD': '否', '异常分类': '入库无扫描' },
    { '运单号': 'CCC', '是否POD': '否', '异常分类': '门店途中', '门店状态': '门店途中', '门店编码': 'CP001', '门店滞留天数': 2 },
    { '运单号': 'CCD', '是否POD': '否', '异常分类': '门店滞留', '门店状态': '门店滞留', '门店编码': 'CP002', '门店滞留天数': 3 },
    { '运单号': 'CCE', '是否POD': '否', '异常分类': '正常分流节点', matchedRule: 'NORMAL_FINAL_HUB' }
  ],
  pnhBills: ['CCA', 'CCB', 'CCC', 'CCD', 'CCE']
};

const dashboard = buildDashboardData(state);
const critical = buildCriticalDashboard(state);
const core = buildCoreKpis(state);
const rows = buildDashboardRows(state);
const names = new Set(rows.map(row => row['项目']));
const required = [
  '今日PNH', '今日POD', '首投POD率', '异常率', '跨日遗留', '明日继续监控', '延迟POD',
  'Pending1+', 'Pending2+', 'Pending3+', 'Pending连续3天以上', 'Pending不连续', 'Pending有图片', 'Pending无图片', 'Pending图片异常',
  'OC1+', 'OC2+', 'OC3+', '盘点1天', '盘点2天', '盘点3天以上',
  '门店入库包裹数', '门店入库1天', '门店入库2天', '门店入库3天以上', '门店途中1天', '门店途中2天', '门店途中3天以上', '门店滞留', 'TBKH门店总数',
  '入库无扫描节点', '派送停留1天', '派送停留2天', '派送停留3天以上', '节点未更新1天', '节点未更新2天', '节点未更新3天以上', '工单未处理', '工单未完结率'
];
const missing = required.filter(name => !names.has(name));

assert.equal(dashboard.totalMonitored, 5);
assert.equal(dashboard.abnormalCount, 4);
assert.equal(dashboard.abnormalRate, 80);
assert.equal(core.severeCount, 4);
assert.equal(critical.rows.length, 5);
assert.deepEqual(missing, []);

const result = {
  ok: true,
  totalMonitored: dashboard.totalMonitored,
  abnormalUnique: dashboard.abnormalCount,
  anomalyRate: dashboard.abnormalRate,
  severeUniqueUnion: core.severeCount,
  severeCategories: critical.rows.map(row => ({ type: row['异常类型'], count: row['数量'] })),
  dashboardMetricCount: rows.length,
  requiredMetricCount: required.length,
  missingMetrics: missing
};
fs.writeFileSync(path.join(testDir, 'metric_acceptance_results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
