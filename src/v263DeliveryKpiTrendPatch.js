import express from 'express';
import { getDb } from './db.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';

export const V263_DELIVERY_KPI_TREND_ID='2026-08-23-v263-three-business-delivery-kpi-trend-v1';
const TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const CACHE_MS=15_000;
const memory=new Map();
const previousGet=express.application.get;
let routeRegistered=false;
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const round2=v=>Number(n(v).toFixed(2));
const pct=(a,b)=>b>0?round2(n(a)*100/n(b)):null;
const dateKey=v=>{const m=String(v||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};

function selectedDates(db,type,from,to){
  if(from===to){
    return db.prepare(`SELECT reportDate FROM (
      SELECT DISTINCT reportDate FROM dashboard_daily_cache WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate<=?
      UNION
      SELECT DISTINCT firstReportDate AS reportDate FROM qc_tracking_ledger WHERE businessType=? AND firstReportDate<=?
    ) ORDER BY reportDate DESC LIMIT 7`).all(type,to,type,to).map(r=>String(r.reportDate||'')).filter(Boolean).sort();
  }
  return db.prepare(`SELECT reportDate FROM (
    SELECT DISTINCT reportDate FROM dashboard_daily_cache WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate BETWEEN ? AND ?
    UNION
    SELECT DISTINCT firstReportDate AS reportDate FROM qc_tracking_ledger WHERE businessType=? AND firstReportDate BETWEEN ? AND ?
  ) ORDER BY reportDate ASC LIMIT 180`).all(type,from,to,type,from,to).map(r=>String(r.reportDate||'')).filter(Boolean);
}

export function readV263DeliveryKpiTrends(businessType='',fromDate='',toDate='',db=getDb()){
  const type=String(businessType||'').toUpperCase();const to=dateKey(toDate),from=dateKey(fromDate)||to;
  if(!TYPES.has(type))throw new Error('V263仅支持TBKH、SHOPEECN、SHOPEEVN');
  if(!from||!to||from>to)throw new Error('日期范围无效');
  ensureV246TrackingSchema(db);
  const key=`${type}|${from}|${to}`;const hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;
  const dates=selectedDates(db,type,from,to);
  if(!dates.length){const empty={ok:true,id:V263_DELIVERY_KPI_TREND_ID,businessType:type,dates:[],daily:[],ticket:[],pod:[],podRate:[],oc:[],ocRate:[],avgSigningDays:[],attempt1:[],attempt2:[],attempt3:[],attemptUnknown:[],attempt1Rate:[],attempt2Rate:[],attempt3Rate:[],attemptCoverageRate:[],signingCoverageRate:[]};memory.set(key,{at:Date.now(),value:empty});return empty;}
  const marks=dates.map(()=>'?').join(',');
  const cacheRows=db.prepare(`SELECT reportDate,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.total') AS REAL),0)) AS total,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.pod') AS REAL),0)) AS pod,
      SUM(COALESCE(CAST(json_extract(metricsJson,'$.ocCurrent') AS REAL),0)) AS ocCurrent
    FROM dashboard_daily_cache
    WHERE businessType=? AND snapshotStatus='COMPLETED' AND reportDate IN (${marks})
    GROUP BY reportDate`).all(type,...dates);
  const cacheByDate=new Map(cacheRows.map(r=>[String(r.reportDate||''),r]));
  const ledgerRows=db.prepare(`SELECT firstReportDate AS reportDate,COUNT(*) AS ledgerCount,
      SUM(CASE WHEN terminalReason='POD' THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=1 THEN 1 ELSE 0 END) AS attempt1,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=2 THEN 1 ELSE 0 END) AS attempt2,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo>=3 THEN 1 ELSE 0 END) AS attempt3,
      SUM(CASE WHEN terminalReason='POD' AND attemptNo=0 THEN 1 ELSE 0 END) AS attemptUnknown,
      SUM(CASE WHEN terminalReason='POD' AND signingDays>0 THEN signingDays ELSE 0 END) AS signingDaysSum,
      SUM(CASE WHEN terminalReason='POD' AND signingDays>0 THEN 1 ELSE 0 END) AS signingDaysCount,
      SUM(CASE WHEN trackingStatus='OPEN' AND (UPPER(TRIM(COALESCE(currentState,'')))='OC' OR UPPER(TRIM(COALESCE(currentCategory,''))) LIKE 'OC%') THEN 1 ELSE 0 END) AS ocCurrent
    FROM qc_tracking_ledger WHERE businessType=? AND firstReportDate IN (${marks}) GROUP BY firstReportDate`).all(type,...dates);
  const ledgerByDate=new Map(ledgerRows.map(r=>[String(r.reportDate||''),r]));
  const daily=dates.map(reportDate=>{
    const c=cacheByDate.get(reportDate)||{},l=ledgerByDate.get(reportDate)||{};
    const cacheTotal=n(c.total),ledgerCount=n(l.ledgerCount),ledgerReady=ledgerCount>0&&(cacheTotal===0||ledgerCount>=cacheTotal);
    const total=ledgerReady?ledgerCount:cacheTotal,pod=ledgerReady?n(l.pod):n(c.pod),oc=ledgerReady?n(l.ocCurrent):n(c.ocCurrent);
    const a1=ledgerReady?n(l.attempt1):0,a2=ledgerReady?n(l.attempt2):0,a3=ledgerReady?n(l.attempt3):0,known=Math.min(pod,a1+a2+a3),unknown=Math.max(0,pod-known);
    const signingCount=ledgerReady?n(l.signingDaysCount):0,signingSum=ledgerReady?n(l.signingDaysSum):0;
    return{reportDate,total,pod,podRate:pct(pod,total),oc,ocRate:pct(oc,total),ledgerReady,ledgerCount,cacheTotal,
      avgSigningDays:signingCount?round2(signingSum/signingCount):null,signingDaysCount:signingCount,signingCoverageRate:pod?pct(signingCount,pod):null,
      attempt1:a1,attempt2:a2,attempt3:a3,attemptUnknown:unknown,attemptEvidenceCount:known,attemptCoverageRate:pod?pct(known,pod):null,
      attempt1Rate:pod&&known?pct(a1,pod):null,attempt2Rate:pod&&known?pct(a2,pod):null,attempt3Rate:pod&&known?pct(a3,pod):null};
  });
  const value={ok:true,id:V263_DELIVERY_KPI_TREND_ID,businessType:type,fromDate:dates[0],toDate:dates.at(-1),dates,daily,
    ticket:daily.map(r=>r.total),pod:daily.map(r=>r.pod),podRate:daily.map(r=>r.podRate),oc:daily.map(r=>r.oc),ocRate:daily.map(r=>r.ocRate),avgSigningDays:daily.map(r=>r.avgSigningDays),
    attempt1:daily.map(r=>r.attempt1),attempt2:daily.map(r=>r.attempt2),attempt3:daily.map(r=>r.attempt3),attemptUnknown:daily.map(r=>r.attemptUnknown),
    attempt1Rate:daily.map(r=>r.attempt1Rate),attempt2Rate:daily.map(r=>r.attempt2Rate),attempt3Rate:daily.map(r=>r.attempt3Rate),attemptCoverageRate:daily.map(r=>r.attemptCoverageRate),signingCoverageRate:daily.map(r=>r.signingCoverageRate),
    definitions:{attempt:'70 START优先；整票无70才用60；只有Pending/失败后出现新START才进入下一派；无证据保持未识别',signingDays:'首次日报锁定日期到实际POD日期，含首尾当天；仅可靠POD日期纳入平均'}};
  memory.set(key,{at:Date.now(),value});return value;
}

function handler(req,res){try{const data=readV263DeliveryKpiTrends(req.query.businessType,req.query.from,req.query.to);res.setHeader('Cache-Control','private,max-age=10');res.setHeader('X-CE-QC-V263',V263_DELIVERY_KPI_TREND_ID);return res.json(data);}catch(error){return res.status(400).json({ok:false,id:V263_DELIVERY_KPI_TREND_ID,error:error?.message||String(error)});}}
function register(app){if(routeRegistered)return;routeRegistered=true;previousGet.call(app,'/api/v263/delivery-trends',handler);console.info('[CE-QC][V263_DELIVERY_KPI] route registered for TBKH + SHOPEECN + SHOPEEVN only');}
express.application.get=function v263DeliveryTrendRoute(pathValue,...handlers){if(!routeRegistered&&String(pathValue||'')==='/api/v234/trends')register(this);return previousGet.call(this,pathValue,...handlers);};
