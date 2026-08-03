import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const target = path.resolve(process.argv[2] || path.join(projectRoot, 'data', 'codex_ccsl_shopee_176', 'browser_data'));
if (!target.startsWith(projectRoot)) throw new Error('UI fixture must stay inside the project workspace.');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
process.env.DATA_DIR = target;
process.env.DB_FILE = path.join(target, 'ce_qc_monitor.db');
process.env.EXPORTS_DIR = path.join(target, 'exports');
fs.closeSync(fs.openSync(process.env.DB_FILE, 'w'));

const { saveState } = await import('../src/storage.js');
const { createOrRecoverRun } = await import('../src/store.js');
const { createDashboardSnapshot } = await import('../src/snapshots.js');
const { SHOPEE, createOrRecoverBusinessRun, saveBusinessSnapshot, saveBusinessState } = await import('../src/businessStore.js');
const { buildShopeeDashboard } = await import('../src/shopeeReporting.js');
const { exportXlsx } = await import('../src/exporter.js');
const { exportShopeeXlsx } = await import('../src/shopeeExporter.js');
const { getDb, getRuntimeConfig } = await import('../src/db.js');

const reportDate = '2026-07-20';
const ccslBills = bills('CCL', 84);
const shopeeBills = bills('SPX', 64);

const ccslRows = ccslBills.map((bill, index) => ccslRow(bill, index));
const ccslPodBills = ccslRows.filter(row => row.是否POD === '是').map(row => row.运单号);
const ccslCarry = ccslRows.filter(row => row.是否POD !== '是' && row.异常分类 !== '正常分流节点').slice(0, 11).map(row => row.运单号);
let ccslState = {
  reportDate,
  sourceName: 'CCSL_日报_2026-07-20.xlsx',
  daily: { summary: { pnh: ccslBills.length, nonPnh: 12, excluded: 4, duplicates: 3, totalRecognized: ccslBills.length + 16 }, preview: [] },
  dailyParseSummary: { pnh: ccslBills.length, nonPnh: 12, excluded: 4, duplicates: 3, totalRecognized: ccslBills.length + 16, totalAppearances: ccslBills.length + 19 },
  dailyParseRows: ccslBills.map((shipmentCode, index) => ({ sheetName: '金边日报', rowNumber: index + 2, shipmentCode, result: 'PNH', reason: '行内识别PNH', rawText: `${shipmentCode} Phnom Penh` })),
  pnhBills: ccslBills,
  nonPnhBills: bills('CCN', 12),
  excludedBills: ['SPE000001', 'WHPP000001', 'SPE000002', 'WHPP000002'],
  duplicateBills: ccslBills.slice(0, 3),
  carryBills: ccslCarry.slice(0, 8),
  podLocks: ccslPodBills,
  scanPool: ccslBills,
  scanResults: ccslRows.map(row => ({ shipmentCode: row.运单号, 运单号: row.运单号, orderStatus: row.是否POD === '是' ? 85 : 20, 是否POD: row.是否POD })),
  needTrackBills: ccslRows.filter(row => row.是否POD !== '是').map(row => row.运单号),
  trackResults: ccslRows,
  trackEvents: ccslRows.map((row, index) => ({ shipmentCode: row.运单号, eventCode: row.异常分类, trackingEventDescZh: row.最后节点, eventTime: `2026-07-${String(18 + (index % 3)).padStart(2, '0')} ${String(8 + (index % 9)).padStart(2, '0')}:20:00`, place: 'Phnom Penh' })),
  finalRows: ccslRows,
  nextCarryBills: ccslCarry,
  finalDiversionRows: ccslRows.filter(row => row.异常分类 === '正常分流节点'),
  historySummary: ccslHistory(),
  processing: { running: false, paused: false, phase: '完成', batchIndex: 2, totalBatches: 2 },
  logs: [
    '[09:05:12] CCSL日报导入完成：PNH 84票',
    '[09:05:18] 订单扫描完成：2批次',
    '[09:05:24] 轨迹查询完成：批量上限50票',
    '[09:05:29] 处理快照生成完成'
  ]
};
await saveState(ccslState);
const ccslRun = createOrRecoverRun(reportDate, { lockedBy: 'locked-ui-fixture' });
if (!ccslRun.ok) throw new Error(ccslRun.error || 'CCSL fixture run creation failed');
ccslState.currentRun = ccslRun.run;
ccslState.lastRunSummary = { ...ccslRun.run, reportDate, startedAt: '2026-07-20T09:05:00+07:00', completedAt: '2026-07-20T09:05:29+07:00', durationSeconds: 29 };
await saveState(ccslState);
const ccslSnapshot = createDashboardSnapshot(ccslState, { reportDate, runId: ccslRun.run.runId });

