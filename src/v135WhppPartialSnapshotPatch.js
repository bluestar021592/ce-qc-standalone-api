import express from 'express';
import { CEClient } from './ceClient.js';
import { runWhppPipeline } from './whppPipeline.js';
import { loadWhppState, saveWhppState, finalizeWhppState } from './whppStore.js';

const PATCH_ID='2026-08-14-v135-whpp-partial-snapshot-v1';
const TIMEOUT_MS=Math.max(8_000,Math.min(45_000,Number(process.env.WHPP_REQUEST_TIMEOUT_MS||20_000)));
const LOG_LIMIT=120;
let activePromise=null;
let runtime=idle();
let lastRuntime=idle();

function now(){return new Date().toISOString();}
function idle(){return {active:false,reportDate:'',mode:'',phase:'',lastMessage:'',batchIndex:0,totalBatches:0,startedAt:'',heartbeatAt:'',finishedAt:'',outcome:'',retryPending:0,error:''};}
function stripHeavy(row={}){if(!row||typeof row!=='object')return row;const copy={...row};delete copy.rawJson;delete copy.raw;delete copy.events;delete copy.trackEvents;delete copy.scanRaw;return copy;}
function compact(state={},log=[]){return {...state,scanResults:(state.scanResults||[]).map(stripHeavy),trackEvents:(state.trackEvents||[]).map(stripHeavy),exceptionItems:(state.exceptionItems||[]).map(stripHeavy),trackResults:[],progressLog:log.slice(-LOG_LIMIT),processing:{...(state.processing||{}),lastCheckpointAt:now()}};}
function parseProgress(message=''){const text=String(message||'');const scan=text.match(/WHPP订单扫描\s+(\d+)-(\d+)\s*\/\s*(\d+)/i);if(scan)return {phase:text,batchIndex:Number(scan[2]||0),totalBatches:Number(scan[3]||0)};const batch=text.match(/(WHPP[^：]*查询)\s+(\d+)\/(\d+)/i);if(batch)return {phase:text,batchIndex:Number(batch[2]||0),totalBatches:Number(batch[3]||0)};return {phase:text};}
function pub(value=runtime){return {active:Boolean(value.active),reportDate:value.reportDate||'',mode:value.mode||'',phase:value.phase||'',lastMessage:value.lastMessage||'',batchIndex:Number(value.batchIndex||0),totalBatches:Number(value.totalBatches||0),startedAt:value.startedAt||'',heartbeatAt:value.heartbeatAt||'',finishedAt:value.finishedAt||'',outcome:value.outcome||'',retryPending:Number(value.retryPending||0),error:value.error||''};}
function authFailure(error){return /401|403|未授权|unauthorized|登录.*失效|token/i.test(`${error?.ceStatus||''} ${error?.ceCode||''} ${error?.message||''}`);}
function persistFailure(error,log){try{const current=loadWhppState();current.processing={...(current.processing||{}),running:false,paused:false,phase:authFailure(error)?'等待CE重新登录':'WHPP执行失败',error:error?.message||String(error||'WHPP_RUN_FAILED'),lastCheckpointAt:now()};saveWhppState(compact(current,log));}catch(persistError){console.error('[CE-QC][V135] persist failure state failed:',persistError?.stack||persistError);}}
function completeRuntime(summary={},outcome='COMPLETED',message=''){const retry=Number(summary?.retry||0);runtime={...runtime,active:false,phase:retry?'WHPP快照已生成，接口待重试':'完成',lastMessage:message||`WHPP完成：POD ${Number(summary?.pod||0)}票，退回 ${Number(summary?.returned||0)}票，待重试 ${retry}票`,heartbeatAt:now(),finishedAt:now(),outcome,retryPending:retry,error:''};}

