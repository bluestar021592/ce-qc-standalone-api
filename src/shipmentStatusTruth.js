export const SHIPMENT_STATUS_TRUTH_VERSION='2026-10-06-v711-shipment-status-60-80-81-v1';

export const SHIPMENT_STATUS = Object.freeze({
  POD:'60',
  RETURN_IN_PROGRESS:'80',
  RETURN_COMPLETED:'81'
});

/**
 * shipmentStatus belongs to the shipment-status endpoint and MUST NOT be mixed
 * with tracking eventCode/trackingEventCode.
 *
 * Locked business mapping supplied from production examples:
 *   shipmentStatus=60 => POD / delivered
 *   shipmentStatus=80 => return in progress
 *   shipmentStatus=81 => returned / return completed
 */
export function classifyShipmentStatus(row={}) {
  const code=String(row?.shipmentStatus ?? '').trim();
  if(code===SHIPMENT_STATUS.POD)return result(code,'POD',true,false,false,'SHIPMENT_STATUS_60_POD');
  if(code===SHIPMENT_STATUS.RETURN_IN_PROGRESS)return result(code,'RETURN_IN_PROGRESS',false,false,true,'SHIPMENT_STATUS_80_RETURN_IN_PROGRESS');
  if(code===SHIPMENT_STATUS.RETURN_COMPLETED)return result(code,'RETURN_COMPLETED',false,true,false,'SHIPMENT_STATUS_81_RETURN_COMPLETED');
  return result(code,'',false,false,false,code?'SHIPMENT_STATUS_OTHER':'SHIPMENT_STATUS_MISSING');
}

export function shipmentStatusTime(row={}) {
  return String(
    row?.podTime || row?.deliveryTime || row?.returnTime || row?.returnedTime ||
    row?.statusTime || row?.scanTime || row?.updateTime || row?.lastUpdateDate ||
    row?.eventTime || row?.creationDate || ''
  ).trim();
}

function result(code,currentState,pod,returned,returnInProgress,source){
  return {code,currentState,pod,returned,returnInProgress,source,recognized:Boolean(currentState)};
}
