import express from 'express';
import { getDb } from './db.js';

export const V322_WEB_AVAILABILITY_ID='2026-09-02-v322-persisted-three-stage-status-v4';
export const V322_SEVEN_BUSINESS_STATUS_ID='2026-09-02-v322-one-read-seven-business-status-v1';
const previousGet=express.application.get;
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
function lockForLifecycle(lock,boundary){
  if(!lock)return null;
  if(!boundary)return lock;
  return atOrAfter(lock.lockedAt||lock.updatedAt,boundary)?lock:null;
}
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
function readWhppStage(db,date,batch){
  const source=stageSource(db,'WHPP',date,batch),raw=runLock(db,'WHPP',date),lock=lockForLifecycle(raw,text(batch?.createdAt)),checkpoint=latestCheckpoint(db,'WHPP',date,text(lock?.runId)),stage=baseStage('WHPP',date,source,lock,checkpoint),summary=source.summary||{};
  const status=text(summary.snapshotStatus||summary.reconciliationStatus).toUpperCase();
  const finalizedSnapshotId=text(summary.finalizedSnapshotId),explicitComplete=summary.completed===true&&['COMPLETED','COMPLETED_WITH_RETRY'].includes(status)&&Boolean(finalizedSnapshotId);
  const zero=source.zeroProven===true;
  return{...stage,complete:zero||explicitComplete,zeroTicketDay:zero,snapshotId:finalizedSnapshotId,snapshotStatus:status,finalizedAt:text(summary.finalizedAt),lifecycleBoundary:text(batch?.createdAt),staleRunIgnored:Boolean(raw&&!lock&&batch?.createdAt),statusSource:'PERSISTED_WHPP_DAILY_FINALIZATION_HEADER'};
}
export function readV322SevenBusinessStatus({reportDate='',db=getDb()}={}){
  const requested=normalizeDate(reportDate),batch=latestValid(db,requested),date=requested||normalizeDate(batch.reportDate)||latestShopeeDate(db)||latestWhppDate(db);
  if(!date)return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,reportDate:'',complete:false,stages:{CCSL:{key:'CCSL',complete:false},SHOPEE:{key:'SHOPEE',complete:false},WHPP:{key:'WHPP',complete:false}},generatedAt:new Date().toISOString()};
  const exactBatch=normalizeDate(batch.reportDate)===date?batch:latestValid(db,date);
  const CCSL=readCcslStage(db,date,exactBatch),SHOPEE=readShopeeStage(db,date,exactBatch),WHPP=readWhppStage(db,date,exactBatch);
  return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,reportDate:date,batchId:text(exactBatch.batchId),sourceSnapshotId:text(exactBatch.snapshotId),lifecycleBoundary:text(exactBatch.createdAt),complete:[CCSL,SHOPEE,WHPP].every(stage=>stage.complete===true),stages:{CCSL,SHOPEE,WHPP},generatedAt:new Date().toISOString()};
}
export function readV322RunProgress(businessType='CCSL',db=getDb(),reportDate=''){
  const type=text(businessType).toUpperCase();
  if(type==='ALL')return readV322SevenBusinessStatus({reportDate,db});
  const all=readV322SevenBusinessStatus({reportDate,db});
  const key=type==='SHOPEE'?'SHOPEE':type==='WHPP'?'WHPP':'CCSL',stage=all.stages?.[key]||{};
  return{ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,businessType:key,...stage,dailyTotal:n(stage.sourceTotal),podLockSkipped:Math.max(0,n(stage.sourceTotal)-n(stage.scanTotal)),generatedAt:new Date().toISOString()};
}
function progressHandler(req,res){const started=Date.now();try{res.setHeader('Cache-Control','private,max-age=1');res.setHeader('X-CE-QC-V322',V322_WEB_AVAILABILITY_ID);res.setHeader('X-CE-QC-V322-Seven-Status',V322_SEVEN_BUSINESS_STATUS_ID);const data=readV322RunProgress(req.query.businessType||'CCSL',getDb(),req.query.reportDate||'');res.setHeader('Server-Timing',`v322progress;dur=${Date.now()-started}`);return res.json(data);}catch(error){return res.status(200).json({ok:true,version:V322_WEB_AVAILABILITY_ID,statusVersion:V322_SEVEN_BUSINESS_STATUS_ID,businessType:text(req.query.businessType).toUpperCase()||'CCSL',reportDate:normalizeDate(req.query.reportDate),running:false,paused:false,phase:'状态读取暂缓',done:0,retry:0,total:0,error:text(error?.message||error),generatedAt:new Date().toISOString()});}}
express.application.get=function v322AvailabilityGet(pathValue,...handlers){if(String(pathValue||'')==='/api/v33/run-progress')return previousGet.call(this,pathValue,progressHandler);return previousGet.call(this,pathValue,...handlers);};
console.info('[CE-QC][V322_WEB_AVAILABILITY]',V322_WEB_AVAILABILITY_ID,V322_SEVEN_BUSINESS_STATUS_ID,'one exact-date persisted read returns CCSL + SHOPEE + WHPP lifecycle truth from daily headers, run locks/checkpoints and finalized snapshot markers; normal positive status never scans scan/final/event fact tables; zero-ticket completion is accepted only after exact unified-import membership proves zero.');