import { getDb } from './db.js';
import { completeUnifiedSnapshot } from './unifiedImportStore.js';

export const V142_UNIFIED_REPAIR_ID='2026-08-15-v144-zero-family-auto-finalize-v4';
const recentAttempts=new Map();
const RETRY_MS=15_000;

function safeJson(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return {};}}
function dateOnly(value=''){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function remember(date,result){recentAttempts.set(date,{at:Date.now(),result});return result;}

function currentUnified(reportDate){
  return getDb().prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.status batchStatus,b.createdAt batchCreatedAt,
           s.status snapshotStatus,s.createdAt snapshotCreatedAt,s.payloadJson
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.reportDate=? AND b.status='VALID'
    ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1
  `).get(reportDate)||null;
}

function expectedFamilyCounts(snapshotId){
  const row=getDb().prepare(`
    SELECT
      SUM(CASE WHEN UPPER(COALESCE(businessType,'')) IN ('CE','CEAF','TBKH','ALI1688') THEN 1 ELSE 0 END) ccsl,
      SUM(CASE WHEN UPPER(COALESCE(businessType,'')) IN ('SHOPEECN','SHOPEEVN') THEN 1 ELSE 0 END) shopee,
      COUNT(*) total
    FROM unified_import_rows WHERE snapshotId=?
  `).get(snapshotId)||{};
  return {ccsl:Number(row.ccsl||0),shopee:Number(row.shopee||0),total:Number(row.total||0)};
}

function emptyCompletedChild(family,reportDate,unified){
  return {
    snapshotId:`ZERO-${family}-${reportDate}-${unified?.snapshotId||'UNIFIED'}`,
    reportDate,
    runId:`ZERO-${family}-${reportDate}`,
    status:'VALID',
    reconciliationStatus:'COMPLETED',
    createdAt:unified?.snapshotCreatedAt||unified?.batchCreatedAt||new Date().toISOString(),
    zeroRowFamily:true,
    state:{finalRows:[]},
    view:null
  };
}

function latestCcslSnapshot(reportDate){
  const row=getDb().prepare(`
    SELECT snapshotId,reportDate,runId,payloadJson,generatedAt,createdAt,status,reconciliationStatus
    FROM export_snapshots
    WHERE reportDate=? AND snapshotType='dashboard'
      AND COALESCE(status,'VALID')='VALID'
      AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
    ORDER BY createdAt DESC,id DESC LIMIT 1
  `).get(reportDate);
  if(!row)return null;
  return {...safeJson(row.payloadJson),snapshotId:row.snapshotId,reportDate:row.reportDate,runId:row.runId,status:row.status||'VALID',reconciliationStatus:row.reconciliationStatus||'COMPLETED',createdAt:row.createdAt||row.generatedAt||''};
}

function latestShopeeSnapshot(reportDate){
  const row=getDb().prepare(`
    SELECT snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt,status,reconciliationStatus
    FROM business_export_snapshots
    WHERE businessType='SHOPEE' AND reportDate=?
      AND COALESCE(status,'VALID')='VALID'
      AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
    ORDER BY createdAt DESC,id DESC LIMIT 1
  `).get(reportDate);
  if(!row)return null;
  return {...safeJson(row.payloadJson),snapshotId:row.snapshotId,businessType:'SHOPEE',reportDate:row.reportDate,runId:row.runId,status:row.status||'VALID',reconciliationStatus:row.reconciliationStatus||'COMPLETED',createdAt:row.createdAt||row.generatedAt||''};
}

function markWaiting(row,missing,expectedFamilies){
  if(!row?.snapshotId)return;
  const payload=safeJson(row.payloadJson);
  payload.autoFinalize={patchId:V142_UNIFIED_REPAIR_ID,status:'WAITING_FOR_REQUIRED_CHILD_SNAPSHOTS',missing,expectedFamilies,checkedAt:new Date().toISOString()};
  getDb().prepare(`UPDATE unified_snapshots SET payloadJson=?
    WHERE snapshotId=? AND status IN ('IMPORTED','PROCESSING')`).run(JSON.stringify(payload),row.snapshotId);
}

function restoreCompletableStatus(row){
  if(row?.snapshotStatus!=='PROCESSING')return;
  getDb().prepare("UPDATE unified_snapshots SET status='IMPORTED' WHERE snapshotId=? AND status='PROCESSING'").run(row.snapshotId);
  row.snapshotStatus='IMPORTED';
}

export function repairUnifiedSnapshotCompletion(reportDate,{force=false}={}){
  const date=dateOnly(reportDate);
  if(!date)return {ok:false,code:'INVALID_DATE',reportDate:date};
  const recent=recentAttempts.get(date);
  if(!force&&recent&&Date.now()-Number(recent.at||0)<RETRY_MS)return {...recent.result,cached:true};

  const unified=currentUnified(date);
  if(!unified)return remember(date,{ok:true,reportDate:date,imported:false,status:'NOT_IMPORTED'});
  if(unified.snapshotStatus==='COMPLETED')return remember(date,{ok:true,reportDate:date,imported:true,completed:true,status:'COMPLETED',snapshotId:unified.snapshotId});

  const expectedFamilies=expectedFamilyCounts(unified.snapshotId);
  const ccslRequired=expectedFamilies.ccsl>0;
  const shopeeRequired=expectedFamilies.shopee>0;
  const realCcsl=ccslRequired?latestCcslSnapshot(date):null;
  const realShopee=shopeeRequired?latestShopeeSnapshot(date):null;
  const ccsl=ccslRequired?realCcsl:emptyCompletedChild('CCSL',date,unified);
  const shopee=shopeeRequired?realShopee:emptyCompletedChild('SHOPEE',date,unified);
  const missing=[];
  if(ccslRequired&&!realCcsl)missing.push('CCSL');
  if(shopeeRequired&&!realShopee)missing.push('SHOPEE');
  if(missing.length){
    markWaiting(unified,missing,expectedFamilies);
    return remember(date,{ok:true,reportDate:date,imported:true,completed:false,status:'PROCESSING',missing,expectedFamilies,snapshotId:unified.snapshotId});
  }

  restoreCompletableStatus(unified);
  try{
    const result=completeUnifiedSnapshot({reportDate:date,ccslSnapshot:ccsl,shopeeSnapshot:shopee});
    if(!result)return remember(date,{ok:false,reportDate:date,imported:true,completed:false,status:'RECONCILIATION_FAILED',snapshotId:unified.snapshotId,code:'UNIFIED_SNAPSHOT_NOT_COMPLETABLE',error:'统一快照未进入可完成状态。'});
    return remember(date,{ok:true,reportDate:date,imported:true,completed:true,status:'COMPLETED',snapshotId:result.snapshotId||unified.snapshotId,repairId:V142_UNIFIED_REPAIR_ID,expectedFamilies,zeroFamilies:{CCSL:!ccslRequired,SHOPEE:!shopeeRequired}});
  }catch(error){
    return remember(date,{ok:false,reportDate:date,imported:true,completed:false,status:'RECONCILIATION_FAILED',snapshotId:unified.snapshotId,code:error?.code||'UNIFIED_RECONCILIATION_FAILED',error:error?.message||String(error),reconciliation:error?.reconciliation||null,expectedFamilies});
  }
}

export function repairRecentUnifiedSnapshots(limit=14){
  const rows=getDb().prepare(`
    SELECT DISTINCT b.reportDate
    FROM unified_import_batches b
    JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status<>'COMPLETED'
    ORDER BY b.reportDate DESC,b.createdAt DESC LIMIT ?
  `).all(Math.max(1,Math.min(60,Number(limit)||14)));
  return rows.map(row=>repairUnifiedSnapshotCompletion(row.reportDate,{force:true}));
}

setTimeout(()=>{try{repairRecentUnifiedSnapshots();}catch(error){console.warn('[CE-QC][V144][STARTUP_REPAIR]',error?.message||error);}},1200).unref?.();
const timer=setInterval(()=>{try{repairRecentUnifiedSnapshots(7);}catch(error){console.warn('[CE-QC][V144][PERIODIC_REPAIR]',error?.message||error);}},60_000);
timer.unref?.();
