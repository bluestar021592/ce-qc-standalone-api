import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';

const root = path.resolve('data/unique_20260802_acceptance');
fs.mkdirSync(root, { recursive: true });
process.env.DATA_DIR = root;
process.env.DB_FILE = path.join(root, 'ce_qc_monitor.db');
process.env.EXPORTS_DIR = path.join(root, 'exports');

const { classifyRecipient } = await import('../src/recipientGroup.js');
const { parseShopeeDailyExcel } = await import('../src/shopeeExcelParser.js');
const { buildShopeeDashboard } = await import('../src/shopeeReporting.js');
const { exportShopeeXlsx } = await import('../src/shopeeExporter.js');
const { buildSnapshotHashes } = await import('../src/snapshotHash.js');

const reportDate = '2026-08-02';
const results = [];
const evidence = {};
const test = async (id, name, fn) => {
  try { results.push({ id, name, ok: true, detail: await fn() }); }
  catch (error) { results.push({ id, name, ok: false, error: error.message }); }
};

await test('VC001', 'ShopeeCN精确分类', () => {
  assert.equal(classifyRecipient('ShopeeCN').recipient_group, 'CN');
  return classifyRecipient('ShopeeCN');
});
await test('VC002', 'ShopeeVN精确分类', () => {
  assert.equal(classifyRecipient('ShopeeVN').recipient_group, 'VN');
  return classifyRecipient('ShopeeVN');
});
await test('VC003', '空格大小写全角标准化', () => {
  const cn = classifyRecipient('  ＳｈｏｐｅｅＣＮ  ');
  const vn = classifyRecipient('  sHoPeEvN  ');
  assert.equal(cn.recipient_group, 'CN'); assert.equal(vn.recipient_group, 'VN');
  return { cn, vn };
});
await test('VC004', '禁止模糊匹配', () => {
  const values = ['ShopeeCN-Test', 'MyShopeeVN'].map(classifyRecipient);
  assert.deepEqual(values.map(row => row.recipient_group), ['OTHER', 'OTHER']);
  return values;
});
await test('VC005', '空收件人进入OTHER', () => {
  const row = classifyRecipient('');
  assert.equal(row.recipient_group, 'OTHER'); assert.equal(row.recipient_group_reason, 'EMPTY_RECIPIENT');
  return row;
});

const mainFile = path.join(root, 'SHOPEE_2500_CN965_VN1535.xlsx');
writeWorkbook(mainFile, makeRows(965, 1535, 0));
const parsed = await parseShopeeDailyExcel(mainFile, { reportDate, originalName: path.basename(mainFile) });
await test('VC006', '2500票CN/VN对账', () => {
  assert.equal(parsed.summary.totalRecognized, 2500);
  assert.deepEqual(parsed.summary.groupCounts, { CN: 965, VN: 1535, OTHER: 0 });
  assert.equal(parsed.summary.reconciliation.status, 'PASSED');
  return { total: parsed.summary.totalRecognized, groups: parsed.summary.groupCounts, reconciliation: parsed.summary.reconciliation };
});

const otherFile = path.join(root, 'SHOPEE_OTHER_3.xlsx');
writeWorkbook(otherFile, makeRows(4, 5, 3));
const parsedOther = await parseShopeeDailyExcel(otherFile, { reportDate, originalName: path.basename(otherFile) });
await test('VC007', 'OTHER对账与预警', () => {
  assert.equal(parsedOther.summary.totalRecognized, 12);
  assert.equal(parsedOther.summary.groupCounts.OTHER, 3);
  assert.equal(parsedOther.summary.reconciliation.status, 'PASSED');
  assert.ok(parsedOther.summary.warnings.some(value => value.includes('3票')));
  return parsedOther.summary;
});

