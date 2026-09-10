import express from 'express';
import { v505PurgePrepareHandler, v505PurgeExecuteHandler, v505PurgeWriteBlockMiddleware, V505_PURGE_COORDINATOR_ID } from './v505PurgeCoordinator.js';

let installed=false;
let purgeWriteBlockInstalled=false;

function redirectToV27(pathname){
  return (req,res)=>{
    const query=req.originalUrl.includes('?')?req.originalUrl.slice(req.originalUrl.indexOf('?')):'';
    res.redirect(307,`${pathname}${query}`);
  };
}

const previousUse=express.application.use;
express.application.use=function v505PurgeGuardUse(...args){
  const result=previousUse.apply(this,args);
  const candidates=args.flat().filter(value=>typeof value==='function');
  if(!purgeWriteBlockInstalled&&candidates.some(fn=>fn.name==='accessIdentity')){
    purgeWriteBlockInstalled=true;
    previousUse.call(this,v505PurgeWriteBlockMiddleware);
  }
  return result;
};

const previousPost=express.application.post;
express.application.post=function v505PurgeRoutePost(pathValue,...handlers){
  const route=String(pathValue||'');
  if(route==='/api/admin/data-purge/prepare'&&handlers.length){
    return previousPost.call(this,pathValue,...handlers.slice(0,-1),v505PurgePrepareHandler);
  }
  if(route==='/api/admin/data-purge/execute'&&handlers.length){
    return previousPost.call(this,pathValue,...handlers.slice(0,-1),v505PurgeExecuteHandler);
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

console.info('[CE-QC][V505_PURGE_COORDINATOR_ROUTE_OWNER]',V505_PURGE_COORDINATOR_ID);
