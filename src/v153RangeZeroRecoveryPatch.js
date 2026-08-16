import express from 'express';
import { getDb } from './db.js';

const PATCH_ID='2026-08-16-v153-range-zero-recovery-v1';
const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const CCSL=new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE=new Set(['SHOPEECN','SHOPEEVN']);

function iso(value=''){
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function n(value){const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;}
function pct(value,total){return total?Number((n(value)*100/n(total)).toFixed(2)):0;}
function safeJson(value){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||'{}'))||{});}catch{return{};}}
function stateOf(row={}){return String(row.currentState||row.persistedCurrentState||row.scanNormalizedState||row.state||'').trim().toUpperCase();}
function category(row={}){return String(row.primaryCategory||row.category||row.主分类||row.异常分类||row.当前分类||'').trim();}
function isPod(row={}){return n(row.isPod)===1||row.是否POD==='是'||row.POD状态==='POD'||stateOf(row)==='POD'||String(row.orderStatus??row.scanOrderStatus??'').trim()==='85';}
function isReturned(row={}){return !isPod(row)&&(row.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(stateOf(row))||String(row.orderStatus??row.scanOrderStatus??'').trim()==='100'||category(row)==='退回');}
function isCancelled(row={}){return !isPod(row)&&(row.订单取消==='是'||stateOf(row)==='ORDER_CANCELLED'||String(row.orderStatus??row.scanOrderStatus??'').trim()==='10'||category(row)==='订单取消');}
function pendingDays(row={}){return Math.max(n(row.pendingDays),n(row.Pending次数),n(row.Pending当前次数),n(row.pendingDistinctDayCount));}
function ocDays(row={}){return Math.max(n(row.ocDays),n(row.OC天数));}
function cycleDays(row={}){return Math.max(n(row.cycleCountDays),n(row.盘点天数));}
function deliveryDays(row={}){return Math.max(n(row.deliveringDays),n(row.派送中停留天数),n(row.deliveryDays));}
function pendingBroken(row={}){return row.Pending不连续==='是'||String(row.pendingContinuity||row.pendingFactDateContinuity||row.Pending事实连续性||'').includes('不连续');}
function inboundNoScan(row={}){return row.入库无扫描节点==='是'||/入库无扫描/.test(category(row));}
function region(value=''){const v=String(value||'').trim().toUpperCase();return v==='PP'?'PP':v==='PV'?'PV':'UNKNOWN';}
function uniqueDates(rows=[]){return [...new Set(rows.map(row=>String(row.reportDate||'')).filter(Boolean))].sort();}

