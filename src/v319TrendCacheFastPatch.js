import express from 'express';
import { getDb } from './db.js';
import { readV236CurrentSummary } from './v236DashboardCurrentRead.js';
import { readV320HistoricalDailyWithDispatch } from './v320DispatchMetricOverlay.js';
import { V320_HISTORICAL_DAILY_TRUTH_ID } from './v320HistoricalDailyTruth.js';
import { readV308DeliveryDaily } from './v308DeliveryDailyFastPath.js';

export const V319_TREND_CACHE_FAST_ID='2026-08-27-v329-three-business-cache-only-trend-v1';
const STANDARD_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const TYPES=new Set([...STANDARD_TYPES,'CCSL','SHOPEE','ALL','WHPP']);
const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];
const ATTEMPT_SET=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const previousGet=express.application.get;
const registeredApps=new WeakSet();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
const dateKey=value=>{const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,returned:0,cancelled:0,unresolved:0,sameDayPod:0,pending1:0,pending2:0,pending3:0,ocCurrent:0,oc1:0,oc2:0,oc3:0,deliveryStay:0,attempt1:0,attempt2:0,attempt3:0,podRate:0,returnRate:0,pendingRate:0,deliveryRate:0,ocRate:0,sameDayPodRate:0,firstRate:null,ready:false};}
function merge(type,date,rows=[]){const out=blank(type,date),valid=rows.filter(Boolean);out.ready=valid.length>0&&valid.every(row=>row.ready);for(const row of valid){for(const key of ['total','pod','returned','cancelled','unresolved','sameDayPod','pending1','pending2','pending3','ocCurrent','oc1','oc2','oc3','deliveryStay','attempt1','attempt2','attempt3'])out[key]+=n(row[key]);}out.podRate=pct(out.pod,out.total);out.returnRate=pct(out.returned,out.total);out.pendingRate=pct(out.pending1,out.total);out.deliveryRate=pct(out.deliveryStay,out.total);out.ocRate=pct(out.ocCurrent,out.total);out.sameDayPodRate=pct(out.sameDayPod,out.total);const attempts=out.attempt1+out.attempt2+out.attempt3;out.firstRate=attempts>0?pct(out.attempt1,out.pod||attempts):null;return out;}
function pick(summary,type,date){if(type==='WHPP')return summary.whpp||blank('WHPP',date);if(STANDARD_TYPES.includes(type))return summary.business?.[type]||blank(type,date);if(type==='CCSL')return merge('CCSL',date,CCSL_TYPES.map(key=>summary.business?.[key]));if(type==='SHOPEE')return merge('SHOPEE',date,SHOPEE_TYPES.map(key=>summary.business?.[key]));if(type==='ALL')return merge('ALL',date,[...STANDARD_TYPES.map(key=>summary.business?.[key]),summary.whpp]);return blank(type,date);}
function singleDayCache(type,date){const row=pick(readV236CurrentSummary(date,{cacheOnly:true}),type,date);const value=(key)=>row?.ready?(row[key]===null||row[key]===undefined?null:n(row[key])):null;return{ok:true,id:V319_TREND_CACHE_FAST_ID,readId:V319_TREND_CACHE_FAST_ID,businessType:type,requestedFromDate:date,requestedToDate:date,fromDate:date,toDate:date,dates:[date],daily:[row],ticket:[n(row.total)],pod:[value('pod')],podRate:[value('podRate')],oc:[value('ocCurrent')],ocRate:[value('ocRate')],sameDayPod:[value('sameDayPod')],sameDayPodRate:[value('sameDayPodRate')],missingDates:row?.ready?[]:[date],historyExpanded:false,source:'V329_SINGLE_DAY_DASHBOARD_CACHE_ONLY',definitions:{readPolicy:'单日首屏只读已落库dashboard_daily_cache，不扫描历史大表、不跑轨迹。'}};}
function trendShape(data,type,from,to){const daily=Array.isArray(data.daily)?data.daily:[],dates=daily.map(r=>r.reportDate);return{...data,id:V319_TREND_CACHE_FAST_ID,readId:V319_TREND_CACHE_FAST_ID,businessType:type,requestedFromDate:from,requestedToDate:to,dates,daily,ticket:daily.map(r=>n(r.total)),pod:daily.map(r=>n(r.pod)),podRate:daily.map(r=>r.podRate),oc:daily.map(r=>n(r.ocCurrent)),ocRate:daily.map(r=>r.ocRate),sameDayPod:daily.map(r=>n(r.sameDayPod)),sameDayPodRate:daily.map(r=>r.sameDayPodRate),missingDates:daily.filter(r=>r.ready===false).map(r=>r.reportDate)};}
export function readV319TrendCacheFast(businessType='ALL',fromDate='',toDate='',db=getDb(),options={}){
  const type=String(businessType||'ALL').toUpperCase(),from=dateKey(fromDate),to=dateKey(toDate);if(!TYPES.has(type))throw new Error('业务板块无效');if(!from||!to||from>to)throw new Error('日期范围无效');
  if(options.historyAll&&ATTEMPT_SET.has(type)){const data=readV308DeliveryDaily(type,from,to,db,{historyAll:true});return trendShape({...data,historyExpanded:true,source:`V329_AUTO_THREE_BUSINESS_CACHE:${data.source||''}`},type,from,to);}
  if(from===to)return singleDayCache(type,to);
  if(ATTEMPT_SET.has(type)){const data=readV308DeliveryDaily(type,from,to,db,{historyAll:false});return trendShape({...data,source:`V329_EXPLICIT_THREE_BUSINESS_CACHE:${data.source||''}`},type,from,to);}
  const data=readV320HistoricalDailyWithDispatch(type,from,to,{db,expandSingle:false});
  return trendShape({...data,source:`V329_OTHER_BUSINESS_EXPLICIT_RANGE:${data.source||V320_HISTORICAL_DAILY_TRUTH_ID}`},type,from,to);
}
function handler(req,res){try{const started=Date.now(),historyAll=String(req.query.history||'').toLowerCase()==='all',data=readV319TrendCacheFast(req.query.businessType,req.query.from,req.query.to,getDb(),{historyAll});res.setHeader('Cache-Control','private,max-age=5');res.setHeader('X-CE-QC-V319',V319_TREND_CACHE_FAST_ID);res.setHeader('X-CE-QC-V329','CACHE_ONLY_THREE_BUSINESS');res.setHeader('Server-Timing',`v329trend;dur=${Date.now()-started}`);return res.json(data);}catch(error){return res.status(400).json({ok:false,id:V319_TREND_CACHE_FAST_ID,error:error?.message||String(error)});}}
function isRealApp(app){return Boolean(app&&app!==express.application&&typeof app.use==='function'&&typeof app.route==='function'&&app.settings&&typeof app.settings==='object');}
function register(app){if(!isRealApp(app)||registeredApps.has(app))return false;registeredApps.add(app);previousGet.call(app,'/api/v319/trends',handler);console.info('[CE-QC][V329_TREND_ROUTE]',V319_TREND_CACHE_FAST_ID,'TBKH/CN/VN trend reads use the same small daily cache as the history table; no historical scan runs on the web process.');return true;}
express.application.get=function v329TrendAvailabilityRoute(pathValue,...handlers){const path=typeof pathValue==='string'?pathValue:'';if(path.startsWith('/')&&path!=='/api/v319/trends')register(this);return previousGet.call(this,pathValue,...handlers);};