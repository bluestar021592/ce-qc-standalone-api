import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';
import { getRuntimeConfig } from './db.js';
import { buildShopeeDashboard, SHOPEE_RECIPIENT_GROUPS } from './shopeeReporting.js';
import { assertSnapshotHashes, buildSnapshotHashes } from './snapshotHash.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLUE = 'FF19598A';
const DARK_BLUE = 'FF123E62';
const LIGHT_BLUE = 'FFF3F8FC';
const BORDER = 'FFD7E2EB';
const TEXT = 'FF1F3347';
const MUTED = 'FF60758A';
const WHITE = 'FFFFFFFF';
const GROUP_LABELS = { ALL: '全部合计', CN: 'ShopeeCN（中国）', VN: 'ShopeeVN（越南）' };
const METRICS = [
  ['今日总单', 'all'], ['今日POD', 'pod'], ['POD率', 'pod'], ['首派成功率', 'firstAttempt'],
  ['Pending1+', 'pending1'], ['Pending2+', 'pending2'], ['Pending3+', 'pending3'],
  ['OC1+', 'oc1'], ['OC2+', 'oc2'], ['OC3+', 'oc3'], ['盘点2天+', 'cycle2'], ['入库无扫描', 'inboundNoScan'],
  ['已退回件', 'returned'], ['退回率', 'returned'], ['当前未闭环', 'unresolved'], ['对账差异', 'unresolved'], ['退回处理中', 'returnInProgress'],
  ['1派POD', 'attempt1'], ['1派POD占比', 'attempt1'], ['2派POD', 'attempt2'], ['2派POD占比', 'attempt2'],
  ['3派及以上POD', 'attempt3'], ['3派及以上POD占比', 'attempt3'],
  ['在途门店', 'shopTransit'], ['到达门店', 'shopArrived'], ['门店Pending', 'shopPending'],
  ['门店滞留1天+', 'shopRetention1'], ['门店滞留2天+', 'shopRetention2'], ['门店滞留3天+', 'shopRetention3']
];
const DETAIL_HEADERS = ['序号', '运单号', '日报日期', 'recipient_raw', 'recipient_group', 'PP/PV', '当前扫描状态', '异常分类', '门店状态', '目标门店编码', '当前门店编码', '门店名称', '门店发往时间', '门店到达时间', '门店Pending时间', '门店滞留自然日', '累计自然日', '最新轨迹时间', '最新节点', '是否继续监控', 'Snapshot ID', '备注'];

export async function exportShopeeXlsx(state = {}, snapshot = null) {
  const snapshotId = state.snapshotId || snapshot?.snapshotId || '';
  if (!snapshotId) throw new Error('SHOPEE处理尚未完成，暂无可导出的snapshot。');
  const view = snapshot?.view || buildShopeeDashboard(state);
  if (view.recipientReconciliation?.status !== 'PASSED') {
    const error = new Error('SHOPEE收件人分组对账失败，已阻止正式XLSX导出。');
    error.code = 'FAILED_RECONCILIATION';
    throw error;
  }
  const exportHashes = buildSnapshotHashes(view);
  assertSnapshotHashes(snapshot || {}, exportHashes, 'SHOPEE导出');

  const outDir = getRuntimeConfig().exportsDir;
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `CE_SHOPEE质控追踪_${state.reportDate || '日报'}_${stamp()}.xlsx`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CE QC Standalone API';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const logoImageId = workbook.addImage({ filename: path.resolve(__dirname, '../public/assets/ce-express-logo-main.png'), extension: 'png' });
  const context = { reportDate: state.reportDate || '', snapshotId, logoImageId, view };

  const metricSheets = buildMetricSheetNames(context);
  createDashboardSheet(workbook, context, metricSheets);
  createDailyAnalysisSheet(workbook, context);
  createGroupStatisticsSheet(workbook, context, 'CN', '03_ShopeeCN统计');
  createGroupStatisticsSheet(workbook, context, 'VN', '04_ShopeeVN统计');
  createGroupDetailSheet(workbook, context, 'CN', '05_ShopeeCN明细');
  createGroupDetailSheet(workbook, context, 'VN', '06_ShopeeVN明细');
  createMetricTargetSheets(workbook, context, metricSheets);
  createExcludedAuditSheet(workbook, context, state.dailyParseRows || []);
  createConsistencySheet(workbook, context, snapshot, exportHashes);

  await workbook.xlsx.writeFile(file);
  return file;
}

