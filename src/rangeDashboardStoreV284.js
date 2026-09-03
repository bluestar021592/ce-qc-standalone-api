import { loadRangeDashboard as loadRangeDashboardV191 } from './rangeDashboardStoreV191.js';
import { V284_DAILY_MEMBERSHIP_TRUTH_ID, readV284RegionFacts } from './v284DailyMembershipTruth.js';
import { summarizeV284ProvenRange as summarizeV284Range, readV284ProvenShopeeTrends } from './v284MembershipEvidenceCoverage.js';
import { mergeV293WhppHistoricalRange, V293_WHPP_HISTORICAL_RANGE_TRUTH_ID } from './v293WhppHistoricalRangeTruth.js';

export const V419_WHPP_RANGE_VISIBLE_METRIC_ID='2026-09-03-v419-whpp-range-visible-full-metrics-v1';
const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];
const COUNT_KEYS=['total','matched','pod','sameDayPod','ocCurrent','pendingNonContinuous','pending3','oc1','oc2','cycle2','shopRetention2','workOrder','inboundNoScan','provinceOpen','returned','attempt1','attempt2','attempt3','attemptUnknown','signingDaysSum','signingDaysCount'];
const WHPP_EXTRA_KEYS=['pending1','pending2','oc3','cancelled','unresolved','delivery','ccslCnDiversion','ccslZtDiversion','ccsl580Retention','phnomPenhShop','provinceShop','shopTotal'];
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(v,t)=>t?Number((n(v)*100/n(t)).toFixed(2)):0;

