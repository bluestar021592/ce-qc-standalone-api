import {
  analyzeShopeeShipment as analyzeShopeeShipmentV30,
  classifyShopeeScanStatus,
  classifyShopeeRegion
} from './shopeeAnalyzerV30.js';
import { classifyScanTerminal } from './scanTerminal.js';
import { buildTrajectoryFacts } from './trajectoryFacts.js';

export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-13-v86-shopee-strict-track-gate-whpp-v3';

/**
 * Final safety wrapper around V30.
 * - An empty trajectory result must not crash the classifier.
 * - Legacy text/old code 81 must not resurrect POD/return terminal states.
 * - Only scan 85/100 or the latest trajectory event 80/86 can close a parcel.
 * - Only scan 50/60/70 are allowed into automated CE trajectory APIs; other
 *   successful scan statuses are held locally for review without a CE track call.
 * - Store Pending/OC remain store self-pickup context, never store retention.
 * - Latest effective CE:WHPP is one Shopee WHPP-responsibility location bucket,
 *   independent of PP/PV and excluded from ordinary Pending/OC/etc anomalies.
 * - Legacy carry flags are rebuilt from the same exact terminal facts.
 */
export function analyzeShopeeShipment(args = {}) {
  const originalEvents = Array.isArray(args.events) ? args.events : [];
  const hasEvents = originalEvents.length > 0;
  const safeEvents = hasEvents
    ? originalEvents
    : [{ shipmentCode: args.waybill || args.scanRow?.shipmentCode || args.scanRow?.运单号 || '', eventCode: '', eventTime: '' }];

  const result = analyzeShopeeShipmentV30({ ...args, events: safeEvents });
  const scanGate = classifyScanTerminal({
    shipmentCode: args.waybill || args.scanRow?.shipmentCode || args.scanRow?.运单号 || 'SCAN_STATUS_ONLY',
    orderStatus: args.scanRow?.orderStatus
  }, ['failed', 'scan_retry'].includes(String(args.apiStatus?.shipment || '').toLowerCase()) ? 'failed' : 'success');

  const sorted = [...originalEvents].sort((a, b) => String(a?.eventTime || '').localeCompare(String(b?.eventTime || '')));
  const latest = sorted.at(-1) || null;
  const latestCode = codeOf(latest);
  const exactPod = scanGate.currentState === 'POD' || latestCode === '80';
  const exactReturn = !exactPod && (scanGate.currentState === 'RETURN_COMPLETED' || latestCode === '86');
  const hold = scanStatusHold(originalEvents);

  if (hold && !exactPod && !exactReturn) return scanHoldResult(result, args.scanRow || {}, hold);

  if (!hasEvents && !exactPod && !exactReturn) {
    return {
      ...result,
      analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
      currentState: scanGate.currentState === 'SCAN_PENDING_RETRY' ? 'SCAN_PENDING_RETRY' : 'OPEN_TRACK_REQUIRED',
      primaryCategory: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '订单扫描待重试' : '无轨迹',
      主分类: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '订单扫描待重试' : '无轨迹',
      异常分类: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '订单扫描待重试' : '无轨迹',
      退回状态: '未退回',
      是否POD: '否',
      POD状态: '未POD',
      入库无扫描节点: '否',
      无轨迹: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '否' : '是',
      latestEventTime: '',
      latestEventDesc: '',
      latestTrackStatusCode: '',
      最后节点时间: '',
      最后节点: '',
      轨迹节点数: 0,
      tags: scanGate.currentState === 'SCAN_PENDING_RETRY' ? ['REFRESH_FAILED'] : ['NO_TRACK'],
      carry状态: 'active',
      跨日状态: '未闭环',
      trackRequired: true,
      trackSkippedReason: '',
      QC判断: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '订单扫描待重试' : '轨迹接口成功但没有返回有效轨迹，保留续查'
    };
  }

  if (!exactPod && !exactReturn) {
    const falseTerminalState = ['POD', 'RETURN', 'RETURNED', 'RETURN_COMPLETED'].includes(String(result.currentState || '').toUpperCase());
    const falseTerminalCategory = ['POD', 'POD闭环', '退回'].includes(String(result.primaryCategory || result.主分类 || result.异常分类 || ''));
    if (falseTerminalState || falseTerminalCategory) {
      const fallbackCategory = latestCode === '84' ? '退回处理中' : '其他已识别节点';
      const fallbackState = latestCode === '84' ? 'RETURN_IN_PROGRESS' : (latestCode ? `TRACK_${latestCode}` : 'OPEN_TRACK_REQUIRED');
      Object.assign(result, {
        currentState: fallbackState,
        primaryCategory: fallbackCategory,
        主分类: fallbackCategory,
        异常分类: fallbackCategory,
        是否POD: '否',
        POD状态: '未POD',
        退回状态: latestCode === '84' ? '退回处理中' : '未退回'
      });
    }
  }

  if (result.shopState === 'SHOP_ARRIVED_CURRENT' && ['SHOP_PENDING', 'SHOP_OC'].includes(String(result.currentState || '').toUpperCase())) {
    result.pvOpenDisposition = 'PV_STORE_NORMAL';
  }

  const returnInProgress = !exactPod && !exactReturn && (latestCode === '84' || result.退回状态 === '退回处理中' || String(result.currentState || '').toUpperCase() === 'RETURN_IN_PROGRESS');
  const facts = !exactPod && !exactReturn && !returnInProgress
    ? buildTrajectoryFacts({ shipmentCode: args.waybill || args.scanRow?.shipmentCode || args.scanRow?.运单号 || '', scanRow: args.scanRow || {}, events: originalEvents, reportDate: args.analysisDate || args.reportDate || '' })
    : null;
  const atShopeeWhpp = Boolean(facts && latestIsWhpp(facts));

  if (atShopeeWhpp) {
    const tags = [...new Set([...(Array.isArray(result.tags) ? result.tags : []), 'SHOPEE_WHPP_RETENTION'])];
    Object.assign(result, {
      specialState: 'SHOPEE_WHPP_RETENTION',
      currentState: 'SHOPEE_WHPP_RETENTION',
      primaryCategory: 'WHPP滞留包裹',
      主分类: 'WHPP滞留包裹',
      异常分类: 'WHPP滞留包裹',
      WHPP滞留: '是',
      whppRetention: true,
      currentHub: 'WHPP',
      responsibilityHub: 'WHPP',
      Pending状态: '否',
      Pending次数: 0,
      Pending当前次数: 0,
      Pending日期: '',
      Pending连续: '否',
      Pending不连续: '否',
      returnRequired: false,
      退回待处理: '否',
      OC状态: '否',
      OC天数: 0,
      盘点状态: '否',
      盘点天数: 0,
      入库无扫描节点: '否',
      无轨迹: '否',
      pvOpenDisposition: '',
      tags,
      QC判断: '最新有效节点到达CE:WHPP，归WHPP责任滞留；独立统计，不并入PP/PV普通异常'
    });
  }

  // Only a currently proven non-POD/non-return special closure may inherit a
  // legacy closed_* carry flag. A historical POD/return followed by a newer
  // Pending/other open node must be reopened; otherwise old V29 evidence can
  // leak closed_pod/closed_return back into the final facade.
  const legacyCarry = String(result.carry状态 || '');
  const inheritedSpecialClosure = !atShopeeWhpp
    && !exactPod
    && !exactReturn
    && !returnInProgress
    && legacyCarry.startsWith('closed_')
    && !['closed_pod', 'closed_return'].includes(legacyCarry.toLowerCase())
    && result.跨日状态 === '已闭环';

  Object.assign(result, {
    analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
    trackRequired: !(exactPod || exactReturn),
    trackSkippedReason: exactPod ? 'POD_COMPLETED' : exactReturn ? 'RETURN_COMPLETED' : '',
    carry状态: exactPod ? 'closed_pod' : exactReturn ? 'closed_return' : inheritedSpecialClosure ? result.carry状态 : returnInProgress ? 'active_return' : 'active',
    跨日状态: exactPod || exactReturn || inheritedSpecialClosure ? '已闭环' : '未闭环'
  });

  return result;
}

