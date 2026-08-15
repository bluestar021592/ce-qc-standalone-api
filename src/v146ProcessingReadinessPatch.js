import express from 'express';
import { getDb } from './db.js';

export const V146_PROCESSING_READINESS_ID='2026-08-15-v148-processing-evidence-v2';

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
function sourceEvidence(reportDate){
  const unified=latestUnifiedForDate(reportDate);
  if(!unified?.snapshotId)return {unified,sourceCount:0,podLockCount:0,podLockTimedCount:0,scanCount:0,apiScanCount:0,podLockScanCount:0,scanCoveredCount:0,finalCount:0};
  const row=getDb().prepare(`
    WITH source AS (
      SELECT DISTINCT UPPER(TRIM(u.shipmentCode)) shipmentCode
      FROM unified_import_rows u
      WHERE u.snapshotId=? AND u.businessType IN ('SHOPEECN','SHOPEEVN')
    )
    SELECT
      COUNT(*) sourceCount,
      SUM(CASE WHEN pl.shipmentCode IS NOT NULL THEN 1 ELSE 0 END) podLockCount,
      SUM(CASE WHEN pl.shipmentCode IS NOT NULL AND LENGTH(TRIM(COALESCE(pl.podTime,'')))>=10 THEN 1 ELSE 0 END) podLockTimedCount,
      SUM(CASE WHEN sr.shipmentCode IS NOT NULL THEN 1 ELSE 0 END) scanCount,
      SUM(CASE WHEN sr.shipmentCode IS NOT NULL AND COALESCE(sr.rawJson,'') NOT LIKE '%POD_LOCK%' THEN 1 ELSE 0 END) apiScanCount,
      SUM(CASE WHEN sr.shipmentCode IS NOT NULL AND COALESCE(sr.rawJson,'') LIKE '%POD_LOCK%' THEN 1 ELSE 0 END) podLockScanCount,
      SUM(CASE WHEN sr.shipmentCode IS NOT NULL OR pl.shipmentCode IS NOT NULL THEN 1 ELSE 0 END) scanCoveredCount,
      SUM(CASE WHEN bf.shipmentCode IS NOT NULL THEN 1 ELSE 0 END) finalCount,
      SUM(CASE WHEN bf.isPod=1 THEN 1 ELSE 0 END) finalPod
    FROM source s
    LEFT JOIN business_pod_locks pl ON pl.businessType='SHOPEE' AND UPPER(pl.shipmentCode)=s.shipmentCode
    LEFT JOIN business_scan_results sr ON sr.businessType='SHOPEE' AND sr.reportDate=? AND UPPER(sr.shipmentCode)=s.shipmentCode
    LEFT JOIN business_final_rows bf ON bf.businessType='SHOPEE' AND bf.reportDate=? AND UPPER(bf.shipmentCode)=s.shipmentCode
  `).get(unified.snapshotId,reportDate,reportDate)||{};
  return {
    unified,
    sourceCount:Number(row.sourceCount||0),
    podLockCount:Number(row.podLockCount||0),
    podLockTimedCount:Number(row.podLockTimedCount||0),
    scanCount:Number(row.scanCount||0),
    apiScanCount:Number(row.apiScanCount||0),
    podLockScanCount:Number(row.podLockScanCount||0),
    scanCoveredCount:Number(row.scanCoveredCount||0),
    finalCount:Number(row.finalCount||0),
    finalPod:Number(row.finalPod||0)
  };
}
function shopeeReadiness(reportDate){
  const date=dateOnly(reportDate)||latestShopeeDate();
  if(!date)return {reportDate:'',imported:false,sourceCount:0,processingComplete:false,status:'NOT_IMPORTED'};
  const db=getDb();
  const daily=db.prepare("SELECT totalCount,updatedAt FROM business_daily_reports WHERE businessType='SHOPEE' AND reportDate=?").get(date)||null;
  const evidence=sourceEvidence(date);
  const sourceCount=Math.max(Number(daily?.totalCount||0),evidence.sourceCount);
  const shipment=db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_shipment_tracks WHERE businessType='SHOPEE' AND reportDate=?").get(date)||{};
  const event=db.prepare("SELECT COUNT(DISTINCT shipmentCode) bills,COUNT(*) count FROM business_track_events WHERE businessType='SHOPEE' AND reportDate=?").get(date)||{};
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
  const scanCount=evidence.scanCount,finalCount=evidence.finalCount;
  const runFinished=String(run?.status||'').toLowerCase()==='finished';
  const snapshotValid=Boolean(snapshot)&&String(snapshot.status||'VALID').toUpperCase()==='VALID'&&String(snapshot.reconciliationStatus||'COMPLETED').toUpperCase()==='COMPLETED';
  // Current-day coverage may be satisfied either by a real confirm-query result or
  // by a previously persisted terminal POD lock. POD-locked bills are intentionally
  // not queried again. Distinguish those two paths in diagnostics so 0 track batches
  // is never misreported as "nothing processed".
  const scanComplete=sourceCount===0||evidence.scanCoveredCount>=sourceCount;
  const finalComplete=sourceCount===0||finalCount>=sourceCount;
  const processingComplete=sourceCount===0?imported:Boolean(imported&&runFinished&&snapshotValid&&scanComplete&&finalComplete);
  const falseCompleted=Boolean(sourceCount>0&&(runFinished||snapshotValid)&&(!scanComplete||!finalComplete));
  const expectedApiScanCount=Math.max(0,sourceCount-evidence.podLockCount);
  return {
    reportDate:date,imported,sourceCount,processingComplete,falseCompleted,
    status:!imported?'NOT_IMPORTED':processingComplete?'COMPLETED':falseCompleted?'FALSE_COMPLETED':'PROCESSING_REQUIRED',
    scanCount,apiScanCount:evidence.apiScanCount,podLockScanCount:evidence.podLockScanCount,
    podLockCount:evidence.podLockCount,podLockTimedCount:evidence.podLockTimedCount,
    podLockUnknownTimeCount:Math.max(0,evidence.podLockCount-evidence.podLockTimedCount),
    expectedApiScanCount,scanCoveredCount:evidence.scanCoveredCount,
    shipmentCount:Number(shipment.count||0),eventBillCount:Number(event.bills||0),eventCount:Number(event.count||0),
    finalCount,finalPod:evidence.finalPod,run,snapshot,
    api:{batches:Number(api.batches||0),successful:Number(api.successful||0),failed:Number(api.failed||0),resultCount:Number(api.resultCount||0)},
    coveragePolicy:'API_SCAN_OR_TERMINAL_POD_LOCK_THEN_FINAL_ROW'
  };
}
function resetUnifiedCompletion(reportDate,reason){
  const unified=latestUnifiedForDate(reportDate);
  if(!unified?.snapshotId||String(unified.snapshotStatus||'').toUpperCase()!=='COMPLETED')return 0;
  const payload=safe(unified.payloadJson);
  payload.v148ProcessingRepair={patchId:V146_PROCESSING_READINESS_ID,reason,at:nowIso()};
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
    sourceCount:before.sourceCount,scanCoveredCount:before.scanCoveredCount,apiScanCount:before.apiScanCount,
    podLockCount:before.podLockCount,finalCount:before.finalCount,at:nowIso()
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
    `).run('已发现旧快照缺少完整处理证据，系统将重新执行当日日报处理。',nowIso(),before.reportDate);
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
express.application.post=function v148ProcessingReadinessPost(path,...handlers){
  if(path==='/api/shopee/run/start'&&handlers.length){
    const wrapped=handlers.map(handler=>typeof handler!=='function'?handler:async function v148ShopeeRunStartGuard(req,res,next){
      try{
        const requested=dateOnly(req.body?.reportDate)||latestShopeeDate();
        if(requested)repairFalseCompletedShopee(requested);
        return await handler.call(this,req,res,next);
      }catch(error){
        if(typeof next==='function')return next(error);
        if(!res.headersSent)return res.status(500).json({ok:false,code:'V148_PROCESSING_REPAIR_FAILED',error:error?.message||String(error)});
      }
    });
    return previousPost.call(this,path,...wrapped);
  }
  return previousPost.call(this,path,...handlers);
};

const previousListen=express.application.listen;
let installed=false;
express.application.listen=function v148ProcessingReadinessListen(...args){
  if(!installed){installed=true;this.get('/api/v146/processing-readiness',readinessHandler);}
  return previousListen.apply(this,args);
};
