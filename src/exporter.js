import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';
import { getRuntimeConfig } from './db.js';
import { getXlsxSheetRows, safeFinalRows } from './reporting.js';
import { buildConsistencyReport } from './consistency.js';
import { assertSnapshotHashes, buildSnapshotHashes } from './snapshotHash.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function exportXlsx(state, snapshot = null) {
  const consistency = buildConsistencyReport(state);
  if (consistency.status === 'error') {
    throw new Error(`数据一致性检查失败，已停止导出：${consistency.errors.join('；')}`);
  }
  const outDir = getRuntimeConfig().exportsDir;
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `CE_CCSL质控追踪_${state.reportDate || '日报'}_${stamp()}.xlsx`);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CE QC Standalone API';
  const logoImageId = wb.addImage({
    filename: path.resolve(__dirname, '../public/assets/ce-express-logo-main.png'),
    extension: 'png'
  });
  const rows = snapshot?.xlsxRows || getXlsxSheetRows(state);
  const legacy = buildLegacyWorkbookRows(state, rows);
  const exportHashes = buildSnapshotHashes({ dashboardRows: rows.dashboard || [], detailTabs: detailTabsForHash(rows) });
  assertSnapshotHashes(snapshot || {}, exportHashes, 'CCSL导出');

  const opts = { reportDate: state.reportDate || '', logoImageId, exportedAt: formatExportTime(new Date()) };
  addSheet(wb, '01_总看板', legacy.dashboard, { ...opts, columns: DASHBOARD_COLUMNS, dashboardLinks: true });
  addSheet(wb, '02_日报分析', legacy.dailySummary, { ...opts, columns: SUMMARY_COLUMNS, returnToDashboard: true });
  addSheet(wb, '03_周报表', legacy.historySummary, { ...opts, columns: SUMMARY_COLUMNS, returnToDashboard: true });
  addSheet(wb, '04_月报表', legacy.historySummary, { ...opts, columns: SUMMARY_COLUMNS, returnToDashboard: true });
  addSheet(wb, '05_月同比分析', legacy.historySummary, { ...opts, columns: SUMMARY_COLUMNS, returnToDashboard: true });
  addSheet(wb, '06_明日继续监控', legacy.nextCarryMonitor, { ...opts, columns: NEXT_CARRY_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_今日PNH', legacy.todayPnh, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_今日POD', legacy.todayPod, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_跨日遗留', legacy.carry, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_明日继续', legacy.nextCarry, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending全部', legacy.pendingAll, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending1+', legacy.pendingAll, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending2+', legacy.pending2plus, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending3+', legacy.pending3, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending1次', legacy.pending1, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending2次', legacy.pending2, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending3次以上', legacy.pending3, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending有图片', legacy.pendingWithImage, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending无图片', legacy.pendingWithoutImage, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending3天', legacy.pendingConsecutive3, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_Pending不连续', legacy.pendingNonContinuous, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_OC全部', legacy.ocAll, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_OC1+', legacy.ocAll, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_OC2+', legacy.oc2plus, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_OC3+', legacy.oc3, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_OC1天', legacy.oc1, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_OC2天', legacy.oc2, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_OC3天以上', legacy.oc3, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_OC2天以上', legacy.oc2plus, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_盘点1天', legacy.cycle1, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_盘点2天', legacy.cycle2, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_盘点3天以上', legacy.cycle3, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_盘点2天以上', legacy.cycle2plus, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_入库无扫描', legacy.inboundNoScan, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_工单未处理', legacy.workOrderAbnormal, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_派送停留全部', legacy.deliveryAll, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_派送停留1天', legacy.delivery1, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_派送停留2天', legacy.delivery2, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_派送停留3天以上', legacy.delivery3, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_图片异常', legacy.pictureException, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_节点未更新', legacy.nodeDateStale, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_包裹无动作', legacy.noAction, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_延迟POD', legacy.delayedPod, { ...opts, columns: DETAIL_COLUMNS, returnToDashboard: true });
  addSheet(wb, '07_全部数据明细', legacy.allData, { ...opts, columns: ALL_DATA_COLUMNS, returnToDashboard: true });
  addSheet(wb, '08_核心异常明细', legacy.coreAbnormal, { ...opts, columns: ALL_DATA_COLUMNS, returnToDashboard: true });
  addSheet(wb, '09_轨迹节点明细', legacy.trackEvents, { ...opts, columns: TRACK_EVENT_COLUMNS, returnToDashboard: true });
  addSheet(wb, '10_查询日志明细', legacy.queryLogs, { ...opts, columns: QUERY_LOG_COLUMNS, returnToDashboard: true });
  addSheet(wb, '11_单号主档案', legacy.master, { ...opts, columns: MASTER_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_门店途中', legacy.shopTransit, { ...opts, columns: SHOP_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_门店入库', legacy.shopInbound, { ...opts, columns: SHOP_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_门店滞留', legacy.shopStuck, { ...opts, columns: SHOP_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_门店未入库', legacy.shopNotInbound, { ...opts, columns: SHOP_COLUMNS, returnToDashboard: true });
  addSheet(wb, '明细_TBKH门店', legacy.tbkhShop, { ...opts, columns: SHOP_COLUMNS, returnToDashboard: true });

  const consistencyRows = buildExportConsistencyRows(state, legacy);
  const blockingRows = consistencyRows.filter(row => row.状态 === '不一致' || row.状态 === '错误');
  if (blockingRows.length) {
    throw new Error(`导出一致性检查失败：${blockingRows.slice(0, 5).map(row => row.检查项目).join('；')}`);
  }
  consistencyRows.push(
    { snapshotId: state.snapshotId || '', 检查项目: 'dashboardMetricHash', 总看板数值: snapshot?.dashboardMetricHash || exportHashes.dashboardMetricHash, 明细行数: exportHashes.dashboardMetricHash, 差异: 0, 状态: '一致', 说明: '页面快照与XLSX指标哈希一致' },
    { snapshotId: state.snapshotId || '', 检查项目: 'detailRowHash', 总看板数值: snapshot?.detailRowHash || exportHashes.detailRowHash, 明细行数: exportHashes.detailRowHash, 差异: 0, 状态: '一致', 说明: '页面快照与XLSX明细哈希一致' }
  );
  addSheet(wb, '数据一致性检查', consistencyRows, { ...opts, columns: CONSISTENCY_COLUMNS, returnToDashboard: true });

  await wb.xlsx.writeFile(file);
  return file;
}

export async function exportDailyParseXlsx(state) {
  if (!state.daily && !state.dailyParseRows?.length) throw new Error('请先导入日报Excel');

  const outDir = getRuntimeConfig().exportsDir;
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `CE_DAILY_PARSE_${state.reportDate || '日报'}_${stamp()}.xlsx`);
  const details = parseRows(state);
  const finalRows = Array.isArray(state.daily?.rows) ? state.daily.rows : details.filter(row => !isDuplicateParseRow(row));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CE QC Standalone API';

  addSheet(wb, '全部解析明细', details.map(row => normalizeParseRow(row)));
  addSheet(wb, '今日PNH', finalRows.filter(row => row?.result === 'PNH').map(row => normalizeParseRow(row)));
  addSheet(wb, '非PNH', finalRows.filter(row => row?.result === '非PNH').map(row => normalizeParseRow(row)));
  addSheet(wb, '排除', finalRows.filter(row => row?.result === '排除').map(row => normalizeParseRow(row)));
  addSheet(wb, '重复', details.filter(isDuplicateParseRow).map(row => normalizeParseRow(row, '重复')));

  await wb.xlsx.writeFile(file);
  return file;
}

const DASHBOARD_COLUMNS = ['日期', '板块', '项目', '数值', '状态', '迷你走势', '说明'];
const DASHBOARD_LINK_TARGETS = {
  今日PNH: '明细_今日PNH',
  今日POD: '明细_今日POD',
  首投POD率: '明细_今日POD',
  今日妥投率: '明细_今日POD',
  跨日遗留: '明细_跨日遗留',
  明日继续监控: '06_明日继续监控',
  Pending率: '明细_Pending全部',
  'Pending1+': '明细_Pending1+',
  'Pending2+': '明细_Pending2+',
  'Pending3+': '明细_Pending3+',
  Pending1次: '明细_Pending1次',
  Pending2次: '明细_Pending2次',
  Pending3次以上: '明细_Pending3次以上',
  Pending连续3天以上: '明细_Pending3天',
  Pending3天以上: '明细_Pending3天',
  Pending不连续: '明细_Pending不连续',
  Pending有图片: '明细_Pending有图片',
  Pending无图片: '明细_Pending无图片',
  Pending图片异常: '明细_图片异常',
  OC率: '明细_OC全部',
  'OC1+': '明细_OC1+',
  'OC2+': '明细_OC2+',
  'OC3+': '明细_OC3+',
  OC1天: '明细_OC1天',
  OC2天: '明细_OC2天',
  OC3天以上: '明细_OC3天以上',
  盘点1天: '明细_盘点1天',
  盘点2天: '明细_盘点2天',
  盘点3天以上: '明细_盘点3天以上',
  入库无扫描节点: '明细_入库无扫描',
  工单未处理: '明细_工单未处理',
  工单异常: '明细_工单未处理',
  工单未完结率: '明细_工单未处理',
  派送停留率: '明细_派送停留全部',
  派送停留1天: '明细_派送停留1天',
  派送停留2天: '明细_派送停留2天',
  派送停留3天以上: '明细_派送停留3天以上',
  图片异常: '明细_图片异常',
  节点日期未更新: '明细_节点未更新',
  节点未更新: '明细_节点未更新',
  节点未更新1天: '明细_节点未更新',
  节点未更新2天: '明细_节点未更新',
  节点未更新3天以上: '明细_节点未更新',
  包裹无动作: '明细_包裹无动作',
  延迟POD: '明细_延迟POD',
  门店途中: '明细_门店途中',
  门店途中1天: '明细_门店途中',
  门店途中2天: '明细_门店途中',
  门店途中3天以上: '明细_门店途中',
  门店入库包裹数: '明细_门店入库',
  门店入库1天: '明细_门店入库',
  门店入库2天: '明细_门店入库',
  门店入库3天以上: '明细_门店入库',
  门店滞留: '明细_门店滞留',
  门店未入库: '明细_门店未入库',
  TBKH门店包裹: '明细_TBKH门店',
  TBKH门店总数: '明细_TBKH门店',
  TBKH门店途中: '明细_TBKH门店',
  TBKH门店入库: '明细_TBKH门店',
  TBKH门店滞留1天: '明细_TBKH门店',
  TBKH门店滞留2天: '明细_TBKH门店',
  TBKH门店滞留3天以上: '明细_TBKH门店',
  TBKH门店未POD: '明细_TBKH门店'
};

const SUMMARY_COLUMNS = ['日期', '今日PNH', '今日POD', '首投POD率', '跨日遗留', '明日继续监控', 'Pending率', 'OC率', '工单未完结率', '派送停留率'];
const CONSISTENCY_COLUMNS = ['snapshotId', '检查项目', '总看板数值', '明细行数', '差异', '状态', '说明'];

const NEXT_CARRY_COLUMNS = [
  '运单号', '来源类型', '是否POD', 'Pending次数', 'OC天数', '盘点次数', '分流类型',
  '最终停留网点', '是否发往非CCSL', '重复返仓天数', '返仓日期', '最后节点时间', '最后节点', 'QC判断'
];

const DETAIL_COLUMNS = [
  '运单号', '来源类型', '扫描分类', '扫描订单状态', '是否POD', 'POD时间',
  'POD来源', '延迟POD天数',
  'Pending次数', 'Pending日期', 'Pending连续3天以上', 'Pending重复日期', '最新Pending类型', '最新Pending时间', '最新Pending有图片', '最新Pending图片状态',
  'Pending图片状态', 'Pending图片证据', 'Pending有图片次数', 'Pending无图片次数',
  '图片异常标记', '图片异常原因', '客服工单电话匹配', '图片核验排除原因',
  'OC天数', 'OC日期', '盘点次数', '盘点日期', '工单次数', '最新工单日期', '工单后次日状态', '工单后异常',
  '派件中天数', '派件中日期', '派件分配天数', '派件分配日期',
  '图片数量', '节点日期未更新', '节点未更新天数', '包裹无动作', '延迟POD',
  '门店状态', '门店动作类型', '门店编码', '门店名称', '门店发往时间', '门店入库时间', '门店滞留天数', '门店未更新天数',
  'TBKH门店包裹', 'TBKH识别来源', '最终停留网点', '最后节点时间', '最后节点',
  '最后节点动作类型', '最后节点目标网点', '命中规则', '是否门店', 'primaryCategory', 'QC判断'
];

const ALL_DATA_COLUMNS = [
  '来源类型', '运单号', '业务来源', '客户编号', '客户名称', 'Customer Group', '下单时间', '派件时间',
  '收件人', '收件人手机', '有效电话来源', '有效电话', '电话核验状态', 'Pending证据状态', '工单核验状态',
  '照片核验状态', '赔付风险等级', '工单日期', '最新工单日期', '工单次日日期', '工单后次日状态', '工单后异常',
  '客服工单类型', '客服工单电话', '客服工单地址地图', '客服工单状态', '客服工单内容',
  '收件省份编码', '收件省份', '收件地址', '派件非CCSL编号', '派件非CCSL', '派件省份',
  '派件快递员编号', '派件快递员', '快递员区域', '当前非CCSL', '当前位置', '当前省份',
  '重量(kg)', '运费($)', '代收货款($)', '扫描分类', '扫描订单状态', '扫描校验', '查询状态',
  '是否POD', 'POD时间', 'POD完成方', '是否带出', '带出快递员',
  'Pending次数', 'Pending日期', 'Pending连续性', 'Pending图片完整',
  'Pending连续3天以上', 'Pending图片状态', 'Pending图片证据', 'Pending有图片次数', 'Pending无图片次数',
  '需图片Pending次数', '需图片Pending日期', '需图片Pending图片完整',
  '无需图片Pending次数', '电话Pending天数', '电话Pending日期', '电话Pending连续性', '电话Pending图片完整',
  '电话空号次数', '更改地址次数',
  'OC次数', 'OC天数', 'OC日期', 'OC连续性', '天气原因次数', '车辆原因次数', '改期次数', '非CCSL转出Pending次数',
  '工单次数', '工单日期', '最新工单日期', '工单次日日期', '工单后次日状态', '工单后次日动作', '工单后异常',
  '工单地图链接', '工单内容摘要', '轨迹提取电话', '工单提取电话',
  '盘点次数', '重复盘点天数', '盘点日期', '盘点连续性', '盘点是否已闭环',
  '是否580', '是否CEZT', '是否门店链路', '门店状态', '门店动作类型', '门店编码', '门店名称', '门店发往时间', '门店入库时间', '门店滞留天数', 'TBKH门店包裹', 'TBKH识别来源',
  '图片数量', '图片链接',
  '是否分流', '分流类型', 'TBKH三次Pending后是否流转CECN',
  '最终停留网点', '是否发往非CCSL', '重复返仓天数', '返仓日期', '最后节点时间', '最后节点', 'QC判断', '扫描摘要'
];

const TRACK_EVENT_COLUMNS = ['shipmentCode', 'id', 'eventCode', '节点类型', 'Pending类型', 'eventTime', 'operator', 'eventCourier', 'eventShop', 'locationCode', 'trackingEventDescZh', 'remark', 'fileId', '图片链接'];
const QUERY_LOG_COLUMNS = ['查询时间', '运单号', '查询状态', '是否POD', 'Pending次数', 'OC天数', '盘点次数', '分流类型', '最后节点时间', 'QC判断', '节点数'];
const MASTER_COLUMNS = ['运单号', '归属日期', '最后检查时间', '来源类型', '业务来源', '快递员编号', '快递员', '快递员区域', '首次扫描状态', '最新扫描状态', '查询状态', '是否POD', 'POD时间', 'Pending次数', 'OC天数', '盘点次数', '是否闭环', '闭环类型', '闭环时间', '最终停留网点', '是否发往非CCSL', '重复返仓天数', '返仓日期', '最后节点时间', '最后节点', '最后QC判断', '电话核验状态', '照片核验状态', '赔付风险等级', '工单日期', '最新工单日期', '工单次日日期', '工单后次日状态', '工单后异常'];
const SHOP_COLUMNS = ['运单号', '门店编码', '门店名称', '来源类型', '扫描分类', '扫描订单状态', '是否POD', 'POD时间', '门店发往时间', '门店入库时间', '门店滞留天数', '最后节点时间', '最后节点', '最后节点动作类型', '最后节点目标网点', '命中规则', '是否门店', 'eventShop', 'deliveryShop', 'pickupShop', '最终停留网点', '门店状态', 'QC判断'];

function buildLegacyWorkbookRows(state, rows) {
  const finalRows = safeFinalRows(state);
  const dashboardData = dashboardRows(rows.dashboard);
  const finalByBill = new Map(finalRows.map(row => [billOf(row), row]));
  const scanByBill = new Map((state.scanResults || []).map(row => [billOf(row), row]));
  const rowForBill = (wb, fallback = {}) => ({ ...(scanByBill.get(wb) || {}), ...(finalByBill.get(wb) || {}), ...fallback, 运单号: wb });
  const billRows = bills => cleanBills(bills).map(wb => legacyDetailRow(rowForBill(wb)));
  const detailRows = list => (list || []).map(legacyDetailRow);
  const allData = finalRows.map(legacyAllDataRow);
  const coreAbnormal = (rows.abnormalOpen || []).map(legacyAllDataRow);

  return {
    dashboard: dashboardData,
    dailySummary: [summaryRow(state, rows)],
    historySummary: historyRows(state, rows),
    todayPnh: billRows(state.pnhBills || []),
    todayPod: detailRows(rows.podClosed),
    carry: billRows(state.carryBills || []),
    nextCarryMonitor: (rows.nextCarry || []).map(legacyNextCarryRow),
    nextCarry: detailRows(rows.nextCarry),
    pendingAll: detailRows(rows.pendingAll),
    pending1: detailRows(rows.pending1),
    pending2: detailRows(rows.pending2),
    pending2plus: detailRows(rows.pending2plus || [...(rows.pending2 || []), ...(rows.pending3 || [])]),
    pending3: detailRows(rows.pending3),
    pendingConsecutive3: detailRows(rows.pendingConsecutive3),
    pendingNonContinuous: detailRows(rows.pendingNonContinuous),
    pendingWithImage: detailRows(rows.pendingWithImage),
    pendingWithoutImage: detailRows(rows.pendingWithoutImage),
    ocAll: detailRows(rows.ocAll),
    oc1: detailRows(rows.oc1),
    oc2: detailRows(rows.oc2),
    oc3: detailRows(rows.oc3),
    oc2plus: detailRows([...(rows.oc2 || []), ...(rows.oc3 || [])]),
    cycle1: detailRows(rows.cycle1),
    cycle2: detailRows(rows.cycle2),
    cycle3: detailRows(rows.cycle3),
    cycle2plus: detailRows([...(rows.cycle2 || []), ...(rows.cycle3 || [])]),
    inboundNoScan: detailRows(rows.inboundNoScan),
    workOrderAbnormal: finalRows.filter(row => row?.异常分类 === '需人工复核').map(legacyDetailRow),
    deliveryAll: detailRows(rows.deliveryAll),
    delivery1: detailRows(rows.delivery1),
    delivery2: detailRows(rows.delivery2),
    delivery3: detailRows(rows.delivery3),
    pictureException: detailRows(rows.pictureException),
    nodeDateStale: detailRows(rows.nodeDateStale),
    noAction: detailRows(rows.noAction),
    delayedPod: detailRows(rows.delayedPod),
    shopTransit: (rows.shopTransit || []).map(legacyShopRow),
    shopInbound: (rows.shopInbound || []).map(legacyShopRow),
    shopStuck: (rows.shopStuck || []).map(legacyShopRow),
    shopNotInbound: (rows.shopNotInbound || []).map(legacyShopRow),
    tbkhShop: (rows.tbkhShop || []).map(legacyShopRow),
    allData,
    coreAbnormal,
    trackEvents: (rows.trackEvents || []).map(legacyTrackEventRow),
    queryLogs: buildQueryLogs(state),
    master: buildMasterRows(state, finalRows)
  };
}

function detailTabsForHash(rows = {}) {
  return Object.fromEntries(Object.entries(rows)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, { rows: value }]));
}

