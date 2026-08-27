import express from 'express';
export const V295_FIRST_ATTEMPT_INVALIDATION_ID='2026-08-27-v334-history-aware-cache-invalidation-v3';
const previousMethods={post:express.application.post,put:express.application.put,patch:express.application.patch,delete:express.application.delete};
const FIRST_ATTEMPT_MUTATION_RE=/(?:import|purge|clear|reset|run|resume|refresh|reupload|delete|remove)/i;
const HISTORY_MEMBERSHIP_RE=/(?:import|purge|clear|reset|reupload|delete|remove)/i;
const HISTORY_FACT_RE=/(?:run|resume|refresh)/i;
const doneStatus=value=>/^(?:completed|finished|done)$/i.test(String(value||'').trim());
function shouldInvalidateHistory(path,payload){
  if(HISTORY_MEMBERSHIP_RE.test(path))return true;
  if(!HISTORY_FACT_RE.test(path))return false;
  return payload?.complete===true||doneStatus(payload?.status)||doneStatus(payload?.runStatus)||doneStatus(payload?.snapshotStatus)||doneStatus(payload?.processing?.status);
}
function invalidateHistory(path,payload){
  if(!shouldInvalidateHistory(path,payload))return;
  const reason=HISTORY_MEMBERSHIP_RE.test(path)?`MEMBERSHIP_MUTATION:${path}`:`COMPLETED_FACT_MUTATION:${path}`;
  try{globalThis.__CE_QC_INVALIDATE_V329_THREE_BUSINESS_HISTORY__?.(reason);}catch(error){console.warn('[CE-QC][V334_INVALIDATE_V329]',error?.message||error);}
  try{globalThis.__CE_QC_INVALIDATE_V334_GENERIC_HISTORY__?.(reason);}catch(error){console.warn('[CE-QC][V334_INVALIDATE_GENERIC]',error?.message||error);}
}
function hookFor(path){return function v334MutationHook(req,res,next){
  const originalJson=res.json.bind(res);let done=false;
  res.json=function v334MutationJson(payload){
    const success=res.statusCode<400&&payload?.ok!==false,out=originalJson(payload);
    if(success&&!done){done=true;try{globalThis.__CE_QC_INVALIDATE_V295_FIRST_ATTEMPT__?.();}catch{}invalidateHistory(path,payload);}
    return out;
  };
  next();
};}
function wrapMethod(methodName){const previous=previousMethods[methodName];if(typeof previous!=='function')return;express.application[methodName]=function v334MutationRegistration(pathValue,...handlers){const path=String(pathValue||'');if(FIRST_ATTEMPT_MUTATION_RE.test(path)&&handlers.length)return previous.call(this,pathValue,hookFor(path),...handlers);return previous.call(this,pathValue,...handlers);};}
for(const method of ['post','put','patch','delete'])wrapMethod(method);
console.info('[CE-QC][V334_HISTORY_INVALIDATION]',V295_FIRST_ATTEMPT_INVALIDATION_ID,'POST/PUT/PATCH/DELETE fact-changing operations invalidate V295; saved-history V329/V334 caches invalidate only on membership changes or confirmed completed run/resume/refresh, preventing both stale history and rebuild contention.');