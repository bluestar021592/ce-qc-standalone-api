import express from 'express';
import { getDb, nowIso } from './db.js';
import { loadWhppState, saveWhppState } from './whppStore.js';
import { V418_STATUS_PROOF_FAST_PATH_ID } from './v418StatusProofFastPath.js';
import {
  PROCESSING_STATUS_CORE_ID,
  latestValidProcessingBatch,
  readSevenBusinessStatus,
  clearProcessingStatusCache
} from './processingStatusCore.js';

export const V415_RETROACTIVE_COMPLETION_GUARD_ID='2026-09-02-v415-current-member-processing-proof-v1';
export const V415_STALE_COMPLETION_REOPEN_ID='2026-09-02-v415-stale-completion-reopen-v1';
export const V416_FAST_FAILCLOSED_PROOF_ID='2026-09-02-v416-large-db-fast-failclosed-proof-v1';
export const V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID='2026-09-02-v417-membership-anchored-success-proof-v1';
export const V424_SAME_LIFECYCLE_COMPLETION_GUARD_ID='2026-09-04-v424-same-lifecycle-completion-proof-v1';
export { V418_STATUS_PROOF_FAST_PATH_ID };

const GUARDED_POST_ROUTES=new Set(['/api/shopee/run/start','/api/shopee/run/resume','/api/whpp/run/start','/api/whpp/run/resume']);
const previousPost=express.application.post;
const POST_WRAPPED=Symbol.for('ce-qc.v415-stale-completion-post');
const text=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const dateOnly=value=>{const s=text(value).replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const safeJson=(value,fallback={})=>{try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}};

function stageProof(stage={}){
  const total=n(stage.sourceTotal),covered=stage.complete?total:n(stage.completionProof?.covered||stage.podLockCount||0);
  const runStatus=text(stage.runStatus).toLowerCase();
  return{
    complete:Boolean(stage.complete),total,covered,missing:Math.max(0,total-covered),
    completionSnapshotId:text(stage.snapshotId),completionClaimSource:text(stage.completionClaimSource),
    completionSource:text(stage.completionSource),podLockCount:n(stage.podLockCount),
    membershipOk:stage.currentMembershipConsistent!==false,membershipReason:text(stage.membershipReason),
    lock:stage.runId?{
      runId:text(stage.runId),status:runStatus==='completed'?'finished':runStatus,
      currentStage:text(stage.phase),batchIndex:n(stage.batchIndex),totalBatches:n(stage.totalBatches),
      errorMessage:text(stage.lastMessage),updatedAt:'',lockedAt:''
    }:null
  };
}

// Compatibility shape only. All truth is computed exactly once by processingStatusCore.
export function readV415CurrentProcessingProof({db=getDb(),reportDate='',force=false}={}){
  const started=Date.now(),core=readSevenBusinessStatus({db,reportDate,force});
  const batch=core?.reportDate?latestValidProcessingBatch(db,core.reportDate):null;
  const counts=core?.counts||{CCSL:0,SHOPEE:0,WHPP:0,TOTAL:0};
  return{
    ok:Boolean(core?.ok&&core?.reportDate&&batch),id:V415_RETROACTIVE_COMPLETION_GUARD_ID,coreStatusId:PROCESSING_STATUS_CORE_ID,
    fastProofId:V416_FAST_FAILCLOSED_PROOF_ID,memberProofId:V417_MEMBER_ANCHORED_SUCCESS_PROOF_ID,
    v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v424SameLifecycleCompletionId:V424_SAME_LIFECYCLE_COMPLETION_GUARD_ID,
    reportDate:text(core?.reportDate),batch:batch?{batchId:text(batch.batchId),snapshotId:text(batch.snapshotId),boundary:text(batch.createdAt)}:null,counts,
    stages:{CCSL:stageProof(core?.stages?.CCSL),SHOPEE:stageProof(core?.stages?.SHOPEE),WHPP:stageProof(core?.stages?.WHPP)},
    membershipSource:text(counts._source),membershipFastSource:text(counts._fastSource),elapsedMs:Date.now()-started,cacheHit:Boolean(core?.cacheHit),
    reason:core?.reportDate?'CORE_STATUS_ADAPTED':'CURRENT_VALID_BATCH_MISSING'
  };
}

