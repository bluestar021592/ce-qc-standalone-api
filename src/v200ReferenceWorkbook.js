import ExcelJS from 'exceljs';
import { ratio, anchor, completeAttemptRatio, completeSigningAverage } from './v200Metrics.js';

export const V481_VERIFIED_METRIC_SCOPE_ID='2026-09-09-v492-shopee-only-verified-export-metrics-v1';
const STRICT_VERIFIED_METRIC_TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const FONT = 'Microsoft YaHei';
const DETAIL_SHEETS = ['全部明细', '金边明细', '外省明细', '门店明细', 'POD明细', '未POD明细', '分配派送中明细', 'Pending明细', '退回明细'];
const DETAIL_HEADERS = ['日期', '运单编号', '下单时间', '状态标识', '状态说明', '收件省份', '区域分类', '当前门店', '当前省份', '收件人', '收件人手机', '收件地址', '派件时间', '派件门店', '派件省份', '派件快递员', '异常编码', '异常描述', '备注'];
const DETAIL_WIDTHS = [12, 18, 20, 10, 12, 14, 10, 18, 12, 12, 16, 30, 20, 18, 12, 14, 12, 20, 22];
function displayType(type) { return ({ SHOPEECN: '中国虾皮', SHOPEEVN: '越南虾皮' })[type] || type; }
function internalFormula(sheet, row, display) {
  const escaped = String(sheet).replaceAll("'", "''");
  const shown = typeof display === 'number' ? String(display) : `"${String(display ?? '').replaceAll('"', '""')}"`;
  return { formula: `HYPERLINK("#'${escaped}'!A${row}",${shown})`, result: display };
}
function thinBorder(color = 'FF8EA9DB') {
  return { left: { style: 'thin', color: { argb: color } }, right: { style: 'thin', color: { argb: color } }, top: { style: 'thin', color: { argb: color } }, bottom: { style: 'thin', color: { argb: color } } };
}
function applyCardCell(cell, fill, { title = false, value = false, percent = false, link = false } = {}) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.border = thinBorder();
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.font = { name: FONT, size: value ? 15 : 10, bold: title || value || percent || link, color: { argb: value || percent || link ? 'FF0B57D0' : 'FF000000' } };
  if (percent) cell.numFmt = '0.00%';
}
function styleSection(row) {
  row.height = 16.5;
  row.eachCell({ includeEmpty: true }, cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; cell.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; });
}
function styleSubHeader(row) {
  row.height = 14.5;
  row.eachCell({ includeEmpty: true }, cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } }; cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF000000' } }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
}
function styleDashboardDataCell(cell, clickable = false, percent = false) {
  cell.font = { name: FONT, size: 10, bold: clickable, color: clickable ? { argb: 'FF0B57D0' } : { argb: 'FF000000' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  if (clickable) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9E6' } };
  if (percent) cell.numFmt = '0.00%';
}
function mergePair(sheet, row, col) { sheet.mergeCells(row, col, row, col + 1); }
function writeCard(sheet, pairIndex, label, value, percent, target, fill) {
  const col = 1 + pairIndex * 2;
  for (const row of [4, 5, 6, 7]) mergePair(sheet, row, col);
  const title = sheet.getCell(4, col), valueCell = sheet.getCell(5, col), pct = sheet.getCell(6, col), link = sheet.getCell(7, col);
  title.value = label;
  valueCell.value = internalFormula(target, 1, Number(value || 0));
  pct.value = internalFormula(target, 1, Number(percent || 0));
  link.value = internalFormula(target, 1, '点击查看明细');
  applyCardCell(title, fill, { title: true }); applyCardCell(valueCell, fill, { value: true }); applyCardCell(pct, fill, { percent: true }); applyCardCell(link, fill, { link: true });
}
function publishVerifiedMetric(value){return value===null||value===undefined||!Number.isFinite(Number(value))?'—':Number(value);}
function createDashboard(workbook, type, range, stats, anchors) {
  const sheet = workbook.addWorksheet('每日看板', { views: [{ state: 'frozen', ySplit: 10, xSplit: 1 }] });
  const widths = [13, 10, 10, 10, 10, 3, 13, 10, 11, 10, 10, 11, 11, 11, 11, 11];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.mergeCells('A1:P2');
  const title = sheet.getCell('A1'); title.value = `${displayType(type)}每日数据看板`; title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; title.font = { name: FONT, size: 18, bold: true, color: { argb: 'FFFFFFFF' } }; title.alignment = { horizontal: 'center', vertical: 'middle' };
  for (let col = 2; col <= 16; col++) { const c = sheet.getCell(1, col); c.fill = title.fill; c.font = title.font; }
  sheet.getRow(3).height = 14.5;
  const o = stats.overall;
  const fills = ['FFD9EAF7', 'FFE2F0D9', 'FFFCE4D6', 'FFFFF2CC', 'FFD9EAF7', 'FFFCE4D6', 'FFE2F0D9', 'FFFDE9E7'];
  writeCard(sheet, 0, '总票数', o.total, 1, '全部明细', fills[0]);
  writeCard(sheet, 1, '金边票数', o.pp, ratio(o.pp, o.total), '金边明细', fills[1]);
  writeCard(sheet, 2, '外省票数', o.pv, ratio(o.pv, o.total), '外省明细', fills[2]);
  writeCard(sheet, 3, '门店票数', o.store, ratio(o.store, o.total), '门店明细', fills[3]);
  writeCard(sheet, 4, 'POD票数', o.pod, ratio(o.pod, o.total), 'POD明细', fills[4]);
  writeCard(sheet, 5, '未POD票数', o.notPod, ratio(o.notPod, o.total), '未POD明细', fills[5]);
  writeCard(sheet, 6, '分配派送中', o.delivery, ratio(o.delivery, o.total), '分配派送中明细', fills[6]);
  writeCard(sheet, 7, '退回票数', o.returned, ratio(o.returned, o.total), '退回明细', fills[7]);
  sheet.getRow(5).height = 21.5;
  sheet.mergeCells('A9:E9'); sheet.getCell('A9').value = '每日票量';
  sheet.mergeCells('G9:P9'); sheet.getCell('G9').value = '每日状态';
  styleSection(sheet.getRow(9));
  ['日期', '总票数', '金边', '外省', '门店'].forEach((v, i) => sheet.getCell(10, i + 1).value = v);
  ['日期', 'POD', '派送中', 'Pending', '退回', '未POD', 'POD率', '派送中率', 'Pending率', '退回率'].forEach((v, i) => sheet.getCell(10, i + 7).value = v);
  styleSubHeader(sheet.getRow(10));
  let rowNo = 11;
  for (const d of stats.daily) {
    sheet.getRow(rowNo).height = 14.5;
    sheet.getCell(rowNo, 1).value = d.date; sheet.getCell(rowNo, 7).value = d.date;
    for (const [col, value, target] of [[2,d.total,'全部明细'],[3,d.pp,'金边明细'],[4,d.pv,'外省明细'],[5,d.store,'门店明细']]) {
      const c = sheet.getCell(rowNo, col); c.value = internalFormula(target, anchor(anchors, target, d.date), value); styleDashboardDataCell(c, true, false);
    }
    for (const [col, value, target, percent] of [[8,d.pod,'POD明细',false],[9,d.delivery,'分配派送中明细',false],[10,d.pending,'Pending明细',false],[11,d.returned,'退回明细',false],[12,d.notPod,'未POD明细',false],[13,ratio(d.pod,d.total),'POD明细',true],[14,ratio(d.delivery,d.total),'分配派送中明细',true],[15,ratio(d.pending,d.total),'Pending明细',true],[16,ratio(d.returned,d.total),'退回明细',true]]) {
      const c = sheet.getCell(rowNo, col); c.value = internalFormula(target, anchor(anchors, target, d.date), value); styleDashboardDataCell(c, true, percent);
    }
    styleDashboardDataCell(sheet.getCell(rowNo, 1)); styleDashboardDataCell(sheet.getCell(rowNo, 7)); rowNo++;
  }
  const sectionRow = rowNo + 1;
  sheet.mergeCells(sectionRow, 1, sectionRow, 16); sheet.getCell(sectionRow, 1).value = '派次与平均签收天数'; styleSection(sheet.getRow(sectionRow));
  const metricHeaderRow = sectionRow + 1;
  ['日期','1派POD','1派占POD','2派POD','2派占POD','3派+POD','3派+占POD','总平均签收','金边1派','金边2派','金边3派+','金边平均签收','外省1派','外省2派','外省3派+','外省平均签收'].forEach((v, i) => sheet.getCell(metricHeaderRow, i + 1).value = v);
  styleSubHeader(sheet.getRow(metricHeaderRow));
  const strictVerified=STRICT_VERIFIED_METRIC_TYPES.has(String(type||'').toUpperCase());
  const metricRows = [o, ...stats.daily]; let mr = metricHeaderRow + 1;
  for (let index = 0; index < metricRows.length; index++) {
    const d = metricRows[index];
    const a1Rate = d.pod ? completeAttemptRatio(d, d.a1) : 0, a2Rate = d.pod ? completeAttemptRatio(d, d.a2) : 0, a3Rate = d.pod ? completeAttemptRatio(d, d.a3) : 0;
    const totalAverage = d.pod ? completeSigningAverage(d.days, d.pod) : 0;
    const ppAverage = d.ppPod ? completeSigningAverage(d.ppDays, d.ppPod) : 0;
    const pvAverage = d.pvPod ? completeSigningAverage(d.pvDays, d.pvPod) : 0;
    const verified=[a1Rate,a2Rate,a3Rate,totalAverage,ppAverage,pvAverage];
    if (strictVerified && verified.some(value => value === null || value === undefined || !Number.isFinite(Number(value)))) {
      throw new Error(`V200_VERIFIED_METRIC_MISSING:${d.date}`);
    }
    const values = [index===0?'区间汇总':d.date,d.a1,publishVerifiedMetric(a1Rate),d.a2,publishVerifiedMetric(a2Rate),d.a3,publishVerifiedMetric(a3Rate),publishVerifiedMetric(totalAverage),d.ppA1,d.ppA2,d.ppA3,publishVerifiedMetric(ppAverage),d.pvA1,d.pvA2,d.pvA3,publishVerifiedMetric(pvAverage)];
    values.forEach((value, i) => { const c = sheet.getCell(mr, i + 1); c.value = value; styleDashboardDataCell(c, false, [3,5,7].includes(i+1)); });
    for (const col of [3,5,7]) sheet.getCell(mr,col).numFmt='0.00%';
    for (const col of [8,12,16]) sheet.getCell(mr,col).numFmt='0.00';
    if (index===0) for (let col=1;col<=16;col++){const c=sheet.getCell(mr,col);c.font={name:FONT,size:10,bold:true,color:{argb:'FF0B57D0'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF9E6'}};}
    mr++;
  }
  const noteRow = mr + 1; sheet.mergeCells(noteRow, 1, noteRow, 16);
  sheet.getCell(noteRow, 1).value = `派次口径：轨迹状态码70真实START优先；仅在整票没有70时使用60作为START兜底。连续/重复START不增加派次，只有上一派出现失败或Pending事实后再次START才进入下一派。SHOPEE CN/VN属于严格派次/签收证据业务：POD派次或真实START→POD签收样本不完整时拒绝生成。TBKH、CE、CEAF、ALI1688、WHPP保留已证实票数；无法完整验证的派次占比或平均签收显示“—”，绝不伪造0%、默认1派或默认天数。`;
  sheet.getCell(noteRow, 1).font={name:FONT,size:9,color:{argb:'FF657B95'}};sheet.getCell(noteRow,1).alignment={wrapText:true,vertical:'middle'};sheet.getRow(noteRow).height=42;
  sheet.commit();
}
function detailValues(row) {
  const reportMembershipDate = Array.isArray(row.dailyMembershipDates) && row.dailyMembershipDates.length ? row.dailyMembershipDates[0] : row.firstReportDate;
  return [reportMembershipDate,row.shipmentCode,row.orderTime,row.statusCode,row.statusDesc,row.recipientProvince,row.area,row.currentShop,row.currentProvince,row.recipient,row.recipientPhone,row.recipientAddress,row.pod?row.podTime:(row.rawDeliveryTime||''),row.deliveryShop,row.deliveryProvince,row.courier,row.exceptionCode,row.exceptionDesc,row.remark];
}
function createDetailSheet(workbook, name, rows) {
  const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});DETAIL_WIDTHS.forEach((width,index)=>{sheet.getColumn(index+1).width=width;});
  const header=sheet.addRow(DETAIL_HEADERS);header.height=14.5;header.eachCell(cell=>{cell.font={name:FONT,size:10,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F4E78'}};cell.alignment={horizontal:'center',vertical:'middle'};});
  for(const row of rows){const excelRow=sheet.addRow(detailValues(row));excelRow.eachCell(cell=>{cell.font={name:FONT,size:9,color:{argb:'FF000000'}};});excelRow.getCell(2).numFmt='@';excelRow.commit();}
  sheet.autoFilter={from:'A1',to:'S1'};sheet.commit();
}
function assertMetrics(stats) {
  for (const s of [...stats.daily, stats.overall]) { if (s.total !== s.pp+s.pv+s.unknown) throw new Error(`V200区域对账失败：${s.date}`); if (s.pod !== s.a1+s.a2+s.a3+s.attemptUnknown) throw new Error(`V200派次对账失败：${s.date}`); }
}
export async function writeV200ReferenceWorkbook({file,type,range,rows,stats,bucket,anchors,onProgress=()=>{}}){
  assertMetrics(stats);const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({filename:file,useStyles:true,useSharedStrings:false});workbook.creator='CE Express QC';createDashboard(workbook,type,range,stats,anchors);let completed=0;
  for(const name of DETAIL_SHEETS){createDetailSheet(workbook,name,bucket[name]||[]);completed++;onProgress({phase:'writing',completed,total:DETAIL_SHEETS.length,entries:rows.length,sheet:name});}
  await workbook.commit();
}
export function internalHyperlinkFormulaForV200(sheet,row,display){return internalFormula(sheet,row,display).formula;}
console.info('[CE-QC][V492_VERIFIED_METRIC_SCOPE]',V481_VERIFIED_METRIC_SCOPE_ID,'strict=SHOPEECN+SHOPEEVN; TBKH/CE/CEAF/ALI1688/WHPP publish dash for unverified attempt/signing metrics without fabricating zero or blocking the whole workbook.');