import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, '../templates/shopee_daily_dashboard_template.xlsx');
const FIRST_SHEETS = ['每日看板', '全部明细', '金边明细', '外省明细', '门店明细', 'POD明细', '未POD明细', '分配派送中明细', 'Pending明细', '退回明细'];
const DETAIL_HEADERS = ['日期','运单编号','下单时间','状态标识','状态说明','收件省份','区域分类','当前门店','当前省份','收件人','收件人手机','收件地址','派件时间','派件门店','派件省份','派件快递员','异常编码','异常描述','备注'];
const EXPORT_PARTITION_CACHE_VERSION = '2026-08-14-v111-single-pass-export-partition-v1';
const BUSINESS_LABELS = {
  ALL: '七业务综合',
  CE: 'CE',
  CEAF: 'CEAF空运',
  TBKH: 'TBKH',
  ALI1688: 'ALI1688',
  WHPP: 'WHPP本土',
  SHOPEECN: '中国虾皮',
  SHOPEEVN: '越南虾皮'
};

export async function createShopeeTemplateWorkbook({ type, periodType, range, snapshots, outputDir }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE);
  normalizeTemplateWorkbook(workbook);
  assertTemplate(workbook);
  repairReturnLinks(workbook);

  const datedRows = snapshots.map(snapshot => ({
    date: snapshot.reportDate,
    rows: uniqueRows(normalizeRows(snapshot.payload?.finalRows)
      .filter(row => type === 'ALL' || String(row.businessType || '').toUpperCase() === type)
      .map(row => ({ ...row, reportDate: row.reportDate || snapshot.reportDate, snapshotId: snapshot.snapshotId })))
  }));

  // Every parcel is classified once for the workbook. The previous implementation
  // re-ran region/POD/Pending/return/store predicates for every detail sheet.
  // Keeping arrays of references is cheap compared with ExcelJS cells and avoids
  // repeatedly re-parsing the same operational state for large monthly exports.
  const prepared = datedRows.map(item => ({ date: item.date, buckets: partitionRows(item.rows) }));
  const allRows = uniqueRows(datedRows.flatMap(item => item.rows));
  const totalBuckets = partitionRows(allRows);
  const totalMetrics = metricsFromBuckets(totalBuckets);
  const groups = { all: totalBuckets.all.length, pp: totalBuckets.pp.length, pv: totalBuckets.pv.length };
  const dateMetrics = prepared.map(item => ({ date: item.date, ...metricsFromBuckets(item.buckets) }));

  fillDashboard(workbook.getWorksheet('每日看板'), type, range, totalMetrics, dateMetrics);
  fillDetailPrepared(workbook.getWorksheet('全部明细'), range, prepared, 'all');
  fillDetailPrepared(workbook.getWorksheet('金边明细'), range, prepared, 'pp');
  fillDetailPrepared(workbook.getWorksheet('外省明细'), range, prepared, 'pv');
  fillDetailPrepared(workbook.getWorksheet('门店明细'), range, prepared, 'store');
  fillDetailPrepared(workbook.getWorksheet('POD明细'), range, prepared, 'pod');
  fillDetailPrepared(workbook.getWorksheet('未POD明细'), range, prepared, 'notPod');
  fillDetailPrepared(workbook.getWorksheet('分配派送中明细'), range, prepared, 'delivery');
  fillDetailPrepared(workbook.getWorksheet('Pending明细'), range, prepared, 'pending');
  fillDetailPrepared(workbook.getWorksheet('退回明细'), range, prepared, 'returned');
  // V650: exports are locked to the user's 10-sheet master; no extra sheets are appended.

  workbook.title = `${type}每日数据看板（${range.from} 至 ${range.to}）`;
  workbook.views = [{ activeTab: 0, firstSheet: 0, visibility: 'visible' }];
  const label = type === 'SHOPEECN' ? 'SHOPEE_CN' : type === 'SHOPEEVN' ? 'SHOPEE_VN' : type === 'ALL' ? '七业务综合' : type;
  const file = path.join(outputDir, `${label}_${periodType}_每日数据看板（${range.from} 至 ${range.to}）.xlsx`);
  await workbook.xlsx.writeFile(file);
  return {
    file,
    audit: {
      rows: allRows.length,
      groups,
      sheetNames: workbook.worksheets.slice(0, 10).map(sheet => sheet.name),
      exportPartitionVersion: EXPORT_PARTITION_CACHE_VERSION
    }
  };
}

