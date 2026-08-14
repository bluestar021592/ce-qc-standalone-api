import express from 'express';
import { getDb } from './db.js';

const PATCH_ID='2026-08-14-v135-whpp-fast-summary-retry-v2';
const ROUTE='/api/v132/whpp-fast-summary';
const CACHE_MS=Math.max(5_000,Number(process.env.V132_WHPP_FAST_CACHE_MS||15_000));
const cache=new Map();

function dateOnly(value=''){
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function emptyRegion(code){return {regionCode:code,total:0,pod:0,podRate:0,returned:0,cancelled:0,unresolved:0,pending1:0,pending2:0,pending3:0,oc1:0,oc2:0,oc3:0,shop:0,phnomPenhShop:0,provinceShop:0};}
function num(value){const n=Number(value||0);return Number.isFinite(n)?n:0;}
function rate(value,total){return total?Number((num(value)*100/num(total)).toFixed(2)):0;}

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
  for(const row of rows){const code=['PP','PV'].includes(String(row.regionCode))?String(row.regionCode):'UNKNOWN';out[code]={...emptyRegion(code),total:num(row.total),unresolved:num(row.total)};}
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
    const total=num(row.total),shopCount=num(row.shop);
    out[code]={regionCode:code,total,pod:num(row.pod),podRate:rate(row.pod,total),returned:num(row.returned),cancelled:num(row.cancelled),unresolved:num(row.unresolved),pending1:num(row.pending1),pending2:num(row.pending2),pending3:num(row.pending3),oc1:num(row.oc1),oc2:num(row.oc2),oc3:num(row.oc3),shop:shopCount,phnomPenhShop:code==='PP'?shopCount:0,provinceShop:code==='PV'?shopCount:0};
  }
  return out;
}

function buildFastSummary(requested=''){
  const db=getDb();
  const reportDate=latestDate(db,requested);
  if(!reportDate){const metrics={total:0,pod:0,podRate:0,returned:0,returnRate:0,cancelled:0,cancelRate:0,unresolved:0,retryPending:0};return {ok:true,patchId:PATCH_ID,reportDate:'',total:0,completed:false,snapshotStatus:'EMPTY',metrics,regions:{PP:emptyRegion('PP'),PV:emptyRegion('PV'),UNKNOWN:emptyRegion('UNKNOWN')}};}
  const daily=db.prepare("SELECT totalCount,updatedAt FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)||{};
  const history=db.prepare("SELECT summaryJson,updatedAt FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)||null;
  const finalStat=db.prepare("SELECT COUNT(*) count,MAX(updatedAt) updatedAt,SUM(CASE WHEN UPPER(COALESCE(apiStatus,''))='API_PENDING_RETRY' THEN 1 ELSE 0 END) retryPending FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?").get(reportDate)||{};
  const fingerprint=`${reportDate}|${daily.updatedAt||''}|${history?.updatedAt||''}|${num(finalStat.count)}|${num(finalStat.retryPending)}|${finalStat.updatedAt||''}`;
  const hit=cache.get(reportDate);
  if(hit&&hit.fingerprint===fingerprint&&Date.now()-hit.at<CACHE_MS)return {...hit.payload,cacheHit:true};

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
  const regions=num(finalStat.count)>0?finalRegions(db,reportDate):importedRegions(db,reportDate);
  const snapshotStatus=history?(metrics.retryPending>0?'COMPLETED_WITH_RETRY':'COMPLETED'):'PENDING';
  const payload={ok:true,patchId:PATCH_ID,reportDate,total:metrics.total,completed:Boolean(history),snapshotStatus,metrics,regions,generatedAt:new Date().toISOString(),cacheHit:false};
  cache.set(reportDate,{fingerprint,at:Date.now(),payload});
  return payload;
}

const previousListen=express.application.listen;
let installed=false;
express.application.listen=function v135WhppFastListen(...args){
  if(!installed){installed=true;this.get(ROUTE,(req,res)=>{try{const payload=buildFastSummary(req.query.reportDate||req.query.date||'');res.setHeader('Cache-Control','private, max-age=5');res.setHeader('Server-Timing','v135;desc=whpp-fast-summary');res.json(payload);}catch(error){res.status(500).json({ok:false,patchId:PATCH_ID,error:error?.message||String(error)});}});}
  return previousListen.apply(this,args);
};

export function inspectV132WhppFastSummary(reportDate=''){return buildFastSummary(reportDate);}
export const V132_WHPP_FAST_INTEGRATION_PATCH_ID=PATCH_ID;
