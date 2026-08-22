import { getDb } from './db.js';
import { readV236CurrentSummary } from './v236DashboardCurrentRead.js';

export const V237_DASHBOARD_TREND_READ_ID='2026-08-22-v237-exact-seven-day-trend-v1';
const STANDARD_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const TYPE_SET=new Set([...STANDARD_TYPES,'CCSL','SHOPEE','ALL','WHPP']);
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
function dateKey(value=''){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function datesForRange(from,to){
  const db=getDb();
  if(from===to)return db.prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? ORDER BY reportDate DESC LIMIT 7`).all(to).map(row=>String(row.reportDate||'')).filter(Boolean).sort();
  return db.prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC LIMIT 180`).all(from,to).map(row=>String(row.reportDate||'')).filter(Boolean);
}
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,returned:0,cancelled:0,unresolved:0,pending1:0,pending2:0,pending3:0,oc1:0,oc2:0,oc3:0,deliveryStay:0,attempt1:0,attempt2:0,attempt3:0,podRate:0,returnRate:0,pendingRate:0,deliveryRate:0,ocRate:0,firstRate:null,ready:false};}
function merge(type,date,rows=[]){
  const out=blank(type,date);const valid=rows.filter(Boolean);out.ready=valid.some(row=>row.ready);
  for(const row of valid){for(const key of ['total','pod','returned','cancelled','unresolved','pending1','pending2','pending3','oc1','oc2','oc3','deliveryStay','attempt1','attempt2','attempt3'])out[key]+=n(row[key]);}
  out.podRate=pct(out.pod,out.total);out.returnRate=pct(out.returned,out.total);out.pendingRate=pct(out.pending1,out.total);out.deliveryRate=pct(out.deliveryStay,out.total);out.ocRate=pct(out.oc1,out.total);
  const attempts=out.attempt1+out.attempt2+out.attempt3;out.firstRate=attempts>0?pct(out.attempt1,out.pod||attempts):null;return out;
}
function pick(summary,type,date){
  if(type==='WHPP')return summary.whpp||blank('WHPP',date);
  if(STANDARD_TYPES.includes(type))return summary.business?.[type]||blank(type,date);
  if(type==='CCSL')return merge('CCSL',date,['CE','CEAF','TBKH','ALI1688'].map(key=>summary.business?.[key]));
  if(type==='SHOPEE')return merge('SHOPEE',date,['SHOPEECN','SHOPEEVN'].map(key=>summary.business?.[key]));
  if(type==='ALL')return merge('ALL',date,[...STANDARD_TYPES.map(key=>summary.business?.[key]),summary.whpp]);
  return blank(type,date);
}
export function readV237DashboardTrends(businessType='ALL',fromDate='',toDate=''){
  const type=String(businessType||'ALL').toUpperCase();const to=dateKey(toDate),from=dateKey(fromDate)||to;
  if(!TYPE_SET.has(type))throw new Error('业务板块无效');
  if(!from||!to||from>to)throw new Error('日期范围无效');
  const dates=datesForRange(from,to),daily=[];
  for(const date of dates){const summary=readV236CurrentSummary(date);daily.push(pick(summary,type,date));}
  const value=(row,key)=>row?.ready?(row[key]===null||row[key]===undefined?null:n(row[key])):null;
  return{
    ok:true,readId:V237_DASHBOARD_TREND_READ_ID,businessType:type,requestedFromDate:from,requestedToDate:to,
    fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,
    ticket:daily.map(row=>value(row,'total')),pod:daily.map(row=>value(row,'pod')),podRate:daily.map(row=>value(row,'podRate')),
    returned:daily.map(row=>value(row,'returned')),returnRate:daily.map(row=>value(row,'returnRate')),
    pending1:daily.map(row=>value(row,'pending1')),pendingRate:daily.map(row=>value(row,'pendingRate')),
    delivering:daily.map(row=>value(row,'deliveryStay')),deliveringRate:daily.map(row=>value(row,'deliveryRate')),
    ocRate:daily.map(row=>value(row,'ocRate')),firstRate:daily.map(row=>value(row,'firstRate')),
    source:'V237_COMPLETED_SNAPSHOT_DIRECT_OR_EXACT_CACHE'
  };
}
