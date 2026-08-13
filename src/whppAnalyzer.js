import { analyzeShopeeShipment } from './shopeeAnalyzer.js';

export const WHPP_ANALYSIS_RULE_VERSION = '2026-08-13-v92-whpp-terminal-authority-v2';

/**
 * WHPP terminal authority is strict:
 * - scan 85 => POD, no track
 * - scan 100 => returned, no track
 * - scan 10 => cancelled, no track
 * - when scan is not terminal, latest trajectory 80 => POD and 86 => returned
 * Terminal evidence always wins over older Pending/OC/carry classifications.
 */
export function analyzeWhppShipment(args = {}) {
  const base = analyzeShopeeShipment(args);
  const forced = forceWhppTerminal(base, args);
  if (forced) return { ...forced, analysisRuleVersion: WHPP_ANALYSIS_RULE_VERSION, businessType: 'WHPP' };

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

  return closeTerminal({
    ...base,
    businessType: 'WHPP',
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
    trackSkippedReason: 'ORDER_CANCELLED',
    carry状态: 'closed_cancelled',
    tags: uniqueTags([...(Array.isArray(base.tags) ? base.tags : []), 'ORDER_CANCELLED']),
    QC判断: `WHPP订单已取消并闭环${cancellationSource ? `（${cancellationSource}）` : ''}`
  });
}

function forceWhppTerminal(base = {}, args = {}) {
  const scanStatus = String(args.scanRow?.orderStatus ?? '').trim();
  if (scanStatus === '85') {
    return closeTerminal({
      ...base,
      currentState: 'POD', scanNormalizedState: 'POD', primaryCategory: 'POD', 主分类: 'POD', 异常分类: 'POD',
      是否POD: '是', POD状态: 'POD', 退回状态: '未退回', 订单取消: '否', 取消状态: '',
      trackSkippedReason: 'POD_COMPLETED', carry状态: 'closed_pod',
      tags: uniqueTags([...(Array.isArray(base.tags) ? base.tags : []), 'POD_LOCK', 'SCAN_85']),
      QC判断: 'WHPP扫描orderStatus=85已签收，强制POD闭环，不进入轨迹查询'
    });
  }
  if (scanStatus === '100') {
    return closeTerminal({
      ...base,
      currentState: 'RETURN_COMPLETED', scanNormalizedState: 'RETURN_COMPLETED', primaryCategory: '退回', 主分类: '退回', 异常分类: '退回',
      是否POD: '否', POD状态: '未POD', 退回状态: '已退回', 订单取消: '否', 取消状态: '',
      trackSkippedReason: 'RETURN_COMPLETED', carry状态: 'closed_return',
      tags: uniqueTags([...(Array.isArray(base.tags) ? base.tags : []), 'RETURN_COMPLETED', 'SCAN_100']),
      QC判断: 'WHPP扫描orderStatus=100已退回，强制退回闭环，不进入轨迹查询'
    });
  }
  if (scanStatus === '10') return null; // cancellation enrichment below

  const events = Array.isArray(args.events) ? [...args.events] : [];
  const latest = events.sort((a,b) => eventTimeOf(a).localeCompare(eventTimeOf(b))).at(-1) || null;
  const code = String(latest?.eventCode ?? latest?.trackingEventCode ?? latest?.statusCode ?? '').trim();
  if (code === '80') {
    return closeTerminal({
      ...base,
      currentState: 'POD', primaryCategory: 'POD', 主分类: 'POD', 异常分类: 'POD', 是否POD: '是', POD状态: 'POD', 退回状态: '未退回',
      trackSkippedReason: 'POD_COMPLETED', carry状态: 'closed_pod', latestTrackStatusCode: '80',
      tags: uniqueTags([...(Array.isArray(base.tags) ? base.tags : []), 'POD_LOCK', 'TRACK_80']),
      QC判断: 'WHPP最新轨迹eventCode=80已签收，强制POD闭环'
    });
  }
  if (code === '86') {
    return closeTerminal({
      ...base,
      currentState: 'RETURN_COMPLETED', primaryCategory: '退回', 主分类: '退回', 异常分类: '退回', 是否POD: '否', POD状态: '未POD', 退回状态: '已退回',
      trackSkippedReason: 'RETURN_COMPLETED', carry状态: 'closed_return', latestTrackStatusCode: '86',
      tags: uniqueTags([...(Array.isArray(base.tags) ? base.tags : []), 'RETURN_COMPLETED', 'TRACK_86']),
      QC判断: 'WHPP最新轨迹eventCode=86已退回，强制退回闭环'
    });
  }
  return null;
}

function closeTerminal(row = {}) {
  return {
    ...row,
    trackRequired: false,
    跨日状态: '已闭环',
    入库无扫描节点: '否',
    无轨迹: '否',
    Pending状态: '否',
    Pending次数: 0,
    Pending当前次数: 0,
    pendingDistinctDayCount: 0,
    Pending日期: '',
    Pending连续: '否',
    Pending连续性: '',
    Pending不连续: '否',
    OC状态: '否',
    OC天数: 0,
    盘点状态: '否',
    盘点天数: 0,
    派送中停留天数: 0,
    shopRetentionNaturalDays: 0,
    shopState: '',
    pvOpenDisposition: '',
    退回待处理: '否',
    returnRequired: false
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

function eventTimeOf(row = {}) {
  return String(row.reportTime || row.eventTime || row.lastUpdateDate || row.creationDate || row.updatedAt || '').trim();
}

function uniqueTags(values = []) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}
