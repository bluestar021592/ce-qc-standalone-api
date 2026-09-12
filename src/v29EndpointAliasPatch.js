import express from 'express';
import { v505PurgePrepareHandler, v505PurgeExecuteHandler, V505_PURGE_COORDINATOR_ID } from './v505PurgeCoordinator.js';
import { v505PurgeGlobalOwnerGuard, V505_PURGE_GLOBAL_GUARD_ID } from './v505PurgeGlobalGuard.js';
import { v505PurgeExecuteAdmissionGuard, V505_PURGE_EXECUTE_ADMISSION_ID } from './v505PurgeExecuteAdmissionGuard.js';
import { v505TrackMainApiActivity, V505_PURGE_HTTP_ACTIVITY_ID } from './v505PurgeHttpActivity.js';
import { v505PurgePublicStatusGuard, V505_PURGE_PUBLIC_STATUS_GUARD_ID } from './v505PurgePublicStatusGuard.js';
import { inspectPurgeWriteFreezeState, syncPurgeQueryOnly, v505PurgeWriteFreezeGuard, V505_PURGE_WRITE_FREEZE_ID } from './v505PurgeWriteFreezeGuard.js';
import { v505PurgeStartupOrphanGuard, V505_PURGE_STARTUP_ORPHAN_ID } from './v505PurgeStartupOrphanGuard.js';

let installed=false;
let purgeWriteBlockInstalled=false;

function redirectToV27(pathname){
  return (req,res)=>{
    const query=req.originalUrl.includes('?')?req.originalUrl.slice(req.originalUrl.indexOf('?')):'';
    res.redirect(307,`${pathname}${query}`);
  };
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
    this.get('/api/v29/metric-detail',redirectToV27('/api/v27/metric-detail'));
    this.get('/api/v29/carry-monitor',redirectToV27('/api/v27/carry-monitor'));
    this.get('/api/v29/carry-monitor-business',redirectToV27('/api/v27/carry-monitor-business'));
  }
  return previousListen.apply(this,args);
};

console.info('[CE-QC][V505_PURGE_COORDINATOR_ROUTE_OWNER]',V505_PURGE_COORDINATOR_ID,V505_PURGE_GLOBAL_GUARD_ID,V505_PURGE_EXECUTE_ADMISSION_ID,V505_PURGE_STARTUP_ORPHAN_ID,V505_PURGE_WRITE_FREEZE_ID,V505_PURGE_HTTP_ACTIVITY_ID,V505_PURGE_PUBLIC_STATUS_GUARD_ID);