// Pure membership/coverage guards for V788 WHPP TMS reconciliation.
// A finished query pass is not proof that all exact-day source members have
// persisted shipmentStatus evidence. Never infer missing TMS responses are 60/81.
const count=value=>Math.max(0,Math.floor(Number(value)||0));

export function shouldRunSelectedDateEvidence(podMembers=0,whppSourceMembers=0){
  return count(podMembers)>0||count(whppSourceMembers)>0;
}

export function whppStatusEvidenceHasGaps(type='',{
  podMembers=0,sourceMembers=0,persistedRows=0,failedMembers=0
}={}){
  if(String(type||'').trim().toUpperCase()!=='WHPP')return false;
  const source=count(sourceMembers);
  if(!source)return count(podMembers)>0;
  return count(failedMembers)>0||count(persistedRows)<source;
}

/**
 * Only the direct shipmentStatus field from the TMS shipment endpoint is
 * eligible for WHPP status evidence. An eventCode/orderStatus/statusText or
 * an empty response must not replace previously saved shipment proof.
 */
export function hasDirectTmsShipmentStatus(row={}){
  const status=String(row?.shipmentStatus??'').trim();
  return /^\d+$/.test(status);
}