function failClosedStage(stage={},proof={},reason='STATUS_PROOF_UNCONFIRMED'){
  const lock=proof?.lock||null,status=text(lock?.status).toLowerCase();
  return{...stage,sourceTotal:n(proof?.total||stage?.sourceTotal),complete:false,zeroTicketDay:false,snapshotId:'',snapshotStatus:'PENDING',runId:text(lock?.runId||stage?.runId),runStatus:status||'status_unconfirmed',running:status==='running',paused:status==='paused',failed:status==='failed',phase:text(lock?.currentStage)||'状态确认中',completionSource:reason,statusSource:'CORE_FAIL_CLOSED_STATUS_PROOF'};
}

// Old callers may still pass a payload through this helper. It can only downgrade
// payload claims using the already-computed core proof; it never queries membership,
// snapshots or completion tables a second time.
export function applyV415StatusGuard(payload={},proof=null){
  if(!payload||typeof payload!=='object')return payload;
  const resolved=proof||readV415CurrentProcessingProof({reportDate:payload.reportDate});
  if(!resolved?.ok)return payload?.stages
    ?{...payload,complete:false,stages:Object.fromEntries(['CCSL','SHOPEE','WHPP'].map(key=>[key,failClosedStage(payload.stages?.[key]||{key},{},'CURRENT_PROCESSING_PROOF_UNAVAILABLE')]))}
    :failClosedStage(payload,{},'CURRENT_PROCESSING_PROOF_UNAVAILABLE');
  if(payload.stages&&typeof payload.stages==='object'){
    const stages={...payload.stages};
    for(const key of ['CCSL','SHOPEE','WHPP'])if(stages[key]?.complete===true&&resolved.stages[key]?.complete!==true)stages[key]=failClosedStage(stages[key],resolved.stages[key],'CORE_CURRENT_MEMBER_PROCESSING_PROOF_REQUIRED');
    return{...payload,complete:['CCSL','SHOPEE','WHPP'].every(key=>stages[key]?.complete===true),stages,completionGuard:{id:V415_RETROACTIVE_COMPLETION_GUARD_ID,coreStatusId:PROCESSING_STATUS_CORE_ID,batch:resolved.batch,counts:resolved.counts}};
  }
  const key=text(payload.businessType||payload.key).toUpperCase()==='SHOPEE'?'SHOPEE':text(payload.businessType||payload.key).toUpperCase()==='WHPP'?'WHPP':'CCSL';
  return payload.complete===true&&resolved.stages[key]?.complete!==true
    ?failClosedStage(payload,resolved.stages[key],'CORE_CURRENT_MEMBER_PROCESSING_PROOF_REQUIRED')
    :{...payload,completionGuard:{id:V415_RETROACTIVE_COMPLETION_GUARD_ID,coreStatusId:PROCESSING_STATUS_CORE_ID,stage:resolved.stages[key]}};
}

