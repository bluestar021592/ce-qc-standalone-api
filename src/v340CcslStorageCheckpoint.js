import * as originalStorage from './storage.js';
import { getDb, nowIso } from './db.js';
export * from './storage.js';

export const V340_CCSL_FAST_CHECKPOINT_ID='2026-08-27-v341-ccsl-light-checkpoint-fail-open-v1';
const SCAN_FULL_MIRROR_STRIDE=4;
const TRACK_FULL_MIRROR_STRIDE=8;

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

export function shouldUseCcslLightCheckpoint(state={}){
  const processing=state.processing||{};
  if(!processing.running||processing.paused||processing.error)return false;
  const index=Math.max(0,Number(processing.batchIndex||0));
  const total=Math.max(0,Number(processing.totalBatches||0));
  if(!index||!total||index>=total)return false;
  const phase=String(processing.phase||'');
  const stride=isTrackPhase(phase)?TRACK_FULL_MIRROR_STRIDE:(isScanPhase(phase)?SCAN_FULL_MIRROR_STRIDE:1);
  return stride>1&&index%stride!==0;
}

function lightCheckpoint(state={}){
  const date=String(state.reportDate||'').trim();
  const run=state.currentRun||state.lastRunSummary||state.lastRun||{};
  const runId=String(run.runId||'').trim();
  if(!date||!runId)return state;
  const processing=state.processing||{};
  const now=nowIso();
  const counts=progressCounts(state);
  const db=getDb();
  try{
    // Progress persistence is deliberately non-transactional and fail-open.
    // It is an optimization only; authoritative facts are written by periodic/full
    // mirrors. A busy/locked SQLite progress write must never abort the QC run.
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
  }catch(error){
    console.warn('[CE-QC][V341_CCSL_CHECKPOINT_SKIPPED]',JSON.stringify({
      reportDate:date,
      runId,
      phase:String(processing.phase||''),
      batchIndex:Number(processing.batchIndex||0),
      code:String(error?.code||''),
      message:String(error?.message||error||'').slice(0,300),
      policy:'FAIL_OPEN_BUSINESS_PIPELINE_CONTINUES'
    }));
  }
  return state;
}

export async function saveState(state={}){
  if(shouldUseCcslLightCheckpoint(state))return lightCheckpoint(state);
  return originalStorage.saveState(state);
}

console.info('[CE-QC][V341_CCSL_FAST_CHECKPOINT]',JSON.stringify({
  id:V340_CCSL_FAST_CHECKPOINT_ID,
  scanFullMirrorEveryBatches:SCAN_FULL_MIRROR_STRIDE,
  trackFullMirrorEveryBatches:TRACK_FULL_MIRROR_STRIDE,
  finalBatchAlwaysFullMirror:true,
  lightCheckpointWrites:'run_locks+run_checkpoints only',
  lightCheckpointFailurePolicy:'FAIL_OPEN_NEVER_ABORT_CCSL',
  factTruth:'full mirror checkpoints + final snapshot remain authoritative',
  policy:'LARGE_DB_AVOID_FULL_STATE_REWRITE_EVERY_BATCH'
}));
