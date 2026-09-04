import { getDb } from './db.js';
import {
  V418_STATUS_PROOF_FAST_PATH_ID,
  readV418CurrentMembershipCounts,
  readV418CcslProcessingProof,
  readV418BusinessSuccessCoverage
} from './v418StatusProofFastPath.js';

export const PROCESSING_STATUS_CORE_ID='system-processing-status-core-v1';
export const V322_WEB_AVAILABILITY_ID='2026-09-02-v414-persisted-three-stage-status-v1';
export const V322_SEVEN_BUSINESS_STATUS_ID='2026-09-02-v414-one-read-seven-business-status-v1';
export const V322_WHPP_COMPLETION_PARITY_ID='2026-09-02-v414-whpp-success-evidence-parity-v1';
export const V322_COMPLETED_FAST_PATH_ID='2026-09-02-v322-unified-completed-snapshot-fast-path-v1';
export const V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID='2026-09-02-v418-v322-no-payload-completed-claim-v1';
export const V419_SCALAR_STATUS_PRIORITY_ID='2026-09-02-v419-scalar-status-priority-no-json-v1';
export const V419_STATUS_TIMING_ID='2026-09-02-v419-status-substage-timing-v1';
export const V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID='2026-09-04-v424-same-lifecycle-completion-snapshot-v1';
export const CURRENT_MEMBER_POD_TERMINAL_ID='system-current-member-all-pod-terminal-v1';

