import express from 'express';
import { readV320HistoricalDaily, V320_HISTORICAL_DAILY_TRUTH_ID } from './v320HistoricalDailyTruth.js';

export const V319_TREND_CACHE_FAST_ID='2026-08-26-v320-history-first-trend-v2';
const previousGet=express.application.get;
let registered=false;

export function readV319TrendCacheFast(businessType='ALL',fromDate='',toDate='',db){
  return readV320HistoricalDaily(businessType,fromDate,toDate,{db,expandSingle:true});
}
function handler(req,res){
  try{
    const started=Date.now();
    const data=readV319TrendCacheFast(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=10');
    res.setHeader('X-CE-QC-V319',V319_TREND_CACHE_FAST_ID);
    res.setHeader('X-CE-QC-V320',V320_HISTORICAL_DAILY_TRUTH_ID);
    res.setHeader('Server-Timing',`v320history;dur=${Date.now()-started}`);
    return res.json(data);
  }catch(error){return res.status(400).json({ok:false,id:V319_TREND_CACHE_FAST_ID,error:error?.message||String(error)});}
}
function register(app){
  if(registered)return;registered=true;
  previousGet.call(app,'/api/v319/trends',handler);
  console.info('[CE-QC][V320_TREND_HISTORY_FIRST]',V319_TREND_CACHE_FAST_ID,'V319 endpoint now unions unified + legacy persisted history; a single selected day keeps current cards exact while trend consumers receive all saved dates through that day, without CE/evidence network work.');
}
express.application.get=function v320TrendHistoryFastRoute(pathValue,...handlers){if(!registered)register(this);return previousGet.call(this,pathValue,...handlers);};
