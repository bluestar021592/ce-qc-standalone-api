import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { V334_GENERIC_HISTORY_TYPES } from './v334GenericHistoryCache.js';

export const V334_GENERIC_HISTORY_COORDINATOR_ID='2026-08-27-v334-generic-history-coordinator-v3';
const TYPES=new Set(V334_GENERIC_HISTORY_TYPES);
const states=new Map(V334_GENERIC_HISTORY_TYPES.map(type=>[type,{businessType:type,status:'IDLE',phase:'WAITING',toDate:'',cacheReady:false,cacheBlocked:false,rowCount:0,message:'',updatedAt:'',completedAt:''}]));
const queue=new Map();let child=null,currentType='',generation=0,childGeneration=0;
const workerPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/v334-generic-history-cache-worker.mjs');
const now=()=>new Date().toISOString();
function patch(type,value={}){const old=states.get(type)||{businessType:type};const next={...old,...value,businessType:type,updatedAt:now()};states.set(type,next);return next;}
function clearSmallCache(type=''){
  try{const db=getDb(),exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='v334_generic_history_cache' LIMIT 1").get();if(!exists)return;const target=String(type||'').toUpperCase();if(TYPES.has(target))db.prepare('DELETE FROM v334_generic_history_cache WHERE businessType=?').run(target);else db.exec('DELETE FROM v334_generic_history_cache');}
  catch(error){console.warn('[CE-QC][V334_GENERIC_HISTORY_INVALIDATE]',type,error?.message||error);}
}
function spawnNext(){
  if(child||!queue.size)return;
  const [type,toDate]=queue.entries().next().value;queue.delete(type);currentType=type;childGeneration=generation;
  patch(type,{status:'STARTING',phase:'STARTING',toDate,message:'启动独立通用历史趋势缓存'});
  child=fork(workerPath,[`--type=${type}`,`--to=${toDate}`],{env:{...process.env,CE_QC_V334_GENERIC_HISTORY_CHILD:'1'},stdio:['ignore','ignore','ignore','ipc']});
  child.on('message',message=>{if(message?.kind!=='V334_GENERIC_HISTORY_PROGRESS'||childGeneration!==generation)return;const status=String(message.status||'RUNNING').toUpperCase();patch(type,{...message,status,cacheBlocked:message.cacheReady?false:states.get(type)?.cacheBlocked,completedAt:status==='COMPLETED'?now():states.get(type)?.completedAt||''});});
  child.on('error',error=>{if(childGeneration===generation)patch(type,{status:'FAILED',phase:'FAILED',message:error?.message||String(error)});});
  child.on('exit',code=>{
    const stale=childGeneration!==generation,state=states.get(type)||{},queuedAgain=queue.has(type);
    if(stale){
      clearSmallCache(type);
      patch(type,{status:queuedAgain?'QUEUED':'IDLE',phase:queuedAgain?'QUEUED':'STALE_AFTER_MUTATION',cacheReady:false,cacheBlocked:true,rowCount:0,completedAt:'',message:queuedAgain?'历史成员已变化，等待新一轮独立缓存':'历史成员已变化，旧worker结果已丢弃；下次读取将重新建立缓存'});
    }else if(['STARTING','RUNNING','QUEUED'].includes(String(state.status||'').toUpperCase())){
      patch(type,{status:code===0?'COMPLETED':'FAILED',phase:code===0?'DONE':'FAILED',cacheReady:code===0||Boolean(state.cacheReady),cacheBlocked:code===0?false:Boolean(state.cacheBlocked),message:code===0?(state.message||'通用历史缓存完成'):`通用历史缓存子进程退出 code=${code}`});
    }
    child=null;currentType='';setTimeout(spawnNext,250).unref?.();
  });
}
export function invalidateV334GenericHistory(reason='HISTORY_MEMBERSHIP_MUTATION'){
  generation+=1;queue.clear();clearSmallCache();
  for(const type of TYPES)patch(type,{status:'IDLE',phase:'INVALIDATED',toDate:'',cacheReady:false,cacheBlocked:true,rowCount:0,completedAt:'',message:`历史缓存已失效：${reason}`});
  if(child){try{child.kill();}catch{}}
  return{ok:true,id:V334_GENERIC_HISTORY_COORDINATOR_ID,generation,reason};
}
export function requestV334GenericHistoryBuild(businessType='',toDate=''){
  const type=String(businessType||'').toUpperCase(),to=String(toDate||'').slice(0,10);if(!TYPES.has(type)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return inspectV334GenericHistoryBuild(type);
  const state=states.get(type)||{},status=String(state.status||'').toUpperCase();
  if(['QUEUED','STARTING','RUNNING'].includes(status)&&state.toDate===to)return state;
  if(status==='COMPLETED'&&state.toDate===to){const age=Date.now()-Date.parse(state.completedAt||state.updatedAt||0);if(Number.isFinite(age)&&age<30*60*1000)return state;}
  queue.set(type,to);patch(type,{status:'QUEUED',phase:'QUEUED',toDate:to,cacheReady:Boolean(state.cacheReady&&state.toDate===to),cacheBlocked:Boolean(state.cacheBlocked),message:child?`等待 ${currentType} 历史缓存完成`:'等待独立历史缓存启动'});setImmediate(spawnNext);return states.get(type);
}
export function inspectV334GenericHistoryBuild(businessType=''){const type=String(businessType||'').toUpperCase();if(TYPES.has(type))return{id:V334_GENERIC_HISTORY_COORDINATOR_ID,generation,...states.get(type)};return{id:V334_GENERIC_HISTORY_COORDINATOR_ID,generation,runningType:currentType,queue:[...queue.keys()],types:Object.fromEntries([...states.entries()])};}
globalThis.__CE_QC_INVALIDATE_V334_GENERIC_HISTORY__=invalidateV334GenericHistory;
console.info('[CE-QC][V334_GENERIC_HISTORY_COORDINATOR]',V334_GENERIC_HISTORY_COORDINATOR_ID,'CE/CEAF/ALI1688/WHPP/ALL reconstruction is isolated; import/purge/clear/reset mutations block and clear stale cache, and stale child results cannot become authoritative.');