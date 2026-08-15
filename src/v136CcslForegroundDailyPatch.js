import express from 'express';
import { CEClient } from './ceClient.js';
import { runQcPipeline } from './pipelineV137.js';
import { loadState, saveState } from './storage.js';
import { createOrRecoverRun, getCurrentReportDate, getRunStatus, updateRunLock } from './store.js';
import { buildCoreKpis, buildCriticalDashboard, buildDashboardRows } from './reporting.js';
import { createDashboardSnapshot, getMatchingSnapshot } from './snapshots.js';
import { appendHistorySummary } from './longBackup.js';
import { appendRuntimeLog } from './runtimeLog.js';
import { completeUnifiedSnapshot, updateCarryoverResults } from './unifiedImportStoreV137.js';
import { getMatchingBusinessSnapshot, loadBusinessState, SHOPEE } from './businessStore.js';

export const V136_CCSL_FOREGROUND_DAILY_ID='2026-08-15-v137-ccsl-foreground-scan-only-v2';
const ROUTES=new Set(['/api/run','/api/run/start','/api/run/resume']);
const active=new Set();
function bill(value){return String(value||'').trim().toUpperCase();}
function unique(values=[]){return [...new Set((values||[]).map(bill).filter(Boolean))];}
function retryError(error){return ['CCSL_PARTIAL_API_FAILURE','SCAN_RETRY_REQUIRED','TRACK_RETRY_REQUIRED','API_RETRY_REQUIRED'].includes(String(error?.code||error?.runStatus||''));}
function mergedForPersist(state,historical=[]){const today=new Set(unique(state.pnhBills||[]));const current=unique(state.nextCarryBills?.length?state.nextCarryBills:state.carryBills||[]).filter(x=>today.has(x));return {...state,carryBills:unique([...current,...historical.filter(x=>!today.has(x))]),nextCarryBills:unique([...current,...historical.filter(x=>!today.has(x))])};}
async function persist(state,historical){await saveState(mergedForPersist(state,historical));}

async function finalize({state,reportDate,run,partial=false}){
  const dashboardRows=buildDashboardRows(state);
  const criticalRows=buildCriticalDashboard(state).rows;
  const core=buildCoreKpis(state);
  const metricSnapshot={
    ...(state.lastRunSummary||{}),totalMonitored:core.totalCount,podRate:core.firstPodRate,abnormalRate:core.anomalyRate,severeCount:core.severeCount,
    metrics:Object.fromEntries([['总件数',core.totalCount],['首投POD率',core.firstPodRate],['异常率',core.anomalyRate],['严重异常总件数',core.severeCount],...dashboardRows.map(row=>[row.项目,row.数值]),...criticalRows.flatMap(row=>[[row.metricKey||row.异常类型,row.数量],[row.异常类型,row.数量]])]),
    metricStatuses:Object.fromEntries([['总件数','正常'],['首投POD率',core.firstPodRate>=90?'正常':'需跟进'],['异常率',core.anomalyCount?'重点关注':'正常'],['严重异常总件数',core.severeCount?'严重异常':'正常'],...dashboardRows.map(row=>[row.项目,row.状态]),...criticalRows.flatMap(row=>[[row.metricKey||row.异常类型,row.严重等级],[row.异常类型,row.严重等级]])]),
    foregroundPolicy:'CURRENT_REPORT_ONLY',partial:Boolean(partial)
  };
  state.historySummary=appendHistorySummary(state.historySummary||[],metricSnapshot);
  state.lastRunSummary={...(state.lastRunSummary||{}),...metricSnapshot,runStatus:partial?'COMPLETED_WITH_RETRY':'COMPLETED'};
  state.lastRun=state.lastRunSummary;
  await saveState(state);
  const snapshot=createDashboardSnapshot(state,{reportDate,runId:run.runId});
  updateCarryoverResults({snapshotId:snapshot.snapshotId,reportDate,rows:state.finalRows||[]});
  const shopeeState=loadBusinessState(SHOPEE);
  const shopeeSnapshot=getMatchingBusinessSnapshot(SHOPEE,shopeeState);
  completeUnifiedSnapshot({reportDate,ccslSnapshot:snapshot,shopeeSnapshot});
  updateRunLock(reportDate,'finished',partial?'接口待重试，当前成功数据已保存':'');
  await appendRuntimeLog(`CCSL当日前台快照已保存：${snapshot.snapshotId}；历史OPEN不进入本次查询。`);
  return snapshot;
}

