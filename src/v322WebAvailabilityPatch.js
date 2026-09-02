import express from 'express';
import { getDb } from './db.js';
import { V418_STATUS_PROOF_FAST_PATH_ID } from './v415RetroactiveCompletionGuard.js';
import {
  readV418CurrentMembershipCounts,
  readV418CcslProcessingProof,
  readV418BusinessSuccessCoverage
} from './v418StatusProofFastPath.js';

export const V322_WEB_AVAILABILITY_ID='2026-09-02-v414-persisted-three-stage-status-v1';
export const V322_SEVEN_BUSINESS_STATUS_ID='2026-09-02-v414-one-read-seven-business-status-v1';
export const V322_WHPP_COMPLETION_PARITY_ID='2026-09-02-v414-whpp-success-evidence-parity-v1';
export const V322_COMPLETED_FAST_PATH_ID='2026-09-02-v322-unified-completed-snapshot-fast-path-v1';
export const V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID='2026-09-02-v418-v322-no-payload-completed-claim-v1';
export const V419_SCALAR_STATUS_PRIORITY_ID='2026-09-02-v419-scalar-status-priority-no-json-v1';
export const V419_STATUS_TIMING_ID='2026-09-02-v419-status-substage-timing-v1';

const previousGet=express.application.get;
const STATUS_ROUTE='/api/v33/run-progress';
const COMPLETE_LOCK=new Set(['finished','completed','done','success']);
const proofCache=new Map();
const INCOMPLETE_CACHE_MS=1200;
const COMPLETE_CACHE_MS=5000;
const text=v=>String(v??'').trim();
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const normalizeDate=v=>{const s=text(v).replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const elapsed=start=>Math.max(0,Number(process.hrtime.bigint()-start)/1e6);
const tick=()=>process.hrtime.bigint();
function atOrAfter(value,boundary){const limit=Date.parse(text(boundary));if(!Number.isFinite(limit))return true;const actual=Date.parse(text(value));return Number.isFinite(actual)&&actual>=limit;}

function latestValid(db,reportDate=''){
  const date=normalizeDate(reportDate);
  try{
    return date
      ?(db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(date)||null)
      :(db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,rowid DESC LIMIT 1").get()||null);
  }catch{return null;}
}

function currentLock(db,type,date,boundary=''){
  try{
    const row=type==='CCSL'
      ?db.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM run_locks WHERE reportDate=? LIMIT 1').get(date)||null
      :db.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM business_run_locks WHERE businessType=? AND reportDate=? LIMIT 1').get(type,date)||null;
    if(!row)return null;
    return atOrAfter(row.lockedAt||row.updatedAt,boundary)?row:null;
  }catch{return null;}
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
  try{return text(db.prepare('SELECT status FROM unified_snapshots WHERE snapshotId=? AND reportDate=? LIMIT 1').get(text(batch?.snapshotId),normalizeDate(batch?.reportDate))?.status).toUpperCase()==='COMPLETED';}catch{return false;}
}

function emptyStage(type,date,total,boundary,lock=null){
  const status=text(lock?.status).toLowerCase();
  const interrupted=type==='WHPP'&&status==='failed'&&text(lock?.errorMessage).toUpperCase().includes('PROCESS_RESTART_INTERRUPTED');
  return{
    key:type,label:type==='SHOPEE'?'SHOPEE CN/VN':type==='WHPP'?'WHPP本土':'CCSL',reportDate:date,
    sourceTotal:Math.max(0,n(total)),sourceHeader:'V419_CURRENT_MEMBERSHIP_SCALAR',sourceMembershipVerified:true,
    runId:text(lock?.runId),runStatus:interrupted?'restart_interrupted':status,phase:interrupted?'WHPP等待断点恢复':(text(lock?.currentStage)||(status==='running'?'处理中':'待处理')),
    batchIndex:n(lock?.batchIndex),totalBatches:n(lock?.totalBatches),lastMessage:interrupted?'PROCESS_RESTART_INTERRUPTED':text(lock?.errorMessage),
    running:status==='running',paused:status==='paused',failed:interrupted?false:status==='failed',
    scanDone:0,scanRetry:0,scanTotal:0,trackDone:0,trackRetry:0,trackTotal:0,done:0,retry:0,total:0,
    complete:false,zeroTicketDay:false,snapshotId:'',snapshotStatus:'PENDING',completionSource:'V415_CURRENT_MEMBER_PROCESSING_PROOF_REQUIRED',
    restartInterrupted:interrupted,restartRecovery:interrupted?{interrupted:true,reportDate:date,runId:text(lock?.runId),reason:'PROCESS_RESTART_INTERRUPTED',source:'business_run_locks'}:null,
    lifecycleBoundary:boundary,
    completionPolicy:type==='WHPP'?V322_WHPP_COMPLETION_PARITY_ID:undefined,
    statusSource:type==='WHPP'?'PERSISTED_WHPP_V414_SUCCESS_AND_RESTART_PROOF':'PERSISTED_DAILY_HEADER_RUN_LOCK_SNAPSHOT',
    v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID
  };
}

function completedStage(stage,snapshotId){
  return{...stage,complete:true,zeroTicketDay:n(stage.sourceTotal)===0,snapshotId:text(snapshotId),snapshotStatus:'COMPLETED',completionSource:'V418_CURRENT_MEMBER_PROCESSING_PROOF',runStatus:'completed',phase:'已完成',running:false,paused:false,failed:false,restartInterrupted:false,restartRecovery:null,statusSource:'V418_NO_PAYLOAD_COMPLETED_CLAIM',v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID};
}

function buildScalarStatus(db,date,batch){
  const totalStarted=tick(),timing={id:V419_STATUS_TIMING_ID};
  const membershipStarted=tick();
  const counts=readV418CurrentMembershipCounts(db,batch||{});
  timing.membershipMs=Number(elapsed(membershipStarted).toFixed(3));
  const boundary=text(batch?.createdAt),snapshotId=text(batch?.snapshotId);

  const locksStarted=tick();
  const ccslLock=currentLock(db,'CCSL',date,boundary),shopeeLock=currentLock(db,'SHOPEE',date,boundary),whppLock=currentLock(db,'WHPP',date,boundary);
  timing.locksMs=Number(elapsed(locksStarted).toFixed(3));

  let CCSL=emptyStage('CCSL',date,counts.CCSL,boundary,ccslLock);
  let SHOPEE=emptyStage('SHOPEE',date,counts.SHOPEE,boundary,shopeeLock);
  let WHPP=emptyStage('WHPP',date,counts.WHPP,boundary,whppLock);

  const ccslStarted=tick();
  if(n(counts.CCSL)===0)CCSL=completedStage(CCSL,snapshotId);
  else{
    const snapshot=currentCompletionSnapshot(db,'CCSL',date,text(ccslLock?.runId),boundary);
    if(snapshot){
      const proof=readV418CcslProcessingProof(db,{reportDate:date,snapshotId,boundary});
      if(proof?.ok&&proof.complete===true&&n(proof.source)===n(counts.CCSL)&&n(proof.covered)>=n(counts.CCSL))CCSL=completedStage(CCSL,text(snapshot.snapshotId));
      else CCSL={...CCSL,completionProof:{source:n(proof?.source),covered:n(proof?.covered),missing:n(proof?.missing),ok:Boolean(proof?.ok)}};
    }
  }
  timing.ccslMs=Number(elapsed(ccslStarted).toFixed(3));

  const shopeeStarted=tick();
  if(n(counts.SHOPEE)===0)SHOPEE=completedStage(SHOPEE,snapshotId);
  else{
    const snapshot=currentCompletionSnapshot(db,'SHOPEE',date,text(shopeeLock?.runId),boundary);
    if(snapshot){
      const coverage=readV418BusinessSuccessCoverage(db,{businessType:'SHOPEE',date,snapshotId,boundary,memberTypes:['SHOPEECN','SHOPEEVN']});
      if(coverage?.ok&&n(coverage.count)>=n(counts.SHOPEE))SHOPEE=completedStage(SHOPEE,text(snapshot.snapshotId));
      else SHOPEE={...SHOPEE,completionProof:{covered:n(coverage?.count),missing:Math.max(0,n(counts.SHOPEE)-n(coverage?.count)),ok:Boolean(coverage?.ok)}};
    }
  }
  timing.shopeeMs=Number(elapsed(shopeeStarted).toFixed(3));

  const whppStarted=tick();
  const whppMembershipOk=counts._whppMembershipOk!==false;
  if(whppMembershipOk&&n(counts.WHPP)===0)WHPP=completedStage(WHPP,snapshotId);
  else if(whppMembershipOk&&n(counts.WHPP)>0){
    const lockClaim=COMPLETE_LOCK.has(text(whppLock?.status).toLowerCase()),unifiedClaim=unifiedCompletionClaim(db,batch);
    if(lockClaim||unifiedClaim){
      const coverage=readV418BusinessSuccessCoverage(db,{businessType:'WHPP',date,snapshotId,boundary,memberTypes:['WHPP']});
      if(coverage?.ok&&n(coverage.count)>=n(counts.WHPP))WHPP=completedStage(WHPP,snapshotId);
      else WHPP={...WHPP,completionProof:{covered:n(coverage?.count),missing:Math.max(0,n(counts.WHPP)-n(coverage?.count)),ok:Boolean(coverage?.ok),lockClaim,unifiedClaim}};
    }
  }
  WHPP={...WHPP,currentMembershipConsistent:whppMembershipOk,membershipReason:text(counts._whppMembershipReason),completionPolicy:V322_WHPP_COMPLETION_PARITY_ID};
  timing.whppMs=Number(elapsed(whppStarted).toFixed(3));
  timing.totalMs=Number(elapsed(totalStarted).toFixed(3));

  const result={
    ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,
    completedFastPath:`${V322_COMPLETED_FAST_PATH_ID}+${V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID}`,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,
    reportDate:date,batchId:text(batch?.batchId),sourceSnapshotId:snapshotId,lifecycleBoundary:boundary,
    complete:[CCSL,SHOPEE,WHPP].every(stage=>stage.complete===true),stages:{CCSL,SHOPEE,WHPP},counts,
    statusDiagnostics:timing,generatedAt:new Date().toISOString()
  };
  if(timing.totalMs>750)console.warn('[CE-QC][V419_SCALAR_STATUS_SLOW]',JSON.stringify({reportDate:date,snapshotId,totalMs:timing.totalMs,membershipMs:timing.membershipMs,locksMs:timing.locksMs,ccslMs:timing.ccslMs,shopeeMs:timing.shopeeMs,whppMs:timing.whppMs}));
  return result;
}

export function readV322SevenBusinessStatus({reportDate='',db=getDb(),force=false}={}){
  const requested=normalizeDate(reportDate),batch=latestValid(db,requested),date=requested||normalizeDate(batch?.reportDate);
  if(!date||!batch)return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,reportDate:date||'',complete:false,stages:{CCSL:{key:'CCSL',complete:false},SHOPEE:{key:'SHOPEE',complete:false},WHPP:{key:'WHPP',complete:false,completionPolicy:V322_WHPP_COMPLETION_PARITY_ID,restartInterrupted:false,restartRecovery:null}},statusDiagnostics:{id:V419_STATUS_TIMING_ID,totalMs:0,reason:'CURRENT_VALID_BATCH_MISSING'},generatedAt:new Date().toISOString()};
  const cacheKey=`${date}:${text(batch.snapshotId)}`,cached=proofCache.get(cacheKey);
  if(!force&&cached&&Date.now()-cached.at<cached.ttl)return{...cached.value,cacheHit:true,statusDiagnostics:{...cached.value.statusDiagnostics,cacheHit:true,cacheAgeMs:Date.now()-cached.at}};
  const value=buildScalarStatus(db,date,batch),ttl=value.complete?COMPLETE_CACHE_MS:INCOMPLETE_CACHE_MS;
  proofCache.set(cacheKey,{value,at:Date.now(),ttl});
  if(proofCache.size>24){for(const [key,item] of proofCache){if(Date.now()-item.at>COMPLETE_CACHE_MS*2)proofCache.delete(key);}}
  return{...value,cacheHit:false};
}

export function readV322RunProgress(businessType='CCSL',db=getDb(),reportDate=''){
  const type=text(businessType).toUpperCase(),all=readV322SevenBusinessStatus({reportDate,db});
  if(type==='ALL')return all;
  const key=type==='SHOPEE'?'SHOPEE':type==='WHPP'?'WHPP':'CCSL',stage=all.stages?.[key]||{};
  return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,businessType:key,...stage,dailyTotal:n(stage.sourceTotal),podLockSkipped:Math.max(0,n(stage.sourceTotal)-n(stage.scanTotal)),statusDiagnostics:all.statusDiagnostics,generatedAt:new Date().toISOString()};
}

