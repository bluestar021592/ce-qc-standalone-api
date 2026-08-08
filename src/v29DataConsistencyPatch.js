import express from 'express';
import { getDb } from './db.js';

const BUSINESS_TYPES = ['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

function isoDate(value='') {
  const date=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
}
function safeJson(value,fallback={}) { try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;} }
function json(alias,path){ return `CASE WHEN json_valid(${alias}.rawJson) THEN json_extract(${alias}.rawJson,'${path}') END`; }
function stateJson(alias,path){ return `CASE WHEN json_valid(${alias}.stateJson) THEN json_extract(${alias}.stateJson,'${path}') END`; }
function normalizeBusiness(value='ALL') { const type=String(value||'ALL').toUpperCase(); return BUSINESS_TYPES.includes(type)?type:'ALL'; }
function normalizeStatus(value='OPEN') { const status=String(value||'OPEN').toUpperCase(); return ['OPEN','CLOSED','ALL'].includes(status)?status:'OPEN'; }

function latestCte(){
  return `WITH latest AS (
    SELECT b.reportDate,b.snapshotId
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
      AND NOT EXISTS (
        SELECT 1 FROM unified_import_batches newer
        INNER JOIN unified_snapshots ns ON ns.snapshotId=newer.snapshotId AND ns.status='COMPLETED'
        WHERE newer.status='VALID' AND newer.reportDate=b.reportDate AND newer.createdAt>b.createdAt
      )
  )`;
}

function normalizeTab(tab='allData'){
  const raw=String(tab||'allData').trim();
  const aliases={
    'Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','Pending不连续':'pendingNonContinuous',
    'OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','签收件数':'podClosed','POD':'podClosed','POD率':'podClosed',
    '已退回件':'returned','退回件':'returned','退回率':'returned','当前未闭环':'unresolved','未闭环':'unresolved',
    '入库无扫描':'inboundNoScan','入库无扫描节点':'inboundNoScan','工单未处理':'workOrder','工单':'workOrder',
    '严重异常':'severe','盘点2天+':'cycle2','外省未完结POD件':'provinceOpen','门店滞留':'shopStuck',
    '门店途中':'shopTransit','门店入库':'shopArrived','CECN滞留包裹':'cecnRetention','CEZT滞留包裹':'ceztRetention',
    '580滞留包裹':'retention580','派送中':'deliveryStay','外省派送中':'pvDelivery','外省门店滞留':'pvStoreRetention',
    '外省门店入库无节点':'pvStoreInboundNoScan','外省其他未闭环':'pvOtherUnresolved'
  };
  return aliases[raw]||raw.replace(/^(ALL|CN|VN|OTHER)_/,'');
}

function ccslCondition(tab){
  const open=`COALESCE(isPod,0)=0 AND returned=0 AND specialClosed=0`;
  const map={
    allData:'1=1',all:'1=1',podClosed:'COALESCE(isPod,0)=1',pod:'COALESCE(isPod,0)=1',returned:'returned=1',accountingReturned:'returned=1',
    unresolved:open,accountingOpen:open,
    pendingAll:'pendingDays>=1',pending1:'pendingDays>=1',pending2plus:'pendingDays>=2',pending2:'pendingDays>=2',pending3:'pendingDays>=3',pendingNonContinuous:"pendingContinuity='不连续'",
    ocAll:'ocDays>=1',oc1:'ocDays>=1',oc2plus:'ocDays>=2',oc2:'ocDays>=2',oc3:'ocDays>=3',cycle2:'cycleDays>=2',
    inboundNoScan:"primaryCategory LIKE '%入库无扫描%' OR inboundNoScan='是'",workOrder:"primaryCategory LIKE '%工单%'",workOrderAbnormal:"primaryCategory LIKE '%工单%'",
    severe:'pendingDays>=3 OR ocDays>=3 OR primaryCategory LIKE "%严重%"',severeAbnormal:'pendingDays>=3 OR ocDays>=3 OR primaryCategory LIKE "%严重%"',
    provinceOpen:`UPPER(COALESCE(regionCode,''))='PV' AND ${open}`,
    cecnRetention:"UPPER(COALESCE(primaryCategory,''))='CECN_RETENTION'",ceztRetention:"UPPER(COALESCE(primaryCategory,''))='CEZT_RETENTION'",retention580:"UPPER(COALESCE(primaryCategory,''))='CCSL580_RETENTION'",ccsl580Retention:"UPPER(COALESCE(primaryCategory,''))='CCSL580_RETENTION'",
    shopTransit:"shopState='SHOP_TRANSFER_IN_PROGRESS'",shopArrived:"shopState='SHOP_ARRIVED_CURRENT'",shopStuck:"shopState='SHOP_ARRIVED_CURRENT' AND shopRetentionDays>=2"
  };
  return map[tab]||'1=1';
}