function handler(pathValue){const resume=String(pathValue).endsWith('/resume');return async(req,res)=>{
  let reportDate='';let runId='';let historical=[];
  try{
    const loaded=await loadState();reportDate=getCurrentReportDate()||loaded.reportDate||'';
    if(!reportDate||!loaded.dailyReportReady)return res.status(400).json({ok:false,code:'REPORT_DATE_MISSING',error:'当前未导入当日CCSL日报。'});
    const today=unique(loaded.pnhBills||[]),todaySet=new Set(today);
    historical=unique(loaded.carryBills||loaded.nextCarryBills||[]).filter(x=>!todaySet.has(x));
    const before=getRunStatus(reportDate)?.lock||null;
    const matching=getMatchingSnapshot(loaded);
    if(before?.status==='running'&&!active.has(before.runId))updateRunLock(reportDate,'failed','V136 recovered stale foreground run lock');
    const retryableFinished=Boolean(before?.status==='finished'&&!matching);
    if(resume&&before?.status==='finished'&&matching)return res.json({ok:true,alreadyCompleted:true,reportDate,snapshotId:matching.snapshotId,foregroundToday:today.length,historicalOpenBackground:historical.length});
    const outcome=createOrRecoverRun(reportDate,{lockedBy:req.ip||'',rejectRunning:Boolean(before?.runId&&active.has(before.runId)),recoverFinished:Boolean(retryableFinished)});
    if(!outcome.ok){if(outcome.code==='RUN_ALREADY_COMPLETED'&&matching)return res.json({ok:true,alreadyCompleted:true,reportDate,snapshotId:matching.snapshotId});return res.status(outcome.code==='RUN_ALREADY_ACTIVE'?409:400).json(outcome);}
    const run=outcome.run;runId=run.runId;active.add(runId);
    const work={...loaded,carryBills:[],nextCarryBills:[],currentRun:run,processing:{...(loaded.processing||{}),running:true,paused:false,phase:'准备处理当日日报',runId},lastRunSummary:{...(loaded.lastRunSummary||{}),reportDate,runId,runStatus:'running',foregroundToday:today.length,historicalOpenBackground:historical.length}};
    await persist(work,historical);
    await appendRuntimeLog(`CCSL前台仅处理当日 ${today.length}票；历史OPEN ${historical.length}票由后台00:05及每2小时刷新。`);
    let result;let partial=false;
    try{
      result=await runQcPipeline({state:work,client:new CEClient(),onProgress:async msg=>{work.logs=[...(work.logs||[]),`[${new Date().toLocaleTimeString()}] ${msg}`].slice(-300);await appendRuntimeLog(`[CCSL] ${msg}`);},onCheckpoint:async current=>{current.currentRun={...(current.currentRun||run),runId,reportDate};current.lastRunSummary={...(current.lastRunSummary||{}),runId,reportDate,foregroundToday:today.length,historicalOpenBackground:historical.length};await persist(current,historical);},isPaused:async()=>Boolean((await loadState()).processing?.paused)});
    }catch(error){
      if(!retryError(error))throw error;
      await persist(work,historical);
      updateRunLock(reportDate,'failed',error.message||String(error));
      return res.status(409).json({ok:false,code:error.code||'CCSL_RETRY_REQUIRED',retryRequired:true,error:error.message||String(error),foregroundToday:today.length,historicalOpenBackground:historical.length,message:'当日失败票已保存断点；点击继续处理只重试当日失败票。历史遗留不会重新进入前台队列。'});
    }
    const snapshot=await finalize({state:result.state,reportDate,run,partial});
    await persist(result.state,historical);
    res.json({ok:true,patchId:V136_CCSL_FOREGROUND_DAILY_ID,reportDate,snapshotId:snapshot.snapshotId,foregroundToday:today.length,historicalOpenBackground:historical.length,message:'CCSL当日日报处理完成；历史OPEN由后台独立刷新。'});
  }catch(error){if(reportDate)try{updateRunLock(reportDate,'failed',error.message||String(error));}catch{}console.error('[CE-QC][V136][CCSL_FOREGROUND]',error?.stack||error);res.status(500).json({ok:false,patchId:V136_CCSL_FOREGROUND_DAILY_ID,code:error?.code||'V136_CCSL_FOREGROUND_FAILED',error:error?.message||String(error)});}finally{if(runId)active.delete(runId);}
};}

const previousPost=express.application.post;
express.application.post=function v136CcslForegroundPost(pathValue,...handlers){const path=String(pathValue||'');if(ROUTES.has(path)){const middleware=handlers.length>1?handlers.slice(0,-1):[];return previousPost.call(this,path,...middleware,handler(path));}return previousPost.call(this,pathValue,...handlers);};
