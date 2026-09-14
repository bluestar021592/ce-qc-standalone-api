import express from 'express';
import './v506LocalAuthBridgePatch.js';
import { wrapV507ManualOnlyListenCallback, V507_MANUAL_DASHBOARD_CACHE_MODE_ID } from './v507ManualDashboardCacheMode.js';
import { refreshOpenCarryNow } from './carryoverRefreshScheduler.js';
import { publishManualRefreshTruth } from './manualRefreshPublication.js';
import { v505PurgePrepareHandler, v505PurgeExecuteHandler, V505_PURGE_COORDINATOR_ID } from './v505PurgeCoordinator.js';
import { v505PurgeGlobalOwnerGuard, V505_PURGE_GLOBAL_GUARD_ID } from './v505PurgeGlobalGuard.js';
import { v505PurgeExecuteAdmissionGuard, V505_PURGE_EXECUTE_ADMISSION_ID } from './v505PurgeExecuteAdmissionGuard.js';
import { v505TrackMainApiActivity, V505_PURGE_HTTP_ACTIVITY_ID } from './v505PurgeHttpActivity.js';
import { v505PurgePublicStatusGuard, V505_PURGE_PUBLIC_STATUS_GUARD_ID } from './v505PurgePublicStatusGuard.js';
import { inspectPurgeWriteFreezeState, syncPurgeQueryOnly, v505PurgeWriteFreezeGuard, V505_PURGE_WRITE_FREEZE_ID } from './v505PurgeWriteFreezeGuard.js';
import { v505PurgeStartupOrphanGuard, V505_PURGE_STARTUP_ORPHAN_ID } from './v505PurgeStartupOrphanGuard.js';

const MANUAL_REFRESH_FAST_READ_CACHE_TTL_MS=3000;
let installed=false;
let manualRefreshRequestInFlight=false;
let purgeWriteBlockInstalled=false;

function redirectToV27(pathname){
  return (req,res)=>{
    const query=req.originalUrl.includes('?')?req.originalUrl.slice(req.originalUrl.indexOf('?')):'';
    res.redirect(307,`${pathname}${query}`);
  };
}

async function waitUntilManualRefreshDashboardReadable(publication={}){
  const affectedDates=Array.isArray(publication?.affectedDates)?publication.affectedDates.filter(Boolean):[];
  if(!affectedDates.length)return;
  const derived=publication?.derivedRefresh;
  if(!derived||derived.ok!==true){
    const error=new Error(`最新轨迹已经写入，但看板派生数据未完成刷新${derived?.error?`：${derived.error}`:''}。已阻止返回“更新完成”，请稍后重试。`);
    error.code='MANUAL_REFRESH_DASHBOARD_REFRESH_FAILED';
    throw error;
  }
  // server.js keeps a 3-second in-memory fast dashboard read cache. The durable
  // V419 refresh above has already rebuilt affected dates; wait out only that
  // tiny read-cache TTL so the browser refresh issued after this response cannot
  // render the pre-refresh snapshot even when the operator clicked immediately.
  await new Promise(resolve=>setTimeout(resolve,MANUAL_REFRESH_FAST_READ_CACHE_TTL_MS+100));
}

async function manualOpenRefresh(req,res){
  if(manualRefreshRequestInFlight){
    return res.status(409).json({ok:false,code:'MANUAL_REFRESH_RUNNING',error:'最新数据正在更新，请等待当前扫描与轨迹查询完成。'});
  }
  manualRefreshRequestInFlight=true;
  try{
    const result=await refreshOpenCarryNow({reason:'MANUAL_USER_REFRESH'});
    if(result?.skipped&&result.reason==='FOREGROUND_PROCESSING_ACTIVE'){
      return res.status(409).json({ok:false,code:'BUSINESS_PROCESSING_ACTIVE',error:'当前仍有导入/扫描/轨迹任务运行，请完成后再手动更新。',result});
    }
    const publication=result?.refreshId?publishManualRefreshTruth(result.refreshId):{ok:true,skipped:true,reason:'NO_REFRESH_ID'};
    if(publication?.unbound){
      return res.status(409).json({ok:false,code:'MANUAL_REFRESH_PUBLICATION_UNBOUND',error:`最新轨迹已查询，但有 ${publication.unbound} 票无法绑定回已保存日报，已阻止把不完整结果当成最新看板。`,result,publication});
    }
    await waitUntilManualRefreshDashboardReadable(publication);
    res.json({ok:true,manualOnly:true,autoRefreshDisabled:true,result,publication,completedAt:new Date().toISOString()});
  }catch(error){
    const code=error?.code||'MANUAL_REFRESH_FAILED';
    res.status(code==='MANUAL_REFRESH_DASHBOARD_REFRESH_FAILED'?409:500).json({ok:false,code,error:error?.message||String(error)});
  }finally{
    manualRefreshRequestInFlight=false;
  }
}

