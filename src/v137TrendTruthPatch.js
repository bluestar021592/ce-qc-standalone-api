import express from 'express';
import { getDb } from './db.js';

export const V137_TREND_TRUTH_ID='2026-08-15-v138-seven-business-range-trends-cache-v2';
const TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP','CCSL','SHOPEE','TOTAL']);
const CORE=new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE=new Set(['SHOPEECN','SHOPEEVN']);
const CACHE_TTL_MS=15_000;
const trendCache=new Map();

function dateOnly(value=''){const v=String(value||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';}
function safe(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return {};}}
function num(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function nullableNum(...values){for(const value of values){if(value===null||value===undefined||value==='')continue;const n=Number(value);if(Number.isFinite(n))return n;}return null;}
function rate(n,d){return d?Number((num(n)*100/num(d)).toFixed(2)):0;}
function clampAttempt(value){const n=Math.trunc(num(value));return n>0?Math.max(1,Math.min(3,n)):0;}

function completedDates(fromDate,toDate){
  const db=getDb();
  const single=fromDate===toDate;
  const rows=single?db.prepare(`
    SELECT DISTINCT b.reportDate FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    WHERE b.status='VALID' AND b.reportDate<=? ORDER BY b.reportDate DESC LIMIT 7
  `).all(toDate):db.prepare(`
    SELECT DISTINCT b.reportDate FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ? ORDER BY b.reportDate
    LIMIT 180
  `).all(fromDate,toDate);
  return rows.map(row=>String(row.reportDate||'')).filter(Boolean).sort();
}

function sourceRows(fromDate,toDate){
  return getDb().prepare(`
    WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
        ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ), latest AS (SELECT reportDate,snapshotId FROM ranked WHERE rn=1),
    valid AS (
      SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode
      FROM latest l INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP')
    )
    SELECT v.reportDate,v.businessType,v.shipmentCode,
      COALESCE(bf.isPod,cf.isPod,0) finalIsPod,
      COALESCE(bf.primaryCategory,cf.primaryCategory,'') finalCategory,
      COALESCE(bf.rawJson,cf.rawJson,'{}') finalJson,
      COALESCE(c.state,'') currentState,COALESCE(c.stateJson,'{}') currentJson
    FROM valid v
    LEFT JOIN final_rows cf
      ON v.businessType IN ('CE','CEAF','TBKH','ALI1688') AND cf.shipmentCode=v.shipmentCode AND cf.reportDate=v.reportDate
    LEFT JOIN business_final_rows bf
      ON bf.shipmentCode=v.shipmentCode AND bf.reportDate=v.reportDate
     AND ((v.businessType IN ('SHOPEECN','SHOPEEVN') AND bf.businessType='SHOPEE') OR (v.businessType='WHPP' AND bf.businessType='WHPP'))
    LEFT JOIN shipment_current_state c ON c.shipmentCode=v.shipmentCode
    ORDER BY v.reportDate,v.businessType,v.shipmentCode
  `).all(fromDate,toDate);
}

function terminalTruth(row={}){
  const state=String(row.currentState||row.state||'').toUpperCase();
  const cat=String(row.primaryCategory||row.主分类||row.异常分类||'').toUpperCase();
  const order=String(row.orderStatus??row.scanOrderStatus??'').trim();
  if(Number(row.isPod||0)===1||row.是否POD==='是'||row.POD状态==='POD'||order==='85'||state==='POD')return 'POD';
  if(order==='100'||row.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(state)||cat==='退回')return 'RETURNED';
  if(order==='10'||row.订单取消==='是'||row.取消状态==='已取消'||state==='ORDER_CANCELLED'||/订单取消|CANCEL/.test(cat))return 'CANCELLED';
  if(['SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','CCSL580_RETENTION','CECN_RETENTION','CEZT_RETENTION','NORMAL_FINAL','NORMAL_FINAL_HUB'].includes(state)||/SELF_PICKUP|CCSLCN_DIVERSION|CCSLZT_DIVERSION|580_RETENTION|580_DIVERSION|CECN_RETENTION|CEZT_RETENTION|正常闭环/.test(cat))return 'NORMAL';
  return '';
}

function attemptOf(reportDate,merged){
  let attempt=clampAttempt(nullableNum(merged.podAttemptNo,merged.currentAttemptNo,merged.dispatchAttemptNo,merged.POD派次));
  if(attempt)return attempt;
  const stamp=String(merged.POD时间||merged.podTime||merged.podClosedAt||merged.terminalObservedAt||merged.latestEventTime||'').slice(0,10).replaceAll('/','-');
  if(/^\d{4}-\d{2}-\d{2}$/.test(stamp)){
    const start=Date.parse(`${reportDate}T00:00:00Z`),end=Date.parse(`${stamp}T00:00:00Z`);
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start)attempt=clampAttempt(Math.floor((end-start)/86400000)+1);
  }
  return attempt;
}

function decorate(row){
  const final={...safe(row.finalJson),primaryCategory:row.finalCategory,isPod:row.finalIsPod};
  const current={...safe(row.currentJson),currentState:row.currentState};
  const currentTerminal=terminalTruth(current);
  const finalTerminal=terminalTruth(final);
  const terminal=currentTerminal||finalTerminal;
  const merged={...final,...current};
  const pod=terminal==='POD'||(!terminal&&Number(row.finalIsPod||0)===1);
  const closed=Boolean(terminal);
  const ocDays=closed?0:num(nullableNum(current.OC天数,current.ocDays,final.OC天数,final.ocDays));
  const attempt=pod?attemptOf(row.reportDate,merged):0;
  return {...row,pod,closed,terminal,ocDays,attempt,attemptUnknown:pod&&!attempt?1:0};
}

function inScope(type,businessType){
  if(type==='TOTAL')return true;
  if(type==='CCSL')return CORE.has(businessType);
  if(type==='SHOPEE')return SHOPEE.has(businessType);
  return type===businessType;
}

function build(type,dates,rows){
  const byDate=new Map(dates.map(date=>[date,{total:0,pod:0,oc1:0,a1:0,a2:0,a3:0,unknown:0}]));
  for(const row of rows){if(!inScope(type,row.businessType)||!byDate.has(row.reportDate))continue;const d=byDate.get(row.reportDate);d.total++;if(row.pod)d.pod++;if(!row.closed&&row.ocDays>=1)d.oc1++;if(row.attempt===1)d.a1++;else if(row.attempt===2)d.a2++;else if(row.attempt>=3)d.a3++;d.unknown+=row.attemptUnknown;}
  const ticket=[],podRate=[],ocRate=[],firstRate=[],attempt1=[],attempt2=[],attempt3=[],attempt1Count=[],attempt2Count=[],attempt3Count=[],attemptDenominator=[],attemptUnknownPod=[];
  for(const date of dates){const d=byDate.get(date);ticket.push(d.total);podRate.push(rate(d.pod,d.total));ocRate.push(rate(d.oc1,d.total));const trustworthy=d.unknown===0;firstRate.push(trustworthy?rate(d.a1,d.total):null);attempt1.push(trustworthy?rate(d.a1,d.total):null);attempt2.push(trustworthy?rate(d.a2,d.total):null);attempt3.push(trustworthy?rate(d.a3,d.total):null);attempt1Count.push(d.a1);attempt2Count.push(d.a2);attempt3Count.push(d.a3);attemptDenominator.push(d.total);attemptUnknownPod.push(d.unknown);}
  return {dates,ticket,podRate,ocRate,firstRate,attempt1,attempt2,attempt3,attempt1Count,attempt2Count,attempt3Count,attemptDenominator,attemptUnknownPod};
}

function cacheEntry(from,to,dates){
  const actualFrom=dates[0],actualTo=dates.at(-1);
  const key=`${actualFrom}|${actualTo}|${dates.join(',')}`;
  const cached=trendCache.get(key);
  if(cached&&Date.now()-cached.at<CACHE_TTL_MS)return {...cached,cacheHit:true};
  const rows=sourceRows(actualFrom,actualTo).map(decorate);
  const byType={};
  for(const type of TYPES)byType[type]=build(type,dates,rows);
  if(trendCache.size>6)trendCache.clear();
  const entry={at:Date.now(),actualFrom,actualTo,byType,rowCount:rows.length};
  trendCache.set(key,entry);
  return {...entry,cacheHit:false};
}

function handler(req,res){
  try{
    const type=String(req.query.businessType||'TOTAL').trim().toUpperCase();
    if(!TYPES.has(type))return res.status(400).json({ok:false,error:'业务板块无效'});
    const to=dateOnly(req.query.to),from=dateOnly(req.query.from)||to;
    if(!from||!to||from>to)return res.status(400).json({ok:false,error:'日期范围无效'});
    const dates=completedDates(from,to);
    if(!dates.length)return res.json({ok:true,patchId:V137_TREND_TRUTH_ID,businessType:type,requestedFromDate:from,requestedToDate:to,fromDate:from,toDate:to,dates:[],ticket:[],podRate:[],ocRate:[],firstRate:[],attemptUnknownPod:[]});
    const entry=cacheEntry(from,to,dates);
    const payload=entry.byType[type];
    const related=type==='TOTAL'?{SHOPEECN:entry.byType.SHOPEECN,SHOPEEVN:entry.byType.SHOPEEVN}:undefined;
    res.setHeader('Cache-Control','private, max-age=10, stale-while-revalidate=30');
    res.setHeader('Server-Timing',`v138;desc=seven-business-trend-cache-${entry.cacheHit?'hit':'miss'};dur=0`);
    res.json({ok:true,patchId:V137_TREND_TRUTH_ID,businessType:type,requestedFromDate:from,requestedToDate:to,fromDate:entry.actualFrom,toDate:entry.actualTo,trendPolicy:from===to?'LAST_7_VALID_DAYS':'FULL_SELECTED_VALID_DAYS',cacheHit:entry.cacheHit,sourceRowCount:entry.rowCount,...payload,...(related?{related}: {})});
  }catch(error){console.error('[CE-QC][V138][TRENDS]',error?.stack||error);res.status(500).json({ok:false,patchId:V137_TREND_TRUTH_ID,error:error?.message||String(error)});}
}

const previousListen=express.application.listen;let installed=false;
express.application.listen=function v138TrendTruthListen(...args){if(!installed){installed=true;this.get('/api/v137/trends',handler);}return previousListen.apply(this,args);};
