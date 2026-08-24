import express from 'express';
import {
  V284_DAILY_MEMBERSHIP_TRUTH_ID,
  readV284ShopeeTrends
} from './v284DailyMembershipTruth.js';

// Historical export names remain stable for the browser and old code, but V284
// replaces the old firstReportDate cohort with exact daily latest-VALID membership.
export const V244_SHOPEE_TREND_ID = V284_DAILY_MEMBERSHIP_TRUTH_ID;
export const V245_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
export const V246_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
export const V247_SHOPEE_TREND_ID = V244_SHOPEE_TREND_ID;
const previousGet=express.application.get;
let routeRegistered=false;

function legacyCoverage(row={}){
  const pod=Number(row.pod||0);
  const known=Number(row.attempt1||0)+Number(row.attempt2||0)+Number(row.attempt3||0);
  const attemptUnknown=Math.max(Number(row.attemptUnknown||0),Math.max(0,pod-known));
  const signingDaysCount=Number(row.signingDaysCount||row.podDaysCount||0);
  const signingDaysSum=Number(row.signingDaysSum||row.podDaysSum||0);
  const regions={};
  for(const [key,value] of Object.entries(row.regions||{})) regions[key]=legacyCoverage({...value,regions:{}});
  return {
    ...row,
    regions,
    podDaysCount:signingDaysCount,
    podDaysSum:signingDaysSum,
    attemptEvidenceCount:Math.min(pod,known),
    attemptUnknown,
    attemptEvidenceComplete:pod>0&&attemptUnknown===0
  };
}

export function readV244ShopeeTrends(businessType='SHOPEECN',fromDate='',toDate='',options={}) {
  const result=readV284ShopeeTrends(businessType,fromDate,toDate,options);
  const daily=(result.daily||[]).map(legacyCoverage);
  return {
    ...result,
    daily,
    readId:V247_SHOPEE_TREND_ID,
    definitions:{
      podRate:'V284当天最新VALID日报成员中的当前POD/当日成员总票；状态以V246账本优先，旧final仅缺失回退',
      ocRate:'V284当天日报成员中的当前真实OC/当日成员总票',
      avgPodDays:'签收天数沿用V246锁定首次日报日期到实际POD日期，含首尾当天',
      attemptRate:'真实派次证据对应已POD票数/当日POD；无证据显示—，未识别POD单独列出',
      trackingLedger:'日报成员决定分母；V246账本决定当前状态/POD/派次，firstReportDate不再决定趋势日期',
      regionTruth:'PP/PV来自当天最新VALID日报成员，状态仍以V246账本为权威'
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
    console.info('[CE-QC][V284_SHOPEE]',V284_DAILY_MEMBERSHIP_TRUTH_ID,'registered daily-membership lifecycle metrics with optional exact PP/PV truth + legacy coverage aliases.');
  }
  return previousGet.call(this,pathValue,...handlers);
};
