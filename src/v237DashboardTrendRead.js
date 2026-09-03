import { getDb } from './db.js';
import { readV236CurrentSummary } from './v236DashboardCurrentRead.js';
import { readV284ProvenDailyFacts } from './v284MembershipEvidenceCoverage.js';
import { mergeV293WhppHistoricalRange } from './v293WhppHistoricalRangeTruth.js';

export const V237_DASHBOARD_TREND_READ_ID='2026-08-23-v240-daily-rate-contract-v1';
export const V419_WHPP_TREND_TRUTH_ID='2026-09-03-v419-whpp-ledger-history-trend-truth-v1';
const STANDARD_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const TYPE_SET=new Set([...STANDARD_TYPES,'CCSL','SHOPEE','ALL','WHPP']);
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
function dateKey(value=''){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function datesForRange(from,to){const db=getDb();if(from===to)return db.prepare("SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? ORDER BY reportDate DESC LIMIT 7").all(to).map(row=>String(row.reportDate||'')).filter(Boolean).sort();return db.prepare("SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC LIMIT 180").all(from,to).map(row=>String(row.reportDate||'')).filter(Boolean);}
function whppDatesForRange(from,to,db=getDb()){
  if(from===to)return db.prepare("SELECT DISTINCT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND reportDate<=? ORDER BY reportDate DESC LIMIT 7").all(to).map(row=>String(row.reportDate||'')).filter(Boolean).sort();
  return db.prepare("SELECT DISTINCT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC LIMIT 180").all(from,to).map(row=>String(row.reportDate||'')).filter(Boolean);
}
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,returned:0,cancelled:0,unresolved:0,sameDayPod:0,pending1:0,pending2:0,pending3:0,ocCurrent:0,oc1:0,oc2:0,oc3:0,deliveryStay:0,attempt1:0,attempt2:0,attempt3:0,podRate:0,returnRate:0,pendingRate:0,deliveryRate:0,ocRate:0,sameDayPodRate:0,firstRate:null,ready:false};}
function merge(type,date,rows=[]){const out=blank(type,date),valid=rows.filter(Boolean);out.ready=valid.length>0&&valid.every(row=>row.ready);for(const row of valid){for(const key of ['total','pod','returned','cancelled','unresolved','sameDayPod','pending1','pending2','pending3','ocCurrent','oc1','oc2','oc3','deliveryStay','attempt1','attempt2','attempt3'])out[key]+=n(row[key]);}out.podRate=pct(out.pod,out.total);out.returnRate=pct(out.returned,out.total);out.pendingRate=pct(out.pending1,out.total);out.deliveryRate=pct(out.deliveryStay,out.total);out.ocRate=pct(out.ocCurrent,out.total);out.sameDayPodRate=pct(out.sameDayPod,out.total);const attempts=out.attempt1+out.attempt2+out.attempt3;out.firstRate=attempts>0?pct(out.attempt1,out.pod||attempts):null;return out;}
function pick(summary,type,date){if(type==='WHPP')return summary.whpp||blank('WHPP',date);if(STANDARD_TYPES.includes(type))return summary.business?.[type]||blank(type,date);if(type==='CCSL')return merge('CCSL',date,['CE','CEAF','TBKH','ALI1688'].map(key=>summary.business?.[key]));if(type==='SHOPEE')return merge('SHOPEE',date,['SHOPEECN','SHOPEEVN'].map(key=>summary.business?.[key]));if(type==='ALL')return merge('ALL',date,[...STANDARD_TYPES.map(key=>summary.business?.[key]),summary.whpp]);return blank(type,date);}
function normalizeWhppTrendFact(row,date){
  if(!row)return blank('WHPP',date);
  const out={...blank('WHPP',date),...row,businessType:'WHPP',reportDate:date};
  out.deliveryStay=n(row.deliveryStay??row.delivery);
  out.podRate=Number.isFinite(Number(row.podRate))?Number(row.podRate):pct(out.pod,out.total);
  out.returnRate=pct(out.returned,out.total);
  out.pendingRate=pct(out.pending1,out.total);
  out.deliveryRate=pct(out.deliveryStay,out.total);
  out.ocRate=Number.isFinite(Number(row.ocRate))?Number(row.ocRate):pct(out.ocCurrent,out.total);
  out.sameDayPodRate=Number.isFinite(Number(row.sameDayPodRate))?Number(row.sameDayPodRate):pct(out.sameDayPod,out.total);
  const attempts=n(out.attempt1)+n(out.attempt2)+n(out.attempt3);
  out.firstRate=attempts>0?pct(out.attempt1,out.pod||attempts):null;
  out.ready=row.ready===true||n(row.total)===0;
  out.whppTrendTruthId=V419_WHPP_TREND_TRUTH_ID;
  return out;
}
function readWhppTrendDaily(dates=[],db=getDb()){
  if(!dates.length)return[];
  const from=dates[0],to=dates.at(-1);
  const canonical=readV284ProvenDailyFacts(from,to,db).filter(row=>String(row?.businessType||'').toUpperCase()==='WHPP'&&dates.includes(String(row.reportDate||'')));
  const merged=mergeV293WhppHistoricalRange(canonical,from,to,db);
  const byDate=new Map(merged.map(row=>[String(row.reportDate||''),row]));
  return dates.map(date=>normalizeWhppTrendFact(byDate.get(date),date));
}
export function readV237DashboardTrends(businessType='ALL',fromDate='',toDate=''){
  const type=String(businessType||'ALL').toUpperCase(),to=dateKey(toDate),from=dateKey(fromDate)||to;if(!TYPE_SET.has(type))throw new Error('业务板块无效');if(!from||!to||from>to)throw new Error('日期范围无效');
  const dates=type==='WHPP'?whppDatesForRange(from,to):datesForRange(from,to);
  const daily=type==='WHPP'?readWhppTrendDaily(dates):[];
  if(type!=='WHPP')for(const date of dates){const summary=readV236CurrentSummary(date,{cacheOnly:true});daily.push(pick(summary,type,date));}
  const value=(row,key)=>row?.ready?(row[key]===null||row[key]===undefined?null:n(row[key])):null;
  return{ok:true,readId:V237_DASHBOARD_TREND_READ_ID,whppTrendTruthId:type==='WHPP'?V419_WHPP_TREND_TRUTH_ID:'',businessType:type,requestedFromDate:from,requestedToDate:to,fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,
    ticket:daily.map(row=>value(row,'total')),pod:daily.map(row=>value(row,'pod')),podRate:daily.map(row=>value(row,'podRate')),returned:daily.map(row=>value(row,'returned')),returnRate:daily.map(row=>value(row,'returnRate')),pending1:daily.map(row=>value(row,'pending1')),pendingRate:daily.map(row=>value(row,'pendingRate')),delivering:daily.map(row=>value(row,'deliveryStay')),deliveringRate:daily.map(row=>value(row,'deliveryRate')),oc:daily.map(row=>value(row,'ocCurrent')),ocRate:daily.map(row=>value(row,'ocRate')),sameDayPod:daily.map(row=>value(row,'sameDayPod')),sameDayPodRate:daily.map(row=>value(row,'sameDayPodRate')),firstRate:daily.map(row=>value(row,'firstRate')),source:type==='WHPP'?'V419_WHPP_DAILY_LEDGER_MEMBERSHIP_PLUS_VERIFIED_HISTORY':'V240_EXACT_DAILY_RATE_CACHE_ONLY',definitions:{podRate:'POD/当日总票',ocRate:'当日当前OC票数/当日总票',sameDayPodRate:'首日完成POD票数/当日总票',attemptRates:'仅使用真实派次证据，独立于首日POD妥投率'},missingDates:daily.filter(row=>!row.ready).map(row=>row.reportDate)};
}
