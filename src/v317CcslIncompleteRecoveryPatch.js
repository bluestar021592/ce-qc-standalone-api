import express from 'express';
import { getDb, nowIso } from './db.js';
import { createOrRecoverRun, getRunStatus, updateRunLock } from './store.js';
import { chooseCcslReportDate, ccslRecoveryDecision, V317_CCSL_RECOVERY_POLICY_ID } from './v317CcslRecoveryPolicy.js';

export const V317_CCSL_INCOMPLETE_RECOVERY_ID='2026-08-26-v317-ccsl-restart-auto-recovery-v1';
const originalPost=express.application.post;
const installedApps=new WeakSet();

function parseJson(value,fallback={}){try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;}}
function latestValidUnifiedDate(db){
  return String(db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,batchId DESC LIMIT 1").get()?.reportDate||'');
}
function currentStateDate(db){
  return String(parseJson(db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get()?.valueJson,{}).reportDate||'');
}
function lastProcessedDate(db){return String(db.prepare("SELECT value FROM app_meta WHERE key='last_processed_report_date'").get()?.value||'');}
function latestDailyDate(db){return String(db.prepare('SELECT reportDate FROM daily_reports ORDER BY reportDate DESC,updatedAt DESC LIMIT 1').get()?.reportDate||'');}
function resolveDate(db){
  return chooseCcslReportDate({latestValidUnified:latestValidUnifiedDate(db),currentState:currentStateDate(db),lastProcessed:lastProcessedDate(db),latestDaily:latestDailyDate(db)});
}
function latestValidSnapshot(db,reportDate){
  return db.prepare(`SELECT snapshotId,runId,status,reconciliationStatus,generatedAt
    FROM export_snapshots
    WHERE reportDate=? AND snapshotType='dashboard'
      AND COALESCE(status,'VALID')='VALID'
      AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
    ORDER BY id DESC LIMIT 1`).get(reportDate)||null;
}
function ccslMemberCount(db,reportDate){
  const snapshotId=String(db.prepare("SELECT snapshotId FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(reportDate)?.snapshotId||'');
  if(snapshotId){
    return Number(db.prepare(`SELECT COUNT(DISTINCT shipmentCode) count FROM unified_import_rows
      WHERE snapshotId=? AND reportDate=? AND businessType IN ('CE','CEAF','TBKH','ALI1688')`).get(snapshotId,reportDate)?.count||0);
  }
  return Number(db.prepare('SELECT pnhCount FROM daily_reports WHERE reportDate=?').get(reportDate)?.pnhCount||0);
}

export function inspectV317CcslRecovery({db=getDb(),reportDate=''}={}){
  const canonical=resolveDate(db);
  const requested=String(reportDate||'').trim();
  const date=canonical||requested;
  if(!date)return{ok:true,version:V317_CCSL_INCOMPLETE_RECOVERY_ID,policy:V317_CCSL_RECOVERY_POLICY_ID,reportDate:'',dailyExists:false,sourceTotal:0,complete:false,paused:false,needsResume:false,action:'NO_DAILY',reason:'NO_CCSL_DAILY'};
  const sourceTotal=ccslMemberCount(db,date);
  const hasDaily=sourceTotal>0||Boolean(db.prepare('SELECT 1 FROM daily_reports WHERE reportDate=? LIMIT 1').get(date));
  const snapshot=hasDaily?latestValidSnapshot(db,date):null;
  const lock=hasDaily?getRunStatus(date).lock:null;
  const decision=ccslRecoveryDecision({hasDaily,complete:Boolean(snapshot),lockStatus:lock?.status||''});
  return{
    ok:true,version:V317_CCSL_INCOMPLETE_RECOVERY_ID,policy:V317_CCSL_RECOVERY_POLICY_ID,
    reportDate:date,dailyExists:hasDaily,sourceTotal,complete:decision.complete,paused:decision.paused,
    needsResume:decision.needsResume,action:decision.action,snapshotId:snapshot?.snapshotId||'',
    lock:lock?{runId:lock.runId,status:lock.status,currentStage:lock.currentStage,batchIndex:Number(lock.batchIndex||0),totalBatches:Number(lock.totalBatches||0),updatedAt:lock.updatedAt||''}:null
  };
}

export function prepareV317CcslRecovery({db=getDb(),reportDate='',actor='V317'}={}){
  const before=inspectV317CcslRecovery({db,reportDate});
  if(!before.dailyExists||before.complete||before.paused)return{...before,prepared:false};
  const date=before.reportDate;
  if(before.action==='REOPEN_FINISHED'){
    updateRunLock(date,'failed','V317 reopened a finished CCSL run because no VALID COMPLETED snapshot exists for this report date.');
  }else if(before.action==='CREATE_AND_RESUME'){
    const outcome=createOrRecoverRun(date,{lockedBy:String(actor||'V317')});
    if(!outcome.ok)return{...before,prepared:false,error:outcome.error||outcome.code||'RUN_PREPARE_FAILED'};
  }
  const after=inspectV317CcslRecovery({db,reportDate:date});
  try{db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('v317_last_ccsl_recovery',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify({reportDate:date,before:before.lock?.status||'NONE',after:after.lock?.status||'NONE',sourceTotal:after.sourceTotal,at:nowIso()}),nowIso());}catch{}
  return{...after,prepared:true,reopenedFrom:before.lock?.status||'NONE'};
}

function routeHandler(req,res){
  try{
    const action=String(req.body?.action||'status').toLowerCase();
    const reportDate=String(req.body?.reportDate||'').trim();
    const result=action==='prepare'
      ?prepareV317CcslRecovery({reportDate,actor:req.user?.username||req.user?.email||'V317'})
      :inspectV317CcslRecovery({reportDate});
    return res.json(result);
  }catch(error){return res.status(500).json({ok:false,error:`V317 CCSL恢复检查失败：${error?.message||error}`});}
}

express.application.post=function v317CcslIncompleteRecoveryPost(route,...handlers){
  if(!installedApps.has(this)){
    installedApps.add(this);
    originalPost.call(this,'/api/v317/ccsl-recovery',routeHandler);
  }
  return originalPost.call(this,route,...handlers);
};

console.info('[CE-QC][V317_CCSL_RECOVERY]',V317_CCSL_INCOMPLETE_RECOVERY_ID,'current VALID unified CCSL membership survives process restart; incomplete non-paused CCSL runs are prepared for checkpoint-safe automatic continuation without deleting scan/track evidence.');
