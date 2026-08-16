import express from 'express';
import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { normalizeEvent } from './analyzer.js';
import { analyzeWhppShipment, isWhppCancelledRow } from './whppAnalyzer.js';
import { classifyScanTerminal } from './scanTerminal.js';
import { isSpecialCategory } from './specialNode.js';
import { queryTrackBatchWithFallback } from './trackBatching.js';
import { loadWhppState, saveWhppState } from './whppStore.js';

const PATCH_ID='2026-08-16-v143-whpp-independent-retry-queue-v1';
const MAX_BATCH=200;
const client=new CEClient();

function clean(values=[]){return [...new Set((values||[]).map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))];}
function bill(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function group(rows=[]){const map=new Map();for(const row of rows||[]){const code=bill(row);if(!code)continue;if(!map.has(code))map.set(code,[]);map.get(code).push(row);}return map;}
function chunks(values,size){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function authError(error){return [401,403].includes(Number(error?.ceStatus||error?.status||0))||/未授权|unauthorized|token.*(?:expired|invalid)|登录.*(?:失效|过期)/i.test(String(error?.ceMsg||error?.message||''));}
function selectConfirm(rows=[]){return rows.find(row=>String(row?.orderStatus??'')==='85')||rows.find(row=>String(row?.orderStatus??'')==='100')||rows.find(row=>String(row?.orderStatus??'')==='10')||rows.at(-1)||null;}

function pendingRows(limit=MAX_BATCH){
  const db=getDb();
  return db.prepare(`SELECT c.shipmentCode,c.businessType,c.sourceReportDate,c.lastReportDate,c.status,c.apiStatus,c.closeReason,c.stateJson,c.updatedAt,f.rawJson AS finalRawJson
    FROM carryover_open_items c
    LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.shipmentCode=c.shipmentCode AND f.reportDate=c.sourceReportDate
    WHERE c.businessType='WHPP' AND c.status='OPEN' AND UPPER(COALESCE(c.apiStatus,'')) IN ('API_PENDING_RETRY','FAILED','RETRY','API_RETRY_EXHAUSTED')
    ORDER BY c.sourceReportDate ASC,c.updatedAt ASC,c.shipmentCode ASC LIMIT ?`).all(Math.max(1,Math.min(MAX_BATCH,Number(limit||MAX_BATCH))));
}
function queueSummary(){
  const db=getDb();
  const total=Number(db.prepare(`SELECT COUNT(*) count FROM carryover_open_items WHERE businessType='WHPP' AND status='OPEN' AND UPPER(COALESCE(apiStatus,'')) IN ('API_PENDING_RETRY','FAILED','RETRY','API_RETRY_EXHAUSTED')`).get()?.count||0);
  const byDate=db.prepare(`SELECT sourceReportDate reportDate,COUNT(*) count FROM carryover_open_items WHERE businessType='WHPP' AND status='OPEN' AND UPPER(COALESCE(apiStatus,'')) IN ('API_PENDING_RETRY','FAILED','RETRY','API_RETRY_EXHAUSTED') GROUP BY sourceReportDate ORDER BY sourceReportDate`).all().map(row=>({reportDate:String(row.reportDate||''),count:Number(row.count||0)}));
  return {total,byDate,oldestDate:String(byDate[0]?.reportDate||'')};
}

async function confirmMissingAware(codes=[]){
  const found=new Map();
  let remaining=clean(codes);
  const roundSizes=[25,10,5,1];
  const errors=new Map();
  for(let round=0;round<roundSizes.length&&remaining.length;round+=1){
    const size=roundSizes[round];
    for(const batch of chunks(remaining,size)){
      let rows=[];let lastError=null;let returned=false;
      for(let attempt=0;attempt<3;attempt+=1){
        try{rows=await client.confirmQuery(batch);returned=true;break;}
        catch(error){lastError=error;if(authError(error))throw error;if(attempt<2)await wait(500*(attempt+1));}
      }
      const grouped=group(rows);
      for(const code of batch){
        const selected=selectConfirm(grouped.get(code)||[]);
        if(selected){found.set(code,selected);errors.delete(code);}
        else errors.set(code,lastError?.message|| (returned?'SCAN_EMPTY_RESPONSE':'SCAN_REQUEST_FAILED'));
      }
    }
    remaining=remaining.filter(code=>!found.has(code));
  }
  return {found,failed:remaining,errorByBill:errors};
}

async function evidenceQuery(codes,query,apiName,normalize=row=>row){
  const rowsByBill=new Map();const failed=new Set();
  for(const batch of chunks(clean(codes),50)){
    const outcome=await queryTrackBatchWithFallback({batch,query,apiName,transientRetries:3,transientDelayMs:600});
    for(const success of outcome.successes||[]){
      const grouped=group((success.events||[]).map(normalize));
      for(const code of success.batch||[])rowsByBill.set(code,grouped.get(code)||[]);
    }
    for(const failure of outcome.failures||[])for(const code of failure.batch||[])failed.add(String(code||'').toUpperCase());
  }
  return {rowsByBill,failed};
}

function terminalReason(row={}){
  if(row.是否POD==='是'||row.POD状态==='POD'||String(row.currentState||'').toUpperCase()==='POD')return 'POD';
  if(row.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(String(row.currentState||'').toUpperCase())||String(row.primaryCategory||row.主分类||'')==='退回')return 'RETURNED';
  if(isWhppCancelledRow(row))return 'ORDER_CANCELLED';
  const special=String(row.specialState||row.primaryCategory||row.主分类||'').toUpperCase();
  if(['CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP'].includes(special))return special;
  if(isSpecialCategory(row)||row.primaryCategory==='仓库自提'||row.primaryCategory==='正常分流节点')return special||'NORMAL_FINAL';
  return '';
}

function failedResult(prior,code,sourceDate,message,cycle){return {...prior,shipmentCode:code,运单号:code,businessType:'WHPP',reportDate:sourceDate,sourceReportDate:sourceDate,currentState:'API_PENDING_RETRY',primaryCategory:'接口待重试',主分类:'接口待重试',异常分类:'接口待重试',是否POD:'否',POD状态:'未POD',API状态:'失败',查询状态:'refresh_failed',carry状态:'active',跨日状态:'未闭环',whppRetryCycles:cycle,whppRetryLastAt:new Date().toISOString(),whppRetryLastError:String(message||'接口无有效返回'),QC判断:'WHPP独立重试队列：至少3轮补偿后仍未取得完整接口证据，继续保留，不影响后续日报。'};}

function persist(row,sourceDate){
  const db=getDb();const now=nowIso();const code=bill(row);const terminal=terminalReason(row);const closed=Boolean(terminal);const apiFailed=String(row.查询状态||row.API状态||'').toLowerCase().includes('fail')||String(row.currentState||'').toUpperCase()==='API_PENDING_RETRY';const apiStatus=apiFailed?'API_PENDING_RETRY':'SUCCESS';const raw=JSON.stringify({...row,reportDate:sourceDate,sourceReportDate:sourceDate});
  db.prepare(`UPDATE business_final_rows SET isPod=?,primaryCategory=?,apiStatus=?,carryStatus=?,latestEventTime=?,latestEventDesc=?,latestNode=?,rawJson=?,updatedAt=? WHERE businessType='WHPP' AND shipmentCode=? AND reportDate=?`).run(row.是否POD==='是'?1:0,String(row.primaryCategory||row.主分类||''),apiStatus,closed?'CLOSED':'OPEN',String(row.latestEventTime||row.最后节点时间||''),String(row.latestEventDesc||row.最后节点||''),String(row.latestNode||row.latestNodeCode||''),raw,now,code,sourceDate);
  db.prepare(`UPDATE carryover_open_items SET lastReportDate=?,status=?,apiStatus=?,closeReason=?,stateJson=?,updatedAt=? WHERE shipmentCode=? AND businessType='WHPP'`).run(sourceDate,closed?'CLOSED':'OPEN',apiStatus,terminal,raw,now,code);
  db.prepare(`UPDATE shipment_current_state SET businessType='WHPP',reportDate=?,state=?,apiStatus=?,lastEventTime=?,stateJson=?,updatedAt=? WHERE shipmentCode=?`).run(sourceDate,terminal||String(row.currentState||row.primaryCategory||'OPEN'),apiStatus,String(row.latestEventTime||row.最后节点时间||''),raw,now,code);
}

function syncCurrentState(results=[]){
  const state=loadWhppState();if(!state?.reportDate)return;
  const same=results.filter(item=>item.sourceDate===state.reportDate);if(!same.length)return;
  const finalMap=new Map((state.finalRows||[]).map(row=>[bill(row),row]));const scanMap=new Map((state.scanResults||[]).map(row=>[bill(row),row]));const scanStatus=new Map((state.scanQueryStatus||[]).map(row=>[bill(row),row]));
  for(const item of same){finalMap.set(item.code,item.result);if(item.scanRow){scanMap.set(item.code,item.scanRow);scanStatus.set(item.code,{businessType:'WHPP',shipmentCode:item.code,reportDate:state.reportDate,status:'success',resultCount:1,errorMessage:'',checkedAt:new Date().toISOString()});}}
  state.finalRows=[...finalMap.values()];state.trackResults=state.finalRows;state.scanResults=[...scanMap.values()];state.scanQueryStatus=[...scanStatus.values()];saveWhppState(state);
}

async function recheck(limit=MAX_BATCH){
  const source=pendingRows(limit);if(!source.length)return {processed:0,recovered:0,closed:0,stillRetry:0,results:[]};
  const priorBy=new Map(source.map(row=>{const prior={...safeJson(row.stateJson,{}),...safeJson(row.finalRawJson,{})};return [String(row.shipmentCode||'').toUpperCase(),prior];}));
  const sourceDateBy=new Map(source.map(row=>[String(row.shipmentCode||'').toUpperCase(),String(row.sourceReportDate||'')]));const codes=clean(source.map(row=>row.shipmentCode));
  const scan=await confirmMissingAware(codes);const scanTerminal=new Map();const needTrack=[];const needException=[];
  for(const code of codes){const row=scan.found.get(code);if(!row)continue;const terminal=classifyScanTerminal(row,'success');scanTerminal.set(code,terminal);if(!['POD','RETURN_COMPLETED'].includes(String(terminal.currentState||''))&&terminal.trackRequired!==false)needTrack.push(code);if(String(terminal.currentState||'')==='ORDER_CANCELLED'||needTrack.includes(code))needException.push(code);}
  const track=await evidenceQuery(needTrack,c=>client.trackQuery(c),'whpp-manual-track',row=>normalizeEvent(row));
  const exceptions=await evidenceQuery(needException,c=>client.exceptionQuery(c),'whpp-manual-exception',row=>row);
  const results=[];let recovered=0;let closed=0;
  for(const code of codes){
    const prior=priorBy.get(code)||{};const sourceDate=sourceDateBy.get(code)||prior.reportDate||'';const cycle=Number(prior.whppRetryCycles||0)+1;const scanRow=scan.found.get(code);
    let result;
    if(!scanRow){result=failedResult(prior,code,sourceDate,scan.errorByBill.get(code),cycle);}
    else{
      const terminal=scanTerminal.get(code)||classifyScanTerminal(scanRow,'success');const terminalDirect=['POD','RETURN_COMPLETED'].includes(String(terminal.currentState||''));const eventFailed=needTrack.includes(code)&&track.failed.has(code);const exceptionFailed=needException.includes(code)&&exceptions.failed.has(code);
      if(eventFailed||exceptionFailed){result=failedResult({...prior,...scanRow},code,sourceDate,eventFailed?'TRACK_QUERY_FAILED':'EXCEPTION_QUERY_FAILED',cycle);}
      else if(terminalDirect){result={...prior,...scanRow,shipmentCode:code,运单号:code,businessType:'WHPP',reportDate:sourceDate,currentState:terminal.currentState,是否POD:terminal.currentState==='POD'?'是':'否',POD状态:terminal.currentState==='POD'?'POD':'未POD',退回状态:terminal.currentState==='RETURN_COMPLETED'?'已退回':'未退回',primaryCategory:terminal.currentState==='POD'?'POD':'退回',主分类:terminal.currentState==='POD'?'POD':'退回',异常分类:terminal.currentState==='POD'?'POD':'退回',API状态:'成功',查询状态:'success',whppRetryCycles:cycle,whppRetryLastAt:new Date().toISOString()};}
      else{result=analyzeWhppShipment({waybill:code,reportDate:sourceDate,scanRow,events:track.rowsByBill.get(code)||[],exceptions:exceptions.rowsByBill.get(code)||[],dailyRow:prior,priorRow:prior,apiStatus:{shipment:'success',event:needTrack.includes(code)?'success':'skipped_terminal',exception:needException.includes(code)?'success':'skipped_terminal'}});result={...prior,...result,shipmentCode:code,运单号:code,businessType:'WHPP',reportDate:sourceDate,API状态:'成功',查询状态:'success',whppRetryCycles:cycle,whppRetryLastAt:new Date().toISOString()};}
    }
    persist(result,sourceDate);const isStill=String(result.currentState||'').toUpperCase()==='API_PENDING_RETRY'||String(result.查询状态||'').toLowerCase().includes('fail');if(!isStill)recovered+=1;if(terminalReason(result))closed+=1;results.push({code,sourceDate,result,scanRow});
  }
  syncCurrentState(results);
  return {processed:results.length,recovered,closed,stillRetry:results.length-recovered,results};
}

function listHandler(req,res){try{const limit=Math.max(1,Math.min(MAX_BATCH,Number(req.query?.limit||MAX_BATCH)));const rows=pendingRows(limit).map(row=>({shipmentCode:row.shipmentCode,sourceReportDate:row.sourceReportDate,lastReportDate:row.lastReportDate,apiStatus:row.apiStatus,state:safeJson(row.stateJson,{}).primaryCategory||safeJson(row.finalRawJson,{}).primaryCategory||'接口待重试'}));res.setHeader('Cache-Control','no-store');res.json({ok:true,patchId:PATCH_ID,summary:queueSummary(),rows});}catch(error){res.status(500).json({ok:false,error:error.message||String(error)});}}
async function runHandler(req,res){try{const limit=Math.max(1,Math.min(MAX_BATCH,Number(req.body?.limit||MAX_BATCH)));const result=await recheck(limit);res.json({ok:true,patchId:PATCH_ID,processed:result.processed,recovered:result.recovered,closed:result.closed,stillRetry:result.stillRetry,summary:queueSummary(),rows:result.results.slice(0,30).map(item=>({shipmentCode:item.code,sourceReportDate:item.sourceDate,category:item.result.primaryCategory||item.result.主分类||'',queryStatus:item.result.查询状态||item.result.API状态||''}))});}catch(error){const status=authError(error)?409:500;res.status(status).json({ok:false,code:authError(error)?'AUTH_REQUIRED':'WHPP_RETRY_FAILED',error:error.message||String(error)});}}

let installed=false;const previousListen=express.application.listen;express.application.listen=function v143WhppRetryListen(...args){if(!installed){installed=true;this.get('/api/v143/whpp-retry-queue',listHandler);this.post('/api/v143/whpp-retry-queue/recheck',runHandler);}return previousListen.apply(this,args);};

export const V143_WHPP_RETRY_QUEUE_PATCH_ID=PATCH_ID;
