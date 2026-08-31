import express from 'express';
import { getDb, nowIso } from './db.js';
import { SHOPEE, createOrRecoverBusinessRun, getBusinessRunStatus, updateBusinessRunLock } from './businessStore.js';

export const V311_SHOPEE_INCOMPLETE_RECOVERY_ID='2026-08-26-v311-reopen-finished-without-snapshot-v1';
export const V375_SHOPEE_ZERO_WORK_ID='2026-08-31-v375-exact-zero-shopee-no-work-v1';
export const V377_SHOPEE_IMPORT_LIFECYCLE_ID='2026-08-31-v377-latest-valid-import-lifecycle-boundary-v2';
const originalPost=express.application.post;
const installedApps=new WeakSet();

function latestShopeeDate(db){
  const daily=String(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType=? ORDER BY reportDate DESC LIMIT 1").get(SHOPEE)?.reportDate||'');
  const unified=String(db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate||'');
  return daily>unified?daily:unified;
}
function timestampAtOrAfter(value,boundary){
  const limit=Date.parse(String(boundary||''));
  if(!Number.isFinite(limit))return true;
  const actual=Date.parse(String(value||''));
  return Number.isFinite(actual)&&actual>=limit;
}
function lockForCurrentImport(rawLock,boundary=''){
  if(!rawLock)return null;
  if(!boundary)return rawLock;
  const started=String(rawLock.lockedAt||rawLock.updatedAt||'');
  return timestampAtOrAfter(started,boundary)?rawLock:null;
}
function validSnapshot(db,reportDate,runId='',boundary=''){
  const currentRunId=String(runId||'').trim();
  if(!currentRunId)return null;
  const row=db.prepare("SELECT snapshotId,runId,reconciliationStatus,status,generatedAt FROM business_export_snapshots WHERE businessType=? AND reportDate=? AND runId=? AND COALESCE(status,'VALID')='VALID' ORDER BY id DESC LIMIT 1").get(SHOPEE,reportDate,currentRunId)||null;
  if(!row)return null;
  return timestampAtOrAfter(row.generatedAt,boundary)?row:null;
}
function dailyExists(db,reportDate){return Boolean(db.prepare('SELECT 1 FROM business_daily_reports WHERE businessType=? AND reportDate=? LIMIT 1').get(SHOPEE,reportDate));}
function exactUnifiedShopeeMembership(db,reportDate){
  const batch=db.prepare(`SELECT b.batchId,b.snapshotId,b.createdAt,s.status snapshotStatus
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.reportDate=? AND b.status='VALID' AND s.status IN ('IMPORTED','COMPLETED')
    ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(reportDate);
  if(!batch)return null;
  const rows=db.prepare("SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE batchId=? AND businessType IN ('SHOPEECN','SHOPEEVN') GROUP BY businessType").all(batch.batchId);
  const membership={SHOPEECN:0,SHOPEEVN:0};
  for(const row of rows)if(Object.hasOwn(membership,row.businessType))membership[row.businessType]=Number(row.count||0);
  return{...batch,...membership,total:membership.SHOPEECN+membership.SHOPEEVN};
}
function retireStaleShopeeRunPointers(db,reportDate,runId){
  const date=String(reportDate||'').trim(),id=String(runId||'').trim();
  if(!date||!id)return 0;
  db.exec('BEGIN IMMEDIATE');
  try{
    const checkpoints=Number(db.prepare("DELETE FROM business_run_checkpoints WHERE businessType=? AND reportDate=? AND runId=?").run(SHOPEE,date,id)?.changes||0);
    const locks=Number(db.prepare("DELETE FROM business_run_locks WHERE businessType=? AND reportDate=? AND runId=?").run(SHOPEE,date,id)?.changes||0);
    db.exec('COMMIT');
    return checkpoints+locks;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}

export function inspectV311ShopeeRecovery({db=getDb(),reportDate=''}={}){
  const date=String(reportDate||'').trim()||latestShopeeDate(db);
  if(!date)return{ok:true,reportDate:'',dailyExists:false,complete:false,needsResume:false,reason:'NO_SHOPEE_DAILY',lifecyclePolicy:V377_SHOPEE_IMPORT_LIFECYCLE_ID};
  const exactMembership=exactUnifiedShopeeMembership(db,date);
  if(exactMembership&&exactMembership.total===0){
    return{ok:true,reportDate:date,dailyExists:false,complete:true,needsResume:false,noWork:true,zeroTicketDay:true,reason:'EXACT_ZERO_UNIFIED_SHOPEE_MEMBERSHIP',policyId:V375_SHOPEE_ZERO_WORK_ID,lifecyclePolicy:V377_SHOPEE_IMPORT_LIFECYCLE_ID,lifecycleBoundary:String(exactMembership.createdAt||''),snapshotId:exactMembership.snapshotId,lock:null,membership:{SHOPEECN:0,SHOPEEVN:0,total:0,batchId:exactMembership.batchId,snapshotId:exactMembership.snapshotId}};
  }
  const hasDaily=dailyExists(db,date),rawLock=hasDaily?getBusinessRunStatus(SHOPEE,date).lock:null,boundary=String(exactMembership?.createdAt||'');
  const lock=lockForCurrentImport(rawLock,boundary),staleLockIgnored=Boolean(rawLock&&!lock&&boundary);
  const snapshot=hasDaily?validSnapshot(db,date,lock?.runId||'',boundary):null;
  const complete=Boolean(snapshot&&String(snapshot.reconciliationStatus||'COMPLETED').toUpperCase()==='COMPLETED');
  const membership=exactMembership?{SHOPEECN:Number(exactMembership.SHOPEECN||0),SHOPEEVN:Number(exactMembership.SHOPEEVN||0),total:Number(exactMembership.total||0),batchId:exactMembership.batchId,snapshotId:exactMembership.snapshotId}:null;
  return{
    ok:true,reportDate:date,dailyExists:hasDaily,complete,needsResume:Boolean(hasDaily&&!complete),snapshotId:snapshot?.snapshotId||'',
    lifecyclePolicy:V377_SHOPEE_IMPORT_LIFECYCLE_ID,lifecycleBoundary:boundary,staleLockIgnored,staleRunId:staleLockIgnored?String(rawLock?.runId||''):'',membership,sourceTotal:Number(exactMembership?.total||0),
    reason:staleLockIgnored?'STALE_PRE_IMPORT_SHOPEE_RUN_IGNORED':'',
    lock:lock?{runId:lock.runId,status:lock.status,currentStage:lock.currentStage,batchIndex:Number(lock.batchIndex||0),totalBatches:Number(lock.totalBatches||0),lockedAt:lock.lockedAt||'',updatedAt:lock.updatedAt||''}:null
  };
}

export function prepareV311ShopeeRecovery({db=getDb(),reportDate='',actor='V311'}={}){
  const before=inspectV311ShopeeRecovery({db,reportDate});
  if(!before.dailyExists||before.complete)return{...before,prepared:false};
  const date=before.reportDate;
  let lock=before.lock,retiredStalePointers=0;
  if(before.staleLockIgnored&&before.staleRunId){
    retiredStalePointers=retireStaleShopeeRunPointers(db,date,before.staleRunId);
    lock=null;
  }
  if(lock?.status==='finished'){
    updateBusinessRunLock(SHOPEE,date,'failed','V311 reopened a finished SHOPEE run because no VALID COMPLETED snapshot exists for this report date.');
  }else if(!lock){
    const outcome=createOrRecoverBusinessRun(SHOPEE,date,{lockedBy:String(actor||'V311')});
    if(!outcome.ok)return{...before,prepared:false,retiredStalePointers,error:outcome.error||outcome.code||'RUN_PREPARE_FAILED'};
  }
  const after=inspectV311ShopeeRecovery({db,reportDate:date});
  try{db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('v311_last_shopee_recovery',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify({reportDate:date,before:before.lock?.status||'NONE',after:after.lock?.status||'NONE',retiredStalePointers,at:nowIso()}),nowIso());}catch{}
  return{...after,prepared:true,reopenedFrom:before.lock?.status||'NONE',retiredStalePointers};
}

function routeHandler(req,res){
  try{
    const action=String(req.body?.action||'status').toLowerCase(),reportDate=String(req.body?.reportDate||'').trim();
    const result=action==='prepare'?prepareV311ShopeeRecovery({reportDate,actor:req.user?.username||req.user?.email||'V311'}):inspectV311ShopeeRecovery({reportDate});
    return res.json(result);
  }catch(error){return res.status(500).json({ok:false,error:`V311 SHOPEE恢复检查失败：${error?.message||error}`});}
}

express.application.post=function v311ShopeeIncompleteRecoveryPost(route,...handlers){
  if(!installedApps.has(this)){installedApps.add(this);originalPost.call(this,'/api/v311/shopee-recovery',routeHandler);}
  return originalPost.call(this,route,...handlers);
};

console.info('[CE-QC][V311_SHOPEE_RECOVERY]',V311_SHOPEE_INCOMPLETE_RECOVERY_ID,V375_SHOPEE_ZERO_WORK_ID,V377_SHOPEE_IMPORT_LIFECYCLE_ID,'pre-import run pointers are ignored for status and retired only when preparing the new run; old audit snapshots remain preserved; exact zero-work remains unchanged.');
