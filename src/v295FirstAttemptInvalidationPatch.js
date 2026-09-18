import express from 'express';
import { invalidateV328EvidenceRepair, invalidateV334GenericHistory, requestV328EvidenceRepair, requestV334GenericHistoryBuild } from './historyCacheCoordinators.js';

export const V295_FIRST_ATTEMPT_INVALIDATION_ID='2026-09-18-post-write-history-rebuild-owner-v2';
const previousMethods={post:express.application.post,put:express.application.put,patch:express.application.patch,delete:express.application.delete};
const FIRST_ATTEMPT_MUTATION_RE=/(?:import|purge|clear|reset|run|resume|refresh|reupload|delete|remove)/i;
const HISTORY_MEMBERSHIP_RE=/(?:import|purge|clear|reset|reupload|delete|remove)/i;
const HISTORY_FACT_RE=/(?:run|resume|refresh)/i;
const FULL_HISTORY_RESET_RE=/(?:purge|clear|reset|delete|remove)/i;
const doneStatus=value=>/^(?:completed|finished|done)$/i.test(String(value||'').trim());
const rebuildTimers=new Map();
const THREE_HISTORY_TYPES=['TBKH','SHOPEECN','SHOPEEVN'];
const GENERIC_HISTORY_TYPES=['CE','CEAF','ALI1688','WHPP','ALL'];
function schedulePostWriteHistoryRebuild(reportDate=''){
  const d=String(reportDate||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return;
  const old=rebuildTimers.get(d);if(old)clearTimeout(old);
  const timer=setTimeout(()=>{
    rebuildTimers.delete(d);
    for(const type of THREE_HISTORY_TYPES){try{requestV328EvidenceRepair(type,d,{reason:'POST_WRITE_BACKGROUND_REBUILD'});}catch(error){console.warn('[CE-QC][POST_WRITE_V329_REBUILD]',type,d,error?.message||error);}}
    for(const type of GENERIC_HISTORY_TYPES){try{requestV334GenericHistoryBuild(type,d,{reason:'POST_WRITE_BACKGROUND_REBUILD'});}catch(error){console.warn('[CE-QC][POST_WRITE_V334_REBUILD]',type,d,error?.message||error);}}
    console.info('[CE-QC][POST_WRITE_HISTORY_REBUILD_QUEUED]',JSON.stringify({reportDate:d,threeBusiness:THREE_HISTORY_TYPES,generic:GENERIC_HISTORY_TYPES}));
  },1800);
  timer.unref?.();rebuildTimers.set(d,timer);
}
const reportDateOf=(req,payload)=>{const value=String(payload?.run?.reportDate||payload?.summary?.reportDate||payload?.state?.reportDate||payload?.import?.reportDate||payload?.reportDate||req?.body?.reportDate||req?.body?.date||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:'';};
function shouldInvalidateHistory(path,payload){
  if(HISTORY_MEMBERSHIP_RE.test(path))return true;
  if(!HISTORY_FACT_RE.test(path))return false;
  return payload?.complete===true||doneStatus(payload?.status)||doneStatus(payload?.runStatus)||doneStatus(payload?.snapshotStatus)||doneStatus(payload?.processing?.status);
}
function invalidateHistory(path,payload,req){
  if(!shouldInvalidateHistory(path,payload))return;
  const membership=HISTORY_MEMBERSHIP_RE.test(path),fullReset=FULL_HISTORY_RESET_RE.test(path),reportDate=fullReset?'':reportDateOf(req,payload);
  const reason=membership?`MEMBERSHIP_MUTATION:${path}`:`COMPLETED_FACT_MUTATION:${path}`;
  try{invalidateV328EvidenceRepair(reason,reportDate);}catch(error){console.warn('[CE-QC][V334_INVALIDATE_V329]',error?.message||error);}
  try{invalidateV334GenericHistory(reason,reportDate);}catch(error){console.warn('[CE-QC][V334_INVALIDATE_GENERIC]',error?.message||error);}
  if(reportDate)schedulePostWriteHistoryRebuild(reportDate);
  console.info('[CE-QC][V295_HISTORY_INVALIDATION_SCOPE]',JSON.stringify({path,reason,reportDate:reportDate||'',scope:reportDate?'REPORT_DATE_ONLY':'ALL_HISTORY',backgroundRebuildQueued:Boolean(reportDate)}));
}
function hookFor(path){return function v334MutationHook(req,res,next){
  const originalJson=res.json.bind(res);let done=false;
  res.json=function v334MutationJson(payload){
    const success=res.statusCode<400&&payload?.ok!==false,out=originalJson(payload);
    if(success&&!done){done=true;try{globalThis.__CE_QC_INVALIDATE_V295_FIRST_ATTEMPT__?.();}catch{}invalidateHistory(path,payload,req);}
    return out;
  };
  next();
};}
function wrapMethod(methodName){const previous=previousMethods[methodName];if(typeof previous!=='function')return;express.application[methodName]=function v334MutationRegistration(pathValue,...handlers){const path=String(pathValue||'');if(FIRST_ATTEMPT_MUTATION_RE.test(path)&&handlers.length)return previous.call(this,pathValue,hookFor(path),...handlers);return previous.call(this,pathValue,...handlers);};}
for(const method of ['post','put','patch','delete'])wrapMethod(method);
console.info('[CE-QC][V295_HISTORY_INVALIDATION]',V295_FIRST_ATTEMPT_INVALIDATION_ID,'date-scoped writes invalidate only the changed reportDate then debounce one isolated saved-cache rebuild; browser GETs never start history workers; purge/reset/delete still invalidate all saved history without automatic reconstruction.');