function shopeeCondition(tab,attempt=0){
  if(attempt===1||tab==='firstAttempt')return 'COALESCE(isPod,0)=1 AND podAttemptNo=1';
  if(attempt===2||tab==='secondAttempt')return 'COALESCE(isPod,0)=1 AND podAttemptNo=2';
  if(attempt===3||tab==='thirdAttempt')return 'COALESCE(isPod,0)=1 AND podAttemptNo>=3';
  const open=`COALESCE(isPod,0)=0 AND returned=0 AND specialClosed=0`;
  const map={
    all:'1=1',allData:'1=1',pod:'COALESCE(isPod,0)=1',podClosed:'COALESCE(isPod,0)=1',returned:'returned=1',unresolved:open,
    pending1:'pendingDays>=1',pending2:'pendingDays>=2',pending3:'pendingDays>=3',pendingNonContinuous:"pendingContinuity='不连续'",
    oc1:'ocDays>=1',oc2:'ocDays>=2',oc3:'ocDays>=3',cycle2:'cycleDays>=2',inboundNoScan:"inboundNoScan='是' OR primaryCategory LIKE '%入库无扫描%'",
    deliveryStay:"deliveryDays>0 OR primaryCategory='派送中停留'",pvDelivery:"pvDisposition='PV_DELIVERY_IN_PROGRESS'",pvStoreRetention:"pvDisposition='PV_STORE_RETENTION'",
    pvStoreInboundNoScan:"pvDisposition='PV_STORE_INBOUND_NO_SCAN'",pvOtherUnresolved:"pvDisposition='PV_OTHER_UNRESOLVED'",
    shopTransit:"shopState='SHOP_TRANSFER_IN_PROGRESS'",shopArrived:"shopState='SHOP_ARRIVED_CURRENT'",shopStuck:"shopState='SHOP_ARRIVED_CURRENT' AND shopRetentionDays>=2",
    cecnRetention:"UPPER(COALESCE(primaryCategory,''))='CECN_RETENTION'",ceztRetention:"UPPER(COALESCE(primaryCategory,''))='CEZT_RETENTION'",retention580:"UPPER(COALESCE(primaryCategory,''))='CCSL580_RETENTION'"
  };
  return map[tab]||'1=1';
}

