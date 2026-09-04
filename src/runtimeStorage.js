import { DatabaseSync } from 'node:sqlite';
import * as originalStorage from './storage.js';
import { getDb, getRuntimeConfig, nowIso } from './db.js';
export * from './storage.js';

export const RUNTIME_STORAGE_ID='system-runtime-storage-v2';
export const V340_CCSL_FAST_CHECKPOINT_ID='2026-08-28-v348-ccsl-final-only-authoritative-mirror-v1';
const FULL_MIRROR_WARN_MS=1000;

let progressDb=null;
let progressDbPath='';
let liveState=null;
let lastPersistedFactSignature='';

function safeJson(value,fallback={}){try{return JSON.parse(String(value||''));}catch{return fallback;}}
function isTrackPhase(phase=''){return /轨迹|track|shipment-event|exception-item/i.test(String(phase||''));}
function isScanPhase(phase=''){return /扫描|scan|order/i.test(String(phase||''));}
function countStatus(rows=[],status='success'){
  return (Array.isArray(rows)?rows:[]).filter(row=>String(row?.status||'').toLowerCase()===status).length;
}
function inferredRetry(rows=[]){
  return (Array.isArray(rows)?rows:[]).filter(row=>{
    const value=[row?.查询状态,row?.API状态,row?.异常分类,row?.primaryCategory,row?.主分类,row?.错误信息].filter(Boolean).join(' ');
    return /refresh_failed|失败|待重试|retry/i.test(value);
  }).length;
}
function progressCounts(state={}){
  const scanTotal=Number(state.scanPool?.length||state.lastRunSummary?.scanPool||0);
  const scanStatus=Array.isArray(state.scanQueryStatus)?state.scanQueryStatus:[];
  const scanRetry=scanStatus.length?countStatus(scanStatus,'failed'):inferredRetry(state.scanResults);
  const scanDone=scanStatus.length?countStatus(scanStatus,'success'):Math.max(0,Number(state.scanResults?.length||0)-scanRetry);
  const trackTotal=Number(state.needTrackBills?.length||state.lastRunSummary?.needTrack||0);
  const trackStatus=Array.isArray(state.trackQueryStatus)?state.trackQueryStatus:[];
  const trackRetry=trackStatus.length?countStatus(trackStatus,'failed'):inferredRetry(state.trackResults);
  const trackDone=trackStatus.length?countStatus(trackStatus,'success'):Math.max(0,Number(state.trackResults?.length||0)-trackRetry);
  return {
    scanDone,scanRetry,scanObserved:Math.min(scanTotal,scanDone+scanRetry),scanTotal,
    trackDone,trackRetry,trackObserved:Math.min(trackTotal,trackDone+trackRetry),trackTotal
  };
}
function currentRunId(state={}){
  const run=state.currentRun||state.lastRunSummary||state.lastRun||{};
  return String(run.runId||'').trim();
}
function factSignature(state={}){
  const processing=state.processing||{};
  const counts=progressCounts(state);
  return JSON.stringify({
    reportDate:String(state.reportDate||''),runId:currentRunId(state),
    scanTotal:counts.scanTotal,scanDone:counts.scanDone,scanRetry:counts.scanRetry,
    trackTotal:counts.trackTotal,trackDone:counts.trackDone,trackRetry:counts.trackRetry,
    scanResults:Number(state.scanResults?.length||0),trackResults:Number(state.trackResults?.length||0),
    trackEvents:Number(state.trackEvents?.length||0),podLocks:Number(state.podLocks?.length||0),
    finalRows:Number(state.finalRows?.length||0),nextCarry:Number((state.nextCarryBills||state.carryBills||[]).length||0),
    running:Boolean(processing.running),paused:Boolean(processing.paused),error:String(processing.error||'')
  });
}
function processingHotPath(state={}){
  const processing=state.processing||{};
  if(!processing.running||processing.paused||processing.error)return false;
  return isScanPhase(processing.phase||'')||isTrackPhase(processing.phase||'');
}
function isProgressOnlySave(state={},signature=''){
  return processingHotPath(state)&&Boolean(lastPersistedFactSignature)&&signature===lastPersistedFactSignature;
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

function pendingUnifiedImportSeed(){
  try{
    const db=getDb();
    const batch=db.prepare("SELECT reportDate,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC,rowid DESC LIMIT 1").get();
    if(!batch?.reportDate)return null;
    const daily=db.prepare('SELECT updatedAt FROM daily_reports WHERE reportDate=?').get(batch.reportDate);
    // saveUnifiedImport happens before server hydrates CCSL state. If the latest
    // unified batch is newer than the mirrored daily report, parsing the previous
    // giant app_state is wasted work because the route immediately overwrites it.
    if(daily?.updatedAt&&String(daily.updatedAt)>=String(batch.createdAt||''))return null;
    const podLocks=db.prepare('SELECT shipmentCode FROM pod_locks ORDER BY shipmentCode').all().map(row=>row.shipmentCode);
    const historySummary=db.prepare(`SELECT reportDate,summaryJson FROM (
      SELECT reportDate,summaryJson FROM history_summary ORDER BY reportDate DESC LIMIT 30
    ) ORDER BY reportDate ASC`).all().map(row=>({reportDate:row.reportDate,summary:safeJson(row.summaryJson,{})}));
    const seed=originalStorage.normalizeState({
      reportDate:batch.reportDate,
      podLocks,
      historySummary,
      processing:{running:false,paused:false,phase:''},
      logs:[]
    });
    console.info('[CE-QC][CORE_UNIFIED_IMPORT_FAST_SEED]',JSON.stringify({
      owner:RUNTIME_STORAGE_ID,businessType:'CCSL',reportDate:batch.reportDate,podLocks:podLocks.length,historyDays:historySummary.length,
      policy:'SKIP_OLD_APP_STATE_PARSE_BEFORE_FRESH_UNIFIED_IMPORT_HYDRATION'
    }));
    return seed;
  }catch{return null;}
}

export function shouldUseCcslLightCheckpoint(state={}){
  const processing=state.processing||{};
  return Boolean(processing.running&&!processing.paused&&!processing.error);
}
function lightCheckpoint(state={}){
  const date=String(state.reportDate||'').trim();
  const runId=currentRunId(state);
  if(!date||!runId)return state;
  const processing=state.processing||{};
  const now=nowIso();
  const counts=progressCounts(state);
  const started=Date.now();
  try{
    const db=getProgressDb();
    db.prepare(`UPDATE run_locks SET status='running',currentStage=?,batchIndex=?,totalBatches=?,errorMessage='',updatedAt=? WHERE reportDate=? AND runId=?`)
      .run(processing.phase||'',Number(processing.batchIndex||0),Number(processing.totalBatches||0),now,date,runId);
    db.prepare(`INSERT INTO run_checkpoints(runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt)
      VALUES(?,?,?,?,?,'running',?,'',?,?)`)
      .run(runId,date,processing.phase||'',Number(processing.batchIndex||0),Number(processing.totalBatches||0),JSON.stringify({
        fastCheckpoint:true,checkpointOwner:RUNTIME_STORAGE_ID,...counts,
        lastRunSummary:{runId,reportDate:date,scanPool:Number(state.scanPool?.length||state.lastRunSummary?.scanPool||0),needTrack:Number(state.needTrackBills?.length||state.lastRunSummary?.needTrack||0),runStatus:'running'}
      }),now,now);
    const elapsedMs=Date.now()-started;
    if(elapsedMs>=250)console.warn('[CE-QC][CORE_CCSL_LIGHT_CHECKPOINT_SLOW]',JSON.stringify({reportDate:date,runId,phase:String(processing.phase||''),batchIndex:Number(processing.batchIndex||0),elapsedMs}));
  }catch(error){
    console.warn('[CE-QC][CORE_CCSL_CHECKPOINT_SKIPPED]',JSON.stringify({
      reportDate:date,runId,phase:String(processing.phase||''),batchIndex:Number(processing.batchIndex||0),
      elapsedMs:Date.now()-started,code:String(error?.code||''),message:String(error?.message||error||'').slice(0,300),
      policy:'ZERO_WAIT_FAIL_OPEN_BUSINESS_PIPELINE_CONTINUES'
    }));
  }
  return state;
}
export async function loadState(){
  if(liveState?.processing?.running&&!liveState?.processing?.error)return liveState;
  const importSeed=pendingUnifiedImportSeed();
  if(importSeed)return importSeed;
  const loaded=await originalStorage.loadState();
  if(loaded?.processing?.running&&!loaded?.processing?.error)liveState=loaded;
  return loaded;
}
export async function saveState(state={}){
  if(state&&typeof state==='object'&&state.processing?.running&&!state.processing?.error)liveState=state;
  const signature=factSignature(state);
  if(isProgressOnlySave(state,signature))return state;
  if(shouldUseCcslLightCheckpoint(state)){
    const result=lightCheckpoint(state);
    lastPersistedFactSignature=signature;
    return result;
  }
  const started=Date.now();
  const result=await originalStorage.saveState(state);
  const elapsedMs=Date.now()-started;
  lastPersistedFactSignature=signature;
  if(elapsedMs>=FULL_MIRROR_WARN_MS){
    const processing=state.processing||{};
    console.warn('[CE-QC][CORE_CCSL_FINAL_MIRROR_TIMING]',JSON.stringify({reportDate:String(state.reportDate||''),runId:currentRunId(state),phase:String(processing.phase||''),batchIndex:Number(processing.batchIndex||0),totalBatches:Number(processing.totalBatches||0),elapsedMs,...progressCounts(state)}));
  }
  if(!state?.processing?.running)liveState=null;
  return result;
}
export function resetRuntimeStorageForTest(){
  try{progressDb?.close();}catch{}
  progressDb=null;progressDbPath='';liveState=null;lastPersistedFactSignature='';
}
export const resetV347CheckpointRuntimeForTest=resetRuntimeStorageForTest;

console.info('[CE-QC][CORE_RUNTIME_STORAGE]',JSON.stringify({
  id:RUNTIME_STORAGE_ID,compatibilityId:V340_CCSL_FAST_CHECKPOINT_ID,
  inRunFullMirror:false,authoritativeFullMirrorPolicy:'FINAL_ONLY_AFTER_RUNNING_FALSE',
  importHydrationPolicy:'FAST_SEED_WHEN_UNIFIED_BATCH_NEWER_THAN_MIRRORED_DAILY',
  lightCheckpointBusyTimeoutMs:0,pauseReadPolicy:'IN_MEMORY_WHILE_ACTIVE',
  lightCheckpointWrites:'run_locks+run_checkpoints only',
  lightCheckpointFailurePolicy:'ZERO_WAIT_FAIL_OPEN_NEVER_ABORT_CCSL',
  fullMirrorSlowLogMs:FULL_MIRROR_WARN_MS,
  policy:'UNVERSIONED_LARGE_DB_RUNTIME_STORAGE_FINAL_ONLY_AUTHORITATIVE_MIRROR'
}));
