import express from 'express';
import { getDb } from './db.js';

export const V232_LIVE_DATA_HEALTH_GATE_VERSION='2026-08-20-v237-startup-triplet-readiness-v1';
const INSTALLED=Symbol.for('ce-qc.v232-live-data-health-gate-installed');
const REQUIRED_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const APP_PORT=Math.max(1024,Math.min(65535,Number(process.env.PORT||5177)));
const AUTH_PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_AUTH_SIDECAR_PORT||5179)));
const EXPORT_PORT=Math.max(1024,Math.min(65535,Number(process.env.CE_QC_EXPORT_SIDECAR_PORT||5178)));
const EXPECTED_AUTH_VERSION='2026-08-19-v226-auth-sidecar-handoff-v2';
const EXPECTED_EXPORT_REVISION='2026-08-18-v195-ipc-memory-status-v1';
const EXPECTED_EXPORT_TRANSPORT='IPC_MEMORY_V195';
const CACHE_MS=10_000;
const SERVICE_CACHE_MS=1_000;
const DIAGNOSTIC_MS=30_000;
let cached=null;
let cachedAt=0;
let serviceCached=null;
let serviceCachedAt=0;
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
async function probeJson(url,timeoutMs=900){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{cache:'no-store',headers:{accept:'application/json'},signal:controller.signal});
    const text=await response.text();
    let payload={};
    try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};}
    return{httpStatus:response.status,headers:Object.fromEntries(response.headers.entries()),payload,error:''};
  }catch(error){
    return{httpStatus:0,headers:{},payload:{},error:error?.name==='AbortError'?'TIMEOUT':String(error?.message||error)};
  }finally{clearTimeout(timer);}
}
async function inspectStartupServices(){
  const now=Date.now();
  if(serviceCached&&now-serviceCachedAt<SERVICE_CACHE_MS)return serviceCached;
  const [authProbe,exportProbe]=await Promise.all([
    probeJson(`http://127.0.0.1:${AUTH_PORT}/api/v213/auth-ping`),
    probeJson(`http://127.0.0.1:${EXPORT_PORT}/api/v194/export-ping`)
  ]);
  const authPayload=authProbe.payload||{};
  const exportPayload=exportProbe.payload||{};
  const authReady=authProbe.httpStatus===200&&authPayload.ok===true&&Number(authPayload.port||0)===AUTH_PORT&&Number(authPayload.appPort||0)===APP_PORT&&String(authPayload.version||'')===EXPECTED_AUTH_VERSION&&Boolean(authProbe.headers?.['x-ce-qc-auth-sidecar']);
  const exportReady=exportProbe.httpStatus===200&&exportPayload.ok===true&&Number(exportPayload.port||0)===EXPORT_PORT&&String(exportPayload.revision||'')===EXPECTED_EXPORT_REVISION&&String(exportPayload.statusTransport||'')===EXPECTED_EXPORT_TRANSPORT;
  serviceCached={
    ready:authReady&&exportReady,
    auth:{ready:authReady,httpStatus:authProbe.httpStatus,port:AUTH_PORT,appPort:APP_PORT,version:String(authPayload.version||''),pid:n(authPayload.pid),error:authProbe.error},
    export:{ready:exportReady,httpStatus:exportProbe.httpStatus,port:EXPORT_PORT,revision:String(exportPayload.revision||''),statusTransport:String(exportPayload.statusTransport||''),pendingJobs:n(exportPayload.pendingJobs),error:exportProbe.error},
    expected:{authVersion:EXPECTED_AUTH_VERSION,exportRevision:EXPECTED_EXPORT_REVISION,exportTransport:EXPECTED_EXPORT_TRANSPORT},
    checkedAt:new Date().toISOString()
  };
  serviceCachedAt=now;
  return serviceCached;
}
function logGateResult(result,services){
  const now=Date.now();
  const key=[result?.dataState||'',result?.reportDate||'',...(result?.zeroBusinessTypes||[]),services?.auth?.ready?'AUTH_OK':'AUTH_BLOCK',services?.export?.ready?'EXPORT_OK':'EXPORT_BLOCK'].join('|');
  if(key===lastDiagnosticKey&&now-lastDiagnosticAt<DIAGNOSTIC_MS)return;
  lastDiagnosticKey=key;
  lastDiagnosticAt=now;
  const counts=REQUIRED_TYPES.map(type=>`${type}=${n(result?.businesses?.[type])}`).join(' ');
  if(result?.ready&&services?.ready){
    console.log(`[CE-QC][V237_STARTUP_GATE_PASS] reportDate=${result?.reportDate||'EMPTY'} data=${result?.dataState||'-'} auth=5179:READY export=5178:READY ${counts}`);
  }else{
    console.warn(`[CE-QC][V237_STARTUP_GATE_BLOCK] reportDate=${result?.reportDate||'EMPTY'} data=${result?.dataState||'-'} zero=${(result?.zeroBusinessTypes||[]).join(',')||'-'} auth=${services?.auth?.ready?'READY':`BLOCK(${services?.auth?.httpStatus||0}:${services?.auth?.error||services?.auth?.version||'-'})`} export=${services?.export?.ready?'READY':`BLOCK(${services?.export?.httpStatus||0}:${services?.export?.error||services?.export?.revision||'-'})`} ${counts}`);
  }
}
function liveDataHealth(req,res,next){
  if(req.method!=='GET'||req.path!=='/api/health'||!isLoopback(req))return next();
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-CE-QC-Health-Mode','LOOPBACK_READINESS_ONLY');
  res.setHeader('X-CE-QC-Data-Gate','V232-LIVE-PERSISTED-BOARDS');
  res.setHeader('X-CE-QC-Startup-Gate','V237-5177-5178-5179');
  return (async()=>{
    try{
      const [result,services]=await Promise.all([Promise.resolve(inspectLiveData()),inspectStartupServices()]);
      const ready=Boolean(result?.ready&&services?.ready);
      logGateResult(result,services);
      const payload={...result,ok:ready,ready,startupState:ready?'APP_AUTH_EXPORT_READY':'STARTUP_TRIPLET_INCOMPLETE',startupServices:services,authRequired:true,scope:'LOOPBACK_READINESS_ONLY',time:new Date().toISOString()};
      return res.status(ready?200:503).json(payload);
    }catch(error){
      console.error('[CE-QC][V237_STARTUP_GATE_ERROR]',error?.stack||error);
      return res.status(503).json({ok:false,ready:false,dataState:'LIVE_DATA_GATE_ERROR',startupState:'STARTUP_GATE_ERROR',error:error?.message||String(error),authRequired:true,scope:'LOOPBACK_READINESS_ONLY',version:V232_LIVE_DATA_HEALTH_GATE_VERSION,time:new Date().toISOString()});
    }
  })();
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

console.log('[CE-QC][V237] loopback /api/health now stays 503 until persisted seven-board data, auth 5179, and export 5178 all pass exact readiness; launcher opens the browser only after the full 5177/5178/5179 startup triplet is ready.');

export const __test={ipOnly,hostOnly,isLoopback,inspectLiveData,inspectStartupServices};
