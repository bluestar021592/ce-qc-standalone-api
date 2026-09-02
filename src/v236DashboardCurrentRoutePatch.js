import express from 'express';
import { aggregateV236State, readV236CurrentSummary, stateFromV236Metric, V236_TYPES, V236_DASHBOARD_CURRENT_READ_ID } from './v236DashboardCurrentRead.js';
import { readV237DashboardTrends, V237_DASHBOARD_TREND_READ_ID } from './v237DashboardTrendRead.js';
import { loadRangeDashboard } from './rangeDashboardStoreV294.js';

export const V236_DASHBOARD_CURRENT_ROUTE_ID='2026-09-03-v419-global-range-current-summary-v1';
export const V419_GLOBAL_RANGE_CURRENT_SUMMARY_ID='2026-09-03-v419-one-range-current-cards-seven-business-v1';
const originalGet=express.application.get;
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const dateOnly=value=>{const s=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
function firstNumber(obj,keys){for(const key of keys){if(obj&&obj[key]!==undefined&&obj[key]!==null&&Number.isFinite(Number(obj[key])))return Number(obj[key]);}return 0;}
function normalizeRangeMetric(type,state={},reportDate=''){
  const raw={...(state?.dashboard?.metrics||{})};
  const total=firstNumber(raw,['total','pnh','today','totalMonitored'])||n(state?.sourceTotal)||n(state?.dashboard?.pnh)||n(state?.dashboard?.totalMonitored);
  const pod=firstNumber(raw,['pod','todayPod','signed'])||n(state?.dashboard?.todayPod);
  const returned=firstNumber(raw,['returned','returnedCount','returnCount']);
  const cancelled=firstNumber(raw,['cancelled','cancelCount']);
  const pending1=firstNumber(raw,['pending1','pending','pendingTotal']);
  const pending2=firstNumber(raw,['pending2']);
  const pending3=firstNumber(raw,['pending3','pending3plus']);
  const ocCurrent=firstNumber(raw,['ocCurrent','currentOc']);
  const deliveryStay=firstNumber(raw,['deliveryStay','delivery','delivering']);
  const sameDayPod=firstNumber(raw,['sameDayPod','firstDayPod']);
  const attempt1=firstNumber(raw,['attempt1','dispatchAttempt1']);
  const attempt2=firstNumber(raw,['attempt2','dispatchAttempt2']);
  const attempt3=firstNumber(raw,['attempt3','dispatchAttempt3']);
  const ready=state?.analysisComplete===true||total===0;
  const base={
    ...raw,businessType:type,reportDate,total,pod,returned,cancelled,
    unresolved:Math.max(0,total-pod-returned-cancelled),
    sameDayPod,pending1,pending2,pending3,
    pendingNonContinuous:firstNumber(raw,['pendingNonContinuous','pendingGap']),
    ocCurrent,oc1:firstNumber(raw,['oc1']),oc2:firstNumber(raw,['oc2']),oc3:firstNumber(raw,['oc3','oc3plus']),
    cycle2:firstNumber(raw,['cycle2','cycle2plus']),inboundNoScan:firstNumber(raw,['inboundNoScan']),
    delivery:firstNumber(raw,['delivery','delivering','deliveryStay']),deliveryStay,
    provinceOpen:firstNumber(raw,['provinceOpen','pvOpen']),attempt1,attempt2,attempt3,
    podRate:Number.isFinite(Number(raw.podRate))?Number(raw.podRate):pct(pod,total),
    returnRate:Number.isFinite(Number(raw.returnRate))?Number(raw.returnRate):pct(returned,total),
    pendingRate:Number.isFinite(Number(raw.pendingRate))?Number(raw.pendingRate):pct(pending1,total),
    deliveryRate:Number.isFinite(Number(raw.deliveryRate))?Number(raw.deliveryRate):pct(deliveryStay,total),
    ocRate:Number.isFinite(Number(raw.ocRate))?Number(raw.ocRate):pct(ocCurrent,total),
    sameDayPodRate:Number.isFinite(Number(raw.sameDayPodRate))?Number(raw.sameDayPodRate):pct(sameDayPod,total),
    firstRate:raw.firstRate??raw.attempt1Rate??null,
    ready,
    rangeReady:ready,
    rangeSource:V419_GLOBAL_RANGE_CURRENT_SUMMARY_ID
  };
  const regionSource=state?.dashboard?.regions||{};
  base.regions={};
  for(const code of ['PP','PV','UNKNOWN']){
    const region=regionSource?.[code]||{};
    const rt=firstNumber(region,['total','today']);
    const rp=firstNumber(region,['pod','todayPod']);
    const rr=firstNumber(region,['returned','returnCount']);
    const rc=firstNumber(region,['cancelled','cancelCount']);
    const ro=firstNumber(region,['ocCurrent','currentOc']);
    const rdel=firstNumber(region,['deliveryStay','delivery','delivering']);
    base.regions[code]={
      ...region,total:rt,pod:rp,returned:rr,cancelled:rc,unresolved:Math.max(0,rt-rp-rr-rc),
      pending1:firstNumber(region,['pending1','pending']),pending2:firstNumber(region,['pending2']),pending3:firstNumber(region,['pending3','pending3plus']),
      pendingNonContinuous:firstNumber(region,['pendingNonContinuous','pendingGap']),
      ocCurrent:ro,oc1:firstNumber(region,['oc1']),oc2:firstNumber(region,['oc2']),oc3:firstNumber(region,['oc3','oc3plus']),
      cycle2:firstNumber(region,['cycle2','cycle2plus']),inboundNoScan:firstNumber(region,['inboundNoScan']),
      deliveryStay:rdel,provinceOpen:firstNumber(region,['provinceOpen','pvOpen']),
      podRate:Number.isFinite(Number(region.podRate))?Number(region.podRate):pct(rp,rt),
      returnRate:Number.isFinite(Number(region.returnRate))?Number(region.returnRate):pct(rr,rt),
      ocRate:Number.isFinite(Number(region.ocRate))?Number(region.ocRate):pct(ro,rt),
      ready
    };
  }
  return base;
}
function readV419RangeCurrentSummary(fromDate='',toDate=''){
  const from=dateOnly(fromDate),to=dateOnly(toDate);
  if(!from||!to||from>to)throw new Error('日期范围无效');
  if(from===to)return readV236CurrentSummary(to);
  const range=loadRangeDashboard(from,to);
  const resolvedFrom=dateOnly(range?.fromDate)||from,resolvedTo=dateOnly(range?.toDate)||to;
  const business={};
  for(const type of V236_TYPES)business[type]=normalizeRangeMetric(type,range?.states?.[type]||{},resolvedTo);
  const whpp=normalizeRangeMetric('WHPP',range?.states?.WHPP||{},resolvedTo);
  return{
    ok:true,readId:V236_DASHBOARD_CURRENT_READ_ID,rangeReadId:V419_GLOBAL_RANGE_CURRENT_SUMMARY_ID,
    reportDate:resolvedTo,fromDate:resolvedFrom,toDate:resolvedTo,periodStart:resolvedFrom,periodEnd:resolvedTo,
    snapshotId:'',snapshotIds:{},snapshotStatus:range?.analysisComplete?'COMPLETED':'PARTIAL',
    business,whpp,readSource:'V419_CANONICAL_PERIOD_DASHBOARD_RANGE',readSources:Object.fromEntries(V236_TYPES.map(type=>[type,'V419_RANGE'])),
    cacheOnly:false,readyBusinessCount:Object.values(business).filter(item=>item.ready).length,
    sourceTotal:n(range?.sourceTotal),analyzedTotal:n(range?.analyzedTotal),analysisPending:n(range?.analysisPending),analysisComplete:Boolean(range?.analysisComplete),
    visibleTruthId:range?.visibleTruthId||'',queryMode:range?.queryMode||''
  };
}
function currentHandler(req,res){
  try{
    const to=dateOnly(req.query.to||req.query.reportDate||''),from=dateOnly(req.query.from||'');
    const data=from&&to&&from<=to?readV419RangeCurrentSummary(from,to):readV236CurrentSummary(to);
    if(!from&&data.whpp?.membershipIncomplete){
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-CE-QC-Current-Read',V236_DASHBOARD_CURRENT_READ_ID);
      return res.status(409).json({
        ok:false,
        routeId:V236_DASHBOARD_CURRENT_ROUTE_ID,
        code:data.whpp.errorCode||'WHPP_STANDARD_DAILY_INCOMPLETE',
        error:`WHPP标准日报成员不完整：日报头${Number(data.whpp.expected||0)}票，成员${Number(data.whpp.actual||0)}票`,
        reportDate:data.reportDate,
        expected:Number(data.whpp.expected||0),
        actual:Number(data.whpp.actual||0)
      });
    }
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-CE-QC-Current-Read',V236_DASHBOARD_CURRENT_READ_ID);
    res.setHeader('X-CE-QC-Range-Current',data.rangeReadId||'SINGLE_DAY');
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
    console.info('[CE-QC][V237]',V236_DASHBOARD_CURRENT_ROUTE_ID,'owns V234 current-summary + V419 global range current cards');
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
