const TRACK_REQUIRED_ORDER_STATUSES = new Set(['50', '60', '70']);

/**
 * Scan-layer classifier for otwms-order-confirm-query.
 *
 * The scan API decides whether trajectory is needed. Locked mapping:
 *   10  订单取消 -> normal terminal, no trajectory
 *   50  已入库   -> trajectory required
 *   60  派件分配 -> trajectory required
 *   70  派送中   -> trajectory required
 *   85  已签收   -> POD terminal, no trajectory
 *   100 已退回   -> return terminal, no trajectory
 *
 * Unknown successful scan statuses are not guessed from free text. They remain
 * local scan-status holds and are blocked from automated trajectory calls by V86.
 */
export function classifyScanTerminal(row = {}, requestStatus = 'success') {
  if (requestStatus !== 'success') {
    return result('SCAN_PENDING_RETRY', false, '', 'SCAN_API_FAILED');
  }
  if (!shipmentCodeOf(row)) {
    return result('SCAN_PENDING_RETRY', false, '', 'SCAN_EMPTY_RESPONSE');
  }

  const orderStatus = String(row.orderStatus ?? '').trim();

  if (orderStatus === '10') {
    return result('ORDER_CANCELLED', false, 'ORDER_CANCELLED', 'ORDER_STATUS_10');
  }
  if (orderStatus === '85') {
    return result('POD', false, 'POD_COMPLETED', 'ORDER_STATUS_85');
  }
  if (orderStatus === '100') {
    return result('RETURN_COMPLETED', false, 'RETURN_COMPLETED', 'ORDER_STATUS_100');
  }
  if (TRACK_REQUIRED_ORDER_STATUSES.has(orderStatus)) {
    return result('OPEN_TRACK_REQUIRED', true, '', `ORDER_STATUS_${orderStatus}`);
  }

  return result('SCAN_STATUS_HOLD', false, '', orderStatus ? `ORDER_STATUS_UNKNOWN_${orderStatus}` : 'ORDER_STATUS_UNKNOWN');
}

function result(currentState, trackRequired, scanTerminalType, scanTerminalReason) {
  return {
    currentState,
    trackRequired,
    scanTerminalType,
    scanTerminalReason,
    trackSkippedReason: trackRequired ? '' : (scanTerminalType || scanTerminalReason)
  };
}

function shipmentCodeOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}