function dashboardRows(rows = []) {
  return rows.map(row => ({
    日期: row.日期 || '',
    板块: row.模块 || row.板块 || '',
    项目: row.指标 || row.项目 || '',
    数值: row.数值 ?? '',
    状态: row.状态 || '',
    迷你走势: row.迷你走势 || '',
    迷你走势数据: row.迷你走势数据 || [],
    说明: row.说明 || ''
  }));
}

function summaryRow(state, rows) {
  const dashboard = Object.fromEntries(dashboardRows(rows.dashboard).map(row => [row.项目, row.数值]));
  return {
    日期: state.reportDate || '',
    今日PNH: dashboard.今日PNH || 0,
    今日POD: dashboard.今日POD || 0,
    首投POD率: dashboard.首投POD率 || dashboard.今日妥投率 || '0%',
    跨日遗留: dashboard.跨日遗留 || 0,
    明日继续监控: dashboard.明日继续监控 || 0,
    Pending率: dashboard.Pending率 || '0%',
    OC率: dashboard.OC率 || '0%',
    工单未完结率: dashboard.工单未完结率 || '0%',
    派送停留率: dashboard.派送停留率 || '0%'
  };
}

function historyRows(state, rows) {
  const history = Array.isArray(state.historySummary) ? state.historySummary : [];
  if (!history.length) return [summaryRow(state, rows)];
  return history.slice(-30).map(item => ({
    日期: item.reportDate || item.summary?.reportDate || '',
    今日PNH: item.summary?.today || item.summary?.pnh || '',
    今日POD: item.summary?.scanPod || item.summary?.todayPod || '',
    首投POD率: item.summary?.podRateText || '',
    跨日遗留: item.summary?.carry || '',
    明日继续监控: item.summary?.nextCarry || '',
    Pending率: item.summary?.pendingRateText || '',
    OC率: item.summary?.ocRateText || '',
    工单未完结率: item.summary?.openRateText || '',
    派送停留率: item.summary?.deliveryRateText || ''
  }));
}

