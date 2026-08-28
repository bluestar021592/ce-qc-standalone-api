import { DatabaseSync } from 'node:sqlite';
import * as originalStorage from './storage.js';
import { getRuntimeConfig, nowIso } from './db.js';
export * from './storage.js';

export const V340_CCSL_FAST_CHECKPOINT_ID='2026-08-28-v347-ccsl-hotpath-nonblocking-checkpoint-v1';
const SCAN_FULL_MIRROR_STRIDE=4;
const TRACK_FULL_MIRROR_STRIDE=8;
const FULL_MIRROR_WARN_MS=1000;

let progressDb=null;
let progressDbPath='';
let liveState=null;
let lastPersistedFactSignature='';

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
    reportDate:String(state.reportDate||''),
    runId:currentRunId(state),
    scanTotal:counts.scanTotal,
    scanDone:counts.scanDone,
    scanRetry:counts.scanRetry,
    trackTotal:counts.trackTotal,
    trackDone:counts.trackDone,
    trackRetry:counts.trackRetry,
    scanResults:Number(state.scanResults?.length||0),
    trackResults:Number(state.trackResults?.length||0),
    trackEvents:Number(state.trackEvents?.length||0),
    podLocks:Number(state.podLocks?.length||0),
    finalRows:Number(state.finalRows?.length||0),
    nextCarry:Number((state.nextCarryBills||state.carryBills||[]).length||0),
    running:Boolean(processing.running),
    paused:Boolean(processing.paused),
    error:String(processing.error||'')
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

export function shouldUseCcslLightCheckpoint(state={}){
  const processing=state.processing||{};
  if(!processing.running||processing.paused||processing.error)return false;
  const index=Math.max(0,Number(processing.batchIndex||0));
  const total=Math.max(0,Number(processing.totalBatches||0));
  if(!total)return false;
  // Phase initialization (batchIndex=0) only needs the run-lock/checkpoint counters.
  // The authoritative current facts are already recoverable from the previous full
  // mirror and the imported daily membership, so never full-mirror merely to say
  // "starting scan/track".
  if(index===0)return true;
  if(index>=total)return false;
  const phase=String(processing.phase||'');
  const stride=isTrackPhase(phase)?TRACK_FULL_MIRROR_STRIDE:(isScanPhase(phase)?SCAN_FULL_MIRROR_STRIDE:1);
  return stride>1&&index%stride!==0;
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
    // Use a dedicated zero-wait connection for progress only. If another process
    // owns the SQLite writer lock, this write fails immediately instead of blocking
    // the Node event loop and freezing CE request deadlines/UI polling.
    const db=getProgressDb();
    db.prepare(`UPDATE run_locks SET status='running',currentStage=?,batchIndex=?,totalBatches=?,errorMessage='',updatedAt=? WHERE reportDate=? AND runId=?`)
      .run(processing.phase||'',Number(processing.batchIndex||0),Number(processing.totalBatches||0),now,date,runId);
    db.prepare(`INSERT INTO run_checkpoints(runId,reportDate,stage,batchIndex,totalBatches,status,payloadJson,errorMessage,createdAt,updatedAt)
      VALUES(?,?,?,?,?,'running',?,'',?,?)`)
      .run(runId,date,processing.phase||'',Number(processing.batchIndex||0),Number(processing.totalBatches||0),JSON.stringify({
        fastCheckpoint:true,
        checkpointOwner:V340_CCSL_FAST_CHECKPOINT_ID,
        ...counts,
        lastRunSummary:{
          runId,
          reportDate:date,
          scanPool:Number(state.scanPool?.length||state.lastRunSummary?.scanPool||0),
          needTrack:Number(state.needTrackBills?.length||state.lastRunSummary?.needTrack||0),
          runStatus:'running'
        }
      }),now,now);
    const elapsedMs=Date.now()-started;
    if(elapsedMs>=250)console.warn('[CE-QC][V347_CCSL_LIGHT_CHECKPOINT_SLOW]',JSON.stringify({reportDate:date,runId,phase:String(processing.phase||''),batchIndex:Number(processing.batchIndex||0),elapsedMs}));
  }catch(error){
    console.warn('[CE-QC][V347_CCSL_CHECKPOINT_SKIPPED]',JSON.stringify({
      reportDate:date,
      runId,
      phase:String(processing.phase||''),
      batchIndex:Number(processing.batchIndex||0),
      elapsedMs:Date.now()-started,
      code:String(error?.code||''),
      message:String(error?.message||error||'').slice(0,300),
      policy:'ZERO_WAIT_FAIL_OPEN_BUSINESS_PIPELINE_CONTINUES'
    }));
  }
  return state;
}

export async function loadState(){
  // During one active CCSL run, server.js repeatedly asks loadState() only to test
  // the pause flag. Re-reading and JSON.parse-ing the whole mutable app_state before
  // every 350/50 batch is unnecessary. The same server process owns pause/resume and
  // mutates this live object before persisting it, so the in-memory state is both
  // fresher and cheaper while the run is active.
  if(liveState?.processing?.running&&!liveState?.processing?.error)return liveState;
  const loaded=await originalStorage.loadState();
  if(loaded?.processing?.running&&!loaded?.processing?.error)liveState=loaded;
  return loaded;
}

export async function saveState(state={}){
  if(state&&typeof state==='object'&&state.processing?.running&&!state.processing?.error)liveState=state;
  const signature=factSignature(state);

  // onProgress only changes human-readable logs / the displayed batch pointer.
  // Facts are persisted by the subsequent onCheckpoint. Avoid a redundant SQLite
  // write before the CE request has even started; this was the 1400/3679 freeze path.
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
    console.warn('[CE-QC][V347_CCSL_FULL_MIRROR_TIMING]',JSON.stringify({
      reportDate:String(state.reportDate||''),
      runId:currentRunId(state),
      phase:String(processing.phase||''),
      batchIndex:Number(processing.batchIndex||0),
      totalBatches:Number(processing.totalBatches||0),
      elapsedMs,
      ...progressCounts(state)
    }));
  }
  if(!state?.processing?.running)liveState=null;
  return result;
}

console.info('[CE-QC][V347_CCSL_FAST_CHECKPOINT]',JSON.stringify({
  id:V340_CCSL_FAST_CHECKPOINT_ID,
  scanFullMirrorEveryBatches:SCAN_FULL_MIRROR_STRIDE,
  trackFullMirrorEveryBatches:TRACK_FULL_MIRROR_STRIDE,
  finalBatchAlwaysFullMirror:true,
  progressOnlySqliteWrites:false,
  lightCheckpointBusyTimeoutMs:0,
  pauseReadPolicy:'IN_MEMORY_WHILE_ACTIVE',
  lightCheckpointWrites:'run_locks+run_checkpoints only',
  lightCheckpointFailurePolicy:'ZERO_WAIT_FAIL_OPEN_NEVER_ABORT_CCSL',
  fullMirrorSlowLogMs:FULL_MIRROR_WARN_MS,
  factTruth:'periodic/full mirror checkpoints + final snapshot remain authoritative; skipped light progress may only cause safe API re-query after a crash',
  policy:'LARGE_DB_HOT_PATH_NEVER_BLOCKS_ON_PROGRESS_SQLITE'
}));
