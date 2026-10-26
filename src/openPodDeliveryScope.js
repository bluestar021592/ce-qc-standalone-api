// V791: courier delivery task scope and shipment terminal status are different.
// Only explicit supported evidence should remove items from the courier queue.
export const DELIVERY_HANDOFFS = new Set([
  'CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION',
  'CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION'
]);
export function deliveryFollowupDisposition(row={}) {
  const candidates=[row.specialState,row.currentState,row.primaryCategory,
    row.currentMainCategory,row.scanNormalizedState,row.category];
  const normalized=candidates.map(v=>String(v??'').trim().toUpperCase());
  // Strict TMS shipmentStatus supplied by a *verified, matching* response.
  // Never confuse this field with eventCode/orderStatus or free-form text.
  const verified= row.terminalEvidenceVerified===true
    && row.terminalEvidenceBusinessMatched===true
    && row.terminalEvidenceWaybillMatched===true;
  const shipmentStatus=String(row.shipmentStatus??'').trim();
  if(verified&&shipmentStatus==='60')
    return {include:false,reason:'VERIFIED_POD',handoff:''};
  if(verified&&shipmentStatus==='81')
    return {include:false,reason:'VERIFIED_RETURNED',handoff:''};
  // Return-in-progress must remain visible to its own return workflow;
  // it is NOT a completed return and must never be presented as POD.
  if(verified&&shipmentStatus==='80')
    return {include:false,reason:'RETURN_WORKFLOW',handoff:''};
  const handoff=normalized.find(v=>DELIVERY_HANDOFFS.has(v));
  if(handoff)return {include:false,reason:'DELIVERY_HANDOFF',handoff};
  const scanMissing=normalized.includes('PENDING_SCAN');
  return {include:true,reason:scanMissing?'SCAN_EVIDENCE_MISSING':'NOT_YET_CLOSED',handoff:''};
}
