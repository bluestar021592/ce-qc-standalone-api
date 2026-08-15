import {
  analyzeShopeeShipment as analyzeShopeeShipmentV31,
  classifyShopeeScanStatus,
  classifyShopeeRegion
} from './shopeeAnalyzerV31.js';
import { analyzeShopeeShipment as analyzeShopeeShipmentV30 } from './shopeeAnalyzerV30.js';
import { buildTrajectoryFacts } from './trajectoryFacts.js';
import { isStrictShopeeWhppRetention } from './shopeeWhppRetentionTruth.js';

export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-15-v136-shopee-cancel-terminal-v33';

export function analyzeShopeeShipment(args = {}) {
  const result = analyzeShopeeShipmentV31(args);
  const orderStatus = String(args.scanRow?.orderStatus ?? result?.orderStatus ?? '').trim();
  if (orderStatus === '10' || String(result?.currentState || '').toUpperCase() === 'ORDER_CANCELLED' || result?.订单取消 === '是' || result?.取消状态 === '已取消') {
    return {
      ...result,
      analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
      orderStatus: '10',
      currentState: 'ORDER_CANCELLED',
      primaryCategory: '订单取消',
      主分类: '订单取消',
      异常分类: '订单取消',
      订单取消: '是',
      取消状态: '已取消',
      是否POD: '否',
      POD状态: '未POD',
      退回状态: '未退回',
      Pending次数: 0,
      Pending当前次数: 0,
      Pending不连续: '否',
      OC天数: 0,
      盘点天数: 0,
      入库无扫描节点: '否',
      trackRequired: false,
      trackSkippedReason: 'ORDER_CANCELLED',
      matchedRule: 'NORMAL_FINAL_HUB',
      carry状态: 'closed_cancelled',
      跨日状态: '已闭环',
      tags: [...new Set([...(Array.isArray(result?.tags) ? result.tags : []), 'ORDER_CANCELLED'])],
      QC判断: '订单扫描orderStatus=10，订单已取消，按正常终态闭环；不计未POD/Pending/OC/遗留异常'
    };
  }

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