export function loadRangeDashboard(fromDate,toDate){
  const range=loadRangeDashboardV191(fromDate,toDate);
  const resolvedFrom=range.fromDate||fromDate,resolvedTo=range.toDate||toDate;
  const truth=summarizeV284Range(resolvedFrom,resolvedTo);
  range.states ||= {};
  range.aggregates ||= {};

  for(const type of CCSL_TYPES){
    patchState(range.states?.[type],truth.byType[type],truth.daily.filter(row=>row.businessType===type));
  }

  const shopeeRegionFacts={};
  for(const type of SHOPEE_TYPES){
    const dailyRows=truth.daily.filter(row=>row.businessType===type);
    patchState(range.states?.[type],truth.byType[type],dailyRows);
    const trend=readV284ProvenShopeeTrends(type,truth.dates?.[0]||resolvedFrom,truth.dates?.at(-1)||resolvedTo,{includeRegions:true});
    const regions=aggregateRegions(trend.daily||[]);
    shopeeRegionFacts[type]=regions;
    patchShopeeExactNested(range.states?.[type],type,truth.byType[type],regions);
  }

  patchState(range.aggregates?.CCSL,truth.ccsl,truth.daily.filter(row=>CCSL_TYPES.includes(row.businessType)));
  patchState(range.aggregates?.SHOPEE,truth.shopee,truth.daily.filter(row=>SHOPEE_TYPES.includes(row.businessType)));
  patchShopeeAggregateNested(range.aggregates?.SHOPEE,truth,shopeeRegionFacts);

  // V293: historical WHPP parse rows can be rotated while the WHPP daily ledger
  // and completed history summary remain intact. Keep canonical V284 rows whenever
  // they exist with the full daily denominator; only fill missing/shrunk WHPP days
  // from those preserved read-only history tables.
  const whppDaily=mergeV293WhppHistoricalRange(truth.daily.filter(row=>row.businessType==='WHPP'),resolvedFrom,resolvedTo);
  const visibleWhpp=mergeFacts('WHPP',whppDaily);
  const visibleDaily=[...truth.daily.filter(row=>row.businessType!=='WHPP'),...whppDaily]
    .sort((a,b)=>String(a.reportDate||'').localeCompare(String(b.reportDate||''))||String(a.businessType||'').localeCompare(String(b.businessType||'')));
  const visibleDates=[...new Set([...truth.dates,...whppDaily.map(row=>row.reportDate)].filter(Boolean))].sort();

  // V419: WHPP period cards use the same full daily metric set as the single-day
  // board. Region facts remain exact only while every range member still has a
  // classified PP/PV membership row. If historical membership has been rotated or
  // region is UNKNOWN, publish a coverage=false marker instead of pretending PP/PV=0.
  const whppRegionRows=readV284RegionFacts(resolvedFrom,resolvedTo).rows.filter(row=>String(row.businessType||'').toUpperCase()==='WHPP');
  const whppRegions=aggregateFlatWhppRegions(whppRegionRows);
  const whppClassifiedRegionTotal=n(whppRegions.PP?.total)+n(whppRegions.PV?.total);
  const whppRegionCoverageComplete=whppClassifiedRegionTotal===n(visibleWhpp.total);

  // V291: WHPP and the homepage operational aggregate are first-class read-only
  // range states. This does not alter SQLite or redefine CCSL. HOME is explicitly
  // CE+CEAF+TBKH+ALI1688+WHPP, matching the visible homepage core-card definition.
  range.states.WHPP=buildTruthState('WHPP',visibleWhpp,whppDaily);
  range.states.WHPP.regionCoverageComplete=whppRegionCoverageComplete;
  range.states.WHPP.whppRangeVisibleMetricId=V419_WHPP_RANGE_VISIBLE_METRIC_ID;
  range.states.WHPP.dashboard.regions=whppRegions;
  range.states.WHPP.dashboard.regionCoverageComplete=whppRegionCoverageComplete;
  range.states.WHPP.dashboard.whppRangeVisibleMetricId=V419_WHPP_RANGE_VISIBLE_METRIC_ID;
  const homeFact=mergeFacts('HOME',[truth.ccsl,visibleWhpp]);
  range.aggregates.HOME=buildTruthState('HOME',homeFact,visibleDaily.filter(row=>CCSL_TYPES.includes(row.businessType)||row.businessType==='WHPP'));

  const visibleSourceTotal=n(truth.ccsl?.total)+n(truth.shopee?.total)+n(visibleWhpp.total);
  const visibleAnalyzedTotal=n(truth.ccsl?.matched)+n(truth.shopee?.matched)+n(visibleWhpp.matched);
  const visibleMissingDates=visibleDates.filter(reportDate=>visibleDaily.some(row=>row.reportDate===reportDate&&n(row.total)>0&&!row.ready));
  range.sourceTotal=visibleSourceTotal;
  range.analyzedTotal=visibleAnalyzedTotal;
  range.analysisPending=Math.max(0,visibleSourceTotal-visibleAnalyzedTotal);
  range.missingAnalysisDates=visibleMissingDates;
  range.analysisComplete=visibleMissingDates.length===0&&visibleAnalyzedTotal>=visibleSourceTotal;
  range.sourceDates=visibleDates;
  range.dates=visibleDates;
  range.whppRegionCoverageComplete=whppRegionCoverageComplete;
  range.whppRangeVisibleMetricId=V419_WHPP_RANGE_VISIBLE_METRIC_ID;
  range.v284Coverage=visibleDaily.map(row=>({reportDate:row.reportDate,businessType:row.businessType,total:row.total,matched:row.matched,coverageRate:row.coverageRate,ready:row.ready,historyFallback:Boolean(row.historyFallback)}));
  return {...range,queryMode:`${range.queryMode||'SQL'}+DAILY_MEMBERSHIP_PROVEN_LEDGER_V284+V291_SEVEN_BUSINESS_VISIBLE_TRUTH+V293_WHPP_HISTORY_RANGE+V419_WHPP_FULL_METRICS`,dailyTruthId:V284_DAILY_MEMBERSHIP_TRUTH_ID,evidenceCoverageId:truth.evidenceCoverageId,whppHistoricalTruthId:V293_WHPP_HISTORICAL_RANGE_TRUTH_ID,sourceSelection:'LATEST_VALID_DAILY_MEMBERSHIP_WITH_PRESERVED_WHPP_HISTORY_FALLBACK',analysisSelection:'PROVEN_V246_LEDGER_OR_FINAL_FALLBACK',visibleTruthId:'2026-09-03-v419-seven-business-visible-truth-v3'};
}

