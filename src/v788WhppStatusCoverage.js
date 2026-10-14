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

/**
 * Normalize transport failures to non-sensitive categories. Do not write the
 * upstream error message (which could include client-specific information)
 * to SQLite diagnostics.
 */
export function classifyWhppTmsError(error){
  const status=Number(error?.ceStatus||error?.status||error?.response?.status||0);
  const code=String(error?.ceCode||error?.code||error?.cause?.code||error?.name||'').toUpperCase();
  const message=String(error?.ceMsg||error?.message||error?.cause?.message||'').toUpperCase();
  if([401,403].includes(status)||/AUTH|UNAUTH|LOGIN|TOKEN|EXPIRED|INVALID_TOKEN/.test(code)
    ||/UNAUTHORIZED|请求未授权|登录过期|登录已失效|TOKEN.*(?:EXPIRED|INVALID)/i.test(message))return 'AUTH';
  if(status===429||/RATE|THROTTL|LIMIT|429/.test(code)||/TOO MANY REQUESTS|RATE.LIMIT/.test(message))return 'RATE_LIMIT';
  if([408,504].includes(status)||/TIMEOUT|TIMEDOUT|ABORT|DEADLINE|BUDGET_EXCEEDED/.test(code)
    ||/TIMEOUT|TIMED OUT|DEADLINE/.test(message))return 'TIMEOUT';
  if(/ECONN|ENET|EAI_AGAIN|EPIPE|FETCH|NETWORK|TLS|SOCKET|CONNECTION/.test(code)
    ||/NETWORK|CONNECTION|SOCKET|TLS|DNS/.test(message))return 'NETWORK';
  return 'OTHER';
}
