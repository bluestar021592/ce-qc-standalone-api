import { CEClient } from './ceClient.js';
import { isShopeePending1203ReturnEvent } from './shopeeReturnTruth.js';

export const V224_SHOPEE_PENDING_1203_EVIDENCE_ID = '2026-08-22-v224-shopee-pending-1203-evidence-v1';

const originalTrackQuery = CEClient.prototype.trackQuery;

// Preserve CE's raw eventCode=150. We only add a derived terminal-status field
// for SPE rows that match the locked SHOPEE CN/VN 1203 rule. This lets all
// downstream refresh/reconciliation layers recognize the business return signal
// without falsifying or replacing the original trajectory evidence.
CEClient.prototype.trackQuery = async function v224ShopeePending1203TrackQuery(shipmentCodes) {
  const rows = await originalTrackQuery.call(this, shipmentCodes);
  return (Array.isArray(rows) ? rows : []).map(row => {
    const bill = String(row?.shipmentCode || row?.运单号 || row?.waybill || '').trim().toUpperCase();
    if (!bill.startsWith('SPE') || !isShopeePending1203ReturnEvent(row)) return row;
    return {
      ...row,
      statusDesc: [row?.statusDesc, 'RETURNED'].filter(Boolean).join(' '),
      shopeePending1203ReturnEvidence: true,
      shopeePending1203OriginalEventCode: String(row?.eventCode ?? row?.trackingEventCode ?? ''),
      shopeePending1203ReturnRule: 'PENDING_1203_DELIVERY_PROBLEM'
    };
  });
};

console.log('[CE-QC][V224] SPE trajectory Pending 1203 delivery-problem marker is a return signal at any event position.');
