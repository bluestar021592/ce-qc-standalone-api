import express from 'express';
import { loadRangeDashboard } from './rangeDashboardStoreV58.js';

const PATCH_ID='2026-08-14-v105-cached-canonical-drilldown-v2';
const CCSL_TYPES=new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const RANGE_CACHE_MS=Math.max(10_000,Number(process.env.V105_DRILLDOWN_RANGE_CACHE_MS||60_000));
const rangeCache=new Map();

function isoDate(value='') {
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}

function normalizeType(value='') {
  const type=String(value||'').trim().toUpperCase().replace(/\s+/g,'');
  if(type==='CCSL'||type==='SHOPEE'||CCSL_TYPES.has(type)||SHOPEE_TYPES.has(type))return type;
  return 'CCSL';
}

function cachedRange(fromDate,toDate) {
  const key=`${fromDate}|${toDate}`;
  const now=Date.now();
  const hit=rangeCache.get(key);
  if(hit&&now-hit.at<RANGE_CACHE_MS)return hit.value;
  const value=loadRangeDashboard(fromDate,toDate);
  rangeCache.set(key,{at:now,value});
  while(rangeCache.size>12){
    const first=rangeCache.keys().next().value;
    if(first===undefined)break;
    rangeCache.delete(first);
  }
  return value;
}

function pickState(range,type) {
  if(type==='CCSL')return range?.aggregates?.CCSL||null;
  if(type==='SHOPEE')return range?.aggregates?.SHOPEE||null;
  return range?.states?.[type]||null;
}

function normalizeDetailKey(type,key='allData') {
  const raw=String(key||'allData').trim();
  if(type==='SHOPEE'||SHOPEE_TYPES.has(type)) {
    const shopee={
      allData:'all',podClosed:'pod',accountingReturned:'returned',accountingOpen:'unresolved',
      pendingAll:'pending1',pending2plus:'pending2',ocAll:'oc1',oc2plus:'oc2',cycle2plus:'cycle2'
    };
    return shopee[raw]||raw;
  }
  const common={
    all:'allData',cecnRetention:'ccslCnDiversion',ceztRetention:'ccslZtDiversion',
    ccsl580Diversion:'ccsl580Retention',cycle2plus:'cycle2'
  };
  return common[raw]||raw;
}

function unique(rows=[]) {
  const map=new Map();
  for(const row of rows||[]) {
    const bill=String(row?.shipmentCode||row?.运单号||'').trim().toUpperCase();
    if(!bill)continue;
    const key=`${row?.reportDate||''}|${row?.businessType||''}|${bill}`;
    map.set(key,row);
  }
  return [...map.values()];
}

function summaryValueForTab(summary={},key='') {
  const map={
    podClosed:'pod',accountingReturned:'returned',accountingOpen:'open',unresolved:'open',ordinaryOpen:'open',
    pendingAll:'pending1',pending2plus:'pending2',pending3:'pending3',pendingNonContinuous:'pendingNonContinuous',
    ocAll:'oc1',oc2plus:'oc2',oc3:'oc3',cycle2:'cycle2',inboundNoScan:'inboundNoScan',workOrderAbnormal:'workOrder',
    provinceOpen:'provinceOpen',ccslCnDiversion:'ccslCnDiversion',ccslZtDiversion:'ccslZtDiversion',ccsl580Retention:'ccsl580Retention',
    phnomPenhShop:'phnomPenhShop',provinceShop:'provinceShop',severeAbnormal:'severeAbnormal',accountingDifference:'accountingDifference',
    pod:'pod',returned:'returned',unresolved:'unresolved',pending1:'pending1',pending2:'pending2',pending3:'pending3',
    oc1:'oc1',oc2:'oc2',oc3:'oc3',cycle2:'cycle2',deliveryStay:'delivery',returnRequired:'returnRequired'
  };
  const metric=map[key];
  return metric?Number(summary?.[metric]??0):null;
}

