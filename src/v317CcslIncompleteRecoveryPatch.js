import express from 'express';
import { getDb, nowIso } from './db.js';
import { createOrRecoverRun, getRunStatus, updateRunLock } from './store.js';
import { chooseCcslReportDate, ccslRecoveryDecision, V317_CCSL_RECOVERY_POLICY_ID } from './v317CcslRecoveryPolicy.js';
import { readV384CcslProcessingProof, V384_CCSL_PROCESSING_PROOF_ID } from './v384CcslProcessingProof.js';
import {
  PROCESSING_STATUS_CORE_ID,
  latestValidProcessingBatch,
  readSevenBusinessStatus
} from './processingStatusCore.js';

export const V317_CCSL_INCOMPLETE_RECOVERY_ID='2026-08-27-v333-selected-date-ccsl-recovery-v1';
export const V377_CCSL_IMPORT_LIFECYCLE_ID='2026-08-31-v377-latest-valid-import-lifecycle-boundary-v2';
export const V383_CCSL_RETROACTIVE_PROOF_ID='2026-08-31-v383-retroactive-ccsl-processing-proof-v1';
export const V317_STATUS_PROOF_LAZY_ID='system-core-status-owned-recovery-v1';
const V317_EXPLICIT_REPORT_DATE_HINT_REVISION='2026-08-29-v359-selected-report-date-runtime-hint-v1';
const EXPLICIT_REPORT_DATE_HINT_TTL_MS=60_000;
const originalPost=express.application.post;
const installedApps=new WeakSet();
let lastExplicitReportDateHint={reportDate:'',updatedAt:0};

