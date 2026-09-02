import express from 'express';
import { getDb } from './db.js';
import { readV415CurrentProcessingProof, V418_STATUS_PROOF_FAST_PATH_ID } from './v415RetroactiveCompletionGuard.js';

export const V322_WEB_AVAILABILITY_ID='2026-09-02-v414-persisted-three-stage-status-v1';
export const V322_SEVEN_BUSINESS_STATUS_ID='2026-09-02-v414-one-read-seven-business-status-v1';
export const V322_WHPP_COMPLETION_PARITY_ID='2026-09-02-v414-whpp-success-evidence-parity-v1';
export const V322_COMPLETED_FAST_PATH_ID='2026-09-02-v322-unified-completed-snapshot-fast-path-v1';
export const V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID='2026-09-02-v418-v322-no-payload-completed-claim-v1';
const previousGet=express.application.get;
const COMPLETE_SNAPSHOT=new Set(['COMPLETED','COMPLETED_WITH_RETRY']);
const MAX_STATUS_STATE_BYTES=2*1024*1024;
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const first=(...values)=>{for(const v of values)if(v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v)))return Number(v);return 0;};
const text=v=>String(v??'').trim();
const safeJson=v=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||'{}'))||{});}catch{return{};}};
const has=v=>v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v));
const normalizeDate=v=>{const s=text(v).replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function bounded(totalValue,doneValue,retryValue,observedValue){const total=Math.max(0,n(totalValue)),done=Math.min(total,Math.max(0,n(doneValue))),retry=Math.min(Math.max(0,total-done),Math.max(0,n(retryValue))),observed=Math.min(total,Math.max(done+retry,n(observedValue)));return{total,done,retry,observed};}
function atOrAfter(value,boundary){const limit=Date.parse(text(boundary));if(!Number.isFinite(limit))return true;const actual=Date.parse(text(value));return Number.isFinite(actual)&&actual>=limit;}
function latestValid(db,reportDate=''){
  try{
    const date=normalizeDate(reportDate);
    return date
      ?(db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,rowid DESC LIMIT 1").get(date)||{})
      :(db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,rowid DESC LIMIT 1").get()||{});
  }catch{return{};}
}
function latestShopeeDate(db){try{return text(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='SHOPEE' ORDER BY updatedAt DESC,reportDate DESC LIMIT 1").get()?.reportDate);}catch{return'';}}
function latestWhppDate(db){try{return text(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP' ORDER BY updatedAt DESC,reportDate DESC LIMIT 1").get()?.reportDate);}catch{return'';}}
function sourceHeader(db,type,date){
  try{
    if(type==='CCSL'){
      const row=db.prepare('SELECT pnhCount FROM daily_reports WHERE reportDate=? LIMIT 1').get(date);
      return row?{exists:true,total:Math.max(0,n(row.pnhCount)),source:'daily_reports'}:{exists:false,total:0,source:''};
    }
    const row=db.prepare('SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType=? AND reportDate=? LIMIT 1').get(type,date);
    return row?{exists:true,total:Math.max(0,n(row.totalCount)),summary:safeJson(row.summaryJson,{}),source:'business_daily_reports'}:{exists:false,total:0,summary:{},source:''};
  }catch{return{exists:false,total:0,summary:{},source:''};}
}
function fallbackUnifiedCount(db,type,date,snapshotId){
  if(!snapshotId||!date)return{ok:false,count:0};
  try{
    if(type==='CCSL')return{ok:true,count:n(db.prepare("SELECT COUNT(*) count FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND businessType IN ('CE','CEAF','TBKH','ALI1688')").get(snapshotId,date)?.count)};
    if(type==='SHOPEE')return{ok:true,count:n(db.prepare("SELECT COUNT(*) count FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND businessType IN ('SHOPEECN','SHOPEEVN')").get(snapshotId,date)?.count)};
    if(type==='WHPP')return{ok:true,count:n(db.prepare("SELECT COUNT(*) count FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND businessType='WHPP'").get(snapshotId,date)?.count)};
  }catch{}
  return{ok:false,count:0};
}
function stageSource(db,type,date,batch){
  const header=sourceHeader(db,type,date),snapshotId=text(batch?.snapshotId);
  if(header.exists&&header.total>0)return{...header,zeroProven:false,membershipVerified:false};
  const fallback=fallbackUnifiedCount(db,type,date,snapshotId);
  if(header.exists){
    if(fallback.ok&&fallback.count>0)return{...header,total:fallback.count,source:`${header.source}+unified_import_rows_zero_mismatch_recovery`,zeroProven:false,membershipVerified:true,headerTotal:header.total};
    return{...header,zeroProven:Boolean(snapshotId&&fallback.ok&&fallback.count===0),membershipVerified:Boolean(fallback.ok),headerTotal:header.total};
  }
  return{...header,total:fallback.count,source:fallback.ok?'unified_import_rows_fallback':'missing_source_header',zeroProven:Boolean(snapshotId&&fallback.ok&&fallback.count===0),membershipVerified:Boolean(fallback.ok)};
}
function runLock(db,type,date){
  try{
    if(type==='CCSL')return db.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM run_locks WHERE reportDate=? LIMIT 1').get(date)||null;
    return db.prepare('SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,lockedAt,updatedAt,completedAt FROM business_run_locks WHERE businessType=? AND reportDate=? LIMIT 1').get(type,date)||null;
  }catch{return null;}
}
function lockForLifecycle(lock,boundary){if(!lock)return null;if(!boundary)return lock;return atOrAfter(lock.lockedAt||lock.updatedAt,boundary)?lock:null;}
function exactCompletionSnapshot(db,type,date,runId,boundary){
  const id=text(runId);if(!id)return null;
  try{
    if(type==='CCSL'){
      const row=db.prepare(`SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM export_snapshots
        WHERE reportDate=? AND runId=? AND snapshotType='dashboard'
          AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
        ORDER BY id DESC LIMIT 1`).get(date,id)||null;
      return row&&atOrAfter(row.generatedAt,boundary)?row:null;
    }
    if(type==='SHOPEE'){
      const row=db.prepare(`SELECT snapshotId,runId,generatedAt,status,reconciliationStatus FROM business_export_snapshots
        WHERE businessType='SHOPEE' AND reportDate=? AND runId=?
          AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
        ORDER BY id DESC LIMIT 1`).get(date,id)||null;
      return row&&atOrAfter(row.generatedAt,boundary)?row:null;
    }
  }catch{}
  return null;
}
function latestCheckpoint(db,type,date,runId){if(!runId)return{};try{return type==='SHOPEE'||type==='WHPP'?(db.prepare('SELECT payloadJson,stage,batchIndex,totalBatches,status,errorMessage,updatedAt FROM business_run_checkpoints WHERE businessType=? AND reportDate=? AND runId=? ORDER BY updatedAt DESC,id DESC LIMIT 1').get(type,date,runId)||{}):(db.prepare('SELECT payloadJson,stage,batchIndex,totalBatches,status,errorMessage,updatedAt FROM run_checkpoints WHERE reportDate=? AND runId=? ORDER BY updatedAt DESC,rowid DESC LIMIT 1').get(date,runId)||{});}catch{return{};}}
function baseStage(type,date,source,lock,checkpoint={}){
  const payload=safeJson(checkpoint.payloadJson),last=payload.lastRunSummary||{};
  const scanTotal=has(payload.scanTotal)?n(payload.scanTotal):has(last.scanPool)?n(last.scanPool):source.total;
  const trackTotal=has(payload.trackTotal)?n(payload.trackTotal):has(last.needTrack)?n(last.needTrack):Math.max(0,first(payload.trackDone,payload.trackResults)+first(payload.trackRetry,last.trackRetry));
  const scan=bounded(scanTotal,first(payload.scanDone,payload.scanResults),first(payload.scanRetry,last.scanRetry),first(payload.scanObserved));
  const track=bounded(trackTotal,first(payload.trackDone,payload.trackResults),first(payload.trackRetry,last.trackRetry),first(payload.trackObserved));
  const phase=text(lock?.currentStage||checkpoint.stage)||'待处理',isTrack=/轨迹|track|shipment-event|exception-item/i.test(phase),status=text(lock?.status).toLowerCase();
  return{key:type,label:type==='SHOPEE'?'SHOPEE CN/VN':(type==='WHPP'?'WHPP本土':'CCSL'),reportDate:date,sourceTotal:source.total,sourceHeader:source.source,sourceMembershipVerified:source.membershipVerified===true,runId:text(lock?.runId),runStatus:status,phase,batchIndex:first(lock?.batchIndex,checkpoint.batchIndex),totalBatches:first(lock?.totalBatches,checkpoint.totalBatches),lastMessage:text(lock?.errorMessage||checkpoint.errorMessage),running:status==='running',paused:status==='paused',failed:status==='failed',scanDone:scan.done,scanRetry:scan.retry,scanTotal:scan.total,trackDone:track.done,trackRetry:track.retry,trackTotal:track.total,done:isTrack?track.done:scan.done,retry:isTrack?track.retry:scan.retry,total:isTrack?track.total:scan.total};
}
function readCcslStage(db,date,batch){
  const source=stageSource(db,'CCSL',date,batch),raw=runLock(db,'CCSL',date),lock=lockForLifecycle(raw,text(batch?.createdAt)),checkpoint=latestCheckpoint(db,'CCSL',date,text(lock?.runId)),stage=baseStage('CCSL',date,source,lock,checkpoint);
  const zero=source.zeroProven===true,snapshot=zero?null:exactCompletionSnapshot(db,'CCSL',date,text(lock?.runId),text(batch?.createdAt));
  return{...stage,complete:zero||Boolean(snapshot),zeroTicketDay:zero,snapshotId:text(snapshot?.snapshotId),lifecycleBoundary:text(batch?.createdAt),staleRunIgnored:Boolean(raw&&!lock&&batch?.createdAt),statusSource:'PERSISTED_DAILY_HEADER_RUN_LOCK_SNAPSHOT'};
}
function readShopeeStage(db,date,batch){
  const source=stageSource(db,'SHOPEE',date,batch),raw=runLock(db,'SHOPEE',date),lock=lockForLifecycle(raw,text(batch?.createdAt)),checkpoint=latestCheckpoint(db,'SHOPEE',date,text(lock?.runId)),stage=baseStage('SHOPEE',date,source,lock,checkpoint);
  const zero=source.zeroProven===true,snapshot=zero?null:exactCompletionSnapshot(db,'SHOPEE',date,text(lock?.runId),text(batch?.createdAt));
  return{...stage,complete:zero||Boolean(snapshot),zeroTicketDay:zero,snapshotId:text(snapshot?.snapshotId),lifecycleBoundary:text(batch?.createdAt),staleRunIgnored:Boolean(raw&&!lock&&batch?.createdAt),statusSource:'PERSISTED_DAILY_HEADER_RUN_LOCK_SNAPSHOT'};
}
function whppStandardMembership(db,date){
  try{
    const daily=db.prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);
    if(!daily)return{present:false,expected:0,actual:0,memberCount:0,summary:{},finalized:false,finalizedSnapshotId:'',finalizedStatus:'',sourceSnapshotId:''};
    const expected=Math.max(0,n(daily.totalCount));
    const actual=n(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(date)?.count);
    const summary=safeJson(daily.summaryJson,{}),finalizedStatus=text(summary.snapshotStatus||summary.reconciliationStatus).toUpperCase(),finalizedSnapshotId=text(summary.finalizedSnapshotId),sourceSnapshotId=text(summary.snapshotId||summary.batchId||summary.sourceSnapshotId);
    const finalized=expected===actual&&summary.completed===true&&COMPLETE_SNAPSHOT.has(finalizedStatus)&&Boolean(finalizedSnapshotId);
    return{present:expected===actual,expected,actual,memberCount:actual,summary,finalized,finalizedSnapshotId,finalizedStatus,sourceSnapshotId};
  }catch{return{present:false,expected:0,actual:0,memberCount:0,summary:{},finalized:false,finalizedSnapshotId:'',finalizedStatus:'',sourceSnapshotId:''};}
}
function smallWhppState(db){
  try{
    const meta=db.prepare("SELECT length(CAST(valueJson AS BLOB)) bytes FROM business_states WHERE businessType='WHPP' LIMIT 1").get()||{};
    if(n(meta.bytes)>MAX_STATUS_STATE_BYTES)return{ok:false,state:{},reason:'WHPP_STATE_TOO_LARGE_FAIL_CLOSED'};
    const raw=db.prepare("SELECT valueJson FROM business_states WHERE businessType='WHPP' LIMIT 1").get()?.valueJson;
    return{ok:true,state:safeJson(raw),reason:'WHPP_SMALL_STATE'};
  }catch{return{ok:false,state:{},reason:'WHPP_STATE_READ_FAILED'};}
}
function whppLifecycleCompletion(db,date,memberCount,sourceSnapshotId=''){
  const loaded=smallWhppState(db);
  if(!loaded.ok)return{complete:false,stateDate:'',snapshotStatus:'',snapshotId:'',stateSourceSnapshotId:'',stateMemberCount:0,sourceMatches:false,stateReadReason:loaded.reason};
  const state=loaded.state,stateDate=normalizeDate(state.reportDate),snapshotStatus=text(state.snapshotStatus).toUpperCase(),snapshotId=text(state.snapshotId),stateSourceSnapshotId=text(state.sourceSnapshotId),stateMemberCount=Array.isArray(state.pnhBills)?state.pnhBills.length:0,sourceMatches=!sourceSnapshotId||stateSourceSnapshotId===sourceSnapshotId;
  return{complete:Boolean(stateDate===date&&stateMemberCount===n(memberCount)&&sourceMatches&&COMPLETE_SNAPSHOT.has(snapshotStatus)&&snapshotId),stateDate,snapshotStatus,snapshotId,stateSourceSnapshotId,stateMemberCount,sourceMatches,stateReadReason:loaded.reason};
}
function whppRestartRecovery(db,date){
  const loaded=smallWhppState(db);
  if(!loaded.ok)return{interrupted:false,reportDate:date,runId:'',reason:loaded.reason,detectedAt:'',source:'',revision:'',marker:null};
  try{
    const state=loaded.state,stateDate=normalizeDate(state.reportDate),marker=state.restartRecovery&&typeof state.restartRecovery==='object'?state.restartRecovery:{},markerDate=normalizeDate(marker.reportDate),markerRunId=text(marker.runId),stateRunId=text(state?.processing?.runId||state?.lastRunSummary?.runId||state?.lastRun?.runId),reason=text(marker.reason).toUpperCase(),snapshotStatus=text(state.snapshotStatus).toUpperCase(),finalized=COMPLETE_SNAPSHOT.has(snapshotStatus)&&Boolean(text(state.snapshotId));
    const interrupted=Boolean(date&&stateDate===date&&markerDate===date&&reason==='PROCESS_RESTART_INTERRUPTED'&&markerRunId&&stateRunId===markerRunId&&state?.processing?.running!==true&&!finalized);
    return{interrupted,reportDate:date,runId:markerRunId,reason:interrupted?'PROCESS_RESTART_INTERRUPTED':'NO_EXACT_WHPP_RESTART_INTERRUPTION',detectedAt:text(marker.detectedAt),source:text(marker.source),revision:text(marker.revision),marker:interrupted?marker:null};
  }catch{return{interrupted:false,reportDate:date,runId:'',reason:'WHPP_RESTART_PROOF_READ_FAILED',detectedAt:'',source:'',revision:'',marker:null};}
}
function whppFinalEvidenceCount(db,date,{standardPresent=false,snapshotId=''}={}){
  try{
    if(standardPresent){
      return n(db.prepare(`SELECT COUNT(DISTINCT d.shipmentCode) count
        FROM business_daily_parse_rows d
        WHERE d.businessType='WHPP' AND d.reportDate=?
          AND EXISTS(SELECT 1 FROM business_final_rows f
            WHERE f.businessType='WHPP' AND f.shipmentCode=d.shipmentCode AND f.reportDate=?
              AND UPPER(COALESCE(f.apiStatus,''))='SUCCESS')`).get(date,date)?.count);
    }
    if(snapshotId){
      return n(db.prepare(`SELECT COUNT(*) count
        FROM unified_import_rows u
        JOIN business_final_rows f ON f.businessType='WHPP' AND f.shipmentCode=u.shipmentCode AND f.reportDate=?
        WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType='WHPP' AND UPPER(COALESCE(f.apiStatus,''))='SUCCESS'`).get(date,snapshotId,date)?.count);
    }
  }catch{}
  return 0;
}
function whppCompletionDecision({standard,lifecycle,exactZero=false,memberCount=0,finalEvidenceRows=0,membershipVerified=false,batchSnapshotId=''}={}){
  if(standard?.finalized)return{completed:true,snapshotStatus:standard.finalizedStatus||'COMPLETED',completionSource:'CURRENT_DAILY_FINALIZATION_MARKER',snapshotId:standard.finalizedSnapshotId};
  if(lifecycle?.complete)return{completed:true,snapshotStatus:lifecycle.snapshotStatus||'COMPLETED',completionSource:'CURRENT_FINALIZED_WHPP_STATE',snapshotId:lifecycle.snapshotId};
  if(exactZero)return{completed:true,snapshotStatus:'COMPLETED',completionSource:'EXACT_ZERO_CURRENT_UNIFIED_MEMBERSHIP',snapshotId:batchSnapshotId};
  if(membershipVerified&&n(memberCount)>0&&n(finalEvidenceRows)>=n(memberCount))return{completed:true,snapshotStatus:'COMPLETED',completionSource:'FULL_MEMBER_SUCCESS_EVIDENCE',snapshotId:batchSnapshotId};
  return{completed:false,snapshotStatus:n(memberCount)>0?'PENDING':'EMPTY',completionSource:'PENDING',snapshotId:''};
}
function readWhppStage(db,date,batch){
  const rawSource=stageSource(db,'WHPP',date,batch),standard=whppStandardMembership(db,date),batchSnapshotId=text(batch?.snapshotId),exactUnified=fallbackUnifiedCount(db,'WHPP',date,batchSnapshotId);
  const standardCurrent=Boolean(standard.present&&(!batchSnapshotId||!exactUnified.ok||standard.memberCount===exactUnified.count));
  const memberCount=standardCurrent?standard.memberCount:(exactUnified.ok?exactUnified.count:rawSource.total);
  const membershipVerified=Boolean(standardCurrent||(batchSnapshotId&&exactUnified.ok));
  const source={...rawSource,total:memberCount,membershipVerified,source:standardCurrent?'WHPP_STANDARD_DAILY_CURRENT':(exactUnified.ok?'WHPP_CURRENT_UNIFIED_MEMBERSHIP':rawSource.source)};
  const raw=runLock(db,'WHPP',date),lock=lockForLifecycle(raw,text(batch?.createdAt)),checkpoint=latestCheckpoint(db,'WHPP',date,text(lock?.runId)),stage=baseStage('WHPP',date,source,lock,checkpoint);
  const currentStandard=standardCurrent?standard:{...standard,present:false,finalized:false};
  const lifecycle=standardCurrent?whppLifecycleCompletion(db,date,memberCount,currentStandard.sourceSnapshotId):{complete:false};
  const exactZero=Boolean(batchSnapshotId&&exactUnified.ok&&exactUnified.count===0);
  let finalEvidenceRows=0;
  if(!currentStandard.finalized&&!lifecycle.complete&&!exactZero&&membershipVerified&&memberCount>0){
    finalEvidenceRows=whppFinalEvidenceCount(db,date,{standardPresent:standardCurrent.present,snapshotId:standardCurrent?'':batchSnapshotId});
  }
  const decision=whppCompletionDecision({standard:currentStandard,lifecycle,exactZero,memberCount,finalEvidenceRows,membershipVerified,batchSnapshotId});
  const restart=whppRestartRecovery(db,date),restartInterrupted=Boolean(!decision.completed&&restart.interrupted);
  return{...stage,runId:restartInterrupted?restart.runId:stage.runId,runStatus:restartInterrupted?'restart_interrupted':stage.runStatus,phase:restartInterrupted?'WHPP等待断点恢复':stage.phase,lastMessage:restartInterrupted?'PROCESS_RESTART_INTERRUPTED':stage.lastMessage,running:false,failed:restartInterrupted?false:stage.failed,complete:decision.completed,zeroTicketDay:exactZero,snapshotId:text(decision.snapshotId),snapshotStatus:decision.snapshotStatus,completionSource:decision.completionSource,completionPolicy:V322_WHPP_COMPLETION_PARITY_ID,finalEvidenceRows,restartInterrupted,restartRecovery:restartInterrupted?restart:null,lifecycleBoundary:text(batch?.createdAt),staleRunIgnored:Boolean(raw&&!lock&&batch?.createdAt),standardMembershipPresent:standard.present,standardMembershipCurrent:standardCurrent,standardExpected:standard.expected,standardActual:standard.actual,currentMembershipConsistent:membershipVerified,statusSource:'PERSISTED_WHPP_V414_SUCCESS_AND_RESTART_PROOF'};
}
function completedStage(type,date,total,snapshotId,boundary){
  const label=type==='SHOPEE'?'SHOPEE CN/VN':(type==='WHPP'?'WHPP本土':'CCSL');
  return{key:type,label,reportDate:date,sourceTotal:Math.max(0,n(total)),sourceHeader:'unified_snapshots',sourceMembershipVerified:true,runId:'',runStatus:'completed',phase:'已完成',batchIndex:0,totalBatches:0,lastMessage:'',running:false,paused:false,failed:false,scanDone:0,scanRetry:0,scanTotal:0,trackDone:0,trackRetry:0,trackTotal:0,done:0,retry:0,total:0,complete:true,zeroTicketDay:Math.max(0,n(total))===0,snapshotId,snapshotStatus:'COMPLETED',completionSource:'UNIFIED_COMPLETED_SNAPSHOT',restartInterrupted:false,restartRecovery:null,lifecycleBoundary:boundary,statusSource:'UNIFIED_COMPLETED_SNAPSHOT_FAST_PATH'};
}
function proofClaimStage(type,date,total,snapshotId,boundary,proofStage={}){
  if(proofStage.complete===true){
    return{...completedStage(type,date,total,snapshotId,boundary),completionSource:'V418_CURRENT_MEMBER_PROCESSING_PROOF',statusSource:'V418_NO_PAYLOAD_COMPLETED_CLAIM'};
  }
  const lock=proofStage.lock||{},status=text(lock.status).toLowerCase();
  return{...completedStage(type,date,total,'',boundary),complete:false,zeroTicketDay:false,snapshotId:'',snapshotStatus:'PENDING',runId:text(lock.runId),runStatus:status||'status_unconfirmed',phase:text(lock.currentStage)||'待处理',running:status==='running',paused:status==='paused',failed:status==='failed',completionSource:'V418_CURRENT_MEMBER_PROCESSING_PROOF_REQUIRED',statusSource:'V418_NO_PAYLOAD_COMPLETED_CLAIM'};
}
function unifiedCompletedFastPath(db,date,batch){
  const snapshotId=text(batch?.snapshotId),boundary=text(batch?.createdAt);
  if(!snapshotId||!date)return null;
  try{
    const status=text(db.prepare("SELECT status FROM unified_snapshots WHERE snapshotId=? AND reportDate=? LIMIT 1").get(snapshotId,date)?.status).toUpperCase();
    if(status!=='COMPLETED')return null;
    const proof=readV415CurrentProcessingProof({db,reportDate:date});
    const counts=proof?.counts||{},CCSL=proofClaimStage('CCSL',date,n(counts.CCSL),snapshotId,boundary,proof?.stages?.CCSL||{}),SHOPEE=proofClaimStage('SHOPEE',date,n(counts.SHOPEE),snapshotId,boundary,proof?.stages?.SHOPEE||{}),WHPP=proofClaimStage('WHPP',date,n(counts.WHPP),snapshotId,boundary,proof?.stages?.WHPP||{});
    return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,completedFastPath:`${V322_COMPLETED_FAST_PATH_ID}+${V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID}`,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,reportDate:date,batchId:text(batch.batchId),sourceSnapshotId:snapshotId,lifecycleBoundary:boundary,complete:Boolean(proof?.ok&&[CCSL,SHOPEE,WHPP].every(stage=>stage.complete===true)),stages:{CCSL,SHOPEE,WHPP},generatedAt:new Date().toISOString()};
  }catch{return null;}
}
export function readV322SevenBusinessStatus({reportDate='',db=getDb()}={}){
  const requested=normalizeDate(reportDate),batch=latestValid(db,requested),date=requested||normalizeDate(batch.reportDate)||latestShopeeDate(db)||latestWhppDate(db);
  if(!date)return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,reportDate:'',complete:false,stages:{CCSL:{key:'CCSL',complete:false},SHOPEE:{key:'SHOPEE',complete:false},WHPP:{key:'WHPP',complete:false,restartInterrupted:false,restartRecovery:null}},generatedAt:new Date().toISOString()};
  const exactBatch=normalizeDate(batch.reportDate)===date?batch:latestValid(db,date);
  const completed=unifiedCompletedFastPath(db,date,exactBatch);
  if(completed)return completed;
  const CCSL=readCcslStage(db,date,exactBatch),SHOPEE=readShopeeStage(db,date,exactBatch),WHPP=readWhppStage(db,date,exactBatch);
  return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,reportDate:date,batchId:text(exactBatch.batchId),sourceSnapshotId:text(exactBatch.snapshotId),lifecycleBoundary:text(exactBatch.createdAt),complete:[CCSL,SHOPEE,WHPP].every(stage=>stage.complete===true),stages:{CCSL,SHOPEE,WHPP},generatedAt:new Date().toISOString()};
}
export function readV322RunProgress(businessType='CCSL',db=getDb(),reportDate=''){
  const type=text(businessType).toUpperCase();
  if(type==='ALL')return readV322SevenBusinessStatus({reportDate,db});
  const all=readV322SevenBusinessStatus({reportDate,db});
  const key=type==='SHOPEE'?'SHOPEE':type==='WHPP'?'WHPP':'CCSL',stage=all.stages?.[key]||{};
  return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,businessType:key,...stage,dailyTotal:n(stage.sourceTotal),podLockSkipped:Math.max(0,n(stage.sourceTotal)-n(stage.scanTotal)),generatedAt:new Date().toISOString()};
}
function progressHandler(req,res){
  const started=Date.now();
  try{
    res.setHeader('Cache-Control','private,max-age=1');
    res.setHeader('X-CE-QC-V322',V322_WEB_AVAILABILITY_ID);
    res.setHeader('X-CE-QC-V322-Seven-Status',V322_SEVEN_BUSINESS_STATUS_ID);
    res.setHeader('X-CE-QC-V322-WHPP-Completion',V322_WHPP_COMPLETION_PARITY_ID);
    res.setHeader('X-CE-QC-V418-Status-Fast-Path',V418_STATUS_PROOF_FAST_PATH_ID);
    const data=readV322RunProgress(req.query.businessType||'CCSL',getDb(),req.query.reportDate||'');
    res.setHeader('Server-Timing',`v322progress;dur=${Date.now()-started}`);
    return res.json(data);
  }catch(error){
    res.setHeader('Server-Timing',`v322progress;dur=${Date.now()-started}`);
    return res.status(200).json({ok:false,code:'V322_PERSISTED_STATUS_READ_FAILED',version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,whppCompletionPolicy:V322_WHPP_COMPLETION_PARITY_ID,v418FastPathId:V418_STATUS_PROOF_FAST_PATH_ID,businessType:text(req.query.businessType).toUpperCase()||'CCSL',reportDate:normalizeDate(req.query.reportDate),error:text(error?.message||error),generatedAt:new Date().toISOString()});
  }
}
express.application.get=function v322AvailabilityGet(pathValue,...handlers){if(String(pathValue||'')==='/api/v33/run-progress')return previousGet.call(this,pathValue,progressHandler);return previousGet.call(this,pathValue,...handlers);};
console.info('[CE-QC][V322_WEB_AVAILABILITY]',V322_WEB_AVAILABILITY_ID,V322_SEVEN_BUSINESS_STATUS_ID,V322_WHPP_COMPLETION_PARITY_ID,V322_COMPLETED_FAST_PATH_ID,V418_V322_LIGHTWEIGHT_COMPLETED_CLAIM_ID,V418_STATUS_PROOF_FAST_PATH_ID,'V418 never materializes old unified snapshot payload JSON during status reads; legacy completed claims are immediately checked against current-member processing proof, and oversized legacy WHPP state JSON fails closed.');