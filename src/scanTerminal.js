const TRACK_REQUIRED_ORDER_STATUSES = new Set(['50', '60', '70']);

/**
 * Scan-layer classifier for otwms-order-confirm-query.
 * Scan orderStatus and trajectory eventCode are independent layers.
 *
 * Locked mapping:
 *   10  订单取消 -> normal cancellation terminal, no trajectory
 *   50  已入库   -> trajectory required
 *   60  派件分配 -> trajectory required
 *   70  派送中   -> trajectory required
 *   85  已签收   -> POD terminal, no trajectory
 *   100 已退回   -> return terminal, no trajectory
 */
export function classifyScanTerminal(row = {}, requestStatus = 'success') {
  if (requestStatus !== 'success') return result('SCAN_PENDING_RETRY', false, '', 'SCAN_API_FAILED');
  if (!shipmentCodeOf(row)) return result('SCAN_PENDING_RETRY', false, '', 'SCAN_EMPTY_RESPONSE');

  const orderStatus = String(row.orderStatus ?? '').trim();
  if (orderStatus === '10') return result('ORDER_CANCELLED', false, 'ORDER_CANCELLED', 'ORDER_STATUS_10');
  if (orderStatus === '85') return result('POD', false, 'POD_COMPLETED', 'ORDER_STATUS_85');
  if (orderStatus === '100') return result('RETURN_COMPLETED', false, 'RETURN_COMPLETED', 'ORDER_STATUS_100');
  if (TRACK_REQUIRED_ORDER_STATUSES.has(orderStatus)) return result('OPEN_TRACK_REQUIRED', true, '', `ORDER_STATUS_${orderStatus}`);

  // Unknown successful scan statuses are held locally. They are not guessed from
  // text or tracking-layer codes and must not be sent to trajectory APIs blindly.
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
