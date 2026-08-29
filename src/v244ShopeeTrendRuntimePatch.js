import express from 'express';
import { getDb } from './db.js';
import { V284_DAILY_MEMBERSHIP_TRUTH_ID } from './v284DailyMembershipTruth.js';
import { readV284ProvenShopeeTrends as readV284ShopeeTrends } from './v284MembershipEvidenceCoverage.js';
import { enforceV294MetricCompleteness, V294_METRIC_COMPLETENESS_ID } from './v294MetricCompletenessTruth.js';
import { readV329ThreeBusinessDailyCache } from './v329ThreeBusinessDailyCache.js';

// Historical export names remain stable for the browser and old code, but V284
// replaces the old firstReportDate cohort with exact daily latest-VALID membership.
export const V244_SHOPEE_TREND_ID = V284_DAILY_MEMBERSHIP_TRUTH_ID;
export const V245_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
export const V246_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
export const V247_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
const previousGet=express.application.get;
let routeRegistered=false;
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):null;
const avg=(sum,count)=>n(count)>0?Number((n(sum)/n(count)).toFixed(2)):null;

function legacyCoverage(row={}){
  const ready=row.ready!==false;
  const complete=enforceV294MetricCompleteness(row);
  const pod=Number(complete.pod||0);
  const rawA1=Number(complete.attempt1||0),rawA2=Number(complete.attempt2||0),rawA3=Number(complete.attempt3||0);
  const known=rawA1+rawA2+rawA3;
  const rawUnknown=Math.max(Number(complete.attemptUnknown||0),Math.max(0,pod-known));
  const signingDaysCount=Number(complete.signingDaysCount||complete.podDaysCount||0);
  const signingDaysSum=Number(complete.signingDaysSum||complete.podDaysSum||0);
  const regions={};
  for(const [key,value] of Object.entries(row.regions||{})) regions[key]=legacyCoverage({...value,regions:{}});
  return {
    ...complete,
    regions,
    podDaysCount:ready?signingDaysCount:0,
    podDaysSum:ready?signingDaysSum:0,
    avgPodDays:ready?complete.avgPodDays:null,
    attempt1:ready?rawA1:0,
    attempt2:ready?rawA2:0,
    attempt3:ready?rawA3:0,
    attempt1Rate:ready?complete.attempt1Rate:null,
    attempt2Rate:ready?complete.attempt2Rate:null,
    attempt3Rate:ready?complete.attempt3Rate:null,
    attemptCoverageRate:ready?complete.attemptCoverageRate:null,
    attemptEvidenceCount:ready?Math.min(pod,known):0,
    attemptUnknown:ready?rawUnknown:0,
    attemptEvidenceComplete:ready&&complete.attemptEvidenceComplete,
    signingEvidenceComplete:ready&&complete.signingEvidenceComplete,
    signingCoverageRate:ready?complete.signingCoverageRate:null,
    metricCompletenessId:V294_METRIC_COMPLETENESS_ID
  };
}

function strictSigningCache(type,fromDate,toDate){
  try{
    const data=readV329ThreeBusinessDailyCache(type,toDate,getDb(),fromDate);
    return new Map((data.daily||[]).map(row=>[String(row.reportDate||''),row]));
  }catch{return new Map();}
}
function patchRegionSigning(region={},sum=0,count=0){
  const pod=n(region.pod),c=n(count),s=n(sum);
  return {...region,signingDaysSum:s,signingDaysCount:c,podDaysSum:s,podDaysCount:c,avgPodDays:avg(s,c),signingCoverageRate:pod>0?pct(c,pod):null,signingEvidenceComplete:pod===0||c>=pod};
}
function strictSigningOverlay(row={},cached=null){
  const out=legacyCoverage(row),pod=n(out.pod),c=n(cached?.signingDaysCount),s=n(cached?.signingDaysSum);
  out.signingDaysSum=s;out.signingDaysCount=c;out.podDaysSum=s;out.podDaysCount=c;out.avgPodDays=avg(s,c);out.signingCoverageRate=pod>0?pct(c,pod):null;out.signingEvidenceComplete=pod===0||c>=pod;
  if(out.regions?.PP)out.regions.PP=patchRegionSigning(out.regions.PP,cached?.ppSigningDaysSum,cached?.ppSigningDaysCount);
  if(out.regions?.PV)out.regions.PV=patchRegionSigning(out.regions.PV,cached?.pvSigningDaysSum,cached?.pvSigningDaysCount);
  if(out.regions?.UNKNOWN)out.regions.UNKNOWN=patchRegionSigning(out.regions.UNKNOWN,0,0);
  out.signingTruth='V329_REAL_START_TO_POD_CACHE';
  return out;
}

