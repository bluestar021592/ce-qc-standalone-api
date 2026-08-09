const TRACK_REQUIRED_ORDER_STATUSES = new Set(['50', '60', '70']);

/**
 * Scan-layer classifier for otwms-order-confirm-query.
 *
 * IMPORTANT BUSINESS RULE:
 * The scan API and the tracking-event API are two independent status layers.
 * This function may ONLY use confirm-query `orderStatus` to decide whether a
 * shipment is terminal or must continue to trajectory lookup.
 *
 * Locked mapping:
 *   50  已入库   -> trajectory required
 *   60  派件分配 -> trajectory required
 *   70  派送中   -> trajectory required
 *   85  已签收   -> POD terminal, no trajectory
 *   100 已退回   -> return terminal, no trajectory
 *
 * Tracking event codes such as 26/30/32/99/150/80/84/86 must never be
 * interpreted here.
 */
export function classifyScanTerminal(row = {}, requestStatus = 'success') {
  if (requestStatus !== 'success') {
    return result('SCAN_PENDING_RETRY', false, '', 'SCAN_API_FAILED');
  }
  if (!shipmentCodeOf(row)) {
    return result('SCAN_PENDING_RETRY', false, '', 'SCAN_EMPTY_RESPONSE');
  }

  const orderStatus = String(row.orderStatus ?? '').trim();

  if (orderStatus === '85') {
    return result('POD', false, 'POD_COMPLETED', 'ORDER_STATUS_85');
  }
  if (orderStatus === '100') {
    return result('RETURN_COMPLETED', false, 'RETURN_COMPLETED', 'ORDER_STATUS_100');
  }
  if (TRACK_REQUIRED_ORDER_STATUSES.has(orderStatus)) {
    return result('OPEN_TRACK_REQUIRED', true, '', `ORDER_STATUS_${orderStatus}`);
  }

  // A successful but currently unknown scan status is intentionally sent to
  // trajectory lookup instead of being guessed from status text/statusCode.
  // This prevents false POD/return closure when tracking-layer codes or labels
  // happen to be present in the confirm-query payload.
  return result('OPEN_TRACK_REQUIRED', true, '', orderStatus ? `ORDER_STATUS_UNKNOWN_${orderStatus}` : 'ORDER_STATUS_UNKNOWN');
}

function result(currentState, trackRequired, scanTerminalType, scanTerminalReason) {
  return {
    currentState,
    trackRequired,
    scanTerminalType,
    scanTerminalReason,
    trackSkippedReason: trackRequired ? '' : scanTerminalReason
  };
}

function shipmentCodeOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}
