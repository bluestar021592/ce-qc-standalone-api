import express from 'express';
import { v505PurgePrepareHandler, v505PurgeExecuteHandler, V505_PURGE_COORDINATOR_ID } from './v505PurgeCoordinator.js';
import { v505PurgeGlobalOwnerGuard, V505_PURGE_GLOBAL_GUARD_ID } from './v505PurgeGlobalGuard.js';
import { v505PurgeWriteFreezeGuard, V505_PURGE_WRITE_FREEZE_ID } from './v505PurgeWriteFreezeGuard.js';

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
  }
}
function v505GuardedPrepareHandler(req,res,next){return runPurgeRouteAndRelease(v505PurgePrepareHandler,req,res,next);}
function v505GuardedExecuteHandler(req,res,next){return runPurgeRouteAndRelease(v505PurgeExecuteHandler,req,res,next);}

const previousUse=express.application.use;
express.application.use=function v505PurgeGuardUse(...args){
  const candidates=args.flat().filter(value=>typeof value==='function');
  if(!purgeWriteBlockInstalled&&candidates.some(fn=>fn.name==='accessIdentity')){
    purgeWriteBlockInstalled=true;
    // Check once before authentication so already-active purge work cannot cause
    // session refresh writes, and again after accessIdentity so a request that was
    // suspended by Cloudflare/JWT verification cannot reach its route if purge
    // started while authentication was in flight.
    previousUse.call(this,v505PurgeWriteFreezeGuard);
    const result=previousUse.apply(this,args);
    previousUse.call(this,v505PurgeWriteFreezeGuard);
    return result;
  }
  return previousUse.apply(this,args);
};

const previousPost=express.application.post;
express.application.post=function v505PurgeRoutePost(pathValue,...handlers){
  const route=String(pathValue||'');
  if(route==='/api/admin/data-purge/prepare'&&handlers.length){
    return previousPost.call(this,pathValue,...handlers.slice(0,-1),v505PurgeGlobalOwnerGuard,v505GuardedPrepareHandler);
  }
  if(route==='/api/admin/data-purge/execute'&&handlers.length){
    return previousPost.call(this,pathValue,...handlers.slice(0,-1),v505PurgeGlobalOwnerGuard,v505GuardedExecuteHandler);
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
  }
  return previousListen.apply(this,args);
};

console.info('[CE-QC][V505_PURGE_COORDINATOR_ROUTE_OWNER]',V505_PURGE_COORDINATOR_ID,V505_PURGE_GLOBAL_GUARD_ID,V505_PURGE_WRITE_FREEZE_ID);
