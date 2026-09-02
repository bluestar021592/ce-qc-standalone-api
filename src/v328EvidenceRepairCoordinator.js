import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { V328_ATTEMPT_TYPES, clearV328ThreeBusinessHistoryCache } from './v328ThreeBusinessHistoryFast.js';

export const V328_EVIDENCE_COORDINATOR_ID='2026-09-02-v328-date-scoped-history-invalidation-v1';
const TYPE_SET=new Set(V328_ATTEMPT_TYPES);
const WORKER_TIMEOUT_MS=120_000;
const states=new Map(V328_ATTEMPT_TYPES.map(type=>[type,{businessType:type,status:'IDLE',phase:'WAITING',toDate:'',total:0,completed:0,queried:0,failed:0,known:0,unresolved:0,signingKnown:0,signingUnresolved:0,cacheReady:false,cacheBlocked:false,cacheVersion:0,message:'',updatedAt:'',completedAt:'',startedAt:'',durationMs:0}]));
const queue=new Map();let child=null,currentType='',generation=0,childGeneration=0,workerTimer=null,workerStartedAt=0;
const staleCleanupByGeneration=new Map();
const workerPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/v329-three-business-cache-worker.mjs');
const now=()=>new Date().toISOString();
const date=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function patch(type,value={}){const old=states.get(type)||{businessType:type};states.set(type,{...old,...value,businessType:type,updatedAt:now()});return states.get(type);}
function tableExists(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function clearSmallCaches(type='',reportDate=''){
  try{
    const db=getDb(),target=String(type||'').toUpperCase(),all=!TYPE_SET.has(target),d=date(reportDate);
    if(tableExists(db,'v329_three_business_daily_cache')){
      if(d&&all)db.prepare('DELETE FROM v329_three_business_daily_cache WHERE reportDate=?').run(d);
      else if(d)db.prepare('DELETE FROM v329_three_business_daily_cache WHERE businessType=? AND reportDate=?').run(target,d);
      else if(all)db.exec('DELETE FROM v329_three_business_daily_cache');
      else db.prepare('DELETE FROM v329_three_business_daily_cache WHERE businessType=?').run(target);
    }
    if(tableExists(db,'v328_attempt_daily_cache')){
      if(d&&all)db.prepare('DELETE FROM v328_attempt_daily_cache WHERE reportDate=?').run(d);
      else if(d)db.prepare('DELETE FROM v328_attempt_daily_cache WHERE businessType=? AND reportDate=?').run(target,d);
      else if(all)db.exec('DELETE FROM v328_attempt_daily_cache');
      else db.prepare('DELETE FROM v328_attempt_daily_cache WHERE businessType=?').run(target);
    }
    clearV328ThreeBusinessHistoryCache();
  }catch(error){console.warn('[CE-QC][V335_THREE_HISTORY_INVALIDATE]',type,reportDate,error?.message||error);}
}
function clearTimer(){if(workerTimer){clearTimeout(workerTimer);workerTimer=null;}}
function spawnNext(){
  if(child||!queue.size)return;
  const [type,toDate]=queue.entries().next().value;queue.delete(type);currentType=type;childGeneration=generation;workerStartedAt=Date.now();
  patch(type,{status:'STARTING',phase:'STARTING',toDate,cacheReady:false,cacheVersion:0,message:'启动独立历史缓存/派次签收校准',startedAt:now(),durationMs:0});
  console.info('[CE-QC][V335_THREE_HISTORY_WORKER_START]',JSON.stringify({type,toDate,generation}));
  const running=fork(workerPath,[`--type=${type}`,`--to=${toDate}`],{env:{...process.env,CE_QC_V329_CHILD:'1'},stdio:['ignore','ignore','ignore','ipc']});child=running;
  workerTimer=setTimeout(()=>{if(child!==running)return;const durationMs=Date.now()-workerStartedAt;patch(type,{status:'FAILED',phase:'TIMEOUT',cacheReady:false,message:`历史缓存worker超过${WORKER_TIMEOUT_MS/1000}秒，已终止并允许重试`,durationMs});console.warn('[CE-QC][V335_THREE_HISTORY_WORKER_TIMEOUT]',JSON.stringify({type,toDate,durationMs,generation}));try{running.kill();}catch{}},WORKER_TIMEOUT_MS);workerTimer.unref?.();
  running.on('message',message=>{
    if(message?.kind!=='V328_EVIDENCE_PROGRESS'||childGeneration!==generation)return;
    const status=String(message.status||'RUNNING').toUpperCase(),durationMs=Date.now()-workerStartedAt;
    patch(type,{...message,status,cacheBlocked:message.cacheReady?false:states.get(type)?.cacheBlocked,completedAt:status==='COMPLETED'?now():states.get(type)?.completedAt||'',durationMs});
    if(message.cacheReady){try{clearV328ThreeBusinessHistoryCache();}catch{}}
    if(status==='COMPLETED')console.info('[CE-QC][V335_THREE_HISTORY_WORKER_DONE]',JSON.stringify({type,toDate,durationMs,rows:message.rowCount??message.total??0}));
  });
  running.on('error',error=>{if(childGeneration===generation){const durationMs=Date.now()-workerStartedAt;patch(type,{status:'FAILED',phase:'FAILED',message:error?.message||String(error),durationMs});console.warn('[CE-QC][V335_THREE_HISTORY_WORKER_FAILED]',JSON.stringify({type,toDate,durationMs,error:error?.message||String(error)}));}});
  running.on('exit',code=>{
    clearTimer();const durationMs=Date.now()-workerStartedAt,stale=childGeneration!==generation,state=states.get(type)||{},queuedAgain=queue.has(type);
    if(stale){const cleanupDate=staleCleanupByGeneration.get(childGeneration)||'';clearSmallCaches(type,cleanupDate);staleCleanupByGeneration.delete(childGeneration);patch(type,{status:queuedAgain?'QUEUED':'IDLE',phase:queuedAgain?'QUEUED':'STALE_AFTER_MUTATION',cacheReady:false,cacheBlocked:!cleanupDate,cacheVersion:0,completedAt:'',message:queuedAgain?'历史成员已变化，等待新一轮独立缓存':cleanupDate?`${cleanupDate}缓存已失效；其他已完成日期继续直接读取`:'历史成员已变化，旧worker结果已丢弃；下次读取将重新建立缓存',durationMs});}
    else if(['STARTING','RUNNING','QUEUED'].includes(String(state.status||'').toUpperCase()))patch(type,{status:code===0?'COMPLETED':'FAILED',phase:code===0?'DONE':'FAILED',cacheReady:code===0||Boolean(state.cacheReady),cacheBlocked:code===0?false:Boolean(state.cacheBlocked),message:code===0?(state.message||'后台校准完成'):`后台校准子进程退出 code=${code}`,durationMs});
    if(code!==0&&String(states.get(type)?.phase||'')!=='TIMEOUT')console.warn('[CE-QC][V335_THREE_HISTORY_WORKER_EXIT]',JSON.stringify({type,toDate,code,durationMs,status:states.get(type)?.status}));
    child=null;currentType='';workerStartedAt=0;setTimeout(spawnNext,500).unref?.();
  });
}
export function invalidateV328EvidenceRepair(reason='HISTORY_MEMBERSHIP_MUTATION',reportDate=''){
  const d=date(reportDate),oldGeneration=generation;staleCleanupByGeneration.set(oldGeneration,d);generation+=1;queue.clear();clearSmallCaches('',d);
  for(const type of TYPE_SET)patch(type,{status:'IDLE',phase:d?'DATE_INVALIDATED':'INVALIDATED',toDate:'',cacheReady:false,cacheBlocked:!d,cacheVersion:0,completedAt:'',message:d?`${d}历史缓存已失效；其他完成日期保留：${reason}`:`历史缓存已失效：${reason}`});
  if(child){try{child.kill();}catch{}}else staleCleanupByGeneration.delete(oldGeneration);clearTimer();
  return{ok:true,id:V328_EVIDENCE_COORDINATOR_ID,generation,reason,reportDate:d,scope:d?'REPORT_DATE_ONLY':'ALL_HISTORY'};
}
export function requestV328EvidenceRepair(businessType='',toDate=''){
  const type=String(businessType||'').toUpperCase(),to=String(toDate||'').slice(0,10);
  if(!TYPE_SET.has(type)||!/\d{4}-\d{2}-\d{2}/.test(to))return inspectV328EvidenceRepair(type);
  const state=states.get(type)||{},status=String(state.status||'').toUpperCase();
  if(['STARTING','RUNNING','QUEUED'].includes(status)&&state.toDate===to)return state;
  if(status==='COMPLETED'&&state.toDate===to){const age=Date.now()-Date.parse(state.completedAt||state.updatedAt||0),complete=Number(state.unresolved||0)===0&&Number(state.signingUnresolved||0)===0&&Number(state.failed||0)===0,ttl=complete?4*60*60*1000:15*60*1000;if(age<ttl)return state;}
  queue.set(type,to);patch(type,{status:'QUEUED',phase:'QUEUED',toDate:to,cacheReady:Boolean(state.cacheReady&&state.toDate===to),cacheBlocked:Boolean(state.cacheBlocked),message:child?`等待 ${currentType} 后台校准完成`:'等待独立历史缓存启动'});setImmediate(spawnNext);return states.get(type);
}
export function inspectV328EvidenceRepair(businessType=''){const type=String(businessType||'').toUpperCase();if(TYPE_SET.has(type))return{id:V328_EVIDENCE_COORDINATOR_ID,generation,...states.get(type)};return{id:V328_EVIDENCE_COORDINATOR_ID,generation,runningType:currentType,queue:[...queue.keys()],types:Object.fromEntries([...states.entries()])};}
globalThis.__CE_QC_INVALIDATE_V329_THREE_BUSINESS_HISTORY__=invalidateV328EvidenceRepair;
console.info('[CE-QC][V328_THREE_HISTORY_COORDINATOR]',V328_EVIDENCE_COORDINATOR_ID,'daily imports invalidate only the affected reportDate in V329/V328 compact caches; completed historical dates remain persisted and readable; full purge/reset still clears all history; workers remain isolated and bounded to 120s.');
