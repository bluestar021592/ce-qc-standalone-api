import express from 'express';
import { getDb } from './db.js';

export const V143_HOME_TRUTH_ID='2026-08-15-v149-live-import-cross-day-attempt-v4';
const CORE_TYPES=new Set(['CE','CEAF','TBKH','ALI1688','WHPP']);
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);

function dateOnly(value=''){const text=String(value||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function safe(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return {};}}
function number(...values){for(const value of values){if(value===null||value===undefined||value==='')continue;const n=Number(value);if(Number.isFinite(n))return n;}return 0;}
function positive(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>0)return n;}return 0;}
function yes(value){return value===true||value===1||/^(?:1|true|yes|是|有|异常)$/i.test(String(value||'').trim());}
function rate(n,d){return d?Number((Number(n||0)*100/Number(d)).toFixed(2)):0;}
function clampAttempt(value){const n=Math.trunc(Number(value||0));return n>0?Math.max(1,Math.min(3,n)):0;}
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
function fallbackAttempt(reportDate,podDate){
  if(!dateOnly(reportDate)||!dateOnly(podDate))return 0;
  const start=Date.parse(`${dateOnly(reportDate)}T00:00:00Z`),end=Date.parse(`${dateOnly(podDate)}T00:00:00Z`);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return 0;
  return clampAttempt(Math.floor((end-start)/86400000)+1);
}
function billOf(row={}){return String(row.shipmentCode||row.运单号||'').trim().toUpperCase();}
function regionOf(row={}){
  const raw=safe(row.rawJson);
  const values=[row.regionCode,raw.regionCode,raw.region_code,raw.regionRaw,raw.区域,raw.区域代码,raw.省份标识,raw.收件省份,raw.省份];
  for(const value of values){
    const text=String(value||'').trim().toUpperCase();
    if(!text)continue;
    if(text==='PP'||/PHNOM\s*PENH|金边/.test(text))return'PP';
    if(text==='PV'||/外省|PROVINCE|PROVINCIAL/.test(text))return'PV';
  }
  return'';
}