const COMPLETE_LOCK=new Set(['finished','completed','done','success']);
const cache=new Map();
const INCOMPLETE_CACHE_MS=1200;
const COMPLETE_CACHE_MS=5000;
const text=value=>String(value??'').trim();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const dateOnly=value=>{const s=text(value).replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const tick=()=>process.hrtime.bigint();
const elapsed=start=>Math.max(0,Number(process.hrtime.bigint()-start)/1e6);
const atOrAfter=(value,boundary)=>{const limit=Date.parse(text(boundary));if(!Number.isFinite(limit))return true;const actual=Date.parse(text(value));return Number.isFinite(actual)&&actual>=limit;};

export function latestValidProcessingBatch(db,reportDate=''){
  const date=dateOnly(reportDate);
  try{
    return date
      ?db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(date)||null
      :db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,rowid DESC LIMIT 1").get()||null;
  }catch{return null;}
}

export function currentProcessingLock(db,type,date,boundary=''){
  try{
    const row=type==='CCSL'
      ?db.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM run_locks WHERE reportDate=? LIMIT 1').get(date)||null
      :db.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM business_run_locks WHERE businessType=? AND reportDate=? LIMIT 1').get(type,date)||null;
    if(!row)return null;
    return atOrAfter(row.lockedAt||row.updatedAt,boundary)?row:null;
  }catch{return null;}
}

export function currentLifecycleCompletionSnapshot(db,type,date,runId='',boundary=''){
  const id=text(runId);
  try{
    const exact=id
      ?(type==='CCSL'
        ?db.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM export_snapshots WHERE reportDate=? AND runId=? AND snapshotType='dashboard' AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY id DESC LIMIT 1").get(date,id)||null
        :db.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM business_export_snapshots WHERE businessType='SHOPEE' AND reportDate=? AND runId=? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY id DESC LIMIT 1").get(date,id)||null)
      :null;
    if(exact&&atOrAfter(exact.generatedAt,boundary))return{...exact,claimSource:'CURRENT_RUN_ID'};
    const lifecycle=type==='CCSL'
      ?db.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM export_snapshots WHERE reportDate=? AND snapshotType='dashboard' AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY generatedAt DESC,id DESC LIMIT 1").get(date)||null
      :db.prepare("SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM business_export_snapshots WHERE businessType='SHOPEE' AND reportDate=? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY generatedAt DESC,id DESC LIMIT 1").get(date)||null;
    return lifecycle&&atOrAfter(lifecycle.generatedAt,boundary)?{...lifecycle,claimSource:'SAME_VALID_IMPORT_LIFECYCLE'}:null;
  }catch{return null;}
}

function unifiedCompletionClaim(db,batch){
  try{return text(db.prepare('SELECT status FROM unified_snapshots WHERE snapshotId=? AND reportDate=? LIMIT 1').get(text(batch?.snapshotId),dateOnly(batch?.reportDate))?.status).toUpperCase()==='COMPLETED';}catch{return false;}
}

export function readCurrentCcslPodLockCount(db,batch={}){
  const snapshotId=text(batch.snapshotId),date=dateOnly(batch.reportDate);
  if(!snapshotId||!date)return{ok:false,count:0,source:CURRENT_MEMBER_POD_TERMINAL_ID};
  try{
    const count=n(db.prepare(`SELECT COUNT(DISTINCT u.shipmentCode) count
      FROM unified_import_rows u
      JOIN pod_locks p ON p.shipmentCode=u.shipmentCode
      WHERE u.snapshotId=? AND u.reportDate=?
        AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')
        AND TRIM(COALESCE(u.shipmentCode,''))<>''`).get(snapshotId,date)?.count);
    return{ok:true,count,source:CURRENT_MEMBER_POD_TERMINAL_ID};
  }catch(error){return{ok:false,count:0,source:CURRENT_MEMBER_POD_TERMINAL_ID,error:text(error?.message||error)};}
}

function emptyStage(type,date,total,boundary,lock=null){
  const status=text(lock?.status).toLowerCase();
  const restartInterrupted=status==='failed'&&text(lock?.errorMessage).toUpperCase().includes('PROCESS_RESTART_INTERRUPTED');
  return{
    key:type,label:type==='SHOPEE'?'SHOPEE CN/VN':type==='WHPP'?'WHPP本土':'CCSL',reportDate:date,
    sourceTotal:Math.max(0,n(total)),sourceHeader:'CURRENT_VALID_MEMBERSHIP',sourceMembershipVerified:true,
    runId:text(lock?.runId),runStatus:restartInterrupted?'restart_interrupted':status,
    phase:restartInterrupted?'等待断点恢复':(text(lock?.currentStage)||(status==='running'?'处理中':'待处理')),
    batchIndex:n(lock?.batchIndex),totalBatches:n(lock?.totalBatches),lastMessage:restartInterrupted?'PROCESS_RESTART_INTERRUPTED':text(lock?.errorMessage),
    running:status==='running',paused:status==='paused',failed:restartInterrupted?false:status==='failed',
    scanDone:0,scanRetry:0,scanTotal:0,trackDone:0,trackRetry:0,trackTotal:0,done:0,retry:0,total:0,
    podLockCount:0,complete:false,zeroTicketDay:false,snapshotId:'',snapshotStatus:'PENDING',completionSource:'CURRENT_MEMBER_PROCESSING_PROOF_REQUIRED',
    restartInterrupted,restartRecovery:restartInterrupted?{interrupted:true,reportDate:date,runId:text(lock?.runId),reason:'PROCESS_RESTART_INTERRUPTED',source:type==='CCSL'?'run_locks':'business_run_locks'}:null,
    lifecycleBoundary:boundary,completionPolicy:type==='WHPP'?V322_WHPP_COMPLETION_PARITY_ID:undefined,
    statusSource:'PERSISTED_CURRENT_MEMBERSHIP_RUN_LOCK_PROOF',coreStatusId:PROCESSING_STATUS_CORE_ID
  };
}
function completedStage(stage,snapshotId,claimSource=''){
  return{...stage,complete:true,zeroTicketDay:n(stage.sourceTotal)===0,snapshotId:text(snapshotId),snapshotStatus:'COMPLETED',completionSource:'CURRENT_MEMBER_PROCESSING_PROOF',completionClaimSource:text(claimSource),runStatus:'completed',phase:'已完成',running:false,paused:false,failed:false,restartInterrupted:false,restartRecovery:null,statusSource:'CORE_CURRENT_MEMBER_COMPLETED_CLAIM',coreStatusId:PROCESSING_STATUS_CORE_ID};
}

function buildStatus(db,date,batch){
  const totalStarted=tick(),timing={id:V419_STATUS_TIMING_ID};
  const membershipStarted=tick();
  const counts=readV418CurrentMembershipCounts(db,batch||{});
  timing.membershipMs=Number(elapsed(membershipStarted).toFixed(3));
  const boundary=text(batch?.createdAt),snapshotId=text(batch?.snapshotId);
  const lockStarted=tick();
  const ccslLock=currentProcessingLock(db,'CCSL',date,boundary),shopeeLock=currentProcessingLock(db,'SHOPEE',date,boundary),whppLock=currentProcessingLock(db,'WHPP',date,boundary);
  timing.locksMs=Number(elapsed(lockStarted).toFixed(3));
  let CCSL=emptyStage('CCSL',date,counts.CCSL,boundary,ccslLock),SHOPEE=emptyStage('SHOPEE',date,counts.SHOPEE,boundary,shopeeLock),WHPP=emptyStage('WHPP',date,counts.WHPP,boundary,whppLock);

  const ccslStarted=tick();
  const podLocks=readCurrentCcslPodLockCount(db,batch);
  CCSL={...CCSL,podLockCount:n(podLocks.count),podLockProofOk:Boolean(podLocks.ok),podLockProofSource:podLocks.source};
  if(n(counts.CCSL)===0)CCSL=completedStage(CCSL,snapshotId,'ZERO_TICKET');
  else if(podLocks.ok&&n(podLocks.count)>=n(counts.CCSL)){
    CCSL=completedStage(CCSL,snapshotId,'CURRENT_MEMBERSHIP_ALL_POD_LOCKED');
    CCSL={...CCSL,completionSource:CURRENT_MEMBER_POD_TERMINAL_ID,podLockCount:n(podLocks.count)};
  }else{
    const snapshot=currentLifecycleCompletionSnapshot(db,'CCSL',date,text(ccslLock?.runId),boundary);
    if(snapshot){
      const proof=readV418CcslProcessingProof(db,{reportDate:date,snapshotId,boundary});
      if(proof?.ok&&proof.complete===true&&n(proof.source)===n(counts.CCSL)&&n(proof.covered)>=n(counts.CCSL))CCSL=completedStage(CCSL,text(snapshot.snapshotId),snapshot.claimSource);
      else CCSL={...CCSL,completionProof:{source:n(proof?.source),covered:n(proof?.covered),missing:n(proof?.missing),ok:Boolean(proof?.ok)}};
    }
  }
  timing.ccslMs=Number(elapsed(ccslStarted).toFixed(3));

  const shopeeStarted=tick();
  if(n(counts.SHOPEE)===0)SHOPEE=completedStage(SHOPEE,snapshotId,'ZERO_TICKET');
  else{
    const snapshot=currentLifecycleCompletionSnapshot(db,'SHOPEE',date,text(shopeeLock?.runId),boundary);
    if(snapshot){
      const coverage=readV418BusinessSuccessCoverage(db,{businessType:'SHOPEE',date,snapshotId,boundary,memberTypes:['SHOPEECN','SHOPEEVN']});
      if(coverage?.ok&&n(coverage.count)>=n(counts.SHOPEE))SHOPEE=completedStage(SHOPEE,text(snapshot.snapshotId),snapshot.claimSource);
      else SHOPEE={...SHOPEE,completionProof:{covered:n(coverage?.count),missing:Math.max(0,n(counts.SHOPEE)-n(coverage?.count)),ok:Boolean(coverage?.ok)}};
    }
  }
  timing.shopeeMs=Number(elapsed(shopeeStarted).toFixed(3));

  const whppStarted=tick();
  const whppMembershipOk=counts._whppMembershipOk!==false;
  if(whppMembershipOk&&n(counts.WHPP)===0)WHPP=completedStage(WHPP,snapshotId,'ZERO_TICKET');
  else if(whppMembershipOk&&n(counts.WHPP)>0){
    const lockClaim=COMPLETE_LOCK.has(text(whppLock?.status).toLowerCase()),unifiedClaim=unifiedCompletionClaim(db,batch);
    if(lockClaim||unifiedClaim){
      const coverage=readV418BusinessSuccessCoverage(db,{businessType:'WHPP',date,snapshotId,boundary,memberTypes:['WHPP']});
      if(coverage?.ok&&n(coverage.count)>=n(counts.WHPP))WHPP=completedStage(WHPP,snapshotId,lockClaim?'CURRENT_FINISHED_RUN_LOCK':'UNIFIED_COMPLETED_SCALAR');
      else WHPP={...WHPP,completionProof:{covered:n(coverage?.count),missing:Math.max(0,n(counts.WHPP)-n(coverage?.count)),ok:Boolean(coverage?.ok),lockClaim,unifiedClaim}};
    }
  }
  WHPP={...WHPP,currentMembershipConsistent:whppMembershipOk,membershipReason:text(counts._whppMembershipReason),completionPolicy:V322_WHPP_COMPLETION_PARITY_ID};
  timing.whppMs=Number(elapsed(whppStarted).toFixed(3));timing.totalMs=Number(elapsed(totalStarted).toFixed(3));
  const result={
    ok:true,coreStatusId:PROCESSING_STATUS_CORE_ID,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,
    completedFastPath:`${V322_COMPLETED_FAST_PATH_ID}+${V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID}+${V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID}+${CURRENT_MEMBER_POD_TERMINAL_ID}`,
    v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,v424SameLifecycleCompletionId:V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID,
    reportDate:date,batchId:text(batch?.batchId),sourceSnapshotId:snapshotId,lifecycleBoundary:boundary,
    complete:[CCSL,SHOPEE,WHPP].every(stage=>stage.complete===true),stages:{CCSL,SHOPEE,WHPP},counts,
    statusDiagnostics:timing,generatedAt:new Date().toISOString()
  };
  if(timing.totalMs>750)console.warn('[CE-QC][CORE_PROCESSING_STATUS_SLOW]',JSON.stringify({reportDate:date,snapshotId,totalMs:timing.totalMs,...timing}));
  return result;
}

export function readSevenBusinessStatus({reportDate='',db=getDb(),force=false}={}){
  const requested=dateOnly(reportDate),batch=latestValidProcessingBatch(db,requested),date=requested||dateOnly(batch?.reportDate);
  if(!date||!batch)return{ok:true,coreStatusId:PROCESSING_STATUS_CORE_ID,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,v424SameLifecycleCompletionId:V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID,reportDate:date||'',complete:false,stages:{CCSL:{key:'CCSL',complete:false},SHOPEE:{key:'SHOPEE',complete:false},WHPP:{key:'WHPP',complete:false,completionPolicy:V322_WHPP_COMPLETION_PARITY_ID,restartInterrupted:false,restartRecovery:null}},statusDiagnostics:{id:V419_STATUS_TIMING_ID,totalMs:0,reason:'CURRENT_VALID_BATCH_MISSING'},generatedAt:new Date().toISOString()};
  const cacheKey=`${date}:${text(batch.snapshotId)}`,cached=cache.get(cacheKey);
  if(!force&&cached&&Date.now()-cached.at<cached.ttl)return{...cached.value,cacheHit:true,statusDiagnostics:{...cached.value.statusDiagnostics,cacheHit:true,cacheAgeMs:Date.now()-cached.at}};
  const value=buildStatus(db,date,batch),ttl=value.complete?COMPLETE_CACHE_MS:INCOMPLETE_CACHE_MS;
  cache.set(cacheKey,{value,at:Date.now(),ttl});
  if(cache.size>24){for(const [key,item] of cache){if(Date.now()-item.at>COMPLETE_CACHE_MS*2)cache.delete(key);}}
  return{...value,cacheHit:false};
}

export function readRunProgress(businessType='CCSL',db=getDb(),reportDate=''){
  const type=text(businessType).toUpperCase(),all=readSevenBusinessStatus({reportDate,db});
  if(type==='ALL')return all;
  const key=type==='SHOPEE'?'SHOPEE':type==='WHPP'?'WHPP':'CCSL',stage=all.stages?.[key]||{};
  return{ok:true,coreStatusId:PROCESSING_STATUS_CORE_ID,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,v419ScalarStatusId:V419_SCALAR_STATUS_PRIORITY_ID,v424SameLifecycleCompletionId:V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID,businessType:key,...stage,dailyTotal:n(stage.sourceTotal),podLockSkipped:key==='CCSL'?n(stage.podLockCount):0,statusDiagnostics:all.statusDiagnostics,generatedAt:new Date().toISOString()};
}

export function clearProcessingStatusCache(){cache.clear();}
