import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, '../templates/shopee_daily_dashboard_template.xlsx');
const FIRST_SHEETS = ['看板首页', '每日汇总', '全部明细', '金边明细', '外省明细', '门店明细', 'POD明细', '未POD明细', '分配派送中明细', 'Pending明细', '退回明细'];
const DETAIL_HEADERS = ['日期', '运单编号', '下单时间', '派件时间', '状态标识', '状态说明', '收件省份', '区域分类', '当前门店', '当前省份', '收件人', '收件人手机', '收件地址', '派件快递员', '异常描述'];

export async function createShopeeTemplateWorkbook({ type, periodType, range, snapshots, outputDir }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE);
  assertTemplate(workbook);
  repairReturnLinks(workbook);

  const datedRows = snapshots.map(snapshot => ({
    date: snapshot.reportDate,
    rows: uniqueRows((snapshot.payload?.finalRows || [])
      .filter(row => String(row.businessType || '').toUpperCase() === type)
      .map(row => ({ ...row, reportDate: row.reportDate || snapshot.reportDate, snapshotId: snapshot.snapshotId })))
  }));
  const allRows = uniqueRows(datedRows.flatMap(item => item.rows));
  const groups = buildGroups(allRows);
  const dateMetrics = datedRows.map(item => ({ date: item.date, ...metrics(item.rows) }));

  fillDashboard(workbook.getWorksheet('看板首页'), type, range, metrics(allRows), dateMetrics);
  fillDailySummary(workbook.getWorksheet('每日汇总'), range, dateMetrics);
  fillDetail(workbook.getWorksheet('全部明细'), range, datedRows);
  fillDetail(workbook.getWorksheet('金边明细'), range, datedRows, row => region(row) === 'PP');
  fillDetail(workbook.getWorksheet('外省明细'), range, datedRows, row => region(row) === 'PV');
  fillDetail(workbook.getWorksheet('门店明细'), range, datedRows, row => Boolean(row.currentStore || row.当前门店 || row.storeCode));
  fillDetail(workbook.getWorksheet('POD明细'), range, datedRows, isPod);
  fillDetail(workbook.getWorksheet('未POD明细'), range, datedRows, row => !isPod(row));
  fillDetail(workbook.getWorksheet('分配派送中明细'), range, datedRows, isDelivery);
  fillDetail(workbook.getWorksheet('Pending明细'), range, datedRows, row => pendingDays(row) > 0);
  fillDetail(workbook.getWorksheet('退回明细'), range, datedRows, isReturned);

  workbook.title = `${type}每日数据看板（${range.from} 至 ${range.to}）`;
  workbook.views = [{ activeTab: 0, firstSheet: 0, visibility: 'visible' }];
  const label = type === 'SHOPEECN' ? 'SHOPEE_CN' : 'SHOPEE_VN';
  const file = path.join(outputDir, `${label}_${periodType}_每日数据看板（${range.from} 至 ${range.to}）.xlsx`);
  await workbook.xlsx.writeFile(file);
  return { file, audit: { rows: allRows.length, groups, sheetNames: workbook.worksheets.slice(0, 11).map(sheet => sheet.name) } };
}

function assertTemplate(workbook) {
  const actual = workbook.worksheets.slice(0, 11).map(sheet => sheet.name);
  if (actual.join('|') !== FIRST_SHEETS.join('|')) throw new Error(`SHOPEE母版Sheet结构不一致：${actual.join(', ')}`);
}

function repairReturnLinks(workbook) {
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
    const value = cell.value;
    if (value && typeof value === 'object' && typeof value.formula === 'string' && value.formula.includes('R退回明细')) {
      cell.value = { ...value, formula: value.formula.replaceAll('R退回明细', '退回明细') };
    }
  })));
}