function normalizeTemplateWorkbook(workbook) {
  const dashboard=workbook.getWorksheet('看板首页')||workbook.getWorksheet('每日看板');
  if(dashboard) dashboard.name='每日看板';
  const daily=workbook.getWorksheet('每日汇总');
  if(daily) workbook.removeWorksheet(daily.id);
  const wanted=['每日看板','全部明细','金边明细','外省明细','门店明细','POD明细','未POD明细','分配派送中明细','Pending明细','退回明细'];
  for(const name of wanted){
    if(!workbook.getWorksheet(name)) workbook.addWorksheet(name);
  }
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
  sheet.getCell('A1').value = `${BUSINESS_LABELS[type] || type}每日数据看板`;

  // V767: the 10-sheet master has seven TWO-column merged KPI slots
  // (A:B, C:D, E:F, G:H, I:J, K:L, M:N). V650 placed the store
  // card at F5, which silently overwrote the E:F province (PV) slot.
  // Keep PP+PV separately visible; stores remain linked on each date's
  // row and on the independent 门店明细 worksheet.
  const topSpecs=[
    ['A5','全部明细',total.all,1],
    ['C5','金边明细',total.pp,total.all],
    ['E5','外省明细',total.pv,total.all],
    ['G5','POD明细',total.pod,total.all],
    ['I5','未POD明细',total.notPod,total.all],
    ['K5','分配派送中明细',total.delivery,total.all],
    ['M5','退回明细',total.returned,total.all]
  ];
  for(const [address,target,count,denominator] of topSpecs){
    const col=sheet.getCell(address).col;
    setMergedFormula(sheet,5,col,target,count);
    setMergedFormula(sheet,6,col,target,denominator?count/denominator:0);
    setMergedFormula(sheet,7,col,target,'点击查看明细');
  }
  setMergedValue(sheet,5,16,total.returnRate);
  setMergedValue(sheet,6,16,'退回票数 / 总票数');
  setMergedValue(sheet,7,16,'');
  setMergedValue(sheet,5,18,total.avgSigningDays);
  setMergedValue(sheet,6,18,'平均签收天数');
  setMergedValue(sheet,7,18,'平均签收天数');
  setMergedValue(sheet,5,20,total.ppAvgSigningDays);
  setMergedValue(sheet,6,20,'平均签收天数');
  setMergedValue(sheet,7,20,'平均签收天数');
  setMergedValue(sheet,5,22,total.pvAvgSigningDays);
  setMergedValue(sheet,6,22,'平均签收天数');
  setMergedValue(sheet,7,22,'平均签收天数');

  const headers=['日期','总票数','金边','外省','门店','日期','POD','派送中','Pending','退回','未POD','POD率','派送中率','Pending率','退回率','总平均签收','金边平均签收','外省平均签收'];
  headers.forEach((value,index)=>{sheet.getCell(10,index+1).value=value;});

  const clearTo=Math.max(sheet.rowCount,11+daily.length+5);
  for(let row=11;row<=clearTo;row+=1){
    for(let col=1;col<=18;col+=1) sheet.getCell(row,col).value=null;
  }
  daily.forEach((item,index)=>{
    const row=11+index;
    sheet.getCell(row,1).value=item.date;
    sheet.getCell(row,6).value=item.date;
    const values=[item.all,item.pp,item.pv,item.store,item.pod,item.delivery,item.pending,item.returned,item.notPod,item.podRate,item.deliveryRate,item.pendingRate,item.returnRate];
    const columns=[2,3,4,5,7,8,9,10,11,12,13,14,15];
    const targets=['全部明细','金边明细','外省明细','门店明细','POD明细','分配派送中明细','Pending明细','退回明细','未POD明细','POD明细','分配派送中明细','Pending明细','退回明细'];
    columns.forEach((column,i)=>{sheet.getCell(row,column).value=hyperlink(targets[i],values[i]);});
    sheet.getCell(row,16).value=item.avgSigningDays??'';
    sheet.getCell(row,17).value=item.ppAvgSigningDays??'';
    sheet.getCell(row,18).value=item.pvAvgSigningDays??'';
  });
}