function metricRows({businessType,fromDate,toDate,tab,page,pageSize,region,attempt}){
  const db=getDb();
  const exact=BUSINESS_TYPES.includes(businessType);
  const shopee=SHOPEE_TYPES.has(businessType)||businessType==='SHOPEE';
  const typeFilter=exact?'u.businessType=?':(shopee?"u.businessType IN ('SHOPEECN','SHOPEEVN')":"u.businessType IN ('CE','TBKH','ALI1688')");
  const typeParams=exact?[businessType]:[];
  const regionClause=['PP','PV'].includes(region)?" AND UPPER(COALESCE(regionCode,''))=?":'';
  const regionParams=['PP','PV'].includes(region)?[region]:[];
  let base,condition;
  if(!shopee){
    base=`${latestCte()}, base AS (
      SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
        COALESCE(f.isPod,0) AS isPod,COALESCE(f.primaryCategory,f.category,'') AS primaryCategory,
        COALESCE(f.pendingDays,CAST(${json('f','$."Pending次数"')} AS INTEGER),CAST(${json('f','$."Pending当前次数"')} AS INTEGER),0) AS pendingDays,
        COALESCE(f.ocDays,CAST(${json('f','$."OC天数"')} AS INTEGER),0) AS ocDays,
        COALESCE(f.cycleCountDays,CAST(${json('f','$."盘点天数"')} AS INTEGER),0) AS cycleDays,
        COALESCE(f.deliveringDays,CAST(${json('f','$."派送中停留天数"')} AS INTEGER),0) AS deliveryDays,
        COALESCE(${json('f','$."Pending连续性"')},'') AS pendingContinuity,
        COALESCE(${json('f','$."入库无扫描节点"')},'') AS inboundNoScan,
        COALESCE(f.shopState,'') AS shopState,COALESCE(f.shopRetentionNaturalDays,0) AS shopRetentionDays,
        f.lastEventDesc,f.lastEventTime,f.customerName,f.pickupShop,f.deliveryShop,f.rawJson,
        CASE WHEN COALESCE(${json('f','$."退回状态"')},'')='已退回' OR UPPER(COALESCE(${json('f','$.currentState')},'')) IN ('RETURNED','RETURN_COMPLETED') OR COALESCE(f.primaryCategory,f.category,'')='退回' THEN 1 ELSE 0 END AS returned,
        CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION') OR COALESCE(f.primaryCategory,'')='仓库自提' THEN 1 ELSE 0 END AS specialClosed,
        0 AS podAttemptNo,'' AS pvDisposition
      FROM latest l INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE ${typeFilter}
    )`;
    condition=ccslCondition(tab);
  }else{
    base=`${latestCte()}, base AS (
      SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
        COALESCE(f.isPod,0) AS isPod,COALESCE(f.primaryCategory,'') AS primaryCategory,
        COALESCE(CAST(${json('f','$."Pending次数"')} AS INTEGER),CAST(${json('f','$."Pending当前次数"')} AS INTEGER),0) AS pendingDays,
        COALESCE(CAST(${json('f','$."OC天数"')} AS INTEGER),0) AS ocDays,COALESCE(CAST(${json('f','$."盘点天数"')} AS INTEGER),0) AS cycleDays,
        COALESCE(CAST(${json('f','$."派送中停留天数"')} AS INTEGER),0) AS deliveryDays,COALESCE(${json('f','$."Pending连续性"')},'') AS pendingContinuity,
        COALESCE(${json('f','$."入库无扫描节点"')},'') AS inboundNoScan,COALESCE(f.shopState,'') AS shopState,COALESCE(f.shopRetentionNaturalDays,0) AS shopRetentionDays,
        COALESCE(f.podAttemptNo,CAST(${json('f','$.podAttemptNo')} AS INTEGER),0) AS podAttemptNo,COALESCE(${json('f','$.pvOpenDisposition')},'') AS pvDisposition,
        f.latestEventDesc AS lastEventDesc,f.latestEventTime AS lastEventTime,f.recipient_raw,f.rawJson,
        CASE WHEN COALESCE(${json('f','$."退回状态"')},'')='已退回' OR UPPER(COALESCE(${json('f','$.currentState')},'')) IN ('RETURNED','RETURN_COMPLETED') OR COALESCE(f.primaryCategory,'')='退回' THEN 1 ELSE 0 END AS returned,
        CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION') OR COALESCE(f.primaryCategory,'')='仓库自提' THEN 1 ELSE 0 END AS specialClosed
      FROM latest l INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE ${typeFilter}
    )`;
    condition=shopeeCondition(tab,attempt);
  }
  const params=[fromDate,toDate,...typeParams];
  const total=Number(db.prepare(`${base} SELECT COUNT(*) AS count FROM base WHERE (${condition})${regionClause}`).get(...params,...regionParams)?.count||0);
  const rows=db.prepare(`${base} SELECT * FROM base WHERE (${condition})${regionClause} ORDER BY reportDate DESC,lastEventTime DESC,shipmentCode LIMIT ? OFFSET ?`).all(...params,...regionParams,pageSize,(page-1)*pageSize);
  return {total,rows:rows.map(row=>{
    const raw=safeJson(row.rawJson,{});
    const out={...raw,...row,运单号:row.shipmentCode,当前分类:row.primaryCategory||raw.当前分类||raw.异常分类||'',POD状态:Number(row.isPod||0)===1?'POD':(row.returned?'已退回':'未POD'),最新节点:row.lastEventDesc||raw.最新节点||raw.最后节点||'',最新时间:row.lastEventTime||raw.最新时间||raw.最后节点时间||''};
    delete out.rawJson;return out;
  })};
}

function metricDetailHandler(req,res){
  try{
    const businessType=String(req.query.businessType||'CCSL').toUpperCase();
    const toDate=isoDate(req.query.to||req.query.reportDate);const fromDate=isoDate(req.query.from)||toDate;
    if(!fromDate||!toDate||fromDate>toDate)return res.status(400).json({ok:false,error:'日期范围无效'});
    const tab=normalizeTab(req.query.tab||req.query.metric||'allData');
    const page=Math.max(1,Number(req.query.page||1));const pageSize=Math.max(1,Math.min(200,Number(req.query.pageSize||200)));
    const region=String(req.query.region||'').toUpperCase();const attempt=[1,2,3].includes(Number(req.query.attempt))?Number(req.query.attempt):0;
    const data=metricRows({businessType,fromDate,toDate,tab,page,pageSize,region,attempt});
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,businessType,fromDate,toDate,tab,region,attempt,page,pageSize,total:data.total,rows:data.rows,queryMode:'V29_SAME_SOURCE_AS_DASHBOARD'});
  }catch(error){console.error('[V29][METRIC_DETAIL]',error);res.status(500).json({ok:false,error:error.message||String(error)});}
}