function legacyDetailRow(row = {}) {
  return fillColumns({
    运单号: billOf(row),
    来源类型: row.来源类型 || '',
    扫描分类: row.扫描分类 || '',
    扫描订单状态: row.orderStatus || '',
    是否POD: row.是否POD || '',
    POD时间: row.POD时间 || row.最后节点时间 || '',
    POD来源: row.POD来源 || '',
    延迟POD天数: row.延迟POD天数 || '',
    Pending次数: row.Pending次数 || row.Pending天数 || 0,
    Pending日期: row.Pending日期 || '',
    Pending连续3天以上: row.Pending连续3天以上 || '',
    Pending重复日期: row.Pending重复日期 || '',
    最新Pending类型: row.最新Pending类型 || '',
    最新Pending时间: row.最新Pending时间 || '',
    最新Pending有图片: row.最新Pending有图片 || '',
    最新Pending图片状态: row.最新Pending图片状态 || '',
    Pending图片状态: row.Pending图片状态 || '',
    Pending图片证据: row.Pending图片证据 || '',
    Pending有图片次数: row.Pending有图片次数 || '',
    Pending无图片次数: row.Pending无图片次数 || '',
    图片异常标记: row.图片异常标记 || '',
    图片异常原因: row.图片异常原因 || '',
    客服工单电话匹配: row.客服工单电话匹配 || '',
    图片核验排除原因: row.图片核验排除原因 || '',
    OC天数: row.OC天数 || 0,
    OC日期: row.OC日期 || '',
    盘点次数: row.盘点次数 || row.盘点天数 || 0,
    盘点日期: row.盘点日期 || '',
    工单次数: row.工单次数 || '',
    最新工单日期: row.最新工单日期 || '',
    工单后次日状态: row.工单后次日状态 || '',
    工单后异常: row.工单后异常 || '',
    派件中天数: row.派送中天数 || 0,
    派件中日期: row.派件中日期 || '',
    派件分配天数: row.派件分配天数 || 0,
    派件分配日期: row.派件分配日期 || '',
    图片数量: row.图片数量 || '',
    节点日期未更新: row.节点日期未更新 || '',
    节点未更新天数: row.节点未更新天数 || '',
    包裹无动作: row.包裹无动作 || '',
    延迟POD: row.延迟POD || '',
    门店状态: row.门店状态 || '',
    门店动作类型: row.门店动作类型 || '',
    门店编码: row.门店编码 || row.currentShopCode || row.targetShopCode || '',
    门店名称: row.门店名称 || row.shopName || '',
    门店发往时间: row.门店发往时间 || row.shopTransferStartedAt || '',
    门店入库时间: row.门店入库时间 || row.shopArrivedAt || '',
    门店滞留天数: row.门店滞留天数 || row.shopRetentionNaturalDays || '',
    门店未更新天数: row.门店未更新天数 || '',
    TBKH门店包裹: row.TBKH门店包裹 || '',
    TBKH识别来源: row.TBKH识别来源 || '',
    最终停留网点: row.deliveryShop || row.place || '',
    最后节点时间: row.最后节点时间 || '',
    最后节点: row.最后节点 || '',
    最后节点动作类型: row.最后节点动作类型 || row.lastEventActionType || '',
    最后节点目标网点: row.最后节点目标网点 || row.lastEventTargetNode || '',
    命中规则: row.命中规则 || row.matchedRule || '',
    是否门店: row.是否门店 || (row.是否门店链路 === '是' ? '是' : '否'),
    primaryCategory: row.primaryCategory || row.异常分类 || '',
    QC判断: row.QC判断 || ''
  }, DETAIL_COLUMNS);
}

