import { DatabaseSync } from 'node:sqlite';
import * as originalStore from './businessStore.js';
import { getDb, getRuntimeConfig, nowIso } from './db.js';
import { V314_SHOPEE_THROUGHPUT_CORE_ID } from './throughputCore.js';
export * from './businessStore.js';

export const RUNTIME_BUSINESS_STORE_ID='system-runtime-business-store-v2';
export const V314_FAST_CHECKPOINT_ID='2026-08-30-v314-shopee-final-only-authoritative-mirror-v2';
const FULL_MIRROR_WARN_MS=1000;
const CHECKPOINT_WARN_INTERVAL_MS=30_000;

let progressDb=null;
let progressDbPath='';
let liveState=null;
let lastCheckpointWarnAt=0;

function normalizeType(businessType='',state=null){return String(businessType||state?.businessType||originalStore.SHOPEE||'SHOPEE').toUpperCase();}
function currentRunId(state={}){const run=state.currentRun||state.lastRunSummary||state.lastRun||{};return String(run.runId||state.processing?.runId||'').trim();}
function countStatus(rows=[],status='success'){return (Array.isArray(rows)?rows:[]).filter(row=>String(row?.status||'').toLowerCase()===status).length;}
function progressCounts(state={}){
  const scanStatus=Array.isArray(state.scanQueryStatus)?state.scanQueryStatus:[];
  const eventStatus=Array.isArray(state.eventQueryStatus)?state.eventQueryStatus:[];
  const exceptionStatus=Array.isArray(state.exceptionQueryStatus)?state.exceptionQueryStatus:[];
  return{
    scanDone:countStatus(scanStatus,'success'),scanRetry:countStatus(scanStatus,'failed'),scanObserved:scanStatus.length,scanResults:Number(state.scanResults?.length||0),
    eventDone:countStatus(eventStatus,'success'),eventRetry:countStatus(eventStatus,'failed'),eventObserved:eventStatus.length,trackEvents:Number(state.trackEvents?.length||0),
    exceptionDone:countStatus(exceptionStatus,'success'),exceptionRetry:countStatus(exceptionStatus,'failed'),exceptionObserved:exceptionStatus.length,exceptionItems:Number(state.exceptionItems?.length||0)
  };
}
function getProgressDb(){
  const cfg=getRuntimeConfig();
  if(progressDb&&progressDbPath===cfg.dbFile)return progressDb;
  try{progressDb?.close();}catch{}
  progressDb=new DatabaseSync(cfg.dbFile);
  progressDb.exec('PRAGMA busy_timeout = 0');
  progressDbPath=cfg.dbFile;
  return progressDb;
}
function pendingUnifiedImportSeed(type){
  if(type!==originalStore.SHOPEE)return null;
  try{
    const db=getDb();
    const batch=db.prepare("SELECT reportDate,createdAt,snapshotId FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC,rowid DESC LIMIT 1").get();
    if(!batch?.reportDate)return null;
    const mirrored=db.prepare('SELECT updatedAt FROM business_daily_reports WHERE businessType=? AND reportDate=?').get(type,batch.reportDate);
    const batchAt=Date.parse(String(batch.createdAt||'')),mirrorAt=Date.parse(String(mirrored?.updatedAt||''));
    if(Number.isFinite(batchAt)&&Number.isFinite(mirrorAt)&&mirrorAt>=batchAt)return null;
    if(!Number.isFinite(batchAt)&&mirrored?.updatedAt&&String(mirrored.updatedAt)>=String(batch.createdAt||''))return null;
    const seed=originalStore.normalizeBusinessState({
      businessType:type,reportDate:String(batch.reportDate),dailyReportReady:false,
      processing:{running:false,paused:false,phase:''},currentRun:null,lastRunSummary:null,lastRun:null,
      dailyParseRows:[],pnhBills:[],carryBills:[],podLocks:[],scanPool:[],scanResults:[],scanQueryStatus:[],shipmentTrackResults:[],shipmentQueryStatus:[],needTrackBills:[],trackEvents:[],eventQueryStatus:[],exceptionItems:[],exceptionQueryStatus:[],apiBatchStatus:[],trackResults:[],finalRows:[],priorCarryRows:[],nextCarryBills:[],historySummary:[],logs:[]
    },type);
    console.info('[CE-QC][CORE_UNIFIED_IMPORT_FAST_SEED]',JSON.stringify({owner:RUNTIME_BUSINESS_STORE_ID,businessType:type,reportDate:batch.reportDate,snapshotId:String(batch.snapshotId||''),policy:'SKIP_OLD_BUSINESS_STATE_PARSE_BEFORE_FRESH_UNIFIED_IMPORT_HYDRATION'}));
    return seed;
  }catch{return null;}
}
function shouldUseLightCheckpoint(state={},businessType=''){
  const type=normalizeType(businessType,state),processing=state.processing||{};
  return type===originalStore.SHOPEE&&processing.running===true&&processing.paused!==true&&!processing.error;
}
function warnCheckpointSkipped(error,state,type,startedAt){
  const nowMs=Date.now();if(nowMs-lastCheckpointWarnAt<CHECKPOINT_WARN_INTERVAL_MS)return;lastCheckpointWarnAt=nowMs;
  console.warn('[CE-QC][CORE_SHOPEE_CHECKPOINT_SKIPPED]',JSON.stringify({businessType:type,reportDate:String(state.reportDate||''),runId:currentRunId(state),phase:String(state.processing?.phase||''),batchIndex:Number(state.processing?.batchIndex||0),elapsedMs:nowMs-startedAt,code:String(error?.code||''),message:String(error?.message||error||'').slice(0,300),policy:'ZERO_WAIT_FAIL_OPEN_SHOPEE_PIPELINE_CONTINUES'}));
}
function lightCheckpoint(state={},businessType=''){
  const type=normalizeType(businessType,state),date=String(state.reportDate||'').trim(),runId=currentRunId(state);
  if(!date||!runId)return state;
  const processing=state.processing||{},now=nowIso(),startedAt=Date.now();
  try{
    const db=getProgressDb();
    db.prepare(`UPDATE business_run_locks SET status='running',currentStage=?,batchIndex=?,totalBatches=?,errorMessage='',updatedAt=? WHERE businessType=? AND reportDate=? AND runId=?`)
      .run(processing.phase||'',Number(processing.batchIndex||0),Number(processing.totalBatches||0),now,type,date,runId);
    db.prepare(`INSERT INTO business_run_checkpoints(businessType,runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,'running',?,'',?,?)`)
      .run(type,runId,date,processing.phase||'',Number(processing.batchIndex||0),Number(processing.totalBatches||0),JSON.stringify({fastCheckpoint:true,checkpointOwner:RUNTIME_BUSINESS_STORE_ID,finalOnlyMirror:true,...progressCounts(state)}),now,now);
    const elapsedMs=Date.now()-startedAt;
    if(elapsedMs>=250)console.warn('[CE-QC][CORE_SHOPEE_LIGHT_CHECKPOINT_SLOW]',JSON.stringify({businessType:type,reportDate:date,runId,phase:String(processing.phase||''),batchIndex:Number(processing.batchIndex||0),elapsedMs}));
  }catch(error){warnCheckpointSkipped(error,state,type,startedAt);}
  return state;
}
export function loadBusinessState(businessType=originalStore.SHOPEE){
  const type=normalizeType(businessType);
  if(type===originalStore.SHOPEE&&liveState?.processing?.running&&!liveState?.processing?.error)return liveState;
  const importSeed=pendingUnifiedImportSeed(type);if(importSeed)return importSeed;
  const loaded=originalStore.loadBusinessState(type);
  if(type===originalStore.SHOPEE&&loaded?.processing?.running&&!loaded?.processing?.error)liveState=loaded;
  return loaded;
}
export function saveBusinessState(state={},businessType=state.businessType||originalStore.SHOPEE){
  const type=normalizeType(businessType,state);
  if(type!==originalStore.SHOPEE)return originalStore.saveBusinessState(state,type);
  if(state&&typeof state==='object'&&state.processing?.running&&!state.processing?.error)liveState=state;
  if(shouldUseLightCheckpoint(state,type))return lightCheckpoint(state,type);
  const startedAt=Date.now(),result=originalStore.saveBusinessState(state,type),elapsedMs=Date.now()-startedAt;
  if(elapsedMs>=FULL_MIRROR_WARN_MS)console.warn('[CE-QC][CORE_SHOPEE_FINAL_MIRROR_TIMING]',JSON.stringify({businessType:type,reportDate:String(state.reportDate||''),runId:currentRunId(state),phase:String(state.processing?.phase||''),running:Boolean(state.processing?.running),paused:Boolean(state.processing?.paused),elapsedMs,...progressCounts(state)}));
  if(!state?.processing?.running)liveState=null;
  return result;
}
export function resetRuntimeBusinessStoreForTest(){try{progressDb?.close();}catch{}progressDb=null;progressDbPath='';liveState=null;lastCheckpointWarnAt=0;}
export const resetV314CheckpointRuntimeForTest=resetRuntimeBusinessStoreForTest;

console.info('[CE-QC][CORE_RUNTIME_BUSINESS_STORE]',JSON.stringify({id:RUNTIME_BUSINESS_STORE_ID,compatibilityId:V314_FAST_CHECKPOINT_ID,core:V314_SHOPEE_THROUGHPUT_CORE_ID,inRunFullMirror:false,authoritativeFullMirrorPolicy:'PAUSE_ERROR_OR_FINAL_ONLY',lightCheckpointBusyTimeoutMs:0,importHydrationPolicy:'FAST_SEED_WHEN_UNIFIED_BATCH_NEWER_THAN_SHOPEE_DAILY_MIRROR',pauseReadPolicy:'IN_MEMORY_WHILE_ACTIVE',lightCheckpointWrites:'business_run_locks+business_run_checkpoints only',lightCheckpointFailurePolicy:'ZERO_WAIT_FAIL_OPEN_NEVER_ABORT_SHOPEE',finalMirrorFailurePolicy:'FAIL_CLOSED',scanBatchSize:350,trackBatchSize:50,trackConcurrency:4,policy:'UNVERSIONED_LARGE_DB_SHOPEE_RUNTIME_STORAGE_FINAL_ONLY_AUTHORITATIVE_MIRROR'}));