function buildTruthState(type,fact,dailyRows=[]){
  const state={businessType:type,viewBusinessType:type,dashboard:{metrics:{},categories:{},detailTabs:{dashboard:{rows:[]}}},detailTabs:{dashboard:{rows:[]}}};
  patchState(state,fact,dailyRows);
  return state;
}

function mergeFacts(type,facts=[]){
  const out={businessType:type,reportDate:facts.map(f=>f?.reportDate).filter(Boolean).sort().at(-1)||''};
  const keys=type==='WHPP'?[...COUNT_KEYS,...WHPP_EXTRA_KEYS]:COUNT_KEYS;
  for(const key of keys)out[key]=facts.reduce((sum,f)=>sum+n(f?.[key]),0);
  out.coverageRate=pct(out.matched,out.total);
  out.podRate=pct(out.pod,out.total);
  out.sameDayPodRate=pct(out.sameDayPod,out.total);
  out.ocRate=pct(out.ocCurrent,out.total);
  const known=out.attempt1+out.attempt2+out.attempt3;
  out.attemptUnknown=Math.max(out.attemptUnknown,Math.max(0,out.pod-known));
  out.attemptCoverageRate=out.pod?pct(Math.min(out.pod,known),out.pod):null;
  out.attempt1Rate=out.pod?pct(out.attempt1,out.pod):null;
  out.attempt2Rate=out.pod?pct(out.attempt2,out.pod):null;
  out.attempt3Rate=out.pod?pct(out.attempt3,out.pod):null;
  out.avgPodDays=out.signingDaysCount?Number((out.signingDaysSum/out.signingDaysCount).toFixed(2)):null;
  out.ready=out.total===0||out.matched>=out.total;
  if(type==='WHPP')out.whppRangeVisibleMetricId=V419_WHPP_RANGE_VISIBLE_METRIC_ID;
  return out;
}

function aggregateRegions(daily=[]){
  const out={};
  for(const region of ['PP','PV','UNKNOWN'])out[region]=mergeFacts(region,daily.map(row=>row?.regions?.[region]).filter(Boolean));
  return out;
}
function aggregateFlatWhppRegions(rows=[]){
  const out={};
  for(const region of ['PP','PV','UNKNOWN'])out[region]=mergeFacts('WHPP',rows.filter(row=>String(row.regionCode||'').toUpperCase()===region));
  return out;
}

function patchState(state,fact,dailyRows=[]){
  if(!state||!fact)return;
  const missingDates=[...new Set(dailyRows.filter(row=>row.total>0&&!row.ready).map(row=>row.reportDate))].sort();
  state.sourceTotal=fact.total;
  state.analyzedTotal=fact.matched;
  state.analysisPending=Math.max(0,fact.total-fact.matched);
  state.analysisComplete=missingDates.length===0&&fact.matched>=fact.total;
  state.sourceDates=[...new Set(dailyRows.filter(row=>row.total>0).map(row=>row.reportDate))].sort();
  state.analyzedDates=[...new Set(dailyRows.filter(row=>row.total>0&&row.ready).map(row=>row.reportDate))].sort();
  state.missingAnalysisDates=missingDates;
  state.periodStart=state.sourceDates[0]||'';
  state.periodEnd=state.sourceDates.at(-1)||'';
  state.snapshotStatus=state.sourceDates.length?(state.analysisComplete?'COMPLETED':'PARTIAL'):'EMPTY';
  state.dailyReportReady=state.sourceDates.length>0;
  state.dailyParseSummary={...(state.dailyParseSummary||{}),totalRecognized:fact.total,sourceTotal:fact.total,analyzedTotal:fact.matched,analysisPending:state.analysisPending};
  state.sourceCoverage={sourceTotal:fact.total,analyzedTotal:fact.matched,analysisPending:state.analysisPending,analysisComplete:state.analysisComplete,sourceDates:state.sourceDates,analyzedDates:state.analyzedDates,missingAnalysisDates:missingDates,sourceSelection:'LATEST_VALID_DAILY_MEMBERSHIP_WITH_PRESERVED_WHPP_HISTORY_FALLBACK',analysisSelection:'PROVEN_V246_LEDGER_OR_FINAL_FALLBACK'};
  state.dashboard ||= {};
  const summaries=[state.v55Summary,state.dashboard?.v55Summary,state.dashboard?.metrics].filter(Boolean);
  for(const summary of summaries)patchMetrics(summary,fact);
  state.dashboard.metrics ||= {};
  patchMetrics(state.dashboard.metrics,fact);
  state.dashboard.sourceTotal=fact.total;
  state.dashboard.analyzedTotal=fact.matched;
  state.dashboard.analysisPending=state.analysisPending;
  state.dashboard.analysisComplete=state.analysisComplete;
  state.dashboard.sourceDates=state.sourceDates;
  state.dashboard.analyzedDates=state.analyzedDates;
  state.dashboard.missingAnalysisDates=missingDates;
  state.dashboard.totalMonitored=fact.total;
  state.dashboard.todayPod=fact.pod;
  state.dashboard.podRate=fact.podRate;
  if('pnh' in state.dashboard||!String(state.businessType||'').startsWith('SHOPEE'))state.dashboard.pnh=fact.total;
  patchDashboardRows(state.detailTabs?.dashboard?.rows,fact);
  patchDashboardRows(state.dashboard?.detailTabs?.dashboard?.rows,fact);
}

