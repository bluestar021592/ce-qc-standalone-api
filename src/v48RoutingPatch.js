import express from 'express';
import { getDb } from './db.js';
import { loadRangeDashboard } from './rangeDashboardStore.js';

const PATCH_ID='2026-08-11-v48-final-location-routing-api-v1';
const EXACT_TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);
const AGGREGATES=new Set(['CCSL','SHOPEE']);
const DESTINATION_TABS={
  CCSLCN:'ccslCnDiversion',
  CCSLZT:'ccslZtDiversion',
  CCSL580:'ccsl580Retention'
};

function date(value=''){
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}

function latestCompletedDate(){
  const row=getDb().prepare(`
    SELECT b.reportDate
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    WHERE b.status='VALID'
    ORDER BY b.reportDate DESC,b.createdAt DESC,b.batchId DESC
    LIMIT 1
  `).get();
  return date(row?.reportDate);
}

function stateFor(range,type){
  if(type==='CCSL')return range.aggregates?.CCSL;
  if(type==='SHOPEE')return range.aggregates?.SHOPEE;
  return range.states?.[type];
}

function totalFor(state={}){
  return Number(
    state.sourceTotal ??
    state.dashboard?.sourceTotal ??
    state.dashboard?.pnh ??
    state.dashboard?.totalMonitored ??
    state.dashboard?.metrics?.total ??
    state.dailyParseSummary?.totalRecognized ??
    state.pnhBills?.length ??
    0
  );
}

function summaryFor(state={}){
  const route=state.dashboard?.routing||{};
  const categories=state.dashboard?.categories||{};
  const metrics=state.dashboard?.metrics||{};
  const pick=(...values)=>Number(values.find(value=>value!==undefined&&value!==null)||0);
  return {
    ccslCnDiversion:pick(route.ccslCnDiversion,categories.ccslCnDiversion,metrics.ccslCnDiversion),
    ccslZtDiversion:pick(route.ccslZtDiversion,categories.ccslZtDiversion,metrics.ccslZtDiversion),
    ccsl580Retention:pick(route.ccsl580Retention,categories.ccsl580Retention,metrics.ccsl580Retention,metrics.ccsl580Diversion),
    phnomPenhShop:pick(route.phnomPenhShop,categories.phnomPenhShop,metrics.phnomPenhShop)
  };
}

function handler(req,res){
  try{
    const type=String(req.query.businessType||'').trim().toUpperCase();
    if(!EXACT_TYPES.has(type)&&!AGGREGATES.has(type))return res.status(400).json({ok:false,error:'业务板块无效'});
    const fallback=latestCompletedDate();
    const from=date(req.query.from)||date(req.query.to)||fallback;
    const to=date(req.query.to)||from;
    if(!from||!to||from>to)return res.status(400).json({ok:false,error:'日期范围无效'});

    const range=loadRangeDashboard(from,to);
    const state=stateFor(range,type);
    if(!state)return res.status(404).json({ok:false,error:'当前日期范围没有该业务板块数据'});
    const summary=summaryFor(state);
    const destination=String(req.query.destination||'').trim().toUpperCase();
    const tabName=DESTINATION_TABS[destination]||'';
    const detail=tabName?(state.detailTabs?.[tabName]||state.dashboard?.detailTabs?.[tabName]||{rows:[],total:0}):null;
    const pageSize=Math.max(1,Math.min(2000,Number(req.query.pageSize||1000)));
    const rows=detail?(detail.rows||[]).slice(0,pageSize):[];

    res.setHeader('Cache-Control','private, max-age=10');
    res.json({
      ok:true,
      patchId:PATCH_ID,
      businessType:type,
      fromDate:from,
      toDate:to,
      total:totalFor(state),
      summary,
      destination:tabName?destination:'',
      totalDetail:detail?Number(detail.total??detail.rows?.length??0):0,
      total:destination&&detail?Number(detail.total??detail.rows?.length??0):totalFor(state),
      rows,
      routingRuleVersion:range.routingRuleVersion||''
    });
  }catch(error){
    console.error('[V48][ROUTING]',error);
    res.status(500).json({ok:false,error:error.message||String(error)});
  }
}

const previousListen=express.application.listen;
let installed=false;
express.application.listen=function v48RoutingListen(...args){
  if(!installed){
    installed=true;
    this.get('/api/v48/routing',handler);
  }
  return previousListen.apply(this,args);
};

export const V48_ROUTING_PATCH_ID=PATCH_ID;
