import express from 'express';
import { getDb } from './db.js';
import { repairUnifiedSnapshotCompletion } from './v142UnifiedSnapshotRepairPatch.js';

export const V137_TREND_TRUTH_ID='2026-08-15-v148-cross-day-attempt-evidence-v9';
const BUSINESSES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const TYPES=new Set([...BUSINESSES,'CCSL','SHOPEE','TOTAL']);
const CORE=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE=['SHOPEECN','SHOPEEVN'];
const CACHE_TTL_MS=15_000;
const trendCache=new Map();

function dateOnly(value=''){const v=String(value||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';}
function safe(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return {};}}
function num(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function nullableNum(...values){for(const value of values){if(value===null||value===undefined||value==='')continue;const n=Number(value);if(Number.isFinite(n))return n;}return null;}
function positiveNum(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>0)return n;}return 0;}
function rate(n,d){return d?Number((num(n)*100/num(d)).toFixed(2)):0;}
function clampAttempt(value){const n=Math.trunc(num(value));return n>0?Math.max(1,Math.min(3,n)):0;}
function normalizeDate(value=''){
  const match=String(value||'').match(/(20\d{2})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match?`${match[1]}-${match[2]}-${match[3]}`:'';
}
function findPodDateInObject(value,depth=0){
  if(!value||depth>5)return'';
  if(Array.isArray(value)){
    for(const item of value){const found=findPodDateInObject(item,depth+1);if(found)return found;}
    return'';
  }
  if(typeof value!=='object')return'';
  const preferred=/^(?:podTime|podAt|podDate|deliveredAt|deliveredTime|deliveryCompleteTime|deliveryCompletedAt|signTime|signedTime|signedAt|finishTime|proofOfDeliveryTime|签收时间|妥投时间|POD时间|派送完成时间)$/i;
  for(const [key,item] of Object.entries(value)){
    if(preferred.test(String(key))){const date=normalizeDate(item);if(date)return date;}
  }
  for(const item of Object.values(value)){
    if(item&&typeof item==='object'){const found=findPodDateInObject(item,depth+1);if(found)return found;}
  }
  return'';
}
function podDateFromSources(...sources){for(const source of sources){const found=findPodDateInObject(source);if(found)return found;}return'';}
function attemptFromDates(reportDate,podDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(podDate||''))return 0;
  const start=Date.parse(`${reportDate}T00:00:00Z`),end=Date.parse(`${podDate}T00:00:00Z`);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return 0;
  return clampAttempt(Math.floor((end-start)/86400000)+1);
}

function scopeBusinessTypes(type){
  if(type==='TOTAL')return BUSINESSES;
  if(type==='CCSL')return CORE;
  if(type==='SHOPEE')return SHOPEE;
  return [type];
}

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