function patchShopeeExactNested(state,type,fact,regions={}){
  if(!state?.dashboard||!fact)return;
  const group=type==='SHOPEECN'?'CN':'VN';
  const groups=state.dashboard.recipientGroups||{};
  for(const metrics of [state.dashboard.metrics,groups.ALL?.metrics,groups[group]?.metrics])patchMetrics(metrics,fact);
  if(groups.ALL)groups.ALL.monitorCount=fact.total;
  if(groups[group])groups[group].monitorCount=fact.total;
  patchRegions(state.dashboard.regions,regions);
  patchRegions(groups.ALL?.regions,regions);
  patchRegions(groups[group]?.regions,regions);
}

function patchShopeeAggregateNested(state,truth,regionByType={}){
  if(!state?.dashboard)return;
  const groups=state.dashboard.recipientGroups||{};
  patchMetrics(state.dashboard.metrics,truth.shopee);
  patchMetrics(groups.ALL?.metrics,truth.shopee);
  patchMetrics(groups.CN?.metrics,truth.byType.SHOPEECN);
  patchMetrics(groups.VN?.metrics,truth.byType.SHOPEEVN);
  if(groups.ALL)groups.ALL.monitorCount=truth.shopee.total;
  if(groups.CN)groups.CN.monitorCount=n(truth.byType.SHOPEECN?.total);
  if(groups.VN)groups.VN.monitorCount=n(truth.byType.SHOPEEVN?.total);
  const allRegions={};
  for(const region of ['PP','PV','UNKNOWN'])allRegions[region]=mergeFacts(region,[regionByType.SHOPEECN?.[region],regionByType.SHOPEEVN?.[region]].filter(Boolean));
  patchRegions(state.dashboard.regions,allRegions);
  patchRegions(groups.ALL?.regions,allRegions);
  patchRegions(groups.CN?.regions,regionByType.SHOPEECN||{});
  patchRegions(groups.VN?.regions,regionByType.SHOPEEVN||{});
}

function patchRegions(target,regions={}){
  if(!target)return;
  for(const region of ['PP','PV','UNKNOWN'])if(target[region]&&regions[region])patchMetrics(target[region],regions[region]);
}