function legacyNextCarryRow(row = {}) {
  return fillColumns({
    运单号: billOf(row),
    来源类型: row.来源类型 || '明日继续',
    是否POD: row.是否POD || '',
    Pending次数: row.Pending次数 || row.Pending天数 || 0,
    OC天数: row.OC天数 || 0,
    盘点次数: row.盘点次数 || row.盘点天数 || 0,
    分流类型: row.异常分类 || row.分流类型 || '',
    最终停留网点: row.deliveryShop || row.place || row.最终停留网点 || '',
    是否发往非CCSL: row.是否发往非CCSL || '',
    重复返仓天数: row.重复返仓天数 || '',
    返仓日期: row.返仓日期 || '',
    最后节点时间: row.最后节点时间 || '',
    最后节点: row.最后节点 || '',
    QC判断: row.QC判断 || ''
  }, NEXT_CARRY_COLUMNS);
}

function legacyShopRow(row = {}) {
  return fillColumns({
    运单号: billOf(row),
    门店编码: row.门店编码 || '',
    门店名称: row.门店名称 || '',
    来源类型: row.来源类型 || '',
    扫描分类: row.扫描分类 || '',
    扫描订单状态: row.orderStatus || row.扫描订单状态 || '',
    是否POD: row.是否POD || '',
    POD时间: row.POD时间 || '',
    门店发往时间: row.门店发往时间 || '',
    门店入库时间: row.门店入库时间 || '',
    门店滞留天数: row.门店滞留天数 || '',
    最后节点时间: row.最后节点时间 || '',
    最后节点: row.最后节点 || '',
    最后节点动作类型: row.最后节点动作类型 || row.lastEventActionType || '',
    最后节点目标网点: row.最后节点目标网点 || row.lastEventTargetNode || '',
    命中规则: row.命中规则 || row.matchedRule || '',
    是否门店: row.是否门店 || (row.是否门店链路 === '是' ? '是' : '否'),
    eventShop: row.eventShop || '',
    deliveryShop: row.deliveryShop || '',
    pickupShop: row.pickupShop || '',
    最终停留网点: row.最终停留网点 || row.deliveryShop || row.place || '',
    门店状态: row.门店状态 || row.shopState || row.异常分类 || '',
    QC判断: row.QC判断 || ''
  }, SHOP_COLUMNS);
}

