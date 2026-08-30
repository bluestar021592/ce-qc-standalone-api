import express from 'express';
import { getDb } from './db.js';
import { CEClient } from './ceClient.js';
import { normalizeEvent, analyzeShipment } from './analyzer.js';
import { analyzeShopeeShipment } from './shopeeAnalyzer.js';
import { classifyScanTerminal } from './scanTerminal.js';
import { getShopCodeMap } from './shopCodes.js';
import { isSpecialCategory } from './specialNode.js';
import { queryTrackBatchWithFallback } from './trackBatching.js';
import { updateCarryoverResults } from './unifiedImportStore.js';
import { reconcileCcslPartialRetryLedger } from './ccslPartialRetryLedger.js';

const PATCH_ID = '2026-08-30-v145-ccsl-partial-retry-ledger-v2';
const MAX_BATCH = 200;
const BUSINESS_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const NON_WHPP_TYPES = new Set(BUSINESS_TYPES.filter(type => type !== 'WHPP'));
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const FAILED_STATUSES = ['API_PENDING_RETRY','FAILED','RETRY','API_RETRY_EXHAUSTED'];
const client = new CEClient();
const retryJob = {
  id:'', running:false, businessType:'', phase:'空闲', total:0, resolved:0,
  recovered:0, closed:0, stillRetry:0, startedAt:'', completedAt:'', error:''
};