function fillDashboard(sheet, type, range, total, daily) {
  sheet.getCell('A1').value = `${type === 'SHOPEECN' ? '中国' : '越南'}虾皮每日数据看板`;
  const top = [
    ['A5', '全部明细', total.all, 1], ['C5', '金边明细', total.pp, total.all], ['E5', '外省明细', total.pv, total.all],
    ['G5', '门店明细', total.store, total.all], ['I5', 'POD明细', total.pod, total.all], ['K5', '未POD明细', total.notPod, total.all],
    ['M5', '分配派送中明细', total.delivery, total.all], ['O5', '退回明细', total.returned, total.all]
  ];
  for (const [address, target, count, denominator] of top) {
    const column = sheet.getCell(address).col;
    setMergedFormula(sheet, 5, column, target, count);
    setMergedFormula(sheet, 6, column, target, denominator ? count / denominator : 0);
    setMergedFormula(sheet, 7, column, target, '点击查看明细');
  }
  for (let index = 0; index < 31; index += 1) {
    const row = 11 + index;
    const item = daily[index];
    const date = item?.date || '';
    sheet.getCell(row, 1).value = date;
    sheet.getCell(row, 7).value = date;
    const values = item ? [item.all, item.pp, item.pv, item.store, item.pod, item.delivery, item.pending, item.returned, item.notPod, item.podRate, item.deliveryRate, item.pendingRate, item.returnRate] : Array(13).fill('');
    const columns = [2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const targets = ['全部明细', '金边明细', '外省明细', '门店明细', 'POD明细', '分配派送中明细', 'Pending明细', '退回明细', '未POD明细', 'POD明细', '分配派送中明细', 'Pending明细', '退回明细'];
    columns.forEach((column, i) => { sheet.getCell(row, column).value = item ? hyperlink(targets[i], values[i]) : ''; });
  }
}

function fillDailySummary(sheet, range, daily) {
  sheet.getCell('A1').value = `每日完整汇总（${range.from} 至 ${range.to}）`;
  if (sheet.rowCount > 3) sheet.spliceRows(4, sheet.rowCount - 3);
  daily.forEach((item, index) => {
    const row = sheet.addRow([item.date, item.all, item.pp, item.pv, item.store, item.pod, item.notPod, item.delivery, item.pending, item.returned, item.podRate, item.notPodRate, item.deliveryRate, item.pendingRate, item.returnRate]);
    copyRowStyle(sheet.getRow(3), row);
    row.eachCell(cell => { cell.font = { ...cell.font, bold: false, color: { argb: 'FF18324F' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFF8FBFF' : 'FFFFFFFF' } }; });
  });
}

function fillDetail(sheet, range, datedRows, predicate = () => true) {
  const title = sheet.name;
  if (sheet.rowCount > 1) sheet.spliceRows(2, sheet.rowCount - 1);
  let rowNumber = 2;
  for (const item of datedRows) {
    const rows = item.rows.filter(predicate);
    const titleRow = sheet.insertRow(rowNumber++, [`${item.date} 明细（${rows.length}票）`]);
    titleRow.height = 24;
    titleRow.font = { bold: true, color: { argb: 'FF18324F' } };
    const header = sheet.insertRow(rowNumber++, DETAIL_HEADERS);
    header.height = 24;
    header.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF195A8D' } }; });
    if (!rows.length) sheet.insertRow(rowNumber++, ['当日无数据']);
    for (const row of rows) sheet.insertRow(rowNumber++, detailValues(row));
    sheet.insertRow(rowNumber++, []);
  }
  sheet.getCell('A1').value = title;
  sheet.getCell('O1').value = { formula: 'HYPERLINK("#看板首页!A1","返回看板")', result: '返回看板' };
  sheet.getCell('O1').font = { bold: true, underline: true, color: { argb: 'FF0563C1' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function detailValues(row) {
  return [row.reportDate || '', bill(row), row.orderTime || row.下单时间 || '', row.deliveryTime || row.派件时间 || '', row.statusCode || row.状态标识 || '', row.statusDesc || row.状态说明 || row.currentState || '', row.recipientProvince || row.收件省份 || '', region(row) === 'PP' ? '金边' : '外省', row.currentStore || row.当前门店 || '', row.currentProvince || row.当前省份 || '', row.recipient || row.收件人 || '', row.recipientPhone || row.收件人手机 || '', row.recipientAddress || row.收件地址 || '', row.courier || row.派件快递员 || '', row.exceptionDescription || row.异常描述 || row.primaryCategory || ''];
}

function metrics(rows) {
  const all = rows.length;
  const count = predicate => rows.filter(predicate).length;
  const pod = count(isPod); const delivery = count(isDelivery); const pending = count(row => pendingDays(row) > 0); const returned = count(isReturned);
  return { all, pp: count(row => region(row) === 'PP'), pv: count(row => region(row) === 'PV'), store: count(row => Boolean(row.currentStore || row.当前门店 || row.storeCode)), pod, notPod: all - pod, delivery, pending, returned, podRate: ratio(pod, all), notPodRate: ratio(all - pod, all), deliveryRate: ratio(delivery, all), pendingRate: ratio(pending, all), returnRate: ratio(returned, all) };
}

function setMergedFormula(sheet, row, column, target, display) { sheet.getCell(row, column).value = hyperlink(target, display); sheet.getCell(row, column + 1).value = hyperlink(target, display); }
function hyperlink(target, display) { const text = typeof display === 'string' ? `"${display.replaceAll('"', '""')}"` : Number(display || 0); return { formula: `HYPERLINK("#${target}!A1",${text})`, result: display }; }
function copyRowStyle(source, target) { target.height = source.height; source.eachCell({ includeEmpty: true }, (cell, col) => { target.getCell(col).style = { ...cell.style }; }); }
function uniqueRows(rows) { const map = new Map(); for (const row of rows) { const code = bill(row); if (code) map.set(code, row); } return [...map.values()]; }
function buildGroups(rows) { return { all: rows.length, pp: rows.filter(row => region(row) === 'PP').length, pv: rows.filter(row => region(row) === 'PV').length }; }
function bill(row = {}) { return String(row.shipmentCode || row.运单号 || row.运单编号 || '').trim().toUpperCase(); }
function region(row = {}) { const value = String(row.regionCode || row.regionType || row.区域分类 || '').toUpperCase(); return value.includes('PP') || value.includes('金边') ? 'PP' : 'PV'; }
function isPod(row = {}) { return String(row.currentState || row.scanNormalizedState || '').toUpperCase() === 'POD' || String(row.orderStatus || '') === '85' || row.是否POD === '是'; }
function isReturned(row = {}) { return String(row.currentState || row.scanNormalizedState || row.退回状态 || '').toUpperCase().includes('RETURN_COMPLETED') || row.是否退回 === '是'; }
function isDelivery(row = {}) { return /DELIVERY|派送中|派件分配/.test(String(row.currentState || row.primaryCategory || row.状态说明 || '').toUpperCase()); }
function pendingDays(row = {}) { return Number(row.pendingUniqueDayCount || row.pendingDays || row.Pending天数 || 0); }
function ratio(a, b) { return b ? a / b : 0; }