function latestValidDates(throughDate='',limit=7){
  if(!iso(throughDate))return[];
  return getDb().prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? ORDER BY reportDate DESC LIMIT ?`).all(throughDate,Math.max(1,Math.min(60,n(limit)||7))).map(row=>String(row.reportDate||'')).filter(Boolean).sort();
}

function queryFacts(fromDate,toDate){
  if(!iso(fromDate)||!iso(toDate)||fromDate>toDate)return[];
  const rows=getDb().prepare(`
    WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
        ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) AS rn
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ), latest AS (
      SELECT reportDate,snapshotId FROM ranked WHERE rn=1
    ), valid AS (
      SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode,
        CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
             WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
             ELSE 'UNKNOWN' END AS regionCode
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN')
    )
    SELECT v.reportDate,v.businessType,v.shipmentCode,v.regionCode,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.isPod,0) ELSE COALESCE(cf.isPod,0) END AS isPod,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.primaryCategory,'') ELSE COALESCE(cf.primaryCategory,cf.category,'') END AS primaryCategory,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.rawJson,'{}') ELSE COALESCE(cf.rawJson,'{}') END AS rawJson,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN 0 ELSE COALESCE(cf.pendingDays,0) END AS pendingDays,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN 0 ELSE COALESCE(cf.ocDays,0) END AS ocDays,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN 0 ELSE COALESCE(cf.cycleCountDays,0) END AS cycleCountDays,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN 0 ELSE COALESCE(cf.deliveringDays,0) END AS deliveringDays,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.podAttemptNo,0) ELSE 0 END AS podAttemptNo,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.currentAttemptNo,0) ELSE 0 END AS currentAttemptNo
    FROM valid v
    LEFT JOIN final_rows cf
      ON v.businessType IN ('CE','CEAF','TBKH','ALI1688')
     AND cf.shipmentCode=v.shipmentCode AND cf.reportDate=v.reportDate
    LEFT JOIN business_final_rows sf
      ON v.businessType IN ('SHOPEECN','SHOPEEVN')
     AND sf.businessType='SHOPEE'
     AND sf.shipmentCode=v.shipmentCode AND sf.reportDate=v.reportDate
    ORDER BY v.reportDate,v.businessType,v.shipmentCode
  `).all(fromDate,toDate);
  return rows.map(row=>{
    const raw=safeJson(row.rawJson);
    return {
      ...raw,...row,
      shipmentCode:String(row.shipmentCode||raw.shipmentCode||raw.运单号||'').trim().toUpperCase(),
      businessType:String(row.businessType||raw.businessType||'').toUpperCase(),
      reportDate:iso(row.reportDate||raw.reportDate),
      regionCode:region(row.regionCode||raw.regionCode||raw.区域),
      primaryCategory:row.primaryCategory||raw.primaryCategory||raw.主分类||raw.异常分类||'',
      isPod:n(row.isPod||raw.isPod),
      pendingDays:Math.max(n(row.pendingDays),n(raw.pendingDays)),
      ocDays:Math.max(n(row.ocDays),n(raw.ocDays)),
      cycleCountDays:Math.max(n(row.cycleCountDays),n(raw.cycleCountDays)),
      deliveringDays:Math.max(n(row.deliveringDays),n(raw.deliveringDays)),
      podAttemptNo:Math.max(n(row.podAttemptNo),n(raw.podAttemptNo)),
      currentAttemptNo:Math.max(n(row.currentAttemptNo),n(raw.currentAttemptNo))
    };
  });
}

function attemptNo(row={}){
  if(!isPod(row))return 0;
  const explicit=Math.max(n(row.podAttemptNo),n(row.currentAttemptNo));
  if(explicit>0)return Math.min(3,Math.max(1,explicit));
  const rawDate=String(row.POD时间||row.podTime||row.podClosedAt||row.terminalObservedAt||'').trim().slice(0,10).replace(/\//g,'-');
  if(!iso(rawDate)||!iso(row.reportDate))return 0;
  const start=Date.parse(`${row.reportDate}T00:00:00Z`),end=Date.parse(`${rawDate}T00:00:00Z`);
  if(!Number.isFinite(start)||!Number.isFinite(end))return 0;
  return Math.min(3,Math.max(1,Math.floor((end-start)/86400000)+1));
}

function summary(rows=[]){
  const pod=rows.filter(isPod),returned=rows.filter(isReturned),cancelled=rows.filter(isCancelled);
  const open=rows.filter(row=>!isPod(row)&&!isReturned(row)&&!isCancelled(row));
  const a1=pod.filter(row=>attemptNo(row)===1).length,a2=pod.filter(row=>attemptNo(row)===2).length,a3=pod.filter(row=>attemptNo(row)>=3).length;
  const total=rows.length;
  return {
    total,pod:pod.length,podRate:pct(pod.length,total),returned:returned.length,returnRate:pct(returned.length,total),cancelled:cancelled.length,
    open:open.length,unresolved:open.length,
    pending1:open.filter(row=>pendingDays(row)>=1).length,pending2:open.filter(row=>pendingDays(row)>=2).length,pending3:open.filter(row=>pendingDays(row)>=3).length,pendingNonContinuous:open.filter(pendingBroken).length,
    oc1:open.filter(row=>ocDays(row)>=1).length,oc2:open.filter(row=>ocDays(row)>=2).length,oc3:open.filter(row=>ocDays(row)>=3).length,
    cycle2:open.filter(row=>cycleDays(row)>=2).length,inboundNoScan:open.filter(inboundNoScan).length,delivery:open.filter(row=>deliveryDays(row)>0||/派送中/.test(category(row))).length,
    dispatchAttempt1:a1,dispatchAttempt2:a2,dispatchAttempt3:a3,dispatchAttemptDenominator:total,
    dispatchAttempt1Rate:pct(a1,total),dispatchAttempt2Rate:pct(a2,total),dispatchAttempt3Rate:pct(a3,total),
    firstAttemptCount:a1,firstAttemptEligible:total,firstAttemptRate:pct(a1,total),firstPodRate:pct(a1,total),
    ocRate:pct(open.filter(row=>ocDays(row)>=1).length,total)
  };
}

function history(rows=[],type=''){
  const dates=uniqueDates(rows);
  return dates.map(reportDate=>{
    const day=rows.filter(row=>row.reportDate===reportDate);
    const all=summary(day),cn=summary(day.filter(row=>row.businessType==='SHOPEECN')),vn=summary(day.filter(row=>row.businessType==='SHOPEEVN'));
    const s={
      reportDate,today:all.total,pnh:all.total,todayPnh:all.total,todayPod:all.pod,scanPod:all.pod,podRate:all.podRate,firstPodRate:all.firstPodRate,ocRate:all.ocRate,
      metrics:{
        'ALL_今日总单':all.total,'ALL_POD率':all.podRate,'ALL_OC1+':all.oc1,'ALL_首派成功率':all.firstAttemptRate,
        'CN_今日总单':cn.total,'CN_POD率':cn.podRate,'CN_OC1+':cn.oc1,'CN_首派成功率':cn.firstAttemptRate,
        'VN_今日总单':vn.total,'VN_POD率':vn.podRate,'VN_OC1+':vn.oc1,'VN_首派成功率':vn.firstAttemptRate
      }
    };
    if(CCSL.has(type)){s['今日PNH']=all.total;s['今日POD']=all.pod;s['首投POD率']=all.podRate;s['OC1+']=all.oc1;}
    return {reportDate,summary:s};
  });
}

function ensureState(state={},type='',toDate=''){
  const value=state&&typeof state==='object'?state:{};
  value.businessType=value.businessType||type;
  value.viewBusinessType=value.viewBusinessType||type;
  value.reportDate=value.reportDate||toDate;
  value.dashboard=value.dashboard&&typeof value.dashboard==='object'?value.dashboard:{};
  value.dailyParseSummary=value.dailyParseSummary&&typeof value.dailyParseSummary==='object'?value.dailyParseSummary:{};
  return value;
}

function patchCcslState(state,type,rows,toDate){
  const value=ensureState(state,type,toDate),s=summary(rows);
  value.sourceTotal=s.total;
  value.dailyParseSummary.totalRecognized=s.total;
  value.v55Summary={...(value.v55Summary||{}),...s};
  value.historySummary=history(rows,type);
  Object.assign(value.dashboard,{pnh:s.total,totalMonitored:s.total,todayPod:s.pod,podRate:s.podRate,returned:s.returned,v55Summary:value.v55Summary});
  value.dashboard.categories={...(value.dashboard.categories||{}),pendingTotal:s.pending1,ocTotal:s.oc1};
  return value;
}

function assignShopeeMetrics(target,s){
  if(!target||typeof target!=='object')return;
  Object.assign(target,s,{
    total:s.total,pod:s.pod,podRate:s.podRate,returned:s.returned,unresolved:s.unresolved,
    dispatchAttempt1:s.dispatchAttempt1,dispatchAttempt2:s.dispatchAttempt2,dispatchAttempt3:s.dispatchAttempt3,
    dispatchAttemptDenominator:s.dispatchAttemptDenominator,dispatchAttempt1Rate:s.dispatchAttempt1Rate,dispatchAttempt2Rate:s.dispatchAttempt2Rate,dispatchAttempt3Rate:s.dispatchAttempt3Rate,
    firstAttemptCount:s.firstAttemptCount,firstAttemptEligible:s.firstAttemptEligible,firstAttemptRate:s.firstAttemptRate
  });
}

function patchShopeeState(state,type,rows,toDate){
  const value=ensureState(state,type,toDate),s=summary(rows),cn=summary(rows.filter(row=>row.businessType==='SHOPEECN')),vn=summary(rows.filter(row=>row.businessType==='SHOPEEVN'));
  value.sourceTotal=s.total;
  value.dailyParseSummary.totalRecognized=s.total;
  value.v55Summary={...(value.v55Summary||{}),...s};
  value.historySummary=history(rows,type);
  value.dashboard.metrics=value.dashboard.metrics&&typeof value.dashboard.metrics==='object'?value.dashboard.metrics:{};
  assignShopeeMetrics(value.dashboard.metrics,s);
  value.dashboard.v55Summary=value.v55Summary;
  value.dashboard.recipientGroups=value.dashboard.recipientGroups&&typeof value.dashboard.recipientGroups==='object'?value.dashboard.recipientGroups:{};
  for(const [key,data] of [['ALL',s],['CN',cn],['VN',vn]]){
    const group=value.dashboard.recipientGroups[key]&&typeof value.dashboard.recipientGroups[key]==='object'?value.dashboard.recipientGroups[key]:{};
    group.metrics=group.metrics&&typeof group.metrics==='object'?group.metrics:{};
    assignShopeeMetrics(group.metrics,data);
    value.dashboard.recipientGroups[key]=group;
  }
  return value;
}

function periodBody(req,body={}){
  const from=iso(body.fromDate||req.query?.from),to=iso(body.toDate||req.query?.to);
  if(!from||!to||from>to)return body;
  const facts=queryFacts(from,to);
  if(!facts.length)return body;
  const states={...(body.states||{})};
  for(const type of TYPES){
    const rows=facts.filter(row=>row.businessType===type);
    states[type]=CCSL.has(type)?patchCcslState(states[type],type,rows,to):patchShopeeState(states[type],type,rows,to);
  }
  const aggregates={...(body.aggregates||{})};
  aggregates.CCSL=patchCcslState(aggregates.CCSL,'CCSL',facts.filter(row=>CCSL.has(row.businessType)),to);
  aggregates.SHOPEE=patchShopeeState(aggregates.SHOPEE,'SHOPEE',facts.filter(row=>SHOPEE.has(row.businessType)),to);
  const dates=uniqueDates(facts);
  return {...body,states,aggregates,dates,sourceDates:dates,sourceTotal:facts.length,zeroRecovery:{patchId:PATCH_ID,source:'LATEST_VALID_IMPORT_PER_DATE',fromDate:from,toDate:to,total:facts.length}};
}

function trendWindow(req,body={}){
  const requestedTo=iso(req.query?.to||body.requestedToDate||body.toDate),requestedFrom=iso(req.query?.from||body.requestedFromDate||requestedTo)||requestedTo;
  if(!requestedTo)return null;
  if(requestedFrom===requestedTo){
    const dates=latestValidDates(requestedTo,7);
    if(!dates.length)return{from:requestedFrom,to:requestedTo,dates:[]};
    return{from:dates[0],to:dates.at(-1),dates};
  }
  return{from:requestedFrom,to:requestedTo,dates:[]};
}

function trendBody(req,body={}){
  const type=String(req.query?.businessType||body.businessType||'CCSL').trim().toUpperCase();
  if(type==='WHPP'||(!TYPES.includes(type)&&type!=='CCSL'&&type!=='SHOPEE'))return body;
  const window=trendWindow(req,body);
  if(!window||!iso(window.from)||!iso(window.to)||window.from>window.to)return body;
  let facts=queryFacts(window.from,window.to);
  facts=type==='CCSL'?facts.filter(row=>CCSL.has(row.businessType)):type==='SHOPEE'?facts.filter(row=>SHOPEE.has(row.businessType)):facts.filter(row=>row.businessType===type);
  if(!facts.length)return body;
  const allDates=window.dates.length?window.dates:uniqueDates(facts);
  const dates=allDates.slice(-7);
  const rowsByDate=new Map(dates.map(date=>[date,summary(facts.filter(row=>row.reportDate===date))]));
  const ticket=dates.map(date=>rowsByDate.get(date)?.total||0);
  const podRate=dates.map(date=>rowsByDate.get(date)?.podRate||0);
  const ocRate=dates.map(date=>rowsByDate.get(date)?.ocRate||0);
  const firstRate=dates.map(date=>rowsByDate.get(date)?.firstAttemptRate||0);
  const attempt1=dates.map(date=>rowsByDate.get(date)?.dispatchAttempt1Rate||0);
  const attempt2=dates.map(date=>rowsByDate.get(date)?.dispatchAttempt2Rate||0);
  const attempt3=dates.map(date=>rowsByDate.get(date)?.dispatchAttempt3Rate||0);
  const attempt1Count=dates.map(date=>rowsByDate.get(date)?.dispatchAttempt1||0);
  const attempt2Count=dates.map(date=>rowsByDate.get(date)?.dispatchAttempt2||0);
  const attempt3Count=dates.map(date=>rowsByDate.get(date)?.dispatchAttempt3||0);
  const attemptDenominator=dates.map(date=>rowsByDate.get(date)?.dispatchAttemptDenominator||0);
  return {...body,ok:true,businessType:type,fromDate:dates[0]||window.from,toDate:dates.at(-1)||window.to,trendWindowDates:dates,dates,ticket,podRate,ocRate,firstRate,attempt1,attempt2,attempt3,attempt1Count,attempt2Count,attempt3Count,attemptDenominator,historySource:'V153_LATEST_VALID_IMPORT_FACTS',zeroRecovery:{patchId:PATCH_ID,total:facts.length}};
}

function wrap(handler,pathValue){
  if(typeof handler!=='function')return handler;
  return function v153RangeRecoveryHandler(req,res,next){
    const oldJson=res.json.bind(res);
    res.json=function v153RangeRecoveryJson(body){
      let nextBody=body;
      try{
        if(pathValue==='/api/period-dashboard')nextBody=periodBody(req,body);
        else if(pathValue==='/api/v27/trends')nextBody=trendBody(req,body);
        if(nextBody?.zeroRecovery?.patchId)res.setHeader('X-CE-QC-Zero-Recovery',PATCH_ID);
      }catch(error){console.error('[V153][ZERO_RECOVERY]',pathValue,error);}
      return oldJson(nextBody);
    };
    return handler.call(this,req,res,next);
  };
}

const previousGet=express.application.get;
express.application.get=function v153RangeRecoveryGet(pathValue,...handlers){
  if(arguments.length===1)return previousGet.apply(this,arguments);
  if(pathValue==='/api/period-dashboard'||pathValue==='/api/v27/trends')return previousGet.call(this,pathValue,...handlers.map(handler=>wrap(handler,pathValue)));
  return previousGet.call(this,pathValue,...handlers);
};

let auditInstalled=false;
const previousListen=express.application.listen;
express.application.listen=function v153RangeRecoveryListen(...args){
  if(!auditInstalled){
    auditInstalled=true;
    this.get('/api/v153/fact-audit',(req,res)=>{
      try{
        const to=iso(req.query?.to),from=iso(req.query?.from)||to;
        if(!from||!to||from>to)return res.status(400).json({ok:false,patchId:PATCH_ID,error:'日期范围无效'});
        const facts=queryFacts(from,to),byType={};
        for(const type of TYPES){const rows=facts.filter(row=>row.businessType===type);byType[type]=summary(rows);}
        res.json({ok:true,patchId:PATCH_ID,fromDate:from,toDate:to,dates:uniqueDates(facts),total:facts.length,byType});
      }catch(error){res.status(500).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});}
    });
  }
  return previousListen.apply(this,args);
};

export const V153_RANGE_ZERO_RECOVERY_PATCH_ID=PATCH_ID;