function metricDetail(req,res) {
  const startedAt=Date.now();
  try {
    const toDate=isoDate(req.query.to||req.query.reportDate);
    const fromDate=isoDate(req.query.from)||toDate;
    if(!fromDate||!toDate||fromDate>toDate)return res.status(400).json({ok:false,patchId:PATCH_ID,error:'日期范围无效'});

    const type=normalizeType(req.query.businessType||'CCSL');
    const key=normalizeDetailKey(type,req.query.tab||'allData');
    const range=cachedRange(fromDate,toDate);
    const state=pickState(range,type);
    if(!state)return res.status(404).json({ok:false,patchId:PATCH_ID,error:`未找到${type}看板状态`});

    const summary=state?.v55Summary||state?.dashboard?.v55Summary||{};
    const detail=state?.detailTabs?.[key]||state?.dashboard?.detailTabs?.[key]||null;
    const rows=unique(detail?.rows||[]);
    const safePage=Math.max(1,Number(req.query.page||1)||1);
    const safeSize=Math.max(1,Math.min(500,Number(req.query.pageSize||200)||200));
    const start=(safePage-1)*safeSize;
    const total=rows.length;

    res.setHeader('Cache-Control','private, max-age=10');
    res.setHeader('Server-Timing',`v105-detail;dur=${Date.now()-startedAt}`);
    res.json({
      ok:true,
      patchId:PATCH_ID,
      source:'V105_CACHED_CANONICAL_DRILLDOWN',
      businessType:type,
      fromDate,
      toDate,
      tab:key,
      requestedTab:String(req.query.tab||''),
      page:safePage,
      pageSize:safeSize,
      total,
      detailDeclaredTotal:Number(detail?.total??total),
      summaryValue:summaryValueForTab(summary,key),
      detailKeyPresent:Boolean(detail),
      summary,
      rows:rows.slice(start,start+safeSize)
    });
  } catch(error) {
    console.error('[V105][METRIC_DETAIL]',error);
    res.status(500).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});
  }
}

function reconciliation(req,res) {
  const startedAt=Date.now();
  try {
    const toDate=isoDate(req.query.to||req.query.reportDate);
    const fromDate=isoDate(req.query.from)||toDate;
    if(!fromDate||!toDate||fromDate>toDate)return res.status(400).json({ok:false,patchId:PATCH_ID,error:'日期范围无效'});
    const range=cachedRange(fromDate,toDate);
    const summary={};
    for(const [type,state] of Object.entries(range.states||{}))summary[type]=state?.v55Summary||state?.dashboard?.v55Summary||{};
    summary.CCSL=range.aggregates?.CCSL?.v55Summary||range.aggregates?.CCSL?.dashboard?.v55Summary||{};
    summary.SHOPEE=range.aggregates?.SHOPEE?.v55Summary||range.aggregates?.SHOPEE?.dashboard?.v55Summary||{};
    res.setHeader('Cache-Control','private, max-age=10');
    res.setHeader('Server-Timing',`v105-reconciliation;dur=${Date.now()-startedAt}`);
    res.json({ok:true,patchId:PATCH_ID,source:'V105_CACHED_CANONICAL_DRILLDOWN',fromDate,toDate,summary});
  } catch(error) {
    console.error('[V105][RECONCILIATION]',error);
    res.status(500).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});
  }
}

let installed=false;
const previousListen=express.application.listen;
express.application.listen=function v105DashboardReconciliationListen(...args){
  if(!installed){
    installed=true;
    this.get('/api/v61/metric-detail',metricDetail);
    this.get('/api/v55/metric-detail',metricDetail);
    this.get('/api/v55/reconciliation',reconciliation);
  }
  return previousListen.apply(this,args);
};

export function inspectV105RangeCache(){return {size:rangeCache.size,ttlMs:RANGE_CACHE_MS};}
export const V55_DASHBOARD_RECONCILIATION_PATCH_ID=PATCH_ID;
