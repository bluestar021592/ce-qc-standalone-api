import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { V334_GENERIC_HISTORY_TYPES } from './v334GenericHistoryCache.js';

export const V334_GENERIC_HISTORY_COORDINATOR_ID='2026-08-27-v335-generic-history-observable-v1';
const TYPES=new Set(V334_GENERIC_HISTORY_TYPES);
const WORKER_TIMEOUT_MS=120_000;
const states=new Map(V334_GENERIC_HISTORY_TYPES.map(type=>[type,{businessType:type,status:'IDLE',phase:'WAITING',toDate:'',cacheReady:false,cacheBlocked:false,rowCount:0,message:'',updatedAt:'',completedAt:'',startedAt:'',durationMs:0}]));
const queue=new Map();let child=null,currentType='',generation=0,childGeneration=0,workerTimer=null,workerStartedAt=0;
const workerPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/v334-generic-history-cache-worker.mjs');
const now=()=>new Date().toISOString();
function patch(type,value={}){const old=states.get(type)||{businessType:type};const next={...old,...value,businessType:type,updatedAt:now()};states.set(type,next);return next;}
function clearSmallCache(type=''){
  try{const db=getDb(),exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='v334_generic_history_cache' LIMIT 1").get();if(!exists)return;const target=String(type||'').toUpperCase();if(TYPES.has(target))db.prepare('DELETE FROM v334_generic_history_cache WHERE businessType=?').run(target);else db.exec('DELETE FROM v334_generic_history_cache');}
  catch(error){console.warn('[CE-QC][V335_GENERIC_HISTORY_INVALIDATE]',type,error?.message||error);}
}
function clearTimer(){if(workerTimer){clearTimeout(workerTimer);workerTimer=null;}}
function spawnNext(){
  if(child||!queue.size)return;
  const [type,toDate]=queue.entries().next().value;queue.delete(type);currentType=type;childGeneration=generation;workerStartedAt=Date.now();
  patch(type,{status:'STARTING',phase:'STARTING',toDate,message:'启动独立通用历史趋势缓存',startedAt:now(),durationMs:0});
  console.info('[CE-QC][V335_GENERIC_HISTORY_WORKER_START]',JSON.stringify({type,toDate,generation}));
  const running=fork(workerPath,[`--type=${type}`,`--to=${toDate}`],{env:{...process.env,CE_QC_V334_GENERIC_HISTORY_CHILD:'1'},stdio:['ignore','ignore','ignore','ipc']});child=running;
  workerTimer=setTimeout(()=>{if(child!==running)return;const durationMs=Date.now()-workerStartedAt;patch(type,{status:'FAILED',phase:'TIMEOUT',cacheReady:false,message:`通用历史worker超过${WORKER_TIMEOUT_MS/1000}秒，已终止并允许重试`,durationMs});console.warn('[CE-QC][V335_GENERIC_HISTORY_WORKER_TIMEOUT]',JSON.stringify({type,toDate,durationMs,generation}));try{running.kill();}catch{}},WORKER_TIMEOUT_MS);workerTimer.unref?.();
  running.on('message',message=>{if(message?.kind!=='V334_GENERIC_HISTORY_PROGRESS'||childGeneration!==generation)return;const status=String(message.status||'RUNNING').toUpperCase(),durationMs=Date.now()-workerStartedAt;patch(type,{...message,status,cacheBlocked:message.cacheReady?false:states.get(type)?.cacheBlocked,completedAt:status==='COMPLETED'?now():states.get(type)?.completedAt||'',durationMs});if(status==='COMPLETED')console.info('[CE-QC][V335_GENERIC_HISTORY_WORKER_DONE]',JSON.stringify({type,toDate,durationMs,rowCount:message.rowCount||0}));});
  running.on('error',error=>{if(childGeneration===generation){const durationMs=Date.now()-workerStartedAt;patch(type,{status:'FAILED',phase:'FAILED',message:error?.message||String(error),durationMs});console.warn('[CE-QC][V335_GENERIC_HISTORY_WORKER_FAILED]',JSON.stringify({type,toDate,durationMs,error:error?.message||String(error)}));}});
  running.on('exit',code=>{
    clearTimer();const durationMs=Date.now()-workerStartedAt,stale=childGeneration!==generation,state=states.get(type)||{},queuedAgain=queue.has(type);
    if(stale){clearSmallCache(type);patch(type,{status:queuedAgain?'QUEUED':'IDLE',phase:queuedAgain?'QUEUED':'STALE_AFTER_MUTATION',cacheReady:false,cacheBlocked:true,rowCount:0,completedAt:'',message:queuedAgain?'历史成员已变化，等待新一轮独立缓存':'历史成员已变化，旧worker结果已丢弃；下次读取将重新建立缓存',durationMs});}
    else if(['STARTING','RUNNING','QUEUED'].includes(String(state.status||'').toUpperCase()))patch(type,{status:code===0?'COMPLETED':'FAILED',phase:code===0?'DONE':'FAILED',cacheReady:code===0||Boolean(state.cacheReady),cacheBlocked:code===0?false:Boolean(state.cacheBlocked),message:code===0?(state.message||'通用历史缓存完成'):`通用历史缓存子进程退出 code=${code}`,durationMs});
    if(code!==0&&String(states.get(type)?.phase||'')!=='TIMEOUT')console.warn('[CE-QC][V335_GENERIC_HISTORY_WORKER_EXIT]',JSON.stringify({type,toDate,code,durationMs,status:states.get(type)?.status}));
    child=null;currentType='';workerStartedAt=0;setTimeout(spawnNext,250).unref?.();
  });
}
export function invalidateV334GenericHistory(reason='HISTORY_MEMBERSHIP_MUTATION'){
  generation+=1;queue.clear();clearSmallCache();
  for(const type of TYPES)patch(type,{status:'IDLE',phase:'INVALIDATED',toDate:'',cacheReady:false,cacheBlocked:true,rowCount:0,completedAt:'',message:`历史缓存已失效：${reason}`});
  if(child){try{child.kill();}catch{}}clearTimer();
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
console.info('[CE-QC][V335_GENERIC_HISTORY_COORDINATOR]',V334_GENERIC_HISTORY_COORDINATOR_ID,'CE/CEAF/ALI1688/WHPP/ALL history workers are observable and bounded to 120s; stale children cannot republish old history and failed workers can be retried.');