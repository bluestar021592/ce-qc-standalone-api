import path from 'node:path';
import ExcelJS from 'exceljs';
import { getDb } from './db.js';

const VERSION = '2026-08-17-v182-shopee-legacy-layout-period-export-v1';
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const FONT_NAME = 'Microsoft YaHei';
const DETAIL_HEADERS = [
  '日期', '运单编号', '下单时间', '状态标识', '状态说明', '收件省份', '区域分类', '当前门店', '当前省份',
  '收件人', '收件人手机', '收件地址', '派件时间', '派件门店', '派件省份', '派件快递员', '异常编码', '异常描述', '备注'
];
const DETAIL_WIDTHS = [14, 24, 21, 11, 16, 16, 12, 20, 16, 18, 17, 42, 21, 20, 16, 18, 12, 28, 34];

function dateKey(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 10);
}
function dayNumber(value = '') {
  const key = dateKey(value);
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function naturalDays(from, to) {
  const a = dayNumber(from), b = dayNumber(to);
  if (a === null || b === null || b < a) return '';
  return Math.floor((b - a) / 86400000) + 1;
}
function rate(a, b) { return b ? Number(a || 0) / Number(b) : 0; }
function avg(values = []) {
  const nums = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  return nums.length ? Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(2)) : 0;
}
function safeFileName(value = '') { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim(); }
function displayType(type) { return type === 'SHOPEECN' ? 'SHOPEE CN' : type === 'SHOPEEVN' ? 'SHOPEE VN' : type; }
function periodLabel(periodType = 'custom') { return ({ daily: '日报', weekly: '周报', monthly: '月报', custom: '自定义日期' })[periodType] || '区间报表'; }
function normalizeHeader(value = '') { return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, ''); }
function normalizeBill(value = '') { return String(value || '').trim().toUpperCase(); }
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function rawMap(rowJson) {
  const parsed = safeJson(rowJson, {});
  const raw = parsed?.raw && typeof parsed.raw === 'object' ? parsed.raw : {};
  const map = new Map();
  for (const [key, value] of Object.entries(raw)) map.set(normalizeHeader(key), value);
  return { parsed, map };
}
function valueByAliases(map, aliases = []) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (!map.has(key)) continue;
    const value = map.get(key);
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}
function latestCompletedBatches(db, from, to) {
  const rows = db.prepare(`
    SELECT b.snapshotId,b.reportDate,b.createdAt
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ?
    ORDER BY b.reportDate ASC,b.createdAt DESC
  `).all(from, to);
  const byDate = new Map();
  for (const row of rows) if (row.reportDate && !byDate.has(row.reportDate)) byDate.set(row.reportDate, row);
  return [...byDate.values()].sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)));
}
function listDates(from, to) {
  const start = dayNumber(from), end = dayNumber(to);
  if (start === null || end === null || end < start) return [];
  const out = [];
  for (let time = start; time <= end; time += 86400000) out.push(new Date(time).toISOString().slice(0, 10));
  return out;
}
function sourceRows(db, businessType, batches, onProgress = () => {}) {
  const stmt = db.prepare(`SELECT shipmentCode,regionCode,rowNumber,rowJson
    FROM unified_import_rows WHERE snapshotId=? AND businessType=? ORDER BY rowNumber,shipmentCode`);
  const rows = [];
  const bills = new Set();
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const reportDate = String(batch.reportDate || '');
    for (const row of stmt.iterate(batch.snapshotId, businessType)) {
      const bill = normalizeBill(row.shipmentCode);
      if (!bill) continue;
      const { parsed, map } = rawMap(row.rowJson);
      const item = {
        reportDate,
        shipmentCode: bill,
        regionCode: String(row.regionCode || parsed.regionCode || '').trim().toUpperCase(),
        rowNumber: Number(row.rowNumber || parsed.rowNumber || 0),
        orderTime: valueByAliases(map, ['下单时间','下单日期','订单时间','订单日期','ordertime','orderdate']),
        rawStatus: valueByAliases(map, ['状态标识','状态代码','status','statuscode']),
        rawStatusDesc: valueByAliases(map, ['状态说明','状态描述','statusdesc','statusdescription','statusname']),
        recipientProvince: valueByAliases(map, ['收件省份','目的省份','目的地省份','收货省份','receiverprovince','destinationprovince']),
        currentShop: valueByAliases(map, ['当前门店','当前网点','当前站点','currentshop','currentsite']),
        currentProvince: valueByAliases(map, ['当前省份','所在省份','currentprovince']),
        recipient: valueByAliases(map, ['收件人','收件人姓名','收货人','收货人姓名','recipient','receiver','consignee']) || String(parsed.recipientRaw || ''),
        recipientPhone: valueByAliases(map, ['收件人手机','收件人电话','收货人手机','收货人电话','手机号','手机号码','recipientphone','receiverphone']),
        recipientAddress: valueByAliases(map, ['收件地址','收货地址','详细地址','地址','recipientaddress','receiveraddress']),
        rawDeliveryTime: valueByAliases(map, ['派件时间','签收时间','POD时间','podtime','deliverytime']),
        deliveryShop: valueByAliases(map, ['派件门店','派送门店','deliveryshop']),
        deliveryProvince: valueByAliases(map, ['派件省份','派送省份','deliveryprovince']),
        courier: valueByAliases(map, ['派件快递员','派送快递员','快递员','deliverycourier','courier']),
        exceptionCode: valueByAliases(map, ['异常编码','异常代码','exceptioncode']),
        exceptionDesc: valueByAliases(map, ['异常描述','异常说明','exceptiondesc','exceptiondescription']),
        remark: valueByAliases(map, ['备注','remark','remarks','note'])
      };
      rows.push(item);
      bills.add(bill);
    }
    onProgress({ phase: 'sourceRows', completed: index + 1, total: batches.length, entries: rows.length });
  }
  rows.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.rowNumber - b.rowNumber || a.shipmentCode.localeCompare(b.shipmentCode));
  return { rows, bills: [...bills] };
}
function loadLatestFinalStates(db, bills, to, onProgress = () => {}) {
  const latest = new Map();
  const chunkSize = 350;
  for (let offset = 0; offset < bills.length; offset += chunkSize) {
    const chunk = bills.slice(offset, offset + chunkSize);
    const marks = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT shipmentCode,reportDate,isPod,primaryCategory,latestEventTime,latestEventDesc,latestNode,updatedAt
      FROM business_final_rows
      WHERE businessType='SHOPEE' AND reportDate<=? AND shipmentCode IN (${marks})
      ORDER BY shipmentCode ASC,reportDate DESC,updatedAt DESC`).all(to, ...chunk);
    for (const row of rows) {
      const bill = normalizeBill(row.shipmentCode);
      if (bill && !latest.has(bill)) latest.set(bill, row);
    }
    onProgress({ phase: 'finalStates', completed: Math.min(offset + chunk.length, bills.length), total: Math.max(1, bills.length), entries: latest.size });
  }
  return latest;
}
function isPodStatus(status, desc) {
  const code = String(status || '').trim().toUpperCase();
  const text = String(desc || '').trim().toUpperCase();
  return code === 'Y' || /\bPOD\b|签收|妥投/.test(text);
}
function isReturnStatus(status, desc) {
  const code = String(status || '').trim().toUpperCase();
  const text = String(desc || '').trim().toUpperCase();
  return code === 'R' || /RETURN|退回|退件/.test(text);
}
function isPendingStatus(status, desc) {
  const code = String(status || '').trim().toUpperCase();
  return code === 'P' || /PENDING/.test(String(desc || '').toUpperCase());
}
function isDeliveringStatus(status, desc) {
  const code = String(status || '').trim().toUpperCase();
  const text = String(desc || '').trim().toUpperCase();
  return code === 'W' || /派件|派送|DELIVER/.test(text);
}
function applyLatestState(row, state = null) {
  let status = String(row.rawStatus || '').trim().toUpperCase();
  let statusDesc = String(row.rawStatusDesc || '').trim();
  let deliveryTime = String(row.rawDeliveryTime || '').trim();
  let finalCategory = '';
  if (state) {
    finalCategory = String(state.primaryCategory || '').trim();
    const eventText = `${finalCategory} ${state.latestEventDesc || ''} ${state.latestNode || ''}`;
    if (Number(state.isPod || 0) === 1 || /\bPOD\b|签收|妥投/i.test(eventText)) {
      status = 'Y'; statusDesc = 'POD';
      deliveryTime = String(state.latestEventTime || deliveryTime || '').trim();
    } else if (/RETURN|退回|退件/i.test(eventText)) {
      status = 'R'; statusDesc = 'R退回';
    } else if (/PENDING/i.test(eventText)) {
      status = 'P'; statusDesc = 'Pending';
    } else if (/派送|派件|DELIVER|ASSIGN/i.test(eventText)) {
      status = 'W'; statusDesc = '分配派送中';
    }
  }
  const pod = isPodStatus(status, statusDesc);
  const returned = isReturnStatus(status, statusDesc);
  const pending = isPendingStatus(status, statusDesc);
  const delivering = isDeliveringStatus(status, statusDesc);
  const podDate = pod ? dateKey(deliveryTime) : '';
  const deliveryDays = podDate ? naturalDays(row.reportDate, podDate) : '';
  return { ...row, status, statusDesc, deliveryTime, finalCategory, pod, returned, pending, delivering, podDate, deliveryDays };
}
function isStore(row) {
  const current = `${row.currentShop || ''} ${row.deliveryShop || ''}`.trim();
  if (!current) return false;
  if (/\bWHPP\b|\bWHJT\d*\b/i.test(current)) return false;
  return /(?:^|\b)(?:CP|FS)[A-Z0-9_-]*/i.test(current) || /\bSHOP\b|CO[-\s]?SHOP|PT[-\s]?SHOP/i.test(current);
}
function regionClass(row) {
  if (isStore(row)) return '门店';
  const raw = String(row.regionCode || '').toUpperCase();
  if (raw === 'PP') return '金边';
  if (raw === 'PV') return '外省';
  const province = String(row.recipientProvince || '').toUpperCase();
  if (/PHNOM\s*PENH|金边/.test(province)) return '金边';
  return '外省';
}
function outputRow(row) {
  const area = regionClass(row);
  const recipientProvince = area === '门店' ? '门店' : (row.recipientProvince || (area === '金边' ? '金边市' : ''));
  return [
    row.reportDate, row.shipmentCode, row.orderTime, row.status, row.statusDesc, recipientProvince, area,
    row.currentShop, row.currentProvince, row.recipient, row.recipientPhone, row.recipientAddress,
    row.deliveryTime, row.deliveryShop, row.deliveryProvince, row.courier, row.exceptionCode, row.exceptionDesc, row.remark
  ];
}
function emptyDay(date) {
  return { date, total: 0, pp: 0, pv: 0, store: 0, pod: 0, notPod: 0, delivering: 0, pending: 0, returned: 0, podDays: [], missingPodTime: 0, t1: 0, t2: 0, t3: 0 };
}
function buildStats(rows, range) {
  const days = new Map(listDates(range.from, range.to).map(date => [date, emptyDay(date)]));
  const overall = emptyDay('TOTAL');
  for (const row of rows) {
    if (!days.has(row.reportDate)) days.set(row.reportDate, emptyDay(row.reportDate));
    for (const stat of [days.get(row.reportDate), overall]) {
      stat.total += 1;
      const area = regionClass(row);
      if (area === '金边') stat.pp += 1;
      else if (area === '门店') stat.store += 1;
      else stat.pv += 1;
      if (row.pod) {
        stat.pod += 1;
        const d = Number(row.deliveryDays || 0);
        if (d > 0) {
          stat.podDays.push(d);
          if (d === 1) stat.t1 += 1;
          else if (d === 2) stat.t2 += 1;
          else stat.t3 += 1;
        } else stat.missingPodTime += 1;
      }
      if (row.delivering && !row.pod) stat.delivering += 1;
      if (row.pending && !row.pod) stat.pending += 1;
      if (row.returned && !row.pod) stat.returned += 1;
    }
  }
  for (const stat of [...days.values(), overall]) stat.notPod = Math.max(0, stat.total - stat.pod);
  return { daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), overall };
}
function styleHeader(row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.font = { name: FONT_NAME, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF195A8D' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD8E3EC' } } };
  });
}
function addDetailSheet(workbook, name) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = DETAIL_HEADERS.map((header, index) => ({ header, width: DETAIL_WIDTHS[index] }));
  styleHeader(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'S1' };
  return sheet;
}
function writeDetailRow(sheet, values) {
  const row = sheet.addRow(values);
  row.eachCell((cell, column) => {
    cell.font = { name: FONT_NAME, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: column <= 7 ? 'center' : 'left', wrapText: column >= 12 };
  });
  row.commit?.();
}
function setLink(cell, text, targetSheet) {
  cell.value = { text, hyperlink: `#'${targetSheet}'!A1` };
  cell.font = { name: FONT_NAME, color: { argb: 'FF0563C1' }, underline: true };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}
function styleCard(sheet, labelCell, valueCell, rateCell, linkCell) {
  sheet.getCell(labelCell).font = { name: FONT_NAME, bold: true, color: { argb: 'FF17365D' } };
  sheet.getCell(valueCell).font = { name: FONT_NAME, bold: true, size: 16, color: { argb: 'FF17365D' } };
  sheet.getCell(rateCell).font = { name: FONT_NAME, color: { argb: 'FF657B95' } };
  [labelCell, valueCell, rateCell, linkCell].forEach(addr => { sheet.getCell(addr).alignment = { horizontal: 'center', vertical: 'middle' }; });
}
function writeDashboard(sheet, businessType, range, stats) {
  const { overall, daily } = stats;
  sheet.columns = Array.from({ length: 20 }, (_, index) => ({ width: index % 2 === 0 ? 15 : 2.5 }));
  sheet.mergeCells('A1:T1');
  sheet.getCell('A1').value = `${displayType(businessType)}每日数据看板`;
  sheet.getCell('A1').font = { name: FONT_NAME, bold: true, size: 18, color: { argb: 'FF17365D' } };
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 30;
  const cards = [
    ['A4','A5','A6','A7','总票数',overall.total,1,'全部明细'],
    ['C4','C5','C6','C7','金边票数',overall.pp,rate(overall.pp,overall.total),'金边明细'],
    ['E4','E5','E6','E7','外省票数',overall.pv,rate(overall.pv,overall.total),'外省明细'],
    ['G4','G5','G6','G7','门店票数',overall.store,rate(overall.store,overall.total),'门店明细'],
    ['I4','I5','I6','I7','POD票数',overall.pod,rate(overall.pod,overall.total),'POD明细'],
    ['K4','K5','K6','K7','未POD票数',overall.notPod,rate(overall.notPod,overall.total),'未POD明细'],
    ['M4','M5','M6','M7','分配派送中',overall.delivering,rate(overall.delivering,overall.total),'分配派送中明细'],
    ['O4','O5','O6','O7','退回票数',overall.returned,rate(overall.returned,overall.total),'退回明细'],
    ['Q4','Q5','Q6','Q7','平均派件天数',avg(overall.podDays),overall.podDays.length ? 1 : 0,'POD明细']
  ];
  for (const [l,v,r,link,label,value,ratio,target] of cards) {
    sheet.getCell(l).value = label;
    sheet.getCell(v).value = value;
    if (label === '平均派件天数') sheet.getCell(r).value = overall.podDays.length ? `有效POD时间 ${overall.podDays.length}票` : '无有效POD时间';
    else { sheet.getCell(r).value = ratio; sheet.getCell(r).numFmt = '0.00%'; }
    setLink(sheet.getCell(link), '点击查看明细', target);
    styleCard(sheet,l,v,r,link);
  }
  sheet.getCell('S4').value = 'POD时间缺失'; sheet.getCell('S5').value = overall.missingPodTime; sheet.getCell('S6').value = '不计入平均天数/T1-T3';
  styleCard(sheet,'S4','S5','S6','S7'); setLink(sheet.getCell('S7'),'查看POD明细','POD明细');

  sheet.mergeCells('A9:E9'); sheet.getCell('A9').value = '每日票量';
  sheet.mergeCells('G9:T9'); sheet.getCell('G9').value = '每日状态';
  for (const addr of ['A9','G9']) sheet.getCell(addr).font = { name: FONT_NAME, bold: true, size: 12, color: { argb: 'FF17365D' } };
  const volumeHeaders = ['日期','总票数','金边','外省','门店'];
  const statusHeaders = ['日期','POD','派送中','Pending','退回','未POD','POD率','派送中率','Pending率','退回率','平均派件天数','T1','T2','T3+'];
  volumeHeaders.forEach((value, index) => { sheet.getCell(10,index+1).value = value; });
  statusHeaders.forEach((value, index) => { sheet.getCell(10,index+7).value = value; });
  styleHeader(sheet.getRow(10));
  let rowNumber = 11;
  for (const stat of daily) {
    const values1 = [stat.date,stat.total,stat.pp,stat.pv,stat.store];
    const values2 = [stat.date,stat.pod,stat.delivering,stat.pending,stat.returned,stat.notPod,rate(stat.pod,stat.total),rate(stat.delivering,stat.total),rate(stat.pending,stat.total),rate(stat.returned,stat.total),stat.podDays.length ? avg(stat.podDays) : '',stat.t1,stat.t2,stat.t3];
    values1.forEach((value,index)=>{ sheet.getCell(rowNumber,index+1).value=value; });
    values2.forEach((value,index)=>{ sheet.getCell(rowNumber,index+7).value=value; });
    ['M','N','O','P'].forEach(col=>{ sheet.getCell(`${col}${rowNumber}`).numFmt='0.00%'; });
    for (let c=1;c<=20;c++) sheet.getCell(rowNumber,c).font={name:FONT_NAME,size:10};
    rowNumber += 1;
  }
  sheet.getCell(`A${rowNumber+1}`).value = `日期范围：${range.from} 至 ${range.to}`;
  sheet.getCell(`A${rowNumber+2}`).value = '派件天数口径：日报日期 → 实际POD/签收时间，自然日计算，同日=1天；POD时间缺失不强制算1天。';
  sheet.getCell(`A${rowNumber+3}`).value = `导出引擎：${VERSION}`;
  for (let rr=rowNumber+1;rr<=rowNumber+3;rr++) sheet.getCell(`A${rr}`).font={name:FONT_NAME,color:{argb:'FF657B95'}};
  sheet.views = [{ state: 'frozen', ySplit: 10 }];
}

export async function createShopeeSlimPeriodWorkbook({ type, periodType = 'custom', range, outputDir, onProgress = () => {} }) {
  const businessType = String(type || '').trim().toUpperCase();
  if (!SHOPEE_TYPES.has(businessType)) throw new Error(`V182仅支持SHOPEECN/SHOPEEVN：${businessType}`);
  const db = getDb();
  const batches = latestCompletedBatches(db, range.from, range.to);
  if (!batches.length) throw new Error(`${range.from} 至 ${range.to} 没有 VALID + COMPLETED 日快照。`);

  onProgress({ phase: 'start', completed: 0, total: batches.length, entries: 0 });
  const source = sourceRows(db, businessType, batches, onProgress);
  if (!source.rows.length) throw new Error(`${displayType(businessType)} 在 ${range.from} 至 ${range.to} 没有可导出的业务数据。`);
  const latestStates = loadLatestFinalStates(db, source.bills, range.to, onProgress);
  const rows = source.rows.map(row => applyLatestState(row, latestStates.get(row.shipmentCode) || null));
  const stats = buildStats(rows, range);

  const fileName = safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_每日数据看板_${range.from}_至_${range.to}.xlsx`);
  const filePath = path.join(outputDir, fileName);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  workbook.creator = 'CE Express QC';
  workbook.created = new Date();

  const dashboard = workbook.addWorksheet('每日看板');
  const sheets = {
    all: addDetailSheet(workbook, '全部明细'),
    pp: addDetailSheet(workbook, '金边明细'),
    pv: addDetailSheet(workbook, '外省明细'),
    store: addDetailSheet(workbook, '门店明细'),
    pod: addDetailSheet(workbook, 'POD明细'),
    notPod: addDetailSheet(workbook, '未POD明细'),
    delivering: addDetailSheet(workbook, '分配派送中明细'),
    pending: addDetailSheet(workbook, 'Pending明细'),
    returned: addDetailSheet(workbook, '退回明细')
  };
  writeDashboard(dashboard, businessType, range, stats);
  dashboard.commit();

  let completed = 0;
  for (const row of rows) {
    const values = outputRow(row);
    const area = regionClass(row);
    writeDetailRow(sheets.all, values);
    if (area === '金边') writeDetailRow(sheets.pp, values);
    else if (area === '门店') writeDetailRow(sheets.store, values);
    else writeDetailRow(sheets.pv, values);
    if (row.pod) writeDetailRow(sheets.pod, values);
    else writeDetailRow(sheets.notPod, values);
    if (row.delivering && !row.pod) writeDetailRow(sheets.delivering, values);
    if (row.pending && !row.pod) writeDetailRow(sheets.pending, values);
    if (row.returned && !row.pod) writeDetailRow(sheets.returned, values);
    completed += 1;
    if (completed % 500 === 0 || completed === rows.length) onProgress({ phase: 'writing', completed, total: rows.length, entries: rows.length });
  }
  Object.values(sheets).forEach(sheet => sheet.commit());
  await workbook.commit();

  return {
    file: filePath,
    summary: {
      type: businessType,
      from: range.from,
      to: range.to,
      total: stats.overall.total,
      pod: stats.overall.pod,
      notPod: stats.overall.notPod,
      podRate: Number((rate(stats.overall.pod, stats.overall.total) * 100).toFixed(2)),
      averageDeliveryDays: avg(stats.overall.podDays),
      validDeliveryDaySamples: stats.overall.podDays.length,
      missingPodTime: stats.overall.missingPodTime,
      t1: stats.overall.t1,
      t2: stats.overall.t2,
      t3: stats.overall.t3,
      pp: stats.overall.pp,
      pv: stats.overall.pv,
      store: stats.overall.store,
      returned: stats.overall.returned,
      engine: VERSION,
      outputContract: 'LEGACY_10_SHEETS_ONE_WORKBOOK',
      apiRawJsonRead: false,
      sourceRowJsonRead: true
    }
  };
}

export const V181_SHOPEE_SLIM_EXPORT_VERSION = VERSION;
