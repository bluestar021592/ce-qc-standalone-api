import express from 'express';
import { getDb, nowIso } from './db.js';
import { createOrRecoverRun, getRunStatus, updateRunLock } from './store.js';
import { chooseCcslReportDate, ccslRecoveryDecision, V317_CCSL_RECOVERY_POLICY_ID } from './v317CcslRecoveryPolicy.js';
import { readV384CcslProcessingProof, V384_CCSL_PROCESSING_PROOF_ID } from './v384CcslProcessingProof.js';
import { readV418CcslTerminalClosureProof, V426_CCSL_TERMINAL_CLOSURE_PROOF_ID } from './v418StatusProofFastPath.js';

export const V317_CCSL_INCOMPLETE_RECOVERY_ID='2026-08-27-v333-selected-date-ccsl-recovery-v1';
export const V377_CCSL_IMPORT_LIFECYCLE_ID='2026-08-31-v377-latest-valid-import-lifecycle-boundary-v2';
export const V383_CCSL_RETROACTIVE_PROOF_ID='2026-08-31-v383-retroactive-ccsl-processing-proof-v1';
export const V317_STATUS_PROOF_LAZY_ID='2026-09-01-v317-status-proof-lazy-until-completion-snapshot-v1';
export const V426_CCSL_TERMINAL_RECOVERY_ID='2026-09-04-v426-current-member-terminal-recovery-v1';
const V317_EXPLICIT_REPORT_DATE_HINT_REVISION='2026-08-29-v359-selected-report-date-runtime-hint-v1';
const EXPLICIT_REPORT_DATE_HINT_TTL_MS=60_000;
const originalPost=express.application.post;
const installedApps=new WeakSet();
let lastExplicitReportDateHint={reportDate:'',updatedAt:0};