function patchMetrics(target,f){
  if(!target||!f)return;
  const isWhpp=String(f.businessType||'').toUpperCase()==='WHPP';
  const cancelled=isWhpp?n(f.cancelled):n(target.cancelled);
  Object.assign(target,{
    total:f.total,pod:f.pod,podRate:f.podRate,sameDayPod:f.sameDayPod,sameDayPodRate:f.sameDayPodRate,
    pendingNonContinuous:f.pendingNonContinuous,pending3:f.pending3,pending3plus:f.pending3,
    ocCurrent:f.ocCurrent,oc1:f.oc1,oc2:f.oc2,cycle2:f.cycle2,cycle2plus:f.cycle2,
    shopRetention2:f.shopRetention2,workOrder:f.workOrder,inboundNoScan:f.inboundNoScan,provinceOpen:f.provinceOpen,returned:f.returned,
    returnRate:pct(f.returned,f.total),unresolved:isWhpp?n(f.unresolved):Math.max(0,n(f.total)-n(f.pod)-n(f.returned)-cancelled),
    dispatchAttempt1:f.attempt1,dispatchAttempt2:f.attempt2,dispatchAttempt3:f.attempt3,dispatchAttemptUnclassifiedPod:f.attemptUnknown,
    dispatchAttemptDenominator:f.pod,dispatchAttempt1Rate:f.attempt1Rate,dispatchAttempt2Rate:f.attempt2Rate,dispatchAttempt3Rate:f.attempt3Rate,
    firstAttemptCount:f.attempt1,firstAttemptEligible:f.total,firstAttemptRate:pct(f.attempt1,f.total),
    attemptEvidenceCoverage:f.attemptCoverageRate,
    analysisCoverageRate:f.coverageRate
  });
  if(isWhpp)Object.assign(target,{
    pending1:n(f.pending1),pending2:n(f.pending2),oc3:n(f.oc3),cancelled:n(f.cancelled),unresolved:n(f.unresolved),delivery:n(f.delivery),deliveryStay:n(f.delivery),
    ccslCnDiversion:n(f.ccslCnDiversion),ccslZtDiversion:n(f.ccslZtDiversion),ccsl580Retention:n(f.ccsl580Retention),ccsl580Diversion:n(f.ccsl580Retention),
    phnomPenhShop:n(f.phnomPenhShop),provinceShop:n(f.provinceShop),shopTotal:n(f.shopTotal),activeStoreRetention:n(f.shopRetention2),
    whppRangeVisibleMetricId:V419_WHPP_RANGE_VISIBLE_METRIC_ID
  });
}

function patchDashboardRows(rows,f){
  if(!Array.isArray(rows))return;
  const values=new Map([
    ['Pending不连续',f.pendingNonContinuous],['Pending3+',f.pending3],['Pending 3天+',f.pending3],
    ['OC1+',f.oc1],['OC 1天+',f.oc1],['OC2+',f.oc2],['OC 2天+',f.oc2],
    ['门店滞留2天+',f.shopRetention2],['门店滞留',f.shopRetention2],['工单未处理',f.workOrder],['工单',f.workOrder],
    ['入库无扫描节点',f.inboundNoScan],['入库无扫描',f.inboundNoScan],['盘点2天+',f.cycle2],['盘点 2天+',f.cycle2],
    ['今日POD',f.pod],['POD率',f.podRate],['首次妥投率',f.sameDayPodRate],['首日POD妥投率',f.sameDayPodRate],['外省未完结POD件',f.provinceOpen],['已退回件',f.returned],['退回件',f.returned]
  ]);
  if(String(f?.businessType||'').toUpperCase()==='WHPP'){
    values.set('Pending1+',f.pending1);values.set('Pending2+',f.pending2);values.set('OC3+',f.oc3);
  }
  for(const row of rows){const label=String(row?.项目||row?.metricKey||row?.label||'').trim();if(!values.has(label))continue;const value=Number(values.get(label)||0);row.数值=value;row.数值原值=value;row.value=value;}
}

console.info('[CE-QC][V293_VISIBLE_TRUTH]',V284_DAILY_MEMBERSHIP_TRUTH_ID,V293_WHPP_HISTORICAL_RANGE_TRUTH_ID,V419_WHPP_RANGE_VISIBLE_METRIC_ID,'range exposes full WHPP historical period + HOME(CE/CEAF/TBKH/ALI1688+WHPP); WHPP visible range cards keep the complete single-day metric set and publish PP/PV region coverage explicitly instead of fake zero; read-only, no database mutation.');