export { classifyShopeeScanStatus, classifyShopeeRegion };

function scanStatusHold(events = []) {
  return (Array.isArray(events) ? events : []).find(event => String(event?.syntheticType || event?.__ceQcSynthetic || '').toUpperCase() === 'SCAN_STATUS_HOLD') || null;
}

function scanHoldResult(base = {}, scanRow = {}, hold = {}) {
  const status = String(hold.scanOrderStatus || scanRow.orderStatus || '').trim();
  const tags = [...new Set([...(Array.isArray(base.tags) ? base.tags : []), 'SCAN_STATUS_HOLD'])];
  return {
    ...base,
    analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
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
    盘点天数: 0,
    入库无扫描节点: '否',
    无轨迹: '否',
    latestEventTime: '',
    latestEventDesc: '',
    latestTrackStatusCode: '',
    最后节点时间: '',
    最后节点: '',
    轨迹节点数: 0,
    pvOpenDisposition: '',
    returnRequired: false,
    退回待处理: '否',
    tags,
    systemHold: true,
    API状态: '已跳过',
    查询状态: 'scan_status_hold',
    QC判断: `扫描orderStatus=${status || 'UNKNOWN'}不属于已入库50/分配60/派送70；系统未调用CE轨迹接口，保留待识别`
  };
}

function codeOf(event) {
  const row = event || {};
  return String(row.eventCode ?? row.trackingEventCode ?? row.statusCode ?? '').trim();
}

function latestIsWhpp(facts = {}) {
  const action = facts.latestNodeAction || {};
  const node = normalizeNode(action.targetNodeCode || action.targetNode || facts.lastEvent?.locationCode || facts.lastEvent?.eventShop || facts.lastEvent?.place || '');
  if (node === 'WHPP') return true;
  return /(?:CE|CEL)\s*:\s*WHPP\b/i.test(String(facts.lastEventText || ''));
}

function normalizeNode(value) {
  return String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/^CEL?\s*:\s*/, '')
    .replace(/[^A-Z0-9]/g, '');
}
