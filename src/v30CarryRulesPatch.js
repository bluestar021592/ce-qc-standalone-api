import express from 'express';
import { getDb } from './db.js';

const BUSINESS_TYPES = ['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const SPECIAL_NORMAL = new Set([
  'SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION',
  '仓库自提','自提','580滞留包裹','CECN滞留包裹','CEZT滞留包裹','正常分流节点'
]);

function safeJson(value,fallback={}) { try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;} }
function number(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function upper(value){return String(value||'').trim().toUpperCase();}
function dateOnly(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function staleNaturalDays(value=''){
  const d=dateOnly(value);if(!d)return 0;
  const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return Math.max(0,Math.floor((Date.parse(`${now}T00:00:00Z`)-Date.parse(`${d}T00:00:00Z`))/86400000));
}

function terminalReason(currentState,state){
  const category=String(state.primaryCategory||state.主分类||state.异常分类||'').trim();
  const special=upper(state.specialState||category);
  if(state.是否POD==='是'||upper(currentState)==='POD'||upper(state.currentState)==='POD'||category==='POD'||category==='POD闭环')return 'POD';
  if(state.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(upper(currentState))||['RETURNED','RETURN_COMPLETED'].includes(upper(state.currentState))||category==='退回')return 'RETURNED';
  if(SPECIAL_NORMAL.has(special)||SPECIAL_NORMAL.has(category)||state.matchedRule==='NORMAL_FINAL_HUB'||category==='正常分流节点')return special||category||'NORMAL_FINAL';
  return '';
}

function isReturnInProgress(state,currentState){
  const current=upper(currentState||state.currentState);
  const category=String(state.primaryCategory||state.主分类||state.异常分类||'');
  return current==='RETURN_IN_PROGRESS'||state.退回状态==='退回处理中'||category==='退回处理中';
}

function abnormalReason(state,latestEventTime,currentState){
  if(terminalReason(currentState,state))return '';
  // 84 return-in-progress is a normal operational state. It remains OPEN for
  // continued tracking to code 86, but must never appear in inherited anomalies.
  if(isReturnInProgress(state,currentState))return '';

  const apiText=`${state.API状态||''} ${state.查询状态||''} ${state.apiStatus||''}`;
  if(/失败|retry|pending_retry/i.test(apiText))return '';

  const category=String(state.primaryCategory||state.主分类||state.异常分类||'');
  const stateName=upper(currentState||state.currentState);
  const region=upper(state.regionCode||state.区域);
  const shopState=String(state.shopState||'');
  const stale=staleNaturalDays(latestEventTime||state.latestEventTime||state.最后节点时间);

  // Provincial shops are a separate normal transit/retention dimension. A
  // shop-side 150/OC must not leak into the generic inherited anomaly monitor.
  // Their dedicated PV/store KPI remains available for operational follow-up.
  if(region==='PV'&&shopState)return '';
  if(['SHOP_PENDING','SHOP_OC'].includes(stateName)||['门店Pending','门店OC'].includes(category))return '';

  const pending=number(state.Pending当前次数 ?? state.Pending次数 ?? state.pendingDistinctDayCount);
  const pendingContinuity=String(state.Pending连续性||state.pendingContinuity||'');
  const pendingNonContinuous=state.Pending不连续==='是'||pendingContinuity==='不连续';
  const oc=number(state.OC天数);
  const cycle=number(state.盘点天数);
  const delivery=number(state.派送中停留天数||state.派送中天数);
  const returnRequired=state.退回待处理==='是'||state.returnRequired===true||/三次Pending后/.test(category);

  if(returnRequired)return '三次Pending后未正常闭环';
  if(pending>=2&&pendingNonContinuous)return 'Pending不连续';
  if(pending>=3)return 'Pending3天+';
  if(oc>=2)return 'OC2天+';
  if(cycle>=2)return '盘点2天+';
  if(state.入库无扫描节点==='是'||/入库无扫描/.test(category))return '入库无扫描';
  if(/工单/.test(category))return '工单未处理';
  if(shopState==='SHOP_ARRIVED_CURRENT'&&stale>=2)return '门店滞留2天+';
  if(shopState==='SHOP_TRANSFER_IN_PROGRESS'&&stale>=2)return '门店途中2天+';
  if(delivery>=2&&stale>=1)return '派送停留2天+';
  if(/无轨迹/.test(category))return '无轨迹';
  if(stale>=3)return '3天+无新节点';
  return '';
}

function healCarryTerminalRows(){
  const db=getDb();
  const rows=db.prepare(`SELECT o.shipmentCode,o.stateJson AS oldJson,c.state AS currentState,c.stateJson AS currentJson
    FROM carryover_open_items o LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode
    WHERE UPPER(COALESCE(o.status,''))='OPEN'`).all();
  if(!rows.length)return 0;
  const update=db.prepare("UPDATE carryover_open_items SET status='CLOSED',closeReason=?,apiStatus='SUCCESS',updatedAt=? WHERE shipmentCode=? AND status='OPEN'");
  let changed=0;const now=new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of rows){
      const state={...safeJson(row.oldJson,{}),...safeJson(row.currentJson,{})};
      const reason=terminalReason(row.currentState,state);
      if(!reason)continue;
      changed+=number(update.run(reason,now,row.shipmentCode).changes);
    }
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return changed;
}

function loadCarry(status='OPEN',businessType='ALL',limit=100){
  healCarryTerminalRows();
  const db=getDb(),clauses=[],params=[];
  if(status!=='ALL'){clauses.push("UPPER(COALESCE(o.status,''))=?");params.push(status);}
  if(businessType!=='ALL'){clauses.push("UPPER(COALESCE(o.businessType,''))=?");params.push(businessType);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const source=db.prepare(`SELECT o.shipmentCode,UPPER(COALESCE(o.businessType,'')) AS businessType,o.sourceReportDate,o.lastReportDate,o.status,o.apiStatus,o.closeReason,
      o.stateJson AS oldJson,o.updatedAt,c.state AS currentState,c.apiStatus AS currentApiStatus,c.lastEventTime AS currentLastEventTime,c.stateJson AS currentJson,c.updatedAt AS currentUpdatedAt
    FROM carryover_open_items o LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode ${where}
    ORDER BY COALESCE(c.updatedAt,o.updatedAt) DESC,o.sourceReportDate,o.shipmentCode`).all(...params);
  const items=[];
  for(const row of source){
    const oldState=safeJson(row.oldJson,{}),state={...oldState,...safeJson(row.currentJson,{})};
    const latestTime=String(row.currentLastEventTime||state.latestEventTime||state.最后节点时间||'');
    const reason=abnormalReason(state,latestTime,row.currentState);
    if(status!=='CLOSED'&&!reason)continue;
    const previousTime=oldState.latestEventTime||oldState.最后节点时间||'';
    items.push({
      shipmentCode:row.shipmentCode,businessType:row.businessType,sourceReportDate:row.sourceReportDate,lastReportDate:row.lastReportDate,
      status:row.status,currentState:row.currentState||state.currentState||state.primaryCategory||'',apiStatus:row.currentApiStatus||row.apiStatus||'',
      latestNode:state.latestEventDesc||state.lastEventDesc||state.最新节点||state.最后节点||'',latestEventTime:latestTime,previousEventTime:previousTime,
      hasNewNode:Boolean(latestTime&&latestTime!==previousTime),daysOpen:staleNaturalDays(latestTime),category:state.primaryCategory||state.当前分类||state.异常分类||'',
      abnormalReason:reason,pendingDays:number(state.Pending当前次数 ?? state.Pending次数 ?? state.pendingDistinctDayCount),ocDays:number(state.OC天数),
      closeReason:row.closeReason||'',updatedAt:row.currentUpdatedAt||row.updatedAt||''
    });
  }
  const max=Math.max(1,Math.min(500,number(limit)||100));
  const rows=items.slice(0,max);
  const counts=Object.fromEntries(BUSINESS_TYPES.map(type=>[type,items.filter(row=>row.businessType===type).length]));
  return {rows,summary:{total:items.length,newNode:items.filter(r=>r.hasNewNode).length,stale3:items.filter(r=>r.daysOpen>=3&&!r.hasNewNode).length,closed:items.filter(r=>upper(r.status)==='CLOSED').length},businessSummary:{ALL:items.length,...counts},pageSize:max};
}

function carryHandler(req,res){
  try{
    const status=['OPEN','CLOSED','ALL'].includes(upper(req.query.status))?upper(req.query.status):'OPEN';
    const businessType=BUSINESS_TYPES.includes(upper(req.query.businessType))?upper(req.query.businessType):'ALL';
    const data=loadCarry(status,businessType,req.query.limit||req.query.pageSize);
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,status,businessType,...data,generatedAt:new Date().toISOString(),semantics:'BUSINESS_ABNORMAL_ONLY_V30'});
  }catch(error){console.error('[V30][CARRY]',error);res.status(500).json({ok:false,error:error.message||String(error)});}
}

let installed=false;
const previousListen=express.application.listen;
express.application.listen=function v30CarryRulesListen(...args){
  if(!installed){
    installed=true;
    this.get('/api/v27/carry-monitor',carryHandler);
    this.get('/api/v27/carry-monitor-business',carryHandler);
    this.get('/api/v30/carry-monitor',carryHandler);
  }
  return previousListen.apply(this,args);
};
