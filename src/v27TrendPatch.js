import express from 'express';
import path from 'node:path';
import { listLightweightBusinessHistory } from './lightweightDashboardStore.js';
import { getDb } from './db.js';

const TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','CCSL','SHOPEE']);
const GROUP_TYPES = Object.freeze({
  CCSL: ['CE','CEAF','TBKH','ALI1688'],
  SHOPEE: ['SHOPEECN','SHOPEEVN']
});

function validDate(value='') {
  const date=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
}

function ratio(n,d){ return d?Number((Number(n||0)*100/Number(d)).toFixed(2)):0; }
function weightedRate(items,key){
  let weighted=0,total=0;
  for(const item of items){
    const summary=item?.summary||{};
    const tickets=Number(summary.today??summary.pnh??summary.todayPnh??0);
    if(tickets<=0) continue;
    weighted += tickets * Number(summary?.[key]||0);
    total += tickets;
  }
  return total?Number((weighted/total).toFixed(2)):0;
}

function resolveTrendWindow(fromDate,toDate) {
  const db=getDb();
  const singleDay=fromDate===toDate;
  // A date exists for trend purposes as soon as its newest daily import is VALID.
  // COMPLETED is a processing status, not proof that the daily report never existed.
  const rows=singleDay
    ? db.prepare(`
        SELECT DISTINCT reportDate
        FROM unified_import_batches
        WHERE status='VALID' AND reportDate<=?
        ORDER BY reportDate DESC
        LIMIT 7
      `).all(toDate)
    : db.prepare(`
        SELECT DISTINCT reportDate
        FROM unified_import_batches
        WHERE status='VALID' AND reportDate BETWEEN ? AND ?
        ORDER BY reportDate DESC
        LIMIT 7
      `).all(fromDate,toDate);
  const dates=rows.map(row=>String(row.reportDate||'')).filter(Boolean).sort();
  if(!dates.length) return {from:fromDate,to:toDate,dates:[]};
  return {from:dates[0],to:dates.at(-1),dates};
}

function exactHistory(type,throughDate){
  return listLightweightBusinessHistory(type,throughDate,120);
}

function aggregateHistory(type,throughDate){
  const memberTypes=GROUP_TYPES[type]||[];
  const histories=memberTypes.map(member=>exactHistory(member,throughDate));
  const byDate=new Map();
  for(const history of histories){
    for(const item of history||[]){
      if(!item?.reportDate) continue;
      if(!byDate.has(item.reportDate)) byDate.set(item.reportDate,[]);
      byDate.get(item.reportDate).push(item);
    }
  }
  const rows=[];
  for(const [reportDate,items] of byDate){
    const total=items.reduce((sum,item)=>sum+Number(item?.summary?.today??item?.summary?.pnh??0),0);
    const pod=items.reduce((sum,item)=>sum+Number(item?.summary?.todayPod??item?.summary?.scanPod??0),0);
    rows.push({
      reportDate,
      summary:{
        reportDate,
        today:total,
        pnh:total,
        todayPnh:total,
        todayPod:pod,
        scanPod:pod,
        podRate:ratio(pod,total),
        firstPodRate:weightedRate(items,'firstPodRate'),
        ocRate:weightedRate(items,'ocRate')
      }
    });
  }
  return rows.sort((a,b)=>a.reportDate.localeCompare(b.reportDate));
}

function historyFor(type,throughDate){
  return GROUP_TYPES[type] ? aggregateHistory(type,throughDate) : exactHistory(type,throughDate);
}

function attemptRows(fromDate,toDate) {
  if(!fromDate||!toDate) return [];
  const rows=getDb().prepare(`
    WITH latest AS (
      SELECT b.reportDate,b.snapshotId
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1 FROM unified_import_batches newer
          WHERE newer.status='VALID'
            AND newer.reportDate=b.reportDate
            AND newer.createdAt>b.createdAt
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
          NULLIF(CAST(f.currentAttemptNo AS INTEGER),0),
          NULLIF(CAST(json_extract(f.rawJson,'$.currentAttemptNo') AS INTEGER),0),
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

function trendPayload(type,dates,history,attemptHistory){
  const historyMap=new Map((history||[]).map(item=>[item.reportDate,item]));
  const shopee=type.startsWith('SHOPEE');
  const group=type==='SHOPEECN'?'CN':type==='SHOPEEVN'?'VN':'ALL';
  const base={ dates:[...dates],ticket:[],podRate:[],ocRate:[],firstRate:[],attempt1:[],attempt2:[],attempt3:[],attempt1Count:[],attempt2Count:[],attempt3Count:[],attemptDenominator:[],attemptUnknownPod:[] };
  for(const reportDate of dates){
    const s=historyMap.get(reportDate)?.summary||{};
    const total=Number(s.today??s.pnh??s.todayPnh??0);
    base.ticket.push(total);
    base.podRate.push(Number(s.podRate??0));
    base.ocRate.push(Number(s.ocRate??0));
    if(!shopee){
      base.firstRate.push(Number(s.firstPodRate??s.podRate??0));
      continue;
    }
    const attempts=attemptHistory.find(row=>row.reportDate===reportDate);
    const selected=group==='ALL'?{
      total:Number(attempts?.CN?.total||0)+Number(attempts?.VN?.total||0),
      a1:Number(attempts?.CN?.a1||0)+Number(attempts?.VN?.a1||0),
      a2:Number(attempts?.CN?.a2||0)+Number(attempts?.VN?.a2||0),
      a3:Number(attempts?.CN?.a3||0)+Number(attempts?.VN?.a3||0),
      unknown:Number(attempts?.CN?.unknown||0)+Number(attempts?.VN?.unknown||0)
    }:(attempts?.[group]||{total:0,a1:0,a2:0,a3:0,unknown:0});
    base.firstRate.push(selected.total?ratio(selected.a1,selected.total):Number(s.firstPodRate??s.podRate??0));
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
    const history=historyFor(type,requestedTo);
    const attempts=type.startsWith('SHOPEE')&&trendWindow.dates.length?attemptRows(trendWindow.from,trendWindow.to):[];
    const payload=trendPayload(type,trendWindow.dates,history,attempts);
    res.setHeader('Cache-Control','private, max-age=30, stale-while-revalidate=120');
    res.json({
      ok:true,
      businessType:type,
      requestedFromDate:requestedFrom,
      requestedToDate:requestedTo,
      fromDate:trendWindow.from,
      toDate:trendWindow.to,
      trendWindowDates:trendWindow.dates,
      historySource:'VALID_UNIFIED_IMPORT_SQLITE',
      ...payload
    });
  }catch(error){
    console.error('[V151][TRENDS]',error);
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