function fillDailySummary(sheet, range, daily) {
  sheet.getCell('A1').value = `每日完整汇总（${range.from} 至 ${range.to}）`;
  clearDataRows(sheet, 4);
  daily.forEach((item, index) => {
    const row = sheet.getRow(index + 4);
    row.values = [item.date, item.all, item.pp, item.pv, item.store, item.pod, item.notPod, item.delivery, item.pending, item.returned, item.podRate, item.notPodRate, item.deliveryRate, item.pendingRate, item.returnRate];
    copyRowStyle(sheet.getRow(3), row);
    row.eachCell(cell => { cell.font = { ...cell.font, bold: false, color: { argb: 'FF18324F' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFF8FBFF' : 'FFFFFFFF' } }; });
  });
}

function fillDetailPrepared(sheet, range, prepared, bucketKey) {
  for(let col=1;col<=DETAIL_HEADERS.length;col+=1) sheet.getCell(1,col).value=DETAIL_HEADERS[col-1];
  clearDataRows(sheet,2);
  const rows=[];
  for(const item of prepared){
    for(const row of item.buckets?.[bucketKey]||[]) rows.push(row);
  }
  rows.sort((a,b)=>String(a.reportDate||'').localeCompare(String(b.reportDate||''))||bill(a).localeCompare(bill(b)));
  rows.forEach((row,index)=>{
    const dataRow=sheet.getRow(index+2);
    dataRow.values=detailValues(row);
    const shipmentCode=bill(row);
    if(shipmentCode){
      const billCell=dataRow.getCell(2);
      // V767: retain the user's exact 10-sheet master, and restore the
      // shipment-specific CE-QC detail hyperlink (not an Excel formula).
      // Explicit businessType keeps CN/VN scope separate on app drilldown.
      billCell.value={text:shipmentCode,hyperlink:detailUrl(row)};
      billCell.numFmt='@';
    }
  });
  sheet.views=[{state:'frozen',ySplit:1}];
  sheet.autoFilter={from:'A1',to:`S${Math.max(2,rows.length+1)}`};
}

function appendPvOpenDetailPrepared(workbook, name, range, prepared, bucketKey) {
  const sheet = workbook.getWorksheet(name) || workbook.addWorksheet(name);
  sheet.columns = [16, 20, 19, 19, 16, 28, 18, 16, 22, 18, 20, 20, 34, 22, 34].map(width => ({ width }));
  fillDetailPrepared(sheet, range, prepared, bucketKey);
}

function clearDataRows(sheet, startRow) {
  for (let rowNumber = startRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let column = 1; column <= 15; column += 1) row.getCell(column).value = null;
  }
}

function detailValues(row) {
  return [
    row.reportDate||'',
    bill(row),
    row.orderTime||row.下单时间||'',
    row.statusCode||row.状态标识||(isReturned(row)?'R':isPod(row)?'Y':''),
    row.statusDesc||row.状态说明||row.currentState||row.primaryCategory||'',
    row.recipientProvince||row.收件省份||'',
    regionLabel(row),
    row.currentStore||row.当前门店||row.storeCode||'',
    row.currentProvince||row.当前省份||'',
    row.recipient||row.收件人||row.recipientName||'',
    row.recipientPhone||row.收件人手机||'',
    row.recipientAddress||row.收件地址||'',
    row.deliveryTime||row.派件时间||row.podDate||row.POD时间||'',
    row.deliveryStore||row.派件门店||row.deliveryStation||'',
    row.deliveryProvince||row.派件省份||'',
    row.courier||row.派件快递员||'',
    row.exceptionCode||row.异常编码||'',
    row.exceptionDescription||row.异常描述||row.primaryCategory||'',
    row.remark||row.备注||''
  ];
}

function emptyBuckets(rows) {
  return {
    all: rows,
    pp: [], pv: [], store: [], pod: [], notPod: [], delivery: [], pending: [], returned: [],
    pvDelivery: [], pvStoreRetention: [], pvStoreInboundNoScan: [], pvOtherUnresolved: []
  };
}

function partitionRows(rows = []) {
  const buckets = emptyBuckets(rows);
  for (const row of rows) {
    const rowRegion = region(row);
    const pod = isPod(row);
    const returned = isReturned(row);
    const cancelled = isCancelled(row);
    const delivery = !pod&&!returned&&!cancelled&&isDelivery(row);
    const store = Boolean(row.currentStore || row.当前门店 || row.storeCode);
    const pending = !pod&&!returned&&!cancelled&&pendingDays(row) > 0;

    if (rowRegion === 'PP') buckets.pp.push(row);
    else if (rowRegion === 'PV') buckets.pv.push(row);
    if (store) buckets.store.push(row);
    if (pod) buckets.pod.push(row);
    if (delivery) buckets.delivery.push(row);
    if (pending) buckets.pending.push(row);
    if (returned) buckets.returned.push(row);
    if (!pod && !returned && !cancelled && !delivery && !pending) buckets.notPod.push(row);

    const disposition = pvDisposition(row, { rowRegion, pod, returned, delivery });
    if (disposition === 'PV_DELIVERY_IN_PROGRESS') buckets.pvDelivery.push(row);
    else if (disposition === 'PV_STORE_RETENTION') buckets.pvStoreRetention.push(row);
    else if (disposition === 'PV_STORE_INBOUND_NO_SCAN') buckets.pvStoreInboundNoScan.push(row);
    else if (disposition === 'PV_OTHER_UNRESOLVED') buckets.pvOtherUnresolved.push(row);
  }
  return buckets;
}

function metricsFromBuckets(buckets) {
  const all = buckets.all.length;
  const pod = buckets.pod.length;
  const delivery = buckets.delivery.length;
  const pending = buckets.pending.length;
  const returned = buckets.returned.length;
  const notPod = buckets.notPod.length;
  return {
    all,
    pp: buckets.pp.length,
    pv: buckets.pv.length,
    store: buckets.store.length,
    pod,
    notPod,
    delivery,
    pending,
    returned,
    podRate: ratio(pod, all),
    notPodRate: ratio(notPod, all),
    deliveryRate: ratio(delivery, all),
    pendingRate: ratio(pending, all),
    returnRate: ratio(returned, all),
    avgSigningDays: averageSigningDays(buckets.pod),
    ppAvgSigningDays: averageSigningDays(buckets.pod.filter(row=>region(row)==='PP')),
    pvAvgSigningDays: averageSigningDays(buckets.pod.filter(row=>region(row)==='PV'))
  };
}

function setMergedFormula(sheet, row, column, target, display) { sheet.getCell(row, column).value = hyperlink(target, display); sheet.getCell(row, column + 1).value = hyperlink(target, display); }
function setMergedValue(sheet,row,column,value){sheet.getCell(row,column).value=value;sheet.getCell(row,column+1).value=value;}
function hyperlink(target, display) { const text = typeof display === 'string' ? `"${display.replaceAll('"', '""')}"` : Number(display || 0); return { formula: `HYPERLINK("#${target}!A1",${text})`, result: display }; }
function copyRowStyle(source, target) { target.height = source.height; source.eachCell({ includeEmpty: true }, (cell, col) => { target.getCell(col).style = { ...cell.style }; }); }
function uniqueRows(rows) { const map = new Map(); for (const row of rows) { const code = bill(row); if (code) map.set(code, row); } return [...map.values()]; }
function normalizeRows(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []; }
function bill(row = {}) { return String(row.shipmentCode || row.运单号 || row.运单编号 || '').trim().toUpperCase(); }
function region(row = {}) {
  const value = String(row.regionCode || row.regionType || row.区域分类 || '').trim().toUpperCase();
  if (!value || value === 'UNKNOWN' || value === 'UNRESOLVED') return '';
  if (value.includes('PP') || value.includes('PNH') || value.includes('PHNOM_PENH') || value.includes('金边')) return 'PP';
  if (value.includes('PV') || value.includes('PROVINCE') || value.includes('外省')) return 'PV';
  return '';
}
function regionLabel(row = {}) {
  const value = region(row);
  return value === 'PP' ? '金边' : value === 'PV' ? '外省' : '未识别';
}
function detailUrl(row = {}) {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'http://127.0.0.1:5177').replace(/\/$/, '');
  const query = new URLSearchParams();
  if (row.reportDate) query.set('reportDate', row.reportDate);
  const shipmentCode = bill(row);
  if (shipmentCode) query.set('shipmentCode', shipmentCode);
  const businessType = String(row.businessType || '').trim().toUpperCase();
  if (businessType) query.set('businessType', businessType);
  return `${base}/detail?${query.toString()}`;
}
function isPod(row = {}) {
  const status=String(row.shipmentStatus||'').trim();
  if(status==='80'||status==='81')return false;
  return status==='60'||row.truthEvidence?.pod===true||Number(row.isPod||0)===1
    ||String(row.currentState||row.scanNormalizedState||'').toUpperCase()==='POD'
    ||String(row.orderStatus||'')==='85'||row.是否POD==='是';
}
function isReturned(row = {}) {
  if(isPod(row))return false;
  const status=String(row.shipmentStatus||'').trim();
  if(status==='80')return false;
  if(status==='81'||row.truthEvidence?.returned===true)return true;
  const state=String(row.currentState||row.scanNormalizedState||'').toUpperCase();
  const text=String(row.退回状态||'').toUpperCase();
  return ['RETURNED','RETURN_COMPLETED','已退回','退回完成'].includes(state)
    ||['已退回','退回完成','RETURNED','RETURN_COMPLETED'].includes(text)
    ||row.是否退回==='是';
}
function isCancelled(row={}){
  return row.订单取消==='是'||String(row.currentState||row.scanNormalizedState||'').toUpperCase()==='ORDER_CANCELLED'
    ||String(row.primaryCategory||'')==='订单取消';
}
function isDelivery(row = {}) { return /DELIVERY|派送中|派件分配/.test(String(row.currentState || row.primaryCategory || row.状态说明 || '').toUpperCase()); }
function pvDisposition(row = {}, precomputed = {}) {
  if (row.pvOpenDisposition) return row.pvOpenDisposition;
  const queryStatus = String(row.API状态 || row.查询状态 || row.queryStatus || '').trim().toUpperCase();
  const apiFailed = queryStatus === '失败' || queryStatus === 'REFRESH_FAILED' || queryStatus === 'SCAN_FAILED' || queryStatus === 'TRACK_FAILED';
  const rowRegion = precomputed.rowRegion ?? region(row);
  const pod = precomputed.pod ?? isPod(row);
  const returned = precomputed.returned ?? isReturned(row);
  const delivery = precomputed.delivery ?? isDelivery(row);
  if (rowRegion !== 'PV' || pod || returned || apiFailed) return '';
  if (row.shopState === 'SHOP_ARRIVED_CURRENT') return Number(row.shopRetentionNaturalDays || 0) >= 2 ? 'PV_STORE_RETENTION' : 'PV_STORE_INBOUND_NO_SCAN';
  if (row.shopState === 'SHOP_TRANSFER_IN_PROGRESS' || delivery) return 'PV_DELIVERY_IN_PROGRESS';
  return 'PV_OTHER_UNRESOLVED';
}
function signingDays(row = {}) {
  const value=Number(row.signingDays??row.签收天数??row.averageSigningDays??row.平均签收天数??0);
  return Number.isFinite(value)&&value>0?value:0;
}
function averageSigningDays(rows = []) {
  const values=rows.map(signingDays).filter(value=>value>0);
  if(!values.length)return '';
  return Number((values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(2));
}
function pendingDays(row = {}) { return Number(row.pendingUniqueDayCount || row.pendingDays || row.Pending天数 || 0); }
function ratio(a, b) { return b ? a / b : 0; }
