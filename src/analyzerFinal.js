import { analyzeShipment as analyzeShipmentV30, normalizeEvent } from './analyzerV30.js';

export { normalizeEvent };

/**
 * Final safety wrapper for CE/CEAF/TBKH/ALI1688.
 * V30 owns the trajectory facts and business classification. This layer removes
 * the last legacy carry/track flags that could survive from a historical POD or
 * return event even after a newer effective trajectory event reopened the parcel.
 */
export function analyzeShipment(args = {}) {
  const result = analyzeShipmentV30(args);
  const state = String(result.currentState || '').toUpperCase();
  const isPod = result.是否POD === '是' || state === 'POD';
  const isReturned = result.退回状态 === '已退回' || ['RETURNED', 'RETURN_COMPLETED'].includes(state);
  const returnInProgress = !isPod && !isReturned && (result.退回状态 === '退回处理中' || state === 'RETURN_IN_PROGRESS');
  const terminal = isPod || isReturned;

  return {
    ...result,
    analysisRuleVersion: '2026-08-10-final-trajectory-state-machine-v1',
    trackRequired: !terminal,
    trackSkippedReason: terminal ? (isPod ? 'POD_COMPLETED' : 'RETURN_COMPLETED') : '',
    carry状态: isPod ? 'closed_pod' : isReturned ? 'closed_return' : returnInProgress ? 'active_return' : 'active',
    跨日状态: terminal ? '已闭环' : '未闭环'
  };
}