const shopeeRows = shopeeBills.map((bill, index) => shopeeRow(bill, index));
const shopeePodBills = shopeeRows.filter(row => row.是否POD === '是').map(row => row.shipmentCode);
const shopeeCarry = shopeeRows.filter(row => row.是否POD !== '是').slice(0, 10).map(row => row.shipmentCode);
let shopeeState = {
  businessType: SHOPEE,
  reportDate,
  sourceName: 'SHOPEE_日报_2026-07-20.xlsx',
  dailyReportReady: true,
  daily: { summary: { totalRecognized: shopeeBills.length, duplicates: 2 }, preview: [] },
  dailyParseSummary: { totalRecognized: shopeeBills.length, totalAppearCount: shopeeBills.length + 2, duplicates: 2, failedRows: [] },
  dailyParseRows: shopeeBills.map((shipmentCode, index) => ({ sheetName: 'SHOPEE日报', rowNumber: index + 2, shipmentCode, result: '有效', reason: '识别SHOPEE运单号', rawText: `${shipmentCode} ${index % 2 ? 'PV' : 'PP'} local delivery`, regionCode: index % 2 ? 'PV' : 'PP', regionType: index % 2 ? 'PROVINCE' : 'PHNOM_PENH' })),
  pnhBills: shopeeBills,
  carryBills: shopeeCarry.slice(0, 7),
  podLocks: shopeePodBills,
  scanPool: shopeeBills,
  scanResults: shopeeRows.map(row => ({ shipmentCode: row.shipmentCode, orderStatus: row.是否POD === '是' ? 85 : 20, 是否POD: row.是否POD })),
  needTrackBills: shopeeRows.filter(row => row.是否POD !== '是').map(row => row.shipmentCode),
  trackResults: shopeeRows,
  shipmentTrackResults: shopeeRows.map(row => ({ shipmentCode: row.shipmentCode, orderStatus: row.是否POD === '是' ? 85 : row.退回状态 === '已退回' ? 81 : 30, statusName: row.POD状态 })),
  shipmentQueryStatus: Object.fromEntries(shopeeRows.map(row => [row.shipmentCode, 'success'])),
  eventQueryStatus: Object.fromEntries(shopeeRows.filter(row => row.是否POD !== '是').map(row => [row.shipmentCode, 'success'])),
  exceptionQueryStatus: Object.fromEntries(shopeeRows.filter(row => row.是否POD !== '是').map(row => [row.shipmentCode, 'success'])),
  trackEvents: shopeeRows.filter(row => row.无轨迹 !== '是').map((row, index) => ({ shipmentCode: row.shipmentCode, eventCode: row.primaryCategory, trackingEventDescZh: row.latestEventDesc, eventTime: `2026-07-${String(18 + (index % 3)).padStart(2, '0')} ${String(8 + (index % 9)).padStart(2, '0')}:35:00`, place: 'Phnom Penh' })),
  exceptionItems: shopeeRows.filter(row => Number(row.OC天数 || 0) > 0).map(row => ({ shipmentCode: row.shipmentCode, exceptionType: 'OC', exceptionDesc: 'OC', reportTime: `2026-07-${String(21 - Number(row.OC天数 || 1)).padStart(2, '0')} 09:00:00`, statusCode: 'OPEN' })),
  apiBatchStatus: [
    { apiName: 'shipment-track', batchKey: 'shipment-track:1', status: 'success', attemptCount: 1, resultCount: shopeeRows.length },
    { apiName: 'shipment-event', batchKey: 'shipment-event:1', status: 'success', attemptCount: 1, resultCount: shopeeRows.filter(row => row.是否POD !== '是').length },
    { apiName: 'exception-item', batchKey: 'exception-item:1', status: 'success', attemptCount: 1, resultCount: 3 }
  ],
  finalRows: shopeeRows,
  nextCarryBills: shopeeCarry,
  historySummary: shopeeHistory(),
  processing: { running: false, paused: false, phase: '完成', batchIndex: 2, totalBatches: 2 },
  logs: [
    '[09:15:02] SHOPEE日报导入完成：64票',
    '[09:15:09] 订单扫描完成：2批次',
    '[09:15:15] 轨迹查询完成：批量上限50票',
    '[09:15:20] SHOPEE处理快照生成完成'
  ]
};
saveBusinessState(shopeeState, SHOPEE);
const shopeeRun = createOrRecoverBusinessRun(SHOPEE, reportDate, { lockedBy: 'locked-ui-fixture' });
if (!shopeeRun.ok) throw new Error(shopeeRun.error || 'SHOPEE fixture run creation failed');
shopeeState.currentRun = shopeeRun.run;
shopeeState.lastRunSummary = { ...shopeeRun.run, reportDate, startedAt: '2026-07-20T09:15:00+07:00', completedAt: '2026-07-20T09:15:20+07:00', durationSeconds: 20 };
saveBusinessState(shopeeState, SHOPEE);
const shopeeSnapshot = saveBusinessSnapshot(SHOPEE, shopeeState, buildShopeeDashboard(shopeeState));