function parseJson(value,fallback={}){try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;}}
function normalizeDate(value=''){const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function latestValidUnifiedDate(db){return String(latestValidProcessingBatch(db)?.reportDate||'');}
function currentStateDate(db){
  try{return String(parseJson(db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get()?.valueJson,{}).reportDate||'');}
  catch{return'';}
}
function lastProcessedDate(db){return String(db.prepare("SELECT value FROM app_meta WHERE key='last_processed_report_date'").get()?.value||'');}
function latestDailyDate(db){return String(db.prepare('SELECT reportDate FROM daily_reports ORDER BY reportDate DESC,updatedAt DESC LIMIT 1').get()?.reportDate||'');}
function resolveDate(db){return chooseCcslReportDate({latestValidUnified:latestValidUnifiedDate(db),currentState:currentStateDate(db),lastProcessed:lastProcessedDate(db),latestDaily:latestDailyDate(db)});}
function timestampAtOrAfter(value,boundary){const limit=Date.parse(String(boundary||''));if(!Number.isFinite(limit))return true;const actual=Date.parse(String(value||''));return Number.isFinite(actual)&&actual>=limit;}
function retireStaleCcslRunPointers(db,reportDate,runId){
  const date=String(reportDate||'').trim(),id=String(runId||'').trim();if(!date||!id)return 0;
  db.exec('BEGIN IMMEDIATE');
  try{
    const checkpoints=Number(db.prepare('DELETE FROM run_checkpoints WHERE reportDate=? AND runId=?').run(date,id)?.changes||0);
    const locks=Number(db.prepare('DELETE FROM run_locks WHERE reportDate=? AND runId=?').run(date,id)?.changes||0);
    db.exec('COMMIT');return checkpoints+locks;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function rememberExplicitReportDate(reportDate=''){const date=normalizeDate(reportDate);if(date)lastExplicitReportDateHint={reportDate:date,updatedAt:Date.now()};}

export function inspectV317ExplicitReportDateHint({maxAgeMs=EXPLICIT_REPORT_DATE_HINT_TTL_MS}={}){
  const reportDate=normalizeDate(lastExplicitReportDateHint.reportDate),updatedAt=Number(lastExplicitReportDateHint.updatedAt||0),ageMs=updatedAt?Math.max(0,Date.now()-updatedAt):Number.POSITIVE_INFINITY;
  return{revision:V317_EXPLICIT_REPORT_DATE_HINT_REVISION,reportDate,updatedAt,ageMs,fresh:Boolean(reportDate&&updatedAt&&ageMs<=Math.max(1,Number(maxAgeMs||EXPLICIT_REPORT_DATE_HINT_TTL_MS)))};
}

// Compatibility helper retained for old diagnostics. Runtime completion ownership is
// processingStatusCore; this function only exposes the detailed V384 proof on demand.
export function ccslProcessingProof(db,reportDate,batch=null,sourceTotal=0){
  const resolved=batch||latestValidProcessingBatch(db,reportDate),snapshotId=String(resolved?.snapshotId||''),total=Math.max(0,Number(sourceTotal||0)),boundary=String(resolved?.createdAt||'');
  if(total===0)return{version:V383_CCSL_RETROACTIVE_PROOF_ID,revision:V384_CCSL_PROCESSING_PROOF_ID,sourceTotal:0,source:0,covered:0,missing:0,complete:true,snapshotId,lifecycleBoundary:boundary};
  if(!snapshotId)return{version:V383_CCSL_RETROACTIVE_PROOF_ID,revision:V384_CCSL_PROCESSING_PROOF_ID,sourceTotal:total,source:total,covered:0,missing:total,complete:false,snapshotId:'',lifecycleBoundary:boundary};
  const proof=readV384CcslProcessingProof(db,{reportDate,snapshotId,boundary,includeMissingBills:false});
  return{...proof,version:V383_CCSL_RETROACTIVE_PROOF_ID,revision:V384_CCSL_PROCESSING_PROOF_ID,sourceTotal:total,snapshotId};
}

export function inspectV317CcslRecovery({db=getDb(),reportDate=''}={}){
  const requested=normalizeDate(reportDate),date=requested||resolveDate(db);
  const status=readSevenBusinessStatus({db,reportDate:date,force:true});
  const stage=status?.stages?.CCSL||{complete:false,sourceTotal:0};
  const validBatch=latestValidProcessingBatch(db,date),hasDaily=Boolean(validBatch)||Number(stage.sourceTotal||0)>0||Boolean(date&&db.prepare('SELECT 1 FROM daily_reports WHERE reportDate=? LIMIT 1').get(date));
  const rawLock=date?getRunStatus(date).lock:null;
  const boundary=String(validBatch?.createdAt||'');
  const rawLockCurrent=rawLock&&timestampAtOrAfter(rawLock.lockedAt||rawLock.updatedAt,boundary);
  const staleLockIgnored=Boolean(rawLock&&!rawLockCurrent&&boundary);
  const effectiveLock=rawLockCurrent?rawLock:null;
  const decision=ccslRecoveryDecision({hasDaily,complete:Boolean(stage.complete),lockStatus:effectiveLock?.status||'',validUnified:Boolean(validBatch),sourceTotal:Number(stage.sourceTotal||0)});
  const covered=Number(stage.completionProof?.covered||stage.podLockCount||(stage.complete?stage.sourceTotal:0)||0);
  const processingProof={
    id:PROCESSING_STATUS_CORE_ID,source:Number(stage.sourceTotal||0),covered,
    missing:Math.max(0,Number(stage.sourceTotal||0)-covered),complete:Boolean(stage.complete),
    completionSource:String(stage.completionSource||''),podLockCount:Number(stage.podLockCount||0),snapshotId:String(stage.snapshotId||''),lifecycleBoundary:boundary
  };
  return{
    ok:true,version:V317_CCSL_INCOMPLETE_RECOVERY_ID,statusFastPath:V317_STATUS_PROOF_LAZY_ID,coreStatusId:PROCESSING_STATUS_CORE_ID,lifecyclePolicy:V377_CCSL_IMPORT_LIFECYCLE_ID,proofPolicy:V383_CCSL_RETROACTIVE_PROOF_ID,proofRevision:V384_CCSL_PROCESSING_PROOF_ID,policy:V317_CCSL_RECOVERY_POLICY_ID,
    reportDate:date||'',dailyExists:hasDaily,validUnified:Boolean(validBatch),sourceTotal:Number(stage.sourceTotal||0),complete:decision.complete,paused:decision.paused,needsResume:decision.needsResume,action:decision.action,zeroTicketDay:Boolean(decision.zeroTicketDay),
    reason:stage.complete?String(stage.completionClaimSource||stage.completionSource||'CORE_STATUS_COMPLETE'):(staleLockIgnored?'STALE_PRE_IMPORT_CCSL_RUN_IGNORED':String(stage.lastMessage||'')),
    snapshotId:String(stage.snapshotId||''),processingProof,lifecycleBoundary:boundary,staleLockIgnored,staleRunId:staleLockIgnored?String(rawLock?.runId||''):'',
    lock:effectiveLock?{runId:effectiveLock.runId,status:effectiveLock.status,currentStage:effectiveLock.currentStage,batchIndex:Number(effectiveLock.batchIndex||0),totalBatches:Number(effectiveLock.totalBatches||0),lockedAt:effectiveLock.lockedAt||'',updatedAt:effectiveLock.updatedAt||''}:null
  };
}

export function prepareV317CcslRecovery({db=getDb(),reportDate='',actor='V317'}={}){
  const before=inspectV317CcslRecovery({db,reportDate});
  if(!before.dailyExists||before.complete||before.paused)return{...before,prepared:false};
  const date=before.reportDate;let retiredStalePointers=0;
  if(before.staleLockIgnored&&before.staleRunId)retiredStalePointers=retireStaleCcslRunPointers(db,date,before.staleRunId);
  if(before.action==='REOPEN_FINISHED'&&!before.staleLockIgnored){
    updateRunLock(date,'failed','Core status proof rejected the prior finished CCSL run for the current VALID membership; recovery is required.');
  }else if(before.action==='CREATE_AND_RESUME'||before.staleLockIgnored){
    const outcome=createOrRecoverRun(date,{lockedBy:String(actor||'V317')});
    if(!outcome.ok)return{...before,prepared:false,retiredStalePointers,error:outcome.error||outcome.code||'RUN_PREPARE_FAILED'};
  }
  const after=inspectV317CcslRecovery({db,reportDate:date});
  try{db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('v317_last_ccsl_recovery',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify({coreStatusId:PROCESSING_STATUS_CORE_ID,reportDate:date,before:before.lock?.status||'NONE',after:after.lock?.status||'NONE',sourceTotal:after.sourceTotal,processingProof:after.processingProof,retiredStalePointers,at:nowIso()}),nowIso());}catch{}
  return{...after,prepared:true,reopenedFrom:before.lock?.status||'NONE',retiredStalePointers};
}

function routeHandler(req,res){
  try{
    const action=String(req.body?.action||'status').toLowerCase(),reportDate=String(req.body?.reportDate||'').trim();if(reportDate)rememberExplicitReportDate(reportDate);
    const result=action==='prepare'?prepareV317CcslRecovery({reportDate,actor:req.user?.username||req.user?.email||'V317'}):inspectV317CcslRecovery({reportDate});
    return res.json(result);
  }catch(error){return res.status(500).json({ok:false,error:`CCSL恢复检查失败：${error?.message||error}`});}
}

express.application.post=function ccslRecoveryCompatibilityPost(route,...handlers){
  if(!installedApps.has(this)){installedApps.add(this);originalPost.call(this,'/api/v317/ccsl-recovery',routeHandler);}
  return originalPost.call(this,route,...handlers);
};

console.info('[CE-QC][CORE_CCSL_RECOVERY_COMPAT]',PROCESSING_STATUS_CORE_ID,V317_CCSL_INCOMPLETE_RECOVERY_ID,'V317 no longer computes completion independently; it only prepares a run after processingStatusCore reports the current VALID CCSL membership incomplete.');