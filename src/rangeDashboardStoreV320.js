import { loadRangeDashboard as loadRangeDashboardV295 } from './rangeDashboardStoreV295.js';
import { readV320HistoricalDailyWithDispatch, V320_DISPATCH_METRIC_OVERLAY_ID } from './v320DispatchMetricOverlay.js';

export const V320_RANGE_CURRENT_TRUTH_ID='2026-08-26-v320-single-day-completed-cache-truth-v1';
const CORE=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE=['SHOPEECN','SHOPEEVN'];
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):0;
const dateKey=v=>String(v||'').slice(0,10);
const PATCH_KEYS=['total','pod','podRate','sameDayPod','sameDayPodRate','ocCurrent','ocRate','pendingNonContinuous','pending3','pending3plus','oc1','oc2','cycle2','cycle2plus','shopRetention2','workOrder','inboundNoScan','provinceOpen','returned','returnRate','unresolved'];
function metricTarget(state){state.dashboard||={};state.dashboard.metrics||={};return state.dashboard.metrics;}
function patchState(state,row){if(!state||!row?.currentCacheOverlayApplied)return false;const m=metricTarget(state);const total=n(row.total),pod=n(row.pod),returned=n(row.returned),cancelled=n(row.cancelled);const values={...row,total,pod,podRate:pct(pod,total),sameDayPod:n(row.sameDayPod),sameDayPodRate:pct(row.sameDayPod,total),ocCurrent:n(row.ocCurrent),ocRate:pct(row.ocCurrent,total),pendingNonContinuous:n(row.pendingNonContinuous),pending3:n(row.pending3),pending3plus:n(row.pending3),oc1:n(row.oc1),oc2:n(row.oc2),cycle2:n(row.cycle2),cycle2plus:n(row.cycle2),shopRetention2:n(row.shopRetention2),workOrder:n(row.workOrder),inboundNoScan:n(row.inboundNoScan),provinceOpen:n(row.provinceOpen),returned,returnRate:pct(returned,total),unresolved:Math.max(0,total-pod-returned-cancelled)};for(const key of PATCH_KEYS)m[key]=values[key];state.sourceTotal=total;state.analyzedTotal=total;state.analysisPending=0;state.analysisComplete=true;state.snapshotStatus='COMPLETED';state.dashboard.totalMonitored=total;state.dashboard.todayPod=pod;state.dashboard.podRate=values.podRate;state.v320CurrentTruthId=V320_RANGE_CURRENT_TRUTH_ID;state.v320CurrentCacheOverlaySource=row.currentCacheOverlaySource;return true;}
function exactRow(type,date){const data=readV320HistoricalDailyWithDispatch(type,date,date,{expandSingle:false});return(data.daily||[]).find(row=>dateKey(row.reportDate)===date)||null;}
function sumRows(rows,type){const valid=rows.filter(Boolean);if(!valid.length)return null;const out={businessType:type,reportDate:valid[0].reportDate,currentCacheOverlayApplied:valid.every(r=>r.currentCacheOverlayApplied),currentCacheOverlaySource:'SUM_RECONCILED_COMPLETED_DASHBOARD_CACHE'};for(const key of ['total','pod','returned','cancelled','sameDayPod','ocCurrent','pendingNonContinuous','pending3','oc1','oc2','cycle2','shopRetention2','workOrder','inboundNoScan','provinceOpen'])out[key]=valid.reduce((sum,row)=>sum+n(row[key]),0);out.podRate=pct(out.pod,out.total);out.sameDayPodRate=pct(out.sameDayPod,out.total);out.ocRate=pct(out.ocCurrent,out.total);return out;}
function patchAggregateState(state,row){return patchState(state,row);}

export function loadRangeDashboard(fromDate,toDate){
  const range=loadRangeDashboardV295(fromDate,toDate),from=dateKey(range.fromDate||fromDate),to=dateKey(range.toDate||toDate);
  range.v320RangeCurrentTruthId=V320_RANGE_CURRENT_TRUTH_ID;range.v320DispatchMetricOverlayId=V320_DISPATCH_METRIC_OVERLAY_ID;
  if(!from||from!==to)return range;
  range.states||={};range.aggregates||={};const rows={};
  for(const type of [...CORE,...SHOPEE]){try{rows[type]=exactRow(type,to);}catch{rows[type]=null;}patchState(range.states[type],rows[type]);}
  const ccsl=sumRows(CORE.map(type=>rows[type]),'CCSL');if(ccsl?.currentCacheOverlayApplied)patchAggregateState(range.aggregates.CCSL,ccsl);
  const shopee=sumRows(SHOPEE.map(type=>rows[type]),'SHOPEE');if(shopee?.currentCacheOverlayApplied)patchAggregateState(range.aggregates.SHOPEE,shopee);
  const homeParts=CORE.map(type=>rows[type]);const whppMetrics=range.states?.WHPP?.dashboard?.metrics||{};if(homeParts.every(r=>r?.currentCacheOverlayApplied)){
    const whpp={reportDate:to,currentCacheOverlayApplied:true,total:n(whppMetrics.total??range.states?.WHPP?.sourceTotal),pod:n(whppMetrics.pod),returned:n(whppMetrics.returned),cancelled:n(whppMetrics.cancelled),sameDayPod:n(whppMetrics.sameDayPod),ocCurrent:n(whppMetrics.ocCurrent),pendingNonContinuous:n(whppMetrics.pendingNonContinuous),pending3:n(whppMetrics.pending3),oc1:n(whppMetrics.oc1),oc2:n(whppMetrics.oc2),cycle2:n(whppMetrics.cycle2),shopRetention2:n(whppMetrics.shopRetention2),workOrder:n(whppMetrics.workOrder),inboundNoScan:n(whppMetrics.inboundNoScan),provinceOpen:n(whppMetrics.provinceOpen)};const home=sumRows([...homeParts,whpp],'HOME');patchAggregateState(range.aggregates.HOME,home);}
  range.v320CurrentOverlayApplied=Object.values(rows).filter(row=>row?.currentCacheOverlayApplied).map(row=>row.businessType);
  return range;
}

console.info('[CE-QC][V320_RANGE_CURRENT_TRUTH]',V320_RANGE_CURRENT_TRUTH_ID,'single-day period dashboard reuses only denominator-matched COMPLETED dashboard cache; historical multi-day range remains read-only V295/V294 compatibility truth.');
