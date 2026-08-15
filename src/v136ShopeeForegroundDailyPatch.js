import express from 'express';
import { CEClient } from './ceClient.js';
import { runQcPipeline } from './pipeline.js';
import {
  SHOPEE,
  createOrRecoverBusinessRun,
  getBusinessCurrentReportDate,
  getBusinessRunStatus,
  getMatchingBusinessSnapshot,
  loadBusinessState,
  saveBusinessSnapshot,
  saveBusinessState,
  updateBusinessRunLock
} from './businessStore.js';
import { buildShopeeDashboard } from './shopeeReporting.js';
import { appendHistorySummary } from './longBackup.js';
import { appendRuntimeLog } from './runtimeLog.js';
import { completeUnifiedSnapshot, updateCarryoverResults } from './unifiedImportStore.js';
import { loadState } from './storage.js';
import { getMatchingSnapshot } from './snapshots.js';
import { getDb } from './db.js';

export const V136_SHOPEE_FOREGROUND_DAILY_ID = '2026-08-15-v136-shopee-foreground-daily-v1';
const ROUTES = new Set(['/api/shopee/run/start','/api/shopee/run/resume']);
const activeRunIds = new Set();

function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function unique(values=[]){return [...new Set((values||[]).map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))];}
function isRetryError(error){return ['SHOPEE_PARTIAL_API_FAILURE','SCAN_RETRY_REQUIRED','TRACK_RETRY_REQUIRED','API_RETRY_REQUIRED'].includes(String(error?.code||error?.runStatus||''));}
function isCancelled(row={}){
  const state=String(row.currentState||row.scanNormalizedState||'').toUpperCase();
  return state==='ORDER_CANCELLED'||String(row.orderStatus||'')==='10'||row.订单取消==='是'||row.取消状态==='已取消'||/订单取消/.test(String(row.primaryCategory||row.主分类||''));
}
function normalizeTerminalRow(row={}){
  if(!isCancelled(row))return row;
  return {...row,currentState:'ORDER_CANCELLED',订单取消:'是',primaryCategory:'订单取消',主分类:'订单取消',异常分类:'订单取消',matchedRule:'NORMAL_FINAL_HUB',carry状态:'closed_cancelled',跨日状态:'已闭环'};
}
function mergeHistoricalCarry(state,historicalBills,priorRows){
  const today=new Set(unique(state.pnhBills||[]));
  const historical=historicalBills.filter(bill=>!today.has(bill));
  const current=unique(state.nextCarryBills?.length?state.nextCarryBills:state.carryBills||[]).filter(bill=>today.has(bill));
  const merged=unique([...current,...historical]);
  return {...state,carryBills:merged,nextCarryBills:merged,priorCarryRows:priorRows};
}
function persistCheckpoint(current,historicalBills,priorRows){
  return saveBusinessState(mergeHistoricalCarry(current,historicalBills,priorRows),SHOPEE);
}
function recipientCounts(state={}){
  let cn=0,vn=0;
  for(const row of state.dailyParseRows||[]){const group=String(row.recipient_group||row.recipientGroup||'').toUpperCase();if(group==='CN')cn++;else if(group==='VN')vn++;}
  return {cn,vn,total:cn+vn};
}
function finalRetryCount(state={}){return (state.finalRows||[]).filter(row=>/失败|RETRY|API_PENDING/i.test(`${row.API状态||''} ${row.查询状态||''} ${row.currentState||''}`)).length;}