function legacyAllDataRow(row = {}) {
  return fillColumns({
    来源类型: row.来源类型 || '',
    运单号: billOf(row),
    业务来源: row.业务来源 || '',
    客户编号: row.customerCode || row.客户编号 || '',
    客户名称: row.customerName || '',
    'Customer Group': row.customerGroup || row['Customer Group'] || '',
    下单时间: row.orderTime || row.下单时间 || '',
    派件时间: row.deliveryTime || row.派件时间 || '',
    收件人: row.receiver || row.收件人 || '',
    收件人手机: row.receiverPhone || row.收件人手机 || '',
    有效电话来源: row.有效电话来源 || '',
    有效电话: row.有效电话 || '',
    电话核验状态: row.电话核验状态 || '',
    Pending证据状态: row.Pending证据状态 || '',
    工单核验状态: row.工单核验状态 || '',
    照片核验状态: row.照片核验状态 || '',
    赔付风险等级: row.赔付风险等级 || '',
    工单日期: row.工单日期 || '',
    最新工单日期: row.最新工单日期 || '',
    工单次日日期: row.工单次日日期 || '',
    工单后次日状态: row.工单后次日状态 || '',
    工单后异常: row.工单后异常 || '',
    客服工单类型: row.客服工单类型 || '',
    客服工单电话: row.客服工单电话 || '',
    客服工单地址地图: row.客服工单地址地图 || '',
    客服工单状态: row.客服工单状态 || '',
    客服工单内容: row.客服工单内容 || '',
    收件省份编码: row.收件省份编码 || '',
    收件省份: row.收件省份 || '',
    收件地址: row.收件地址 || '',
    派件非CCSL编号: row.派件非CCSL编号 || '',
    派件非CCSL: row.派件非CCSL || '',
    派件省份: row.派件省份 || '',
    派件快递员编号: row.派件快递员编号 || row.courierCode || '',
    派件快递员: row.快递员 || row.eventCourier || '',
    快递员区域: row.快递员区域 || '',
    当前非CCSL: row.当前非CCSL || '',
    当前位置: row.当前位置 || row.place || '',
    当前省份: row.当前省份 || '',
    '重量(kg)': row.weight || row['重量(kg)'] || '',
    '运费($)': row.freight || row['运费($)'] || '',
    '代收货款($)': row.cod || row['代收货款($)'] || '',
    扫描分类: row.扫描分类 || '',
    扫描订单状态: row.orderStatus || '',
    扫描校验: row.扫描校验 || '',
    查询状态: row.轨迹节点数 ? '已查询' : '',
    是否POD: row.是否POD || '',
    POD时间: row.POD时间 || row.最后节点时间 || '',
    POD完成方: row.POD完成方 || '',
    是否带出: row.是否带出 || '',
    带出快递员: row.带出快递员 || '',
    Pending次数: row.Pending次数 || row.Pending天数 || 0,
    Pending日期: row.Pending日期 || '',
    Pending连续性: row.Pending连续性 || '',
    Pending图片完整: row.Pending图片完整 || '',
    需图片Pending次数: row.需图片Pending次数 || '',
    需图片Pending日期: row.需图片Pending日期 || '',
    需图片Pending图片完整: row.需图片Pending图片完整 || '',
    无需图片Pending次数: row.无需图片Pending次数 || '',
    电话Pending天数: row.电话Pending天数 || '',
    电话Pending日期: row.电话Pending日期 || '',
    电话Pending连续性: row.电话Pending连续性 || '',
    电话Pending图片完整: row.电话Pending图片完整 || '',
    电话空号次数: row.电话空号次数 || '',
    更改地址次数: row.更改地址次数 || '',
    OC次数: row.OC次数 || row.OC天数 || 0,
    OC天数: row.OC天数 || 0,
    OC日期: row.OC日期 || '',
    OC连续性: row.OC连续性 || '',
    天气原因次数: row.天气原因次数 || '',
    车辆原因次数: row.车辆原因次数 || '',
    改期次数: row.改期次数 || '',
    非CCSL转出Pending次数: row.非CCSL转出Pending次数 || '',
    工单次数: row.工单次数 || '',
    工单后次日动作: row.工单后次日动作 || '',
    工单地图链接: row.工单地图链接 || '',
    工单内容摘要: row.工单内容摘要 || row.客服工单内容 || '',
    轨迹提取电话: row.轨迹提取电话 || '',
    工单提取电话: row.工单提取电话 || '',
    盘点次数: row.盘点次数 || row.盘点天数 || 0,
    重复盘点天数: row.重复盘点天数 || row.盘点天数 || row.盘点次数 || 0,
    盘点日期: row.盘点日期 || '',
    盘点连续性: row.盘点连续性 || '',
    盘点是否已闭环: row.盘点是否已闭环 || '',
    是否580: row.是否580 || '',
    是否CEZT: row.是否CEZT || '',
    是否门店链路: row.是否门店链路 || (row.门店编码 ? '是' : ''),
    图片数量: row.图片数量 || '',
    图片链接: row.图片链接 || row.fileUrl || '',
    是否分流: ['正常分流节点', '最终分流排除'].includes(row.异常分类) ? '是' : (row.是否分流 || ''),
    分流类型: row.异常分类 || row.分流类型 || '',
    TBKH三次Pending后是否流转CECN: row.TBKH三次Pending后是否流转CECN || '',
    最终停留网点: row.deliveryShop || row.place || row.最终停留网点 || '',
    是否发往非CCSL: row.是否发往非CCSL || '',
    重复返仓天数: row.重复返仓天数 || '',
    返仓日期: row.返仓日期 || '',
    最后节点时间: row.最后节点时间 || '',
    最后节点: row.最后节点 || '',
    QC判断: row.QC判断 || '',
    扫描摘要: row.扫描摘要 || row.QC判断 || '',
    ...legacyDetailRow(row)
  }, ALL_DATA_COLUMNS);
}

