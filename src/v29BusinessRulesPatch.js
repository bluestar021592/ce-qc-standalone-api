import express from 'express';
import { getDb } from './db.js';

const BUSINESS_TYPES = ['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const SPECIAL_NORMAL = new Set(['SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION','仓库自提','自提','580滞留包裹','CECN滞留包裹','CEZT滞留包裹','正常分流节点']);

function isoDate(value='') {
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function safeJson(value,fallback={}) { try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;} }
function number(value){ const n=Number(value); return Number.isFinite(n)?n:0; }
function upper(value){ return String(value||'').trim().toUpperCase(); }

function latestValidCte() {
  // Detail drill-down must follow the currently selected VALID import, even while
  // its processing snapshot is still running/failed. Requiring COMPLETED here was
  // the reason a dashboard could show a metric but clicking it returned 0 rows.
  return `WITH latest AS (
    SELECT b.reportDate,b.snapshotId
    FROM unified_import_batches b
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
      AND NOT EXISTS (
        SELECT 1 FROM unified_import_batches newer
        WHERE newer.status='VALID' AND newer.reportDate=b.reportDate AND newer.createdAt>b.createdAt
      )
  )`;
}

function normalizeScope(rawType) {
  const type=upper(rawType);
  if(BUSINESS_TYPES.includes(type)) return {type,exact:true,shopee:SHOPEE_TYPES.has(type)};
  if(type==='SHOPEE') return {type:'SHOPEE',exact:false,shopee:true};
  return {type:'CCSL',exact:false,shopee:false};
}

function ccslCondition(tab) {
  const clean=String(tab||'allData');
  const map={
    allData:'1=1',
    podClosed:'COALESCE(isPod,0)=1',
    accountingReturned:"COALESCE(isPod,0)=0 AND (returnState='已退回' OR UPPER(COALESCE(primaryCategory,'')) LIKE '%RETURN%' OR primaryCategory LIKE '%退回%')",
    accountingOpen:"COALESCE(isPod,0)=0 AND NOT (returnState='已退回' OR UPPER(COALESCE(primaryCategory,'')) LIKE '%RETURN%' OR primaryCategory LIKE '%退回%')",
    pendingAll:'COALESCE(pendingDays,0)>=1', pending1:'COALESCE(pendingDays,0)>=1', pending2plus:'COALESCE(pendingDays,0)>=2', pending3:'COALESCE(pendingDays,0)>=3',
    pendingNonContinuous:"COALESCE(pendingContinuity,'')='不连续'",
    ocAll:'COALESCE(ocDays,0)>=1', oc1:'COALESCE(ocDays,0)>=1', oc2plus:'COALESCE(ocDays,0)>=2', oc3:'COALESCE(ocDays,0)>=3',
    cycle2:'COALESCE(cycleDays,0)>=2', cycle2plus:'COALESCE(cycleDays,0)>=2',
    inboundNoScan:"primaryCategory LIKE '%入库无扫描%'", workOrderAbnormal:"primaryCategory LIKE '%工单%'",
    provinceOpen:"UPPER(COALESCE(regionCode,''))='PV' AND COALESCE(isPod,0)=0 AND NOT (returnState='已退回' OR primaryCategory LIKE '%退回%')",
    severeAbnormal:"COALESCE(pendingDays,0)>=3 OR COALESCE(ocDays,0)>=3 OR primaryCategory LIKE '%严重%'",
    cecnRetention:"UPPER(COALESCE(primaryCategory,''))='CECN_RETENTION' OR primaryCategory='CECN滞留包裹'",
    ceztRetention:"UPPER(COALESCE(primaryCategory,''))='CEZT_RETENTION' OR primaryCategory='CEZT滞留包裹'",
    ccsl580Retention:"UPPER(COALESCE(primaryCategory,''))='CCSL580_RETENTION' OR primaryCategory='580滞留包裹'",
    shopTransit:"COALESCE(shopState,'')='SHOP_TRANSFER_IN_PROGRESS'",
    shopArrived:"COALESCE(shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(shopRetentionNaturalDays,0)<2",
    shopStuck:"COALESCE(shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(shopRetentionNaturalDays,0)>=2",
    deliveryAll:'COALESCE(deliveryDays,0)>=1'
  };
  return map[clean]||'1=1';
}

function shopeeCondition(tab,attempt=0) {
  const clean=String(tab||'all').replace(/^(ALL|CN|VN|OTHER)_/,'');
  if(attempt===1||clean==='firstAttempt') return 'COALESCE(isPod,0)=1 AND COALESCE(podAttemptNo,0)=1';
  if(attempt===2||clean==='secondAttempt') return 'COALESCE(isPod,0)=1 AND COALESCE(podAttemptNo,0)=2';
  if(attempt===3||clean==='thirdAttempt') return 'COALESCE(isPod,0)=1 AND COALESCE(podAttemptNo,0)>=3';
  const map={
    all:'1=1', pod:'COALESCE(isPod,0)=1',
    returned:"returnState='已退回' OR primaryCategory='退回' OR UPPER(COALESCE(currentState,'')) IN ('RETURNED','RETURN_COMPLETED')",
    unresolved:"COALESCE(isPod,0)=0 AND NOT (returnState='已退回' OR primaryCategory='退回' OR UPPER(COALESCE(currentState,'')) IN ('RETURNED','RETURN_COMPLETED'))",
    pending1:'COALESCE(pendingDays,0)>=1', pending2:'COALESCE(pendingDays,0)>=2', pending3:'COALESCE(pendingDays,0)>=3',
    pendingNonContinuous:"COALESCE(pendingContinuity,'')='不连续' OR pendingNonContinuous='是'",
    oc1:'COALESCE(ocDays,0)>=1', oc2:'COALESCE(ocDays,0)>=2', oc3:'COALESCE(ocDays,0)>=3',
    cycle2:'COALESCE(cycleDays,0)>=2',
    inboundNoScan:"inboundNoScan='是' OR primaryCategory LIKE '%入库无扫描%'",
    returnRequired:"returnRequired='是' OR primaryCategory IN ('三次Pending后未退回','三次Pending后继续派送')",
    deliveryStay:"COALESCE(deliveryDays,0)>0 OR primaryCategory='派送中停留'",
    pvDelivery:"pvDisposition IN ('PV_DELIVERY_IN_PROGRESS','PV_DELIVERY_STALE')",
    pvStoreRetention:"pvDisposition='PV_STORE_RETENTION'",
    pvStoreInboundNoScan:"pvDisposition='PV_STORE_NORMAL'",
    pvOtherUnresolved:"pvDisposition IN ('PV_OTHER_UNRESOLVED','PV_OTHER_PROGRESS')"
  };
  return map[clean]||'1=1';
}

function queryMetricRows({businessType,fromDate,toDate,tab,page=1,pageSize=200,region='',attempt=0}) {
  const scope=normalizeScope(businessType), db=getDb(), offset=(page-1)*pageSize;
  const typeFilter=scope.exact?'u.businessType=?':(scope.shopee?"u.businessType IN ('SHOPEECN','SHOPEEVN')":"u.businessType IN ('CE','TBKH','ALI1688')");
  const typeParams=scope.exact?[scope.type]:[];
  const regionClause=['PP','PV'].includes(region)?"AND UPPER(COALESCE(regionCode,''))=?":'';
  const regionParams=['PP','PV'].includes(region)?[region]:[];
  let sqlBase,condition;
  if(!scope.shopee){
    condition=ccslCondition(tab);
    sqlBase=`${latestValidCte()}, base AS (
      SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
             f.isPod,f.primaryCategory,f.pendingDays,f.ocDays,f.cycleCountDays AS cycleDays,f.deliveringDays AS deliveryDays,
             f.lastEventDesc,f.lastEventTime,f.customerName,f.pickupShop,f.deliveryShop,f.shopState,f.shopRetentionNaturalDays,f.rawJson,
             COALESCE(json_extract(f.rawJson,'$."Pending连续性"'),'') AS pendingContinuity,
             COALESCE(json_extract(f.rawJson,'$."退回状态"'),'') AS returnState
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE ${typeFilter}
    )`;
  }else{
    condition=shopeeCondition(tab,attempt);
    sqlBase=`${latestValidCte()}, base AS (
      SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
             f.isPod,f.primaryCategory,f.latestEventDesc AS lastEventDesc,f.latestEventTime AS lastEventTime,
             f.recipient_raw,f.recipient_normalized,f.currentMainCategory,f.shopState,f.shopRetentionNaturalDays,f.podAttemptNo,f.currentAttemptNo,f.rawJson,
             COALESCE(json_extract(f.rawJson,'$."退回状态"'),'') AS returnState,
             COALESCE(json_extract(f.rawJson,'$.currentState'),'') AS currentState,
             COALESCE(CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),0) AS pendingDays,
             COALESCE(json_extract(f.rawJson,'$."Pending连续性"'),'') AS pendingContinuity,
             COALESCE(json_extract(f.rawJson,'$."Pending不连续"'),'') AS pendingNonContinuous,
             COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0) AS ocDays,
             COALESCE(CAST(json_extract(f.rawJson,'$."盘点天数"') AS INTEGER),0) AS cycleDays,
             COALESCE(CAST(json_extract(f.rawJson,'$."派送中停留天数"') AS INTEGER),0) AS deliveryDays,
             COALESCE(json_extract(f.rawJson,'$."入库无扫描节点"'),'') AS inboundNoScan,
             COALESCE(json_extract(f.rawJson,'$."退回待处理"'),'') AS returnRequired,
             COALESCE(json_extract(f.rawJson,'$.pvOpenDisposition'),'') AS pvDisposition
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE ${typeFilter}
    )`;
  }
  const params=[fromDate,toDate,...typeParams];
  const count=number(db.prepare(`${sqlBase} SELECT COUNT(*) AS count FROM base WHERE (${condition}) ${regionClause}`).get(...params,...regionParams)?.count);
  const rows=db.prepare(`${sqlBase} SELECT * FROM base WHERE (${condition}) ${regionClause} ORDER BY reportDate DESC,lastEventTime DESC,shipmentCode LIMIT ? OFFSET ?`).all(...params,...regionParams,pageSize,offset);
  return {count,rows:rows.map(row=>decorateDetailRow(row,scope.type))};
}

function decorateDetailRow(row,type) {
  const raw=safeJson(row.rawJson,{});
  const result={...raw,...row,businessType:row.businessType||type,运单号:row.shipmentCode,shipmentCode:row.shipmentCode,
    区域:row.regionCode||raw.区域||'',最新节点:row.lastEventDesc||raw.最新节点||raw.最后节点||'',
    最新时间:row.lastEventTime||raw.最新时间||raw.最后节点时间||'',当前分类:row.primaryCategory||raw.当前分类||raw.异常分类||'',
    POD状态:number(row.isPod)===1?'POD':'未POD'};
  delete result.rawJson;
  return result;
}

function metricDetailHandler(req,res){
  try{
    const businessType=upper(req.query.businessType||'CCSL');
    const latest=getDb().prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get();
    const toDate=isoDate(req.query.to||req.query.reportDate)||isoDate(latest?.reportDate);
    const fromDate=isoDate(req.query.from)||toDate;
    if(!fromDate||!toDate||fromDate>toDate)return res.status(400).json({ok:false,error:'日期范围无效'});
    const tab=String(req.query.tab||'allData'), page=Math.max(1,number(req.query.page)||1), pageSize=Math.max(1,Math.min(200,number(req.query.pageSize)||200));
    const region=upper(req.query.region||''), attempt=[1,2,3].includes(number(req.query.attempt))?number(req.query.attempt):0;
    const result=queryMetricRows({businessType,fromDate,toDate,tab,page,pageSize,region,attempt});
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,businessType,fromDate,toDate,tab,region,attempt,page,pageSize,total:result.count,rows:result.rows,queryMode:'LATEST_VALID_IMPORT_V29'});
  }catch(error){console.error('[V29][METRIC_DETAIL]',error);res.status(500).json({ok:false,error:error.message||String(error)});}
}