function carryBaseSql(){
  return `WITH latest_ccsl AS (
      SELECT f.* FROM final_rows f JOIN (SELECT shipmentCode,MAX(reportDate) reportDate FROM final_rows GROUP BY shipmentCode) x ON x.shipmentCode=f.shipmentCode AND x.reportDate=f.reportDate
    ), latest_shopee AS (
      SELECT f.* FROM business_final_rows f JOIN (SELECT shipmentCode,MAX(reportDate) reportDate FROM business_final_rows WHERE businessType='SHOPEE' GROUP BY shipmentCode) x ON x.shipmentCode=f.shipmentCode AND x.reportDate=f.reportDate WHERE f.businessType='SHOPEE'
    ), latest_ce_event AS (
      SELECT shipmentCode,eventTime,COALESCE(trackingEventDescZh,trackingEventDesc,place,'') AS eventDesc FROM (
        SELECT e.*,ROW_NUMBER() OVER(PARTITION BY shipmentCode ORDER BY eventTime DESC,id DESC) rn FROM track_events e
      ) WHERE rn=1
    ), latest_shopee_event AS (
      SELECT shipmentCode,eventTime,COALESCE(${json('e','$.trackingEventDescZh')},${json('e','$.trackingEventDesc')},${json('e','$.eventDesc')},'') AS eventDesc FROM (
        SELECT e.*,ROW_NUMBER() OVER(PARTITION BY shipmentCode ORDER BY eventTime DESC,id DESC) rn FROM business_track_events e WHERE businessType='SHOPEE'
      ) e WHERE rn=1
    ), base AS (
      SELECT o.shipmentCode,UPPER(COALESCE(o.businessType,'')) businessType,o.sourceReportDate,o.lastReportDate,o.status rawStatus,o.closeReason rawCloseReason,o.createdAt,
        COALESCE(c.updatedAt,o.updatedAt,'') effectiveUpdatedAt,
        COALESCE(CASE WHEN UPPER(o.businessType) IN ('SHOPEECN','SHOPEEVN') THEN se.eventTime ELSE ce.eventTime END,
          CASE WHEN UPPER(o.businessType) IN ('SHOPEECN','SHOPEEVN') THEN sf.latestEventTime ELSE cf.lastEventTime END,c.lastEventTime,'') latestEventTime,
        COALESCE(CASE WHEN UPPER(o.businessType) IN ('SHOPEECN','SHOPEEVN') THEN se.eventDesc ELSE ce.eventDesc END,
          CASE WHEN UPPER(o.businessType) IN ('SHOPEECN','SHOPEEVN') THEN sf.latestEventDesc ELSE cf.lastEventDesc END,
          ${stateJson('c','$.latestEventDesc')},${stateJson('c','$.lastEventDesc')},${stateJson('o','$.latestEventDesc')},${stateJson('o','$.lastEventDesc')},'') latestNode,
        COALESCE(CASE WHEN UPPER(o.businessType) IN ('SHOPEECN','SHOPEEVN') THEN sf.primaryCategory ELSE cf.primaryCategory END,
          ${stateJson('c','$.primaryCategory')},${stateJson('c','$.当前分类')},${stateJson('o','$.primaryCategory')},${stateJson('o','$.当前分类')},'') category,
        CAST(COALESCE(${stateJson('c','$.pendingDistinctDayCount')},${stateJson('c','$.Pending次数')},${stateJson('o','$.pendingDistinctDayCount')},${stateJson('o','$.Pending次数')},0) AS INTEGER) pendingDays,
        CAST(COALESCE(${stateJson('c','$.OC天数')},${stateJson('o','$.OC天数')},0) AS INTEGER) ocDays,
        CASE WHEN COALESCE(cf.isPod,0)=1 OR COALESCE(sf.isPod,0)=1 OR UPPER(COALESCE(c.state,''))='POD' OR COALESCE(${stateJson('c','$.是否POD')},'')='是' THEN 1 ELSE 0 END isPod,
        CASE WHEN COALESCE(${json('sf','$."退回状态"')},${json('cf','$."退回状态"')},${stateJson('c','$.退回状态')},${stateJson('o','$.退回状态')},'')='已退回' OR UPPER(COALESCE(c.state,'')) IN ('RETURNED','RETURN_COMPLETED') OR COALESCE(CASE WHEN UPPER(o.businessType) IN ('SHOPEECN','SHOPEEVN') THEN sf.primaryCategory ELSE cf.primaryCategory END,'')='退回' THEN 1 ELSE 0 END isReturned,
        CASE WHEN UPPER(COALESCE(CASE WHEN UPPER(o.businessType) IN ('SHOPEECN','SHOPEEVN') THEN sf.primaryCategory ELSE cf.primaryCategory END,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION') OR UPPER(COALESCE(c.state,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION') THEN 1 ELSE 0 END isSpecialClosed
      FROM carryover_open_items o LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode
      LEFT JOIN latest_ccsl cf ON cf.shipmentCode=o.shipmentCode LEFT JOIN latest_shopee sf ON sf.shipmentCode=o.shipmentCode
      LEFT JOIN latest_ce_event ce ON ce.shipmentCode=o.shipmentCode LEFT JOIN latest_shopee_event se ON se.shipmentCode=o.shipmentCode
    ), normalized AS (
      SELECT *,CASE WHEN isPod=1 OR isReturned=1 OR isSpecialClosed=1 THEN 1 ELSE 0 END effectiveClosed FROM base
    )`;
}

