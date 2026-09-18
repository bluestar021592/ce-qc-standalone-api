import express from 'express';
import { getDb } from './db.js';
import { readV236CurrentSummary } from './v236DashboardCurrentRead.js';
import { readV320HistoricalDailyWithDispatch } from './v320DispatchMetricOverlay.js';
import { V320_HISTORICAL_DAILY_TRUTH_ID } from './v320HistoricalDailyTruth.js';
import { V329_THREE_BUSINESS_CACHE_REVISION } from './v329ThreeBusinessDailyCache.js';

export const V319_TREND_CACHE_FAST_ID='2026-09-18-stability-browser-cache-only-trend-v2';
const STANDARD_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const TYPES=new Set([...STANDARD_TYPES,'CCSL','SHOPEE','ALL','WHPP']);
const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];
const ATTEMPT_SET=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const previousGet=express.application.get;
const registeredApps=new WeakSet();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):null;
const avg=(sum,count)=>n(count)>0?Number((n(sum)/n(count)).toFixed(2)):null;
const dateKey=value=>{const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};

function blank(type,date=''){
  return{businessType:type,reportDate:date,total:0,pod:0,returned:0,cancelled:0,unresolved:0,sameDayPod:0,pending1:0,pending2:0,pending3:0,ocCurrent:0,oc1:0,oc2:0,oc3:0,deliveryStay:0,attempt1:null,attempt2:null,attempt3:null,podRate:0,returnRate:0,pendingRate:0,deliveryRate:0,ocRate:0,sameDayPodRate:0,firstRate:null,ready:false};
}
function merge(type,date,rows=[]){
  const out=blank(type,date),valid=rows.filter(Boolean);out.ready=valid.length>0&&valid.every(row=>row.ready);
  for(const row of valid){
    for(const key of ['total','pod','returned','cancelled','unresolved','sameDayPod','pending1','pending2','pending3','ocCurrent','oc1','oc2','oc3','deliveryStay'])out[key]+=n(row[key]);
  }
  out.podRate=pct(out.pod,out.total)??0;out.returnRate=pct(out.returned,out.total)??0;out.pendingRate=pct(out.pending1,out.total)??0;out.deliveryRate=pct(out.deliveryStay,out.total)??0;out.ocRate=pct(out.ocCurrent,out.total)??0;out.sameDayPodRate=pct(out.sameDayPod,out.total)??0;
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

function readAttemptCacheRows(db,type,from,to,{historyAll=false}={}){
  if(!ATTEMPT_SET.has(type)||!db||!to)return[];
  try{
    const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='v329_three_business_daily_cache' LIMIT 1").get();
    if(!table)return[];
    const sql=historyAll
      ? `SELECT * FROM v329_three_business_daily_cache WHERE businessType=? AND reportDate<=? AND total>0 AND cacheRevision=? ORDER BY reportDate`
      : `SELECT * FROM v329_three_business_daily_cache WHERE businessType=? AND reportDate BETWEEN ? AND ? AND total>0 AND cacheRevision=? ORDER BY reportDate`;
    return historyAll
      ? db.prepare(sql).all(type,to,V329_THREE_BUSINESS_CACHE_REVISION)
      : db.prepare(sql).all(type,from,to,V329_THREE_BUSINESS_CACHE_REVISION);
  }catch{return[];}
}
function attemptRow(type,row={}){
  const total=n(row.total),pod=n(row.pod),a1=n(row.attempt1),a2=n(row.attempt2),a3=n(row.attempt3),known=a1+a2+a3;
  const signingCount=n(row.signingDaysCount),signingSum=n(row.signingDaysSum);
  return{
    businessType:type,reportDate:dateKey(row.reportDate),total,pod,ocCurrent:n(row.ocCurrent),oc:n(row.ocCurrent),sameDayPod:n(row.sameDayPod),
    podRate:pct(pod,total)??0,ocRate:pct(row.ocCurrent,total)??0,sameDayPodRate:pct(row.sameDayPod,total)??0,
    attempt1:a1,attempt2:a2,attempt3:a3,attemptUnknown:Math.max(0,pod-known),attemptEvidenceCount:known,
    attempt1Rate:pod?pct(a1,pod):null,attempt2Rate:pod?pct(a2,pod):null,attempt3Rate:pod?pct(a3,pod):null,
    attemptCoverageRate:pod?pct(known,pod):null,attemptEvidenceComplete:pod===0||known>=pod,
    signingDaysSum:signingSum,signingDaysCount:signingCount,signingCoverageRate:pod?pct(signingCount,pod):null,signingEvidenceComplete:pod===0||signingCount>=pod,
    avgSigningDays:avg(signingSum,signingCount),avgPodDays:avg(signingSum,signingCount),
    ppAvgSigningDays:avg(row.ppSigningDaysSum,row.ppSigningDaysCount),pvAvgSigningDays:avg(row.pvSigningDaysSum,row.pvSigningDaysCount),
    ppSigningDaysSum:n(row.ppSigningDaysSum),ppSigningDaysCount:n(row.ppSigningDaysCount),pvSigningDaysSum:n(row.pvSigningDaysSum),pvSigningDaysCount:n(row.pvSigningDaysCount),
    ready:Boolean(Number(row.ready)),ledgerReady:Boolean(Number(row.ready)),evidenceIncomplete:!Boolean(Number(row.ready))||(pod>0&&(known<pod||signingCount<pod)),
    source:String(row.source||'V329_DAILY_CACHE')
  };
}
function overlayAttemptCache(base,cached){
  if(!cached||n(cached.total)!==n(base.total)||!Number(cached.ready))return{
    ...base,oc:n(base.ocCurrent),attempt1:null,attempt2:null,attempt3:null,attemptUnknown:n(base.pod),attempt1Rate:null,attempt2Rate:null,attempt3Rate:null,attemptCoverageRate:null,
    avgSigningDays:null,avgPodDays:null,ppAvgSigningDays:null,pvAvgSigningDays:null,evidenceIncomplete:n(base.pod)>0
  };
  const evidence=attemptRow(base.businessType,cached);
  return{...base,...evidence,total:n(base.total),pod:n(base.pod),ocCurrent:n(base.ocCurrent),oc:n(base.ocCurrent),podRate:base.podRate,ocRate:base.ocRate,sameDayPod:n(base.sameDayPod),sameDayPodRate:base.sameDayPodRate,ready:base.ready!==false,ledgerReady:base.ready!==false};
}
function singleDayCache(type,date,db=getDb()){
  const base=pick(readV236CurrentSummary(date,{cacheOnly:true}),type,date);
  const cached=ATTEMPT_SET.has(type)?readAttemptCacheRows(db,type,date,date)[0]:null;
  const row=ATTEMPT_SET.has(type)?overlayAttemptCache(base,cached):{...base,oc:n(base.ocCurrent)};
  const value=key=>row?.ready?(row[key]===null||row[key]===undefined?null:n(row[key])):null;
  return trendShape({
    ok:true,businessType:type,fromDate:date,toDate:date,daily:[row],historyExpanded:false,
    historyCachePending:ATTEMPT_SET.has(type)&&!cached,
    source:ATTEMPT_SET.has(type)?'V329_SINGLE_DAY_DASHBOARD_PLUS_SAVED_ATTEMPT_CACHE':'V329_SINGLE_DAY_DASHBOARD_CACHE_ONLY',
    definitions:{readPolicy:'单日首屏只读已落库dashboard_daily_cache；TBKH/CN/VN派次与签收天数只叠加已保存V329小缓存。GET不建表、不修复证据、不扫描历史大表、不跑轨迹。'}
  },type,date,date);
}
function trendShape(data,type,from,to){
  const daily=(Array.isArray(data.daily)?data.daily:[]).map(row=>({...row,oc:row.oc??n(row.ocCurrent),avgPodDays:row.avgPodDays??row.avgSigningDays??null}));
  const dates=daily.map(r=>r.reportDate);
  return{...data,id:V319_TREND_CACHE_FAST_ID,readId:V319_TREND_CACHE_FAST_ID,businessType:type,requestedFromDate:from,requestedToDate:to,dates,daily,
    ticket:daily.map(r=>n(r.total)),pod:daily.map(r=>r.ready===false?null:n(r.pod)),podRate:daily.map(r=>r.ready===false?null:r.podRate),
    oc:daily.map(r=>r.ready===false?null:n(r.ocCurrent)),ocRate:daily.map(r=>r.ready===false?null:r.ocRate),
    sameDayPod:daily.map(r=>r.ready===false?null:n(r.sameDayPod)),sameDayPodRate:daily.map(r=>r.ready===false?null:r.sameDayPodRate),
    attempt1:daily.map(r=>r.ready===false?null:(r.attempt1??null)),attempt2:daily.map(r=>r.ready===false?null:(r.attempt2??null)),attempt3:daily.map(r=>r.ready===false?null:(r.attempt3??null)),
    attempt1Rate:daily.map(r=>r.ready===false?null:(r.attempt1Rate??null)),attempt2Rate:daily.map(r=>r.ready===false?null:(r.attempt2Rate??null)),attempt3Rate:daily.map(r=>r.ready===false?null:(r.attempt3Rate??null)),
    attemptUnknown:daily.map(r=>r.ready===false?null:(r.attemptUnknown??null)),attemptCoverageRate:daily.map(r=>r.ready===false?null:(r.attemptCoverageRate??null)),
    avgSigningDays:daily.map(r=>r.ready===false?null:(r.avgSigningDays??null)),avgPodDays:daily.map(r=>r.ready===false?null:(r.avgPodDays??r.avgSigningDays??null)),
    ppAvgSigningDays:daily.map(r=>r.ready===false?null:(r.ppAvgSigningDays??null)),pvAvgSigningDays:daily.map(r=>r.ready===false?null:(r.pvAvgSigningDays??null)),
    signingCoverageRate:daily.map(r=>r.ready===false?null:(r.signingCoverageRate??null)),
    evidenceIncomplete:daily.some(r=>r?.evidenceIncomplete===true),missingDates:daily.filter(r=>r.ready===false).map(r=>r.reportDate)};
}
function attemptHistory(type,from,to,db,historyAll=false){
  const rows=readAttemptCacheRows(db,type,from,to,{historyAll});
  if(rows.length){
    const daily=rows.map(row=>attemptRow(type,row));
    return trendShape({ok:true,fromDate:daily[0]?.reportDate||from,toDate:daily.at(-1)?.reportDate||to,daily,historyExpanded:true,historyCachePending:false,source:'V329_SAVED_DERIVED_CACHE_READ_ONLY',definitions:{readPolicy:'浏览器历史趋势只SELECT已保存V329轻量缓存；缺失时不在请求线程补算、不触发CE API。'}},type,from,to);
  }
  const fallback=singleDayCache(type,to,db);
  return{...fallback,requestedFromDate:from,requestedToDate:to,historyExpanded:true,historyCachePending:true,source:'V329_SAVED_CACHE_MISSING_CURRENT_DAY_ONLY'};
}

export function readV319TrendCacheFast(businessType='ALL',fromDate='',toDate='',db=getDb(),options={}){
  const type=String(businessType||'ALL').toUpperCase(),from=dateKey(fromDate),to=dateKey(toDate);
  if(!TYPES.has(type))throw new Error('业务板块无效');if(!from||!to||from>to)throw new Error('日期范围无效');
  if(ATTEMPT_SET.has(type)){
    if(from===to&&!options.historyAll)return singleDayCache(type,to,db);
    return attemptHistory(type,from,to,db,Boolean(options.historyAll));
  }
  if(from===to)return singleDayCache(type,to,db);
  const data=readV320HistoricalDailyWithDispatch(type,from,to,{db,expandSingle:false});
  return trendShape({...data,source:`V329_OTHER_BUSINESS_EXPLICIT_RANGE:${data.source||V320_HISTORICAL_DAILY_TRUTH_ID}`},type,from,to);
}
function handler(req,res){
  try{
    const started=Date.now(),historyAll=String(req.query.history||'').toLowerCase()==='all',data=readV319TrendCacheFast(req.query.businessType,req.query.from,req.query.to,getDb(),{historyAll});
    res.setHeader('Cache-Control','private,max-age=5');res.setHeader('X-CE-QC-V319',V319_TREND_CACHE_FAST_ID);res.setHeader('X-CE-QC-V329','READ_ONLY_SAVED_CACHE');
    res.setHeader('Server-Timing',`v329trend;dur=${Date.now()-started}`);return res.json(data);
  }catch(error){return res.status(400).json({ok:false,id:V319_TREND_CACHE_FAST_ID,error:error?.message||String(error)});}
}
function isRealApp(app){return Boolean(app&&app!==express.application&&typeof app.use==='function'&&typeof app.route==='function'&&app.settings&&typeof app.settings==='object');}
function register(app){
  if(!isRealApp(app)||registeredApps.has(app))return false;registeredApps.add(app);previousGet.call(app,'/api/v319/trends',handler);
  console.info('[CE-QC][V319_STABILITY_TREND_ROUTE]',V319_TREND_CACHE_FAST_ID,'browser trend GETs are read-only: current cards use dashboard cache; TBKH/CN/VN attempts/signing use saved V329 cache; no request-time evidence repair or CE API.');
  return true;
}
express.application.get=function v329TrendAvailabilityRoute(pathValue,...handlers){const path=typeof pathValue==='string'?pathValue:'';if(path.startsWith('/')&&path!=='/api/v319/trends')register(this);return previousGet.call(this,pathValue,...handlers);};