function createDashboardSheet(workbook, context, metricSheets) {
  const sheet = workbook.addWorksheet('01_总看板', { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });
  brandSheet(sheet, context, 'CE Express SHOPEE 质控追踪总看板', 12);
  sheet.getRow(4).values = ['分组', ...METRICS.map(([label]) => label)];
  styleHeader(sheet.getRow(4), 12);
  const visibleGroups = ['ALL', 'CN', 'VN'];
  for (const group of visibleGroups) {
    const metrics = context.view.recipientGroups[group]?.metrics || {};
    const values = [GROUP_LABELS[group], ...METRICS.map(([label]) => metricValueForExport(metrics, label))];
    const row = sheet.addRow(values);
    styleBodyRow(row, 12);
    row.getCell(4).numFmt = '0.00%';
    row.getCell(5).numFmt = '0.00%';
    const returnRateColumn = 2 + METRICS.findIndex(([label]) => label === '退回率');
    if (returnRateColumn > 1) row.getCell(returnRateColumn).numFmt = '0.00%';
  }

  let startRow = sheet.rowCount + 2;
  for (const group of visibleGroups) {
    const rows = context.view.dashboardRows.filter(row => row.recipientGroup === group);
    sheet.mergeCells(startRow, 1, startRow, 7);
    const title = sheet.getCell(startRow, 1);
    title.value = GROUP_LABELS[group];
    title.font = { name: 'Microsoft YaHei', bold: true, size: 12, color: { argb: DARK_BLUE } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BLUE } };
    title.alignment = { vertical: 'middle' };
    sheet.getRow(startRow).height = 25;
    const headerRow = sheet.getRow(startRow + 1);
    headerRow.values = ['日期', '板块', '项目', '数值（点击查看）', '状态', '近7天趋势', '说明'];
    styleHeader(headerRow, 7);
    for (const source of rows) {
      const detailSheet = metricSheets.get(source.明细Tab);
      const valueLabel = source.单位 === '%' ? `${Number(source.数值原值 || 0).toFixed(2)}%` : String(Math.round(Number(source.数值原值 || 0)));
      const row = sheet.addRow([
        source.日期 || context.reportDate,
        GROUP_LABELS[group],
        source.项目,
        '',
        statusLabel(source.状态),
        formatTrend(source.迷你走势数据, source.单位),
        metricDescription(source.项目)
      ]);
      styleBodyRow(row, 7);
      const valueCell = row.getCell(4);
      valueCell.value = hyperlinkFormula(detailSheet, valueLabel);
      valueCell.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FF0563C1' }, underline: true };
    }
    startRow = sheet.rowCount + 2;
  }
  sheet.columns = [21, ...METRICS.map(() => 16)].map(width => ({ width }));
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + visibleGroups.length, column: METRICS.length + 1 } };
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
}

function buildMetricSheetNames(context) {
  const map = new Map();
  for (const group of SHOPEE_RECIPIENT_GROUPS) {
    for (const [label, tabKey] of METRICS) {
      const key = `${group}_${tabKey}`;
      if (map.has(key)) continue;
      map.set(key, `${group}_${shortMetric(label)}单号`.slice(0, 31));
    }
  }
  return map;
}

function createMetricTargetSheets(workbook, context, metricSheets) {
  for (const [key, sheetName] of metricSheets) {
    const splitAt = key.indexOf('_');
    const group = key.slice(0, splitAt);
    const tabKey = key.slice(splitAt + 1);
    const label = METRICS.find(([, candidate]) => candidate === tabKey)?.[0] || tabKey;
    const rows = context.view.detailTabs?.[key]?.rows || [];
    createDetailSheet(workbook, context, sheetName, rows, `${GROUP_LABELS[group]} / ${label}`);
  }
}

function createDailyAnalysisSheet(workbook, context) {
  const sheet = workbook.addWorksheet('02_日报分析', { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });
  brandSheet(sheet, context, 'SHOPEE 近7日日报分析', 12);
  const headers = ['日期', ...['ALL', 'CN', 'VN'].flatMap(group => [`${group}总单`, `${group}POD`, `${group}POD率`, `${group}首派成功率`])];
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4), headers.length);
  const dates = trendDates(context.view, 'ALL_今日总单');
  for (let index = 0; index < dates.length; index += 1) {
    const values = [dates[index]];
    for (const group of ['ALL', 'CN', 'VN']) {
      values.push(trendValue(context.view, `${group}_今日总单`, index), trendValue(context.view, `${group}_今日POD`, index), rateValue(trendValue(context.view, `${group}_POD率`, index)), rateValue(trendValue(context.view, `${group}_首派成功率`, index)));
    }
    const row = sheet.addRow(values);
    styleBodyRow(row, headers.length);
    for (const col of [4, 5, 8, 9, 12, 13]) row.getCell(col).numFmt = '0.00%';
  }
  sheet.columns = headers.map((header, index) => ({ width: index === 0 ? 13 : 16 }));
  addReturnLink(sheet, headers.length);
}

