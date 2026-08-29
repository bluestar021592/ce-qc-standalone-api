import express from 'express';
import { getDb } from './db.js';
import { readV236CurrentSummary } from './v236DashboardCurrentRead.js';
import { readV284DashboardTrends } from './v284DailyMembershipTruth.js';
import { loadV351UnifiedWhppMembership } from './v351WhppUnifiedDashboardBridgePatch.js';

// Compatibility IDs and routes stay stable; implementation now uses one
// per-business source of truth for first paint.
export const V253_DASHBOARD_FAST_PATH_ID='2026-08-23-v259-scoped-dashboard-fastpath-v4';
export const V253_V335_FIRST_PAINT_ID='2026-08-27-v335-per-business-first-paint-v1';
const TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP','CCSL','SHOPEE','ALL']);
const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];
const memory=new Map();
const CACHE_MS=10_000;
const previousGet=express.application.get;
let registered=false;
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
const dateKey=value=>{const s=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,ocCurrent:0,sameDayPod:0,podRate:0,ocRate:0,sameDayPodRate:0,ready:false,matched:0};}
function finish(row){const out={...blank(row?.businessType||'',row?.reportDate||''),...(row||{})};out.total=n(out.total);out.pod=n(out.pod);out.ocCurrent=n(out.ocCurrent);out.sameDayPod=n(out.sameDayPod);out.matched=n(out.matched||out.total);out.podRate=pct(out.pod,out.total);out.ocRate=pct(out.ocCurrent,out.total);out.sameDayPodRate=pct(out.sameDayPod,out.total);out.ready=out.ready!==false&&(out.total===0||out.matched>=out.total);return out;}
function merge(type,date,parts=[]){const out=blank(type,date),valid=parts.filter(Boolean);for(const row of valid){out.total+=n(row.total);out.pod+=n(row.pod);out.ocCurrent+=n(row.ocCurrent);out.sameDayPod+=n(row.sameDayPod);out.matched+=n(row.matched||row.total);}out.ready=valid.length>0&&valid.every(row=>row.ready!==false);return finish(out);}
function latestDate(requested=''){const explicit=dateKey(requested);if(explicit)return explicit;try{return dateKey(getDb().prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,batchId DESC LIMIT 1").get()?.reportDate);}catch{return'';}}
function currentMetric(type,date,summary){if(type==='WHPP')return finish({...summary.whpp,businessType:'WHPP',reportDate:date,matched:n(summary.whpp?.total)});if(CCSL_TYPES.includes(type)||SHOPEE_TYPES.includes(type))return finish({...summary.business?.[type],businessType:type,reportDate:date,matched:n(summary.business?.[type]?.total)});if(type==='CCSL')return merge('CCSL',date,CCSL_TYPES.map(t=>currentMetric(t,date,summary)));if(type==='SHOPEE')return merge('SHOPEE',date,SHOPEE_TYPES.map(t=>currentMetric(t,date,summary)));return merge('ALL',date,[...CCSL_TYPES.map(t=>currentMetric(t,date,summary)),...SHOPEE_TYPES.map(t=>currentMetric(t,date,summary)),currentMetric('WHPP',date,summary)]);}
function trendPayload(type,from,to,daily,source){const dates=daily.map(r=>r.reportDate);const value=(row,key)=>row?.ready!==false?n(row[key]):null;return{ok:true,readId:V253_DASHBOARD_FAST_PATH_ID,v335Id:V253_V335_FIRST_PAINT_ID,businessType:type,requestedFromDate:from,requestedToDate:to,fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,ticket:daily.map(r=>value(r,'total')),pod:daily.map(r=>value(r,'pod')),podRate:daily.map(r=>rowValue(r,'podRate')),oc:daily.map(r=>value(r,'ocCurrent')),ocRate:daily.map(r=>rowValue(r,'ocRate')),sameDayPod:daily.map(r=>value(r,'sameDayPod')),sameDayPodRate:daily.map(r=>rowValue(r,'sameDayPodRate')),missingDates:daily.filter(r=>r.ready===false).map(r=>r.reportDate),source,definitions:{podRate:'POD/当日总票',ocRate:'当前真实OC/当日总票',sameDayPodRate:'首日报当日完成POD/当日总票',owner:'快速首屏使用各业务独立日报成员；完整历史由持久化历史读取'}};}
const rowValue=(row,key)=>row?.ready!==false?(row?.[key]??null):null;

export function readV253DashboardTrends(businessType='ALL',fromDate='',toDate=''){
  const type=String(businessType||'ALL').toUpperCase(),to=latestDate(toDate),from=dateKey(fromDate)||to;if(!TYPES.has(type))throw new Error('业务板块无效');if(!from||!to||from>to)throw new Error('日期范围无效');const key=`T|${type}|${from}|${to}`,hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return{...hit.value,memoryCacheHit:true};
  let result;
  if(from===to){const summary=readV236CurrentSummary(to);const row=currentMetric(type,to,summary);result=trendPayload(type,from,to,[row],'PER_BUSINESS_SINGLE_DAY_FIRST_PAINT_NO_HISTORY_SCAN');}
  else{const canonical=readV284DashboardTrends(type,from,to);const daily=(canonical.daily||[]).filter(row=>n(row.total)>0).map(row=>finish(row));result=trendPayload(type,from,to,daily,'PER_BUSINESS_EXPLICIT_RANGE');result.canonicalTruthId=canonical.id;}
  memory.set(key,{at:Date.now(),value:result});return result;
}
function latestBatchForType(date,type,db=getDb()){if(!date||!CCSL_TYPES.concat(SHOPEE_TYPES).includes(type))return null;return db.prepare(`SELECT b.snapshotId,b.reportDate FROM unified_import_batches b WHERE b.status='VALID' AND b.reportDate=? AND EXISTS(SELECT 1 FROM unified_import_rows u WHERE u.snapshotId=b.snapshotId AND u.reportDate=b.reportDate AND UPPER(TRIM(u.businessType))=? AND TRIM(COALESCE(u.shipmentCode,''))<>'') ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(date,type)||null;}
export function readV253ShopeeRegion(type,date){const businessType=String(type||'').toUpperCase(),reportDate=latestDate(date);if(!SHOPEE_TYPES.includes(businessType)||!reportDate)throw new Error('Shopee区域参数无效');const key=`R|${businessType}|${reportDate}`,hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;const summary=readV236CurrentSummary(reportDate),metric=summary.business?.[businessType]||{},regions={};for(const code of ['PP','PV','UNKNOWN']){const src=metric.regions?.[code];if(!src)continue;regions[code]={...src,total:n(src.total),pod:n(src.pod),attempt1:n(src.attempt1),attempt2:n(src.attempt2),attempt3:n(src.attempt3),attemptUnknown:Math.max(0,n(src.pod)-n(src.attempt1)-n(src.attempt2)-n(src.attempt3)),attemptCoverageRate:n(src.pod)?pct(n(src.attempt1)+n(src.attempt2)+n(src.attempt3),src.pod):null};}const result={ok:true,readId:V253_DASHBOARD_FAST_PATH_ID,v335Id:V253_V335_FIRST_PAINT_ID,businessType,fromDate:reportDate,toDate:reportDate,dates:[reportDate],daily:[{reportDate,regions,ledgerReady:metric.ready!==false}],regionsIncluded:true,exact:true,source:'PER_BUSINESS_CURRENT_REGION'};memory.set(key,{at:Date.now(),value:result});return result;}
function whppCount(date,db=getDb()){
  let daily=null;
  try{daily=db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date)||null;}catch{}
  let count=0,expected=null,actual=0,membershipSource='NO_SAFE_WHPP_MEMBERSHIP',directStandard=false;
  if(daily){
    directStandard=true;
    expected=n(daily.totalCount);
    actual=n(db.prepare("SELECT COUNT(DISTINCT shipmentCode) c FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''").get(date)?.c);
    if(expected===actual){count=actual;membershipSource=actual===0?'WHPP_STANDARD_DAILY_ZERO':'WHPP_STANDARD_DAILY';}
    else{
      const error=new Error(`WHPP标准日报成员不完整：日报头${expected}票，成员${actual}票`);
      error.code='WHPP_STANDARD_DAILY_INCOMPLETE';
      error.expected=expected;
      error.actual=actual;
      throw error;
    }
  }else{
    const fallback=loadV351UnifiedWhppMembership(date,db);
    const members=Array.isArray(fallback?.rows)?fallback.rows:[];
    count=members.length;
    actual=count;
    membershipSource=fallback?.membershipSource||(count?'V351_SAFE_HISTORY_DISASTER_FALLBACK':'NO_SAFE_WHPP_MEMBERSHIP');
  }
  const ceaf=latestBatchForType(date,'CEAF',db);
  const overlap=ceaf&&count?n(db.prepare(`SELECT COUNT(DISTINCT u.shipmentCode) c FROM unified_import_rows u WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType='CEAF' AND EXISTS(SELECT 1 FROM business_daily_parse_rows p WHERE p.businessType='WHPP' AND p.reportDate=? AND UPPER(TRIM(p.shipmentCode))=UPPER(TRIM(u.shipmentCode)))`).get(ceaf.snapshotId,date,date)?.c):0;
  return{count,raw:count,overlap,membershipSource,expected,actual,incomplete:false,directStandard};
}
export function readV253InstantSummary(requestedDate=''){const date=latestDate(requestedDate);if(!date)return{ok:true,patchId:V253_DASHBOARD_FAST_PATH_ID,v335Id:V253_V335_FIRST_PAINT_ID,reportDate:'',counts:{},total:0,shopeeWhpp:{}};const key=`I|${date}`,hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return{...hit.value,cacheHit:true};const summary=readV236CurrentSummary(date),counts=Object.fromEntries(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].map(type=>[type,n(summary.business?.[type]?.total)])),whpp=whppCount(date);counts.WHPP=whpp.count;const total=Object.values(counts).reduce((sum,value)=>sum+n(value),0);const result={ok:true,patchId:V253_DASHBOARD_FAST_PATH_ID,v335Id:V253_V335_FIRST_PAINT_ID,reportDate:date,snapshotIds:summary.snapshotIds||{},counts,total,shopeeWhpp:{},sourceCorrection:{removedFromWhpp:0,ceafOverlapDiagnostic:whpp.overlap,rawWhpp:whpp.raw,membershipSource:whpp.membershipSource,whppExpected:whpp.expected,whppActual:whpp.actual,whppMembershipIncomplete:whpp.incomplete,whppDirectStandard:whpp.directStandard,reason:'WHPP优先读取独立标准日报完整成员；日报头存在但成员不完整时拒绝首屏响应；仅日报头缺失才使用V351灾备；CEAF重叠只诊断不扣减。'},source:'PER_BUSINESS_LATEST_VALID_FIRST_PAINT',generatedAt:new Date().toISOString(),cacheHit:false};memory.set(key,{at:Date.now(),value:result});return result;}
function register(app){if(registered)return;registered=true;previousGet.call(app,'/api/v253/trends',(req,res)=>{try{const data=readV253DashboardTrends(req.query.businessType,req.query.from,req.query.to);res.setHeader('Cache-Control','private,max-age=5');res.setHeader('X-CE-QC-V253',V253_DASHBOARD_FAST_PATH_ID);res.setHeader('X-CE-QC-V335',V253_V335_FIRST_PAINT_ID);res.json(data);}catch(error){res.status(500).json({ok:false,error:error?.message||String(error),readId:V253_DASHBOARD_FAST_PATH_ID});}});previousGet.call(app,'/api/v253/instant-dashboard',(req,res)=>{try{const data=readV253InstantSummary(req.query.date||req.query.reportDate||'');res.setHeader('Cache-Control','private,max-age=5');res.setHeader('X-CE-QC-V253',V253_DASHBOARD_FAST_PATH_ID);res.setHeader('X-CE-QC-V335',V253_V335_FIRST_PAINT_ID);res.json(data);}catch(error){res.status(error?.code==='WHPP_STANDARD_DAILY_INCOMPLETE'?409:500).json({ok:false,code:error?.code||'V253_INSTANT_DASHBOARD_FAILED',error:error?.message||String(error),expected:error?.expected??null,actual:error?.actual??null,readId:V253_DASHBOARD_FAST_PATH_ID});}});previousGet.call(app,'/api/v253/shopee-region',(req,res)=>{try{const data=readV253ShopeeRegion(req.query.businessType,req.query.date||req.query.to);res.setHeader('Cache-Control','private,max-age=5');res.setHeader('X-CE-QC-V253',V253_DASHBOARD_FAST_PATH_ID);res.setHeader('X-CE-QC-V335',V253_V335_FIRST_PAINT_ID);res.json(data);}catch(error){res.status(500).json({ok:false,error:error?.message||String(error),readId:V253_DASHBOARD_FAST_PATH_ID});}});console.info('[CE-QC][V253]',V253_DASHBOARD_FAST_PATH_ID,V253_V335_FIRST_PAINT_ID,'registered per-business first paint with direct WHPP standard membership truth and V351 disaster fallback.');}
express.application.get=function v253DashboardFastPathGet(pathValue,...handlers){const path=String(pathValue||'');if(!registered&&path==='/api/v234/trends')register(this);return previousGet.call(this,pathValue,...handlers);};