export function readV244ShopeeTrends(businessType='SHOPEECN',fromDate='',toDate='',options={}) {
  const type=String(businessType||'').toUpperCase();
  const result=readV284ShopeeTrends(type,fromDate,toDate,options);
  const signing=strictSigningCache(type,result.fromDate||fromDate,result.toDate||toDate);
  const daily=(result.daily||[]).map(row=>strictSigningOverlay(row,signing.get(String(row.reportDate||''))||null));
  return {
    ...result,
    daily,
    avgPodDays:daily.map(r=>r.ready?r.avgPodDays:null),
    attempt1:daily.map(r=>r.ready?r.attempt1:null),
    attempt2:daily.map(r=>r.ready?r.attempt2:null),
    attempt3:daily.map(r=>r.ready?r.attempt3:null),
    attempt1Rate:daily.map(r=>r.ready?r.attempt1Rate:null),
    attempt2Rate:daily.map(r=>r.ready?r.attempt2Rate:null),
    attempt3Rate:daily.map(r=>r.ready?r.attempt3Rate:null),
    attemptUnknown:daily.map(r=>r.ready?r.attemptUnknown:null),
    attemptCoverageRate:daily.map(r=>r.ready&&Number(r.pod||0)>0?r.attemptCoverageRate:null),
    signingCoverageRate:daily.map(r=>r.ready&&Number(r.pod||0)>0?r.signingCoverageRate:null),
    metricCompletenessId:V294_METRIC_COMPLETENESS_ID,
    readId:V247_SHOPEE_TREND_ID,
    definitions:{
      podRate:'V284当天最新VALID日报成员中的当前POD/当日成员总票；状态以已验证V246账本优先，旧final仅缺失回退',
      ocRate:'V284当天日报成员中的当前真实OC/当日成员总票',
      avgPodDays:'真实首次派送START日期到真实POD日期，含首尾自然日；仅使用V329严格START→POD缓存中的真实样本，缺START或POD证据时保持未知，不再用首次日报日期替代',
      attemptRate:'TBKH/SHOPEE统一真实70 START→失败或Pending→新START；全轨迹没有70才允许60兜底。当天全部POD派次证据完整才发布1/2/3派率；无真实派次证据时显示—，证据不完整也显示—并单列证据覆盖率',
      trackingLedger:'日报成员决定分母；V246/V294已验证账本事实决定当前状态/POD/派次；空OPEN占位账本不算已分析，firstReportDate不再决定趋势日期或签收天数',
      regionTruth:'PP/PV来自当天最新VALID日报成员；PP/PV平均签收天数与总平均同源于V329真实START→POD样本'
    }
  };
}
export const readV245ShopeeTrends=readV244ShopeeTrends;
export const readV246ShopeeTrends=readV244ShopeeTrends;
export const readV247ShopeeTrends=readV244ShopeeTrends;

function handler(req,res){
  try{
    const includeRegions=String(req.query.regions??'1')!=='0';
    const exact=String(req.query.exact??'0')==='1';
    const data=readV247ShopeeTrends(req.query.businessType,req.query.from,req.query.to,{includeRegions,exact});
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-Shopee-Trend',V247_SHOPEE_TREND_ID);
    res.setHeader('X-CE-QC-Shopee-Regions',includeRegions?'included':'skipped');
    res.setHeader('X-CE-QC-V284',V284_DAILY_MEMBERSHIP_TRUTH_ID);
    res.setHeader('X-CE-QC-V294-Metric-Completeness',V294_METRIC_COMPLETENESS_ID);
    return res.json(data);
  }catch(error){return res.status(500).json({ok:false,readId:V247_SHOPEE_TREND_ID,error:error?.message||String(error)});}
}

express.application.get=function v284ShopeeTrendRoute(pathValue,...handlers){
  const path=String(pathValue||'');
  if(!routeRegistered&&path==='/api/v234/trends'){
    routeRegistered=true;
    previousGet.call(this,'/api/v247/shopee-trends',handler);
    previousGet.call(this,'/api/v246/shopee-trends',handler);
    previousGet.call(this,'/api/v245/shopee-trends',handler);
    previousGet.call(this,'/api/v244/shopee-trends',handler);
    console.info('[CE-QC][V294_SHOPEE]',V284_DAILY_MEMBERSHIP_TRUTH_ID,V294_METRIC_COMPLETENESS_ID,'registered daily-membership lifecycle metrics with strict V329 START-to-POD signing overlay.');
  }
  return previousGet.call(this,pathValue,...handlers);
};
