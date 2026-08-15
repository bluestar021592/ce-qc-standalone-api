import {
  analyzeShopeeShipment as analyzeShopeeShipmentV31,
  classifyShopeeScanStatus,
  classifyShopeeRegion
} from './shopeeAnalyzerV31.js';
import { analyzeShopeeShipment as analyzeShopeeShipmentV30 } from './shopeeAnalyzerV30.js';
import { buildTrajectoryFacts } from './trajectoryFacts.js';
import { isStrictShopeeWhppRetention } from './shopeeWhppRetentionTruth.js';

export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-13-v94-shopee-whpp-terminal-location-v32';

/**
 * V31 introduced the WHPP responsibility bucket, but its text fallback accepted
 * any latest description containing "CE:WHPP". A return/departure sentence can
 * mention WHPP as the source node, so that rule could turn an already-returning
 * parcel into WHPP retention and zero its normal state fields.
 *
 * V32 keeps every V31 terminal/scan safety rule, but WHPP is accepted only when
 * the latest effective event still locates the parcel at WHPP. If V31 produced a
 * false WHPP bucket, rebuild the parcel with V30's ordinary state machine from
 * the same saved evidence rather than trying to guess which Pending/OC/store
 * fields V31 had zeroed.
 */
export function analyzeShopeeShipment(args = {}) {
  const result = analyzeShopeeShipmentV31(args);
  if (String(result?.specialState || '') !== 'SHOPEE_WHPP_RETENTION') {
    return { ...result, analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION };
  }

  const events = Array.isArray(args.events) ? args.events : [];
  const facts = buildTrajectoryFacts({
    shipmentCode: args.waybill || args.scanRow?.shipmentCode || args.scanRow?.运单号 || '',
    scanRow: args.scanRow || {},
    events,
    reportDate: args.analysisDate || args.reportDate || ''
  });
  const strict = isStrictShopeeWhppRetention({
    event: facts.lastEvent || {},
    scanOrderStatus: args.scanRow?.orderStatus,
    finalRow: result
  });
  if (strict) return { ...result, analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION };

  const ordinary = analyzeShopeeShipmentV30(args);
  return {
    ...ordinary,
    analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
    specialState: String(ordinary.specialState || '') === 'SHOPEE_WHPP_RETENTION' ? '' : (ordinary.specialState || ''),
    WHPP滞留: '否',
    whppRetention: false,
    currentHub: String(ordinary.currentHub || '').toUpperCase() === 'WHPP' ? '' : (ordinary.currentHub || ''),
    responsibilityHub: String(ordinary.responsibilityHub || '').toUpperCase() === 'WHPP' ? '' : (ordinary.responsibilityHub || ''),
    tags: (Array.isArray(ordinary.tags) ? ordinary.tags : []).filter(tag => tag !== 'SHOPEE_WHPP_RETENTION'),
    QC判断: ordinary.QC判断 || '最新有效节点并未停留WHPP，已按真实末节点恢复普通SHOPEE状态'
  };
}

export { classifyShopeeScanStatus, classifyShopeeRegion };