function currentWhppDailyRows(db,date){
  try{return db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY id").all(date).map(row=>{const parsed=safeJson(row.rowJson,{}),bill=text(row.shipmentCode).toUpperCase();return{...parsed,shipmentCode:bill,运单号:bill,businessType:'WHPP',reportDate:date};}).filter(row=>row.shipmentCode);}catch{return[];}
}

function reopenShopeeStaleCompletion(db,date,proof){
  if(!proof||proof.complete||n(proof.total)===0)return{changed:false,reason:'PROOF_ALREADY_COMPLETE_OR_ZERO'};
  const lock=proof.lock;if(!lock||text(lock.status).toLowerCase()!=='finished')return{changed:false,reason:'NO_STALE_FINISHED_LOCK'};
  const now=nowIso();
  const result=db.prepare("UPDATE business_run_locks SET status='failed',errorMessage=?,completedAt='',updatedAt=? WHERE businessType='SHOPEE' AND reportDate=? AND runId=? AND status='finished'")
    .run('CORE_REOPEN_STALE_COMPLETION_MISSING_CURRENT_PROCESSING_PROOF',now,date,lock.runId);
  return{changed:n(result?.changes)>0,reason:'STALE_SHOPEE_FINISHED_REOPENED',runId:text(lock.runId)};
}

function reopenWhppStaleCompletion(db,date,proof,batch){
  if(!proof||proof.complete||n(proof.total)===0)return{changed:false,reason:'PROOF_ALREADY_COMPLETE_OR_ZERO'};
  const current=loadWhppState(),stateDate=dateOnly(current.reportDate),rows=currentWhppDailyRows(db,date),bills=[...new Set(rows.map(row=>row.shipmentCode).filter(Boolean))];
  const finalized=['COMPLETED','COMPLETED_WITH_RETRY'].includes(text(current.snapshotStatus).toUpperCase())||Boolean(text(current.snapshotId));
  const sameMembers=bills.length===n(proof.total);let stateReset=false;
  if(stateDate===date&&sameMembers&&finalized){
    saveWhppState({...current,reportDate:date,sourceSnapshotId:text(batch?.snapshotId||current.sourceSnapshotId),dailyReportReady:true,pnhBills:bills,dailyParseRows:rows,scanPool:[],scanResults:[],scanQueryStatus:[],needTrackBills:[],needExceptionBills:[],trackEvents:[],eventQueryStatus:[],exceptionItems:[],exceptionQueryStatus:[],trackResults:[],finalRows:[],processing:{running:false,paused:false,phase:'待处理',batchIndex:0,totalBatches:0},currentRun:null,lastRunSummary:null,lastRun:null,restartRecovery:null,snapshotId:'',snapshotStatus:'IMPORTED',v415StaleCompletionReopened:{id:V415_STALE_COMPLETION_REOPEN_ID,reportDate:date,previousSnapshotId:text(current.snapshotId),missing:n(proof.missing),at:nowIso()}});
    stateReset=true;
  }
  let lockReset=false;
  if(proof.lock&&text(proof.lock.status).toLowerCase()==='finished'){
    const result=db.prepare("UPDATE business_run_locks SET status='failed',errorMessage=?,completedAt='',updatedAt=? WHERE businessType='WHPP' AND reportDate=? AND runId=? AND status='finished'")
      .run('CORE_REOPEN_STALE_COMPLETION_MISSING_CURRENT_PROCESSING_PROOF',nowIso(),date,proof.lock.runId);
    lockReset=n(result?.changes)>0;
  }
  return{changed:stateReset||lockReset,stateReset,lockReset,reason:stateReset||lockReset?'STALE_WHPP_COMPLETION_REOPENED':'NO_MUTABLE_STALE_POINTER',runId:text(proof.lock?.runId)};
}

function staleCompletionRunGuard(req,res,next){
  try{
    const requested=dateOnly(req.body?.reportDate||req.query?.reportDate),core=readSevenBusinessStatus({db:getDb(),reportDate:requested,force:true}),date=dateOnly(core?.reportDate);
    if(!date||!core?.ok)return next();
    const batch=latestValidProcessingBatch(getDb(),date),proof=readV415CurrentProcessingProof({db:getDb(),reportDate:date,force:false});
    const route=text(req.path||req.originalUrl).split('?')[0];
    const action=route.includes('/shopee/')?reopenShopeeStaleCompletion(getDb(),date,proof.stages.SHOPEE):reopenWhppStaleCompletion(getDb(),date,proof.stages.WHPP,proof.batch||batch);
    req.ceQcV415StaleCompletion=action;
    if(action.changed){clearProcessingStatusCache();console.warn('[CE-QC][CORE_STALE_COMPLETION_REOPEN]',JSON.stringify({id:V415_STALE_COMPLETION_REOPEN_ID,coreStatusId:PROCESSING_STATUS_CORE_ID,route,date,...action}));}
    return next();
  }catch(error){
    console.error('[CE-QC][CORE_STALE_COMPLETION_REOPEN] fail closed:',error?.stack||error);
    return res.status(409).json({ok:false,code:'CURRENT_PROCESSING_PROOF_FAILED',error:`当前日报旧完成状态复核失败，已阻止重复/跳过处理：${error?.message||error}`,revision:V415_RETROACTIVE_COMPLETION_GUARD_ID,coreStatusId:PROCESSING_STATUS_CORE_ID});
  }
}

if(typeof previousPost==='function'&&!previousPost[POST_WRAPPED]){
  const wrappedPost=function coreStaleCompletionPost(pathValue,...handlers){
    if(GUARDED_POST_ROUTES.has(String(pathValue||'')))return previousPost.call(this,pathValue,staleCompletionRunGuard,...handlers);
    return previousPost.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrappedPost,POST_WRAPPED,{value:true});
  express.application.post=wrappedPost;
}

console.info('[CE-QC][CORE_STALE_COMPLETION_GUARD]',PROCESSING_STATUS_CORE_ID,V415_RETROACTIVE_COMPLETION_GUARD_ID,V415_STALE_COMPLETION_REOPEN_ID,'GET status wrapping and duplicate membership/snapshot proof reads are retired; V415 remains POST-only compatibility protection for stale finished SHOPEE/WHPP mutable pointers.');