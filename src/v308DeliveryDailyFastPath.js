import express from 'express';
import { getDb } from './db.js';
import { readV320HistoricalDailyWithDispatch } from './v320DispatchMetricOverlay.js';
import { V320_HISTORICAL_DAILY_TRUTH_ID } from './v320HistoricalDailyTruth.js';

export const V308_DELIVERY_DAILY_FAST_ID='2026-08-26-v320-shopee-history-dispatch-overlay-v3';
const TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const previousGet=express.application.get;
let registered=false;

export function readV308DeliveryDaily(businessType='',fromDate='',toDate='',db=getDb()){
  const type=String(businessType||'').toUpperCase();
  if(!TYPES.has(type))throw new Error('V320每日派次明细仅支持TBKH、SHOPEECN、SHOPEEVN');
  const data=readV320HistoricalDailyWithDispatch(type,fromDate,toDate,{db,expandSingle:true});
  const daily=(data.daily||[]).map(row=>({
    ...row,
    ledgerReady:row.ready!==false,
    podKnown:Number(row.pod||0),
    ocKnown:Number(row.ocCurrent||0),
    attempt1Known:Number(row.attempt1||0),
    attempt2Known:Number(row.attempt2||0),
    attempt3Known:Number(row.attempt3||0),
    signingDaysCount:Number(row.dispatchSigningDaysCount||0),
    signingDaysSum:Number(row.dispatchSigningDaysSum||0),
    avgSigningDays:row.avgDispatchSigningDays,
    avgDispatchSigningDays:row.avgDispatchSigningDays,
    signingSampleCount:Number(row.dispatchSigningDaysCount||0),
    evidenceIncomplete:!row.evidenceComplete||!row.attemptEvidenceComplete||!row.signingEvidenceComplete
  }));
  return{
    ...data,
    id:V308_DELIVERY_DAILY_FAST_ID,
    truthId:V320_HISTORICAL_DAILY_TRUTH_ID,
    daily,
    avgSigningDays:daily.map(r=>r.avgDispatchSigningDays),
    avgDispatchSigningDays:daily.map(r=>r.avgDispatchSigningDays),
    attempt1:daily.map(r=>r.attempt1),attempt2:daily.map(r=>r.attempt2),attempt3:daily.map(r=>r.attempt3),
    attempt1Rate:daily.map(r=>r.pod?Number((r.attempt1*100/r.pod).toFixed(2)):null),
    attempt2Rate:daily.map(r=>r.pod?Number((r.attempt2*100/r.pod).toFixed(2)):null),
    attempt3Rate:daily.map(r=>r.pod?Number((r.attempt3*100/r.pod).toFixed(2)):null),
    attemptCoverageRate:daily.map(r=>r.attemptCoverageRate),
    signingCoverageRate:daily.map(r=>r.signingCoverageRate),
    signingSampleCount:daily.map(r=>r.signingSampleCount),
    evidenceIncomplete:daily.some(r=>r.evidenceIncomplete),
    source:'V320_PERSISTED_HISTORY + SAVED_STRICT_LEDGER_DISPATCH + REAL_DISPATCH_START_TO_POD_SAMPLE_AVERAGE',
    definitions:{
      history:'若顶部开始=结束日期，当前卡片仍是该日，但每日派次/签收明细自动读取截至该日的全部已保存历史日报（最多180日）；自定义多日范围则严格按范围。',
      attempts:'1/2/3派只统计已保存的真实派次证据；未知POD单独列出，不再把已识别派次整列隐藏。',
      averageDays:'平均派件→签收天数只使用同时有真实首次派件START和真实POD日期的票，按自然日计算、同日=1天；缺证据票排除出平均值并显示样本数，不再要求100%覆盖才显示。',
      readPolicy:'页面读取只读SQLite历史日报/快照/最终结果/严格证据账本，不调用CE接口；缺失证据由后台独立补核。'
    }
  };
}
function handler(req,res){
  try{
    const started=Date.now(),data=readV308DeliveryDaily(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-V308',V308_DELIVERY_DAILY_FAST_ID);
    res.setHeader('X-CE-QC-V320',V320_HISTORICAL_DAILY_TRUTH_ID);
    res.setHeader('Server-Timing',`v320daily;dur=${Date.now()-started}`);
    return res.json(data);
  }catch(error){return res.status(400).json({ok:false,id:V308_DELIVERY_DAILY_FAST_ID,error:error?.message||String(error)});}
}
function register(app){
  if(registered)return;registered=true;
  previousGet.call(app,'/api/v308/delivery-daily',handler);
  console.info('[CE-QC][V320_DELIVERY_DAILY]',V308_DELIVERY_DAILY_FAST_ID,'daily Shopee history overlays saved strict ledger starts/attempts; average days means real dispatch START→POD sample average, never coverage percentage.');
}
express.application.get=function v320DeliveryDailyRoute(pathValue,...handlers){if(!registered&&String(pathValue||'')==='/api/v234/trends')register(this);return previousGet.call(this,pathValue,...handlers);};