function sourceRows(fromDate,toDate,type){
  const scope=scopeBusinessTypes(type);
  const placeholders=scope.map(()=>'?').join(',');
  const needsShopeeAttempts=scope.some(item=>SHOPEE.includes(item));
  const evidenceCtes=needsShopeeAttempts?`,
    pod_candidates AS (
      SELECT v.reportDate sourceReportDate,UPPER(TRIM(v.shipmentCode)) shipmentCode,
        s.reportDate evidenceDate,s.rawJson evidenceJson,'SCAN' evidenceSource
      FROM valid v
      INNER JOIN business_scan_results s
        ON s.businessType='SHOPEE' AND UPPER(TRIM(s.shipmentCode))=UPPER(TRIM(v.shipmentCode))
       AND s.reportDate>=v.reportDate
      WHERE v.businessType IN ('SHOPEECN','SHOPEEVN')
        AND (s.isPod=1 OR CAST(COALESCE(s.orderStatus,'') AS TEXT)='85')
      UNION ALL
      SELECT v.reportDate sourceReportDate,UPPER(TRIM(v.shipmentCode)) shipmentCode,
        f.reportDate evidenceDate,f.rawJson evidenceJson,'FINAL' evidenceSource
      FROM valid v
      INNER JOIN business_final_rows f
        ON f.businessType='SHOPEE' AND UPPER(TRIM(f.shipmentCode))=UPPER(TRIM(v.shipmentCode))
       AND f.reportDate>=v.reportDate AND f.isPod=1
      WHERE v.businessType IN ('SHOPEECN','SHOPEEVN')
    ),
    pod_ranked AS (
      SELECT sourceReportDate,shipmentCode,evidenceDate,evidenceJson,evidenceSource,
        ROW_NUMBER() OVER(PARTITION BY sourceReportDate,shipmentCode ORDER BY evidenceDate,CASE evidenceSource WHEN 'SCAN' THEN 0 ELSE 1 END) rn
      FROM pod_candidates
    ),
    pod_first AS (
      SELECT sourceReportDate,shipmentCode,evidenceDate,evidenceJson,evidenceSource
      FROM pod_ranked WHERE rn=1
    ),
    track_attempts AS (
      SELECT v.reportDate sourceReportDate,UPPER(TRIM(v.shipmentCode)) shipmentCode,
        COUNT(DISTINCT CASE WHEN LENGTH(e.eventTime)>=10 THEN SUBSTR(REPLACE(e.eventTime,'/','-'),1,10) END) attemptCount
      FROM valid v
      INNER JOIN pod_first p ON p.sourceReportDate=v.reportDate AND p.shipmentCode=UPPER(TRIM(v.shipmentCode))
      INNER JOIN business_track_events e
        ON e.businessType='SHOPEE' AND UPPER(TRIM(e.shipmentCode))=UPPER(TRIM(v.shipmentCode))
       AND (LENGTH(e.eventTime)<10 OR SUBSTR(REPLACE(e.eventTime,'/','-'),1,10)>=v.reportDate)
       AND (LENGTH(e.eventTime)<10 OR SUBSTR(REPLACE(e.eventTime,'/','-'),1,10)<=p.evidenceDate)
      WHERE v.businessType IN ('SHOPEECN','SHOPEEVN') AND (
        CAST(COALESCE(e.eventCode,'') AS TEXT)='30'
        OR LOWER(COALESCE(e.rawJson,'')) LIKE '%delivery assign%'
        OR LOWER(COALESCE(e.rawJson,'')) LIKE '%courier assign%'
        OR LOWER(COALESCE(e.rawJson,'')) LIKE '%out for delivery%'
        OR COALESCE(e.rawJson,'') LIKE '%派件分配%'
        OR COALESCE(e.rawJson,'') LIKE '%分配快递员%'
        OR COALESCE(e.rawJson,'') LIKE '%派送中%'
      )
      GROUP BY v.reportDate,UPPER(TRIM(v.shipmentCode))
    )`:'';
  const trackSelect=needsShopeeAttempts?'COALESCE(ta.attemptCount,0)':'0';
  const trackJoin=needsShopeeAttempts?'LEFT JOIN track_attempts ta ON ta.sourceReportDate=v.reportDate AND ta.shipmentCode=UPPER(TRIM(v.shipmentCode))':'';
  const podSelect=needsShopeeAttempts
    ? "COALESCE(pf.evidenceDate,'') firstPodObservedDate,COALESCE(pf.evidenceJson,'{}') firstPodEvidenceJson,COALESCE(pf.evidenceSource,'') firstPodEvidenceSource,COALESCE(pl.podTime,'') podLockTime"
    : "'' firstPodObservedDate,'{}' firstPodEvidenceJson,'' firstPodEvidenceSource,'' podLockTime";
  const podJoin=needsShopeeAttempts?"LEFT JOIN pod_first pf ON pf.sourceReportDate=v.reportDate AND pf.shipmentCode=UPPER(TRIM(v.shipmentCode)) LEFT JOIN business_pod_locks pl ON pl.businessType='SHOPEE' AND UPPER(TRIM(pl.shipmentCode))=UPPER(TRIM(v.shipmentCode))":'';
  const scanSelect=needsShopeeAttempts?"COALESCE(sr.rawJson,'{}')":"'{}'";
  const shipmentSelect=needsShopeeAttempts?"COALESCE(st.rawJson,'{}')":"'{}'";
  const scanJoin=needsShopeeAttempts?"LEFT JOIN business_scan_results sr ON sr.businessType='SHOPEE' AND sr.shipmentCode=v.shipmentCode AND sr.reportDate=v.reportDate":'';
  const shipmentJoin=needsShopeeAttempts?"LEFT JOIN business_shipment_tracks st ON st.businessType='SHOPEE' AND st.shipmentCode=v.shipmentCode AND st.reportDate=v.reportDate":'';
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
      WHERE u.businessType IN (${placeholders})
    )${evidenceCtes}
    SELECT v.reportDate,v.businessType,v.shipmentCode,
      COALESCE(bf.isPod,cf.isPod,0) finalIsPod,
      COALESCE(bf.primaryCategory,cf.primaryCategory,'') finalCategory,
      COALESCE(bf.rawJson,cf.rawJson,'{}') finalJson,
      COALESCE(bf.podAttemptNo,0) finalPodAttemptNo,
      COALESCE(bf.currentAttemptNo,0) finalCurrentAttemptNo,
      ${trackSelect} trackAttemptCount,
      ${podSelect},
      ${scanSelect} scanJson,
      ${shipmentSelect} shipmentJson,
      COALESCE(c.state,'') currentState,COALESCE(c.stateJson,'{}') currentJson
    FROM valid v
    LEFT JOIN final_rows cf
      ON v.businessType IN ('CE','CEAF','TBKH','ALI1688') AND cf.shipmentCode=v.shipmentCode AND cf.reportDate=v.reportDate
    LEFT JOIN business_final_rows bf
      ON bf.shipmentCode=v.shipmentCode AND bf.reportDate=v.reportDate
     AND ((v.businessType IN ('SHOPEECN','SHOPEEVN') AND bf.businessType='SHOPEE') OR (v.businessType='WHPP' AND bf.businessType='WHPP'))
    ${trackJoin}
    ${podJoin}
    ${scanJoin}
    ${shipmentJoin}
    LEFT JOIN shipment_current_state c ON c.shipmentCode=v.shipmentCode
    ORDER BY v.reportDate,v.businessType,v.shipmentCode
  `).all(fromDate,toDate,...scope);
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

function attemptFromSource(source={}){
  const explicit=clampAttempt(nullableNum(source.podAttemptNo,source.currentAttemptNo,source.dispatchAttemptNo,source.POD派次));
  if(explicit)return explicit;
  if(Array.isArray(source.attemptHistory)&&source.attemptHistory.length)return clampAttempt(source.attemptHistory.length);
  return 0;
}

function attemptOf(reportDate,current={},final={},trackAttemptCount=0,shipment={},scan={},podEvidence={},podLockTime='',firstPodObservedDate=''){
  for(const source of [current,final,podEvidence,shipment,scan]){
    const explicit=attemptFromSource(source);
    if(explicit)return explicit;
  }
  const trackAttempt=clampAttempt(trackAttemptCount);
  if(trackAttempt)return trackAttempt;
  const stamp=podDateFromSources(podEvidence,final,shipment,scan,current)||normalizeDate(podLockTime)||normalizeDate(firstPodObservedDate);
  return attemptFromDates(reportDate,stamp);
}

function decorate(row){
  const rawFinal=safe(row.finalJson),rawCurrent=safe(row.currentJson),rawScan=safe(row.scanJson),rawShipment=safe(row.shipmentJson),rawPodEvidence=safe(row.firstPodEvidenceJson);
  const persistedPodAttempt=positiveNum(row.finalPodAttemptNo,rawFinal.podAttemptNo);
  const persistedCurrentAttempt=positiveNum(row.finalCurrentAttemptNo,rawFinal.currentAttemptNo);
  const final={
    ...rawFinal,
    primaryCategory:row.finalCategory,
    isPod:row.finalIsPod,
    ...(persistedPodAttempt?{podAttemptNo:persistedPodAttempt}:{}),
    ...(persistedCurrentAttempt?{currentAttemptNo:persistedCurrentAttempt}:{})
  };
  const current={...rawCurrent,currentState:row.currentState};
  const currentTerminal=terminalTruth(current),finalTerminal=terminalTruth(final),scanTerminal=terminalTruth(rawScan),shipmentTerminal=terminalTruth(rawShipment),evidenceTerminal=terminalTruth(rawPodEvidence);
  const futurePod=Boolean(row.firstPodObservedDate);
  const terminal=currentTerminal||finalTerminal||scanTerminal||shipmentTerminal||evidenceTerminal||(futurePod?'POD':'');
  const pod=terminal==='POD'||futurePod||(!terminal&&Number(row.finalIsPod||0)===1);
  const closed=Boolean(terminal);
  const ocDays=closed?0:num(nullableNum(current.OC天数,current.ocDays,final.OC天数,final.ocDays));
  const attempt=pod?attemptOf(row.reportDate,current,final,row.trackAttemptCount,rawShipment,rawScan,rawPodEvidence,row.podLockTime,row.firstPodObservedDate):0;
  return {...row,pod,closed,terminal,ocDays,attempt,attemptUnknown:pod&&!attempt?1:0};
}

function build(type,dates,rows){
  const byDate=new Map(dates.map(date=>[date,{total:0,pod:0,oc1:0,a1:0,a2:0,a3:0,unknown:0}]));
  for(const row of rows){
    if(!byDate.has(row.reportDate))continue;
    const d=byDate.get(row.reportDate);d.total++;
    if(row.pod)d.pod++;
    if(!row.closed&&row.ocDays>=1)d.oc1++;
    if(row.attempt===1)d.a1++;else if(row.attempt===2)d.a2++;else if(row.attempt>=3)d.a3++;
    d.unknown+=row.attemptUnknown;
  }
  const ticket=[],podRate=[],ocRate=[],firstRate=[],attempt1=[],attempt2=[],attempt3=[],attempt1Count=[],attempt2Count=[],attempt3Count=[],attemptDenominator=[],attemptUnknownPod=[],attemptKnownPod=[],attemptCoverage=[];
  for(const date of dates){
    const d=byDate.get(date),evidence=d.a1+d.a2+d.a3,hasEvidence=evidence>0;
    ticket.push(d.total);podRate.push(rate(d.pod,d.total));ocRate.push(rate(d.oc1,d.total));
    const a1=d.pod===0?0:(hasEvidence?rate(d.a1,d.total):null);
    const a2=d.pod===0?0:(hasEvidence?rate(d.a2,d.total):null);
    const a3=d.pod===0?0:(hasEvidence?rate(d.a3,d.total):null);
    firstRate.push(a1);attempt1.push(a1);attempt2.push(a2);attempt3.push(a3);
    attempt1Count.push(d.a1);attempt2Count.push(d.a2);attempt3Count.push(d.a3);attemptDenominator.push(d.total);
    attemptUnknownPod.push(d.unknown);attemptKnownPod.push(evidence);attemptCoverage.push(d.pod?rate(evidence,d.pod):100);
  }
  return {dates,ticket,podRate,ocRate,firstRate,attempt1,attempt2,attempt3,attempt1Count,attempt2Count,attempt3Count,attemptDenominator,attemptUnknownPod,attemptKnownPod,attemptCoverage};
}

function cacheEntry(type,from,to,dates){
  const actualFrom=dates[0],actualTo=dates.at(-1);
  const key=`${type}|${actualFrom}|${actualTo}|${dates.join(',')}`;
  const cached=trendCache.get(key);
  if(cached&&Date.now()-cached.at<CACHE_TTL_MS)return {...cached,cacheHit:true};
  const rows=sourceRows(actualFrom,actualTo,type).map(decorate);
  const payload=build(type,dates,rows);
  const related=type==='TOTAL'?{
    SHOPEECN:build('SHOPEECN',dates,rows.filter(row=>row.businessType==='SHOPEECN')),
    SHOPEEVN:build('SHOPEEVN',dates,rows.filter(row=>row.businessType==='SHOPEEVN'))
  }:undefined;
  if(trendCache.size>12)trendCache.clear();
  const entry={at:Date.now(),actualFrom,actualTo,payload,related,rowCount:rows.length,queryScope:scopeBusinessTypes(type)};
  trendCache.set(key,entry);
  return {...entry,cacheHit:false};
}

function handler(req,res){
  try{
    const type=String(req.query.businessType||'TOTAL').trim().toUpperCase();
    if(!TYPES.has(type))return res.status(400).json({ok:false,error:'业务板块无效'});
    const to=dateOnly(req.query.to),from=dateOnly(req.query.from)||to;
    if(!from||!to||from>to)return res.status(400).json({ok:false,error:'日期范围无效'});
    const lifecycle=repairUnifiedSnapshotCompletion(to);
    const dates=completedDates(from,to);
    if(!dates.length)return res.json({ok:true,patchId:V137_TREND_TRUTH_ID,businessType:type,requestedFromDate:from,requestedToDate:to,fromDate:from,toDate:to,dates:[],ticket:[],podRate:[],ocRate:[],firstRate:[],attempt1:[],attempt2:[],attempt3:[],attemptUnknownPod:[],requestedDateAvailable:false,requestedDateLifecycle:lifecycle});
    const entry=cacheEntry(type,from,to,dates);
    const requestedDateAvailable=dates.includes(to);
    res.setHeader('Cache-Control','private, max-age=10, stale-while-revalidate=30');
    res.setHeader('Server-Timing',`v148;desc=cross-day-attempt-${entry.cacheHit?'hit':'miss'};dur=0`);
    res.json({ok:true,patchId:V137_TREND_TRUTH_ID,businessType:type,requestedFromDate:from,requestedToDate:to,fromDate:entry.actualFrom,toDate:entry.actualTo,requestedDateAvailable,requestedDateLifecycle:lifecycle,trendPolicy:from===to?'LAST_7_VALID_DAYS':'FULL_SELECTED_VALID_DAYS',attemptEvidencePolicy:'PERSISTED_ATTEMPT_THEN_CROSS_DAY_DISPATCH_EVENTS_THEN_POD_TIMESTAMP_THEN_FIRST_POD_OBSERVED_DATE',cacheHit:entry.cacheHit,sourceRowCount:entry.rowCount,queryScope:entry.queryScope,...entry.payload,...(entry.related?{related:entry.related}:{})});
  }catch(error){console.error('[CE-QC][V148][TRENDS]',error?.stack||error);res.status(500).json({ok:false,patchId:V137_TREND_TRUTH_ID,error:error?.message||String(error)});}
}

const previousListen=express.application.listen;let installed=false;
express.application.listen=function v148TrendTruthListen(...args){if(!installed){installed=true;this.get('/api/v137/trends',handler);}return previousListen.apply(this,args);};