function clean(values=[]){return [...new Set((values||[]).map(value=>String(value||'').trim().toUpperCase()).filter(Boolean))];}
function bill(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function group(rows=[]){const map=new Map();for(const row of rows||[]){const code=bill(row);if(!code)continue;if(!map.has(code))map.set(code,[]);map.get(code).push(row);}return map;}
function chunks(values,size){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function authError(error){return [401,403].includes(Number(error?.ceStatus||error?.status||0))||/未授权|unauthorized|token.*(?:expired|invalid)|登录.*(?:失效|过期)|授权.*失效/i.test(String(error?.ceMsg||error?.message||''));}
function latestReportDate(){return String(getDb().prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate||'').trim();}
function jobView(){return {...retryJob};}
function setJob(patch={}){Object.assign(retryJob,patch);}
function failureWhere(){return `status='OPEN' AND UPPER(COALESCE(apiStatus,'')) IN (${FAILED_STATUSES.map(()=>'?').join(',')})`;}

function pendingRows({businessType='ALL',limit=MAX_BATCH}={}){
  const type=String(businessType||'ALL').trim().toUpperCase();
  const params=[...FAILED_STATUSES];
  let typeSql='';
  if(BUSINESS_TYPES.includes(type)){typeSql=' AND businessType=?';params.push(type);}
  params.push(Math.max(1,Math.min(MAX_BATCH,Number(limit||MAX_BATCH))));
  return getDb().prepare(`SELECT shipmentCode,businessType,sourceReportDate,lastReportDate,status,apiStatus,closeReason,stateJson,updatedAt
    FROM carryover_open_items WHERE ${failureWhere()}${typeSql}
    ORDER BY sourceReportDate ASC,updatedAt ASC,shipmentCode ASC LIMIT ?`).all(...params);
}

function stageOf(row={}){
  const state=safeJson(row.stateJson,{});
  const text=[state.whppRetryLastError,state.QC判断,state.primaryCategory,state.主分类,state.异常分类,state.查询状态,state.API状态,row.apiStatus].filter(Boolean).join(' ');
  if(/未授权|unauthorized|token|登录|授权/i.test(text))return '授权/登录';
  if(/confirm|订单扫描|scan/i.test(text))return '订单扫描';
  if(/exception|异常接口/i.test(text))return '异常接口';
  if(/track|轨迹/i.test(text))return '轨迹查询';
  return '接口待重试';
}

function queueSummary(filter='ALL'){
  const db=getDb();
  const baseParams=[...FAILED_STATUSES];
  const total=Number(db.prepare(`SELECT COUNT(*) count FROM carryover_open_items WHERE ${failureWhere()}`).get(...baseParams)?.count||0);
  const byBusiness=Object.fromEntries(BUSINESS_TYPES.map(type=>[type,0]));
  for(const row of db.prepare(`SELECT businessType,COUNT(*) count FROM carryover_open_items WHERE ${failureWhere()} GROUP BY businessType`).all(...baseParams)){
    if(byBusiness[row.businessType]!==undefined)byBusiness[row.businessType]=Number(row.count||0);
  }
  const selectedType=BUSINESS_TYPES.includes(String(filter||'').toUpperCase())?String(filter).toUpperCase():'ALL';
  const params=[...FAILED_STATUSES];let typeSql='';
  if(selectedType!=='ALL'){typeSql=' AND businessType=?';params.push(selectedType);}
  const selectedTotal=Number(db.prepare(`SELECT COUNT(*) count FROM carryover_open_items WHERE ${failureWhere()}${typeSql}`).get(...params)?.count||0);
  const byDate=db.prepare(`SELECT sourceReportDate reportDate,COUNT(*) count FROM carryover_open_items WHERE ${failureWhere()}${typeSql} GROUP BY sourceReportDate ORDER BY sourceReportDate`).all(...params).map(row=>({reportDate:String(row.reportDate||''),count:Number(row.count||0)}));
  const oldest=db.prepare(`SELECT businessType,sourceReportDate FROM carryover_open_items WHERE ${failureWhere()}${typeSql} ORDER BY sourceReportDate ASC,updatedAt ASC,shipmentCode ASC LIMIT 1`).get(...params)||{};
  return {total,selectedTotal,byBusiness,byDate,oldestDate:String(oldest.sourceReportDate||''),nextBusiness:String(oldest.businessType||''),filter:selectedType};
}

function selectConfirm(rows=[]){
  const priorities={POD:5,RETURN_COMPLETED:4,RETURN_IN_PROGRESS:3,OPEN_TRACK_REQUIRED:2,SCAN_PENDING_RETRY:1};
  return [...rows].sort((a,b)=>Number(priorities[classifyScanTerminal(b,'success').currentState]||0)-Number(priorities[classifyScanTerminal(a,'success').currentState]||0))[0]||null;
}

async function confirmMissingAware(codes=[],onProgress=()=>{}){
  const found=new Map();let remaining=clean(codes);const errors=new Map();const roundSizes=[25,10,5,1];
  for(const size of roundSizes){
    if(!remaining.length)break;
    const input=[...remaining];let batchIndex=0;
    for(const batch of chunks(input,size)){
      batchIndex+=1;onProgress({phase:`订单扫描 · ${size}票批`,resolved:found.size,total:codes.length,detail:`${batchIndex}/${Math.ceil(input.length/size)}`});
      let rows=[];let returned=false;let lastError=null;
      for(let attempt=0;attempt<3;attempt+=1){
        try{rows=await client.confirmQuery(batch);returned=true;break;}
        catch(error){lastError=error;if(authError(error))throw error;if(attempt<2)await wait(500*(attempt+1));}
      }
      const by=group(rows);
      for(const code of batch){const selected=selectConfirm(by.get(code)||[]);if(selected){found.set(code,selected);errors.delete(code);}else errors.set(code,lastError?.message||(returned?'SCAN_EMPTY_RESPONSE':'SCAN_REQUEST_FAILED'));}
    }
    remaining=remaining.filter(code=>!found.has(code));
  }
  return {found,failed:new Set(remaining),errorByBill:errors};
}

async function evidenceQuery(codes,query,apiName,normalize=row=>row,onProgress=()=>{}){
  const rowsByBill=new Map();const failed=new Set();const all=clean(codes);let done=0;
  for(const batch of chunks(all,50)){
    onProgress({phase:apiName.includes('exception')?'异常接口':'轨迹查询',resolved:done,total:all.length});
    const outcome=await queryTrackBatchWithFallback({batch,query,apiName,transientRetries:3,transientDelayMs:600});
    for(const success of outcome.successes||[]){const by=group((success.events||[]).map(normalize));for(const code of success.batch||[])rowsByBill.set(String(code||'').toUpperCase(),by.get(String(code||'').toUpperCase())||[]);}
    for(const failure of outcome.failures||[])for(const code of failure.batch||[])failed.add(String(code||'').toUpperCase());
    done+=batch.length;
  }
  return {rowsByBill,failed};
}

function failedResult(prior,code,businessType,reportDate,message,stage){return {...prior,shipmentCode:code,运单号:code,businessType,reportDate,currentState:'API_PENDING_RETRY',primaryCategory:'接口待重试',主分类:'接口待重试',异常分类:'接口待重试',是否POD:'否',POD状态:'未POD',API状态:'失败',查询状态:'refresh_failed',carry状态:'active',跨日状态:'未闭环',retryCenterLastAt:new Date().toISOString(),retryCenterStage:stage,retryCenterLastError:String(message||'接口无有效返回'),QC判断:`七业务接口恢复中心：${stage}至少3轮补偿后仍未取得完整接口证据，继续保留。`};}

function terminalRow({code,businessType,prior,scanRow,terminal,reportDate}){
  const base={...prior,...scanRow,shipmentCode:code,运单号:code,businessType,reportDate,currentState:terminal.currentState,scanNormalizedState:terminal.currentState,trackRequired:terminal.trackRequired,trackSkippedReason:terminal.trackSkippedReason,API状态:'成功',查询状态:'success'};
  if(terminal.currentState==='POD')return {...base,是否POD:'是',POD状态:'POD',primaryCategory:'POD闭环',主分类:'POD闭环',异常分类:'POD闭环',carry状态:'closed_pod'};
  if(terminal.currentState==='RETURN_COMPLETED')return {...base,是否POD:'否',POD状态:'未POD',退回状态:'已退回',primaryCategory:'退回',主分类:'退回',异常分类:'退回',carry状态:'closed_return'};
  return base;
}

async function recheckNonWhpp(rows,onProgress=()=>{}){
  const reportDate=latestReportDate();if(!reportDate)throw new Error('暂无综合日报日期，无法执行接口恢复。');
  const codes=clean(rows.map(row=>row.shipmentCode));if(!codes.length)return {processed:0,recovered:0,closed:0,stillRetry:0,rows:[]};
  const priorBy=new Map(rows.map(row=>[String(row.shipmentCode||'').toUpperCase(),safeJson(row.stateJson,{})]));
  const businessBy=new Map(rows.map(row=>[String(row.shipmentCode||'').toUpperCase(),String(row.businessType||'').toUpperCase()]));
  const scan=await confirmMissingAware(codes,onProgress);const trackBills=[];const scanTerminal=new Map();const resultBy=new Map();
  for(const code of codes){
    const type=businessBy.get(code)||'CE';const prior=priorBy.get(code)||{};const scanRow=scan.found.get(code);
    if(!scanRow){resultBy.set(code,failedResult(prior,code,type,reportDate,scan.errorByBill.get(code),'订单扫描'));continue;}
    const terminal=classifyScanTerminal(scanRow,'success');scanTerminal.set(code,terminal);const base=terminalRow({code,businessType:type,prior,scanRow,terminal,reportDate});resultBy.set(code,base);
    if(!['POD','RETURN_COMPLETED'].includes(String(terminal.currentState||''))&&terminal.trackRequired!==false)trackBills.push(code);
  }
  const track=await evidenceQuery(trackBills,c=>client.trackQuery(c),'seven-retry-track',row=>({...normalizeEvent(row),reportDate}),onProgress);
  const shopeeBills=trackBills.filter(code=>SHOPEE_TYPES.has(businessBy.get(code))&&!track.failed.has(code));
  const exceptions=await evidenceQuery(shopeeBills,c=>client.exceptionQuery(c),'seven-retry-exception',row=>row,onProgress);
  const shopCodeMap=getShopCodeMap();
  for(const code of trackBills){
    const type=businessBy.get(code)||'CE';const prior=priorBy.get(code)||{};const scanRow=scan.found.get(code);const terminal=scanTerminal.get(code);
    if(track.failed.has(code)){resultBy.set(code,failedResult({...prior,...scanRow},code,type,reportDate,'TRACK_QUERY_FAILED','轨迹查询'));continue;}
    if(SHOPEE_TYPES.has(type)&&exceptions.failed.has(code)){resultBy.set(code,failedResult({...prior,...scanRow},code,type,reportDate,'EXCEPTION_QUERY_FAILED','异常接口'));continue;}
    let analyzed;
    if(SHOPEE_TYPES.has(type)){
      analyzed=analyzeShopeeShipment({waybill:code,reportDate,scanRow,events:track.rowsByBill.get(code)||[],exceptions:exceptions.rowsByBill.get(code)||[],dailyRow:prior,priorRow:prior,apiStatus:{shipment:'success',event:'success',exception:'success'}});
    }else{
      analyzed=analyzeShipment({waybill:code,reportDate,scanRow,events:track.rowsByBill.get(code)||[],shopCodeMap});
    }
    resultBy.set(code,{...prior,...analyzed,shipmentCode:code,运单号:code,businessType:type,reportDate,API状态:'成功',查询状态:'success',retryCenterLastAt:new Date().toISOString()});
  }
  const results=codes.map(code=>resultBy.get(code)).filter(Boolean);const snapshotId=`SEVEN-RETRY-${reportDate}-${Date.now()}`;
  updateCarryoverResults({snapshotId,reportDate,rows:results});
  const stillRetry=results.filter(row=>String(row.currentState||'').toUpperCase()==='API_PENDING_RETRY'||String(row.查询状态||'').toLowerCase().includes('fail')).length;
  const closed=results.filter(row=>row.是否POD==='是'||row.退回状态==='已退回'||isSpecialCategory(row)||row.primaryCategory==='仓库自提'||row.primaryCategory==='正常分流节点').length;
  return {processed:results.length,recovered:results.length-stillRetry,closed,stillRetry,rows:results};
}

function startJob(businessType,limit){
  if(retryJob.running)return jobView();
  const requested=String(businessType||'ALL').toUpperCase();
  let selected=pendingRows({businessType:requested,limit});selected=selected.filter(row=>row.businessType!=='WHPP');
  if(!selected.length){setJob({id:'',running:false,businessType:requested,phase:'无待重试',total:0,resolved:0,recovered:0,closed:0,stillRetry:0,startedAt:'',completedAt:new Date().toISOString(),error:''});return jobView();}
  const actualType=String(selected[0].businessType||requested);selected=selected.filter(row=>row.businessType===actualType).slice(0,limit);
  const id=`SEVEN-RETRY-${Date.now()}`;setJob({id,running:true,businessType:actualType,phase:'准备中',total:selected.length,resolved:0,recovered:0,closed:0,stillRetry:selected.length,startedAt:new Date().toISOString(),completedAt:'',error:''});
  setImmediate(async()=>{try{const result=await recheckNonWhpp(selected,progress=>setJob({phase:progress.phase||retryJob.phase,resolved:Number(progress.resolved||0),total:Number(progress.total||retryJob.total)}));setJob({running:false,phase:'本批完成',total:result.processed,resolved:result.processed,recovered:result.recovered,closed:result.closed,stillRetry:result.stillRetry,completedAt:new Date().toISOString(),error:''});}catch(error){setJob({running:false,phase:authError(error)?'需要重新登录CE':'本批失败',completedAt:new Date().toISOString(),error:String(error?.message||error)});}});
  return jobView();
}

function reconcileExistingCcslPartialFailure(){
  try{return reconcileCcslPartialRetryLedger();}
  catch(error){console.error('[CE-QC][V145] CCSL partial retry ledger reconciliation failed:',error);return {ok:false,error:String(error?.message||error)};}
}

function listHandler(req,res){
  try{
    const reconciliation=reconcileExistingCcslPartialFailure();
    const type=String(req.query?.businessType||'ALL').toUpperCase();
    const limit=Math.max(1,Math.min(MAX_BATCH,Number(req.query?.limit||MAX_BATCH)));
    const rows=pendingRows({businessType:type,limit}).map(row=>({shipmentCode:row.shipmentCode,businessType:row.businessType,sourceReportDate:row.sourceReportDate,lastReportDate:row.lastReportDate,apiStatus:row.apiStatus,stage:stageOf(row),updatedAt:row.updatedAt}));
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,patchId:PATCH_ID,reconciliation,summary:queueSummary(type),job:jobView(),rows});
  }catch(error){res.status(500).json({ok:false,error:error.message||String(error)});}
}
function runHandler(req,res){
  try{
    const reconciliation=reconcileExistingCcslPartialFailure();
    const type=String(req.body?.businessType||'ALL').toUpperCase();
    if(type==='WHPP')return res.status(409).json({ok:false,code:'USE_WHPP_ENGINE',error:'WHPP失败票由现有WHPP补扫引擎处理。'});
    if(type!=='ALL'&&!NON_WHPP_TYPES.has(type))return res.status(400).json({ok:false,error:'业务类型无效。'});
    const limit=Math.max(1,Math.min(MAX_BATCH,Number(req.body?.limit||MAX_BATCH)));
    const job=startJob(type,limit);
    res.status(job.running?202:200).json({ok:true,patchId:PATCH_ID,reconciliation,started:job.running,job,summary:queueSummary(type)});
  }catch(error){res.status(authError(error)?409:500).json({ok:false,code:authError(error)?'AUTH_REQUIRED':'SEVEN_RETRY_FAILED',error:error.message||String(error)});}
}

let installed=false;const previousListen=express.application.listen;express.application.listen=function v145SevenBusinessRetryListen(...args){if(!installed){installed=true;this.get('/api/v145/retry-center',listHandler);this.post('/api/v145/retry-center/recheck',runHandler);}return previousListen.apply(this,args);};

export const V145_SEVEN_BUSINESS_RETRY_CENTER_ID=PATCH_ID;
