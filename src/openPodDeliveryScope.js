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

// Historical carry rows may predate V791 but already retain the pipeline's
// typed TMS shipment-status marker. Recover that saved proof without calling
// an external API or treating free-form status text as terminal evidence.
export function savedTerminalProof(state={},bill='',businessType=''){
  const code=String(bill||'').trim().toUpperCase();
  const type=String(businessType||'').trim().toUpperCase();
  if(!code||!type)return null;
  const explicit=state.terminalEvidence;
  if(explicit&&typeof explicit==='object'
    &&explicit.source==='TMS_SHIPMENT_STATUS'&&explicit.verified===true
    &&String(explicit.shipmentCode||'').trim().toUpperCase()===code
    &&String(explicit.businessType||'').trim().toUpperCase()===type
    &&['60','80','81'].includes(String(explicit.shipmentStatus||''))){
    return explicit;
  }
  const status=String(state.shipmentStatus||'').trim();
  const marker={'60':'SHIPMENT_STATUS_60_POD',
    '80':'SHIPMENT_STATUS_80_RETURN_IN_PROGRESS',
    '81':'SHIPMENT_STATUS_81_RETURN_COMPLETED'}[status];
  const savedCode=String(state.shipmentCode||state.运单号||'').trim().toUpperCase();
  const sourceBusiness=String(state.businessType||'').trim().toUpperCase();
  const sameBusiness=sourceBusiness===type
    ||(sourceBusiness==='CCSL'&&['CE','CEAF','TBKH','ALI1688'].includes(type))
    ||(sourceBusiness==='SHOPEE'&&['SHOPEECN','SHOPEEVN'].includes(type));
  if(!marker||state.shipmentStatusSource!==marker||savedCode!==code||!sameBusiness)return null;
  return {source:'TMS_SHIPMENT_STATUS',verified:true,shipmentStatus:status,
    shipmentCode:code,businessType:type};
}
