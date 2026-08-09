import {
  analyzeShopeeShipment as analyzeShopeeShipmentV30,
  classifyShopeeScanStatus,
  classifyShopeeRegion
} from './shopeeAnalyzerV30.js';
import { classifyScanTerminal } from './scanTerminal.js';

export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-09-scan-track-code-separation-v31';

/**
 * Safety wrapper around V30.
 * - An empty trajectory result must not crash the classifier.
 * - Legacy text/old code 81 must not resurrect POD/return terminal states.
 * Locked terminal sources are scan 85/100 or tracking 80/86 only.
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
  const hasTrackPod = sorted.some(event => codeOf(event) === '80');
  const hasTrackReturn = sorted.some(event => codeOf(event) === '86');
  const exactPod = scanGate.currentState === 'POD' || hasTrackPod;
  const exactReturn = !exactPod && (scanGate.currentState === 'RETURN_COMPLETED' || hasTrackReturn);

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
      QC判断: scanGate.currentState === 'SCAN_PENDING_RETRY' ? '订单扫描待重试' : '轨迹接口成功但没有返回有效轨迹，保留续查'
    };
  }

  // V29 historically treated text/81 as completed return and broad POD text as
  // terminal. V30 corrects most fields, but its inherited currentState/category
  // can still carry those legacy labels. Strip them unless an exact terminal code
  // is present.
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
        退回状态: latestCode === '84' ? '退回处理中' : '未退回',
        carry状态: latestCode === '84' ? 'active_return' : 'active'
      });
    }
  }

  return { ...result, analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION };
}

export { classifyShopeeScanStatus, classifyShopeeRegion };

function codeOf(event) {
  const row = event || {};
  return String(row.eventCode ?? row.trackingEventCode ?? row.statusCode ?? '').trim();
}
