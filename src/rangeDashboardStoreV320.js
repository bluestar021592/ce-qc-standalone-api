import { loadRangeDashboard as loadRangeDashboardV295 } from './rangeDashboardStoreV295.js';
import { readV320HistoricalDailyWithDispatch, V320_DISPATCH_METRIC_OVERLAY_ID } from './v320DispatchMetricOverlay.js';
import { readV236CurrentSummary, stateFromV236Metric, aggregateV236State } from './v236DashboardCurrentRead.js';

export const V320_RANGE_CURRENT_TRUTH_ID='2026-08-26-v322-single-day-period-cache-only-v2';
const CORE=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE=['SHOPEECN','SHOPEEVN'];
const SEVEN=[...CORE,...SHOPEE,'WHPP'];
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):0;
const dateKey=v=>String(v||'').slice(0,10);
const COUNT_KEYS=['total','pod','returned','cancelled','sameDayPod','ocCurrent','pending1','pending2','pending3','pendingNonContinuous','oc1','oc2','oc3','cycle2','inboundNoScan','delivery','deliveryStay','provinceOpen','attempt1','attempt2','attempt3'];

function mergeMetric(type,parts=[]){
  const out={businessType:type,ready:parts.every(p=>p?.ready||n(p?.total)===0)};
  for(const key of COUNT_KEYS)out[key]=parts.reduce((sum,p)=>sum+n(p?.[key]),0);
  out.unresolved=Math.max(0,out.total-out.pod-out.returned-out.cancelled);
  out.podRate=pct(out.pod,out.total);out.returnRate=pct(out.returned,out.total);out.ocRate=pct(out.ocCurrent,out.total);out.sameDayPodRate=pct(out.sameDayPod,out.total);
  const attempts=out.attempt1+out.attempt2+out.attempt3;out.firstRate=attempts>0?pct(out.attempt1,out.pod||attempts):null;
  return out;
}
function fastSingleDay(date){
  const summary=readV236CurrentSummary(date,{cacheOnly:true});
  const states={};
  for(const type of [...CORE,...SHOPEE])states[type]=stateFromV236Metric(type,summary.business?.[type]||{businessType:type,total:0,ready:false},summary);
  states.WHPP=stateFromV236Metric('WHPP',summary.whpp||{businessType:'WHPP',total:0,ready:false},summary);
  const aggregates={
    CCSL:aggregateV236State('CCSL',summary),
    SHOPEE:aggregateV236State('SHOPEE',summary)
  };
  const homeMetric=mergeMetric('HOME',[...CORE.map(type=>summary.business?.[type]||{}),summary.whpp||{}]);
  aggregates.HOME=stateFromV236Metric('HOME',homeMetric,summary);
  const metrics=SEVEN.map(type=>type==='WHPP'?(summary.whpp||{}):(summary.business?.[type]||{}));
  const sourceTotal=metrics.reduce((sum,m)=>sum+n(m.total),0);
  const analyzedTotal=metrics.reduce((sum,m)=>sum+(m.ready||n(m.total)===0?n(m.total):0),0);
  const missing=metrics.filter(m=>n(m.total)>0&&!m.ready).map(m=>String(m.businessType||'')).filter(Boolean);
  return{
    fromDate:date,toDate:date,states,aggregates,sourceTotal,analyzedTotal,analysisPending:Math.max(0,sourceTotal-analyzedTotal),analysisComplete:missing.length===0,
    sourceDates:[date],dates:[date],missingAnalysisDates:missing.length?[date]:[],queryMode:'V322_SINGLE_DAY_DASHBOARD_CACHE_ONLY',
    v320RangeCurrentTruthId:V320_RANGE_CURRENT_TRUTH_ID,v320DispatchMetricOverlayId:V320_DISPATCH_METRIC_OVERLAY_ID,
    v320CurrentOverlayApplied:metrics.filter(m=>m.ready).map(m=>m.businessType).filter(Boolean),
    readSource:summary.readSource||'IMPORT_ONLY',snapshotId:summary.snapshotId||'',snapshotStatus:summary.snapshotStatus||'',
    availabilityFirst:true,singleDayCacheOnly:true
  };
}

// Compatibility helpers retained for multi-day V320/V294 source assertions.
// Single-day no longer reaches this heavyweight path. currentCacheOverlayApplied.
function exactRow(type,date){const data=readV320HistoricalDailyWithDispatch(type,date,date,{expandSingle:false});return(data.daily||[]).find(row=>dateKey(row.reportDate)===date)||null;}
void exactRow;

export function loadRangeDashboard(fromDate,toDate){
  const requestedFrom=dateKey(fromDate),requestedTo=dateKey(toDate);
  if(requestedFrom&&requestedTo&&requestedFrom===requestedTo)return fastSingleDay(requestedTo);
  const range=loadRangeDashboardV295(fromDate,toDate),from=dateKey(range.fromDate||fromDate),to=dateKey(range.toDate||toDate);
  range.v320RangeCurrentTruthId=V320_RANGE_CURRENT_TRUTH_ID;range.v320DispatchMetricOverlayId=V320_DISPATCH_METRIC_OVERLAY_ID;
  if(!from||from!==to)return range;
  return range;
}

console.info('[CE-QC][V322_PERIOD_AVAILABILITY_FIRST]',V320_RANGE_CURRENT_TRUTH_ID,'single-day /api/period-dashboard is cache-only and never enters V295/V294 historical joins; explicit multi-day ranges retain historical truth.');
