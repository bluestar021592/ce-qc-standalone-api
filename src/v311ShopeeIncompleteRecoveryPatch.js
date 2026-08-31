import express from 'express';
import { getDb, nowIso } from './db.js';
import { SHOPEE, createOrRecoverBusinessRun, getBusinessRunStatus, updateBusinessRunLock } from './businessStore.js';

export const V311_SHOPEE_INCOMPLETE_RECOVERY_ID='2026-08-26-v311-reopen-finished-without-snapshot-v1';
export const V375_SHOPEE_ZERO_WORK_ID='2026-08-31-v375-exact-zero-shopee-no-work-v1';
const originalPost=express.application.post;
const installedApps=new WeakSet();

function latestShopeeDate(db){
  const daily=String(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType=? ORDER BY reportDate DESC LIMIT 1").get(SHOPEE)?.reportDate||'');
  const unified=String(db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate||'');
  return daily>unified?daily:unified;
}
function validSnapshot(db,reportDate,runId=''){
  const currentRunId=String(runId||'').trim();
  if(!currentRunId)return null;
  return db.prepare("SELECT snapshotId,runId,reconciliationStatus,status,generatedAt FROM business_export_snapshots WHERE businessType=? AND reportDate=? AND runId=? AND COALESCE(status,'VALID')='VALID' ORDER BY id DESC LIMIT 1").get(SHOPEE,reportDate,currentRunId)||null;
}
function dailyExists(db,reportDate){
  return Boolean(db.prepare('SELECT 1 FROM business_daily_reports WHERE businessType=? AND reportDate=? LIMIT 1').get(SHOPEE,reportDate));
}
function exactUnifiedShopeeMembership(db,reportDate){
  const batch=db.prepare(`SELECT b.batchId,b.snapshotId,s.status snapshotStatus
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.reportDate=? AND b.status='VALID' AND s.status IN ('IMPORTED','COMPLETED')
    ORDER BY b.createdAt DESC LIMIT 1`).get(reportDate);
  if(!batch)return null;
  const rows=db.prepare("SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE batchId=? AND businessType IN ('SHOPEECN','SHOPEEVN') GROUP BY businessType").all(batch.batchId);
  const membership={SHOPEECN:0,SHOPEEVN:0};
  for(const row of rows)if(Object.hasOwn(membership,row.businessType))membership[row.businessType]=Number(row.count||0);
  return{...batch,...membership,total:membership.SHOPEECN+membership.SHOPEEVN};
}

export function inspectV311ShopeeRecovery({db=getDb(),reportDate=''}={}){
  const date=String(reportDate||'').trim()||latestShopeeDate(db);
  if(!date)return{ok:true,reportDate:'',dailyExists:false,complete:false,needsResume:false,reason:'NO_SHOPEE_DAILY'};
  const exactMembership=exactUnifiedShopeeMembership(db,date);
  if(exactMembership&&exactMembership.total===0){
    return{ok:true,reportDate:date,dailyExists:false,complete:true,needsResume:false,noWork:true,zeroTicketDay:true,reason:'EXACT_ZERO_UNIFIED_SHOPEE_MEMBERSHIP',policyId:V375_SHOPEE_ZERO_WORK_ID,snapshotId:exactMembership.snapshotId,lock:null,membership:{SHOPEECN:0,SHOPEEVN:0,total:0,batchId:exactMembership.batchId,snapshotId:exactMembership.snapshotId}};
  }
  const hasDaily=dailyExists(db,date);
  const lock=hasDaily?getBusinessRunStatus(SHOPEE,date).lock:null;
  const snapshot=hasDaily?validSnapshot(db,date,lock?.runId||''):null;
  const complete=Boolean(snapshot&&String(snapshot.reconciliationStatus||'COMPLETED').toUpperCase()==='COMPLETED');
  return{ok:true,reportDate:date,dailyExists:hasDaily,complete,needsResume:Boolean(hasDaily&&!complete),snapshotId:snapshot?.snapshotId||'',lock:lock?{runId:lock.runId,status:lock.status,currentStage:lock.currentStage,batchIndex:Number(lock.batchIndex||0),totalBatches:Number(lock.totalBatches||0),updatedAt:lock.updatedAt||''}:null};
}

export function prepareV311ShopeeRecovery({db=getDb(),reportDate='',actor='V311'}={}){
  const before=inspectV311ShopeeRecovery({db,reportDate});
  if(!before.dailyExists||before.complete)return{...before,prepared:false};
  const date=before.reportDate;
  let lock=before.lock;
  if(lock?.status==='finished'){
    updateBusinessRunLock(SHOPEE,date,'failed','V311 reopened a finished SHOPEE run because no VALID COMPLETED snapshot exists for this report date.');
  }else if(!lock){
    const outcome=createOrRecoverBusinessRun(SHOPEE,date,{lockedBy:String(actor||'V311')});
    if(!outcome.ok)return{...before,prepared:false,error:outcome.error||outcome.code||'RUN_PREPARE_FAILED'};
  }
  const after=inspectV311ShopeeRecovery({db,reportDate:date});
  try{db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('v311_last_shopee_recovery',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify({reportDate:date,before:lock?.status||'NONE',after:after.lock?.status||'NONE',at:nowIso()}),nowIso());}catch{}
  return{...after,prepared:true,reopenedFrom:lock?.status||'NONE'};
}

function routeHandler(req,res){
  try{
    const action=String(req.body?.action||'status').toLowerCase();
    const reportDate=String(req.body?.reportDate||'').trim();
    const result=action==='prepare'?prepareV311ShopeeRecovery({reportDate,actor:req.user?.username||req.user?.email||'V311'}):inspectV311ShopeeRecovery({reportDate});
    return res.json(result);
  }catch(error){return res.status(500).json({ok:false,error:`V311 SHOPEE恢复检查失败：${error?.message||error}`});}
}

express.application.post=function v311ShopeeIncompleteRecoveryPost(route,...handlers){
  if(!installedApps.has(this)){
    installedApps.add(this);
    originalPost.call(this,'/api/v311/shopee-recovery',routeHandler);
  }
  return originalPost.call(this,route,...handlers);
};

console.info('[CE-QC][V311_SHOPEE_RECOVERY]',V311_SHOPEE_INCOMPLETE_RECOVERY_ID,V375_SHOPEE_ZERO_WORK_ID,'completion snapshots stay bound to the current SHOPEE runId; exact latest VALID unified CN=0/VN=0 is a formal zero-work completion and never opens a remote run.');