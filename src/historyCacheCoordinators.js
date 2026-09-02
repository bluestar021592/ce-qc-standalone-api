import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { V328_ATTEMPT_TYPES, clearV328ThreeBusinessHistoryCache } from './v328ThreeBusinessHistoryFast.js';
import { V334_GENERIC_HISTORY_TYPES } from './v334GenericHistoryCache.js';

export const HISTORY_CACHE_COORDINATORS_ID='2026-09-02-unified-history-cache-coordinators-v1';
export const V328_EVIDENCE_COORDINATOR_ID='2026-09-02-v328-date-scoped-history-invalidation-v1';
export const V334_GENERIC_HISTORY_COORDINATOR_ID='2026-09-02-v334-date-scoped-history-invalidation-v1';
const WORKER_TIMEOUT_MS=120_000;
const rootDir=path.dirname(fileURLToPath(import.meta.url));
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const now=()=>new Date().toISOString();
const activeStatus=value=>['QUEUED','STARTING','RUNNING'].includes(String(value||'').toUpperCase());
function tableExists(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function clearScopedTable(db,table,typeSet,type='',reportDate=''){
  if(!tableExists(db,table))return;
  const target=String(type||'').toUpperCase(),d=dateKey(reportDate),all=!typeSet.has(target);
  if(d&&all)db.prepare(`DELETE FROM ${table} WHERE reportDate=?`).run(d);
  else if(d)db.prepare(`DELETE FROM ${table} WHERE businessType=? AND reportDate=?`).run(target,d);
  else if(all)db.exec(`DELETE FROM ${table}`);
  else db.prepare(`DELETE FROM ${table} WHERE businessType=?`).run(target);
}
function clearThreeBusinessCaches(type='',reportDate=''){
  try{
    const db=getDb(),types=new Set(V328_ATTEMPT_TYPES);
    clearScopedTable(db,'v329_three_business_daily_cache',types,type,reportDate);
    clearScopedTable(db,'v328_attempt_daily_cache',types,type,reportDate);
    clearV328ThreeBusinessHistoryCache();
  }catch(error){console.warn('[CE-QC][V335_THREE_HISTORY_INVALIDATE]',type,reportDate,error?.message||error);}
}
function clearGenericCaches(type='',reportDate=''){
  try{clearScopedTable(getDb(),'v334_generic_history_cache',new Set(V334_GENERIC_HISTORY_TYPES),type,reportDate);}
  catch(error){console.warn('[CE-QC][V335_GENERIC_HISTORY_INVALIDATE]',type,reportDate,error?.message||error);}
}

function createCoordinator(config){
  const types=[...new Set(config.types.map(v=>String(v||'').toUpperCase()).filter(Boolean))],typeSet=new Set(types);
  const states=new Map(types.map(type=>[type,{businessType:type,status:'IDLE',phase:'WAITING',toDate:'',cacheReady:false,cacheBlocked:false,message:'',updatedAt:'',completedAt:'',startedAt:'',durationMs:0,...config.initialState}]));
  const queue=new Map(),staleCleanupByGeneration=new Map();
  let child=null,currentType='',generation=0,childGeneration=0,workerTimer=null,workerStartedAt=0;
  const patch=(type,value={})=>{const old=states.get(type)||{businessType:type};const next={...old,...value,businessType:type,updatedAt:now()};states.set(type,next);return next;};
  const clearTimer=()=>{if(workerTimer){clearTimeout(workerTimer);workerTimer=null;}};
  function spawnNext(){
    if(child||!queue.size)return;
    const [type,toDate]=queue.entries().next().value;queue.delete(type);currentType=type;childGeneration=generation;workerStartedAt=Date.now();
    patch(type,{status:'STARTING',phase:'STARTING',toDate,message:config.startMessage(type),startedAt:now(),durationMs:0,...config.startState});
    console.info(config.logs.start,JSON.stringify({type,toDate,generation}));
    const running=fork(config.workerPath,[`--type=${type}`,`--to=${toDate}`],{env:{...process.env,...config.workerEnv},stdio:['ignore','ignore','ignore','ipc']});child=running;
    workerTimer=setTimeout(()=>{
      if(child!==running)return;
      const durationMs=Date.now()-workerStartedAt;
      patch(type,{status:'FAILED',phase:'TIMEOUT',cacheReady:false,message:config.timeoutMessage(WORKER_TIMEOUT_MS),durationMs});
      console.warn(config.logs.timeout,JSON.stringify({type,toDate,durationMs,generation}));
      try{running.kill();}catch{}
    },WORKER_TIMEOUT_MS);workerTimer.unref?.();
    running.on('message',message=>{
      if(message?.kind!==config.progressKind||childGeneration!==generation)return;
      const status=String(message.status||'RUNNING').toUpperCase(),durationMs=Date.now()-workerStartedAt,state=states.get(type)||{};
      patch(type,{...message,status,cacheBlocked:message.cacheReady?false:state.cacheBlocked,completedAt:status==='COMPLETED'?now():state.completedAt||'',durationMs});
      if(message.cacheReady)try{config.onCacheReady?.(type,message);}catch{}
      if(status==='COMPLETED')console.info(config.logs.done,JSON.stringify({type,toDate,durationMs,...config.doneMeta(message)}));
    });
    running.on('error',error=>{
      if(childGeneration!==generation)return;
      const durationMs=Date.now()-workerStartedAt;
      patch(type,{status:'FAILED',phase:'FAILED',message:error?.message||String(error),durationMs});
      console.warn(config.logs.failed,JSON.stringify({type,toDate,durationMs,error:error?.message||String(error)}));
    });
    running.on('exit',code=>{
      clearTimer();
      const durationMs=Date.now()-workerStartedAt,stale=childGeneration!==generation,state=states.get(type)||{},queuedAgain=queue.has(type);
      if(stale){
        const cleanupDate=staleCleanupByGeneration.get(childGeneration)||'';
        config.clearCache(type,cleanupDate);staleCleanupByGeneration.delete(childGeneration);
        patch(type,{status:queuedAgain?'QUEUED':'IDLE',phase:queuedAgain?'QUEUED':'STALE_AFTER_MUTATION',cacheReady:false,cacheBlocked:!cleanupDate,completedAt:'',message:queuedAgain?config.staleQueuedMessage:cleanupDate?config.staleDateMessage(cleanupDate):config.staleAllMessage,durationMs,...config.resetState});
      }else if(activeStatus(state.status)){
        patch(type,{status:code===0?'COMPLETED':'FAILED',phase:code===0?'DONE':'FAILED',cacheReady:code===0||Boolean(state.cacheReady),cacheBlocked:code===0?false:Boolean(state.cacheBlocked),message:code===0?(state.message||config.successMessage):config.failureMessage(code),durationMs});
      }
      if(code!==0&&String(states.get(type)?.phase||'')!=='TIMEOUT')console.warn(config.logs.exit,JSON.stringify({type,toDate,code,durationMs,status:states.get(type)?.status}));
      child=null;currentType='';workerStartedAt=0;setTimeout(spawnNext,config.queueDelayMs).unref?.();
    });
  }
  function invalidate(reason='HISTORY_MEMBERSHIP_MUTATION',reportDate=''){
    const d=dateKey(reportDate),oldGeneration=generation;staleCleanupByGeneration.set(oldGeneration,d);generation+=1;queue.clear();config.clearCache('',d);
    for(const type of typeSet)patch(type,{status:'IDLE',phase:d?'DATE_INVALIDATED':'INVALIDATED',toDate:'',cacheReady:false,cacheBlocked:!d,completedAt:'',message:d?config.invalidateDateMessage(d,reason):config.invalidateAllMessage(reason),...config.resetState});
    if(child){try{child.kill();}catch{}}else staleCleanupByGeneration.delete(oldGeneration);clearTimer();
    return{ok:true,id:config.id,generation,reason,reportDate:d,scope:d?'REPORT_DATE_ONLY':'ALL_HISTORY'};
  }
  function inspect(businessType=''){
    const type=String(businessType||'').toUpperCase();
    if(typeSet.has(type))return{id:config.id,generation,...states.get(type)};
    return{id:config.id,generation,runningType:currentType,queue:[...queue.keys()],types:Object.fromEntries([...states.entries()])};
  }
  function request(businessType='',toDate=''){
    const type=String(businessType||'').toUpperCase(),to=dateKey(toDate);
    if(!typeSet.has(type)||!to)return inspect(type);
    const state=states.get(type)||{},status=String(state.status||'').toUpperCase();
    if(activeStatus(status)&&state.toDate===to)return state;
    if(status==='COMPLETED'&&state.toDate===to){const age=Date.now()-Date.parse(state.completedAt||state.updatedAt||0),ttl=config.completedTtlMs(state);if(Number.isFinite(age)&&ttl>0&&age<ttl)return state;}
    queue.set(type,to);patch(type,{status:'QUEUED',phase:'QUEUED',toDate:to,cacheReady:Boolean(state.cacheReady&&state.toDate===to),cacheBlocked:Boolean(state.cacheBlocked),message:child?config.queueWaitMessage(currentType):config.queueIdleMessage});setImmediate(spawnNext);return states.get(type);
  }
  return{invalidate,inspect,request};
}

const threeCoordinator=createCoordinator({
  id:V328_EVIDENCE_COORDINATOR_ID,
  types:V328_ATTEMPT_TYPES,
  initialState:{total:0,completed:0,queried:0,failed:0,known:0,unresolved:0,signingKnown:0,signingUnresolved:0,cacheVersion:0},
  workerPath:path.resolve(rootDir,'../scripts/v329-three-business-cache-worker.mjs'),workerEnv:{CE_QC_V329_CHILD:'1'},progressKind:'V328_EVIDENCE_PROGRESS',queueDelayMs:500,
  clearCache:clearThreeBusinessCaches,onCacheReady:()=>clearV328ThreeBusinessHistoryCache(),startState:{cacheReady:false,cacheVersion:0},resetState:{cacheVersion:0},
  startMessage:()=> '启动独立历史缓存/派次签收校准',timeoutMessage:ms=>`历史缓存worker超过${ms/1000}秒，已终止并允许重试`,successMessage:'后台校准完成',failureMessage:code=>`后台校准子进程退出 code=${code}`,
  queueWaitMessage:type=>`等待 ${type} 后台校准完成`,queueIdleMessage:'等待独立历史缓存启动',staleQueuedMessage:'历史成员已变化，等待新一轮独立缓存',staleDateMessage:d=>`${d}缓存已失效；其他已完成日期继续直接读取`,staleAllMessage:'历史成员已变化，旧worker结果已丢弃；下次读取将重新建立缓存',invalidateDateMessage:(d,reason)=>`${d}历史缓存已失效；其他完成日期保留：${reason}`,invalidateAllMessage:reason=>`历史缓存已失效：${reason}`,
  completedTtlMs:state=>Number(state.unresolved||0)===0&&Number(state.signingUnresolved||0)===0&&Number(state.failed||0)===0?4*60*60*1000:15*60*1000,
  doneMeta:message=>({rows:message.rowCount??message.total??0}),logs:{start:'[CE-QC][V335_THREE_HISTORY_WORKER_START]',done:'[CE-QC][V335_THREE_HISTORY_WORKER_DONE]',timeout:'[CE-QC][V335_THREE_HISTORY_WORKER_TIMEOUT]',failed:'[CE-QC][V335_THREE_HISTORY_WORKER_FAILED]',exit:'[CE-QC][V335_THREE_HISTORY_WORKER_EXIT]'}
});
const genericCoordinator=createCoordinator({
  id:V334_GENERIC_HISTORY_COORDINATOR_ID,
  types:V334_GENERIC_HISTORY_TYPES,
  initialState:{rowCount:0},
  workerPath:path.resolve(rootDir,'../scripts/v334-generic-history-cache-worker.mjs'),workerEnv:{CE_QC_V334_GENERIC_HISTORY_CHILD:'1'},progressKind:'V334_GENERIC_HISTORY_PROGRESS',queueDelayMs:250,
  clearCache:clearGenericCaches,startState:{},resetState:{rowCount:0},
  startMessage:()=> '启动独立通用历史趋势缓存',timeoutMessage:ms=>`通用历史worker超过${ms/1000}秒，已终止并允许重试`,successMessage:'通用历史缓存完成',failureMessage:code=>`通用历史缓存子进程退出 code=${code}`,
  queueWaitMessage:type=>`等待 ${type} 历史缓存完成`,queueIdleMessage:'等待独立历史缓存启动',staleQueuedMessage:'历史成员已变化，等待新一轮独立缓存',staleDateMessage:d=>`${d}缓存已失效；其他已完成日期继续直接读取`,staleAllMessage:'历史成员已变化，旧worker结果已丢弃；下次读取将重新建立缓存',invalidateDateMessage:(d,reason)=>`${d}历史缓存已失效；其他完成日期保留：${reason}`,invalidateAllMessage:reason=>`历史缓存已失效：${reason}`,
  completedTtlMs:()=>30*60*1000,
  doneMeta:message=>({rowCount:message.rowCount||0}),logs:{start:'[CE-QC][V335_GENERIC_HISTORY_WORKER_START]',done:'[CE-QC][V335_GENERIC_HISTORY_WORKER_DONE]',timeout:'[CE-QC][V335_GENERIC_HISTORY_WORKER_TIMEOUT]',failed:'[CE-QC][V335_GENERIC_HISTORY_WORKER_FAILED]',exit:'[CE-QC][V335_GENERIC_HISTORY_WORKER_EXIT]'}
});

export const invalidateV328EvidenceRepair=(reason='HISTORY_MEMBERSHIP_MUTATION',reportDate='')=>threeCoordinator.invalidate(reason,reportDate);
export const requestV328EvidenceRepair=(businessType='',toDate='')=>threeCoordinator.request(businessType,toDate);
export const inspectV328EvidenceRepair=(businessType='')=>threeCoordinator.inspect(businessType);
export const invalidateV334GenericHistory=(reason='HISTORY_MEMBERSHIP_MUTATION',reportDate='')=>genericCoordinator.invalidate(reason,reportDate);
export const requestV334GenericHistoryBuild=(businessType='',toDate='')=>genericCoordinator.request(businessType,toDate);
export const inspectV334GenericHistoryBuild=(businessType='')=>genericCoordinator.inspect(businessType);

globalThis.__CE_QC_INVALIDATE_V329_THREE_BUSINESS_HISTORY__=invalidateV328EvidenceRepair;
globalThis.__CE_QC_INVALIDATE_V334_GENERIC_HISTORY__=invalidateV334GenericHistory;
console.info('[CE-QC][HISTORY_CACHE_COORDINATORS]',HISTORY_CACHE_COORDINATORS_ID,'V328 + V334 now share one canonical bounded-worker coordinator implementation; persisted history invalidation remains reportDate-scoped for normal daily mutations and full only for purge/reset.');
