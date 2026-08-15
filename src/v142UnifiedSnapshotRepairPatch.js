import { getDb } from './db.js';
import { completeUnifiedSnapshot } from './unifiedImportStore.js';

export const V142_UNIFIED_REPAIR_ID='2026-08-15-v142-unified-auto-finalize-v1';
const recentAttempts=new Map();
const RETRY_MS=15_000;

function safeJson(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return {};}}
function dateOnly(value=''){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}

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

function markWaiting(row,missing){
  if(!row?.snapshotId)return;
  const payload=safeJson(row.payloadJson);
  payload.autoFinalize={patchId:V142_UNIFIED_REPAIR_ID,status:'WAITING_FOR_CHILD_SNAPSHOTS',missing,checkedAt:new Date().toISOString()};
  // PROCESSING means “日报已导入，但两条业务处理链尚未同时形成正式快照”.
  // It must never be treated as a truthful completed day by dashboards.
  getDb().prepare(`UPDATE unified_snapshots
    SET status=CASE WHEN status='IMPORTED' THEN 'PROCESSING' ELSE status END,payloadJson=?
    WHERE snapshotId=? AND status IN ('IMPORTED','PROCESSING')`).run(JSON.stringify(payload),row.snapshotId);
}

export function repairUnifiedSnapshotCompletion(reportDate,{force=false}={}){
  const date=dateOnly(reportDate);
  if(!date)return {ok:false,code:'INVALID_DATE',reportDate:date};
  const last=Number(recentAttempts.get(date)||0);
  if(!force&&Date.now()-last<RETRY_MS)return {ok:true,reportDate:date,skipped:true,reason:'RECENTLY_CHECKED'};
  recentAttempts.set(date,Date.now());

  const unified=currentUnified(date);
  if(!unified)return {ok:true,reportDate:date,imported:false,status:'NOT_IMPORTED'};
  if(unified.snapshotStatus==='COMPLETED')return {ok:true,reportDate:date,imported:true,completed:true,status:'COMPLETED',snapshotId:unified.snapshotId};

  const ccsl=latestCcslSnapshot(date);
  const shopee=latestShopeeSnapshot(date);
  const missing=[];
  if(!ccsl)missing.push('CCSL');
  if(!shopee)missing.push('SHOPEE');
  if(missing.length){
    markWaiting(unified,missing);
    return {ok:true,reportDate:date,imported:true,completed:false,status:'PROCESSING',missing,snapshotId:unified.snapshotId};
  }

  try{
    const result=completeUnifiedSnapshot({reportDate:date,ccslSnapshot:ccsl,shopeeSnapshot:shopee});
    return {ok:true,reportDate:date,imported:true,completed:true,status:'COMPLETED',snapshotId:result?.snapshotId||unified.snapshotId,repairId:V142_UNIFIED_REPAIR_ID};
  }catch(error){
    return {ok:false,reportDate:date,imported:true,completed:false,status:'RECONCILIATION_FAILED',snapshotId:unified.snapshotId,code:error?.code||'UNIFIED_RECONCILIATION_FAILED',error:error?.message||String(error),reconciliation:error?.reconciliation||null};
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

// Repair is deliberately conservative: it can only finalize a day when BOTH
// persisted child snapshots are already VALID + COMPLETED. No API calls, no
// guessed data, and no re-upload are required.
setTimeout(()=>{try{repairRecentUnifiedSnapshots();}catch(error){console.warn('[CE-QC][V142][STARTUP_REPAIR]',error?.message||error);}},1200).unref?.();
const timer=setInterval(()=>{try{repairRecentUnifiedSnapshots(7);}catch(error){console.warn('[CE-QC][V142][PERIODIC_REPAIR]',error?.message||error);}},60_000);
timer.unref?.();
