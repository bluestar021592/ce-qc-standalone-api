import {
  analyzeShopeeShipment as analyzeShopeeShipmentV32,
  classifyShopeeScanStatus,
  classifyShopeeRegion
} from './shopeeAnalyzerV32.js';
import {
  findShopeePending1203ReturnEvent,
  shopeePending1203ReturnTime,
  SHOPEE_PENDING_1203_RETURN_RULE_VERSION
} from './shopeeReturnTruth.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';

export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-23-v246-shopee-strict-attempt-cycle-v34';

function withStrictAttempt(result = {}, events = []) {
  const pod = result?.是否POD === '是' || String(result?.currentState || '').toUpperCase() === 'POD';
  const strict = analyzeV246ShopeeAttemptCycle(events, { podDate: result?.POD时间 || result?.podTime || '' });
  const priorStrict = /STRICT|严格/i.test(String(result?.attemptStatus || result?.attemptSource || ''))
    ? Math.max(0, Number(result?.podAttemptNo || result?.currentAttemptNo || 0)) : 0;
  const attemptNo = strict.attemptNo || priorStrict;
  return {
    ...result,
    currentAttemptNo: attemptNo,
    podAttemptNo: pod ? attemptNo : 0,
    attemptStatus: attemptNo ? 'V246_STRICT_START_FAILURE_CYCLE' : 'UNKNOWN_NO_STRICT_START_EVIDENCE',
    attemptConfidence: attemptNo ? 'HIGH' : 'UNKNOWN',
    attemptUnknownReason: attemptNo ? '' : '轨迹没有可验证的70 START（无70时也没有60分配兜底）',
    attemptHistory: strict.starts.map(row => row.time).filter(Boolean),
    attemptHistoryJson: JSON.stringify({
      version: strict.version,
      source: strict.source,
      startMode: strict.startMode,
      starts: strict.starts,
      failures: strict.failures
    }),
    attemptSource: attemptNo ? strict.source : '无真实派次证据',
    strictAttemptCycleVersion: strict.version
  };
}

/**
 * SHOPEE CN/VN locked rules:
 * - terminal truth remains exact scan 85/100 or trajectory 80/86;
 * - Pending 1203 return business rule remains higher than ordinary open states;
 * - dispatch attempts are V246 strict cycles: first 70 START = attempt 1; only a
 *   Pending/delivery-failure followed by a new START increments the attempt;
 *   repeated START alone never increments; code 60 is fallback only if no 70 exists.
 */
export function analyzeShopeeShipment(args = {}) {
  const base = analyzeShopeeShipmentV32(args);
  const events = Array.isArray(args.events) ? args.events : [];
  const returnEvent = findShopeePending1203ReturnEvent(events);
  if (!returnEvent) {
    return withStrictAttempt({ ...base, analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION }, events);
  }

  const confirmedPod = base?.是否POD === '是'
    || String(base?.currentState || '').toUpperCase() === 'POD'
    || String(args?.scanRow?.orderStatus ?? '') === '85';
  if (confirmedPod) {
    return withStrictAttempt({
      ...base,
      analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
      pending1203ReturnEvidence: true,
      pending1203ReturnRuleVersion: SHOPEE_PENDING_1203_RETURN_RULE_VERSION,
      pending1203ReturnIgnoredReason: 'CONFIRMED_POD_PRIORITY'
    }, events);
  }

  const returnTime = shopeePending1203ReturnTime(returnEvent);
  const returnDesc = String(returnEvent.trackingEventDescZh || returnEvent.trackingEventDesc || returnEvent.trackingEventDescKm || '').trim();
  const tags = [...new Set([...(Array.isArray(base?.tags) ? base.tags : []), 'RETURNED', 'SHOPEE_PENDING_1203_RETURN'])]
    .filter(tag => !/^PENDING(?:_|$)/i.test(String(tag || '')) && tag !== 'PENDING');

  return withStrictAttempt({
    ...base,
    analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
    是否POD: '否',
    POD状态: '未POD',
    POD时间: '',
    currentState: 'RETURN_COMPLETED',
    scanNormalizedState: base?.scanNormalizedState || '',
    trackRequired: false,
    trackSkippedReason: 'SHOPEE_PENDING_1203_RETURN',
    退回状态: '已退回',
    退回开始时间: base?.退回开始时间 || returnTime,
    退回完成时间: returnTime,
    退回时间: returnTime,
    Pending状态: '否',
    Pending次数: 0,
    Pending当前次数: 0,
    Pending日期: '',
    Pending连续性: '无',
    pendingContinuity: '无',
    Pending连续: '否',
    Pending不连续: '否',
    OC状态: '否',
    OC天数: 0,
    盘点状态: '否',
    盘点天数: 0,
    入库无扫描节点: '否',
    returnRequired: false,
    退回待处理: '否',
    primaryCategory: '退回',
    主分类: '退回',
    异常分类: '退回',
    carry状态: 'closed_return',
    跨日状态: '已闭环',
    tags,
    pending1203ReturnEvidence: true,
    pending1203ReturnRuleVersion: SHOPEE_PENDING_1203_RETURN_RULE_VERSION,
    pending1203ReturnTime: returnTime,
    pending1203ReturnDesc: returnDesc,
    pending1203ReturnEventCode: String(returnEvent.eventCode || returnEvent.trackingEventCode || '').trim(),
    freshTerminalSource: base?.freshTerminalSource || 'SHOPEE_PENDING_1203_RETURN',
    QC判断: '轨迹历史命中 Pending 异常滞留:1203--派送异常，按SHOPEE CN/VN退回规则直接归入退回；该节点可位于轨迹中间，不要求为最后节点。'
  }, events);
}

export { classifyShopeeScanStatus, classifyShopeeRegion };