function progressHandler(req,res){
  const started=tick();
  try{
    res.setHeader('Cache-Control','private,max-age=1');
    res.setHeader('X-CE-QC-V322',V322_WEB_AVAILABILITY_ID);
    res.setHeader('X-CE-QC-V322-Seven-Status',V322_SEVEN_BUSINESS_STATUS_ID);
    res.setHeader('X-CE-QC-V322-WHPP-Completion',V322_WHPP_COMPLETION_PARITY_ID);
    res.setHeader('X-CE-QC-V418-Status-Fast-Path',V418_STATUS_PROOF_FAST_PATH_ID);
    res.setHeader('X-CE-QC-V419-Scalar-Status',V419_SCALAR_STATUS_PRIORITY_ID);
    const data=readV322RunProgress(req.query.businessType||'CCSL',getDb(),req.query.reportDate||'');
    const totalMs=Number(elapsed(started).toFixed(3));
    const d=data?.statusDiagnostics||{};
    res.setHeader('Server-Timing',`v419total;dur=${totalMs},membership;dur=${n(d.membershipMs)},locks;dur=${n(d.locksMs)},ccsl;dur=${n(d.ccslMs)},shopee;dur=${n(d.shopeeMs)},whpp;dur=${n(d.whppMs)}`);
    return res.json(data);
  }catch(error){
    const totalMs=Number(elapsed(started).toFixed(3));
    res.setHeader('Server-Timing',`v419total;dur=${totalMs}`);
    return res.status(200).json({ok:false,code:'V419_SCALAR_STATUS_READ_FAILED',version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,businessType:text(req.query.businessType).toUpperCase()||'CCSL',reportDate:normalizeDate(req.query.reportDate),error:text(error?.message||error),statusDiagnostics:{id:V419_STATUS_TIMING_ID,totalMs},generatedAt:new Date().toISOString()});
  }
}

// V419 owns this route directly through Express Route so the legacy V415 response wrapper cannot
// trigger a second proof read. The scalar handler already applies current-member fail-closed proof.
express.application.get=function v419AvailabilityGet(pathValue,...handlers){
  if(String(pathValue||'')===STATUS_ROUTE){this.route(pathValue).get(progressHandler);return this;}
  return previousGet.call(this,pathValue,...handlers);
};

console.info('[CE-QC][V419_SCALAR_STATUS_PRIORITY]',V322_WEB_AVAILABILITY_ID,V322_SEVEN_BUSINESS_STATUS_ID,V322_WHPP_COMPLETION_PARITY_ID,V419_SCALAR_STATUS_PRIORITY_ID,V419_STATUS_TIMING_ID,V418_STATUS_PROOF_FAST_PATH_ID,'status reads are scalar-only: no run_checkpoints.payloadJson, business_run_checkpoints.payloadJson, business_states.valueJson, or business_daily_reports.summaryJson is selected or parsed; current-member completion remains fail-closed and V414 explicit-run/restart semantics are unchanged.');