async function finalizeCurrentDay({state,reportDate,run,outcome,partial=false}){
  state.finalRows=(state.finalRows||[]).map(normalizeTerminalRow);
  state.trackResults=(state.trackResults||[]).map(normalizeTerminalRow);
  const view=buildShopeeDashboard(state);
  if(view.recipientReconciliation?.status!=='PASSED'){
    const error=new Error('SHOPEE CN/VN收件人分组对账失败，已阻止生成正式快照。');error.code='FAILED_RECONCILIATION';throw error;
  }
  const summary={businessType:SHOPEE,reportDate,runId:run.runId,...view.metrics,
    metrics:Object.fromEntries((view.dashboardRows||[]).map(row=>[row.metricKey,row.数值])),
    metricStatuses:Object.fromEntries((view.dashboardRows||[]).map(row=>[row.metricKey,row.状态])),
    recipientReconciliation:view.recipientReconciliation,
    foregroundPolicy:'CURRENT_REPORT_ONLY',retryPending:finalRetryCount(state),partial:Boolean(partial)};
  state.historySummary=appendHistorySummary(state.historySummary||[],summary).map(item=>({...item,businessType:SHOPEE}));
  state.lastRunSummary={...(state.lastRunSummary||{}),...summary,runStatus:partial?'COMPLETED_WITH_RETRY':'COMPLETED'};
  state.lastRun=state.lastRunSummary;
  const snapshot=saveBusinessSnapshot(SHOPEE,state,buildShopeeDashboard(state));
  state.snapshotId=snapshot.snapshotId;
  updateCarryoverResults({snapshotId:snapshot.snapshotId,reportDate,rows:state.finalRows||[]});
  const ccslState=await loadState();
  const ccslSnapshot=getMatchingSnapshot(ccslState);
  completeUnifiedSnapshot({reportDate,ccslSnapshot,shopeeSnapshot:snapshot});
  updateBusinessRunLock(SHOPEE,reportDate,'finished',partial?`${summary.retryPending}票接口待后台/人工重试`:'');
  await appendRuntimeLog(`[SHOPEE CN+VN] 当日前台快照已保存：${snapshot.snapshotId}；当日${recipientCounts(state).total}票；历史OPEN不进入前台查询；待重试${summary.retryPending}票。`);
  return {snapshot,summary};
}

function handlerFor(pathValue){
  const resume=String(pathValue).endsWith('/resume');
  return async function v136ShopeeForegroundDaily(req,res){
    let reportDate='';let runId='';let historicalBills=[];let priorRows=[];
    try{
      const loaded=loadBusinessState(SHOPEE);
      reportDate=getBusinessCurrentReportDate(SHOPEE)||loaded.reportDate||'';
      if(!reportDate||!loaded.dailyReportReady)return res.status(400).json({ok:false,code:'REPORT_DATE_MISSING',error:'当前未导入SHOPEE CN/VN当日日报。'});
      const today=unique(loaded.pnhBills||[]);
      const todaySet=new Set(today);
      historicalBills=unique(loaded.carryBills||loaded.nextCarryBills||[]).filter(bill=>!todaySet.has(bill));
      priorRows=Array.isArray(loaded.priorCarryRows)?loaded.priorCarryRows:[];
      const counts=recipientCounts(loaded);

      const before=getBusinessRunStatus(SHOPEE,reportDate)?.lock||null;
      const matching=getMatchingBusinessSnapshot(loaded);
      if(before?.status==='running'&&!activeRunIds.has(before.runId))updateBusinessRunLock(SHOPEE,reportDate,'failed','V136 recovered stale foreground run lock');
      const repair=Boolean(before?.status==='finished'&&!matching);
      const outcome=createOrRecoverBusinessRun(SHOPEE,reportDate,{lockedBy:req.ip||'',repair,rejectRunning:Boolean(before?.runId&&activeRunIds.has(before.runId))});
      if(!outcome.ok){
        if(outcome.code==='RUN_ALREADY_COMPLETED'&&matching)return res.json({ok:true,alreadyCompleted:true,reportDate,snapshotId:matching.snapshotId,foregroundToday:today.length,historicalOpenBackground:historicalBills.length});
        return res.status(outcome.code==='RUN_ALREADY_ACTIVE'?409:400).json(outcome);
      }
      const run=outcome.run;runId=run.runId;activeRunIds.add(runId);

      // Critical V136 rule: the interactive run receives ONLY today's imported
      // bills. Historical OPEN carry remains in priorCarryRows for continuity but
      // is never placed in the CE API query pool. The dedicated two-hour backend
      // scheduler owns historical OPEN refresh.
      const work={...loaded,carryBills:[],nextCarryBills:[],currentRun:run,
        processing:{...(loaded.processing||{}),running:true,paused:false,phase:'准备处理当日日报',runId},
        lastRunSummary:{...(loaded.lastRunSummary||{}),businessType:SHOPEE,reportDate,runId,runStatus:'running',foregroundToday:today.length,historicalOpenBackground:historicalBills.length}};
      persistCheckpoint(work,historicalBills,priorRows);
      await appendRuntimeLog(`[SHOPEE CN+VN] 前台仅处理当日：CN ${counts.cn}票 + VN ${counts.vn}票 = ${counts.total}票；历史OPEN ${historicalBills.length}票由后台每2小时刷新。`);

      let partial=false;let pipelineResult=null;
      try{
        pipelineResult=await runQcPipeline({
          state:work,client:new CEClient(),
          onProgress:async message=>{work.logs=[...(work.logs||[]),`[${new Date().toLocaleTimeString()}] ${message}`].slice(-300);await appendRuntimeLog(`[SHOPEE CN+VN] ${message}`);},
          onCheckpoint:async current=>{current.currentRun={...(current.currentRun||run),runId,reportDate};current.lastRunSummary={...(current.lastRunSummary||{}),runId,reportDate,foregroundToday:today.length,historicalOpenBackground:historicalBills.length};persistCheckpoint(current,historicalBills,priorRows);},
          isPaused:async()=>Boolean(loadBusinessState(SHOPEE).processing?.paused)
        });
      }catch(error){
        if(!isRetryError(error))throw error;
        partial=true;
        pipelineResult={state:work,summary:work.lastRunSummary||{}};
        await appendRuntimeLog(`[SHOPEE CN+VN] 当日接口存在待重试票，但不再阻断整天快照：${error.message||error}`);
      }
      const finalState=pipelineResult?.state||work;
      const finalized=await finalizeCurrentDay({state:finalState,reportDate,run,outcome,partial});
      const persisted=mergeHistoricalCarry(finalState,historicalBills,priorRows);
      persisted.snapshotId=finalized.snapshot.snapshotId;
      persistCheckpoint(persisted,historicalBills,priorRows);
      res.json({ok:true,patchId:V136_SHOPEE_FOREGROUND_DAILY_ID,reportDate,run:{runId,recovered:outcome.recovered},snapshotId:finalized.snapshot.snapshotId,
        partial,retryPending:finalized.summary.retryPending,foreground:{CN:counts.cn,VN:counts.vn,total:counts.total},historicalOpenBackground:historicalBills.length,
        message:partial?'当日SHOPEE CN/VN快照已生成；少量接口失败票保留待重试，历史OPEN由后台刷新。':'当日SHOPEE CN/VN处理完成；历史OPEN未进入本次前台查询。'});
    }catch(error){
      if(reportDate)try{updateBusinessRunLock(SHOPEE,reportDate,'failed',error?.message||String(error));}catch{}
      console.error('[CE-QC][V136][SHOPEE_FOREGROUND]',error?.stack||error);
      res.status([401,403].includes(Number(error?.ceStatus||0))?401:500).json({ok:false,patchId:V136_SHOPEE_FOREGROUND_DAILY_ID,code:error?.code||'V136_SHOPEE_FOREGROUND_FAILED',error:error?.message||String(error)});
    }finally{if(runId)activeRunIds.delete(runId);}
  };
}

