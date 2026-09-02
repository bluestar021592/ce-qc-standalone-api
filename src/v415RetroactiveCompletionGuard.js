import express from 'express';
import { getDb, nowIso } from './db.js';
import { readV384CcslProcessingProof, V384_CCSL_PROCESSING_PROOF_ID } from './v384CcslProcessingProof.js';
import { loadWhppState, saveWhppState } from './whppStore.js';
import {
  V418_STATUS_PROOF_FAST_PATH_ID,
  readV418CurrentMembershipCounts,
  readV418CcslProcessingProof,
  readV418BusinessSuccessCoverage
} from './v418StatusProofFastPath.js';

export const V415_RETROACTIVE_COMPLETION_GUARD_ID='2026-09-02-v415-current-member-processing-proof-v1';
export const V415_STALE_COMPLETION_REOPEN_ID='2026-09-02-v415-stale-completion-reopen-v1';
export const V416_FAST_FAILCLOSED_PROOF_ID='2026-09-02-v416-large-db-fast-failclosed-proof-v1';
export const V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID='2026-09-02-v417-membership-anchored-success-proof-v1';
export { V418_STATUS_PROOF_FAST_PATH_ID };
const STATUS_ROUTE='/api/v33/run-progress';
const GUARDED_POST_ROUTES=new Set(['/api/shopee/run/start','/api/shopee/run/resume','/api/whpp/run/start','/api/whpp/run/resume']);
const previousGet=express.application.get;
const previousPost=express.application.post;
const GET_WRAPPED=Symbol.for('ce-qc.v415-status-proof-get');
const POST_WRAPPED=Symbol.for('ce-qc.v415-stale-completion-post');
const proofCache=new Map();
const INCOMPLETE_CACHE_MS=2500;
const COMPLETE_CACHE_MS=60000;

const text=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const dateOnly=value=>{const s=text(value).replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const safeJson=(value,fallback={})=>{try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}};
const atOrAfter=(value,boundary)=>{const limit=Date.parse(text(boundary));if(!Number.isFinite(limit))return true;const actual=Date.parse(text(value));return Number.isFinite(actual)&&actual>=limit;};

function latestValidBatch(db,reportDate=''){
  const date=dateOnly(reportDate);
  if(!date)return null;
  return db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(date)||null;
}

function exactMembership(db,batch){
  return readV418CurrentMembershipCounts(db,batch);
}

function currentLock(db,type,date,boundary=''){
  let row=null;
  try{
    row=type==='CCSL'
      ?db.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM run_locks WHERE reportDate=? LIMIT 1').get(date)||null
      :db.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM business_run_locks WHERE businessType=? AND reportDate=? LIMIT 1').get(type,date)||null;
  }catch{return null;}
  if(!row)return null;
  return atOrAfter(row.lockedAt||row.updatedAt,boundary)?row:null;
}

function currentCompletionSnapshot(db,type,date,runId,boundary=''){
  const id=text(runId);
  if(!id)return null;
  try{
    const row=type==='CCSL'
      ?db.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM export_snapshots WHERE reportDate=? AND runId=? AND snapshotType='dashboard' AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY id DESC LIMIT 1").get(date,id)||null
      :db.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM business_export_snapshots WHERE businessType='SHOPEE' AND reportDate=? AND runId=? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY id DESC LIMIT 1").get(date,id)||null;
    return row&&atOrAfter(row.generatedAt,boundary)?row:null;
  }catch{return null;}
}

function unifiedCompletionClaim(db,batch){
  try{return text(db.prepare('SELECT status FROM unified_snapshots WHERE snapshotId=? AND reportDate=? LIMIT 1').get(batch?.snapshotId,batch?.reportDate)?.status).toUpperCase()==='COMPLETED';}catch{return false;}
}

function businessSuccessCoverage(db,{businessType,date,snapshotId,boundary='',memberTypes=[]}={}){
  const result=readV418BusinessSuccessCoverage(db,{businessType,date,snapshotId,boundary,memberTypes});
  return result?.ok?n(result.count):0;
}

function emptyMemberProof(total,reason){return{id:V384_CCSL_PROCESSING_PROOF_ID,source:n(total),covered:0,missing:n(total),complete:false,reasons:{[reason]:n(total)},missingBills:[],missingReasons:[],queryMode:'V416_FAST_NEGATIVE_PROOF'};}

