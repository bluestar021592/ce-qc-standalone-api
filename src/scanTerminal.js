const POD_TEXT = /\bPOD\b|delivered|delivery successfully|已签收|签收成功|已妥投/i;
const RETURN_COMPLETED_TEXT = /\bP4008\b|return successfully|returned|已退回|退回完成|退回签收/i;
const RETURN_PROGRESS_TEXT = /\bP4007\b|\bPR\b|start to return|being returned|开始退回|退回中|退件中/i;

export function classifyScanTerminal(row = {}, requestStatus = 'success') {
  if (requestStatus !== 'success') return result('SCAN_PENDING_RETRY', false, '', 'SCAN_API_FAILED');
  if (!shipmentCodeOf(row)) return result('SCAN_PENDING_RETRY', false, '', 'SCAN_EMPTY_RESPONSE');

  const orderStatus = String(row.orderStatus ?? '').trim().toUpperCase();
  const statusCode = String(row.shipmentStatus ?? row.statusCode ?? row.status ?? row.dailyStatus ?? '').trim().toUpperCase();
  const text = [row.statusText, row.statusName, row.statusDesc, row.shipmentStatusDesc, row.trackingStatus, row.scanCategory, row.扫描分类]
    .map(value => String(value || '').trim()).filter(Boolean).join(' ');

  if (orderStatus === '85' || statusCode === 'Y') {
    return result('POD', false, 'POD_COMPLETED', orderStatus === '85' ? 'ORDER_STATUS_85' : `STATUS_${statusCode || 'TEXT'}`);
  }
  if (statusCode === 'PR' || statusCode === 'P4007' || RETURN_PROGRESS_TEXT.test(text)) {
    return result('RETURN_IN_PROGRESS', true, '', `STATUS_${statusCode || 'TEXT'}`);
  }
  if (['81', '100'].includes(orderStatus) || ['R', 'P4008', '81', '100'].includes(statusCode) || RETURN_COMPLETED_TEXT.test(text)) {
    return result('RETURN_COMPLETED', false, 'RETURN_COMPLETED', `STATUS_${statusCode || orderStatus || 'TEXT'}`);
  }
  if (POD_TEXT.test(text)) return result('POD', false, 'POD_COMPLETED', 'STATUS_TEXT');
  return result('OPEN_TRACK_REQUIRED', true, '', statusCode ? `NON_TERMINAL_${statusCode}` : 'NON_TERMINAL_UNKNOWN');
}

function result(currentState, trackRequired, scanTerminalType, scanTerminalReason) {
  return { currentState, trackRequired, scanTerminalType, scanTerminalReason, trackSkippedReason: trackRequired ? '' : scanTerminalReason };
}

function shipmentCodeOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}