function terminalReason(currentState,state){
  const category=String(state.primaryCategory||state.主分类||state.异常分类||'').trim();
  const special=upper(state.specialState||category);
  if(state.是否POD==='是'||upper(currentState)==='POD'||upper(state.currentState)==='POD'||category==='POD'||category==='POD闭环')return 'POD';
  if(state.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(upper(currentState))||['RETURNED','RETURN_COMPLETED'].includes(upper(state.currentState))||category==='退回')return 'RETURNED';
  if(SPECIAL_NORMAL.has(special)||SPECIAL_NORMAL.has(category)||state.matchedRule==='NORMAL_FINAL_HUB'||category==='正常分流节点')return special||category||'NORMAL_FINAL';
  return '';
}

function healCarryTerminalRows(){
  const db=getDb();
  const rows=db.prepare(`SELECT o.shipmentCode,o.status,o.stateJson AS oldJson,c.state AS currentState,c.stateJson AS currentJson
    FROM carryover_open_items o LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode
    WHERE UPPER(COALESCE(o.status,''))='OPEN'`).all();
  if(!rows.length)return 0;
  const update=db.prepare("UPDATE carryover_open_items SET status='CLOSED',closeReason=?,apiStatus='SUCCESS',updatedAt=? WHERE shipmentCode=? AND status='OPEN'");
  let changed=0; const now=new Date().toISOString();
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

function dateOnly(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function staleNaturalDays(value=''){
  const d=dateOnly(value); if(!d)return 0;
  const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return Math.max(0,Math.floor((Date.parse(`${now}T00:00:00Z`)-Date.parse(`${d}T00:00:00Z`))/86400000));
}

function abnormalReason(state,latestEventTime,currentState){
  if(terminalReason(currentState,state))return '';
  const apiText=`${state.API状态||''} ${state.查询状态||''} ${state.apiStatus||''}`;
  if(/失败|retry|pending_retry/i.test(apiText))return '';
  const category=String(state.primaryCategory||state.主分类||state.异常分类||'');
  const pending=number(state.Pending当前次数 ?? state.Pending次数 ?? state.pendingDistinctDayCount);
  const pendingContinuity=String(state.Pending连续性||state.pendingContinuity||'');
  const pendingNonContinuous=state.Pending不连续==='是'||pendingContinuity==='不连续';
  const oc=number(state.OC天数);
  const cycle=number(state.盘点天数);
  const delivery=number(state.派送中停留天数||state.派送中天数);
  const stale=staleNaturalDays(latestEventTime||state.latestEventTime||state.最后节点时间);
  const shopState=String(state.shopState||'');
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

function loadAbnormalCarry(status='OPEN',businessType='ALL',limit=100){
  healCarryTerminalRows();
  const db=getDb();
  const clauses=[],params=[];
  if(status!=='ALL'){clauses.push("UPPER(COALESCE(o.status,''))=?");params.push(status);}
  if(businessType!=='ALL'){clauses.push("UPPER(COALESCE(o.businessType,''))=?");params.push(businessType);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const source=db.prepare(`SELECT o.shipmentCode,UPPER(COALESCE(o.businessType,'')) AS businessType,o.sourceReportDate,o.lastReportDate,o.status,o.apiStatus,o.closeReason,
      o.stateJson AS oldJson,o.createdAt,o.updatedAt,c.state AS currentState,c.apiStatus AS currentApiStatus,c.lastEventTime AS currentLastEventTime,c.stateJson AS currentJson,c.updatedAt AS currentUpdatedAt
    FROM carryover_open_items o LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode ${where}
    ORDER BY COALESCE(c.updatedAt,o.updatedAt) DESC,o.sourceReportDate,o.shipmentCode`).all(...params);
  const items=[];
  for(const row of source){
    const state={...safeJson(row.oldJson,{}),...safeJson(row.currentJson,{})};
    const latestTime=String(row.currentLastEventTime||state.latestEventTime||state.最后节点时间||'');
    const reason=abnormalReason(state,latestTime,row.currentState);
    // OPEN view is an abnormal-monitor view, not a list of every unresolved parcel.
    if(status!=='CLOSED'&&!reason)continue;
    const latestNode=state.latestEventDesc||state.lastEventDesc||state.最新节点||state.最后节点||'';
    items.push({shipmentCode:row.shipmentCode,businessType:row.businessType,sourceReportDate:row.sourceReportDate,lastReportDate:row.lastReportDate,
      status:row.status,currentState:row.currentState||state.currentState||state.primaryCategory||'',apiStatus:row.currentApiStatus||row.apiStatus||'',
      latestNode,latestEventTime:latestTime,previousEventTime:safeJson(row.oldJson,{}).latestEventTime||safeJson(row.oldJson,{}).最后节点时间||'',
      hasNewNode:Boolean(latestTime&&latestTime!==(safeJson(row.oldJson,{}).latestEventTime||safeJson(row.oldJson,{}).最后节点时间||'')),
      daysOpen:staleNaturalDays(latestTime),category:state.primaryCategory||state.当前分类||state.异常分类||'',abnormalReason:reason,
      pendingDays:number(state.Pending当前次数 ?? state.Pending次数 ?? state.pendingDistinctDayCount),ocDays:number(state.OC天数),closeReason:row.closeReason||'',updatedAt:row.currentUpdatedAt||row.updatedAt||''});
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
    const data=loadAbnormalCarry(status,businessType,req.query.limit||req.query.pageSize);
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,status,businessType,...data,generatedAt:new Date().toISOString(),semantics:'BUSINESS_ABNORMAL_ONLY_V29'});
  }catch(error){console.error('[V29][CARRY]',error);res.status(500).json({ok:false,error:error.message||String(error)});}
}

let installed=false;
const previousListen=express.application.listen;
express.application.listen=function v29BusinessRulesListen(...args){
  if(!installed){
    installed=true;
    // Imported after V27 patches, this wrapper executes first at listen-time, so
    // these corrected handlers are registered before the legacy V27 handlers.
    this.get('/api/v27/metric-detail',metricDetailHandler);
    this.get('/api/v27/carry-monitor',carryHandler);
    this.get('/api/v27/carry-monitor-business',carryHandler);
  }
  return previousListen.apply(this,args);
};
