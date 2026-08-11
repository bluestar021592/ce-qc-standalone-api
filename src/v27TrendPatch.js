import express from 'express';
import path from 'node:path';
import { loadRangeDashboard } from './rangeDashboardStore.js';
import { getDb } from './db.js';

const TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','CCSL','SHOPEE']);

function validDate(value='') {
  const date=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
}

function lastSeven(items=[]) { return items.slice(-7); }
function ratio(n,d){ return d?Number((Number(n||0)*100/Number(d)).toFixed(2)):0; }
function metric(summary,key){ return Number(summary?.metrics?.[key] ?? 0); }

function resolveTrendWindow(fromDate,toDate) {
  const db=getDb();
  const singleDay=fromDate===toDate;
  const rows=singleDay
    ? db.prepare(`
        SELECT DISTINCT b.reportDate
        FROM unified_import_batches b
        INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
        WHERE b.status='VALID' AND b.reportDate<=?
        ORDER BY b.reportDate DESC
        LIMIT 7
      `).all(toDate)
    : db.prepare(`
        SELECT DISTINCT b.reportDate
        FROM unified_import_batches b
        INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
        WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
        ORDER BY b.reportDate DESC
        LIMIT 7
      `).all(fromDate,toDate);
  const dates=rows.map(row=>String(row.reportDate||'')).filter(Boolean).sort();
  if(!dates.length) return {from:fromDate,to:toDate,dates:[]};
  return {from:dates[0],to:dates.at(-1),dates};
}

function attemptRows(fromDate,toDate) {
  const rows=getDb().prepare(`
    WITH latest AS (
      SELECT b.reportDate,b.snapshotId
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1 FROM unified_import_batches newer
          INNER JOIN unified_snapshots ns ON ns.snapshotId=newer.snapshotId AND ns.status='COMPLETED'
          WHERE newer.status='VALID' AND newer.reportDate=b.reportDate AND newer.createdAt>b.createdAt
        )
    ), valid AS (
      SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode
      FROM latest l
      INNER JOIN unified_import_rows u
        ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('SHOPEECN','SHOPEEVN')
    ), prepared AS (
      SELECT
        v.reportDate,
        v.businessType,
        v.shipmentCode,
        COALESCE(f.isPod,0) AS isPod,
        COALESCE(
          NULLIF(CAST(f.podAttemptNo AS INTEGER),0),
          NULLIF(CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0),
          0
        ) AS explicitAttempt,
        COALESCE(
          NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),
          NULLIF(json_extract(f.rawJson,'$.podTime'),''),
          NULLIF(json_extract(f.rawJson,'$.podClosedAt'),''),
          NULLIF(json_extract(f.rawJson,'$.terminalObservedAt'),''),
          ''
        ) AS podTimestamp
      FROM valid v
      LEFT JOIN business_final_rows f
        ON f.businessType='SHOPEE'
       AND f.shipmentCode=v.shipmentCode
       AND f.reportDate=v.reportDate
    ), classified AS (
      SELECT
        reportDate,
        businessType,
        shipmentCode,
        isPod,
        CASE
          WHEN isPod<>1 THEN 0
          WHEN explicitAttempt>0 THEN MIN(3,explicitAttempt)
          WHEN length(podTimestamp)>=10
               AND julianday(date(replace(substr(podTimestamp,1,10),'/','-'))) IS NOT NULL
          THEN MIN(3,MAX(1,
            CAST(julianday(date(replace(substr(podTimestamp,1,10),'/','-'))) - julianday(reportDate) AS INTEGER) + 1
          ))
          ELSE 0
        END AS attemptDay
      FROM prepared
    )
    SELECT reportDate,businessType,COUNT(*) AS total,
      SUM(CASE WHEN isPod=1 AND attemptDay=1 THEN 1 ELSE 0 END) AS a1,
      SUM(CASE WHEN isPod=1 AND attemptDay=2 THEN 1 ELSE 0 END) AS a2,
      SUM(CASE WHEN isPod=1 AND attemptDay>=3 THEN 1 ELSE 0 END) AS a3,
      SUM(CASE WHEN isPod=1 AND attemptDay=0 THEN 1 ELSE 0 END) AS unknownPodAttempt
    FROM classified
    GROUP BY reportDate,businessType
    ORDER BY reportDate,businessType
  `).all(fromDate,toDate);
  const map=new Map();
  for(const row of rows){
    if(!map.has(row.reportDate)) map.set(row.reportDate,{reportDate:row.reportDate,CN:{total:0,a1:0,a2:0,a3:0,unknown:0},VN:{total:0,a1:0,a2:0,a3:0,unknown:0}});
    const group=row.businessType==='SHOPEECN'?'CN':'VN';
    map.get(row.reportDate)[group]={total:Number(row.total||0),a1:Number(row.a1||0),a2:Number(row.a2||0),a3:Number(row.a3||0),unknown:Number(row.unknownPodAttempt||0)};
  }
  return [...map.values()].sort((a,b)=>a.reportDate.localeCompare(b.reportDate));
}