function carryData(status,businessType,limit){
  const db=getDb();const pageSize=Math.max(1,Math.min(100,Number(limit)||50));
  const clauses=[];const params=[];
  if(status==='OPEN')clauses.push('effectiveClosed=0');else if(status==='CLOSED')clauses.push('effectiveClosed=1');
  if(businessType!=='ALL'){clauses.push('businessType=?');params.push(businessType);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const base=carryBaseSql();
  const countsRows=db.prepare(`${base} SELECT businessType,COUNT(*) count FROM normalized ${status==='OPEN'?'WHERE effectiveClosed=0':status==='CLOSED'?'WHERE effectiveClosed=1':''} GROUP BY businessType`).all();
  const businessSummary=Object.fromEntries(BUSINESS_TYPES.map(t=>[t,0]));for(const row of countsRows)if(businessSummary[row.businessType]!==undefined)businessSummary[row.businessType]=Number(row.count||0);businessSummary.ALL=Object.values(businessSummary).reduce((a,b)=>a+b,0);
  const rows=db.prepare(`${base} SELECT *,CAST(MAX(0,julianday('now','localtime')-julianday(sourceReportDate)) AS INTEGER) daysOpen FROM normalized ${where} ORDER BY effectiveUpdatedAt DESC,sourceReportDate,shipmentCode LIMIT ?`).all(...params,pageSize).map(row=>({
    shipmentCode:row.shipmentCode,businessType:row.businessType,sourceReportDate:row.sourceReportDate,lastReportDate:row.lastReportDate,status:row.effectiveClosed?'CLOSED':'OPEN',
    currentState:row.isPod?'POD':row.isReturned?'RETURN_COMPLETED':row.category||'OPEN',apiStatus:'SUCCESS',latestNode:row.latestNode||'',latestEventTime:row.latestEventTime||'',previousEventTime:'',hasNewNode:false,
    daysOpen:Number(row.daysOpen||0),category:row.isPod?'POD':row.isReturned?'退回':row.category||'',pendingDays:Number(row.pendingDays||0),ocDays:Number(row.ocDays||0),
    closeReason:row.isPod?'POD':row.isReturned?'RETURNED':row.isSpecialClosed?'NORMAL_SPECIAL_NODE':'',updatedAt:row.effectiveUpdatedAt||''
  }));
  const summary={total:rows.length,newNode:rows.filter(r=>r.hasNewNode).length,stale3:rows.filter(r=>r.daysOpen>=3&&!r.hasNewNode&&r.status==='OPEN').length,closed:rows.filter(r=>r.status==='CLOSED').length};
  return {rows,pageSize,businessSummary,summary};
}

function carryHandler(req,res){
  try{
    const status=normalizeStatus(req.query.status);const businessType=normalizeBusiness(req.query.businessType);const data=carryData(status,businessType,req.query.limit||req.query.pageSize);
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,status,businessType,businessSummary:data.businessSummary,summary:data.summary,rows:data.rows,pageSize:data.pageSize,generatedAt:new Date().toISOString(),queryMode:'V29_LATEST_PERSISTED_EVIDENCE'});
  }catch(error){console.error('[V29][CARRY]',error);res.status(500).json({ok:false,error:error.message||String(error)});}
}

let installed=false;const previousListen=express.application.listen;
express.application.listen=function v29DataConsistencyListen(...args){
  if(!installed){installed=true;this.get('/api/v29/metric-detail',metricDetailHandler);this.get('/api/v29/carry-monitor',carryHandler);}
  return previousListen.apply(this,args);
};