function latestSnapshot(date){
  return getDb().prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,COALESCE(s.status,'IMPORTED') snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate=?
    ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1
  `).get(date)||null;
}

function sourceRows(snapshot){
  if(!snapshot)return[];
  return getDb().prepare(`
    SELECT u.businessType,u.shipmentCode,UPPER(COALESCE(u.regionCode,'')) regionCode,u.rowJson importJson,u.reportDate,
      COALESCE(bf.isPod,f.isPod,0) isPod,
      COALESCE(bf.primaryCategory,f.primaryCategory,'') primaryCategory,
      COALESCE(bf.rawJson,f.rawJson,u.rowJson,'{}') rawJson,
      COALESCE(bf.podAttemptNo,0) podAttemptNo,
      COALESCE(bf.currentAttemptNo,0) currentAttemptNo,
      COALESCE(sr.isPod,0) scanIsPod,COALESCE(sr.orderStatus,'') scanOrderStatus,COALESCE(sr.rawJson,'{}') scanJson,
      COALESCE(st.rawJson,'{}') shipmentJson,
      COALESCE(c.state,'') currentState,COALESCE(c.stateJson,'{}') currentJson
    FROM unified_import_rows u
    LEFT JOIN final_rows f
      ON u.businessType IN ('CE','CEAF','TBKH','ALI1688')
     AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    LEFT JOIN business_final_rows bf
      ON bf.shipmentCode=u.shipmentCode AND bf.reportDate=u.reportDate
     AND ((u.businessType IN ('SHOPEECN','SHOPEEVN') AND bf.businessType='SHOPEE')
       OR (u.businessType='WHPP' AND bf.businessType='WHPP'))
    LEFT JOIN business_scan_results sr
      ON u.businessType IN ('SHOPEECN','SHOPEEVN')
     AND sr.businessType='SHOPEE' AND sr.shipmentCode=u.shipmentCode AND sr.reportDate=u.reportDate
    LEFT JOIN business_shipment_tracks st
      ON u.businessType IN ('SHOPEECN','SHOPEEVN')
     AND st.businessType='SHOPEE' AND st.shipmentCode=u.shipmentCode AND st.reportDate=u.reportDate
    LEFT JOIN shipment_current_state c ON c.shipmentCode=u.shipmentCode
    WHERE u.snapshotId=?
    ORDER BY u.businessType,u.shipmentCode
  `).all(snapshot.snapshotId);
}

function shopeeAttemptEvidence(snapshot,date){
  if(!snapshot)return new Map();
  const rows=getDb().prepare(`
    WITH source AS (
      SELECT DISTINCT UPPER(TRIM(shipmentCode)) shipmentCode
      FROM unified_import_rows
      WHERE snapshotId=? AND businessType IN ('SHOPEECN','SHOPEEVN')
    ),
    pod_candidates AS (
      SELECT UPPER(TRIM(s.shipmentCode)) shipmentCode,s.reportDate evidenceDate,s.rawJson evidenceJson,'SCAN' evidenceSource
      FROM business_scan_results s INNER JOIN source x ON x.shipmentCode=UPPER(TRIM(s.shipmentCode))
      WHERE s.businessType='SHOPEE' AND s.reportDate>=?
        AND (s.isPod=1 OR CAST(COALESCE(s.orderStatus,'') AS TEXT)='85')
        AND COALESCE(s.rawJson,'') NOT LIKE '%POD_LOCK%'
      UNION ALL
      SELECT UPPER(TRIM(f.shipmentCode)) shipmentCode,f.reportDate evidenceDate,f.rawJson evidenceJson,'FINAL' evidenceSource
      FROM business_final_rows f INNER JOIN source x ON x.shipmentCode=UPPER(TRIM(f.shipmentCode))
      WHERE f.businessType='SHOPEE' AND f.reportDate>=? AND f.isPod=1
        AND COALESCE(f.rawJson,'') NOT LIKE '%POD_LOCK%'
    ),
    pod_ranked AS (
      SELECT shipmentCode,evidenceDate,evidenceJson,evidenceSource,
        ROW_NUMBER() OVER(PARTITION BY shipmentCode ORDER BY evidenceDate,CASE evidenceSource WHEN 'SCAN' THEN 0 ELSE 1 END) rn
      FROM pod_candidates
    ),
    pod_first AS (
      SELECT shipmentCode,evidenceDate,evidenceJson,evidenceSource FROM pod_ranked WHERE rn=1
    ),
    latest_final_ranked AS (
      SELECT UPPER(TRIM(f.shipmentCode)) shipmentCode,f.podAttemptNo,f.currentAttemptNo,f.reportDate,
        ROW_NUMBER() OVER(PARTITION BY UPPER(TRIM(f.shipmentCode)) ORDER BY f.reportDate DESC,f.id DESC) rn
      FROM business_final_rows f INNER JOIN source x ON x.shipmentCode=UPPER(TRIM(f.shipmentCode))
      WHERE f.businessType='SHOPEE' AND f.reportDate>=?
    ),
    latest_final AS (
      SELECT shipmentCode,podAttemptNo,currentAttemptNo FROM latest_final_ranked WHERE rn=1
    ),
    track_attempts AS (
      SELECT x.shipmentCode,
        COUNT(DISTINCT CASE WHEN LENGTH(e.eventTime)>=10 THEN SUBSTR(REPLACE(e.eventTime,'/','-'),1,10) END) attemptCount
      FROM source x
      LEFT JOIN pod_first p ON p.shipmentCode=x.shipmentCode
      INNER JOIN business_track_events e
        ON e.businessType='SHOPEE' AND UPPER(TRIM(e.shipmentCode))=x.shipmentCode
       AND (LENGTH(e.eventTime)<10 OR SUBSTR(REPLACE(e.eventTime,'/','-'),1,10)>=?)
       AND (p.evidenceDate IS NULL OR LENGTH(e.eventTime)<10 OR SUBSTR(REPLACE(e.eventTime,'/','-'),1,10)<=p.evidenceDate)
      WHERE CAST(COALESCE(e.eventCode,'') AS TEXT)='30'
         OR LOWER(COALESCE(e.rawJson,'')) LIKE '%delivery assign%'
         OR LOWER(COALESCE(e.rawJson,'')) LIKE '%courier assign%'
         OR LOWER(COALESCE(e.rawJson,'')) LIKE '%out for delivery%'
         OR COALESCE(e.rawJson,'') LIKE '%派件分配%'
         OR COALESCE(e.rawJson,'') LIKE '%分配快递员%'
         OR COALESCE(e.rawJson,'') LIKE '%派送中%'
      GROUP BY x.shipmentCode
    )
    SELECT x.shipmentCode,
      COALESCE(p.evidenceDate,'') firstPodObservedDate,COALESCE(p.evidenceJson,'{}') firstPodEvidenceJson,COALESCE(p.evidenceSource,'') firstPodEvidenceSource,
      COALESCE(l.podAttemptNo,0) podAttemptNo,COALESCE(l.currentAttemptNo,0) currentAttemptNo,COALESCE(t.attemptCount,0) trackAttemptCount,
      COALESCE(pl.podTime,'') podLockTime,COALESCE(pl.source,'') podLockSource,COALESCE(pl.createdAt,'') podLockCreatedAt
    FROM source x
    LEFT JOIN pod_first p ON p.shipmentCode=x.shipmentCode
    LEFT JOIN latest_final l ON l.shipmentCode=x.shipmentCode
    LEFT JOIN track_attempts t ON t.shipmentCode=x.shipmentCode
    LEFT JOIN business_pod_locks pl ON pl.businessType='SHOPEE' AND UPPER(TRIM(pl.shipmentCode))=x.shipmentCode
  `).all(snapshot.snapshotId,date,date,date,date);
  return new Map(rows.map(row=>[String(row.shipmentCode||''),row]));
}

function truth(row){
  const raw=safe(row.rawJson),scan=safe(row.scanJson),shipment=safe(row.shipmentJson),current=safe(row.currentJson);
  const scanRawText=typeof row.scanJson==='string'?row.scanJson:JSON.stringify(row.scanJson||{});
  const realScanPod=!/POD_LOCK/i.test(scanRawText)&&(Number(row.scanIsPod||0)===1||String(row.scanOrderStatus||'')==='85'||scan.是否POD==='是'||String(scan.orderStatus??'')==='85');
  const state=String(current.currentState||current.state||row.currentState||raw.currentState||raw.state||scan.currentState||shipment.currentState||'').toUpperCase();
  const category=String(current.primaryCategory||current.主分类||current.异常分类||row.primaryCategory||raw.primaryCategory||raw.主分类||raw.异常分类||'');
  const categoryUpper=category.toUpperCase();
  const order=String(current.orderStatus??raw.orderStatus??scan.orderStatus??shipment.orderStatus??raw.scanOrderStatus??'').trim();
  const pod=realScanPod||Number(row.isPod||0)===1||current.是否POD==='是'||raw.是否POD==='是'||raw.POD状态==='POD'||order==='85'||state==='POD';
  const returned=order==='100'||current.退回状态==='已退回'||raw.退回状态==='已退回'||scan.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(state)||/退回|RETURN/.test(categoryUpper);
  const cancelled=order==='10'||current.订单取消==='是'||raw.订单取消==='是'||raw.取消状态==='已取消'||state==='ORDER_CANCELLED'||/订单取消|CANCEL/.test(categoryUpper);
  const special=['SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','CCSL580_RETENTION','CECN_RETENTION','CEZT_RETENTION','NORMAL_FINAL','NORMAL_FINAL_HUB'].includes(state)
    ||/SELF_PICKUP|CCSLCN_DIVERSION|CCSLZT_DIVERSION|580_RETENTION|580_DIVERSION|CECN_RETENTION|CEZT_RETENTION|正常闭环/.test(categoryUpper);
  const closed=pod||returned||cancelled||special;
  const pendingDays=number(current.Pending当前次数,current.Pending次数,current.pendingDistinctDayCount,current.pendingDays,raw.Pending当前次数,raw.Pending次数,raw.pendingDistinctDayCount,raw.pendingDays);
  const ocDays=closed?0:number(current.OC天数,current.ocDays,raw.OC天数,raw.ocDays);
  const cycleDays=closed?0:number(current.盘点天数,current.cycleDays,current.inventoryDays,raw.盘点天数,raw.cycleDays,raw.inventoryDays);
  const shopState=String(current.shopState||current.storeFlowState||raw.shopState||raw.storeFlowState||'').toUpperCase();
  const shopRetentionDays=number(current.shopRetentionNaturalDays,current.门店滞留天数,current.shopRetentionDays,raw.shopRetentionNaturalDays,raw.门店滞留天数,raw.shopRetentionDays);
  const pendingNonContinuous=!closed&&(yes(current.Pending不连续)||yes(current.pendingNonContinuous)||yes(raw.Pending不连续)||yes(raw.pendingNonContinuous)||/PENDING不连续|PENDING NON.?CONTINUOUS/i.test(category));
  const workOrder=!closed&&(yes(current.工单未处理)||yes(current.workOrderAbnormal)||yes(raw.工单未处理)||yes(raw.workOrderAbnormal)||/工单/.test(category));
  const inboundNoScan=!closed&&(yes(current.入库无扫描节点)||yes(current.inboundNoScan)||yes(raw.入库无扫描节点)||yes(raw.inboundNoScan)||/入库无扫描/.test(category));
  const storeRetention=!closed&&['SHOP_ARRIVED_CURRENT','SHOP_TRANSFER_IN_PROGRESS'].includes(shopState)&&shopRetentionDays>=2;
  const attempt=clampAttempt(positive(row.podAttemptNo,row.currentAttemptNo,current.podAttemptNo,current.currentAttemptNo,current.dispatchAttemptNo,current.POD派次,raw.podAttemptNo,raw.currentAttemptNo,raw.dispatchAttemptNo,raw.POD派次));
  const podDate=podDateFromSources(current,raw,shipment,scan)||(realScanPod?dateOnly(row.reportDate):'');
  return {raw,scan,shipment,current,realScanPod,pod,returned,cancelled,special,closed,pendingDays,ocDays,cycleDays,pendingNonContinuous,workOrder,inboundNoScan,storeRetention,attempt,podDate};
}

function coreSummary(rows){
  const members=rows.filter(row=>CORE_TYPES.has(String(row.businessType||'').toUpperCase()));
  const facts=members.map(row=>({row,...truth(row)}));
  const total=members.length;
  const open=facts.filter(item=>!item.closed);
  const pod=facts.filter(item=>item.pod).length;
  const attempt1=facts.filter(item=>item.pod&&item.attempt===1).length;
  const knownAttempts=facts.filter(item=>item.pod&&item.attempt>0).length;
  return {
    total,
    pendingNonContinuous:open.filter(item=>item.pendingNonContinuous).length,
    pending3:open.filter(item=>item.pendingDays>=3).length,
    oc1:open.filter(item=>item.ocDays>=1).length,
    oc2:open.filter(item=>item.ocDays>=2).length,
    storeRetention:open.filter(item=>item.storeRetention).length,
    workOrder:open.filter(item=>item.workOrder).length,
    inboundNoScan:open.filter(item=>item.inboundNoScan).length,
    cycle2:open.filter(item=>item.cycleDays>=2).length,
    todayPod:pod,
    podRate:rate(pod,total),
    firstPodRate:pod===0?0:(knownAttempts?rate(attempt1,total):null),
    firstAttemptKnown:knownAttempts,
    provinceOpen:open.filter(item=>regionOf(item.row)==='PV').length
  };
}

function shopeeSpecialSummary(rows){
  const result={CN:{total:0,pod:0,podRate:0,pendingNonContinuous:0,returned:0},VN:{total:0,pod:0,podRate:0,pendingNonContinuous:0,returned:0}};
  for(const row of rows){
    const type=String(row.businessType||'').toUpperCase();
    if(!SHOPEE_TYPES.has(type))continue;
    const key=type==='SHOPEECN'?'CN':'VN';
    const item=truth(row);result[key].total++;
    if(item.pod)result[key].pod++;
    if(item.pendingNonContinuous)result[key].pendingNonContinuous++;
    if(item.returned)result[key].returned++;
  }
  for(const item of Object.values(result))item.podRate=rate(item.pod,item.total);
  return result;
}

function dispatchSummary(rows,date,evidence){
  const keys=['CN-PP','CN-PV','VN-PP','VN-PV'];
  const groups=Object.fromEntries(keys.map(key=>[key,{label:key,total:0,pod:0,known:0,unknownPod:0,counts:[0,0,0],values:[null,null,null]}]));
  for(const row of rows){
    const type=String(row.businessType||'').toUpperCase();
    if(!SHOPEE_TYPES.has(type))continue;
    const region=regionOf(row);if(!['PP','PV'].includes(region))continue;
    const key=`${type==='SHOPEECN'?'CN':'VN'}-${region}`;
    const group=groups[key];group.total++;
    const item=truth(row),ev=evidence.get(billOf(row))||{},podEvidence=safe(ev.firstPodEvidenceJson);
    const podLockDate=normalizeDate(ev.podLockTime);
    const pod=item.pod||Boolean(ev.firstPodObservedDate)||Boolean(podLockDate);
    if(!pod)continue;group.pod++;
    let attempt=item.attempt;
    if(!attempt)attempt=clampAttempt(positive(ev.podAttemptNo,ev.currentAttemptNo));
    if(!attempt)attempt=clampAttempt(ev.trackAttemptCount);
    const podDate=podDateFromSources(podEvidence,item.current,item.raw,item.shipment,item.scan)||podLockDate||dateOnly(ev.firstPodObservedDate)||item.podDate;
    if(!attempt)attempt=fallbackAttempt(date,podDate);
    if(attempt){group.known++;group.counts[attempt-1]++;}else group.unknownPod++;
  }
  for(const group of Object.values(groups)){
    if(!group.total){group.values=[null,null,null];continue;}
    if(group.pod>0&&group.known===0){group.values=[null,null,null];continue;}
    group.values=group.counts.map(count=>rate(count,group.total));
  }
  return groups;
}

function handler(req,res){
  try{
    const date=dateOnly(req.query.reportDate);
    if(!date)return res.status(400).json({ok:false,patchId:V143_HOME_TRUTH_ID,error:'日期无效'});
    const snapshot=latestSnapshot(date);
    if(!snapshot)return res.json({ok:true,patchId:V143_HOME_TRUTH_ID,reportDate:date,available:false,core:null,special:null,dispatch:{}});
    const rows=sourceRows(snapshot);
    const evidence=shopeeAttemptEvidence(snapshot,date);
    const counts={CE:0,CEAF:0,TBKH:0,ALI1688:0,SHOPEECN:0,SHOPEEVN:0,WHPP:0};
    for(const row of rows){const type=String(row.businessType||'').toUpperCase();if(Object.hasOwn(counts,type))counts[type]++;}
    const total=Object.values(counts).reduce((sum,value)=>sum+value,0);
    res.setHeader('Cache-Control','no-store');
    res.json({
      ok:true,patchId:V143_HOME_TRUTH_ID,reportDate:date,available:true,snapshotId:snapshot.snapshotId,snapshotStatus:snapshot.snapshotStatus,
      sourcePolicy:'LATEST_VALID_UNIFIED_IMPORT_PLUS_LIVE_SQL_EVIDENCE',total,counts,
      core:coreSummary(rows),special:shopeeSpecialSummary(rows),dispatch:dispatchSummary(rows,date,evidence)
    });
  }catch(error){console.error('[CE-QC][V149][HOME_TRUTH]',error?.stack||error);res.status(500).json({ok:false,patchId:V143_HOME_TRUTH_ID,error:error?.message||String(error)});}
}

const previousListen=express.application.listen;let installed=false;
express.application.listen=function v149HomeTruthListen(...args){if(!installed){installed=true;this.get('/api/v143/home-truth',handler);}return previousListen.apply(this,args);};
