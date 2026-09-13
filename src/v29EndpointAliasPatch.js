import './v506LocalAuthBridgePatch.js';
import express from 'express';

let installed=false;

function redirectToV27(pathname){
  return (req,res)=>{
    const query=req.originalUrl.includes('?')?req.originalUrl.slice(req.originalUrl.indexOf('?')):'';
    res.redirect(307,`${pathname}${query}`);
  };
}

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
