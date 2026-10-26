// V791: delivery-follow-up scope is separate from package POD outcome.
// These explicit operational handoffs close the courier delivery assignment,
// NOT the shipment itself. Never fabricate a POD/returned terminal fact.
export const DELIVERY_HANDOFFS = new Set([
  'CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION',
  'CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION'
]);
export function deliveryFollowupDisposition(row={}) {
  const candidates=[row.specialState,row.currentState,row.primaryCategory,
    row.currentMainCategory,row.scanNormalizedState,row.category];
  const normalized=candidates.map(v=>String(v??'').trim().toUpperCase());
  const handoff=normalized.find(v=>DELIVERY_HANDOFFS.has(v));
  if(handoff)return {include:false,reason:'DELIVERY_HANDOFF',handoff};
  // Missing local scan is NOT proof of a customer Pending or of a POD.
  const scanMissing=normalized.includes('PENDING_SCAN');
  return {include:true,reason:scanMissing?'SCAN_EVIDENCE_MISSING':'NOT_YET_CLOSED',handoff:''};
}