const ccslXlsx = await exportXlsx(ccslSnapshot.state, ccslSnapshot);
const shopeeXlsx = await exportShopeeXlsx(shopeeSnapshot.state, shopeeSnapshot);
const runtime = getRuntimeConfig();
const evidence = {
  reportDate,
  dbFile: runtime.dbFile,
  integrity: getDb().prepare('PRAGMA integrity_check').get().integrity_check,
  schemaVersion: getDb().prepare('PRAGMA user_version').get().user_version,
  ccsl: { snapshotId: ccslSnapshot.snapshotId, runId: ccslRun.run.runId, total: ccslBills.length, pod: ccslPodBills.length, carry: ccslCarry.length, xlsx: ccslXlsx },
  shopee: { snapshotId: shopeeSnapshot.snapshotId, runId: shopeeRun.run.runId, total: shopeeBills.length, pod: shopeePodBills.length, carry: shopeeCarry.length, xlsx: shopeeXlsx }
};
fs.writeFileSync(path.join(target, 'fixture_evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));

function bills(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(9, '0')}`);
}

function ccslRow(运单号, index) {
  const base = { 运单号, shipmentCode: 运单号, reportDate, 是否POD: index < 58 ? '是' : '否', POD状态: index < 58 ? 'POD' : '未POD', 查询状态: 'success', API状态: '成功', 最后节点: '货物运输处理中', 最后节点时间: '2026-07-20 08:20:00', 收件人: `客户${index + 1}`, 当前分类: index < 58 ? 'POD闭环' : '正常运输', 异常分类: index < 58 ? 'POD闭环' : '正常运输', primaryCategory: index < 58 ? 'POD闭环' : '正常运输', 来源类型: index < 58 ? '今日PNH' : '今日PNH', 跨日状态: '当日', carry状态: 'none' };
  if (index === 58) return { ...base, 是否POD: '否', POD状态: '未POD', Pending次数: 1, Pending图片状态: 'HAS_IMAGE', Pending有图片次数: 1, 异常分类: 'Pending1次', primaryCategory: 'Pending1次', 当前分类: 'Pending1次', 最后节点: 'Pending 客户无人接听' };
  if (index === 59) return { ...base, Pending次数: 2, Pending连续性: '不连续', Pending日期: '2026-07-17,2026-07-19', Pending无图片次数: 1, Pending图片状态: 'NO_IMAGE', 图片异常标记: '是', 异常分类: 'Pending2次', primaryCategory: 'Pending2次', 当前分类: 'Pending2次', 最后节点: 'Pending 地址有误' };
  if (index === 60) return { ...base, Pending次数: 3, Pending连续性: '连续', Pending连续3天以上: '是', Pending日期: '2026-07-18,2026-07-19,2026-07-20', 异常分类: 'Pending3次以上', primaryCategory: 'Pending3次以上', 当前分类: 'Pending3次以上', 最后节点: 'Pending 联系不上客户' };
  if (index === 61) return { ...base, OC天数: 1, 异常分类: 'OC1天', primaryCategory: 'OC1天', 当前分类: 'OC1天', 最后节点: 'OC异常处理' };
  if (index === 62) return { ...base, OC天数: 2, 异常分类: 'OC2天', primaryCategory: 'OC2天', 当前分类: 'OC2天', 最后节点: 'OC异常处理' };
  if (index === 63) return { ...base, OC天数: 3, 异常分类: 'OC3天以上', primaryCategory: 'OC3天以上', 当前分类: 'OC3天以上', 最后节点: 'OC异常处理' };
  if (index === 64) return { ...base, 盘点天数: 1, 异常分类: '盘点1天', primaryCategory: '盘点1天', 当前分类: '盘点1天', 最后节点: '盘点处理中' };
  if (index === 65) return { ...base, 盘点天数: 2, 异常分类: '盘点2天', primaryCategory: '盘点2天', 当前分类: '盘点2天', 最后节点: '盘点处理中' };
  if (index === 66) return { ...base, 盘点天数: 3, 异常分类: '盘点3天以上', primaryCategory: '盘点3天以上', 当前分类: '盘点3天以上', 最后节点: '盘点处理中' };
  if (index === 67) return { ...base, 派送中天数: 1, 异常分类: '派送停留1天', primaryCategory: '派送停留1天', 当前分类: '派送停留1天', 最后节点: '派送中' };
  if (index === 68) return { ...base, 派送中天数: 2, 异常分类: '派送停留2天', primaryCategory: '派送停留2天', 当前分类: '派送停留2天', 最后节点: '派送中' };
  if (index === 69) return { ...base, 派送中天数: 3, 异常分类: '派送停留3天以上', primaryCategory: '派送停留3天以上', 当前分类: '派送停留3天以上', 最后节点: '派送中' };
  if (index === 70) return { ...base, 异常分类: '入库无扫描', primaryCategory: '入库无扫描节点', 当前分类: '入库无扫描节点', 最后节点: '货物到达网点【CEL:CCSL】' };
  if (index === 71) return { ...base, 异常分类: '需人工复核', primaryCategory: '工单未处理', 当前分类: '工单未处理', 最后节点: '需人工复核' };
  if (index === 72) return { ...base, 节点日期未更新: '是', 节点未更新天数: 2, 异常分类: '节点日期未更新', primaryCategory: '节点未更新', 当前分类: '节点未更新', 最后节点时间: '2026-07-18 11:00:00' };
  if (index === 73) return { ...base, 包裹无动作: '是', 异常分类: '包裹无动作', primaryCategory: '包裹无动作', 当前分类: '包裹无动作', 最后节点: '无有效轨迹' };
  if (index === 74) return { ...base, 运单号: `TBKH${运单号.slice(3)}`, shipmentCode: `TBKH${运单号.slice(3)}`, 是否门店链路: '是', TBKH门店包裹: '是', 门店编码: 'CP000512', 门店名称: '测试门店A', 门店状态: '门店途中', 门店滞留天数: 2, 异常分类: '门店途中', primaryCategory: '门店途中', 当前分类: '门店途中', 最后节点: '货物离开网点【CEL:CEZT】，下一个网点为【CEL:CP000512】' };
  if (index === 75) return { ...base, 是否门店链路: '是', 门店编码: 'CP000513', 门店名称: '测试门店B', 门店状态: '门店滞留', 门店动作类型: '门店入库', 门店入库时间: '2026-07-18 10:00:00', 门店滞留天数: 2, 异常分类: '门店滞留', primaryCategory: '门店滞留', 当前分类: '门店滞留', 最后节点: '货物到达网点【CEL:CP000513】' };
  if (index === 76) return { ...base, 异常分类: '正常分流节点', primaryCategory: '正常分流节点', 当前分类: '正常分流节点', matchedRule: 'NORMAL_FINAL_HUB', 最后节点: '货物到达网点【CEL:CCSLPDD】' };
  if (index === 77) return { ...base, Pending次数: 3, Pending连续性: '连续', Pending连续3天以上: '是', Pending日期: '2026-07-18,2026-07-19,2026-07-20', Pending图片状态: 'IMAGE_FIELD_INVALID', Pending无图片次数: 3, 图片异常标记: '是', 异常分类: 'Pending3次以上', primaryCategory: 'Pending3次以上', 当前分类: 'Pending3次以上' };
  return base;
}

function shopeeRow(shipmentCode, index) {
  const regionCode = index % 2 ? 'PV' : 'PP';
  const base = { businessType: 'SHOPEE', shipmentCode, 运单号: shipmentCode, reportDate, regionCode, regionType: regionCode === 'PP' ? 'PHNOM_PENH' : 'PROVINCE', 是否POD: index < 39 ? '是' : '否', POD状态: index < 39 ? 'POD' : '未POD', API状态: '成功', 查询状态: 'success', primaryCategory: index < 39 ? 'POD' : '正常运输', 主分类: index < 39 ? 'POD' : '正常运输', 当前分类: index < 39 ? 'POD' : '正常运输', latestEventDesc: index < 39 ? 'POD签收成功' : '运输处理中', latestEventTime: '2026-07-20 09:00:00', carry状态: 'none', 跨日状态: '当日', 收件人: `SHOPEE客户${index + 1}` };
  if (index === 39) return { ...base, Pending次数: 1, primaryCategory: 'Pending1次', 主分类: 'Pending1次', 当前分类: 'Pending1次', latestEventDesc: 'Pending 客户无人接听' };
  if (index === 40) return { ...base, Pending次数: 2, Pending连续: '是', Pending连续性: '连续', primaryCategory: 'Pending2次', 主分类: 'Pending2次', 当前分类: 'Pending2次' };
  if (index === 41) return { ...base, Pending次数: 3, Pending不连续: '是', Pending连续性: '不连续', primaryCategory: 'Pending3次及以上', 主分类: 'Pending3次及以上', 当前分类: 'Pending3次及以上' };
  if (index === 42) return { ...base, OC天数: 1, primaryCategory: 'OC 1天', 主分类: 'OC 1天', 当前分类: 'OC 1天' };
  if (index === 43) return { ...base, OC天数: 2, primaryCategory: 'OC 2天', 主分类: 'OC 2天', 当前分类: 'OC 2天' };
  if (index === 44) return { ...base, OC天数: 3, primaryCategory: 'OC 3天及以上', 主分类: 'OC 3天及以上', 当前分类: 'OC 3天及以上' };
  if (index === 45) return { ...base, 入库无扫描节点: '是', primaryCategory: '入库无扫描节点', 主分类: '入库无扫描节点', 当前分类: '入库无扫描节点' };
  if (index === 46) return { ...base, 派送中停留天数: 2, primaryCategory: '派送中停留', 主分类: '派送中停留', 当前分类: '派送中停留' };
  if (index === 47) return { ...base, 节点未更新天数: 3, primaryCategory: '节点未更新', 主分类: '节点未更新', 当前分类: '节点未更新', latestEventTime: '2026-07-17 09:00:00' };
  if (index === 48) return { ...base, 无轨迹: '是', primaryCategory: '无轨迹', 主分类: '无轨迹', 当前分类: '无轨迹', latestEventDesc: '无轨迹返回' };
  if (index === 49) return { ...base, API状态: '失败', 查询状态: 'refresh_failed', primaryCategory: 'API失败待重试', 主分类: 'API失败待重试', 当前分类: 'API失败待重试', carry状态: 'active', 跨日状态: '跨日续查' };
  if (index === 50) return { ...base, Pending当前次数: 3, Pending最大次数: 3, Pending连续: true, Pending连续性: '连续', returnRequired: true, 退回待处理: '是', primaryCategory: '退回待处理', 主分类: '退回待处理', 当前分类: '退回待处理', carry状态: 'active', 跨日状态: '跨日续查' };
  if (index === 51) return { ...base, 退回状态: '已退回', primaryCategory: '退回', 主分类: '退回', 当前分类: '退回', carry状态: 'closed', 跨日状态: '已闭环' };
  return base;
}

function ccslHistory() {
  const dates = ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];
  return dates.map((date, index) => ({ businessType: 'CCSL', reportDate: date, summary: { reportDate: date, metrics: { 今日PNH: 70 + index * 2, 总件数: 70 + index * 2, 今日POD: 45 + index * 2, 已签收: 45 + index * 2, 首投POD率: 64 + index * 2, 签收率: 64 + index * 2, 异常率: 28 - index, 'Pending1+': 9 - index, 'Pending2+': 6 - Math.floor(index / 2), 'Pending3+': 3 - Math.floor(index / 3), 'OC1+': 8 - index, 'OC2+': 6 - Math.floor(index / 2), 'OC3+': 3 - Math.floor(index / 3), 'OC 2天及以上': 8 - index, '盘点 2天及以上': 7 - index, '门店滞留 2天及以上': 6 - index, 入库无扫描节点: 5 - Math.floor(index / 2), 工单未处理: 4 - Math.floor(index / 2), '门店途中 2天及以上': 9 - index }, metricStatuses: {} } }));
}

function shopeeHistory() {
  const dates = ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'];
  return dates.map((date, index) => ({ businessType: 'SHOPEE', reportDate: date, summary: { reportDate: date, metrics: { 日报总件数: 52 + index * 2, 总件数: 52 + index * 2, 今日POD: 28 + index * 2, 已签收: 28 + index * 2, POD率: 54 + index * 2, 签收率: 54 + index * 2, 'Pending1+': 9 - index, 'Pending2+': 6 - Math.floor(index / 2), 'Pending3+': 3 - Math.floor(index / 3), 'OC1+': 8 - index, 'OC2+': 5 - Math.floor(index / 2), 'OC3+': 2 - Math.floor(index / 3), 入库无扫描: 5 - Math.floor(index / 2), 退回待处理: 3 - Math.floor(index / 3), PP签收率: 58 + index, PV签收率: 50 + index, PPPending率: 18 - index, PVPending率: 22 - index, PPOC率: 12 - index, PVOC率: 15 - index, 异常件数: 20 - index, 跨日遗留: 12 - index, 'Pending 1次': 6 - Math.floor(index / 2), 'Pending 2次': 5 - Math.floor(index / 2), 'Pending 3次及以上': 4 - Math.floor(index / 2), 'OC 1天': 5 - Math.floor(index / 2), 'OC 2天': 4 - Math.floor(index / 2), 'OC 3天及以上': 3 - Math.floor(index / 2), 入库无扫描节点: 5 - Math.floor(index / 2), 派送中停留: 7 - index, 节点未更新: 6 - index, 无轨迹: 4 - Math.floor(index / 2), API失败待重试: index % 2, 明日继续: 11 - index }, metricStatuses: {} } }));
}