function createGroupStatisticsSheet(workbook, context, group, name) {
  const sheet = workbook.addWorksheet(name, { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });
  brandSheet(sheet, context, `${GROUP_LABELS[group]} 近7日指标`, 12);
  const headers = ['日期', ...METRICS.map(([label]) => label)];
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4), headers.length);
  const dates = trendDates(context.view, `${group}_今日总单`);
  for (let index = 0; index < dates.length; index += 1) {
    const values = [dates[index], ...METRICS.map(([label]) => {
      const value = trendValue(context.view, `${group}_${label}`, index);
      return ['POD率', '首派成功率', '退回率'].includes(label) ? rateValue(value) : value;
    })];
    const row = sheet.addRow(values);
    styleBodyRow(row, headers.length);
    row.getCell(4).numFmt = '0.00%';
    row.getCell(5).numFmt = '0.00%';
  }
  sheet.columns = headers.map((header, index) => ({ width: index === 0 ? 13 : 15 }));
  addReturnLink(sheet, headers.length);
}

function createGroupDetailSheet(workbook, context, group, name) {
  const rows = context.view.detailTabs?.[`${group}_all`]?.rows || [];
  return createDetailSheet(workbook, context, name, rows, `${GROUP_LABELS[group]}日报明细`);
}

function createExcludedAuditSheet(workbook, context, importRows) {
  const rows = (importRows || []).filter(row => row.importStatus === 'IGNORED_NON_SHOPEE');
  const sheet = workbook.addWorksheet('07_EXCLUDED_AUDIT', { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });
  brandSheet(sheet, context, 'SHOPEE excluded import audit', 7);
  const headers = ['shipmentCode', 'recipient_raw', 'recipient_normalized', 'recipient_group', 'importStatus', 'sheetName', 'rowNumber'];
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4), headers.length);
  for (const item of rows) {
    const row = sheet.addRow(headers.map(key => item[key] ?? ''));
    styleBodyRow(row, headers.length);
  }
  sheet.columns = [24, 28, 28, 18, 26, 24, 12].map(width => ({ width }));
  if (rows.length) sheet.autoFilter = { from: 'A4', to: `G${sheet.rowCount}` };
  addReturnLink(sheet, headers.length);
}

function createDetailSheet(workbook, context, name, sourceRows, title) {
  const sheet = workbook.addWorksheet(name.slice(0, 31), { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });
  brandSheet(sheet, context, title, DETAIL_HEADERS.length);
  sheet.getRow(4).values = DETAIL_HEADERS;
  styleHeader(sheet.getRow(4), DETAIL_HEADERS.length);
  if (!sourceRows.length) {
    sheet.mergeCells(5, 1, 5, DETAIL_HEADERS.length);
    const cell = sheet.getCell(5, 1);
    cell.value = '当前维度、当前指标为0票，没有对应明细单号。';
    cell.font = { name: 'Microsoft YaHei', color: { argb: MUTED }, italic: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BLUE } };
    sheet.getRow(5).height = 30;
  } else {
    sourceRows.forEach((source, index) => {
      const row = sheet.addRow(detailValues(source, index + 1, context));
      styleBodyRow(row, DETAIL_HEADERS.length);
    });
    sheet.autoFilter = { from: 'A4', to: `${columnName(DETAIL_HEADERS.length)}${sheet.rowCount}` };
  }
  sheet.columns = [8,21,14,23,16,10,18,22,18,16,16,24,20,20,20,14,14,21,42,15,31,42].map(width => ({ width }));
  addReturnLink(sheet, DETAIL_HEADERS.length);
  return sheet;
}

