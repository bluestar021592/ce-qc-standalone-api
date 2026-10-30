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


/**
 * Exact, read-only projection from the independently reopened sidecar SQLite.
 * The JSON progress report is never authoritative after proof verification.
 * Only status evidence is certified here; signature time, historical ledger
 * closure and formal seven-business XLSX are separate release gates.
 */
export function verifiedV788EvidenceCoverage(checked={}){
  if(checked?.verified!==true||checked?.distributionMatchesV3!==true
      ||Number(checked?.storedMembers)!==346||Number(checked?.batches)!==8)return null;
  const expect=[
    {date:'2026-07-01',total:190,pod:166,returned:24},
    {date:'2026-07-02',total:156,pod:124,returned:32}
  ];
  const dates=[];
  for(const day of expect){
    const entry=checked?.byDate?.[day.date];
    if(!entry)return null;
    const pod=Number(entry.s60),returned=Number(entry.s81);
    if(pod!==day.pod||returned!==day.returned
        ||Number(entry.s80)!==0||Number(entry.other)!==0)return null;
    dates.push({date:day.date,total:pod+returned,pod,returned});
  }
  const pod=dates.reduce((n,d)=>n+d.pod,0);
  const returned=dates.reduce((n,d)=>n+d.returned,0);
  if(pod+returned!==346)return null;
  return {
    independentlyVerifiedCounts:true,
    sourceMembers:346,savedMembers:346,missingMembers:0,completedBatches:8,
    pod,returned,distributionMatchesV3:true,
    statusOnlyPreview:{
      source:'INDEPENDENT_ISOLATED_SQLITE',dates,
      signingTimeAccepted:false,ledgerAccepted:false,exportAccepted:false
    }
  };
}
