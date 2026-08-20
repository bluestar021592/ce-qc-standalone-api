import express from 'express';
import { getDb } from './db.js';

export const V232_LIVE_DATA_HEALTH_GATE_VERSION='2026-08-20-v232-live-persisted-board-health-v1';
const INSTALLED=Symbol.for('ce-qc.v232-live-data-health-gate-installed');
const REQUIRED_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const CACHE_MS=10_000;
const DIAGNOSTIC_MS=30_000;
let cached=null;
let cachedAt=0;
let lastDiagnosticKey='';
let lastDiagnosticAt=0;

function ipOnly(value=''){return String(value||'').replace(/^::ffff:/,'');}
function hostOnly(value=''){
  const raw=String(value||'').trim().toLowerCase().replace(/^\[|\]$/g,'');
  if(raw==='::1')return raw;
  return raw.split(':')[0];
}
function isLoopback(req){
  const ip=ipOnly(req.socket?.remoteAddress||'');
  const host=hostOnly(req.hostname||req.get?.('host')||'');
  return (ip==='127.0.0.1'||ip==='::1')&&(['127.0.0.1','localhost','::1'].includes(host));
}
function n(value){const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;}
function tableExists(db,name){
  try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}
  catch{return false;}
}
function latestCanonical(db){
  if(!tableExists(db,'unified_import_batches'))return null;
  try{return db.prepare("SELECT snapshotId,reportDate,createdAt FROM unified_import_batches WHERE UPPER(COALESCE(status,'VALID'))='VALID' AND COALESCE(reportDate,'')<>'' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()||null;}
  catch{return null;}
}
function latestPersistedDate(db){
  const dates=[];
  const probes=[
    ['business_daily_reports',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM business_daily_reports"],
    ['daily_reports',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM daily_reports"],
    ['dashboard_daily_cache',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM dashboard_daily_cache"],
    ['business_final_rows',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM business_final_rows"],
    ['final_rows',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM final_rows"]
  ];
  for(const [table,sql] of probes){
    if(!tableExists(db,table))continue;
    try{const value=String(db.prepare(sql).get()?.reportDate||'');if(/^\d{4}-\d{2}-\d{2}$/.test(value))dates.push(value);}catch{}
  }
  return dates.sort().at(-1)||'';
}
function emptyCounts(){return Object.fromEntries(REQUIRED_TYPES.map(type=>[type,0]));}
function applyCount(counts,type,value){
  const key=String(type||'').toUpperCase();
  if(!Object.hasOwn(counts,key))return;
  counts[key]=Math.max(n(counts[key]),n(value));
}
function businessDailyCounts(db,reportDate,counts){
  if(!reportDate||!tableExists(db,'business_daily_reports'))return;
  try{
    const rows=db.prepare("SELECT UPPER(COALESCE(businessType,'')) businessType,MAX(COALESCE(totalCount,0)) total FROM business_daily_reports WHERE reportDate=? GROUP BY UPPER(COALESCE(businessType,''))").all(reportDate);
    for(const row of rows)applyCount(counts,row.businessType,row.total);
  }catch{}
}
function canonicalCounts(db,snapshotId,counts){
  if(!snapshotId||!tableExists(db,'unified_import_rows'))return;
  try{
    const rows=db.prepare("SELECT UPPER(COALESCE(businessType,'')) businessType,COUNT(*) total FROM unified_import_rows WHERE snapshotId=? GROUP BY UPPER(COALESCE(businessType,''))").all(snapshotId);
    for(const row of rows)applyCount(counts,row.businessType,row.total);
  }catch{}
}
function lightweightFallbackCounts(db,reportDate,counts){
  if(!reportDate)return;
  const missingBusiness=['SHOPEECN','SHOPEEVN','WHPP'].filter(type=>n(counts[type])===0);
  if(missingBusiness.length&&tableExists(db,'business_final_rows')){
    try{
      const rows=db.prepare("SELECT UPPER(COALESCE(businessType,'')) businessType,COUNT(DISTINCT shipmentCode) total FROM business_final_rows WHERE reportDate=? GROUP BY UPPER(COALESCE(businessType,''))").all(reportDate);
      for(const row of rows)applyCount(counts,row.businessType,row.total);
    }catch{}
  }
  const missingCcsl=['CE','CEAF','TBKH','ALI1688'].filter(type=>n(counts[type])===0);
  if(missingCcsl.length&&tableExists(db,'final_rows')){
    try{
      const rows=db.prepare("SELECT UPPER(COALESCE(sourceType,'')) businessType,COUNT(DISTINCT shipmentCode) total FROM final_rows WHERE reportDate=? GROUP BY UPPER(COALESCE(sourceType,''))").all(reportDate);
      for(const row of rows)applyCount(counts,row.businessType,row.total);
    }catch{}
  }
}
function inspectLiveData(){
  const now=Date.now();
  if(cached&&now-cachedAt<CACHE_MS)return cached;
  const db=getDb();
  const canonical=latestCanonical(db);
  const reportDate=String(canonical?.reportDate||latestPersistedDate(db)||'');
  if(!reportDate){
    cached={ok:true,ready:true,dataState:'EMPTY_INSTALL',reportDate:'',source:'NO_PERSISTED_REPORT',businesses:emptyCounts(),zeroBusinessTypes:[],nonZeroBusinessCount:0,total:0,version:V232_LIVE_DATA_HEALTH_GATE_VERSION};
    cachedAt=now;
    return cached;
  }
  const counts=emptyCounts();
  businessDailyCounts(db,reportDate,counts);
  canonicalCounts(db,String(canonical?.snapshotId||''),counts);
  lightweightFallbackCounts(db,reportDate,counts);
  const zeroBusinessTypes=REQUIRED_TYPES.filter(type=>n(counts[type])<=0);
  const total=Object.values(counts).reduce((sum,value)=>sum+n(value),0);
  const ready=total>0&&zeroBusinessTypes.length===0;
  cached={
    ok:ready,
    ready,
    dataState:ready?'PERSISTED_BOARDS_READY':'PERSISTED_BOARDS_INCOMPLETE',
    reportDate,
    source:canonical?.snapshotId?'CANONICAL_PLUS_PERSISTED_SUMMARY':'PERSISTED_SUMMARY',
    snapshotId:String(canonical?.snapshotId||''),
    businesses:counts,
    zeroBusinessTypes,
    nonZeroBusinessCount:REQUIRED_TYPES.length-zeroBusinessTypes.length,
    total,
    requiredBusinessTypes:REQUIRED_TYPES,
    version:V232_LIVE_DATA_HEALTH_GATE_VERSION
  };
  cachedAt=now;
  return cached;
}
function logGateResult(result){
  const now=Date.now();
  const key=[result?.dataState||'',result?.reportDate||'',...(result?.zeroBusinessTypes||[])].join('|');
  if(key===lastDiagnosticKey&&now-lastDiagnosticAt<DIAGNOSTIC_MS)return;
  lastDiagnosticKey=key;
  lastDiagnosticAt=now;
  const counts=REQUIRED_TYPES.map(type=>`${type}=${n(result?.businesses?.[type])}`).join(' ');
  if(result?.ready){
    console.log(`[CE-QC][V232_DATA_GATE_PASS] reportDate=${result?.reportDate||'EMPTY'} state=${result?.dataState||'-'} ${counts}`);
  }else{
    console.warn(`[CE-QC][V232_DATA_GATE_BLOCK] reportDate=${result?.reportDate||'EMPTY'} state=${result?.dataState||'-'} zero=${(result?.zeroBusinessTypes||[]).join(',')||'-'} ${counts}`);
  }
}
function liveDataHealth(req,res,next){
  if(req.method!=='GET'||req.path!=='/api/health'||!isLoopback(req))return next();
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-CE-QC-Health-Mode','LOOPBACK_READINESS_ONLY');
  res.setHeader('X-CE-QC-Data-Gate','V232-LIVE-PERSISTED-BOARDS');
  try{
    const result=inspectLiveData();
    logGateResult(result);
    if(!result.ready){
      return res.status(503).json({...result,authRequired:true,scope:'LOOPBACK_READINESS_ONLY',time:new Date().toISOString()});
    }
    return res.status(200).json({...result,authRequired:true,scope:'LOOPBACK_READINESS_ONLY',time:new Date().toISOString()});
  }catch(error){
    console.error('[CE-QC][V232_DATA_GATE_ERROR]',error?.stack||error);
    return res.status(503).json({ok:false,ready:false,dataState:'LIVE_DATA_GATE_ERROR',error:error?.message||String(error),authRequired:true,scope:'LOOPBACK_READINESS_ONLY',version:V232_LIVE_DATA_HEALTH_GATE_VERSION,time:new Date().toISOString()});
  }
}

if(!express.application[INSTALLED]){
  Object.defineProperty(express.application,INSTALLED,{value:true});
  const previousUse=express.application.use;
  let mounted=false;
  express.application.use=function v232LiveDataGateBeforeAccess(...args){
    const functions=args.flat().filter(value=>typeof value==='function');
    const access=functions.some(fn=>fn.name==='accessIdentity'||fn.name==='v209AccessIdentityNoHang');
    if(access&&!mounted){mounted=true;previousUse.call(this,liveDataHealth);}
    return previousUse.apply(this,args);
  };
}

console.log('[CE-QC][V232] loopback /api/health now requires live persisted data for CE/CEAF/TBKH/ALI1688/SHOPEECN/SHOPEEVN/WHPP before the launcher can open the browser.');

export const __test={ipOnly,hostOnly,isLoopback,inspectLiveData};
