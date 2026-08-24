import { loadRangeDashboard as loadRangeDashboardV191 } from './rangeDashboardStoreV191.js';
import { V284_DAILY_MEMBERSHIP_TRUTH_ID, summarizeV284Range } from './v284DailyMembershipTruth.js';

const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];

export function loadRangeDashboard(fromDate,toDate){
  const range=loadRangeDashboardV191(fromDate,toDate);
  const truth=summarizeV284Range(range.fromDate||fromDate,range.toDate||toDate);
  for(const type of [...CCSL_TYPES,...SHOPEE_TYPES]) patchState(range.states?.[type],truth.byType[type],truth.daily.filter(row=>row.businessType===type));
  patchState(range.aggregates?.CCSL,truth.ccsl,truth.daily.filter(row=>CCSL_TYPES.includes(row.businessType)));
  patchState(range.aggregates?.SHOPEE,truth.shopee,truth.daily.filter(row=>SHOPEE_TYPES.includes(row.businessType)));
  range.sourceTotal=truth.sourceTotal;
  range.analyzedTotal=truth.analyzedTotal;
  range.analysisPending=truth.analysisPending;
  range.missingAnalysisDates=truth.missingDates;
  range.analysisComplete=truth.analysisComplete;
  range.sourceDates=truth.dates;
  range.dates=truth.dates;
  range.v284Coverage=truth.daily.map(row=>({reportDate:row.reportDate,businessType:row.businessType,total:row.total,matched:row.matched,coverageRate:row.coverageRate,ready:row.ready}));
  return {...range,queryMode:`${range.queryMode||'SQL'}+DAILY_MEMBERSHIP_LEDGER_V284`,dailyTruthId:V284_DAILY_MEMBERSHIP_TRUTH_ID,sourceSelection:'LATEST_VALID_DAILY_MEMBERSHIP',analysisSelection:'V246_LEDGER_FIRST_FINAL_FALLBACK'};
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
  state.snapshotStatus=state.sourceDates.length?(state.analysisComplete?'COMPLETED':'PARTIAL'):'EMPTY';
  state.dailyReportReady=state.sourceDates.length>0;
  state.dailyParseSummary={...(state.dailyParseSummary||{}),totalRecognized:fact.total,sourceTotal:fact.total,analyzedTotal:fact.matched,analysisPending:state.analysisPending};
  state.sourceCoverage={sourceTotal:fact.total,analyzedTotal:fact.matched,analysisPending:state.analysisPending,analysisComplete:state.analysisComplete,sourceDates:state.sourceDates,analyzedDates:state.analyzedDates,missingAnalysisDates:missingDates,sourceSelection:'LATEST_VALID_DAILY_MEMBERSHIP',analysisSelection:'V246_LEDGER_FIRST_FINAL_FALLBACK'};
  const summaries=[state.v55Summary,state.dashboard?.v55Summary,state.dashboard?.metrics].filter(Boolean);
  for(const summary of summaries) patchMetrics(summary,fact);
  if(state.dashboard){
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
    if('pnh' in state.dashboard)state.dashboard.pnh=fact.total;
  }
  patchDashboardRows(state.detailTabs?.dashboard?.rows,fact);
  patchDashboardRows(state.dashboard?.detailTabs?.dashboard?.rows,fact);
}

function patchMetrics(target,f){
  Object.assign(target,{
    total:f.total,pod:f.pod,podRate:f.podRate,
    pendingNonContinuous:f.pendingNonContinuous,pending3:f.pending3,pending3plus:f.pending3,
    oc1:f.oc1,oc2:f.oc2,cycle2:f.cycle2,cycle2plus:f.cycle2,
    shopRetention2:f.shopRetention2,workOrder:f.workOrder,inboundNoScan:f.inboundNoScan,provinceOpen:f.provinceOpen,returned:f.returned,
    dispatchAttempt1:f.attempt1,dispatchAttempt2:f.attempt2,dispatchAttempt3:f.attempt3,dispatchAttemptUnclassifiedPod:f.attemptUnknown,
    dispatchAttemptDenominator:f.total,dispatchAttempt1Rate:f.attempt1Rate,dispatchAttempt2Rate:f.attempt2Rate,dispatchAttempt3Rate:f.attempt3Rate,
    firstAttemptCount:f.attempt1,firstAttemptEligible:f.total,firstAttemptRate:f.attempt1Rate,
    attemptEvidenceCoverage:f.attemptCoverageRate,
    analysisCoverageRate:f.coverageRate
  });
}

function patchDashboardRows(rows,f){
  if(!Array.isArray(rows))return;
  const values=new Map([
    ['Pending不连续',f.pendingNonContinuous],['Pending3+',f.pending3],['Pending 3天+',f.pending3],
    ['OC1+',f.oc1],['OC 1天+',f.oc1],['OC2+',f.oc2],['OC 2天+',f.oc2],
    ['门店滞留2天+',f.shopRetention2],['门店滞留',f.shopRetention2],['工单未处理',f.workOrder],['工单',f.workOrder],
    ['入库无扫描节点',f.inboundNoScan],['入库无扫描',f.inboundNoScan],['盘点2天+',f.cycle2],['盘点 2天+',f.cycle2],
    ['今日POD',f.pod],['POD率',f.podRate],['首次妥投率',f.podRate],['外省未完结POD件',f.provinceOpen],['已退回件',f.returned],['退回件',f.returned]
  ]);
  for(const row of rows){const label=String(row?.项目||row?.metricKey||row?.label||'').trim();if(!values.has(label))continue;const value=Number(values.get(label)||0);row.数值=value;row.数值原值=value;row.value=value;}
}

console.info('[CE-QC][V284_RANGE]',V284_DAILY_MEMBERSHIP_TRUTH_ID,'range cards/coverage use daily latest-VALID membership + V246 ledger; legacy completed/final rows no longer decide whether a whole day is zero.');
