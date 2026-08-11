import express from 'express';
import { loadMetricDetail, loadRangeDashboard } from './rangeDashboardStoreV58.js';

const PATCH_ID='2026-08-11-v58-dashboard-reconciliation-api-v1';

function isoDate(value='') {
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}

function metricDetail(req,res) {
  try {
    const toDate=isoDate(req.query.to||req.query.reportDate);
    const fromDate=isoDate(req.query.from)||toDate;
    if(!fromDate||!toDate||fromDate>toDate)return res.status(400).json({ok:false,patchId:PATCH_ID,error:'日期范围无效'});
    const result=loadMetricDetail({
      businessType:String(req.query.businessType||'CCSL'),
      fromDate,toDate,
      tab:String(req.query.tab||'allData'),
      page:Number(req.query.page||1),
      pageSize:Number(req.query.pageSize||200)
    });
    res.setHeader('Cache-Control','private, max-age=2');
    res.json({...result,patchId:PATCH_ID});
  } catch(error) {
    console.error('[V58][METRIC_DETAIL]',error);
    res.status(500).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});
  }
}

function reconciliation(req,res) {
  try {
    const toDate=isoDate(req.query.to||req.query.reportDate);
    const fromDate=isoDate(req.query.from)||toDate;
    if(!fromDate||!toDate||fromDate>toDate)return res.status(400).json({ok:false,patchId:PATCH_ID,error:'日期范围无效'});
    const range=loadRangeDashboard(fromDate,toDate);
    const summary={};
    for(const [type,state] of Object.entries(range.states||{}))summary[type]=state?.v55Summary||state?.dashboard?.v55Summary||{};
    summary.CCSL=range.aggregates?.CCSL?.v55Summary||range.aggregates?.CCSL?.dashboard?.v55Summary||{};
    summary.SHOPEE=range.aggregates?.SHOPEE?.v55Summary||range.aggregates?.SHOPEE?.dashboard?.v55Summary||{};
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,patchId:PATCH_ID,fromDate,toDate,summary});
  } catch(error) {
    console.error('[V58][RECONCILIATION]',error);
    res.status(500).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});
  }
}

let installed=false;
const previousListen=express.application.listen;
express.application.listen=function v55DashboardReconciliationListen(...args){
  if(!installed){
    installed=true;
    this.get('/api/v55/metric-detail',metricDetail);
    this.get('/api/v55/reconciliation',reconciliation);
  }
  return previousListen.apply(this,args);
};

export const V55_DASHBOARD_RECONCILIATION_PATCH_ID=PATCH_ID;
