import express from 'express';
import { getDb } from './db.js';

const PATCH_ID='2026-08-22-v215-whpp-instant-summary-v1';
const ROUTE='/api/v132/whpp-fast-summary';
const CACHE_MS=Math.max(5_000,Number(process.env.V132_WHPP_FAST_CACHE_MS||15_000));
const cache=new Map();

function dateOnly(value=''){
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function safeJson(value,fallback={}){
  try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}
  catch{return fallback;}
}
function num(value){
  const n=Number(value||0);
  return Number.isFinite(n)?n:0;
}
function emptyRegion(code){
  return {
    regionCode:code,total:0,pod:0,podRate:0,returned:0,cancelled:0,unresolved:0,
    pending1:0,pending2:0,pending3:0,oc1:0,oc2:0,oc3:0,shop:0,
    phnomPenhShop:0,provinceShop:0
  };
}
function normalizeRegion(code,value={}){
  const source=value&&typeof value==='object'?value:{};
  const total=num(source.total);
  const pod=num(source.pod);
  return {
    ...emptyRegion(code),
    ...source,
    regionCode:code,
    total,
    pod,
    podRate:Number.isFinite(Number(source.podRate))?Number(source.podRate):(total?Number((pod*100/total).toFixed(2)):0),
    returned:num(source.returned),
    cancelled:num(source.cancelled),
    unresolved:num(source.unresolved),
    pending1:num(source.pending1),pending2:num(source.pending2),pending3:num(source.pending3),
    oc1:num(source.oc1),oc2:num(source.oc2),oc3:num(source.oc3),
    shop:num(source.shop??source.shopTotal),
    phnomPenhShop:num(source.phnomPenhShop),provinceShop:num(source.provinceShop)
  };
}
function summaryRegions(source={}){
  const raw=source?.regions&&typeof source.regions==='object'?source.regions:{};
  return {
    PP:normalizeRegion('PP',raw.PP||raw.pp||{}),
    PV:normalizeRegion('PV',raw.PV||raw.pv||{}),
    UNKNOWN:normalizeRegion('UNKNOWN',raw.UNKNOWN||raw.unknown||{})
  };
}
function latestDate(db,requested=''){
  const explicit=dateOnly(requested);
  if(explicit)return explicit;
  return String(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP' ORDER BY reportDate DESC LIMIT 1").get()?.reportDate||'');
}

// First paint must never scan business_final_rows or JSON-extract raw evidence.
// Those tables are large on the production database and used to make the WHPP
// page wait minutes even though the home dashboard already knew today's count.
// The dedicated page now reads only the tiny daily total + persisted history summary.
function buildFastSummary(requested=''){
  const started=Date.now();
  const db=getDb();
  const reportDate=latestDate(db,requested);
  if(!reportDate){
    const metrics={total:0,pod:0,podRate:0,returned:0,returnRate:0,cancelled:0,cancelRate:0,unresolved:0,retryPending:0};
    return {ok:true,patchId:PATCH_ID,reportDate:'',total:0,completed:false,snapshotStatus:'EMPTY',metrics,regions:summaryRegions({}),generatedAt:new Date().toISOString(),serverBuildMs:Date.now()-started};
  }

  const daily=db.prepare("SELECT totalCount,updatedAt FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)||{};
  const history=db.prepare("SELECT summaryJson,updatedAt FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)||null;
  const source=safeJson(history?.summaryJson,{});
  const fingerprint=`${reportDate}|${daily.updatedAt||''}|${history?.updatedAt||''}`;
  const hit=cache.get(reportDate);
  if(hit&&hit.fingerprint===fingerprint&&Date.now()-hit.at<CACHE_MS){
    return {...hit.payload,cacheHit:true,serverBuildMs:Date.now()-started};
  }

  const dailyTotal=num(daily.totalCount);
  const metrics={...source,total:num(source.total??dailyTotal)};
  const regions=history?summaryRegions(source):summaryRegions({});
  delete metrics.accounting;
  delete metrics.snapshotId;
  delete metrics.regions;
  for(const key of [
    'pod','returned','cancelled','unresolved','pendingNonContinuous','pending1','pending2','pending3',
    'oc1','oc2','oc3','cycle2','inboundNoScan','delivery','workOrder','normalDiversion','shopTotal',
    'ccslCnDiversion','ccslZtDiversion','ccsl580Retention','ccsl580Diversion','phnomPenhShop',
    'provinceShop','unknownShop','dispatchAttempt1','dispatchAttempt2','dispatchAttempt3','retryPending'
  ])metrics[key]=num(metrics[key]);
  metrics.podRate=history?num(metrics.podRate):0;
  metrics.returnRate=history?num(metrics.returnRate):0;
  metrics.cancelRate=history?num(metrics.cancelRate):0;
  if(!history)metrics.unresolved=metrics.total;

  const retryPending=num(source.retryPending);
  metrics.retryPending=retryPending;
  const snapshotStatus=history?(retryPending>0?'COMPLETED_WITH_RETRY':'COMPLETED'):'PENDING';
  const payload={
    ok:true,patchId:PATCH_ID,reportDate,total:metrics.total,completed:Boolean(history),snapshotStatus,
    metrics,regions,generatedAt:new Date().toISOString(),cacheHit:false,summarySource:history?'BUSINESS_HISTORY_SUMMARY':'DAILY_TOTAL_PENDING'
  };
  cache.set(reportDate,{fingerprint,at:Date.now(),payload});
  return {...payload,serverBuildMs:Date.now()-started};
}

const previousListen=express.application.listen;
let installed=false;
express.application.listen=function v215WhppInstantSummaryListen(...args){
  if(!installed){
    installed=true;
    this.get(ROUTE,(req,res)=>{
      const started=Date.now();
      try{
        const payload=buildFastSummary(req.query.reportDate||req.query.date||'');
        const duration=Date.now()-started;
        res.setHeader('Cache-Control','private, max-age=5');
        res.setHeader('X-CE-QC-WHPP-Summary','V215');
        res.setHeader('Server-Timing',`whppSummary;dur=${duration}`);
        if(duration>=250)console.log(`[CE-QC][PERF][V215] ${ROUTE} ${duration}ms reportDate=${payload.reportDate||''}`);
        res.json(payload);
      }catch(error){
        res.status(500).json({ok:false,patchId:PATCH_ID,error:error?.message||String(error)});
      }
    });
  }
  return previousListen.apply(this,args);
};

export function inspectV132WhppFastSummary(reportDate=''){
  return buildFastSummary(reportDate);
}
export const V132_WHPP_FAST_INTEGRATION_PATCH_ID=PATCH_ID;