function legacyTrackEventRow(row = {}) {
  return fillColumns({
    shipmentCode: row.shipmentCode || row.运单号 || '',
    id: row.id || '',
    eventCode: row.eventCode || '',
    节点类型: row.trackingEventCode || '',
    Pending类型: /pending/i.test(`${row.trackingEventDescZh || ''} ${row.trackingEventDesc || ''}`) ? 'Pending' : '',
    eventTime: row.eventTime || '',
    operator: row.operator || '',
    eventCourier: row.eventCourier || '',
    eventShop: row.place || '',
    locationCode: row.locationCode || '',
    trackingEventDescZh: row.trackingEventDescZh || row.trackingEventDesc || '',
    remark: row.remark || '',
    fileId: row.fileId || '',
    图片链接: row.fileUrl || row.图片链接 || ''
  }, TRACK_EVENT_COLUMNS);
}

function buildQueryLogs(state) {
  const finalByBill = new Map(safeFinalRows(state).map(row => [billOf(row), row]));
  return (state.scanPool || state.pnhBills || []).map(wb => {
    const row = finalByBill.get(wb) || {};
    return fillColumns({
      查询时间: state.lastRunSummary?.completedAt || '',
      运单号: wb,
      查询状态: row.轨迹节点数 ? '已查询' : '',
      是否POD: row.是否POD || '',
      Pending次数: row.Pending次数 || row.Pending天数 || 0,
      OC天数: row.OC天数 || 0,
      盘点次数: row.盘点次数 || row.盘点天数 || 0,
      分流类型: row.异常分类 || '',
      最后节点时间: row.最后节点时间 || '',
      QC判断: row.QC判断 || '',
      节点数: row.轨迹节点数 || 0
    }, QUERY_LOG_COLUMNS);
  });
}

function buildMasterRows(state, finalRows) {
  const bills = cleanBills([
    ...(state.pnhBills || []),
    ...(state.carryBills || []),
    ...(state.nextCarryBills || []),
    ...(state.podLocks || []),
    ...(state.scanResults || []).map(billOf),
    ...(finalRows || []).map(billOf)
  ]);
  const finalByBill = new Map((finalRows || []).map(row => [billOf(row), row]));
  return bills.map(wb => {
    const row = finalByBill.get(wb) || { 运单号: wb };
    return fillColumns({
      运单号: wb,
      归属日期: state.reportDate || '',
      最后检查时间: state.lastRunSummary?.completedAt || '',
      来源类型: row.来源类型 || '',
      快递员: row.快递员 || row.eventCourier || '',
      最新扫描状态: row.扫描分类 || '',
      查询状态: row.轨迹节点数 ? '已查询' : '',
      是否POD: row.是否POD || '',
      POD时间: row.POD时间 || row.最后节点时间 || '',
      Pending次数: row.Pending次数 || row.Pending天数 || 0,
      OC天数: row.OC天数 || 0,
      盘点次数: row.盘点次数 || row.盘点天数 || 0,
      是否闭环: row.是否POD === '是' ? '是' : '否',
      闭环类型: row.是否POD === '是' ? 'POD闭环' : '',
      闭环时间: row.是否POD === '是' ? (row.POD时间 || row.最后节点时间 || '') : '',
      最终停留网点: row.deliveryShop || '',
      最后节点时间: row.最后节点时间 || '',
      最后节点: row.最后节点 || '',
      最后QC判断: row.QC判断 || ''
    }, MASTER_COLUMNS);
  });
}