function cacheResult(key,value){
  const complete=['CCSL','SHOPEE','WHPP'].every(stage=>value?.stages?.[stage]?.complete===true);
  proofCache.set(key,{value,at:Date.now(),ttl:complete?COMPLETE_CACHE_MS:INCOMPLETE_CACHE_MS});
  if(proofCache.size>24){for(const [cacheKey,item] of proofCache){if(Date.now()-item.at>Math.max(COMPLETE_CACHE_MS,item.ttl))proofCache.delete(cacheKey);}}
  return value;
}

export function readV415CurrentProcessingProof({db=getDb(),reportDate='',force=false}={}){
  const started=Date.now(),date=dateOnly(reportDate);
  const batch=latestValidBatch(db,date);
  if(!date||!batch)return{ok:false,id:V415_RETROACTIVE_COMPLETION_GUARD_ID,fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,reportDate:date,batch:null,counts:{CCSL:0,SHOPEE:0,WHPP:0,TOTAL:0},stages:{CCSL:{complete:false},SHOPEE:{complete:false},WHPP:{complete:false}},reason:'CURRENT_VALID_BATCH_MISSING'};
  const cacheKey=`${date}:${text(batch.snapshotId)}`,cached=proofCache.get(cacheKey);
  if(!force&&cached&&Date.now()-cached.at<cached.ttl)return{...cached.value,cacheHit:true,elapsedMs:Date.now()-started};
  const counts=exactMembership(db,batch),boundary=text(batch.createdAt),snapshotId=text(batch.snapshotId);

  const ccslLock=currentLock(db,'CCSL',date,boundary);
  const ccslSnapshot=currentCompletionSnapshot(db,'CCSL',date,ccslLock?.runId,boundary);
  const fastCcslProof=ccslSnapshot?readV418CcslProcessingProof(db,{reportDate:date,snapshotId,boundary}):null;
  const ccslMemberProof=counts.CCSL===0
    ?{id:V384_CCSL_PROCESSING_PROOF_ID,source:0,covered:0,missing:0,complete:true,queryMode:'ZERO_TICKET'}
    :ccslSnapshot
      ?(fastCcslProof?.ok
        ?fastCcslProof
        :(counts.CCSL<=500
          ?readV384CcslProcessingProof(db,{reportDate:date,snapshotId,boundary,includeMissingBills:false})
          :emptyMemberProof(counts.CCSL,'V418_FAST_CCSL_PROOF_FAILED')))
      :emptyMemberProof(counts.CCSL,'NO_CURRENT_COMPLETION_SNAPSHOT');
  const ccslComplete=counts.CCSL===0||Boolean(ccslSnapshot&&ccslMemberProof.complete&&n(ccslMemberProof.source)===counts.CCSL);

  const shopeeLock=currentLock(db,'SHOPEE',date,boundary);
  const shopeeSnapshot=currentCompletionSnapshot(db,'SHOPEE',date,shopeeLock?.runId,boundary);
  const shopeeCovered=shopeeSnapshot?businessSuccessCoverage(db,{businessType:'SHOPEE',date,snapshotId,boundary,memberTypes:['SHOPEECN','SHOPEEVN']}):0;
  const shopeeComplete=counts.SHOPEE===0||Boolean(shopeeSnapshot&&shopeeCovered>=counts.SHOPEE);

  const whppLock=currentLock(db,'WHPP',date,boundary);
  const whppMembershipOk=counts._whppMembershipOk!==false;
  // V419: completion claims on the status/proof path are scalar-only. The old
  // business_states.valueJson fallback was redundant with the persisted current
  // run lock/unified completion claim and could rematerialize a large WHPP state
  // blob on a status read. Exact current-member SUCCESS coverage remains mandatory.
  const whppUnifiedClaim=unifiedCompletionClaim(db,batch);
  const whppLockClaim=['finished','completed'].includes(text(whppLock?.status).toLowerCase());
  const whppClaim=whppMembershipOk&&(counts.WHPP===0||whppUnifiedClaim||whppLockClaim);
  const whppClaimSource=counts.WHPP===0?'ZERO_TICKET':whppUnifiedClaim?'UNIFIED_COMPLETED_SCALAR':whppLockClaim?'CURRENT_FINISHED_RUN_LOCK':'NONE';
  const whppCovered=counts.WHPP>0&&whppClaim?businessSuccessCoverage(db,{businessType:'WHPP',date,snapshotId,boundary,memberTypes:['WHPP']}):0;
  const whppComplete=Boolean(whppMembershipOk&&(counts.WHPP===0||whppClaim&&whppCovered>=counts.WHPP));

  const result={
    ok:true,id:V415_RETROACTIVE_COMPLETION_GUARD_ID,fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,reportDate:date,
    batch:{batchId:text(batch.batchId),snapshotId,boundary},counts,
    stages:{
      CCSL:{complete:ccslComplete,total:counts.CCSL,covered:n(ccslMemberProof.covered),missing:Math.max(0,counts.CCSL-n(ccslMemberProof.covered)),memberProof:ccslMemberProof,completionSnapshotId:text(ccslSnapshot?.snapshotId),lock:ccslLock},
      SHOPEE:{complete:shopeeComplete,total:counts.SHOPEE,covered:shopeeCovered,missing:Math.max(0,counts.SHOPEE-shopeeCovered),completionSnapshotId:text(shopeeSnapshot?.snapshotId),lock:shopeeLock},
      WHPP:{complete:whppComplete,total:counts.WHPP,covered:whppCovered,missing:Math.max(0,counts.WHPP-whppCovered),completionSnapshotId:'',completionClaim:whppClaim,completionClaimSource:whppClaimSource,membershipOk:whppMembershipOk,membershipReason:text(counts._whppMembershipReason),lock:whppLock}
    },
    membershipSource:text(counts._source),membershipFastSource:text(counts._fastSource),elapsedMs:Date.now()-started,cacheHit:false
  };
  if(result.elapsedMs>1000)console.warn('[CE-QC][V418_STATUS_PROOF_SLOW]',JSON.stringify({reportDate:date,elapsedMs:result.elapsedMs,ccsl:counts.CCSL,shopee:counts.SHOPEE,whpp:counts.WHPP,fastPathId:V418_STATUS_PROOF_FAST_PATH_ID}));
  return cacheResult(cacheKey,result);
}

