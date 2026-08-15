import { analyzeShipment as analyzeShipmentV30, normalizeEvent } from './analyzerV30.js';

export { normalizeEvent };

/**
 * Final safety wrapper for CE/CEAF/TBKH/ALI1688.
 * V30 owns the trajectory facts and business classification. This layer removes
 * the last legacy carry/track flags that could survive from a historical POD or
 * return event even after a newer effective trajectory event reopened the parcel.
 * Scan orderStatus=10 is also a global normal terminal and must never become
 * "no action" merely because trajectory was correctly skipped.
 */
export function analyzeShipment(args = {}) {
  const result = analyzeShipmentV30(args);
  const orderStatus = String(args.scanRow?.orderStatus ?? result?.orderStatus ?? '').trim();
  if (orderStatus === '10' || String(result.currentState || '').toUpperCase() === 'ORDER_CANCELLED') return cancelledResult(result);

  const hold = scanStatusHold(args.events || []);
  if (hold) return scanHoldResult(result, args.scanRow || {}, hold);

  const state = String(result.currentState || '').toUpperCase();
  const isPod = result.是否POD === '是' || state === 'POD';
  const isReturned = result.退回状态 === '已退回' || ['RETURNED', 'RETURN_COMPLETED'].includes(state);
  const returnInProgress = !isPod && !isReturned && (result.退回状态 === '退回处理中' || state === 'RETURN_IN_PROGRESS');
  const terminal = isPod || isReturned;

  return {
    ...result,
    analysisRuleVersion: '2026-08-15-v137-core-scan-terminal-v3',
    trackRequired: !terminal,
    trackSkippedReason: terminal ? (isPod ? 'POD_COMPLETED' : 'RETURN_COMPLETED') : '',
    carry状态: isPod ? 'closed_pod' : isReturned ? 'closed_return' : returnInProgress ? 'active_return' : 'active',
    跨日状态: terminal ? '已闭环' : '未闭环'
  };
}

function cancelledResult(base = {}) {
  const tags=[...new Set([...(Array.isArray(base.tags)?base.tags:[]),'ORDER_CANCELLED'])];
  return {
    ...base,
    analysisRuleVersion:'2026-08-15-v137-core-scan-terminal-v3',
    orderStatus:'10',
    currentState:'ORDER_CANCELLED',
    scanNormalizedState:'ORDER_CANCELLED',
    primaryCategory:'订单取消',主分类:'订单取消',异常分类:'订单取消',
    订单取消:'是',取消状态:'已取消',
    是否POD:'否',POD状态:'不适用(订单取消)',退回状态:'未退回',
    trackRequired:false,trackSkippedReason:'ORDER_CANCELLED',
    carry状态:'closed_cancelled',跨日状态:'已闭环',
    Pending次数:0,Pending当前次数:0,pendingDistinctDayCount:0,Pending日期:'',Pending连续性:'',Pending不连续:'否',
    OC天数:0,OC次数:0,盘点天数:0,盘点次数:0,派送中停留天数:0,
    入库无扫描节点:'否',无轨迹:'否',
    tags,matchedRule:'NORMAL_FINAL_HUB',命中规则:'ORDER_STATUS_10',
    QC判断:'订单扫描orderStatus=10，订单已取消，按正常终态闭环；不进入轨迹，不计未POD/Pending/OC/普通遗留异常'
  };
}

function scanStatusHold(events = []) {
  return (Array.isArray(events) ? events : []).find(event => String(event?.syntheticType || event?.__ceQcSynthetic || '').toUpperCase() === 'SCAN_STATUS_HOLD') || null;
}

function scanHoldResult(base = {}, scanRow = {}, hold = {}) {
  const status = String(hold.scanOrderStatus || scanRow.orderStatus || '').trim();
  const tags = [...new Set([...(Array.isArray(base.tags) ? base.tags : []), 'SCAN_STATUS_HOLD'])];
  return {
    ...base,
    analysisRuleVersion: '2026-08-15-v137-core-scan-terminal-v3',
    currentState: 'SCAN_STATUS_HOLD',
    scanNormalizedState: 'SCAN_STATUS_HOLD',
    primaryCategory: '扫描状态待识别',
    主分类: '扫描状态待识别',
    异常分类: '扫描状态待识别',
    orderStatus: status,
    是否POD: '否',
    POD状态: '未POD',
    退回状态: '未退回',
    trackRequired: false,
    trackSkippedReason: 'SCAN_STATUS_NOT_TRACKABLE',
    carry状态: 'active',
    跨日状态: '未闭环',
    Pending次数: 0,
    Pending当前次数: 0,
    pendingDistinctDayCount: 0,
    Pending日期: '',
    Pending连续性: '',
    Pending不连续: '否',
    OC天数: 0,
    OC次数: 0,
    盘点天数: 0,
    盘点次数: 0,
    派送中停留天数: 0,
    入库无扫描节点: '否',
    无轨迹: '否',
    最后节点: '',
    最后节点时间: '',
    lastEventCode: '',
    lastEventDesc: '',
    轨迹节点数: 0,
    tags,
    systemHold: true,
    API状态: '已跳过',
    查询状态: 'scan_status_hold',
    QC判断: `扫描orderStatus=${status || 'UNKNOWN'}不属于已入库50/分配60/派送70；系统未调用CE轨迹接口，保留待识别`
  };
}