function createConsistencySheet(workbook, context, snapshot, hashes) {
  const sheet = workbook.addWorksheet('99_一致性校验', { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });
  brandSheet(sheet, context, 'SHOPEE 快照一致性校验', 7);
  const headers = ['检查项目', 'ALL', 'CN+VN', '差异', '结果', '快照哈希', '导出哈希'];
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4), headers.length);
  for (const check of context.view.recipientReconciliation?.checks || []) {
    const row = sheet.addRow([check.key, check.all, check.parts, check.difference, check.passed ? '通过' : '异常', snapshot?.dashboardMetricHash || hashes.dashboardMetricHash, hashes.dashboardMetricHash]);
    styleBodyRow(row, headers.length);
  }
  const hashRow = sheet.addRow(['明细哈希', '', '', '', snapshot?.detailRowHash === hashes.detailRowHash || !snapshot?.detailRowHash ? '通过' : '异常', snapshot?.detailRowHash || hashes.detailRowHash, hashes.detailRowHash]);
  styleBodyRow(hashRow, headers.length);
  sheet.columns = [22, 14, 17, 12, 12, 68, 68].map(width => ({ width }));
  addReturnLink(sheet, headers.length);
}

function brandSheet(sheet, context, title, width) {
  sheet.addImage(context.logoImageId, { tl: { col: 0.05, row: 0.05 }, ext: { width: 90, height: 54 } });
  sheet.mergeCells(1, 3, 1, Math.max(7, width));
  const titleCell = sheet.getCell(1, 3);
  titleCell.value = title;
  titleCell.font = { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: DARK_BLUE } };
  titleCell.alignment = { vertical: 'middle' };
  sheet.mergeCells(2, 3, 2, Math.max(7, width));
  const meta = sheet.getCell(2, 3);
  meta.value = `日报日期：${context.reportDate}  数据来源：已保存处理快照`;
  meta.font = { name: 'Microsoft YaHei', size: 9, color: { argb: MUTED } };
  sheet.getRow(1).height = 32;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 8;
}

function addReturnLink(sheet, columnCount) {
  const cell = sheet.getCell(2, Math.max(7, columnCount));
  cell.value = hyperlinkFormula('01_总看板', '返回总看板 ↑');
  cell.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FF0563C1' }, underline: true };
  cell.alignment = { horizontal: 'right' };
}

function styleHeader(row, count) {
  row.height = 29;
  for (let index = 1; index <= count; index += 1) {
    const cell = row.getCell(index);
    cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    cell.border = thinBorder();
  }
}

function styleBodyRow(row, count) {
  row.height = 24;
  for (let index = 1; index <= count; index += 1) {
    const cell = row.getCell(index);
    cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: TEXT } };
    cell.alignment = { vertical: 'middle', wrapText: false, shrinkToFit: true };
    cell.border = thinBorder();
    if (row.number % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FBFD' } };
  }
}

function detailValues(row, index, context) {
  return [
    index,
    billOf(row),
    row.reportDate || context.reportDate,
    row.recipient_raw || '',
    row.recipient_group || 'OTHER',
    normalizedRegion(row),
    row.扫描状态 || row.shipmentStatus || '',
    row.primaryCategory || row.主分类 || row.异常分类 || '',
    row.shopState || '',
    row.targetShopCode || '',
    row.currentShopCode || '',
    row.shopName || '',
    row.shopTransferStartedAt || '',
    row.shopArrivedAt || '',
    row.shopPendingAt || '',
    Number(row.shopRetentionNaturalDays || 0),
    Math.max(Number(row.Pending次数 || row.Pending最大次数 || 0), Number(row.OC天数 || row.OC最大天数 || 0)),
    row.latestEventTime || row.最后节点时间 || '',
    row.latestEventDesc || row.最后节点 || row.latestNode || '',
    row.是否POD === '是' || row.退回状态 === '已退回' ? '否' : '是',
    context.snapshotId,
    row.QC判断 || row.recipient_group_reason || ''
  ];
}

function trendDates(view, metricKey) {
  const row = view.dashboardRows.find(item => item.metricKey === metricKey);
  return (row?.迷你走势数据 || []).map(item => item.date || '');
}

function trendValue(view, metricKey, index) {
  const row = view.dashboardRows.find(item => item.metricKey === metricKey);
  const item = row?.迷你走势数据?.[index];
  return item?.hasData ? Number(item.value || 0) : null;
}

function formatTrend(trend = [], unit = '') {
  return trend.map(item => {
    const date = String(item?.date || '').slice(5);
    if (!item?.hasData) return `${date} —`;
    const value = unit === '%' ? `${Number(item.value || 0).toFixed(2)}%` : String(Math.round(Number(item.value || 0)));
    return `${date} ${value}`;
  }).join('  |  ');
}