function failClosedStage(stage={},proof={},reason='STATUS_PROOF_UNCONFIRMED'){
  const lock=proof?.lock||null,status=text(lock?.status).toLowerCase();
  return{...stage,sourceTotal:n(proof?.total||stage?.sourceTotal),complete:false,zeroTicketDay:false,snapshotId:'',snapshotStatus:'PENDING',runId:text(lock?.runId||stage?.runId),runStatus:status||'status_unconfirmed',running:status==='running',paused:status==='paused',failed:status==='failed',phase:text(lock?.currentStage)||'状态确认中',completionSource:reason,statusSource:'V416_FAIL_CLOSED_STATUS_PROOF',completionGuard:{id:V415_RETROACTIVE_COMPLETION_GUARD_ID,fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,...proof}};
}

function failClosedPayload(payload={},proof={},reason='STATUS_PROOF_UNCONFIRMED'){
  if(payload?.stages&&typeof payload.stages==='object'){
    const stages={...payload.stages};
    for(const key of ['CCSL','SHOPEE','WHPP'])stages[key]=failClosedStage(stages[key]||{key},proof?.stages?.[key]||{},reason);
    return{...payload,complete:false,stages,completionGuard:{id:V415_RETROACTIVE_COMPLETION_GUARD_ID,fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,ok:false,reason}};
  }
  return{...failClosedStage(payload,proof?.stages?.[text(payload.businessType||payload.key).toUpperCase()]||{},reason),complete:false,completionGuard:{id:V415_RETROACTIVE_COMPLETION_GUARD_ID,fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,ok:false,reason}};
}

function downgradedStage(stage={},proof={}){
  if(stage?.complete!==true||proof.complete===true)return{...stage,completionGuard:{id:V415_RETROACTIVE_COMPLETION_GUARD_ID,fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,...proof}};
  const lock=proof.lock||null,status=text(lock?.status).toLowerCase();
  return{
    ...stage,
    sourceTotal:n(proof.total||stage.sourceTotal),
    complete:false,
    zeroTicketDay:false,
    runId:text(lock?.runId||stage.runId),
    runStatus:status==='finished'?'stale_finished_rejected':status,
    running:status==='running',paused:status==='paused',failed:status==='failed',
    phase:text(lock?.currentStage)||(status==='running'?'处理中':'待处理'),
    snapshotId:'',snapshotStatus:'PENDING',
    completionSource:'V415_CURRENT_MEMBER_PROCESSING_PROOF_REQUIRED',
    statusSource:'V415_RETROACTIVE_CURRENT_MEMBER_PROOF',
    completionGuard:{id:V415_RETROACTIVE_COMPLETION_GUARD_ID,fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,...proof}
  };
}

