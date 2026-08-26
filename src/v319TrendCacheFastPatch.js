import express from 'express';
import './v320EvidenceAutoBackfill.js';
import { readV320HistoricalDailyWithDispatch } from './v320DispatchMetricOverlay.js';
import { V320_HISTORICAL_DAILY_TRUTH_ID } from './v320HistoricalDailyTruth.js';

export const V319_TREND_CACHE_FAST_ID='2026-08-26-v321-exact-range-availability-first-v1';
const previousGet=express.application.get;
let registered=false;

export function readV319TrendCacheFast(businessType='ALL',fromDate='',toDate='',db){
  return readV320HistoricalDailyWithDispatch(businessType,fromDate,toDate,{db,expandSingle:false});
}
function handler(req,res){
  try{
    const started=Date.now();
    const data=readV319TrendCacheFast(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-V319',V319_TREND_CACHE_FAST_ID);
    res.setHeader('X-CE-QC-V320',V320_HISTORICAL_DAILY_TRUTH_ID);
    res.setHeader('X-CE-QC-V321','EXACT_RANGE_NO_IMPLICIT_HISTORY_EXPANSION');
    res.setHeader('Server-Timing',`v321exact;dur=${Date.now()-started}`);
    return res.json(data);
  }catch(error){return res.status(400).json({ok:false,id:V319_TREND_CACHE_FAST_ID,error:error?.message||String(error)});}
}
function register(app){
  if(registered)return;registered=true;
  previousGet.call(app,'/api/v319/trends',handler);
  console.info('[CE-QC][V321_TREND_AVAILABILITY_FIRST]',V319_TREND_CACHE_FAST_ID,'trend endpoint reads only the exact user-selected date range; selecting one day never expands into a full-history synchronous SQLite scan.');
}
express.application.get=function v321TrendAvailabilityRoute(pathValue,...handlers){if(!registered)register(this);return previousGet.call(this,pathValue,...handlers);};
