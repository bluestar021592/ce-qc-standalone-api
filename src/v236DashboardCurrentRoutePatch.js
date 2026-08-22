import express from 'express';
import { readV236CurrentSummary, stateFromV236Metric, V236_TYPES, V236_DASHBOARD_CURRENT_READ_ID } from './v236DashboardCurrentRead.js';

export const V236_DASHBOARD_CURRENT_ROUTE_ID='2026-08-22-v236-fresh-current-route-v1';
const originalGet=express.application.get;

function currentHandler(req,res){
  try{
    const data=readV236CurrentSummary(String(req.query.reportDate||'').slice(0,10));
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-CE-QC-Current-Read',V236_DASHBOARD_CURRENT_READ_ID);
    return res.json(data);
  }catch(error){return res.status(500).json({ok:false,routeId:V236_DASHBOARD_CURRENT_ROUTE_ID,error:error?.message||String(error)});}
}
function stateHandler(req,res){
  try{
    const type=String(req.params.type||'').toUpperCase();
    if(!V236_TYPES.includes(type))return res.status(400).json({ok:false,error:'业务板块无效'});
    const data=readV236CurrentSummary(String(req.query.reportDate||'').slice(0,10));
    const metric=data.business[type];
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-CE-QC-Current-Read',V236_DASHBOARD_CURRENT_READ_ID);
    return res.json({ok:true,businessType:type,reportDate:data.reportDate,snapshotId:data.snapshotId,snapshotStatus:metric?.ready?'COMPLETED':data.snapshotStatus,state:stateFromV236Metric(type,metric||{},data)});
  }catch(error){return res.status(500).json({ok:false,routeId:V236_DASHBOARD_CURRENT_ROUTE_ID,error:error?.message||String(error)});}
}

express.application.get=function v236FreshCurrentRoute(pathValue,...handlers){
  const path=String(pathValue||'');
  if(path==='/api/v234/current-summary'){
    console.info('[CE-QC][V236]',V236_DASHBOARD_CURRENT_ROUTE_ID,'replaced stale V234 current-summary route');
    return originalGet.call(this,pathValue,currentHandler);
  }
  if(path==='/api/v234/business-state/:type'){
    console.info('[CE-QC][V236]',V236_DASHBOARD_CURRENT_ROUTE_ID,'replaced stale V234 compact business-state route');
    return originalGet.call(this,pathValue,stateHandler);
  }
  return originalGet.call(this,pathValue,...handlers);
};