export function applyV415StatusGuard(payload={},proof=null){
  if(!payload||typeof payload!=='object')return payload;
  const resolved=proof||readV415CurrentProcessingProof({reportDate:payload.reportDate});
  if(!resolved?.ok)return failClosedPayload(payload,resolved,'CURRENT_PROCESSING_PROOF_UNAVAILABLE');
  if(payload.stages&&typeof payload.stages==='object'){
    const stages={...payload.stages};
    for(const key of ['CCSL','SHOPEE','WHPP'])stages[key]=downgradedStage(stages[key]||{key},resolved.stages[key]||{complete:false});
    return{...payload,complete:['CCSL','SHOPEE','WHPP'].every(key=>stages[key]?.complete===true),stages,completedFastPath:payload.completedFastPath?`${payload.completedFastPath}+V415_PROOF_GUARD`:payload.completedFastPath,completionGuard:{id:V415_RETROACTIVE_COMPLETION_GUARD_ID,fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,batch:resolved.batch,counts:resolved.counts,elapsedMs:resolved.elapsedMs,cacheHit:resolved.cacheHit}};
  }
  const key=text(payload.businessType||payload.key).toUpperCase()==='SHOPEE'?'SHOPEE':text(payload.businessType||payload.key).toUpperCase()==='WHPP'?'WHPP':'CCSL';
  const guarded=downgradedStage(payload,resolved.stages[key]||{complete:false});
  return{...guarded,businessType:payload.businessType||key,completionGuard:{id:V415_RETROACTIVE_COMPLETION_GUARD_ID,fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,batch:resolved.batch,counts:resolved.counts,stage:resolved.stages[key],elapsedMs:resolved.elapsedMs,cacheHit:resolved.cacheHit}};
}

function statusResponseGuard(req,res,next){
  const previousJson=res.json;
  res.json=function v415StatusJson(payload){
    try{
      const requested=dateOnly(req.query?.reportDate||payload?.reportDate);
      const guarded=applyV415StatusGuard(payload,readV415CurrentProcessingProof({reportDate:requested}));
      res.setHeader('X-CE-QC-V416-Proof',V416_FAST_FAILCLOSED_PROOF_ID);
      res.setHeader('X-CE-QC-V417-Member-Proof',V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID);
      res.setHeader('X-CE-QC-V418-Fast-Proof',V418_STATUS_PROOF_FAST_PATH_ID);
      res.json=previousJson;
      return previousJson.call(this,guarded);
    }catch(error){
      console.warn('[CE-QC][V418_STATUS_GUARD] proof failed closed:',error?.message||error);
      res.json=previousJson;
      return previousJson.call(this,failClosedPayload(payload,{},`PROOF_ERROR:${text(error?.message||error)}`));
    }
  };
  return next();
}