function queueSummary(req,res){
  try{
    const db=getDb();
    const date=String(req.query.reportDate||db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate||'').slice(0,10);
    if(!date)return res.json({ok:true,reportDate:'',today:{},historicalOpen:{},foregroundTotal:0,historicalOpenTotal:0});
    const todayRows=db.prepare("SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE reportDate=? AND snapshotId=(SELECT snapshotId FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC LIMIT 1) GROUP BY businessType").all(date,date);
    const openRows=db.prepare("SELECT businessType,COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate<? GROUP BY businessType").all(date);
    const today=Object.fromEntries(todayRows.map(r=>[r.businessType,Number(r.count||0)]));
    const historicalOpen=Object.fromEntries(openRows.map(r=>[r.businessType,Number(r.count||0)]));
    const foregroundTotal=Object.values(today).reduce((a,b)=>a+b,0),historicalOpenTotal=Object.values(historicalOpen).reduce((a,b)=>a+b,0);
    res.json({ok:true,patchId:V136_SHOPEE_FOREGROUND_DAILY_ID,reportDate:date,today,historicalOpen,foregroundTotal,historicalOpenTotal,
      policy:'FOREGROUND_CURRENT_REPORT_ONLY_BACKGROUND_OPEN_CARRY',note:'当前处理队列只等于当日日报；历史OPEN遗留由后台00:05及每2小时独立刷新。'});
  }catch(error){res.status(500).json({ok:false,error:error?.message||String(error)});}
}

const previousPost=express.application.post;
express.application.post=function v136ShopeeForegroundPost(pathValue,...handlers){
  const path=String(pathValue||'');
  if(ROUTES.has(path)){
    // Preserve middleware injected by older wrappers (auth/audit preparation) but
    // replace only the final legacy long-running handler.
    const middleware=handlers.length>1?handlers.slice(0,-1):[];
    return previousPost.call(this,path,...middleware,handlerFor(path));
  }
  return previousPost.call(this,pathValue,...handlers);
};
const previousListen=express.application.listen;let installed=false;
express.application.listen=function v136ShopeeForegroundListen(...args){if(!installed){installed=true;this.get('/api/v136/processing-queue-summary',queueSummary);}return previousListen.apply(this,args);};
