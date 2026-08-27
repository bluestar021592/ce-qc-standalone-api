export const V317_CCSL_RECOVERY_POLICY_ID='2026-08-27-v330-ccsl-zero-ticket-closure-policy-v2';

function normalizeDate(value=''){
  const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}

export function chooseCcslReportDate({latestValidUnified='',currentState='',lastProcessed='',latestDaily=''}={}){
  return [latestValidUnified,currentState,lastProcessed,latestDaily].map(normalizeDate).find(Boolean)||'';
}

export function ccslRecoveryDecision({hasDaily=false,complete=false,lockStatus='',validUnified=false,sourceTotal=null}={}){
  const status=String(lockStatus||'').trim().toLowerCase();
  const total=Number(sourceTotal);
  if(validUnified&&Number.isFinite(total)&&total===0){
    return{complete:true,paused:false,needsResume:false,action:'ZERO_TICKET_COMPLETE',zeroTicketDay:true};
  }
  if(!hasDaily)return{complete:false,paused:false,needsResume:false,action:'NO_DAILY'};
  if(complete)return{complete:true,paused:false,needsResume:false,action:'COMPLETE'};
  if(status==='paused')return{complete:false,paused:true,needsResume:false,action:'PAUSED'};
  if(status==='finished')return{complete:false,paused:false,needsResume:true,action:'REOPEN_FINISHED'};
  if(status)return{complete:false,paused:false,needsResume:true,action:'RESUME_EXISTING'};
  return{complete:false,paused:false,needsResume:true,action:'CREATE_AND_RESUME'};
}
