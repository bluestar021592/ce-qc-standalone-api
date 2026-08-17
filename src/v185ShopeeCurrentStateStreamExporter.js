import path from 'node:path';
import ExcelJS from 'exceljs';
import { getDb } from './db.js';

const VERSION = '2026-08-17-v185-shopee-current-state-stream-export-v1';
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const FONT_NAME = 'Microsoft YaHei';
const DETAIL_HEADERS = [
  '首次日报日期', '运单编号', '下单时间', '状态标识', '状态说明', '收件省份', '区域分类', '当前门店', '当前省份',
  '收件人', '收件人手机', '收件地址', 'POD/签收时间', '派件门店', '派件省份', '派件快递员', '异常编码', '异常描述', '备注'
];
const DETAIL_WIDTHS = [14, 24, 21, 11, 18, 16, 12, 22, 16, 18, 17, 42, 21, 20, 16, 18, 12, 28, 38];

function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function normalizeBill(value = '') { return String(value || '').trim().toUpperCase(); }
function normalizeHeader(value = '') { return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, ''); }
function dateKey(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
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
function listDates(from, to) {
  const a = dayNumber(from), b = dayNumber(to);
  if (a === null || b === null || b < a) return [];
  const rows = [];
  for (let t = a; t <= b; t += 86400000) rows.push(new Date(t).toISOString().slice(0, 10));
  return rows;
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
function firstReportRows(db, businessType, batches, onProgress = () => {}) {
  const stmt = db.prepare(`SELECT shipmentCode,regionCode,rowNumber,rowJson
    FROM unified_import_rows WHERE snapshotId=? AND businessType=? ORDER BY rowNumber,shipmentCode`);
  const byBill = new Map();
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const reportDate = String(batch.reportDate || '');
    for (const row of stmt.iterate(batch.snapshotId, businessType)) {
      const bill = normalizeBill(row.shipmentCode);
      if (!bill || byBill.has(bill)) continue;
      const { parsed, map } = rawMap(row.rowJson);
      byBill.set(bill, {
        firstReportDate: reportDate,
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
      });
    }
    onProgress({ phase: 'sourceRows', completed: index + 1, total: Math.max(1, batches.length), entries: byBill.size });
  }
  return [...byBill.values()].sort((a, b) => a.firstReportDate.localeCompare(b.firstReportDate) || a.rowNumber - b.rowNumber || a.shipmentCode.localeCompare(b.shipmentCode));
}
function pendingCountOf(state = {}) {
  const direct = [state.Pending当前次数,state.Pending次数,state.pendingDistinctDayCount,state.pendingCount,state.pendingTimes,state.pendingDays,state.pendingDayCount]
    .map(Number).find(value => Number.isFinite(value) && value >= 0);
  if (Number.isFinite(direct)) return direct;
  if (Array.isArray(state.pendingDates)) return new Set(state.pendingDates.map(value => String(value || '').slice(0, 10)).filter(Boolean)).size;
  return 0;
}
function stateEvidence(row = {}) {
  const parsed = safeJson(row.stateJson, {});
  const stateName = String(row.state || parsed.currentState || parsed.state || parsed.primaryCategory || parsed.主分类 || parsed.异常分类 || '').trim();
  const category = String(parsed.primaryCategory || parsed.主分类 || parsed.异常分类 || stateName || '').trim();
  const eventTime = String(parsed.POD时间 || parsed.退回完成时间 || parsed.退回时间 || parsed.latestEventTime || parsed.最后节点时间 || row.lastEventTime || '').trim();
  const eventDesc = String(parsed.latestEventDesc || parsed.最后节点 || parsed.QC判断 || category || '').trim();
  const eventNode = String(parsed.latestNode || parsed.currentHub || parsed.currentShop || parsed.当前门店 || '').trim();
  const evidence = `${stateName} ${category} ${eventDesc} ${eventNode}`;
  const pod = String(row.state || '').toUpperCase() === 'POD' || parsed.是否POD === '是' || String(parsed.orderStatus || '') === '85' || /\bPOD\b|签收|妥投/i.test(evidence);
  const returned = !pod && (['RETURNED','RETURN_COMPLETED'].includes(String(row.state || '').toUpperCase()) || parsed.退回状态 === '已退回' || /RETURN_COMPLETED|RETURNED|已退回|退回完成|R退回/i.test(evidence));
  const cancelled = !pod && !returned && (['CANCELLED','CANCELED'].includes(String(row.state || '').toUpperCase()) || /取消|CANCEL/i.test(evidence));
  const pending = !pod && !returned && !cancelled && (String(parsed.currentState || '').toUpperCase() === 'PENDING' || /Pending\d*次|PENDING/i.test(category) || /PENDING/i.test(evidence));
  const delivering = !pod && !returned && !cancelled && !pending && (/DELIVERY|派送|派件|ASSIGN/i.test(evidence));
  return { parsed, stateName, category, eventTime, eventDesc, eventNode, pod, returned, cancelled, pending, delivering, pendingCount: pendingCountOf(parsed), updatedAt: String(row.updatedAt || '') };
}
function loadCurrentStates(db, businessType, bills, onProgress = () => {}) {
  const map = new Map();
  const chunkSize = 350;
  for (let offset = 0; offset < bills.length; offset += chunkSize) {
    const chunk = bills.slice(offset, offset + chunkSize);
    const marks = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT shipmentCode,businessType,state,apiStatus,lastEventTime,stateJson,updatedAt
      FROM shipment_current_state WHERE businessType=? AND shipmentCode IN (${marks})`).all(businessType, ...chunk);
    for (const row of rows) {
      const bill = normalizeBill(row.shipmentCode);
      if (bill) map.set(bill, stateEvidence(row));
    }
    onProgress({ phase: 'currentStates', completed: Math.min(offset + chunk.length, bills.length), total: Math.max(1, bills.length), entries: map.size });
  }
  return map;
}
function loadFallbackStates(db, bills, to, onProgress = () => {}) {
  const map = new Map();
  const chunkSize = 350;
  for (let offset = 0; offset < bills.length; offset += chunkSize) {
    const chunk = bills.slice(offset, offset + chunkSize);
    const marks = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT shipmentCode,reportDate,isPod,primaryCategory,latestEventTime,latestEventDesc,latestNode,updatedAt
      FROM business_final_rows WHERE businessType='SHOPEE' AND reportDate<=? AND shipmentCode IN (${marks})
      ORDER BY shipmentCode ASC,reportDate DESC,updatedAt DESC`).all(to, ...chunk);
    for (const row of rows) {
      const bill = normalizeBill(row.shipmentCode);
      if (!bill || map.has(bill)) continue;
      const evidence = `${row.primaryCategory || ''} ${row.latestEventDesc || ''} ${row.latestNode || ''}`;
      map.set(bill, {
        pod: Number(row.isPod || 0) === 1 || /\bPOD\b|签收|妥投/i.test(evidence),
        returned: /RETURN|退回|退件/i.test(evidence),
        cancelled: /取消|CANCEL/i.test(evidence),
        pending: /PENDING/i.test(evidence),
        delivering: /派送|派件|DELIVER|ASSIGN/i.test(evidence),
        pendingCount: 0,
        category: String(row.primaryCategory || ''),
        eventTime: String(row.latestEventTime || ''),
        eventDesc: String(row.latestEventDesc || ''),
        eventNode: String(row.latestNode || ''),
        updatedAt: String(row.updatedAt || ''),
        fallback: true
      });
    }
    onProgress({ phase: 'finalStates', completed: Math.min(offset + chunk.length, bills.length), total: Math.max(1, bills.length), entries: map.size });
  }
  return map;
}
function appendRemark(base, pieces = []) { return [String(base || '').trim(), ...pieces.filter(Boolean)].filter(Boolean).join('；'); }
function isStore(row) {
  const text = `${row.currentShop || ''} ${row.deliveryShop || ''}`.trim();
  if (!text || /\bWHPP\b|\bWHJT\d*\b/i.test(text)) return false;
  return /(?:^|\b)(?:CP|FS)[A-Z0-9_-]*/i.test(text) || /\bSHOP\b|CO[-\s]?SHOP|PT[-\s]?SHOP/i.test(text);
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
function applyState(row, state = null) {
  let status = String(row.rawStatus || '').trim().toUpperCase();
  let statusDesc = String(row.rawStatusDesc || '').trim();
  let deliveryTime = String(row.rawDeliveryTime || '').trim();
  const next = { ...row };
  if (state?.eventNode) next.currentShop = state.eventNode;
  if (state?.pod) {
    status = 'Y'; statusDesc = 'POD';
    if (state.eventTime) deliveryTime = state.eventTime;
  } else if (state?.returned) {
    status = 'R'; statusDesc = 'R退回';
  } else if (state?.cancelled) {
    status = 'N'; statusDesc = '订单取消';
  } else if (state?.pending) {
    status = 'P'; statusDesc = Number(state.pendingCount || 0) > 0 ? `Pending（${Number(state.pendingCount)}次）` : 'Pending';
  } else if (state?.delivering) {
    status = 'W'; statusDesc = '分配派送中';
  }
  const pod = status === 'Y' || /\bPOD\b|签收|妥投/i.test(statusDesc);
  const returned = !pod && (status === 'R' || /RETURN|退回|退件/i.test(statusDesc));
  const cancelled = !pod && !returned && (status === 'N' || /取消|CANCEL/i.test(statusDesc));
  const pending = !pod && !returned && !cancelled && (status === 'P' || /PENDING/i.test(statusDesc));
  const delivering = !pod && !returned && !cancelled && !pending && (status === 'W' || /派件|派送|DELIVER/i.test(statusDesc));
  const podDate = pod ? dateKey(deliveryTime) : '';
  const deliveryDays = podDate ? naturalDays(next.firstReportDate, podDate) : '';
  const notes = [];
  if (state?.pending && Number(state.pendingCount || 0) > 0) notes.push(`Pending次数:${Number(state.pendingCount)}`);
  if (state?.updatedAt) notes.push(`当前状态更新:${state.updatedAt}`);
  if (state?.fallback) notes.push('状态来源:历史完成快照');
  next.remark = appendRemark(next.remark, notes);
  next.status = status;
  next.statusDesc = statusDesc;
  next.deliveryTime = deliveryTime;
  next.finalCategory = String(state?.category || '');
  next.pod = pod;
  next.returned = returned;
  next.cancelled = cancelled;
  next.pending = pending;
  next.delivering = delivering;
  next.podDate = podDate;
  next.deliveryDays = deliveryDays;
  next.pendingCount = Number(state?.pendingCount || 0);
  next.area = regionClass(next);
  return next;
}
function outputRow(row) {
  const recipientProvince = row.area === '门店' ? '门店' : (row.recipientProvince || (row.area === '金边' ? '金边市' : ''));
  return [
    row.firstReportDate, row.shipmentCode, row.orderTime, row.status, row.statusDesc, recipientProvince, row.area,
    row.currentShop, row.currentProvince, row.recipient, row.recipientPhone, row.recipientAddress,
    row.deliveryTime, row.deliveryShop, row.deliveryProvince, row.courier, row.exceptionCode, row.exceptionDesc || row.finalCategory, row.remark
  ];
}
function emptyDay(date) { return { date,total:0,pp:0,pv:0,store:0,pod:0,notPod:0,delivering:0,pending:0,returned:0,cancelled:0,podDays:[],missingPodTime:0,t1:0,t2:0,t3:0 }; }
function buildStats(rows, range) {
  const days = new Map(listDates(range.from, range.to).map(date => [date, emptyDay(date)]));
  const overall = emptyDay('TOTAL');
  for (const row of rows) {
    if (!days.has(row.firstReportDate)) days.set(row.firstReportDate, emptyDay(row.firstReportDate));
    for (const stat of [days.get(row.firstReportDate), overall]) {
      stat.total += 1;
      if (row.area === '金边') stat.pp += 1; else if (row.area === '门店') stat.store += 1; else stat.pv += 1;
      if (row.pod) {
        stat.pod += 1;
        const d = Number(row.deliveryDays || 0);
        if (d > 0) { stat.podDays.push(d); if (d === 1) stat.t1 += 1; else if (d === 2) stat.t2 += 1; else stat.t3 += 1; }
        else stat.missingPodTime += 1;
      }
      if (row.returned) stat.returned += 1;
      if (row.cancelled) stat.cancelled += 1;
      if (row.pending) stat.pending += 1;
      if (row.delivering) stat.delivering += 1;
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
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
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
function writeCard(sheet, col, label, value, ratio, targetSheet) {
  const labelCell = `${col}4`, valueCell = `${col}5`, rateCell = `${col}6`, linkCell = `${col}7`;
  sheet.getCell(labelCell).value = label;
  sheet.getCell(valueCell).value = value;
  sheet.getCell(rateCell).value = ratio;
  sheet.getCell(rateCell).numFmt = '0.00%';
  setLink(sheet.getCell(linkCell), '点击查看明细', targetSheet);
  sheet.getCell(labelCell).font = { name: FONT_NAME, bold: true, color: { argb: 'FF17365D' } };
  sheet.getCell(valueCell).font = { name: FONT_NAME, bold: true, size: 16, color: { argb: 'FF17365D' } };
  sheet.getCell(rateCell).font = { name: FONT_NAME, color: { argb: 'FF657B95' } };
  [labelCell,valueCell,rateCell,linkCell].forEach(addr => { sheet.getCell(addr).alignment = { horizontal: 'center', vertical: 'middle' }; });
}
function writeDashboard(sheet, businessType, range, stats, lastRefreshAt) {
  const { overall, daily } = stats;
  sheet.columns = Array.from({ length: 20 }, (_, index) => ({ width: index % 2 === 0 ? 15 : 2.5 }));
  sheet.mergeCells('A1:T1');
  sheet.getCell('A1').value = `${displayType(businessType)}每日数据看板`;
  sheet.getCell('A1').font = { name: FONT_NAME, bold: true, size: 18, color: { argb: 'FF17365D' } };
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 30;
  writeCard(sheet,'A','总票数',overall.total,1,'全部明细');
  writeCard(sheet,'C','金边PP',overall.pp,rate(overall.pp,overall.total),'金边明细');
  writeCard(sheet,'E','外省PV',overall.pv,rate(overall.pv,overall.total),'外省明细');
  writeCard(sheet,'G','门店',overall.store,rate(overall.store,overall.total),'门店明细');
  writeCard(sheet,'I','已POD',overall.pod,rate(overall.pod,overall.total),'POD明细');
  writeCard(sheet,'K','未POD',overall.notPod,rate(overall.notPod,overall.total),'未POD明细');
  writeCard(sheet,'M','派送中',overall.delivering,rate(overall.delivering,overall.total),'分配派送中明细');
  writeCard(sheet,'O','Pending',overall.pending,rate(overall.pending,overall.total),'Pending明细');
  writeCard(sheet,'Q','已退回',overall.returned,rate(overall.returned,overall.total),'退回明细');
  sheet.getCell('S4').value='平均派件天数';sheet.getCell('S5').value=avg(overall.podDays);sheet.getCell('S6').value=`有效POD时间 ${overall.podDays.length}票`;
  sheet.getCell('S4').font={name:FONT_NAME,bold:true,color:{argb:'FF17365D'}};sheet.getCell('S5').font={name:FONT_NAME,bold:true,size:16,color:{argb:'FF17365D'}};sheet.getCell('S6').font={name:FONT_NAME,color:{argb:'FF657B95'}};
  const headers=['首次日报日期','唯一票数','已POD','POD率','平均派件天数','T1','T2','T3+','金边PP','外省PV','门店','Pending','派送中','退回/退件','取消'];
  const headerRow=sheet.getRow(10);headers.forEach((h,i)=>headerRow.getCell(i+1).value=h);styleHeader(headerRow);
  let r=11;
  for(const d of daily){const vals=[d.date,d.total,d.pod,rate(d.pod,d.total),avg(d.podDays),d.t1,d.t2,d.t3,d.pp,d.pv,d.store,d.pending,d.delivering,d.returned,d.cancelled];vals.forEach((v,i)=>sheet.getCell(r,i+1).value=v);sheet.getCell(r,4).numFmt='0.00%';r++;}
  sheet.getCell(`A${r+1}`).value=`日期范围：${range.from} 至 ${range.to}`;
  sheet.getCell(`A${r+2}`).value='唯一票口径：按所选区间内首次出现日报归属，每票只保留一次。';
  sheet.getCell(`A${r+3}`).value='状态口径：优先使用 shipment_current_state 最新刷新结果；无当前状态时回退历史完成快照。';
  sheet.getCell(`A${r+4}`).value='派件天数：首次日报日期 → 实际POD/签收时间，自然日计算，同日=1天；缺POD时间不强制算1天。';
  sheet.getCell(`A${r+5}`).value=`当前状态最后更新时间：${lastRefreshAt || '无'}；导出引擎：${VERSION}`;
  for(let rr=r+1;rr<=r+5;rr++)sheet.getCell(`A${rr}`).font={name:FONT_NAME,color:{argb:'FF657B95'}};
  sheet.views=[{state:'frozen',ySplit:10}];
}

export async function createShopeeCurrentStateStreamWorkbook({ type, periodType='custom', range, outputDir, onProgress=()=>{} }) {
  const businessType=String(type||'').trim().toUpperCase();
  if(!SHOPEE_TYPES.has(businessType))throw new Error(`V185仅支持SHOPEECN/SHOPEEVN：${businessType}`);
  const db=getDb();
  const batches=latestCompletedBatches(db,range.from,range.to);
  if(!batches.length)throw new Error(`${range.from} 至 ${range.to} 没有 VALID + COMPLETED 日快照。`);
  onProgress({phase:'start',completed:0,total:batches.length,entries:0});
  const source=firstReportRows(db,businessType,batches,onProgress);
  if(!source.length)throw new Error(`${displayType(businessType)} 在 ${range.from} 至 ${range.to} 没有可导出的业务数据。`);
  const bills=source.map(row=>row.shipmentCode);
  const current=loadCurrentStates(db,businessType,bills,onProgress);
  const fallbackMissing=bills.filter(bill=>!current.has(bill));
  const fallback=fallbackMissing.length?loadFallbackStates(db,fallbackMissing,range.to,onProgress):new Map();
  let lastRefreshAt='';
  const rows=source.map(row=>{
    const state=current.get(row.shipmentCode)||fallback.get(row.shipmentCode)||null;
    if(state?.updatedAt&&state.updatedAt>lastRefreshAt)lastRefreshAt=state.updatedAt;
    return applyState(row,state);
  });
  const stats=buildStats(rows,range);
  const fileName=safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_每日数据看板_${range.from}_至_${range.to}.xlsx`);
  const filePath=path.join(outputDir,fileName);
  const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({filename:filePath,useStyles:true,useSharedStrings:false});
  workbook.creator='CE Express QC';workbook.created=new Date();
  const dashboard=workbook.addWorksheet('每日看板');
  const sheets={all:addDetailSheet(workbook,'全部明细'),pp:addDetailSheet(workbook,'金边明细'),pv:addDetailSheet(workbook,'外省明细'),store:addDetailSheet(workbook,'门店明细'),pod:addDetailSheet(workbook,'POD明细'),notPod:addDetailSheet(workbook,'未POD明细'),delivering:addDetailSheet(workbook,'分配派送中明细'),pending:addDetailSheet(workbook,'Pending明细'),returned:addDetailSheet(workbook,'退回明细')};
  writeDashboard(dashboard,businessType,range,stats,lastRefreshAt);dashboard.commit();
  let completed=0;
  for(const row of rows){
    const values=outputRow(row);writeDetailRow(sheets.all,values);
    if(row.area==='金边')writeDetailRow(sheets.pp,values);else if(row.area==='门店')writeDetailRow(sheets.store,values);else writeDetailRow(sheets.pv,values);
    if(row.pod)writeDetailRow(sheets.pod,values);else writeDetailRow(sheets.notPod,values);
    if(row.delivering)writeDetailRow(sheets.delivering,values);if(row.pending)writeDetailRow(sheets.pending,values);if(row.returned)writeDetailRow(sheets.returned,values);
    completed+=1;if(completed%500===0||completed===rows.length)onProgress({phase:'writing',completed,total:rows.length,entries:rows.length});
  }
  Object.values(sheets).forEach(sheet=>sheet.commit());
  await workbook.commit();
  return {file:filePath,summary:{type:businessType,total:stats.overall.total,pod:stats.overall.pod,notPod:stats.overall.notPod,podRate:Number((rate(stats.overall.pod,stats.overall.total)*100).toFixed(2)),averageDeliveryDays:avg(stats.overall.podDays),validDeliveryDaySamples:stats.overall.podDays.length,missingPodTime:stats.overall.missingPodTime,t1:stats.overall.t1,t2:stats.overall.t2,t3:stats.overall.t3,pp:stats.overall.pp,pv:stats.overall.pv,store:stats.overall.store,returned:stats.overall.returned,pending:stats.overall.pending,delivering:stats.overall.delivering,cancelled:stats.overall.cancelled,lastCurrentStatusAt:lastRefreshAt,engine:VERSION,statusSource:'SHIPMENT_CURRENT_STATE_FIRST_REPORT_UNIQUE',outputContract:'LEGACY_10_SHEETS_ONE_PASS_STREAM'}};
}

export const V185_SHOPEE_STREAM_EXPORT_VERSION=VERSION;