function buildExportConsistencyRows(state, legacy) {
  const dashboard = new Map((legacy.dashboard || []).map(row => [row.项目, row.数值]));
  const checks = [
    ['今日PNH', 'todayPnh', '明细_今日PNH'],
    ['今日POD', 'todayPod', '明细_今日POD'],
    ['跨日遗留', 'carry', '明细_跨日遗留'],
    ['明日继续监控', 'nextCarryMonitor', '06_明日继续监控'],
    ['Pending1+', 'pendingAll', '明细_Pending1+'],
    ['Pending2+', 'pending2plus', '明细_Pending2+'],
    ['Pending3+', 'pending3', '明细_Pending3+'],
    ['Pending有图片', 'pendingWithImage', '明细_Pending有图片'],
    ['Pending无图片', 'pendingWithoutImage', '明细_Pending无图片'],
    ['Pending不连续', 'pendingNonContinuous', '明细_Pending不连续'],
    ['OC1+', 'ocAll', '明细_OC1+'],
    ['OC2+', 'oc2plus', '明细_OC2+'],
    ['OC3+', 'oc3', '明细_OC3+'],
    ['盘点1天', 'cycle1', '明细_盘点1天'],
    ['盘点2天', 'cycle2', '明细_盘点2天'],
    ['盘点3天以上', 'cycle3', '明细_盘点3天以上'],
    ['派送停留1天', 'delivery1', '明细_派送停留1天'],
    ['派送停留2天', 'delivery2', '明细_派送停留2天'],
    ['派送停留3天以上', 'delivery3', '明细_派送停留3天以上'],
    ['入库无扫描节点', 'inboundNoScan', '明细_入库无扫描'],
    ['工单未处理', 'workOrderAbnormal', '明细_工单未处理'],
    ['Pending图片异常', 'pictureException', '明细_图片异常'],
    ['节点未更新', 'nodeDateStale', '明细_节点未更新'],
    ['包裹无动作', 'noAction', '明细_包裹无动作'],
    ['延迟POD', 'delayedPod', '明细_延迟POD'],
    ['门店途中', 'shopTransit', '明细_门店途中'],
    ['门店入库包裹数', 'shopInbound', '明细_门店入库'],
    ['门店滞留', 'shopStuck', '明细_门店滞留'],
    ['门店未入库', 'shopNotInbound', '明细_门店未入库'],
    ['TBKH门店总数', 'tbkhShop', '明细_TBKH门店']
  ];
  const rows = checks.map(([item, key, sheet]) => {
    const dashboardValue = parseMetricNumber(dashboard.get(item));
    const detailValue = Array.isArray(legacy[key]) ? legacy[key].length : 0;
    const matched = dashboardValue === detailValue;
    return {
      snapshotId: state.snapshotId || '',
      检查项目: `${item} = ${sheet}`,
      总看板数值: dashboard.get(item) ?? '',
      明细行数: detailValue,
      差异: dashboardValue - detailValue,
      状态: matched ? '一致' : '不一致',
      说明: matched ? '总看板数值与目标明细数量一致' : '总看板数值与目标明细数量不一致，请核对明细'
    };
  });

  const report = buildConsistencyReport(state);
  for (const error of report.errors || []) {
    rows.push({ snapshotId: state.snapshotId || '', 检查项目: '系统一致性', 总看板数值: '', 明细行数: '', 差异: '', 状态: '错误', 说明: error });
  }
  for (const warning of report.warnings || []) {
    rows.push({ snapshotId: state.snapshotId || '', 检查项目: '系统一致性', 总看板数值: '', 明细行数: '', 差异: '', 状态: '警告', 说明: warning });
  }
  for (const info of report.info || []) {
    rows.push({ snapshotId: state.snapshotId || '', 检查项目: '系统一致性', 总看板数值: '', 明细行数: '', 差异: '', 状态: '仅记录', 说明: info });
  }
  return rows;
}

function parseMetricNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return 0;
  const match = text.match(/^-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function fillColumns(source, columns) {
  return Object.fromEntries(columns.map(key => [key, source[key] ?? '']));
}

function billOf(row) {
  return String(row?.运单号 || row?.shipmentCode || row?.waybill || row?.billNo || row || '').trim().toUpperCase();
}

function cleanBills(list) {
  return [...new Set((list || []).map(billOf).filter(Boolean))];
}

function parseRows(state) {
  return Array.isArray(state.dailyParseRows) && state.dailyParseRows.length
    ? state.dailyParseRows
    : (Array.isArray(state.daily?.details) ? state.daily.details : []);
}

function addSheet(wb, name, rows, options = {}) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  const input = Array.isArray(rows) ? rows : [];
  const inferredKeys = [...new Set(input.flatMap(r => Object.keys(r || {})))].filter(key => key !== '迷你走势数据');
  const keys = options.columns?.length ? options.columns : (inferredKeys.length ? inferredKeys : ['说明']);
  const list = input.length ? input : [{ 说明: '无数据' }];
  ws.columns = keys.map(k => ({ width: k === '迷你走势' ? 44 : columnWidth(k, list) }));
  const headerRowNumber = 3;
  addSheetTitle(wb, ws, name, keys.length, options);
  ws.addRow(keys);
  for (const r of list) {
    const row = ws.addRow(keys.map(key => r?.[key] ?? ''));
    row.height = 24;
    keys.forEach((key, index) => {
      const cell = row.getCell(index + 1);
      cell.font = { name: 'Microsoft YaHei', size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: false };
      if (isBillColumn(key)) {
        const text = String(cell.value || '');
        cell.value = text;
        if (text) {
          cell.value = { text, hyperlink: detailUrl(options.reportDate || r?.reportDate || '', text) };
          cell.font = { color: { argb: 'FF0563C1' }, underline: true };
        }
        cell.numFmt = '@';
      }
      if (isStatusColumn(key)) styleStatusCell(cell);
      if (key === '迷你走势') {
        const trendData = Array.isArray(r?.迷你走势数据) ? r.迷你走势数据.slice(0, 7) : [];
        cell.value = {
          richText: trendData.map((item, trendIndex) => ({
            text: `${String(item?.date || '').slice(5)} ${formatDashboardTrendValue(item, r)}  `,
            font: {
              name: 'Microsoft YaHei',
              color: { argb: trendColorForItem(item, r?.状态) },
              bold: true,
              size: 9
            }
          }))
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false, shrinkToFit: true };
      }
      if (key === '数值') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
        cell.font = { name: 'Microsoft YaHei', color: { argb: 'FF075295' }, bold: true, underline: cell.font?.underline };
      }
      if (options.dashboardLinks && (key === '数值' || key === '项目')) {
        const item = r?.项目 || r?.指标 || '';
        const target = DASHBOARD_LINK_TARGETS[item];
        const text = String(cell.value ?? '');
        if (target && text) {
          cell.value = hyperlinkFormula(`#'${target}'!A1`, text);
          cell.font = { name: 'Microsoft YaHei', color: { argb: 'FF0563C1' }, underline: true, bold: true };
        }
      }
    });
  }
  ws.eachRow(row => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9E5F2' } },
        left: { style: 'thin', color: { argb: 'FFD9E5F2' } },
        bottom: { style: 'thin', color: { argb: 'FFD9E5F2' } },
        right: { style: 'thin', color: { argb: 'FFD9E5F2' } }
      };
    });
  });
  ws.getRow(headerRowNumber).font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(headerRowNumber).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  ws.getRow(headerRowNumber).height = 30;
  ws.autoFilter = { from: `A${headerRowNumber}`, to: `${colName(keys.length)}${Math.max(headerRowNumber, ws.rowCount)}` };
  ws.views = [{ state: 'frozen', ySplit: headerRowNumber }];
  return ws;
}

