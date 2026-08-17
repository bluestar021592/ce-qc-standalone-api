import express from 'express';
import { getDb } from './db.js';
import { loadWhppState } from './whppStore.js';
import { buildWhppDashboard } from './whppReporting.js';

const PATCH_ID='2026-08-17-v172-whpp-exact-drilldown-v1';
const ROUTE='/api/v172/whpp-metric-detail';

function dateOnly(value=''){
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function regionOf(row={}){
  const code=String(row.regionCode||row.区域||'').trim().toUpperCase();
  return code==='PP'?'PP':code==='PV'?'PV':'UNKNOWN';
}
function normalizeTab(value='all'){
  const raw=String(value||'all').trim();
  const aliases={podRate:'pod',returnRate:'returned','签收率':'pod','签收件数':'pod','今日POD':'pod','POD率':'pod','已退回件':'returned','当前未闭环':'unresolved','订单取消':'cancelled','Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','派送中':'delivery','CCSLCN':'ccslCnDiversion','CEZT':'ccslZtDiversion','CCSL580':'ccsl580Retention','金边门店':'phnomPenhShop','外省门店':'provinceShop'};
  return aliases[raw]||raw||'all';
}
function stateForDate(reportDate=''){
  const requested=dateOnly(reportDate);
  const current=loadWhppState();
  if(!requested||requested===dateOnly(current.reportDate))return current;
  const row=getDb().prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC,id DESC LIMIT 1").get(requested);
  if(!row)return {businessType:'WHPP',reportDate:requested,pnhBills:[],dailyParseRows:[],finalRows:[]};
  const payload=safeJson(row.payloadJson,{});
  return payload.state||{businessType:'WHPP',reportDate:requested,pnhBills:[],dailyParseRows:[],finalRows:[]};
}
function build(query={}){
  const state=stateForDate(query.reportDate||query.date||'');
  const dashboard=buildWhppDashboard(state);
  const tab=normalizeTab(query.tab||query.metric||'all');
  const detail=dashboard.detailTabs?.[tab]||dashboard.detailTabs?.all||{label:tab,rows:[],total:0};
  const region=String(query.region||'').trim().toUpperCase();
  let rows=Array.isArray(detail.rows)?detail.rows:[];
  if(region==='PP'||region==='PV')rows=rows.filter(row=>regionOf(row)===region);
  const page=Math.max(1,Number(query.page||1));
  const pageSize=Math.max(1,Math.min(300,Number(query.pageSize||200)));
  const start=(page-1)*pageSize;
  const regionLabel=region==='PP'?'本省PP':region==='PV'?'外省PV':'';
  return {ok:true,patchId:PATCH_ID,businessType:'WHPP',reportDate:state.reportDate||dateOnly(query.reportDate),tab,region,label:`${regionLabel}${regionLabel?' · ':''}${detail.label||tab}`,total:rows.length,page,pageSize,rows:rows.slice(start,start+pageSize)};
}

const previousListen=express.application.listen;
let installed=false;
express.application.listen=function v172WhppExactDrilldownListen(...args){
  if(!installed){
    installed=true;
    this.get(ROUTE,(req,res)=>{
      try{
        res.setHeader('Cache-Control','no-store');
        res.json(build(req.query||{}));
      }catch(error){
        res.status(500).json({ok:false,patchId:PATCH_ID,error:error?.message||String(error)});
      }
    });
  }
  return previousListen.apply(this,args);
};

export function inspectV172WhppDetail(query={}){return build(query);}
export const V172_WHPP_DETAIL_PARITY_PATCH_ID=PATCH_ID;
