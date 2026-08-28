import { CEClient } from './ceClient.js';

export const V349_CONFIRM_COMPLETENESS_ID='2026-08-28-v349-confirm-partial-response-recovery-v2';

const FALLBACK_SIZES=Object.freeze([100,50,10,1]);
const DEFAULT_RECOVERY_BUDGET_MS=Math.max(2000,Math.min(10000,Number(process.env.CE_CONFIRM_PARTIAL_RECOVERY_BUDGET_MS||8000)));
const CECLIENT_PATCH=Symbol.for('ce-qc.v349-confirm-completeness');

function clean(values=[]){return [...new Set((values||[]).map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))];}
function chunks(values=[],size=1){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
function codeOf(row={}){
  return String(
    row.shipmentCode||row.shipmentNo||row.waybill||row.waybillNo||row.orderCode||row.orderNo||row.billCode||row.mailNo||row.trackingNumber||row['运单号']||row.order?.shipmentCode||''
  ).trim().toUpperCase();
}
function isAuthError(error){
  const status=Number(error?.ceStatus||error?.status||error?.response?.status||0);
  const code=String(error?.ceCode||error?.code||'').toUpperCase();
  const text=[error?.ceMsg,error?.message,error?.response?.data?.msg,error?.response?.data?.message].filter(Boolean).join(' ');
  return [401,403].includes(status)||['401','403','AUTH_REQUIRED'].includes(code)||/未授权|unauthorized|登录.*(?:失效|过期)|token.*(?:expired|invalid)/i.test(text);
}
async function withDeadline(task,deadlineAt){
  const remaining=deadlineAt-Date.now();
  if(remaining<=0){const error=new Error('partial confirm recovery budget exhausted');error.code='V349_PARTIAL_RECOVERY_BUDGET_EXHAUSTED';throw error;}
  let timer=null;
  try{
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('partial confirm recovery deadline exceeded');error.code='V349_PARTIAL_RECOVERY_TIMEOUT';reject(error);},remaining);})
    ]);
  }finally{if(timer)clearTimeout(timer);}
}
function appendRows(rowsByCode,output,rows=[],allowed=new Set()){
  for(const row of Array.isArray(rows)?rows:[]){
    const code=codeOf(row);
    if(!code||!allowed.has(code))continue;
    if(!rowsByCode.has(code))rowsByCode.set(code,[]);
    rowsByCode.get(code).push(row);
    output.push(row);
  }
}

export async function recoverPartialConfirmResponse(rawConfirm,shipmentCodes,options={}){
  if(typeof rawConfirm!=='function')throw new Error('raw confirmQuery function is required');
  const requested=clean(shipmentCodes);
  if(!requested.length)return[];
  const requestedSet=new Set(requested);

  // The first normal confirm request is intentionally outside the recovery budget.
  // If it throws, the caller's canonical V345 transport fallback/retry remains the
  // sole owner. V349 only starts after an HTTP-successful but incomplete response.
  const initial=await rawConfirm(requested);
  const output=[];
  const rowsByCode=new Map();
  appendRows(rowsByCode,output,initial,requestedSet);
  let missing=requested.filter(code=>!rowsByCode.has(code));
  if(!missing.length)return output;

  // Keep the partial-response compensation comfortably below the surrounding
  // confirm-query hard deadline. Missing children are sequential so CCSL/WHPP keep
  // one remote confirm lane; already-returned waybills are never requested again.
  const budgetMs=Math.max(1000,Math.min(10000,Number(options.recoveryBudgetMs||DEFAULT_RECOVERY_BUDGET_MS)));
  const deadlineAt=Date.now()+budgetMs;
  const label=String(options.label||'CE-confirm');
  console.warn('[CE-QC][V349_CONFIRM_PARTIAL]',JSON.stringify({label,requested:requested.length,returned:rowsByCode.size,missing:missing.length,recoveryBudgetMs:budgetMs}));

  let previousWidth=0;
  outer: for(const configured of FALLBACK_SIZES){
    if(!missing.length)break;
    const width=Math.min(configured,missing.length);
    if(width===previousWidth)continue;
    previousWidth=width;
    const round=[...missing];
    for(const child of chunks(round,width)){
      if(Date.now()>=deadlineAt)break outer;
      try{
        const rows=await withDeadline(()=>rawConfirm(child),deadlineAt);
        appendRows(rowsByCode,output,rows,new Set(child));
      }catch(error){
        if(isAuthError(error))throw error;
      }
    }
    missing=requested.filter(code=>!rowsByCode.has(code));
  }

  // A successful confirm endpoint that has no row for a waybill is not a transport
  // failure. Preserve that distinction explicitly: canonical scan analysis treats
  // blank orderStatus as no-scan evidence and continues trajectory lookup.
  for(const code of missing){
    output.push({
      shipmentCode:code,
      orderStatus:'',
      ceQcSyntheticNoScanEvidence:true,
      confirmQueryEvidence:'NO_RECORD_AFTER_PARTIAL_RECOVERY',
      confirmQueryRecoveryOwner:V349_CONFIRM_COMPLETENESS_ID
    });
  }
  console.warn('[CE-QC][V349_CONFIRM_PARTIAL_DONE]',JSON.stringify({label,requested:requested.length,recovered:requested.length-missing.length,explicitNoRecord:missing.length}));
  return output;
}

export function installCeClientConfirmCompleteness(){
  const prototype=CEClient?.prototype;
  const current=prototype?.confirmQuery;
  if(typeof current!=='function')return false;
  if(current[CECLIENT_PATCH])return true;
  const rawConfirm=current;
  const patched=async function v349CompleteConfirmQuery(shipmentCodes){
    return recoverPartialConfirmResponse(codes=>rawConfirm.call(this,codes),shipmentCodes,{label:'CEClient-confirm-completeness'});
  };
  Object.defineProperty(patched,CECLIENT_PATCH,{value:true});
  prototype.confirmQuery=patched;
  return true;
}

export function createConfirmCompletenessClient(client,options={}){
  if(!client||typeof client!=='object'||typeof client.confirmQuery!=='function')return client;
  // Real CEClient instances already inherit the once-installed prototype owner.
  // Synthetic/test clients and compatible alternate clients still receive the same
  // behavior through this proxy, without double-querying patched CEClient objects.
  if(client.confirmQuery[CECLIENT_PATCH])return client;
  const rawConfirm=client.confirmQuery.bind(client);
  return new Proxy(client,{
    get(target,prop){
      if(prop==='confirmQuery')return codes=>recoverPartialConfirmResponse(rawConfirm,codes,options);
      if(prop==='__v349ConfirmCompleteness')return {id:V349_CONFIRM_COMPLETENESS_ID,recoveryBudgetMs:Number(options.recoveryBudgetMs||DEFAULT_RECOVERY_BUDGET_MS)};
      const value=Reflect.get(target,prop,target);
      return typeof value==='function'?value.bind(target):value;
    }
  });
}

const ceClientInstalled=installCeClientConfirmCompleteness();
console.info('[CE-QC][V349_CONFIRM_COMPLETENESS]',JSON.stringify({id:V349_CONFIRM_COMPLETENESS_ID,fallbackSizes:FALLBACK_SIZES,recoveryBudgetMs:DEFAULT_RECOVERY_BUDGET_MS,ceClientBoundaryInstalled:ceClientInstalled,successfulPartialResponse:'RECOVER_MISSING_THEN_EXPLICIT_NO_SCAN_EVIDENCE',trueRequestFailure:'V345_RETRY_CENTER',scope:'CCSL+SHOPEE+WHPP+RETRY_CENTER'}));