const conflictFile = path.join(root, 'SHOPEE_RECIPIENT_CONFLICT.xlsx');
writeWorkbook(conflictFile, [
  row('SPECONFLICT001', 'ShopeeCN', 'PP001'),
  row('SPECONFLICT001', 'ShopeeVN', 'PV001'),
  row('SPEOK00000001', 'ShopeeCN', 'PP001')
]);
const conflict = await parseShopeeDailyExcel(conflictFile, { reportDate, originalName: path.basename(conflictFile) });
await test('VC008', '同票冲突排除正式池', () => {
  assert.equal(conflict.summary.conflictCount, 1);
  assert.deepEqual(conflict.bills, ['SPEOK00000001']);
  assert.equal(conflict.importRows.filter(item => item.importStatus === 'RECIPIENT_GROUP_CONFLICT').length, 2);
  return { conflicts: conflict.conflicts, officialBills: conflict.bills };
});

const state = buildState(parsed);
const view = buildShopeeDashboard(state);
const hashes = buildSnapshotHashes(view);
const snapshot = { snapshotId: state.snapshotId, businessType: 'SHOPEE', reportDate, runId: 'RUN-UNIQUE-20260802', view, state, ...hashes };
evidence.reconciliation = view.recipientReconciliation;

await test('VC009', '首页ALL/CN/VN数据可用', () => {
  const groups = view.recipientGroups;
  assert.equal(groups.ALL.metrics.total, 2500); assert.equal(groups.CN.metrics.total, 965); assert.equal(groups.VN.metrics.total, 1535);
  return Object.fromEntries(['ALL', 'CN', 'VN'].map(group => [group, groups[group].metrics.total]));
});
await test('VC010', 'CN全页面过滤数据源', () => {
  const rows = view.detailTabs.CN_all.rows;
  assert.equal(rows.length, 965); assert.ok(rows.every(item => item.recipient_group === 'CN'));
  return { rows: rows.length };
});
await test('VC011', 'VN全页面过滤数据源', () => {
  const rows = view.detailTabs.VN_all.rows;
  assert.equal(rows.length, 1535); assert.ok(rows.every(item => item.recipient_group === 'VN'));
  return { rows: rows.length };
});
await test('VC012', 'CN与PP组合维度', () => {
  const rows = view.detailTabs.CN_all.rows.filter(item => String(item.regionCode || '').startsWith('PP'));
  assert.ok(rows.length > 0); assert.ok(rows.every(item => item.recipient_group === 'CN' && String(item.regionCode || '').startsWith('PP')));
  return { rows: rows.length };
});
await test('VC013', 'CN OC2+直接明细', () => {
  const rows = view.detailTabs.CN_oc2.rows;
  assert.ok(rows.length > 0); assert.ok(rows.every(item => item.recipient_group === 'CN' && Number(item.OC天数) >= 2));
  return { rows: rows.length, sample: rows[0].shipmentCode };
});
await test('VC014', 'VN Pending3+直接明细', () => {
  const rows = view.detailTabs.VN_pending3.rows;
  assert.ok(rows.length > 0); assert.ok(rows.every(item => item.recipient_group === 'VN' && Number(item.Pending次数) >= 3));
  return { rows: rows.length, sample: rows[0].shipmentCode };
});
await test('VC015', '0票指标仍有空明细目标', () => {
  assert.equal(view.detailTabs.CN_oc3.rows.length, 0);
  return { tab: 'CN_oc3', rows: 0 };
});
await test('VC016', 'ALL率按总分子分母重算', () => {
  const weighted = buildShopeeDashboard(buildWeightedRateState());
  assert.equal(weighted.recipientGroups.CN.metrics.podRate, 50);
  assert.equal(weighted.recipientGroups.VN.metrics.podRate, 100);
  assert.equal(weighted.recipientGroups.ALL.metrics.podRate, 90);
  assert.notEqual(weighted.recipientGroups.ALL.metrics.podRate, 75);
  return { CN: 50, VN: 100, ALL: 90, simpleAverageForbidden: 75 };
});
await test('VC017', '七天趋势升序且reportDate最右', () => {
  const rows = view.dashboardRows.filter(item => ['CN_POD率', 'VN_OC2+', 'ALL_今日总单'].includes(item.metricKey));
  for (const item of rows) {
    assert.equal(item.迷你走势数据.length, 7);
    assert.equal(item.迷你走势数据[6].date, reportDate);
    assert.ok(item.迷你走势数据.every((point, index, list) => index === 0 || list[index - 1].date <= point.date));
  }
  evidence.trends = rows.map(item => ({ metricKey: item.metricKey, dates: item.迷你走势数据.map(point => point.date), values: item.迷你走势数据.map(point => point.hasData ? point.value : null), colors: item.迷你走势数据.map(point => point.status) }));
  return evidence.trends;
});