function launch(mode='start'){
  const state=loadWhppState();
  if(!state.reportDate||!state.dailyReportReady){const error=new Error('当前未导入WHPP本土日报数据。');error.code='WHPP_REPORT_MISSING';throw error;}
  const client=new CEClient();
  if(client?.http?.defaults)client.http.defaults.timeout=TIMEOUT_MS;
  const log=[];const startedAt=now();
  runtime={...idle(),active:true,reportDate:state.reportDate,mode,phase:'WHPP启动处理中',lastMessage:'WHPP后台任务已启动',startedAt,heartbeatAt:startedAt};
  activePromise=Promise.resolve().then(async()=>{
    try{
      const result=await runWhppPipeline({
        state,client,
        onProgress:async message=>{const text=String(message||'');log.push({at:now(),message:text});if(log.length>LOG_LIMIT)log.shift();runtime={...runtime,...parseProgress(text),active:true,lastMessage:text,heartbeatAt:now()};},
        onCheckpoint:async current=>{const p=current.processing||{};runtime={...runtime,active:true,phase:runtime.lastMessage||p.phase||runtime.phase,batchIndex:runtime.batchIndex||Number(p.batchIndex||0),totalBatches:runtime.totalBatches||Number(p.totalBatches||0),heartbeatAt:now()};saveWhppState(compact(current,log));},
        isPaused:async()=>Boolean(loadWhppState().processing?.paused)
      });
      const finalized=finalizeWhppState(result.state);
      completeRuntime(result.summary,'COMPLETED');
      return {ok:true,partial:false,...finalized,summary:result.summary,log};
    }catch(error){
      if(error?.code==='WHPP_PARTIAL_API_FAILURE'&&error?.state){
        try{
          const summary=error.state.lastRunSummary||error.state.lastRun||{};
          const finalized=finalizeWhppState(error.state);
          const retry=Number(summary?.retry||0);
          completeRuntime(summary,'COMPLETED_WITH_RETRY',`WHPP快照已生成：POD ${Number(summary?.pod||0)}票，退回 ${Number(summary?.returned||0)}票，${retry}票接口待重试；已保留断点。`);
          console.warn(`[CE-QC][V135] WHPP partial API failure finalized safely with ${retry} retry rows.`);
          return {ok:true,partial:true,retryPending:retry,...finalized,summary,log};
        }catch(finalizeError){
          persistFailure(finalizeError,log);
          runtime={...runtime,active:false,heartbeatAt:now(),finishedAt:now(),outcome:'FAILED',error:finalizeError?.message||String(finalizeError)};
          console.error('[CE-QC][V135][PARTIAL_FINALIZE_FAILED]',finalizeError?.stack||finalizeError);
          return {ok:false,code:finalizeError?.code||'WHPP_PARTIAL_FINALIZE_FAILED',error:runtime.error};
        }
      }
      persistFailure(error,log);
      runtime={...runtime,active:false,heartbeatAt:now(),finishedAt:now(),outcome:authFailure(error)?'AUTH_REQUIRED':'FAILED',error:error?.message||String(error||'WHPP_RUN_FAILED')};
      console.error('[CE-QC][V135][WHPP_BACKGROUND]',error?.stack||error);
      return {ok:false,code:error?.code||'WHPP_RUN_FAILED',error:runtime.error};
    }
  }).finally(()=>{lastRuntime={...runtime,active:false};activePromise=null;});
  return pub(runtime);
}

function start(mode){return(req,res)=>{try{if(activePromise&&runtime.active)return res.status(409).json({ok:false,code:'WHPP_RUN_ALREADY_ACTIVE',error:'WHPP当前任务正在后台运行，请勿重复启动。',runtime:pub(runtime)});const started=launch(mode);return res.status(202).json({ok:true,accepted:true,patchId:PATCH_ID,reportDate:started.reportDate,processing:{running:true,phase:started.phase},runtime:started,message:'WHPP任务已进入后台执行；成功票会生成快照，接口失败票保留为待重试，不再阻断整批。'});}catch(error){return res.status(error?.code==='WHPP_REPORT_MISSING'?400:500).json({ok:false,code:error?.code||'WHPP_RUN_START_FAILED',error:error?.message||String(error)});}};}
function progress(req,res){const state=loadWhppState();const runtimeActive=Boolean(activePromise&&runtime.active&&runtime.reportDate===state.reportDate);const persisted={...(state.processing||{})};const stale=Boolean(persisted.running&&!runtimeActive);const processing=runtimeActive?{...persisted,running:true,paused:Boolean(persisted.paused),phase:runtime.lastMessage||runtime.phase||persisted.phase||'WHPP处理中',batchIndex:Number(runtime.batchIndex||persisted.batchIndex||0),totalBatches:Number(runtime.totalBatches||persisted.totalBatches||0),heartbeatAt:runtime.heartbeatAt||persisted.lastCheckpointAt||''}:stale?{...persisted,running:false,paused:false,phase:'WHPP等待断点恢复',error:'检测到上次后台任务已中断，将从已保存断点继续。'}:persisted;res.json({ok:true,patchId:PATCH_ID,reportDate:state.reportDate,processing,runtimeActive,stale,runtime:pub(runtimeActive?runtime:lastRuntime),requestTimeoutMs:TIMEOUT_MS,summary:state.lastRunSummary,log:(state.progressLog||[]).slice(-50)});}

const previousListen=express.application.listen;let installed=false;
express.application.listen=function v135WhppPartialSnapshotListen(...args){if(!installed){installed=true;this.get('/api/whpp/progress',progress);this.post('/api/whpp/run/start',start('start'));this.post('/api/whpp/run/resume',start('resume'));}return previousListen.apply(this,args);};
export function inspectV135WhppRuntime(){return {patchId:PATCH_ID,requestTimeoutMs:TIMEOUT_MS,runtimeActive:Boolean(activePromise&&runtime.active),runtime:pub(activePromise&&runtime.active?runtime:lastRuntime)};}
export const V135_WHPP_PARTIAL_SNAPSHOT_PATCH_ID=PATCH_ID;