async function runPurgeRouteAndRelease(handler,req,res,next){
  try{return await handler(req,res,next);}
  finally{
    try{req.v505PurgeSubmissionMutexRelease?.();}catch{}
    // The first PREPARE starts from an idle writable DB. Once the route has
    // durably queued purge work, mirror external truth onto the shared web DB
    // before returning. Recovery/EXECUTE never need a shared writable window.
    try{syncPurgeQueryOnly(inspectPurgeWriteFreezeState().active);}catch{}
  }
}
function v505GuardedPrepareHandler(req,res,next){return runPurgeRouteAndRelease(v505PurgePrepareHandler,req,res,next);}
function v505GuardedExecuteHandler(req,res,next){
  let admitted=false;
  const result=v505PurgeExecuteAdmissionGuard(req,res,()=>{
    admitted=true;
    return runPurgeRouteAndRelease(v505PurgeExecuteHandler,req,res,next);
  });
  if(!admitted){
    try{req.v505PurgeSubmissionMutexRelease?.();}catch{}
    try{syncPurgeQueryOnly(inspectPurgeWriteFreezeState().active);}catch{}
  }
  return result;
}

const previousUse=express.application.use;
express.application.use=function v505PurgeGuardUse(...args){
  const candidates=args.flat().filter(value=>typeof value==='function');
  if(!purgeWriteBlockInstalled&&candidates.some(fn=>fn.name==='accessIdentity')){
    purgeWriteBlockInstalled=true;
    // Capability-token purge status is intentionally DB-free, but it is served
    // only through an explicit allowlist so filesystem sidecars can never leak
    // administrator identity, DB paths, backup paths, challenge evidence or raw errors.
    previousUse.call(this,v505PurgePublicStatusGuard);
    // Pre-auth freeze rejects new requests after purge admission. The activity
    // tracker is deliberately installed AFTER that guard: once the atomic purge
    // submission mutex exists, racing requests are rejected before they can join
    // the drain set. Requests that entered earlier remain visible until finish.
    previousUse.call(this,v505PurgeWriteFreezeGuard);
    previousUse.call(this,v505TrackMainApiActivity);
    const result=previousUse.apply(this,args);
    // A second freeze check closes the Cloudflare/JWT wait window: a request that
    // began before purge but was suspended in authentication cannot reach its
    // route after purge has started.
    previousUse.call(this,v505PurgeWriteFreezeGuard);
    return result;
  }
  return previousUse.apply(this,args);
};

const previousPost=express.application.post;
express.application.post=function v505PurgeRoutePost(pathValue,...handlers){
  const route=String(pathValue||'');
  if(route==='/api/admin/data-purge/prepare'&&handlers.length){
    return previousPost.call(this,pathValue,...handlers.slice(0,-1),v505PurgeGlobalOwnerGuard,v505PurgeStartupOrphanGuard,v505GuardedPrepareHandler);
  }
  if(route==='/api/admin/data-purge/execute'&&handlers.length){
    return previousPost.call(this,pathValue,...handlers.slice(0,-1),v505PurgeGlobalOwnerGuard,v505PurgeStartupOrphanGuard,v505GuardedExecuteHandler);
  }
  return previousPost.call(this,pathValue,...handlers);
};

const previousListen=express.application.listen;
express.application.listen=function v29EndpointAliasListen(...args){
  if(!installed){
    installed=true;
    // Current browser patches call /api/v29/*. Register these aliases before the
    // older V29 data-consistency routes so they land on the corrected V29 business
    // rule implementation registered at /api/v27/* by v29BusinessRulesPatch.
    this.get('/api/v29/metric-detail',redirectToV27('/api/v27/metric-detail'));
    this.get('/api/v29/carry-monitor',redirectToV27('/api/v27/carry-monitor'));
    this.get('/api/v29/carry-monitor-business',redirectToV27('/api/v27/carry-monitor-business'));

    // Manual-only data refresh. This deliberately rescans only the durable OPEN
    // unfinished-POD pool; POD/returned/other terminal rows are not queried again.
    this.post('/api/manual-open-refresh',manualOpenRefresh);
  }
  const listenArgs=[...args];
  const callbackIndex=listenArgs.length-1;
  if(callbackIndex>=0&&typeof listenArgs[callbackIndex]==='function'){
    listenArgs[callbackIndex]=wrapV507ManualOnlyListenCallback(listenArgs[callbackIndex]);
  }
  return previousListen.apply(this,listenArgs);
};

console.info('[CE-QC][V505_PURGE_COORDINATOR_ROUTE_OWNER]',V505_PURGE_COORDINATOR_ID,V505_PURGE_GLOBAL_GUARD_ID,V505_PURGE_EXECUTE_ADMISSION_ID,V505_PURGE_STARTUP_ORPHAN_ID,V505_PURGE_WRITE_FREEZE_ID,V505_PURGE_HTTP_ACTIVITY_ID,V505_PURGE_PUBLIC_STATUS_GUARD_ID,V507_MANUAL_DASHBOARD_CACHE_MODE_ID);