function addSheetTitle(wb, ws, name, keyCount, options = {}) {
  ws.addRow([]);
  ws.addRow([]);
  const maxColumn = Math.max(7, keyCount);
  if (options.logoImageId !== undefined && options.logoImageId !== null) {
    ws.addImage(options.logoImageId, { tl: { col: 0.05, row: 0.05 }, ext: { width: 92, height: 56 } });
  }
  ws.mergeCells(1, 3, 1, maxColumn);
  const title = ws.getCell(1, 3);
  title.value = `CE Express CCSL 质控数据监控 - ${name}`;
  title.font = { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: 'FF102C4C' } };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 34;
  ws.getRow(2).height = 22;

  ws.getCell(2, 3).value = `日报日期：${options.reportDate || '-'}`;
  ws.getCell(2, 3).font = { name: 'Microsoft YaHei', size: 9, color: { argb: 'FF536A80' } };
  ws.getCell(2, 5).value = `导出时间：${options.exportedAt || ''}`;
  ws.getCell(2, 5).font = { name: 'Microsoft YaHei', size: 9, color: { argb: 'FF536A80' } };
  if (options.returnToDashboard) {
    const cell = ws.getCell(2, maxColumn);
    cell.value = hyperlinkFormula("#'01_总看板'!A1", '返回总看板 ↑');
    cell.font = { name: 'Microsoft YaHei', color: { argb: 'FF0563C1' }, underline: true, bold: true };
    cell.alignment = { horizontal: 'right' };
  }
}

function hyperlinkFormula(target, label) {
  return {
    formula: `HYPERLINK("${escapeFormulaString(target)}","${escapeFormulaString(label)}")`,
    result: String(label ?? '')
  };
}

function trendColorForItem(item, fallbackStatus = '') {
  if (!item || item.hasData === false || item.status === 'missing') return 'FFB8C4D0';
  if (item.status === 'volume') return 'FF2878BD';
  if (item.status === 'normal') return 'FF15945F';
  if (item.status === 'warning') return 'FFE68613';
  if (item.status === 'danger') return 'FFD52940';
  return trendColorForStatus(fallbackStatus);
}

function formatDashboardTrendValue(item, row = {}) {
  if (!item?.hasData) return '—';
  const value = Number(item.value || 0);
  return /率/.test(String(row?.项目 || row?.指标 || '')) ? `${Number(value.toFixed(2))}%` : `${Math.round(value)}`;
}

function formatExportTime(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`;
}

function escapeFormulaString(value) {
  return String(value ?? '').replaceAll('"', '""');
}

function detailUrl(reportDate, shipmentCode) {
  const cfg = getRuntimeConfig();
  const base = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${cfg.port}`;
  const url = new URL('/detail', base);
  if (reportDate) url.searchParams.set('reportDate', reportDate);
  url.searchParams.set('shipmentCode', shipmentCode);
  return url.toString();
}

function normalizeParseRow(row, resultOverride = '') {
  return {
    sheetName: row?.sheetName || '',
    rowNumber: row?.rowNumber || '',
    shipmentCode: row?.shipmentCode || row?.waybill || '',
    result: resultOverride || (isDuplicateParseRow(row) ? '重复' : (row?.result || '')),
    reason: row?.reason || '',
    rawText: row?.rawText || row?.原始行摘要 || ''
  };
}

function isDuplicateParseRow(row) {
  return Boolean(row?.duplicate) || /重复单号/.test(String(row?.reason || '')) || row?.result === '重复';
}

function isBillColumn(key) {
  return /运单号|shipmentCode|waybill|bill/i.test(String(key || ''));
}

function isStatusColumn(key) {
  return /状态|是否POD|QC判断|异常分类|门店状态/.test(String(key || ''));
}

function styleStatusCell(cell) {
  const text = String(cell.value?.result ?? cell.value?.text ?? cell.value ?? '');
  if (!text) return;
  let color = 'FFE8F2FF';
  if (/正常|已登录|有效|POD闭环|门店入库|是/.test(text)) color = 'FFE9F8F0';
  if (/关注|跟进|未入库|门店途中|门店滞留|Pending|OC|盘点|停留|未POD|未更新/.test(text)) color = 'FFFFF4DE';
  if (/异常|错误|失败|无扫描|无返回|无动作/.test(text)) color = 'FFFEE7E7';
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function trendColorForStatus(status = '') {
  const s = String(status || '');
  if (/重点|异常|错误|失败/.test(s)) return 'FFD52940';
  if (/关注|跟进/.test(s)) return 'FFE68613';
  if (/正常|一致/.test(s)) return 'FF15945F';
  return 'FF2878BD';
}

function columnWidth(key, rows) {
  const field = String(key || '');
  if (isBillColumn(field)) return 20;
  if (/来源类型|业务来源/.test(field)) return 14;
  if (/扫描分类|异常分类|primaryCategory|主分类|门店状态/.test(field)) return 20;
  if (/是否POD|是否门店|延迟POD|包裹无动作/.test(field)) return 10;
  if (/时间|日期|Date|Time/.test(field)) return 21;
  if (/次数|天数|数量|率$|数值/.test(field)) return 11;
  if (/迷你走势/.test(field)) return 16;
  if (/最后节点$|节点摘要|目标网点/.test(field)) return 34;
  if (/QC判断|原因|说明|证据|命中规则|图片链接/.test(field)) return 36;
  if (/raw|Json|原始轨迹/i.test(field)) return 40;
  const max = Math.max(String(key).length, ...rows.slice(0, 200).map(row => String(row?.[key] ?? '').length));
  return Math.max(10, Math.min(24, max + 3));
}

function colName(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