function metricDescription(label) {
  return {
    今日总单: '当前收件人维度当日日报去重单量',
    今日POD: '当前收件人维度当日已签收',
    POD率: '今日POD ÷ 今日总单',
    首派成功率: '首派POD件数 ÷ 可计算首派总单',
    'Pending1+': '按自然日去重，累计1天及以上',
    'Pending2+': '按自然日去重，累计2天及以上',
    'Pending3+': '按自然日去重，累计3天及以上',
    'OC1+': '当前OC周期1天及以上',
    'OC2+': '当前OC周期2天及以上',
    'OC3+': '当前OC周期3天及以上',
    '盘点2天+': '按柬埔寨自然日计算，盘点累计2天及以上',
    入库无扫描: '入库后无更晚有效节点'
    ,已退回件: '当前周期RETURN_COMPLETED唯一运单数'
    ,退回率: '已退回件 ÷ 当前业务有效唯一单号'
    ,退回处理中: 'PR/P4007退回中，仍继续查询轨迹'
    ,'1派POD': '日报当日（柬埔寨自然日）完成POD'
    ,'1派POD占比': '1派POD ÷ 当日有效唯一单号'
    ,'2派POD': '跨过第1个柬埔寨午夜后完成POD'
    ,'2派POD占比': '2派POD ÷ 当日有效唯一单号'
    ,'3派及以上POD': '跨过至少2个柬埔寨午夜后完成POD'
    ,'3派及以上POD占比': '3派及以上POD ÷ 当日有效唯一单号'
  }[label] || '';
}

function rateValue(value) { return Number(value || 0) / 100; }
function metricValueForExport(metrics, label) {
  const map = {
    今日总单: metrics.total, 今日POD: metrics.pod, POD率: rateValue(metrics.podRate), 首派成功率: rateValue(metrics.firstAttemptRate),
    'Pending1+': metrics.pending1, 'Pending2+': metrics.pending2, 'Pending3+': metrics.pending3plus,
    'OC1+': metrics.oc1, 'OC2+': metrics.oc2, 'OC3+': metrics.oc3plus, '盘点2天+': metrics.cycle2plus, 入库无扫描: metrics.inboundNoScan,
    已退回件: metrics.returned, 退回率: rateValue(metrics.returnRate), 当前未闭环: metrics.unresolved, 对账差异: metrics.accountingDifference, 退回处理中: metrics.returnInProgress,
    '1派POD': metrics.dispatchAttempt1, '1派POD占比': rateValue(metrics.dispatchAttempt1Rate),
    '2派POD': metrics.dispatchAttempt2, '2派POD占比': rateValue(metrics.dispatchAttempt2Rate),
    '3派及以上POD': metrics.dispatchAttempt3, '3派及以上POD占比': rateValue(metrics.dispatchAttempt3Rate),
    在途门店: metrics.shopTransit, 到达门店: metrics.shopArrived, 门店Pending: metrics.shopPending,
    '门店滞留1天+': metrics.shopRetention1, '门店滞留2天+': metrics.shopRetention2, '门店滞留3天+': metrics.shopRetention3
  };
  return map[label] ?? 0;
}
function statusLabel(value) { return { volume: '—', normal: '正常', warning: '需跟进', danger: '重点关注' }[value] || String(value || '—'); }
function shortMetric(value) { return String(value).replace('今日', '').replace('首派成功率', '首派成功').slice(0, 18); }
function hyperlinkFormula(sheetName, label) { const safeSheet = String(sheetName).replaceAll("'", "''"); const safeLabel = String(label).replaceAll('"', '""'); return { formula: `HYPERLINK("#'${safeSheet}'!A1","${safeLabel}")`, result: String(label) }; }
function thinBorder() { return { top: { style: 'thin', color: { argb: BORDER } }, left: { style: 'thin', color: { argb: BORDER } }, bottom: { style: 'thin', color: { argb: BORDER } }, right: { style: 'thin', color: { argb: BORDER } } }; }
function normalizedRegion(row = {}) { const code = String(row.regionCode || row.区域 || '').toUpperCase(); if (code.startsWith('PP') || row.regionType === 'PHNOM_PENH') return 'PP'; if (code.startsWith('PV') || row.regionType === 'PROVINCE') return 'PV'; return 'UNKNOWN'; }
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase(); }
function columnName(number) { let name = ''; for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name; return name; }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
