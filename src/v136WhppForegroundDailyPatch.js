import express from 'express';
import { CEClient } from './ceClient.js';
import { runWhppPipeline } from './whppPipeline.js';
import { loadWhppState, saveWhppState, finalizeWhppState } from './whppStore.js';

export const V136_WHPP_FOREGROUND_DAILY_ID='2026-08-15-v136-whpp-foreground-daily-v1';
const TIMEOUT_MS=Math.max(8_000,Math.min(45_000,Number(process.env.WHPP_REQUEST_TIMEOUT_MS||20_000)));
let activePromise=null;let runtime=idle();let lastRuntime=idle();
function now(){return new Date().toISOString();}
function idle(){return {active:false,reportDate:'',phase:'',lastMessage:'',batchIndex:0,totalBatches:0,startedAt:'',heartbeatAt:'',finishedAt:'',outcome:'',retryPending:0,error:'',foregroundToday:0,historicalOpenBackground:0};}
function clean(values=[]){return [...new Set((values||[]).map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))];}
function strip(row={}){if(!row||typeof row!=='object')return row;const copy={...row};delete copy.rawJson;delete copy.raw;delete copy.events;delete copy.trackEvents;delete copy.scanRaw;return copy;}
function compact(state={},log=[]){return {...state,scanResults:(state.scanResults||[]).map(strip),trackEvents:(state.trackEvents||[]).map(strip),exceptionItems:(state.exceptionItems||[]).map(strip),trackResults:[],progressLog:log.slice(-120),processing:{...(state.processing||{}),lastCheckpointAt:now()}};}
function parse(message=''){const text=String(message||'');const scan=text.match(/WHPP订单扫描\s+(\d+)-(\d+)\s*\/\s*(\d+)/i);if(scan)return {phase:text,batchIndex:Number(scan[2]||0),totalBatches:Number(scan[3]||0)};const batch=text.match(/(WHPP[^：]*查询)\s+(\d+)\/(\d+)/i);if(batch)return {phase:text,batchIndex:Number(batch[2]||0),totalBatches:Number(batch[3]||0)};return {phase:text};}
function pub(v=runtime){return {...v,active:Boolean(v.active),batchIndex:Number(v.batchIndex||0),totalBatches:Number(v.totalBatches||0),retryPending:Number(v.retryPending||0)};}
function launch(){
  const loaded=loadWhppState();if(!loaded.reportDate||!loaded.dailyReportReady){const e=new Error('当前未导入WHPP本土日报数据。');e.code='WHPP_REPORT_MISSING';throw e;}
  const today=clean(loaded.pnhBills||[]),todaySet=new Set(today);const historical=clean(loaded.carryBills||loaded.nextCarryBills||[]).filter(b=>!todaySet.has(b));
  const state={...loaded,carryBills:[],nextCarryBills:[]};const client=new CEClient();if(client?.http?.defaults)client.http.defaults.timeout=TIMEOUT_MS;
  const log=[];const startedAt=now();runtime={...idle(),active:true,reportDate:state.reportDate,phase:'WHPP启动处理中',lastMessage:`WHPP前台仅处理当日 ${today.length}票；历史OPEN ${historical.length}票由后台刷新`,startedAt,heartbeatAt:startedAt,foregroundToday:today.length,historicalOpenBackground:historical.length};
  activePromise=Promise.resolve().then(async()=>{
    try{
      const result=await runWhppPipeline({state,client,onProgress:async message=>{const text=String(message||'');log.push({at:now(),message:text});if(log.length>120)log.shift();runtime={...runtime,...parse(text),active:true,lastMessage:text,heartbeatAt:now()};},onCheckpoint:async current=>{runtime={...runtime,active:true,heartbeatAt:now()};saveWhppState(compact(current,log));},isPaused:async()=>Boolean(loadWhppState().processing?.paused)});
      const finalized=finalizeWhppState(result.state);const retry=Number(result.summary?.retry||0);runtime={...runtime,active:false,phase:retry?'WHPP快照已生成，接口待重试':'完成',lastMessage:`WHPP当日完成：POD ${Number(result.summary?.pod||0)}票，退回 ${Number(result.summary?.returned||0)}票，待重试 ${retry}票`,finishedAt:now(),heartbeatAt:now(),outcome:retry?'COMPLETED_WITH_RETRY':'COMPLETED',retryPending:retry};return {ok:true,...finalized,summary:result.summary};
    }catch(error){
      if(error?.code==='WHPP_PARTIAL_API_FAILURE'&&error?.state){try{const summary=error.state.lastRunSummary||{};const finalized=finalizeWhppState(error.state);const retry=Number(summary.retry||0);runtime={...runtime,active:false,phase:'WHPP快照已生成，接口待重试',lastMessage:`WHPP当日快照已生成，${retry}票接口待重试`,finishedAt:now(),heartbeatAt:now(),outcome:'COMPLETED_WITH_RETRY',retryPending:retry};return {ok:true,partial:true,...finalized,summary};}catch(finalError){error=finalError;}}
      runtime={...runtime,active:false,phase:'WHPP执行失败',finishedAt:now(),heartbeatAt:now(),outcome:'FAILED',error:error?.message||String(error)};const failed=loadWhppState();failed.processing={...(failed.processing||{}),running:false,paused:false,phase:'WHPP执行失败',error:runtime.error};saveWhppState(compact(failed,log));return {ok:false,error:runtime.error};
    }
  }).finally(()=>{lastRuntime={...runtime,active:false};activePromise=null;});return pub(runtime);
}
function start(req,res){try{if(activePromise&&runtime.active)return res.status(409).json({ok:false,code:'WHPP_RUN_ALREADY_ACTIVE',error:'WHPP当前当日任务正在后台运行，请勿重复启动。',runtime:pub()});const started=launch();res.status(202).json({ok:true,accepted:true,patchId:V136_WHPP_FOREGROUND_DAILY_ID,runtime:started,message:'WHPP前台只处理当日日报；历史OPEN由后台00:05及每2小时独立刷新。'});}catch(error){res.status(error?.code==='WHPP_REPORT_MISSING'?400:500).json({ok:false,code:error?.code||'WHPP_START_FAILED',error:error?.message||String(error)});}}
function progress(req,res){const state=loadWhppState();const live=Boolean(activePromise&&runtime.active&&runtime.reportDate===state.reportDate);const persisted={...(state.processing||{})};const stale=Boolean(persisted.running&&!live);const processing=live?{...persisted,running:true,phase:runtime.lastMessage||runtime.phase,batchIndex:runtime.batchIndex,totalBatches:runtime.totalBatches,heartbeatAt:runtime.heartbeatAt}:stale?{...persisted,running:false,paused:false,phase:'WHPP等待人工继续',error:'上次前台任务已中断；点击继续处理从当日断点恢复。'}:persisted;res.json({ok:true,patchId:V136_WHPP_FOREGROUND_DAILY_ID,reportDate:state.reportDate,processing,runtimeActive:live,stale,runtime:pub(live?runtime:lastRuntime),summary:state.lastRunSummary,foregroundPolicy:'CURRENT_REPORT_ONLY'});}
const previousListen=express.application.listen;let installed=false;
express.application.listen=function v136WhppForegroundListen(...args){if(!installed){installed=true;this.get('/api/whpp/progress',progress);this.post('/api/whpp/run/start',start);this.post('/api/whpp/run/resume',start);}return previousListen.apply(this,args);};
