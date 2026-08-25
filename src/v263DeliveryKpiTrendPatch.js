import './v264TbkhOpenAttemptLifecycle.js';
import express from 'express';
import { getDb } from './db.js';
import { readV284ProvenDashboardTrends } from './v284MembershipEvidenceCoverage.js';
import { V284_DAILY_MEMBERSHIP_TRUTH_ID } from './v284DailyMembershipTruth.js';
import { enforceV294MetricCompleteness, V294_METRIC_COMPLETENESS_ID } from './v294MetricCompletenessTruth.js';
import { getV263DeliveryEvidenceStatus, requestV263DeliveryEvidenceBackfill } from './v262ShopeeStrictEvidenceBackfill.js';

export const V263_DELIVERY_KPI_TREND_ID='2026-08-25-v294-three-business-daily-membership-kpi-trend-v6';
const TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const CACHE_MS=15_000;
const memory=new Map();
const previousGet=express.application.get;
let routeRegistered=false;
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const dateKey=v=>{const m=String(v||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};

function strictDaily(row={}){
  const complete=enforceV294MetricCompleteness(row);
  const ledgerReady=complete.ready!==false;
  const podKnown=n(complete.pod);
  const ocKnown=n(complete.ocCurrent);
  const sameDayPodKnown=n(complete.sameDayPod);
  const attemptEvidenceComplete=ledgerReady&&Boolean(complete.attemptEvidenceComplete);
  const signingEvidenceComplete=ledgerReady&&Boolean(complete.signingEvidenceComplete);
  const evidenceIncomplete=!ledgerReady||!attemptEvidenceComplete||!signingEvidenceComplete;
  const knownAttempt1=ledgerReady?n(complete.attempt1):0;
  const knownAttempt2=ledgerReady?n(complete.attempt2):0;
  const knownAttempt3=ledgerReady?n(complete.attempt3):0;
  return {
    ...complete,
    total:n(complete.total),
    podKnown,
    pod:ledgerReady?podKnown:null,
    ocKnown,
    oc:ledgerReady?ocKnown:null,
    ocCurrent:ledgerReady?ocKnown:null,
    sameDayPodKnown,
    sameDayPod:ledgerReady?sameDayPodKnown:null,
    podRate:ledgerReady?complete.podRate:null,
    ocRate:ledgerReady?complete.ocRate:null,
    sameDayPodRate:ledgerReady?complete.sameDayPodRate:null,
    ledgerReady,
    ledgerCount:n(complete.matched),
    sourceTotal:n(complete.total),
    cacheTotal:n(complete.total),
    avgSigningDays:ledgerReady&&signingEvidenceComplete?complete.avgPodDays:null,
    avgPodDays:ledgerReady&&signingEvidenceComplete?complete.avgPodDays:null,
    attempt1Known:knownAttempt1,
    attempt2Known:knownAttempt2,
    attempt3Known:knownAttempt3,
    attempt1:attemptEvidenceComplete?knownAttempt1:null,
    attempt2:attemptEvidenceComplete?knownAttempt2:null,
    attempt3:attemptEvidenceComplete?knownAttempt3:null,
    attemptUnknown:ledgerReady?n(complete.attemptUnknown):podKnown,
    attemptEvidenceCount:ledgerReady?n(complete.attemptEvidenceCount):0,
    attemptCoverageRate:ledgerReady&&podKnown>0?complete.attemptCoverageRate:null,
    signingCoverageRate:ledgerReady&&podKnown>0?complete.signingCoverageRate:null,
    attempt1Rate:ledgerReady&&attemptEvidenceComplete?complete.attempt1Rate:null,
    attempt2Rate:ledgerReady&&attemptEvidenceComplete?complete.attempt2Rate:null,
    attempt3Rate:ledgerReady&&attemptEvidenceComplete?complete.attempt3Rate:null,
    attemptEvidenceComplete,
    signingEvidenceComplete,
    evidenceIncomplete,
    metricCompletenessId:V294_METRIC_COMPLETENESS_ID
  };
}

export function readV263DeliveryKpiTrends(businessType='',fromDate='',toDate='',db=getDb()){
  const type=String(businessType||'').toUpperCase();
  const to=dateKey(toDate),from=dateKey(fromDate)||to;
  if(!TYPES.has(type))throw new Error('V263仅支持TBKH、SHOPEECN、SHOPEEVN');
  if(!from||!to||from>to)throw new Error('日期范围无效');
  const key=`${type}|${from}|${to}`;
  const hit=memory.get(key);
  if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;

  const base=readV284ProvenDashboardTrends(type,from,to,db);
  const daily=(base.daily||[]).map(strictDaily);
  const evidenceIncomplete=daily.some(row=>row.evidenceIncomplete);
  const value={
    ...base,
    ok:true,
    id:V263_DELIVERY_KPI_TREND_ID,
    truthId:V284_DAILY_MEMBERSHIP_TRUTH_ID,
    metricCompletenessId:V294_METRIC_COMPLETENESS_ID,
    businessType:type,
    daily,
    ticket:daily.map(r=>r.total),
    pod:daily.map(r=>r.pod),
    podRate:daily.map(r=>r.podRate),
    oc:daily.map(r=>r.ocCurrent),
    ocRate:daily.map(r=>r.ocRate),
    avgSigningDays:daily.map(r=>r.avgSigningDays),
    attempt1:daily.map(r=>r.attempt1),
    attempt2:daily.map(r=>r.attempt2),
    attempt3:daily.map(r=>r.attempt3),
    attemptUnknown:daily.map(r=>r.ledgerReady?r.attemptUnknown:null),
    attempt1Rate:daily.map(r=>r.attempt1Rate),
    attempt2Rate:daily.map(r=>r.attempt2Rate),
    attempt3Rate:daily.map(r=>r.attempt3Rate),
    attemptCoverageRate:daily.map(r=>r.attemptCoverageRate),
    signingCoverageRate:daily.map(r=>r.signingCoverageRate),
    evidenceIncomplete,
    evidenceStatus:getV263DeliveryEvidenceStatus(),
    source:'LATEST_VALID_DAILY_MEMBERSHIP + PROVEN_LIFECYCLE_TRUTH + COMPLETE_POD_METRIC_GATE',
    definitions:{
      membership:'每个日期只使用该日最新VALID日报成员作为分母；firstReportDate只用于生命周期与签收天数，不决定日趋势归属',
      attempt:'TBKH/SHOPEE统一：70 START优先；整票无70才用60；只有Pending/失败后出现新START才进入下一派；全部POD派次证据完整才发布1/2/3派件数与比例，否则显示—；已识别数量只作为覆盖诊断字段保留',
      signingDays:'生命周期首次进入最新VALID日报日期到真实POD日期，含首尾当天；全部POD都有真实签收天数才发布平均值，否则显示—',
      status:'日报成员决定分母；整日状态事实未全部验证时POD/OC/派次/签收指标统一不发布局部数字，只保留精确票数分母和诊断字段'
    }
  };
  memory.set(key,{at:Date.now(),value});
  return value;
}

function handler(req,res){
  try{
    const data=readV263DeliveryKpiTrends(req.query.businessType,req.query.from,req.query.to);
    if(data.evidenceIncomplete){
      requestV263DeliveryEvidenceBackfill({businessType:data.businessType,fromDate:data.fromDate,toDate:data.toDate,reason:'DASHBOARD_LOW_COVERAGE',delayMs:250});
    }
    res.setHeader('Cache-Control','private,max-age=5');
    res.setHeader('X-CE-QC-V263',V263_DELIVERY_KPI_TREND_ID);
    res.setHeader('X-CE-QC-V284',V284_DAILY_MEMBERSHIP_TRUTH_ID);
    res.setHeader('X-CE-QC-V294-Metric-Completeness',V294_METRIC_COMPLETENESS_ID);
    return res.json(data);
  }catch(error){return res.status(400).json({ok:false,id:V263_DELIVERY_KPI_TREND_ID,error:error?.message||String(error)});}
}
function register(app){
  if(routeRegistered)return;
  routeRegistered=true;
  previousGet.call(app,'/api/v263/delivery-trends',handler);
  console.info('[CE-QC][V294_DELIVERY_KPI]',V263_DELIVERY_KPI_TREND_ID,V284_DAILY_MEMBERSHIP_TRUTH_ID,V294_METRIC_COMPLETENESS_ID,'TBKH + SHOPEECN + SHOPEEVN use exact latest-VALID daily membership, proven lifecycle truth, and complete-POD attempt/signing publication gates.');
}
express.application.get=function v263DeliveryTrendRoute(pathValue,...handlers){
  if(!routeRegistered&&String(pathValue||'')==='/api/v234/trends')register(this);
  return previousGet.call(this,pathValue,...handlers);
};
