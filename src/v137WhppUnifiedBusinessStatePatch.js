import express from 'express';
import { getDb } from './db.js';

const PATCH_ID='2026-08-21-v201-whpp-summary-cache-v1';
const LEGACY_ROUTE='/api/v132/whpp-fast-summary';
const BUSINESS_ROUTE='/api/business-state/:businessType';
const CACHE_MS=Math.max(10_000,Number(process.env.V201_WHPP_DASHBOARD_CACHE_MS||60_000));
const stateCache=new Map();

function dateOnly(value=''){
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function num(value){const n=Number(value||0);return Number.isFinite(n)?n:0;}
function rate(value,total){return total?Number((num(value)*100/num(total)).toFixed(2)):0;}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function emptyRegion(code){return {regionCode:code,total:0,pod:0,podRate:0,returned:0,cancelled:0,unresolved:0,pending1:0,pending2:0,pending3:0,oc1:0,oc2:0,oc3:0,shop:0,phnomPenhShop:0,provinceShop:0};}
function normalizeRegion(code,row={}){
  const total=num(row.total),shop=num(row.shop??(code==='PP'?row.phnomPenhShop:row.provinceShop));
  return {...emptyRegion(code),...row,regionCode:code,total,pod:num(row.pod),podRate:Number.isFinite(Number(row.podRate))?Number(row.podRate):rate(row.pod,total),returned:num(row.returned),cancelled:num(row.cancelled),unresolved:num(row.unresolved),pending1:num(row.pending1),pending2:num(row.pending2),pending3:num(row.pending3),oc1:num(row.oc1),oc2:num(row.oc2),oc3:num(row.oc3),shop,phnomPenhShop:code==='PP'?num(row.phnomPenhShop??shop):0,provinceShop:code==='PV'?num(row.provinceShop??shop):0};
}

function latestDate(db,requested=''){
  const explicit=dateOnly(requested);if(explicit)return explicit;
  return String(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP' ORDER BY reportDate DESC LIMIT 1").get()?.reportDate||'');
}

function importedRegions(db,date){
  const out={PP:emptyRegion('PP'),PV:emptyRegion('PV'),UNKNOWN:emptyRegion('UNKNOWN')};
  const rows=db.prepare(`
    SELECT CASE UPPER(COALESCE(json_extract(rowJson,'$.regionCode'),json_extract(rowJson,'$.区域'),''))
      WHEN 'PP' THEN 'PP' WHEN 'PV' THEN 'PV' ELSE 'UNKNOWN' END regionCode,
      COUNT(*) total
    FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=?
    GROUP BY regionCode
  `).all(date);
  for(const row of rows){
    const code=['PP','PV'].includes(String(row.regionCode))?String(row.regionCode):'UNKNOWN';
    out[code]={...emptyRegion(code),total:num(row.total),unresolved:num(row.total)};
  }
  return out;
}

function finalRegions(db,date){
  const terminal=`(COALESCE(isPod,0)=1 OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') OR COALESCE(json_extract(rawJson,'$.退回状态'),'')='已退回')`;
  const returned=`(COALESCE(json_extract(rawJson,'$.退回状态'),'')='已退回' OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED') OR COALESCE(primaryCategory,'')='退回')`;
  const cancelled=`(UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='ORDER_CANCELLED' OR COALESCE(json_extract(rawJson,'$.订单取消'),'')='是')`;
  const special=`UPPER(COALESCE(json_extract(rawJson,'$.specialState'),json_extract(rawJson,'$.primaryCategory'),json_extract(rawJson,'$.主分类'),'')) IN ('SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION')`;
  const shop=`COALESCE(json_extract(rawJson,'$.shopState'),json_extract(rawJson,'$.storeFlowState'),'') IN ('SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT')`;
  const actionable=`(NOT ${terminal} AND NOT ${special} AND NOT ${shop})`;
  const region=`CASE UPPER(COALESCE(json_extract(rawJson,'$.regionCode'),json_extract(rawJson,'$.区域'),'')) WHEN 'PP' THEN 'PP' WHEN 'PV' THEN 'PV' ELSE 'UNKNOWN' END`;
  const rows=db.prepare(`
    SELECT ${region} regionCode,COUNT(*) total,
      SUM(CASE WHEN COALESCE(isPod,0)=1 THEN 1 ELSE 0 END) pod,
      SUM(CASE WHEN ${returned} AND COALESCE(isPod,0)=0 THEN 1 ELSE 0 END) returned,
      SUM(CASE WHEN ${cancelled} AND COALESCE(isPod,0)=0 AND NOT ${returned} THEN 1 ELSE 0 END) cancelled,
      SUM(CASE WHEN ${actionable} THEN 1 ELSE 0 END) unresolved,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.Pending当前次数') AS INTEGER),CAST(json_extract(rawJson,'$.Pending次数') AS INTEGER),CAST(json_extract(rawJson,'$.pendingDistinctDayCount') AS INTEGER),0)>=1 THEN 1 ELSE 0 END) pending1,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.Pending当前次数') AS INTEGER),CAST(json_extract(rawJson,'$.Pending次数') AS INTEGER),CAST(json_extract(rawJson,'$.pendingDistinctDayCount') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) pending2,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.Pending当前次数') AS INTEGER),CAST(json_extract(rawJson,'$.Pending次数') AS INTEGER),CAST(json_extract(rawJson,'$.pendingDistinctDayCount') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) pending3,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.OC天数') AS INTEGER),0)>=1 THEN 1 ELSE 0 END) oc1,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.OC天数') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) oc2,
      SUM(CASE WHEN ${actionable} AND COALESCE(CAST(json_extract(rawJson,'$.OC天数') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) oc3,
      SUM(CASE WHEN NOT ${terminal} AND ${shop} THEN 1 ELSE 0 END) shop
    FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? GROUP BY ${region}
  `).all(date);
  const out={PP:emptyRegion('PP'),PV:emptyRegion('PV'),UNKNOWN:emptyRegion('UNKNOWN')};
  for(const row of rows){
    const code=['PP','PV'].includes(String(row.regionCode))?String(row.regionCode):'UNKNOWN';
    out[code]=normalizeRegion(code,row);
  }
  return out;
}

function storedRegions(source={},expectedTotal=0){
  const raw=source?.regions;
  if(!raw||typeof raw!=='object')return null;
  const out={PP:normalizeRegion('PP',raw.PP||{}),PV:normalizeRegion('PV',raw.PV||{}),UNKNOWN:normalizeRegion('UNKNOWN',raw.UNKNOWN||{})};
  const total=num(out.PP.total)+num(out.PV.total)+num(out.UNKNOWN.total);
  if(num(expectedTotal)>0&&total!==num(expectedTotal))return null;
  return out;
}

function buildWhppUnifiedState(requested=''){
  const db=getDb();
  const reportDate=latestDate(db,requested);
  if(!reportDate){
    const metrics={total:0,pod:0,podRate:0,returned:0,returnRate:0,cancelled:0,cancelRate:0,unresolved:0,retryPending:0};
    return {businessType:'WHPP',viewBusinessType:'WHPP',reportDate:'',snapshotId:'',snapshotStatus:'EMPTY',dailyReportReady:false,completed:false,total:0,metrics,regions:{PP:emptyRegion('PP'),PV:emptyRegion('PV'),UNKNOWN:emptyRegion('UNKNOWN')},dashboard:{metrics,regions:{PP:emptyRegion('PP'),PV:emptyRegion('PV'),UNKNOWN:emptyRegion('UNKNOWN')}},processing:{running:false,paused:false,phase:''},sourceTruth:'NORMALIZED_SQLITE',patchId:PATCH_ID};
  }
  const daily=db.prepare("SELECT totalCount,updatedAt FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)||{};
  const history=db.prepare("SELECT summaryJson,updatedAt FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)||null;
  const finalStat=db.prepare("SELECT COUNT(*) count,MAX(updatedAt) updatedAt,SUM(CASE WHEN UPPER(COALESCE(apiStatus,''))='API_PENDING_RETRY' THEN 1 ELSE 0 END) retryPending FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?").get(reportDate)||{};
  const run=db.prepare("SELECT runId,status,currentStage,batchIndex,totalBatches,errorMessage,updatedAt FROM business_run_locks WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)||null;
  const currentRunId=String(run?.runId||'').trim();
  const snapshot=currentRunId?db.prepare("SELECT snapshotId,runId,generatedAt FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? AND runId=? AND COALESCE(status,'VALID')='VALID' ORDER BY createdAt DESC,id DESC LIMIT 1").get(reportDate,currentRunId)||null:null;
  const fingerprint=[reportDate,daily.updatedAt||'',history?.updatedAt||'',num(finalStat.count),num(finalStat.retryPending),finalStat.updatedAt||'',currentRunId,snapshot?.snapshotId||'',snapshot?.generatedAt||'',run?.updatedAt||''].join('|');
  const cached=stateCache.get(reportDate);
  if(cached&&cached.fingerprint===fingerprint&&Date.now()-cached.at<CACHE_MS)return {...cached.state,cacheHit:true};

  const total=num(daily.totalCount);
  const source=safeJson(history?.summaryJson,{});
  const metrics={...source,total:num(source.total??total)};
  delete metrics.accounting;delete metrics.snapshotId;delete metrics.regions;
  for(const key of ['pod','returned','cancelled','unresolved','pendingNonContinuous','pending1','pending2','pending3','oc1','oc2','oc3','cycle2','inboundNoScan','delivery','workOrder','normalDiversion','shopTotal','ccslCnDiversion','ccslZtDiversion','ccsl580Retention','ccsl580Diversion','phnomPenhShop','provinceShop','unknownShop','dispatchAttempt1','dispatchAttempt2','dispatchAttempt3'])metrics[key]=num(metrics[key]);
  metrics.retryPending=num(finalStat.retryPending);
  metrics.podRate=history?num(metrics.podRate):0;
  metrics.returnRate=history?num(metrics.returnRate):0;
  metrics.cancelRate=history?num(metrics.cancelRate):0;
  if(!history)metrics.unresolved=metrics.total;
  const exactStoredRegions=storedRegions(source,num(finalStat.count)||total);
  const regions=exactStoredRegions||(num(finalStat.count)>0?finalRegions(db,reportDate):importedRegions(db,reportDate));
  const completed=Boolean(snapshot);
  const snapshotStatus=completed?(metrics.retryPending>0?'COMPLETED_WITH_RETRY':'COMPLETED'):'PENDING';
  const processing=run?{running:run.status==='running',paused:run.status==='paused',phase:run.currentStage||'',batchIndex:num(run.batchIndex),totalBatches:num(run.totalBatches),error:run.errorMessage||''}:{running:false,paused:false,phase:''};
  const state={
    businessType:'WHPP',viewBusinessType:'WHPP',reportDate,snapshotId:String(snapshot?.snapshotId||''),snapshotStatus,
    dailyReportReady:total>0,completed,total:metrics.total,metrics,regions,dashboard:{metrics,regions},
    dailyParseSummary:{totalRecognized:total,pnh:total,nonPnh:0,groupCounts:{}},
    currentRun:run,lastRunSummary:run?{runId:run.runId,reportDate,runStatus:run.status}:null,processing,
    sourceTruth:exactStoredRegions?'HISTORY_SUMMARY_RECONCILED':'NORMALIZED_SQLITE',sourceTables:['business_daily_reports','business_final_rows','business_history_summary','business_export_snapshots'],
    cacheHit:false,generatedAt:new Date().toISOString(),patchId:PATCH_ID,_whppUnifiedBusinessState:true
  };
  stateCache.set(reportDate,{fingerprint,at:Date.now(),state});
  return state;
}

function sendBusinessState(req,res){
  const state=buildWhppUnifiedState(req.query.reportDate||req.query.date||'');
  res.setHeader('Cache-Control','private, max-age=10');
  res.setHeader('Server-Timing',`v201;desc=whpp-unified-${state.cacheHit?'cache':'fresh'}`);
  return res.json({ok:true,businessType:'WHPP',reportDate:state.reportDate,snapshotId:state.snapshotId,snapshotStatus:state.snapshotStatus,state});
}
function sendLegacy(req,res){
  const state=buildWhppUnifiedState(req.query.reportDate||req.query.date||'');
  res.setHeader('Cache-Control','private, max-age=10');
  res.setHeader('Server-Timing',`v201;desc=whpp-fast-${state.cacheHit?'cache':'fresh'}`);
  return res.json({ok:true,patchId:PATCH_ID,reportDate:state.reportDate,total:state.total,completed:state.completed,snapshotStatus:state.snapshotStatus,metrics:state.metrics,regions:state.regions,generatedAt:state.generatedAt,cacheHit:Boolean(state.cacheHit),sourceTruth:state.sourceTruth});
}

const previousGet=express.application.get;
express.application.get=function v137WhppUnifiedGet(...args){
  if(args.length<2)return previousGet.apply(this,args);
  const route=args[0];
  if(route===LEGACY_ROUTE)return previousGet.call(this,route,sendLegacy);
  if(route===BUSINESS_ROUTE){
    const handlers=args.slice(1);
    const original=handlers[0];
    const wrapped=function v137WhppBusinessStateHandler(req,res,next){
      if(String(req.params?.businessType||'').toUpperCase()==='WHPP')return sendBusinessState(req,res);
      return original(req,res,next);
    };
    return previousGet.call(this,route,wrapped,...handlers.slice(1));
  }
  return previousGet.apply(this,args);
};

export function inspectV137WhppUnifiedState(reportDate=''){return buildWhppUnifiedState(reportDate);}
export const V137_WHPP_UNIFIED_BUSINESS_STATE_PATCH_ID=PATCH_ID;