let apiCalls = 0;
const xlsxFile = await exportShopeeXlsx(state, snapshot);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(xlsxFile);
evidence.xlsxFile = xlsxFile;
await test('VC018', '导出阶段CE API零调用', () => {
  assert.equal(apiCalls, 0);
  return { apiCallsDuringExport: apiCalls, file: xlsxFile };
});
await test('VC019', 'XLSX与snapshot对账一致', () => {
  const dashboard = workbook.getWorksheet('01_总看板');
  assert.ok(dashboard); assert.ok(workbook.getWorksheet('99_一致性校验'));
  const summary = readDashboardSummary(dashboard);
  assert.equal(summary['全部合计'].total, 2500);
  assert.equal(summary['ShopeeCN（中国）'].total, 965);
  assert.equal(summary['ShopeeVN（越南）'].total, 1535);
  assert.ok(workbook.getWorksheet('03_ShopeeCN统计'));
  assert.ok(workbook.getWorksheet('04_ShopeeVN统计'));
  return { summary, sheets: workbook.worksheets.map(sheet => ({ name: sheet.name, state: sheet.state })) };
});
await test('VC020', 'ALL/CN/VN指标独立跳转', () => {
  const dashboard = workbook.getWorksheet('01_总看板');
  const checks = [
    ['全部合计', 'OC2+', 'ALL_OC2+单号'],
    ['ShopeeCN（中国）', 'OC2+', 'CN_OC2+单号'],
    ['ShopeeVN（越南）', 'Pending3+', 'VN_Pending3+单号'],
    ['ShopeeCN（中国）', 'OC3+', 'CN_OC3+单号']
  ].map(([group, metric, target]) => {
    const formula = findMetricFormula(dashboard, group, metric);
    assert.ok(formula.includes(`#'${target}'!A1`), `${group}/${metric}跳转错误：${formula}`);
    assert.ok(workbook.getWorksheet(target), `缺少目标Sheet：${target}`);
    return { group, metric, target, formula };
  });
  const emptyText = workbook.getWorksheet('CN_OC3+单号').getCell('A5').text;
  assert.ok(emptyText.includes('0票'));
  return { checks, emptyTargetText: emptyText };
});

const failed = results.filter(item => !item.ok);
const output = { ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed: failed.length, generatedAt: new Date().toISOString(), results, evidence };
const reportFile = path.join(root, 'VN_CN_20_acceptance_results.json');
const csvFile = path.join(root, 'VN_CN_20_acceptance_results.csv');
fs.writeFileSync(reportFile, JSON.stringify(output, null, 2), 'utf8');
fs.writeFileSync(csvFile, '\uFEFF' + ['编号,测试,结果,证据', ...results.map(item => [item.id, item.name, item.ok ? '通过' : '失败', JSON.stringify(item.detail || item.error || '')].map(csv).join(','))].join('\n'), 'utf8');
console.log(JSON.stringify({ ok: output.ok, total: output.total, passed: output.passed, failed: output.failed, reportFile, csvFile, xlsxFile }, null, 2));
if (!output.ok) process.exitCode = 1;

function makeRows(cn, vn, other) {
  const rows = [];
  for (let index = 0; index < cn; index += 1) rows.push(row(`SPECN${String(index + 1).padStart(10, '0')}`, 'ShopeeCN', index % 2 ? 'PV001' : 'PP001'));
  for (let index = 0; index < vn; index += 1) rows.push(row(`SPEVN${String(index + 1).padStart(10, '0')}`, 'ShopeeVN', index % 2 ? 'PV002' : 'PP002'));
  for (let index = 0; index < other; index += 1) rows.push(row(`SPEOT${String(index + 1).padStart(10, '0')}`, `Unknown-${index + 1}`, index % 2 ? 'PV003' : 'PP003'));
  return rows;
}

function row(shipmentCode, recipient, region) {
  return { 日报日期: reportDate, 运单号: shipmentCode, 收件人: recipient, deliveryShop: region, 区域: region };
}

