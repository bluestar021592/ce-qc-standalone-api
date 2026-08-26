export const V317_CCSL_RECOVERY_POLICY_ID='2026-08-26-v317-ccsl-restart-recovery-policy-v1';

function normalizeDate(value=''){
  const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}

export function chooseCcslReportDate({latestValidUnified='',currentState='',lastProcessed='',latestDaily=''}={}){
  return [latestValidUnified,currentState,lastProcessed,latestDaily].map(normalizeDate).find(Boolean)||'';
}

export function ccslRecoveryDecision({hasDaily=false,complete=false,lockStatus=''}={}){
  const status=String(lockStatus||'').trim().toLowerCase();
  if(!hasDaily)return{complete:false,paused:false,needsResume:false,action:'NO_DAILY'};
  if(complete)return{complete:true,paused:false,needsResume:false,action:'COMPLETE'};
  if(status==='paused')return{complete:false,paused:true,needsResume:false,action:'PAUSED'};
  if(status==='finished')return{complete:false,paused:false,needsResume:true,action:'REOPEN_FINISHED'};
  if(status)return{complete:false,paused:false,needsResume:true,action:'RESUME_EXISTING'};
  return{complete:false,paused:false,needsResume:true,action:'CREATE_AND_RESUME'};
}
