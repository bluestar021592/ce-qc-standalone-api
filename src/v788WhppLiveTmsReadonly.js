// V788 stage 1: fresh TMS shipmentStatus evidence for exact WHPP historical members.
// Pure runner: injected query is read-only; no DB writes, refresh, tracking sync, or purge.
export const V788_WHPP_LIVE_TERMINAL_AUDIT_ID='V788_WHPP_LIVE_TMS_346_READONLY_V1';
const expected=Object.freeze({'2026-07-01':190,'2026-07-02':156});
const bill=v=>String(v??'').trim().toUpperCase();
const label=v=>String(v??'').trim().toUpperCase();
const validDate=v=>Object.hasOwn(expected,String(v??''));
const blankStats=()=>({sourceMembers:0,podLabels:0,returnedLabels:0,
  tmsPOD60:0,tmsReturning80:0,tmsReturned81:0,tmsOther:0,
  matchedPOD:0,matchedReturned:0,returnedLabelStillReturning:0,
  terminalConflict:0,missingTms:0,duplicateTms:0,
  ambiguousLocalStatus:0,openLedgerTerminal:0});
const makeResult=(dates,code)=>({
  id:V788_WHPP_LIVE_TERMINAL_AUDIT_ID,readOnly:true,productionModified:false,
  readyToPublish:false,authorizedToClear:false,readyToClearAndReimport:false,
  releaseDecision:'BLOCKED',outcome:code,
  signingTimeVerified:false,realExcelReadbackVerified:false,
  // Aggregates only: no waybill IDs, secrets, addresses, raw API responses.
  dates
});
export async function auditV788WhppLiveTms({members=[],query,batchSize=25}={}){
  const dates=Object.fromEntries(Object.keys(expected).map(d=>[d,blankStats()]));
  if(!Array.isArray(members)||typeof query!=='function')return makeResult(dates,'INVALID_INPUT');
  const seenDateBill=new Set(), acrossDates=new Map(), rows=[];
  for(const row of members){
    const date=String(row?.reportDate||'').slice(0,10),code=bill(row?.shipmentCode);
    if(!validDate(date)||!code||!/^[A-Z0-9_-]{5,64}$/.test(code))
      return makeResult(dates,'INVALID_SOURCE_MEMBER');
    const key=date+'|'+code;
    if(seenDateBill.has(key))continue;
    seenDateBill.add(key);
    const prev=acrossDates.get(code);
    if(prev&&prev!==date)return makeResult(dates,'CROSS_DATE_DUPLICATE_WAYBILL');
    acrossDates.set(code,date);
    rows.push({date,code,state:label(row?.currentState),ledger:label(row?.ledgerStatus),
      currentEvidenceRows:Number(row?.currentEvidenceRows??1),
      ledgerEvidenceRows:Number(row?.ledgerEvidenceRows??1)});
    const stats=dates[date];
    stats.sourceMembers++;
    if(label(row?.currentState)==='POD')stats.podLabels++;
    if(['RETURNED','RETURN_COMPLETED'].includes(label(row?.currentState)))stats.returnedLabels++;
    if(row?.ledgerStatus==='OPEN'&&['POD','RETURNED','RETURN_COMPLETED'].includes(label(row?.currentState)))
      stats.openLedgerTerminal++;
    if(Number(row?.currentEvidenceRows??1)!==1||Number(row?.ledgerEvidenceRows??1)!==1)
      stats.ambiguousLocalStatus++;
  }
  for(const [date,count] of Object.entries(expected))
    if(dates[date].sourceMembers!==count)return makeResult(dates,'SOURCE_MEMBERSHIP_CHANGED');
  if(rows.length!==346)return makeResult(dates,'SOURCE_MEMBERSHIP_CHANGED');
  if(rows.some(r=>Number(r.currentEvidenceRows)!==1||Number(r.ledgerEvidenceRows)!==1))
    return makeResult(dates,'AMBIGUOUS_LOCAL_EVIDENCE');
  const size=Math.min(25,Math.max(1,Number.isInteger(batchSize)?batchSize:25));
  const byCode=new Map(rows.map(x=>[x.code,x]));
  const summaries={queriedBills:0,completedBatches:0,failedBatches:0,
    returnedRecordsOutOfScope:0,duplicateResponseBills:0,
    missingResponseBills:0,recognized60:0,recognized80:0,recognized81:0,
    terminalMatches:0,terminalConflicts:0};
  for(let i=0;i<rows.length;i+=size){
    const batch=rows.slice(i,i+size).map(x=>x.code);
    let response;
    try{response=await query(batch);}catch(e){
      const status=Number(e?.ceStatus||e?.response?.status||e?.status||0);
      return {...makeResult(dates,[401,403].includes(status)?'TMS_AUTH_REQUIRED':'TMS_QUERY_FAILED'),
        summary:summaries};
    }
    if(!Array.isArray(response))return {...makeResult(dates,'TMS_UNRECOGNIZED_RESPONSE'),summary:summaries};
    summaries.queriedBills+=batch.length;
    summaries.completedBatches++;
    const batchSet=new Set(batch),results=new Map();
    for(const item of response){
      const code=bill(item?.shipmentCode);
      if(!code||!batchSet.has(code)){summaries.returnedRecordsOutOfScope++;continue;}
      if(!results.has(code))results.set(code,[]);
      results.get(code).push(item);
    }
    for(const code of batch){
      const row=byCode.get(code),s=dates[row.date];
      const matches=results.get(code)||[];
      if(matches.length===0){s.missingTms++;summaries.missingResponseBills++;continue;}
      if(matches.length!==1){s.duplicateTms++;summaries.duplicateResponseBills++;continue;}
      const raw=matches[0];
      // Important: shipmentStatus 60/80/81 differs from trajectory eventCode 80/84/86.
      // No orderStatus/eventCode/statusText fallback is permitted here.
      const status=String(raw?.shipmentStatus??'').trim();
      if(status==='60'){s.tmsPOD60++;summaries.recognized60++;}
      else if(status==='80'){s.tmsReturning80++;summaries.recognized80++;}
      else if(status==='81'){s.tmsReturned81++;summaries.recognized81++;}
      else{s.tmsOther++;continue;}
      if(status==='60'&&row.state==='POD'){
        s.matchedPOD++;summaries.terminalMatches++;
      }else if(status==='81'&&['RETURNED','RETURN_COMPLETED'].includes(row.state)){
        s.matchedReturned++;summaries.terminalMatches++;
      }else if(status==='80'&&['RETURNED','RETURN_COMPLETED'].includes(row.state)){
        s.returnedLabelStillReturning++;s.terminalConflict++;summaries.terminalConflicts++;
      }else if((status==='60'&&['RETURNED','RETURN_COMPLETED'].includes(row.state))
        ||(status==='81'&&row.state==='POD')){
        s.terminalConflict++;summaries.terminalConflicts++;
      }
    }
  }
  const exact=Object.values(dates).every(s=>
    s.matchedPOD===s.podLabels&&s.matchedReturned===s.returnedLabels
    &&s.sourceMembers===s.podLabels+s.returnedLabels
    &&s.missingTms===0&&s.duplicateTms===0&&s.terminalConflict===0);
  // Terminal evidence can be complete while signing-time and Excel are not.
  return {...makeResult(dates,exact?'TERMINAL_EVIDENCE_REVIEW_READY':'TERMINAL_EVIDENCE_INCOMPLETE'),
    terminalEvidenceReviewReady:exact,summary:summaries};
}