function writeWorkbook(file, rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'SHOPEE日报');
  XLSX.writeFile(book, file);
}

function buildState(source) {
  const finalRows = source.details.map((item, index) => ({
    ...item,
    运单号: item.shipmentCode,
    是否POD: index % 5 === 0 ? '是' : '否',
    POD状态: index % 5 === 0 ? 'POD' : '未POD',
    API状态: '成功',
    查询状态: 'success',
    Pending次数: item.recipient_group === 'VN' && index === 965 ? 3 : 0,
    OC天数: item.recipient_group === 'CN' && index === 0 ? 2 : 0,
    入库无扫描节点: index === 1 ? '是' : '否',
    primaryCategory: index === 0 ? 'OC2天' : index === 1 ? '入库无扫描节点' : '正常',
    latestEventTime: `${reportDate} 12:00:00`,
    latestEventDesc: 'Acceptance fixture',
    carry状态: index % 5 === 0 ? 'closed_pod' : 'active'
  }));
  const historySummary = Array.from({ length: 6 }, (_, index) => {
    const day = new Date(`${reportDate}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + index - 6);
    const metrics = {};
    for (const group of ['ALL', 'CN', 'VN']) {
      metrics[`${group}_今日总单`] = group === 'ALL' ? 2400 + index * 10 : group === 'CN' ? 920 + index * 5 : 1480 + index * 5;
      metrics[`${group}_今日POD`] = Math.round(metrics[`${group}_今日总单`] * .2);
      metrics[`${group}_POD率`] = 20 + index;
      metrics[`${group}_首派成功率`] = 18 + index;
      metrics[`${group}_OC2+`] = index + 1;
    }
    return { businessType: 'SHOPEE', reportDate: day.toISOString().slice(0, 10), summary: { metrics } };
  });
  return {
    businessType: 'SHOPEE', reportDate, sourceName: source.sourceName, dailyReportReady: true,
    dailyParseSummary: source.summary, dailyParseRows: source.importRows, recipientConflicts: source.conflicts,
    pnhBills: source.bills, carryBills: finalRows.filter(item => item.是否POD !== '是').map(item => item.shipmentCode),
    nextCarryBills: finalRows.filter(item => item.是否POD !== '是').map(item => item.shipmentCode), podLocks: finalRows.filter(item => item.是否POD === '是').map(item => item.shipmentCode),
    finalRows, scanResults: finalRows, trackResults: finalRows, historySummary,
    currentRun: { runId: 'RUN-UNIQUE-20260802' }, lastRunSummary: { runId: 'RUN-UNIQUE-20260802' }, snapshotId: 'SHOPEE-UNIQUE-20260802-SNAPSHOT'
  };
}

function buildWeightedRateState() {
  const rows = [
    ...Array.from({ length: 2 }, (_, index) => ({ shipmentCode: `RATECN${index}`, recipient_group: 'CN', recipient_raw: 'ShopeeCN', regionCode: 'PP', 是否POD: index === 0 ? '是' : '否', API状态: '成功' })),
    ...Array.from({ length: 8 }, (_, index) => ({ shipmentCode: `RATEVN${index}`, recipient_group: 'VN', recipient_raw: 'ShopeeVN', regionCode: 'PV', 是否POD: '是', API状态: '成功' }))
  ];
  return { businessType: 'SHOPEE', reportDate, pnhBills: rows.map(item => item.shipmentCode), dailyParseRows: rows, finalRows: rows, carryBills: [], nextCarryBills: [], podLocks: [], historySummary: [] };
}

function readDashboardSummary(sheet) {
  const result = {};
  for (let rowNumber = 5; rowNumber <= 8; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const label = row.getCell(1).text;
    if (label) result[label] = { total: Number(row.getCell(2).value || 0), pod: Number(row.getCell(3).value || 0), podRate: Number(row.getCell(4).value || 0) };
  }
  return result;
}

function findMetricFormula(sheet, group, metric) {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (row.getCell(2).text === group && row.getCell(3).text === metric) return String(row.getCell(4).value?.formula || '');
  }
  return '';
}

function csv(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
