import express from 'express';
import { getDb } from './db.js';
import { readV236CurrentSummary } from './v236DashboardCurrentRead.js';

export const V319_TREND_CACHE_FAST_ID='2026-08-26-v319-cache-only-exact-trend-v1';
const STANDARD_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const TYPES=new Set([...STANDARD_TYPES,'CCSL','SHOPEE','ALL','WHPP']);
const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];
const previousGet=express.application.get;
let registered=false;

const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
const dateKey=value=>{const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,returned:0,cancelled:0,unresolved:0,sameDayPod:0,pending1:0,pending2:0,pending3:0,ocCurrent:0,oc1:0,oc2:0,oc3:0,deliveryStay:0,attempt1:0,attempt2:0,attempt3:0,podRate:0,returnRate:0,pendingRate:0,deliveryRate:0,ocRate:0,sameDayPodRate:0,firstRate:null,ready:false};}
function merge(type,date,rows=[]){
  const out=blank(type,date),valid=rows.filter(Boolean);
  out.ready=valid.length>0&&valid.every(row=>row.ready);
  for(const row of valid){for(const key of ['total','pod','returned','cancelled','unresolved','sameDayPod','pending1','pending2','pending3','ocCurrent','oc1','oc2','oc3','deliveryStay','attempt1','attempt2','attempt3'])out[key]+=n(row[key]);}
  out.podRate=pct(out.pod,out.total);out.returnRate=pct(out.returned,out.total);out.pendingRate=pct(out.pending1,out.total);out.deliveryRate=pct(out.deliveryStay,out.total);out.ocRate=pct(out.ocCurrent,out.total);out.sameDayPodRate=pct(out.sameDayPod,out.total);
  const attempts=out.attempt1+out.attempt2+out.attempt3;out.firstRate=attempts>0?pct(out.attempt1,out.pod||attempts):null;
  return out;
}
function pick(summary,type,date){
  if(type==='WHPP')return summary.whpp||blank('WHPP',date);
  if(STANDARD_TYPES.includes(type))return summary.business?.[type]||blank(type,date);
  if(type==='CCSL')return merge('CCSL',date,CCSL_TYPES.map(key=>summary.business?.[key]));
  if(type==='SHOPEE')return merge('SHOPEE',date,SHOPEE_TYPES.map(key=>summary.business?.[key]));
  if(type==='ALL')return merge('ALL',date,[...STANDARD_TYPES.map(key=>summary.business?.[key]),summary.whpp]);
  return blank(type,date);
}
function selectedDates(type,from,to,explicitFrom,db=getDb()){
  const includeWhpp=type==='WHPP'||type==='ALL';
  if(explicitFrom){
    const sql=includeWhpp
      ?`SELECT reportDate FROM (SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? UNION SELECT DISTINCT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ?) ORDER BY reportDate ASC LIMIT 180`
      :`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC LIMIT 180`;
    const rows=includeWhpp?db.prepare(sql).all(from,to,from,to):db.prepare(sql).all(from,to);
    return rows.map(row=>String(row.reportDate||'')).filter(Boolean);
  }
  const sql=includeWhpp
    ?`SELECT reportDate FROM (SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? UNION SELECT DISTINCT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND reportDate<=?) ORDER BY reportDate DESC LIMIT 7`
    :`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? ORDER BY reportDate DESC LIMIT 7`;
  const rows=includeWhpp?db.prepare(sql).all(to,to):db.prepare(sql).all(to);
  return rows.map(row=>String(row.reportDate||'')).filter(Boolean).sort();
}

export function readV319TrendCacheFast(businessType='ALL',fromDate='',toDate='',db=getDb()){
  const type=String(businessType||'ALL').toUpperCase();
  const to=dateKey(toDate),explicitFrom=dateKey(fromDate),from=explicitFrom||to;
  if(!TYPES.has(type))throw new Error('业务板块无效');
  if(!from||!to||from>to)throw new Error('日期范围无效');
  const dates=selectedDates(type,from,to,Boolean(explicitFrom),db);
  const daily=dates.map(date=>pick(readV236CurrentSummary(date,{cacheOnly:true}),type,date));
  const value=(row,key)=>row?.ready?(row[key]===null||row[key]===undefined?null:n(row[key])):null;
  return{
    ok:true,id:V319_TREND_CACHE_FAST_ID,readId:V319_TREND_CACHE_FAST_ID,businessType:type,
    requestedFromDate:from,requestedToDate:to,fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,
    ticket:daily.map(row=>n(row.total)),pod:daily.map(row=>value(row,'pod')),podRate:daily.map(row=>value(row,'podRate')),
    oc:daily.map(row=>value(row,'ocCurrent')),ocRate:daily.map(row=>value(row,'ocRate')),
    sameDayPod:daily.map(row=>value(row,'sameDayPod')),sameDayPodRate:daily.map(row=>value(row,'sameDayPodRate')),
    missingDates:daily.filter(row=>!row.ready).map(row=>row.reportDate),
    source:'V319_DASHBOARD_DAILY_CACHE_ONLY_EXACT_RANGE',
    definitions:{podRate:'POD/当日总票',ocRate:'当前真实OC/当日总票',sameDayPodRate:'首日报当日完成POD/当日总票',readPolicy:'页面首屏只读已落库dashboard_daily_cache；不扫描final_rows/business_final_rows/qc_tracking_ledger，不触发CE接口'}
  };
}

function handler(req,res){
  try{
    const started=Date.now();
    const data=readV319TrendCacheFast(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-V319',V319_TREND_CACHE_FAST_ID);
    res.setHeader('Server-Timing',`v319;dur=${Date.now()-started}`);
    return res.json(data);
  }catch(error){return res.status(400).json({ok:false,id:V319_TREND_CACHE_FAST_ID,error:error?.message||String(error)});}
}
function register(app){if(registered)return;registered=true;previousGet.call(app,'/api/v319/trends',handler);console.info('[CE-QC][V319_TREND_CACHE_FAST]',V319_TREND_CACHE_FAST_ID,'exact selected-range trend first paint is cache-only/read-only and never runs heavyweight evidence joins on page navigation.');}
express.application.get=function v319TrendCacheFastRoute(pathValue,...handlers){if(!registered)register(this);return previousGet.call(this,pathValue,...handlers);};
