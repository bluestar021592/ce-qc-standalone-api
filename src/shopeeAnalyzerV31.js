import {
  analyzeShopeeShipment as analyzeShopeeShipmentV30,
  classifyShopeeScanStatus,
  classifyShopeeRegion
} from './shopeeAnalyzerV30.js';
import { classifyScanTerminal } from './scanTerminal.js';
import { buildTrajectoryFacts } from './trajectoryFacts.js';

export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-09-latest-facts-pending-continuity-v32';

/**
 * Safety wrapper around V30.
 * - An empty trajectory result must not crash the classifier.
 * - Legacy text/old code 81 must not resurrect POD/return terminal states.
 * - Track terminal state is authoritative ONLY when the last effective event is
 *   code 80/86. A historical 80/86 followed by a newer valid event is historical
 *   evidence, not the current state.
 * - Pending non-continuity is a factual, independent flag based on distinct
 *   Phnom Penh natural days. It does not replace the current primary category.
 */
export function analyzeShopeeShipment(args = {}) {
  const originalEvents = Array.isArray(args.events) ? args.events : [];
  const hasEvents = originalEvents.length > 0;
  const safeEvents = hasEvents
    ? originalEvents
    : [{ shipmentCode: args.waybill || args.scanRow?.shipmentCode || args.scanRow?.运单号 || '', eventCode: '', eventTime: '' }];

  const result = analyzeShopeeShipmentV30({ ...args, events: safeEvents });
  const scanRequestStatus = ['failed', 'scan_retry'].includes(String(args.apiStatus?.shipment || '').toLowerCase()) ? 'failed' : 'success';
  const scanGate = classifyScanTerminal({
    shipmentCode: args.waybill || args.scanRow?.shipmentCode || args.scanRow?.运单号 || 'SCAN_STATUS_ONLY',
    orderStatus: args.scanRow?.orderStatus
  }, scanRequestStatus);
  const facts = buildTrajectoryFacts({
    shipmentCode: args.waybill || args.scanRow?.shipmentCode || args.scanRow?.运单号 || '',
    scanRow: scanRequestStatus === 'success' ? (args.scanRow || {}) : {},
    events: originalEvents,
    reportDate: args.reportDate || '',
    analysisDate: args.analysisDate || '',
    shopCodeMap: args.shopCodeMap || null
  });
  const latest = facts.lastEvent;
  const latestCode = facts.lastCode;
  const exactPod = scanGate.currentState === 'POD' || facts.latestTrackTerminal?.type === 'POD';
  const exactReturn = !exactPod && (scanGate.currentState === 'RETURN_COMPLETED' || facts.latestTrackTerminal?.type === 'RETURN_COMPLETED');

  if (!hasEvents && !exactPod && !exactReturn) {
    return {
      ...result,
      ...factFields(facts, false),
      analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
      currentState: scanGate.currentState === 'SCAN_PENDING_RETRY' ? 'SCAN_PENDING_RETRY' : 'OPEN_TRACK_REQUIRED',
      primaryCategory: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '订单扫描待重试' : '无轨迹',
      主分类: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '订单扫描待重试' : '无轨迹',
      异常分类: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '订单扫描待重试' : '无轨迹',
      退回状态: '未退回',
      是否POD: '否',
      POD状态: '未POD',
      Pending不连续: '否',
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
      QC判断: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '订单扫描待重试' : '轨迹接口成功但没有返回有效轨迹，保留续查'
    };
  }

  // V29 historically treated text/81 and any historical 80/86 as terminal.
  // V30/V32 correct the current state, but this defensive strip prevents old
  // inherited labels from surviving when the latest effective event is open.
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
        POD时间: '',
        退回状态: latestCode === '84' ? '退回处理中' : '未退回',
        退回完成时间: '',
        退回时间: '',
        carry状态: latestCode === '84' ? 'active_return' : 'active'
      });
    }
  }

  const terminal = exactPod || exactReturn;
  const returnInProgress = !terminal && latestCode === '84';
  const storeState = String(result.shopState || facts.storeFlow?.shopState || '');
  const pendingNonContinuous = !terminal
    && !returnInProgress
    && !facts.special
    && !storeState
    && facts.pendingDistinctDayCount >= 2
    && !facts.pendingDateContinuity;

  if (exactPod) {
    Object.assign(result, {
      currentState: 'POD', primaryCategory: 'POD', 主分类: 'POD', 异常分类: 'POD',
      是否POD: '是', POD状态: 'POD', 退回状态: '未退回', Pending不连续: '否', carry状态: 'closed_pod'
    });
  } else if (exactReturn) {
    Object.assign(result, {
      currentState: 'RETURN_COMPLETED', primaryCategory: '退回', 主分类: '退回', 异常分类: '退回',
      是否POD: '否', POD状态: '未POD', 退回状态: '已退回', Pending不连续: '否', carry状态: 'closed_return'
    });
  }

  return {
    ...result,
    ...factFields(facts, pendingNonContinuous),
    analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
    latestEventTime: latest?.eventTime || result.latestEventTime || '',
    latestEventDesc: facts.lastEventText || result.latestEventDesc || '',
    latestTrackStatusCode: latestCode,
    最后节点时间: latest?.eventTime || result.最后节点时间 || '',
    最后节点: facts.lastEventText || result.最后节点 || '',
    Pending不连续: pendingNonContinuous ? '是' : '否'
  };
}

export { classifyShopeeScanStatus, classifyShopeeRegion };

function factFields(facts, pendingNonContinuous) {
  return {
    trajectoryFactVersion: facts.factVersion,
    trajectoryTerminalSource: facts.terminalSource,
    latestEffectiveEventCode: facts.lastCode,
    latestEffectiveEventTime: facts.lastEventTime,
    latestEffectiveEventText: facts.lastEventText,
    latestEffectiveActionType: facts.latestNodeAction?.actionType || 'OTHER',
    latestEffectiveTargetNode: facts.latestNodeAction?.targetNode || '',
    latestEffectiveTargetNodeCode: facts.latestNodeAction?.targetNodeCode || '',
    latestShopFactCode: facts.latestShop?.isShop ? (facts.latestShop.shopCode || '') : '',
    latestShopFactRule: facts.latestShop?.matchedRule || '',
    pendingRawEventCount: facts.pendingRawEventCount,
    pendingDistinctDayCount: facts.pendingDistinctDayCount,
    pendingDates: facts.pendingDates,
    Pending全部日期: facts.pendingDates.join('、'),
    pendingFactDateContinuity: facts.pendingContinuityLabel,
    Pending事实连续性: facts.pendingContinuityLabel,
    currentPendingDistinctDayCount: facts.currentPendingDistinctDayCount,
    currentPendingDates: facts.currentPendingDates,
    currentPendingFactContinuity: facts.currentPendingContinuityLabel,
    Pending不连续: pendingNonContinuous ? '是' : '否'
  };
}
