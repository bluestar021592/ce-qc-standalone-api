import express from 'express';
import { aggregateV236State, readV236CurrentSummary, stateFromV236Metric, V236_TYPES, V236_DASHBOARD_CURRENT_READ_ID } from './v236DashboardCurrentRead.js';
import { readV237DashboardTrends, V237_DASHBOARD_TREND_READ_ID } from './v237DashboardTrendRead.js';

export const V236_DASHBOARD_CURRENT_ROUTE_ID='2026-08-22-v237-dashboard-owner-route-v2';
const originalGet=express.application.get;

function currentHandler(req,res){
  try{
    const data=readV236CurrentSummary(String(req.query.reportDate||'').slice(0,10));
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-CE-QC-Current-Read',V236_DASHBOARD_CURRENT_READ_ID);
    return res.json(data);
  }catch(error){return res.status(500).json({ok:false,routeId:V236_DASHBOARD_CURRENT_ROUTE_ID,error:error?.message||String(error)});}
}
function statePayload(type,req,res){
  const data=readV236CurrentSummary(String(req.query.reportDate||'').slice(0,10));
  const metric=data.business[type];
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-CE-QC-Current-Read',V236_DASHBOARD_CURRENT_READ_ID);
  return res.json({ok:true,businessType:type,reportDate:data.reportDate,snapshotId:data.snapshotId,snapshotStatus:metric?.ready?'COMPLETED':data.snapshotStatus,state:stateFromV236Metric(type,metric||{},data)});
}
function stateHandler(req,res){
  try{
    const type=String(req.params.type||req.params.businessType||'').toUpperCase();
    if(!V236_TYPES.includes(type))return res.status(400).json({ok:false,error:'业务板块无效'});
    return statePayload(type,req,res);
  }catch(error){return res.status(500).json({ok:false,routeId:V236_DASHBOARD_CURRENT_ROUTE_ID,error:error?.message||String(error)});}
}
function trendHandler(req,res){
  try{
    const data=readV237DashboardTrends(String(req.query.businessType||'ALL'),String(req.query.from||''),String(req.query.to||''));
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-Trend-Read',V237_DASHBOARD_TREND_READ_ID);
    return res.json(data);
  }catch(error){return res.status(500).json({ok:false,routeId:V236_DASHBOARD_CURRENT_ROUTE_ID,error:error?.message||String(error)});}
}
function compactAggregate(scope,req,res){
  try{
    const data=readV236CurrentSummary(String(req.query.reportDate||'').slice(0,10));
    const state=aggregateV236State(scope,data);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-CE-QC-Current-Read',V236_DASHBOARD_CURRENT_READ_ID);
    return res.json({ok:true,state});
  }catch(error){return res.status(500).json({ok:false,routeId:V236_DASHBOARD_CURRENT_ROUTE_ID,error:error?.message||String(error)});}
}
function compactBusiness(req,res,next){
  if(String(req.query.compact||'')!=='1')return next();
  const type=String(req.params.businessType||'').toUpperCase();
  if(!V236_TYPES.includes(type))return next();
  return statePayload(type,req,res);
}
function compactShopee(req,res,next){if(String(req.query.compact||'')!=='1')return next();return compactAggregate('SHOPEE',req,res);}
function compactCcsl(req,res,next){if(String(req.query.compact||'')!=='1')return next();return compactAggregate('CCSL',req,res);}

express.application.get=function v237DashboardOwnerRoute(pathValue,...handlers){
  const path=String(pathValue||'');
  if(path==='/api/v234/current-summary'){
    console.info('[CE-QC][V237]',V236_DASHBOARD_CURRENT_ROUTE_ID,'owns V234 current-summary');
    return originalGet.call(this,pathValue,currentHandler);
  }
  if(path==='/api/v234/business-state/:type'){
    console.info('[CE-QC][V237]',V236_DASHBOARD_CURRENT_ROUTE_ID,'owns V234 business-state');
    return originalGet.call(this,pathValue,stateHandler);
  }
  if(path==='/api/v234/trends'){
    console.info('[CE-QC][V237]',V236_DASHBOARD_CURRENT_ROUTE_ID,'owns V234 trends with exact completed snapshot truth');
    return originalGet.call(this,pathValue,trendHandler);
  }
  if(path==='/api/business-state/:businessType'){
    console.info('[CE-QC][V237]',V236_DASHBOARD_CURRENT_ROUTE_ID,'adds fast compact business-state pre-handler');
    return originalGet.call(this,pathValue,compactBusiness,...handlers);
  }
  if(path==='/api/shopee/state'){
    console.info('[CE-QC][V237]',V236_DASHBOARD_CURRENT_ROUTE_ID,'adds fast compact SHOPEE aggregate pre-handler');
    return originalGet.call(this,pathValue,compactShopee,...handlers);
  }
  if(path==='/api/state'){
    console.info('[CE-QC][V237]',V236_DASHBOARD_CURRENT_ROUTE_ID,'adds fast compact CCSL aggregate pre-handler');
    return originalGet.call(this,pathValue,compactCcsl,...handlers);
  }
  return originalGet.call(this,pathValue,...handlers);
};
