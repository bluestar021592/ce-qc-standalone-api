import { analyzeShopeeShipment } from './shopeeAnalyzer.js';

export const WHPP_ANALYSIS_RULE_VERSION = '2026-08-10-whpp-local-cancellation-v1';

/**
 * WHPP local shipments use the same operational analysis as Shopee, with one
 * additional terminal outcome: order cancellation.
 *
 * Locked evidence supplied by production samples:
 * - confirm-query orderStatus = 10
 * - exception-item/query exceptionType = 20 AND statusCode = 10
 *
 * Cancellation reason/sub-reason codes are evidence fields only. They are not
 * used as the sole terminal rule because different cancellation reasons may use
 * different reason codes in production.
 */
export function analyzeWhppShipment(args = {}) {
  const base = analyzeShopeeShipment(args);

  // Newer/stronger delivery terminal evidence must never be overwritten by an
  // older cancellation record.
  if (isPodTerminal(base) || isReturnTerminal(base)) {
    return { ...base, analysisRuleVersion: WHPP_ANALYSIS_RULE_VERSION, businessType: 'WHPP' };
  }

  const scanCancelled = isWhppCancellationScan(args.scanRow || {});
  const cancellationException = findWhppCancellationException(args.exceptions || []);
  if (!scanCancelled && !cancellationException) {
    return { ...base, analysisRuleVersion: WHPP_ANALYSIS_RULE_VERSION, businessType: 'WHPP' };
  }

  const evidence = cancellationException || {};
  const confirmedAt = String(
    evidence.reportTime || evidence.lastUpdateDate || evidence.creationDate ||
    args.scanRow?.lastUpdateDate || args.scanRow?.creationDate || ''
  ).trim();
  const cancellationSource = [scanCancelled ? 'SCAN_ORDER_STATUS_10' : '', cancellationException ? 'EXCEPTION_TYPE_20_STATUS_10' : '']
    .filter(Boolean)
    .join('+');

  return {
    ...base,
    businessType: 'WHPP',
    analysisRuleVersion: WHPP_ANALYSIS_RULE_VERSION,
    currentState: 'ORDER_CANCELLED',
    scanNormalizedState: 'ORDER_CANCELLED',
    primaryCategory: '订单取消',
    主分类: '订单取消',
    异常分类: '订单取消',
    是否POD: '否',
    POD状态: '未POD',
    退回状态: '未退回',
    订单取消: '是',
    取消状态: '已取消',
    cancellationSource,
    cancelOrderStatus: String(args.scanRow?.orderStatus ?? ''),
    cancellationExceptionType: String(evidence.exceptionType ?? ''),
    cancellationStatusCode: String(evidence.statusCode ?? ''),
    cancellationReasonCode: String(evidence.exceptionReasonCode ?? ''),
    cancellationChildReasonCode: String(evidence.exceptionChildReasonCode ?? ''),
    cancellationReason: String(evidence.exceptionReason ?? evidence.exceptionDesc ?? ''),
    cancellationChildReason: String(evidence.exceptionChildReason ?? ''),
    cancellationReportShop: String(evidence.reportShop ?? ''),
    cancellationConfirmedAt: confirmedAt,
    trackRequired: false,
    trackSkippedReason: 'ORDER_CANCELLED',
    carry状态: 'closed_cancelled',
    跨日状态: '已闭环',
    入库无扫描节点: '否',
    无轨迹: '否',
    Pending次数: 0,
    Pending当前次数: 0,
    pendingDistinctDayCount: 0,
    Pending连续性: '',
    Pending不连续: '否',
    OC天数: 0,
    盘点天数: 0,
    派送中停留天数: 0,
    shopRetentionNaturalDays: 0,
    shopState: '',
    pvOpenDisposition: '',
    退回待处理: '否',
    returnRequired: false,
    tags: uniqueTags([...(Array.isArray(base.tags) ? base.tags : []), 'ORDER_CANCELLED']),
    QC判断: `WHPP订单已取消并闭环${cancellationSource ? `（${cancellationSource}）` : ''}`
  };
}

export function isWhppCancellationScan(row = {}) {
  return String(row.orderStatus ?? '').trim() === '10';
}

export function findWhppCancellationException(rows = []) {
  const matched = (Array.isArray(rows) ? rows : [])
    .filter(row => String(row?.exceptionType ?? '').trim() === '20' && String(row?.statusCode ?? '').trim() === '10')
    .sort((a, b) => eventTimeOf(a).localeCompare(eventTimeOf(b)));
  return matched.at(-1) || null;
}

export function isWhppCancelledRow(row = {}) {
  return String(row.currentState || '').toUpperCase() === 'ORDER_CANCELLED'
    || row.订单取消 === '是'
    || row.取消状态 === '已取消'
    || String(row.primaryCategory || row.主分类 || row.异常分类 || '') === '订单取消';
}

function isPodTerminal(row = {}) {
  return row.是否POD === '是'
    || String(row.currentState || '').toUpperCase() === 'POD'
    || String(row.primaryCategory || row.主分类 || '') === 'POD';
}

function isReturnTerminal(row = {}) {
  const state = String(row.currentState || '').toUpperCase();
  return row.退回状态 === '已退回'
    || ['RETURNED', 'RETURN_COMPLETED'].includes(state)
    || String(row.primaryCategory || row.主分类 || '') === '退回';
}

function eventTimeOf(row = {}) {
  return String(row.reportTime || row.lastUpdateDate || row.creationDate || row.updatedAt || '').trim();
}

function uniqueTags(values = []) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}