function trendPayload(type,state,attemptHistory){
  const history=lastSeven(state?.historySummary||[]);
  const dates=history.map(item=>item.reportDate);
  const shopee=type.startsWith('SHOPEE');
  const group=type==='SHOPEECN'?'CN':type==='SHOPEEVN'?'VN':'ALL';
  const base={ dates,ticket:[],podRate:[],ocRate:[],firstRate:[],attempt1:[],attempt2:[],attempt3:[],attempt1Count:[],attempt2Count:[],attempt3Count:[],attemptDenominator:[],attemptUnknownPod:[] };
  for(const item of history){
    const s=item.summary||{};
    if(!shopee){
      base.ticket.push(Number(s.today??s.pnh??0));
      base.podRate.push(Number(s.podRate??0));
      base.ocRate.push(Number(s.ocRate??0));
      base.firstRate.push(Number(s.firstPodRate??s.podRate??0));
      continue;
    }
    base.ticket.push(metric(s,`${group}_今日总单`));
    base.podRate.push(metric(s,`${group}_POD率`));
    base.ocRate.push(ratio(metric(s,`${group}_OC1+`),metric(s,`${group}_今日总单`)));
    const attempts=attemptHistory.find(row=>row.reportDate===item.reportDate);
    const selected=group==='ALL'?{
      total:Number(attempts?.CN?.total||0)+Number(attempts?.VN?.total||0),
      a1:Number(attempts?.CN?.a1||0)+Number(attempts?.VN?.a1||0),
      a2:Number(attempts?.CN?.a2||0)+Number(attempts?.VN?.a2||0),
      a3:Number(attempts?.CN?.a3||0)+Number(attempts?.VN?.a3||0),
      unknown:Number(attempts?.CN?.unknown||0)+Number(attempts?.VN?.unknown||0)
    }:(attempts?.[group]||{total:0,a1:0,a2:0,a3:0,unknown:0});
    base.firstRate.push(ratio(selected.a1,selected.total));
    base.attemptDenominator.push(selected.total);
    base.attempt1Count.push(selected.a1); base.attempt2Count.push(selected.a2); base.attempt3Count.push(selected.a3);
    base.attempt1.push(ratio(selected.a1,selected.total)); base.attempt2.push(ratio(selected.a2,selected.total)); base.attempt3.push(ratio(selected.a3,selected.total));
    base.attemptUnknownPod.push(selected.unknown);
  }
  return base;
}

function handler(req,res){
  try{
    const type=String(req.query.businessType||'CCSL').toUpperCase();
    if(!TYPES.has(type)) return res.status(400).json({ok:false,error:'业务板块无效'});
    const requestedTo=validDate(req.query.to); const requestedFrom=validDate(req.query.from)||requestedTo;
    if(!requestedFrom||!requestedTo||requestedFrom>requestedTo) return res.status(400).json({ok:false,error:'日期范围无效'});
    const trendWindow=resolveTrendWindow(requestedFrom,requestedTo);
    const result=loadRangeDashboard(trendWindow.from,trendWindow.to);
    const state=type==='CCSL'?result.aggregates.CCSL:type==='SHOPEE'?result.aggregates.SHOPEE:result.states[type];
    const attempts=type.startsWith('SHOPEE')?attemptRows(trendWindow.from,trendWindow.to):[];
    const payload=trendPayload(type,state,attempts);
    res.setHeader('Cache-Control','private, max-age=30, stale-while-revalidate=120');
    res.json({
      ok:true,
      businessType:type,
      requestedFromDate:requestedFrom,
      requestedToDate:requestedTo,
      fromDate:trendWindow.from,
      toDate:trendWindow.to,
      trendWindowDates:trendWindow.dates,
      ...payload
    });
  }catch(error){
    console.error('[V33][TRENDS]',error);
    res.status(500).json({ok:false,error:error.message||String(error)});
  }
}

let installed=false;
const previousListen=express.application.listen;
express.application.listen=function v27TrendListen(...args){
  if(!installed){
    installed=true;
    this.get('/api/v27/trends',handler);
    this.get('/carry',(req,res)=>res.sendFile(path.join(process.cwd(),'public','index.html')));
  }
  return previousListen.apply(this,args);
};