function parseJson(value,fallback={}){try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;}}
function normalizeDate(value=''){const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function latestValidUnifiedDate(db){return String(db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,batchId DESC LIMIT 1").get()?.reportDate||'');}
function currentStateDate(db){return String(parseJson(db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get()?.valueJson,{}).reportDate||'');}
function lastProcessedDate(db){return String(db.prepare("SELECT value FROM app_meta WHERE key='last_processed_report_date'").get()?.value||'');}
function latestDailyDate(db){return String(db.prepare('SELECT reportDate FROM daily_reports ORDER BY reportDate DESC,updatedAt DESC LIMIT 1').get()?.reportDate||'');}
function resolveDate(db){return chooseCcslReportDate({latestValidUnified:latestValidUnifiedDate(db),currentState:currentStateDate(db),lastProcessed:lastProcessedDate(db),latestDaily:latestDailyDate(db)});}
function latestValidUnifiedBatch(db,reportDate){return db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(reportDate)||null;}
function timestampAtOrAfter(value,boundary){
  const limit=Date.parse(String(boundary||''));
  if(!Number.isFinite(limit))return true;
  const actual=Date.parse(String(value||''));
  return Number.isFinite(actual)&&actual>=limit;
}
function lockForCurrentImport(rawLock,batch){
  if(!rawLock)return null;
  const boundary=String(batch?.createdAt||'');
  if(!boundary)return rawLock;
  const started=String(rawLock.lockedAt||rawLock.updatedAt||'');
  return timestampAtOrAfter(started,boundary)?rawLock:null;
}
function latestValidSnapshot(db,reportDate,runId='',boundary=''){
  const currentRunId=String(runId||'').trim();
  if(!currentRunId)return null;
  const row=db.prepare(`SELECT snapshotId,runId,status,reconciliationStatus,generatedAt
    FROM export_snapshots
    WHERE reportDate=? AND runId=? AND snapshotType='dashboard'
      AND COALESCE(status,'VALID')='VALID'
      AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED'
    ORDER BY id DESC LIMIT 1`).get(reportDate,currentRunId)||null;
  if(!row)return null;
  return timestampAtOrAfter(row.generatedAt,boundary)?row:null;
}
function ccslMemberCount(db,reportDate,batch=null){
  const resolved=batch||latestValidUnifiedBatch(db,reportDate);
  const snapshotId=String(resolved?.snapshotId||'');
  if(snapshotId)return Number(db.prepare(`SELECT COUNT(DISTINCT shipmentCode) count FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND businessType IN ('CE','CEAF','TBKH','ALI1688')`).get(snapshotId,reportDate)?.count||0);
  return Number(db.prepare('SELECT pnhCount FROM daily_reports WHERE reportDate=?').get(reportDate)?.pnhCount||0);
}
export function ccslProcessingProof(db,reportDate,batch=null,sourceTotal=0){
  const resolved=batch||latestValidUnifiedBatch(db,reportDate),snapshotId=String(resolved?.snapshotId||''),total=Math.max(0,Number(sourceTotal||0)),boundary=String(resolved?.createdAt||'');
  if(total===0)return{version:V383_CCSL_RETROACTIVE_PROOF_ID,revision:V384_CCSL_PROCESSING_PROOF_ID,sourceTotal:0,source:0,covered:0,missing:0,complete:true,snapshotId,lifecycleBoundary:boundary};
  if(!snapshotId)return{version:V383_CCSL_RETROACTIVE_PROOF_ID,revision:V384_CCSL_PROCESSING_PROOF_ID,sourceTotal:total,source:total,covered:0,missing:total,complete:false,snapshotId:'',lifecycleBoundary:boundary};
  const proof=readV384CcslProcessingProof(db,{reportDate,snapshotId,boundary});
  return{...proof,version:V383_CCSL_RETROACTIVE_PROOF_ID,revision:V384_CCSL_PROCESSING_PROOF_ID,sourceTotal:total,snapshotId};
}
function pendingProcessingProof(batch,sourceTotal=0){
  const total=Math.max(0,Number(sourceTotal||0));
  return{
    version:V383_CCSL_RETROACTIVE_PROOF_ID,
    revision:V384_CCSL_PROCESSING_PROOF_ID,
    statusFastPath:V317_STATUS_PROOF_LAZY_ID,
    sourceTotal:total,
    source:total,
    covered:0,
    missing:total,
    complete:total===0,
    snapshotId:String(batch?.snapshotId||''),
    lifecycleBoundary:String(batch?.createdAt||''),
    queryMode:total===0?'ZERO_TICKET_NO_PROOF_REQUIRED':'SKIPPED_UNTIL_COMPLETION_SNAPSHOT'
  };
}
function terminalProcessingProof(db,reportDate,batch,sourceTotal){
  const total=Math.max(0,Number(sourceTotal||0)),snapshotId=String(batch?.snapshotId||'');
  if(!snapshotId||total<=0)return null;
  const proof=readV418CcslTerminalClosureProof(db,{reportDate,snapshotId});
  if(!proof?.ok||proof.complete!==true||Number(proof.source)!==total||Number(proof.covered)<total)return proof;
  return{...proof,version:V426_CCSL_TERMINAL_RECOVERY_ID,revision:V426_CCSL_TERMINAL_CLOSURE_PROOF_ID,sourceTotal:total,snapshotId,lifecycleBoundary:String(batch?.createdAt||'')};
}
function retireStaleCcslRunPointers(db,reportDate,runId){
  const date=String(reportDate||'').trim(),id=String(runId||'').trim();
  if(!date||!id)return 0;
  db.exec('BEGIN IMMEDIATE');
  try{
    const checkpoints=Number(db.prepare('DELETE FROM run_checkpoints WHERE reportDate=? AND runId=?').run(date,id)?.changes||0);
    const locks=Number(db.prepare('DELETE FROM run_locks WHERE reportDate=? AND runId=?').run(date,id)?.changes||0);
    db.exec('COMMIT');
    return checkpoints+locks;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}

function rememberExplicitReportDate(reportDate=''){const date=normalizeDate(reportDate);if(!date)return;lastExplicitReportDateHint={reportDate:date,updatedAt:Date.now()};}

export function inspectV317ExplicitReportDateHint({maxAgeMs=EXPLICIT_REPORT_DATE_HINT_TTL_MS}={}){
  const reportDate=normalizeDate(lastExplicitReportDateHint.reportDate),updatedAt=Number(lastExplicitReportDateHint.updatedAt||0),ageMs=updatedAt?Math.max(0,Date.now()-updatedAt):Number.POSITIVE_INFINITY;
  return{revision:V317_EXPLICIT_REPORT_DATE_HINT_REVISION,reportDate,updatedAt,ageMs,fresh:Boolean(reportDate&&updatedAt&&ageMs<=Math.max(1,Number(maxAgeMs||EXPLICIT_REPORT_DATE_HINT_TTL_MS)))};
}

export function inspectV317CcslRecovery({db=getDb(),reportDate=''}={}){
  const canonical=resolveDate(db),requested=String(reportDate||'').trim(),date=requested||canonical;
  if(!date)return{ok:true,version:V317_CCSL_INCOMPLETE_RECOVERY_ID,statusFastPath:V317_STATUS_PROOF_LAZY_ID,v426TerminalRecovery:V426_CCSL_TERMINAL_RECOVERY_ID,lifecyclePolicy:V377_CCSL_IMPORT_LIFECYCLE_ID,proofPolicy:V383_CCSL_RETROACTIVE_PROOF_ID,proofRevision:V384_CCSL_PROCESSING_PROOF_ID,policy:V317_CCSL_RECOVERY_POLICY_ID,reportDate:'',dailyExists:false,sourceTotal:0,complete:false,paused:false,needsResume:false,action:'NO_DAILY',reason:'NO_CCSL_DAILY'};
  const validBatch=latestValidUnifiedBatch(db,date),sourceTotal=ccslMemberCount(db,date,validBatch);
  const hasDaily=Boolean(validBatch)||sourceTotal>0||Boolean(db.prepare('SELECT 1 FROM daily_reports WHERE reportDate=? LIMIT 1').get(date));
  const rawLock=sourceTotal>0&&hasDaily?getRunStatus(date).lock:null;
  const lock=lockForCurrentImport(rawLock,validBatch),staleLockIgnored=Boolean(rawLock&&!lock&&validBatch?.createdAt);
  const rawSnapshot=sourceTotal>0&&hasDaily?latestValidSnapshot(db,date,lock?.runId||'',validBatch?.createdAt||''):null;

  // Normal incomplete runs stay on the cheap snapshot-gated path. V426 adds one
  // narrow no-snapshot closure: every member in the exact current VALID CCSL cohort
  // must independently hit immutable pod_locks. UI 0/0, run status, and checkpoint
  // arithmetic are never treated as proof. One uncovered member keeps recovery open.
  const terminalProof=rawSnapshot?null:terminalProcessingProof(db,date,validBatch,sourceTotal);
  const terminalClosed=Boolean(terminalProof?.ok&&terminalProof.complete===true&&Number(terminalProof.source)===sourceTotal&&Number(terminalProof.covered)>=sourceTotal&&sourceTotal>0);
  const processingProof=rawSnapshot
    ?ccslProcessingProof(db,date,validBatch,sourceTotal)
    :terminalClosed
      ?terminalProof
      :pendingProcessingProof(validBatch,sourceTotal);
  const rejectedLegacySnapshot=Boolean(rawSnapshot&&!processingProof.complete);
  const snapshot=rejectedLegacySnapshot?null:rawSnapshot;
  const provenComplete=Boolean(snapshot)||terminalClosed;
  const decision=ccslRecoveryDecision({hasDaily,complete:provenComplete,lockStatus:lock?.status||'',validUnified:Boolean(validBatch),sourceTotal});
  return{
    ok:true,version:V317_CCSL_INCOMPLETE_RECOVERY_ID,statusFastPath:V317_STATUS_PROOF_LAZY_ID,v426TerminalRecovery:V426_CCSL_TERMINAL_RECOVERY_ID,terminalProofId:V426_CCSL_TERMINAL_CLOSURE_PROOF_ID,lifecyclePolicy:V377_CCSL_IMPORT_LIFECYCLE_ID,proofPolicy:V383_CCSL_RETROACTIVE_PROOF_ID,proofRevision:V384_CCSL_PROCESSING_PROOF_ID,policy:V317_CCSL_RECOVERY_POLICY_ID,
    reportDate:date,dailyExists:hasDaily,validUnified:Boolean(validBatch),sourceTotal,complete:decision.complete,paused:decision.paused,needsResume:decision.needsResume,action:decision.action,zeroTicketDay:Boolean(decision.zeroTicketDay),
    reason:decision.zeroTicketDay?'VALID_UNIFIED_ZERO_CCSL_TICKETS':(terminalClosed?'V426_EXACT_CURRENT_MEMBERS_ALL_POD_LOCKED':(rejectedLegacySnapshot?'COMPLETED_SNAPSHOT_REJECTED_MISSING_PROCESSING_PROOF':(staleLockIgnored?'STALE_PRE_IMPORT_CCSL_RUN_IGNORED':''))),snapshotId:snapshot?.snapshotId||'',
    rejectedSnapshotId:rejectedLegacySnapshot?String(rawSnapshot?.snapshotId||''):'',processingProof,terminalClosureProof:terminalProof||null,
    lifecycleBoundary:String(validBatch?.createdAt||''),staleLockIgnored,staleRunId:staleLockIgnored?String(rawLock?.runId||''):'',
    lock:lock?{runId:lock.runId,status:lock.status,currentStage:lock.currentStage,batchIndex:Number(lock.batchIndex||0),totalBatches:Number(lock.totalBatches||0),lockedAt:lock.lockedAt||'',updatedAt:lock.updatedAt||''}:null
  };
}

export function prepareV317CcslRecovery({db=getDb(),reportDate='',actor='V317'}={}){
  const before=inspectV317CcslRecovery({db,reportDate});
  if(!before.dailyExists||before.complete||before.paused)return{...before,prepared:false};
  const date=before.reportDate;
  let retiredStalePointers=0;
  if(before.staleLockIgnored&&before.staleRunId)retiredStalePointers=retireStaleCcslRunPointers(db,date,before.staleRunId);
  if(before.action==='REOPEN_FINISHED'&&!before.staleLockIgnored){
    updateRunLock(date,'failed',before.reason==='COMPLETED_SNAPSHOT_REJECTED_MISSING_PROCESSING_PROOF'
      ?`V384 reopened finished CCSL run: ${before.processingProof?.missing||0} current daily members lack successful scan + required track/POD proof.`
      :'V317 reopened a finished CCSL run because no VALID COMPLETED snapshot exists for this report date.');
  }else if(before.action==='CREATE_AND_RESUME'||before.staleLockIgnored){
    const outcome=createOrRecoverRun(date,{lockedBy:String(actor||'V317')});
    if(!outcome.ok)return{...before,prepared:false,retiredStalePointers,error:outcome.error||outcome.code||'RUN_PREPARE_FAILED'};
  }
  const after=inspectV317CcslRecovery({db,reportDate:date});
  try{db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('v317_last_ccsl_recovery',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(JSON.stringify({reportDate:date,before:before.lock?.status||'NONE',after:after.lock?.status||'NONE',sourceTotal:after.sourceTotal,processingProof:after.processingProof,retiredStalePointers,at:nowIso()}),nowIso());}catch{}
  return{...after,prepared:true,reopenedFrom:before.lock?.status||'NONE',retiredStalePointers};
}

function routeHandler(req,res){
  try{
    const action=String(req.body?.action||'status').toLowerCase(),reportDate=String(req.body?.reportDate||'').trim();
    if(reportDate)rememberExplicitReportDate(reportDate);
    const result=action==='prepare'?prepareV317CcslRecovery({reportDate,actor:req.user?.username||req.user?.email||'V317'}):inspectV317CcslRecovery({reportDate});
    return res.json(result);
  }catch(error){return res.status(500).json({ok:false,error:`V317 CCSL恢复检查失败：${error?.message||error}`});}
}

express.application.post=function v317CcslIncompleteRecoveryPost(route,...handlers){
  if(!installedApps.has(this)){installedApps.add(this);originalPost.call(this,'/api/v317/ccsl-recovery',routeHandler);}
  return originalPost.call(this,route,...handlers);
};

console.info('[CE-QC][V317_CCSL_RECOVERY]',V317_CCSL_INCOMPLETE_RECOVERY_ID,V377_CCSL_IMPORT_LIFECYCLE_ID,V317_STATUS_PROOF_LAZY_ID,V426_CCSL_TERMINAL_RECOVERY_ID,'normal incomplete status stays snapshot-gated; exact current VALID membership may close without a completion snapshot only when every member has immutable POD-lock proof; pre-import run pointers and audit snapshots remain preserved.');
console.info('[CE-QC][V383_CCSL_RETROACTIVE_PROOF]',V383_CCSL_RETROACTIVE_PROOF_ID,'existing COMPLETED snapshots are revalidated against current daily processing proof; rejected legacy snapshots are preserved read-only and their finished run is recoverable.');
console.info('[CE-QC][V384_CCSL_PROCESSING_PROOF]',V384_CCSL_PROCESSING_PROOF_ID,'completion requires terminal scan/POD lock, or a successful same-lifecycle nonterminal scan followed by a non-retry same-lifecycle final trajectory result; scan-only placeholders, stale same-date evidence and API failures cannot close CCSL.');
console.info('[CE-QC][V426_CCSL_TERMINAL_CLOSURE]',V426_CCSL_TERMINAL_CLOSURE_PROOF_ID,'no-snapshot closure is exact current VALID CCSL membership joined to immutable pod_locks only; 0/0 UI and stale run/checkpoint state are never proof.');
console.info('[CE-QC][V359_SELECTED_REPORT_DATE_HINT]',V317_EXPLICIT_REPORT_DATE_HINT_REVISION,'explicit browser status reads keep a short-lived in-memory selected-date hint so backend WHPP continuity can resume the exact visible date without scanning or guessing historical dates.');
