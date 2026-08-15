import express from 'express';
import { getDb } from './db.js';

export const V143_HOME_TRUTH_ID='2026-08-15-v143-home-source-truth-v1';
const CORE_TYPES=new Set(['CE','CEAF','TBKH','ALI1688','WHPP']);
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);

function dateOnly(value=''){const text=String(value||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function safe(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return {};}}
function number(...values){for(const value of values){if(value===null||value===undefined||value==='')continue;const n=Number(value);if(Number.isFinite(n))return n;}return 0;}
function positive(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>0)return n;}return 0;}
function yes(value){return value===true||value===1||/^(?:1|true|yes|是|有|异常)$/i.test(String(value||'').trim());}
function rate(n,d){return d?Number((Number(n||0)*100/Number(d)).toFixed(2)):0;}
function clampAttempt(value){const n=Math.trunc(Number(value||0));return n>0?Math.max(1,Math.min(3,n)):0;}

function latestSnapshot(date){
  return getDb().prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    WHERE b.status='VALID' AND b.reportDate=?
    ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1
  `).get(date)||null;
}

function sourceRows(snapshot){
  if(!snapshot)return[];
  return getDb().prepare(`
    SELECT u.businessType,u.shipmentCode,UPPER(COALESCE(u.regionCode,'')) regionCode,
      COALESCE(bf.isPod,f.isPod,0) isPod,
      COALESCE(bf.primaryCategory,f.primaryCategory,'') primaryCategory,
      COALESCE(bf.rawJson,f.rawJson,u.rowJson,'{}') rawJson,
      COALESCE(bf.podAttemptNo,f.podAttemptNo,0) podAttemptNo,
      COALESCE(bf.currentAttemptNo,f.currentAttemptNo,0) currentAttemptNo
    FROM unified_import_rows u
    LEFT JOIN final_rows f
      ON u.businessType IN ('CE','CEAF','TBKH','ALI1688')
     AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    LEFT JOIN business_final_rows bf
      ON bf.shipmentCode=u.shipmentCode AND bf.reportDate=u.reportDate
     AND ((u.businessType IN ('SHOPEECN','SHOPEEVN') AND bf.businessType='SHOPEE')
       OR (u.businessType='WHPP' AND bf.businessType='WHPP'))
    WHERE u.snapshotId=?
    ORDER BY u.businessType,u.shipmentCode
  `).all(snapshot.snapshotId);
}

function trackAttempts(date){
  const rows=getDb().prepare(`
    SELECT UPPER(TRIM(shipmentCode)) shipmentCode,
      COUNT(DISTINCT CASE WHEN length(eventTime)>=10 THEN substr(replace(eventTime,'/','-'),1,10) END) attemptCount
    FROM business_track_events
    WHERE businessType='SHOPEE' AND reportDate=? AND (
      CAST(COALESCE(eventCode,'') AS TEXT)='30'
      OR LOWER(COALESCE(rawJson,'')) LIKE '%delivery assign%'
      OR LOWER(COALESCE(rawJson,'')) LIKE '%courier assign%'
      OR LOWER(COALESCE(rawJson,'')) LIKE '%out for delivery%'
      OR COALESCE(rawJson,'') LIKE '%派件分配%'
      OR COALESCE(rawJson,'') LIKE '%分配快递员%'
      OR COALESCE(rawJson,'') LIKE '%派送中%'
    )
    GROUP BY UPPER(TRIM(shipmentCode))
  `).all(date);
  return new Map(rows.map(row=>[String(row.shipmentCode||''),Number(row.attemptCount||0)]));
}

function truth(row){
  const raw=safe(row.rawJson);
  const state=String(raw.currentState||raw.state||'').toUpperCase();
  const category=String(row.primaryCategory||raw.primaryCategory||raw.主分类||raw.异常分类||'');
  const categoryUpper=category.toUpperCase();
  const order=String(raw.orderStatus??raw.scanOrderStatus??'').trim();
  const pod=Number(row.isPod||0)===1||raw.是否POD==='是'||raw.POD状态==='POD'||order==='85'||state==='POD';
  const returned=order==='100'||raw.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(state)||/退回|RETURN/.test(categoryUpper);
  const cancelled=order==='10'||raw.订单取消==='是'||raw.取消状态==='已取消'||state==='ORDER_CANCELLED'||/订单取消|CANCEL/.test(categoryUpper);
  const special=['SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','CCSL580_RETENTION','CECN_RETENTION','CEZT_RETENTION','NORMAL_FINAL','NORMAL_FINAL_HUB'].includes(state)
    ||/SELF_PICKUP|CCSLCN_DIVERSION|CCSLZT_DIVERSION|580_RETENTION|580_DIVERSION|CECN_RETENTION|CEZT_RETENTION|正常闭环/.test(categoryUpper);
  const closed=pod||returned||cancelled||special;
  const pendingDays=number(raw.Pending当前次数,raw.Pending次数,raw.pendingDistinctDayCount,raw.pendingDays);
  const ocDays=closed?0:number(raw.OC天数,raw.ocDays);
  const cycleDays=closed?0:number(raw.盘点天数,raw.cycleDays,raw.inventoryDays);
  const shopState=String(raw.shopState||raw.storeFlowState||'').toUpperCase();
  const shopRetentionDays=number(raw.shopRetentionNaturalDays,raw.门店滞留天数,raw.shopRetentionDays);
  const pendingNonContinuous=!closed&&(yes(raw.Pending不连续)||yes(raw.pendingNonContinuous)||/PENDING不连续|PENDING NON.?CONTINUOUS/i.test(category));
  const workOrder=!closed&&(yes(raw.工单未处理)||yes(raw.workOrderAbnormal)||/工单/.test(category));
  const inboundNoScan=!closed&&(yes(raw.入库无扫描节点)||yes(raw.inboundNoScan)||/入库无扫描/.test(category));
  const storeRetention=!closed&&['SHOP_ARRIVED_CURRENT','SHOP_TRANSFER_IN_PROGRESS'].includes(shopState)&&shopRetentionDays>=2;
  const attempt=clampAttempt(positive(row.podAttemptNo,row.currentAttemptNo,raw.podAttemptNo,raw.currentAttemptNo,raw.dispatchAttemptNo,raw.POD派次));
  const podDate=String(raw.POD时间||raw.podTime||raw.podClosedAt||raw.terminalObservedAt||raw.latestEventTime||'').slice(0,10).replaceAll('/','-');
  return {raw,pod,returned,cancelled,special,closed,pendingDays,ocDays,cycleDays,pendingNonContinuous,workOrder,inboundNoScan,storeRetention,attempt,podDate};
}

function fallbackAttempt(date,podDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(podDate||''))return 0;
  const start=Date.parse(`${date}T00:00:00Z`),end=Date.parse(`${podDate}T00:00:00Z`);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return 0;
  return clampAttempt(Math.floor((end-start)/86400000)+1);
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
    provinceOpen:open.filter(item=>String(item.row.regionCode||'').toUpperCase()==='PV').length
  };
}

function dispatchSummary(rows,date){
  const tracks=trackAttempts(date);
  const keys=['CN-PP','CN-PV','VN-PP','VN-PV'];
  const groups=Object.fromEntries(keys.map(key=>[key,{label:key,total:0,pod:0,known:0,unknownPod:0,counts:[0,0,0],values:[null,null,null]}]));
  for(const row of rows){
    const type=String(row.businessType||'').toUpperCase();
    if(!SHOPEE_TYPES.has(type))continue;
    const region=String(row.regionCode||'').toUpperCase();
    if(!['PP','PV'].includes(region))continue;
    const key=`${type==='SHOPEECN'?'CN':'VN'}-${region}`;
    const group=groups[key];group.total++;
    const item=truth(row);if(!item.pod)continue;group.pod++;
    let attempt=item.attempt;
    if(!attempt)attempt=clampAttempt(tracks.get(String(row.shipmentCode||'').trim().toUpperCase())||0);
    if(!attempt)attempt=fallbackAttempt(date,item.podDate);
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
    if(!snapshot)return res.json({ok:true,patchId:V143_HOME_TRUTH_ID,reportDate:date,available:false,core:null,dispatch:{}});
    const rows=sourceRows(snapshot);
    const counts={CE:0,CEAF:0,TBKH:0,ALI1688:0,SHOPEECN:0,SHOPEEVN:0,WHPP:0};
    for(const row of rows){const type=String(row.businessType||'').toUpperCase();if(Object.hasOwn(counts,type))counts[type]++;}
    const total=Object.values(counts).reduce((sum,value)=>sum+value,0);
    res.setHeader('Cache-Control','private, max-age=5');
    res.json({ok:true,patchId:V143_HOME_TRUTH_ID,reportDate:date,available:true,snapshotId:snapshot.snapshotId,total,counts,core:coreSummary(rows),dispatch:dispatchSummary(rows,date)});
  }catch(error){console.error('[CE-QC][V143][HOME_TRUTH]',error?.stack||error);res.status(500).json({ok:false,patchId:V143_HOME_TRUTH_ID,error:error?.message||String(error)});}
}

const previousListen=express.application.listen;let installed=false;
express.application.listen=function v143HomeTruthListen(...args){if(!installed){installed=true;this.get('/api/v143/home-truth',handler);}return previousListen.apply(this,args);};
