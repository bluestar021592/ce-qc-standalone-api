import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { V328_ATTEMPT_TYPES, clearV328ThreeBusinessHistoryCache } from './v328ThreeBusinessHistoryFast.js';

export const V328_EVIDENCE_COORDINATOR_ID='2026-08-27-v334-three-business-history-coordinator-v2';
const TYPE_SET=new Set(V328_ATTEMPT_TYPES);
const states=new Map(V328_ATTEMPT_TYPES.map(type=>[type,{businessType:type,status:'IDLE',phase:'WAITING',toDate:'',total:0,completed:0,queried:0,failed:0,known:0,unresolved:0,signingKnown:0,signingUnresolved:0,cacheReady:false,cacheBlocked:false,cacheVersion:0,message:'',updatedAt:'',completedAt:''}]));
const queue=new Map();let child=null,currentType='',generation=0,childGeneration=0;
const workerPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/v329-three-business-cache-worker.mjs');
const now=()=>new Date().toISOString();
function patch(type,value={}){const old=states.get(type)||{businessType:type};states.set(type,{...old,...value,businessType:type,updatedAt:now()});return states.get(type);}
function tableExists(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function clearSmallCaches(type=''){
  try{
    const db=getDb(),target=String(type||'').toUpperCase(),all=!TYPE_SET.has(target);
    if(tableExists(db,'v329_three_business_daily_cache')){if(all)db.exec('DELETE FROM v329_three_business_daily_cache');else db.prepare('DELETE FROM v329_three_business_daily_cache WHERE businessType=?').run(target);}
    if(tableExists(db,'v328_attempt_daily_cache')){if(all)db.exec('DELETE FROM v328_attempt_daily_cache');else db.prepare('DELETE FROM v328_attempt_daily_cache WHERE businessType=?').run(target);}
    clearV328ThreeBusinessHistoryCache();
  }catch(error){console.warn('[CE-QC][V334_THREE_HISTORY_INVALIDATE]',type,error?.message||error);}
}
function spawnNext(){
  if(child||!queue.size)return;
  const [type,toDate]=queue.entries().next().value;queue.delete(type);currentType=type;childGeneration=generation;
  patch(type,{status:'STARTING',phase:'STARTING',toDate,cacheReady:false,cacheVersion:0,message:'启动独立历史缓存/派次签收校准'});
  child=fork(workerPath,[`--type=${type}`,`--to=${toDate}`],{env:{...process.env,CE_QC_V329_CHILD:'1'},stdio:['ignore','ignore','ignore','ipc']});
  child.on('message',message=>{
    if(message?.kind!=='V328_EVIDENCE_PROGRESS'||childGeneration!==generation)return;
    const status=String(message.status||'RUNNING').toUpperCase();
    patch(type,{...message,status,cacheBlocked:message.cacheReady?false:states.get(type)?.cacheBlocked,completedAt:status==='COMPLETED'?now():states.get(type)?.completedAt||''});
    if(message.cacheReady){try{clearV328ThreeBusinessHistoryCache();}catch{}}
  });
  child.on('error',error=>{if(childGeneration===generation)patch(type,{status:'FAILED',phase:'FAILED',message:error?.message||String(error)});});
  child.on('exit',code=>{
    const stale=childGeneration!==generation,state=states.get(type)||{},queuedAgain=queue.has(type);
    if(stale){
      clearSmallCaches(type);
      patch(type,{status:queuedAgain?'QUEUED':'IDLE',phase:queuedAgain?'QUEUED':'STALE_AFTER_MUTATION',cacheReady:false,cacheBlocked:true,cacheVersion:0,completedAt:'',message:queuedAgain?'历史成员已变化，等待新一轮独立缓存':'历史成员已变化，旧worker结果已丢弃；下次读取将重新建立缓存'});
    }else if(['STARTING','RUNNING','QUEUED'].includes(String(state.status||'').toUpperCase())){
      patch(type,{status:code===0?'COMPLETED':'FAILED',phase:code===0?'DONE':'FAILED',cacheReady:code===0||Boolean(state.cacheReady),cacheBlocked:code===0?false:Boolean(state.cacheBlocked),message:code===0?(state.message||'后台校准完成'):`后台校准子进程退出 code=${code}`});
    }
    child=null;currentType='';setTimeout(spawnNext,500).unref?.();
  });
}
export function invalidateV328EvidenceRepair(reason='HISTORY_MEMBERSHIP_MUTATION'){
  generation+=1;queue.clear();clearSmallCaches();
  for(const type of TYPE_SET)patch(type,{status:'IDLE',phase:'INVALIDATED',toDate:'',cacheReady:false,cacheBlocked:true,cacheVersion:0,completedAt:'',message:`历史缓存已失效：${reason}`});
  if(child){try{child.kill();}catch{}}
  return{ok:true,id:V328_EVIDENCE_COORDINATOR_ID,generation,reason};
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
console.info('[CE-QC][V334_THREE_HISTORY_COORDINATOR]',V328_EVIDENCE_COORDINATOR_ID,'TBKH/CN/VN history cache is invalidated on membership mutations; stale child results are killed/cleared and cannot become authoritative.');