function currentWhppDailyRows(db,date){
  try{return db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY id").all(date).map(row=>{const parsed=safeJson(row.rowJson,{}),bill=text(row.shipmentCode).toUpperCase();return{...parsed,shipmentCode:bill,运单号:bill,businessType:'WHPP',reportDate:date};}).filter(row=>row.shipmentCode);}catch{return[];}
}

function reopenShopeeStaleCompletion(db,date,proof){
  if(!proof||proof.complete||n(proof.total)===0)return{changed:false,reason:'PROOF_ALREADY_COMPLETE_OR_ZERO'};
  const lock=proof.lock;
  if(!lock||text(lock.status).toLowerCase()!=='finished')return{changed:false,reason:'NO_STALE_FINISHED_LOCK'};
  const now=nowIso();
  const result=db.prepare("UPDATE business_run_locks SET status='failed',errorMessage=?,completedAt='',updatedAt=? WHERE businessType='SHOPEE' AND reportDate=? AND runId=? AND status='finished'")
    .run('V415_REOPEN_STALE_COMPLETION_MISSING_CURRENT_PROCESSING_PROOF',now,date,lock.runId);
  return{changed:n(result?.changes)>0,reason:'STALE_SHOPEE_FINISHED_REOPENED',runId:text(lock.runId)};
}

function reopenWhppStaleCompletion(db,date,proof,batch){
  if(!proof||proof.complete||n(proof.total)===0)return{changed:false,reason:'PROOF_ALREADY_COMPLETE_OR_ZERO'};
  const current=loadWhppState(),stateDate=dateOnly(current.reportDate),rows=currentWhppDailyRows(db,date),bills=[...new Set(rows.map(row=>row.shipmentCode).filter(Boolean))];
  const finalized=['COMPLETED','COMPLETED_WITH_RETRY'].includes(text(current.snapshotStatus).toUpperCase())||Boolean(text(current.snapshotId));
  const sameMembers=bills.length===n(proof.total);
  let stateReset=false;
  if(stateDate===date&&sameMembers&&finalized){
    saveWhppState({
      ...current,
      reportDate:date,
      sourceSnapshotId:text(batch?.snapshotId||current.sourceSnapshotId),
      dailyReportReady:true,pnhBills:bills,dailyParseRows:rows,
      scanPool:[],scanResults:[],scanQueryStatus:[],needTrackBills:[],needExceptionBills:[],
      trackEvents:[],eventQueryStatus:[],exceptionItems:[],exceptionQueryStatus:[],trackResults:[],finalRows:[],
      processing:{running:false,paused:false,phase:'待处理',batchIndex:0,totalBatches:0},
      currentRun:null,lastRunSummary:null,lastRun:null,restartRecovery:null,snapshotId:'',snapshotStatus:'IMPORTED',
      v415StaleCompletionReopened:{id:V415_STALE_COMPLETION_REOPEN_ID,reportDate:date,previousSnapshotId:text(current.snapshotId),missing:n(proof.missing),at:nowIso()}
    });
    stateReset=true;
  }
  let lockReset=false;
  if(proof.lock&&text(proof.lock.status).toLowerCase()==='finished'){
    const result=db.prepare("UPDATE business_run_locks SET status='failed',errorMessage=?,completedAt='',updatedAt=? WHERE businessType='WHPP' AND reportDate=? AND runId=? AND status='finished'")
      .run('V415_REOPEN_STALE_COMPLETION_MISSING_CURRENT_PROCESSING_PROOF',nowIso(),date,proof.lock.runId);
    lockReset=n(result?.changes)>0;
  }
  proofCache.clear();
  return{changed:stateReset||lockReset,stateReset,lockReset,reason:stateReset||lockReset?'STALE_WHPP_COMPLETION_REOPENED':'NO_MUTABLE_STALE_POINTER',runId:text(proof.lock?.runId)};
}

function staleCompletionRunGuard(req,res,next){
  try{
    const requested=dateOnly(req.body?.reportDate||req.query?.reportDate);
    const batch=latestValidBatch(getDb(),requested);
    const date=requested||dateOnly(batch?.reportDate);
    if(!date||!batch)return next();
    const full=readV415CurrentProcessingProof({reportDate:date,force:true});
    const route=text(req.path||req.originalUrl).split('?')[0];
    const action=route.includes('/shopee/')
      ?reopenShopeeStaleCompletion(getDb(),date,full.stages.SHOPEE)
      :reopenWhppStaleCompletion(getDb(),date,full.stages.WHPP,full.batch);
    req.ceQcV415StaleCompletion=action;
    if(action.changed){proofCache.clear();console.warn('[CE-QC][V415_STALE_COMPLETION_REOPEN]',JSON.stringify({id:V415_STALE_COMPLETION_REOPEN_ID,route,date,...action}));}
    return next();
  }catch(error){
    console.error('[CE-QC][V415_STALE_COMPLETION_REOPEN] fail closed:',error?.stack||error);
    return res.status(409).json({ok:false,code:'V415_STALE_COMPLETION_PROOF_FAILED',error:`当前日报旧完成状态复核失败，已阻止重复/跳过处理：${error?.message||error}`,revision:V415_RETROACTIVE_COMPLETION_GUARD_ID});
  }
}

if(typeof previousGet==='function'&&!previousGet[GET_WRAPPED]){
  const wrappedGet=function v415RetroactiveCompletionGet(pathValue,...handlers){
    if(String(pathValue||'')===STATUS_ROUTE)return previousGet.call(this,pathValue,statusResponseGuard,...handlers);
    return previousGet.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrappedGet,GET_WRAPPED,{value:true});
  express.application.get=wrappedGet;
}

if(typeof previousPost==='function'&&!previousPost[POST_WRAPPED]){
  const wrappedPost=function v415RetroactiveCompletionPost(pathValue,...handlers){
    if(GUARDED_POST_ROUTES.has(String(pathValue||'')))return previousPost.call(this,pathValue,staleCompletionRunGuard,...handlers);
    return previousPost.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrappedPost,POST_WRAPPED,{value:true});
  express.application.post=wrappedPost;
}

console.info('[CE-QC][V415_RETROACTIVE_COMPLETION_GUARD]',V415_RETROACTIVE_COMPLETION_GUARD_ID,V415_STALE_COMPLETION_REOPEN_ID,V416_FAST_FAILCLOSED_PROOF_ID,V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,V418_STATUS_PROOF_FAST_PATH_ID,'legacy COMPLETED markers are display/run-authoritative only when exact current membership has current-lifecycle proof; V419/V418 status proof avoids large snapshot/state JSON materialization and uses scalar claims plus current-member set joins; any proof failure is fail-closed.');