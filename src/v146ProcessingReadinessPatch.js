import express from 'express';
import { getDb } from './db.js';

export const V146_PROCESSING_READINESS_ID='2026-08-15-v146-processing-readiness-v1';

function dateOnly(value=''){
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function nowIso(){return new Date().toISOString();}
function safe(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return {};}}
function latestShopeeDate(){
  return String(getDb().prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='SHOPEE' ORDER BY reportDate DESC,updatedAt DESC LIMIT 1").get()?.reportDate||'');
}
function latestUnifiedForDate(reportDate){
  return getDb().prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,s.status snapshotStatus,s.payloadJson
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate=?
    ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1
  `).get(reportDate)||null;
}
function sourceCountFromUnified(reportDate){
  const unified=latestUnifiedForDate(reportDate);
  if(!unified?.snapshotId)return 0;
  const row=getDb().prepare(`
    SELECT COUNT(DISTINCT shipmentCode) count
    FROM unified_import_rows
    WHERE snapshotId=? AND businessType IN ('SHOPEECN','SHOPEEVN')
  `).get(unified.snapshotId)||{};
  return Number(row.count||0);
}
function shopeeReadiness(reportDate){
  const date=dateOnly(reportDate)||latestShopeeDate();
  if(!date)return {reportDate:'',imported:false,sourceCount:0,processingComplete:false,status:'NOT_IMPORTED'};
  const db=getDb();
  const daily=db.prepare("SELECT totalCount,updatedAt FROM business_daily_reports WHERE businessType='SHOPEE' AND reportDate=?").get(date)||null;
  const sourceCount=Math.max(Number(daily?.totalCount||0),sourceCountFromUnified(date));
  const scan=db.prepare("SELECT COUNT(DISTINCT shipmentCode) count,SUM(CASE WHEN isPod=1 OR CAST(orderStatus AS TEXT)='85' THEN 1 ELSE 0 END) pod FROM business_scan_results WHERE businessType='SHOPEE' AND reportDate=?").get(date)||{};
  const shipment=db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_shipment_tracks WHERE businessType='SHOPEE' AND reportDate=?").get(date)||{};
  const event=db.prepare("SELECT COUNT(DISTINCT shipmentCode) bills,COUNT(*) count FROM business_track_events WHERE businessType='SHOPEE' AND reportDate=?").get(date)||{};
  const finals=db.prepare("SELECT COUNT(DISTINCT shipmentCode) count,SUM(CASE WHEN isPod=1 THEN 1 ELSE 0 END) pod FROM business_final_rows WHERE businessType='SHOPEE' AND reportDate=?").get(date)||{};
  const run=db.prepare("SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,completedAt,updatedAt FROM business_run_locks WHERE businessType='SHOPEE' AND reportDate=?").get(date)||null;
  const snapshot=db.prepare(`
    SELECT snapshotId,runId,status,reconciliationStatus,invalidReason,createdAt
    FROM business_export_snapshots
    WHERE businessType='SHOPEE' AND reportDate=?
    ORDER BY createdAt DESC,id DESC LIMIT 1
  `).get(date)||null;
  const api=db.prepare(`
    SELECT COUNT(*) batches,
      SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('success','completed','finished') THEN 1 ELSE 0 END) successful,
      SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('failed','error') THEN 1 ELSE 0 END) failed,
      SUM(COALESCE(resultCount,0)) resultCount
    FROM business_api_batches WHERE businessType='SHOPEE' AND reportDate=?
  `).get(date)||{};
  const imported=Boolean(daily)||sourceCount>0;
  const scanCount=Number(scan.count||0),finalCount=Number(finals.count||0);
  const runFinished=String(run?.status||'').toLowerCase()==='finished';
  const snapshotValid=Boolean(snapshot)&&String(snapshot.status||'VALID').toUpperCase()==='VALID'&&String(snapshot.reconciliationStatus||'COMPLETED').toUpperCase()==='COMPLETED';
  // A current-day SHOPEE run is not complete merely because final rows exist.
  // Every imported bill must have passed the confirm-query scan layer. Final rows
  // can be created from import shells, so scan coverage is the authoritative gate.
  const scanComplete=sourceCount===0||scanCount>=sourceCount;
  const finalComplete=sourceCount===0||finalCount>=sourceCount;
  const processingComplete=sourceCount===0?imported:Boolean(imported&&runFinished&&snapshotValid&&scanComplete&&finalComplete);
  const falseCompleted=Boolean(sourceCount>0&&(runFinished||snapshotValid)&&(!scanComplete||!finalComplete));
  return {
    reportDate:date,imported,sourceCount,processingComplete,falseCompleted,
    status:!imported?'NOT_IMPORTED':processingComplete?'COMPLETED':falseCompleted?'FALSE_COMPLETED':'PROCESSING_REQUIRED',
    scanCount,scanPod:Number(scan.pod||0),shipmentCount:Number(shipment.count||0),eventBillCount:Number(event.bills||0),eventCount:Number(event.count||0),
    finalCount,finalPod:Number(finals.pod||0),run,snapshot,
    api:{batches:Number(api.batches||0),successful:Number(api.successful||0),failed:Number(api.failed||0),resultCount:Number(api.resultCount||0)}
  };
}
function resetUnifiedCompletion(reportDate,reason){
  const unified=latestUnifiedForDate(reportDate);
  if(!unified?.snapshotId||String(unified.snapshotStatus||'').toUpperCase()!=='COMPLETED')return 0;
  const payload=safe(unified.payloadJson);
  payload.v146ProcessingRepair={patchId:V146_PROCESSING_READINESS_ID,reason,at:nowIso()};
  const result=getDb().prepare("UPDATE unified_snapshots SET status='IMPORTED',payloadJson=? WHERE snapshotId=? AND status='COMPLETED'").run(JSON.stringify(payload),unified.snapshotId);
  return Number(result.changes||0);
}
export function repairFalseCompletedShopee(reportDate){
  const before=shopeeReadiness(reportDate);
  if(!before.falseCompleted)return {changed:false,before,after:before};
  const db=getDb();
  const reason={
    patchId:V146_PROCESSING_READINESS_ID,
    code:'SHOPEE_PROCESSING_EVIDENCE_INCOMPLETE',
    sourceCount:before.sourceCount,scanCount:before.scanCount,finalCount:before.finalCount,at:nowIso()
  };
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare(`
      UPDATE business_export_snapshots
      SET status='INVALID',reconciliationStatus='FAILED',invalidReason=?
      WHERE businessType='SHOPEE' AND reportDate=? AND COALESCE(status,'VALID')='VALID'
    `).run(JSON.stringify(reason),before.reportDate);
    db.prepare(`
      UPDATE business_run_locks
      SET status='failed',currentStage='待重新处理',errorMessage=?,completedAt='',updatedAt=?
      WHERE businessType='SHOPEE' AND reportDate=?
    `).run('已发现旧快照缺少完整扫描证据，系统将重新执行当日日报处理。',nowIso(),before.reportDate);
    resetUnifiedCompletion(before.reportDate,reason.code);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return {changed:true,before,after:shopeeReadiness(before.reportDate)};
}

function readinessHandler(req,res){
  try{
    const date=dateOnly(req.query.reportDate)||latestShopeeDate();
    const shopee=shopeeReadiness(date);
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,patchId:V146_PROCESSING_READINESS_ID,reportDate:date,SHOPEE:shopee});
  }catch(error){res.status(500).json({ok:false,patchId:V146_PROCESSING_READINESS_ID,error:error?.message||String(error)});}
}

const previousPost=express.application.post;
express.application.post=function v146ProcessingReadinessPost(path,...handlers){
  if(path==='/api/shopee/run/start'&&handlers.length){
    const wrapped=handlers.map(handler=>typeof handler!=='function'?handler:async function v146ShopeeRunStartGuard(req,res,next){
      try{
        const date=latestShopeeDate();
        if(date)repairFalseCompletedShopee(date);
        return await handler.call(this,req,res,next);
      }catch(error){
        if(typeof next==='function')return next(error);
        if(!res.headersSent)return res.status(500).json({ok:false,code:'V146_PROCESSING_REPAIR_FAILED',error:error?.message||String(error)});
      }
    });
    return previousPost.call(this,path,...wrapped);
  }
  return previousPost.call(this,path,...handlers);
};

const previousListen=express.application.listen;
let installed=false;
express.application.listen=function v146ProcessingReadinessListen(...args){
  if(!installed){installed=true;this.get('/api/v146/processing-readiness',readinessHandler);}
  return previousListen.apply(this,args);
};
