import express from 'express';
import { getDb } from './db.js';
import { updateCarryoverResults } from './unifiedImportStore.js';

const TYPES = new Set(['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN','CCSL','SHOPEE']);
const NORMAL_TERMINALS = new Set([
  'POD','RETURNED','RETURN_COMPLETED','RETURN','CEZT_RETENTION','CECN_RETENTION','CCSL580_RETENTION',
  'SELF_PICKUP','仓库自提','正常分流节点','最终分流排除','NORMAL_FINAL','NORMAL_FINAL_HUB'
]);

function safeJson(value, fallback={}) {
  try { return typeof value === 'string' ? (JSON.parse(value || '{}') || fallback) : (value || fallback); }
  catch { return fallback; }
}
function billOf(row={}) { return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase(); }
function isoDate(value='') { const v=String(value||'').trim().slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:''; }
function upper(value='') { return String(value||'').trim().toUpperCase(); }
function number(value) { const n=Number(value); return Number.isFinite(n)?n:0; }
function textHas(value, token) { return String(value||'').includes(token); }

function latestValidCte() {
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

function metricSourceRows({ businessType, fromDate, toDate }) {
  const db=getDb();
  const exact=['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].includes(businessType);
  const shopee=businessType==='SHOPEE'||businessType.startsWith('SHOPEE');
  const typeClause=exact?'u.businessType=?':(shopee?"u.businessType IN ('SHOPEECN','SHOPEEVN')":"u.businessType IN ('CE','TBKH','ALI1688')");
  const params=[fromDate,toDate,...(exact?[businessType]:[])];
  if(shopee){
    return db.prepare(`${latestValidCte()}
      SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,u.recipientRaw,u.recipientNormalized,u.rowJson AS importRowJson,
             f.isPod,f.primaryCategory,f.latestEventTime AS lastEventTime,f.latestEventDesc AS lastEventDesc,f.currentMainCategory,
             f.shopState,f.shopRetentionNaturalDays,f.podAttemptNo,f.currentAttemptNo,f.rawJson
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE ${typeClause}
      ORDER BY u.reportDate DESC,COALESCE(f.latestEventTime,'' ) DESC,u.shipmentCode`).all(...params);
  }
  return db.prepare(`${latestValidCte()}
    SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,u.recipientRaw,u.recipientNormalized,u.rowJson AS importRowJson,
           f.isPod,f.primaryCategory,f.pendingDays,f.ocDays,f.cycleCountDays,f.deliveringDays,f.lastEventDesc,f.lastEventTime,
           f.customerName,f.pickupShop,f.deliveryShop,f.shopState,f.shopRetentionNaturalDays,f.rawJson
    FROM latest l
    INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
    LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    WHERE ${typeClause}
    ORDER BY u.reportDate DESC,COALESCE(f.lastEventTime,'') DESC,u.shipmentCode`).all(...params);
}

function normalizedMetricRow(row={}) {
  const raw=safeJson(row.rawJson,{});
  const imported=safeJson(row.importRowJson,{});
  const pending=number(row.pendingDays ?? raw.Pending次数 ?? raw.Pending当前次数 ?? raw.pendingDistinctDayCount);
  const oc=number(row.ocDays ?? raw.OC天数);
  const cycle=number(row.cycleCountDays ?? raw.盘点天数);
  const delivery=number(row.deliveringDays ?? raw.派送中停留天数);
  const isPod=number(row.isPod)===1 || raw.是否POD==='是' || upper(raw.currentState)==='POD';
  const returnState=String(raw.退回状态 || raw.returnState || '');
  const category=String(row.primaryCategory || raw.primaryCategory || raw.主分类 || raw.异常分类 || '');
  const returned=returnState==='已退回' || upper(raw.currentState)==='RETURN_COMPLETED' || category==='退回' || /RETURN_COMPLETED/i.test(category);
  return {
    ...imported,...raw,...row,
    shipmentCode:billOf(row),运单号:billOf(row),
    POD状态:isPod?'POD':'未POD',是否POD:isPod?'是':'否',退回状态:returnState,
    当前分类:category,primaryCategory:category,
    Pending次数:pending,pendingDays:pending,OC天数:oc,ocDays:oc,盘点天数:cycle,cycleDays:cycle,派送中停留天数:delivery,deliveryDays:delivery,
    最新节点:row.lastEventDesc || raw.latestEventDesc || raw.lastEventDesc || raw.最新节点 || raw.最后节点 || '',
    最新时间:row.lastEventTime || raw.latestEventTime || raw.lastEventTime || raw.最新时间 || raw.最后节点时间 || '',
    regionCode:upper(row.regionCode || imported.regionCode || raw.regionCode),
    _pod:isPod,_returned:returned,
    pendingContinuity:String(raw.Pending连续性 || raw.pendingContinuity || ''),
    inboundNoScan:String(raw.入库无扫描节点 || ''),
    returnRequired:String(raw.退回待处理 || ''),
    pvDisposition:String(raw.pvOpenDisposition || ''),
    shopState:String(row.shopState || raw.shopState || ''),
    shopRetentionNaturalDays:number(row.shopRetentionNaturalDays ?? raw.shopRetentionNaturalDays),
    podAttemptNo:number(row.podAttemptNo ?? raw.podAttemptNo),
    currentAttemptNo:number(row.currentAttemptNo ?? raw.currentAttemptNo)
  };
}

function metricMatch(row, tab, attempt=0, region='') {
  const clean=String(tab||'allData').replace(/^(ALL|CN|VN|OTHER)_/,'');
  if(region && ['PP','PV'].includes(region) && row.regionCode!==region) return false;
  if(attempt===1 || clean==='firstAttempt') return row._pod && row.podAttemptNo===1;
  if(attempt===2 || clean==='secondAttempt') return row._pod && row.podAttemptNo===2;
  if(attempt===3 || clean==='thirdAttempt') return row._pod && row.podAttemptNo>=3;
  const map={
    allData:()=>true,all:()=>true,
    podClosed:()=>row._pod,pod:()=>row._pod,
    accountingReturned:()=>row._returned,returned:()=>row._returned,
    accountingOpen:()=>!row._pod&&!row._returned,unresolved:()=>!row._pod&&!row._returned,
    pendingAll:()=>row.pendingDays>=1,pending1:()=>row.pendingDays>=1,pending2plus:()=>row.pendingDays>=2,pending2:()=>row.pendingDays>=2,pending3:()=>row.pendingDays>=3,
    pendingNonContinuous:()=>row.pendingContinuity==='不连续',
    ocAll:()=>row.ocDays>=1,oc1:()=>row.ocDays>=1,oc2plus:()=>row.ocDays>=2,oc2:()=>row.ocDays>=2,oc3:()=>row.ocDays>=3,
    cycle2:()=>row.cycleDays>=2,
    inboundNoScan:()=>row.inboundNoScan==='是'||textHas(row.primaryCategory,'入库无扫描'),
    workOrderAbnormal:()=>textHas(row.primaryCategory,'工单'),
    provinceOpen:()=>row.regionCode==='PV'&&!row._pod&&!row._returned,
    severeAbnormal:()=>row.pendingDays>=3||row.ocDays>=3||textHas(row.primaryCategory,'严重'),
    cecnRetention:()=>upper(row.primaryCategory)==='CECN_RETENTION',ceztRetention:()=>upper(row.primaryCategory)==='CEZT_RETENTION',ccsl580Retention:()=>upper(row.primaryCategory)==='CCSL580_RETENTION',
    shopTransit:()=>row.shopState==='SHOP_TRANSFER_IN_PROGRESS',shopArrived:()=>row.shopState==='SHOP_ARRIVED_CURRENT',shopStuck:()=>row.shopState==='SHOP_ARRIVED_CURRENT'&&row.shopRetentionNaturalDays>=2,
    returnRequired:()=>row.returnRequired==='是'||['三次Pending后未退回','三次Pending后继续派送'].includes(row.primaryCategory),
    deliveryStay:()=>row.deliveryDays>0||row.primaryCategory==='派送中停留',
    pvDelivery:()=>row.pvDisposition==='PV_DELIVERY_IN_PROGRESS',pvStoreRetention:()=>row.pvDisposition==='PV_STORE_RETENTION',
    pvStoreInboundNoScan:()=>row.pvDisposition==='PV_STORE_INBOUND_NO_SCAN',pvOtherUnresolved:()=>row.pvDisposition==='PV_OTHER_UNRESOLVED'
  };
  return (map[clean]||map.allData)();
}

function v28MetricDetail(req,res){
  try{
    const businessType=upper(req.query.businessType||'CCSL');
    if(!TYPES.has(businessType)) return res.status(400).json({ok:false,error:'业务板块无效'});
    const toDate=isoDate(req.query.to||req.query.reportDate); const fromDate=isoDate(req.query.from)||toDate;
    if(!fromDate||!toDate||fromDate>toDate) return res.status(400).json({ok:false,error:'日期范围无效'});
    const tab=String(req.query.tab||'allData'); const region=upper(req.query.region||'');
    const attempt=[1,2,3].includes(Number(req.query.attempt))?Number(req.query.attempt):0;
    const page=Math.max(1,Number(req.query.page||1)); const pageSize=Math.max(1,Math.min(200,Number(req.query.pageSize||200)));
    const matched=metricSourceRows({businessType,fromDate,toDate}).map(normalizedMetricRow).filter(row=>metricMatch(row,tab,attempt,region));
    const start=(page-1)*pageSize;
    const rows=matched.slice(start,start+pageSize).map(row=>{const copy={...row}; delete copy.rawJson;delete copy.importRowJson;delete copy._pod;delete copy._returned;return copy;});
    res.setHeader('Cache-Control','private, max-age=5');
    res.json({ok:true,businessType,fromDate,toDate,tab,region,attempt,page,pageSize,total:matched.length,rows,sourceMode:'V28_LATEST_VALID_IMPORT_PLUS_FINAL_STATE'});
  }catch(error){console.error('[V28][METRIC_DETAIL]',error);res.status(500).json({ok:false,error:error.message||String(error)});}
}

function isNormalTerminal(row={}) {
  const state=upper(row.currentState||row.state||'');
  const close=upper(row.closeReason||'');
  const category=upper(row.category||row.primaryCategory||'');
  if(NORMAL_TERMINALS.has(state)||NORMAL_TERMINALS.has(close)||NORMAL_TERMINALS.has(category)) return true;
  if(state.includes('POD')||state.includes('RETURN_COMPLETED')||state==='RETURNED') return true;
  if(category.includes('POD闭环')||category==='退回'||category.includes('已退回')) return true;
  return false;
}

function carryRows({status='OPEN',businessType='ALL',limit=500}){
  const db=getDb();
  const clauses=[]; const params=[];
  if(status!=='ALL'){clauses.push("UPPER(COALESCE(o.status,''))=?");params.push(status);}
  if(businessType!=='ALL'){clauses.push("UPPER(COALESCE(o.businessType,''))=?");params.push(businessType);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const raw=db.prepare(`SELECT o.*,c.state AS currentState,c.apiStatus AS currentApiStatus,c.lastEventTime AS currentLastEventTime,c.stateJson AS currentStateJson,c.updatedAt AS currentUpdatedAt
    FROM carryover_open_items o LEFT JOIN shipment_current_state c ON c.shipmentCode=o.shipmentCode ${where}
    ORDER BY COALESCE(c.updatedAt,o.updatedAt) DESC,o.sourceReportDate,o.shipmentCode LIMIT 5000`).all(...params);
  const now=Date.now();
  const rows=[];
  for(const item of raw){
    const before=safeJson(item.stateJson,{}),current=safeJson(item.currentStateJson,{});
    const category=current.primaryCategory||current.当前分类||current.主分类||before.primaryCategory||before.当前分类||before.主分类||'';
    const normalized={...item,category,currentState:item.currentState||current.currentState||before.currentState||'',closeReason:item.closeReason||''};
    if(isNormalTerminal(normalized)) continue;
    const previousTime=String(before.latestEventTime||before.lastEventTime||before.最新时间||before.最后节点时间||'');
    const latestTime=String(item.currentLastEventTime||current.latestEventTime||current.lastEventTime||current.最新时间||current.最后节点时间||previousTime||'');
    const latestNode=current.latestEventDesc||current.lastEventDesc||current.最新节点||current.最后节点||before.latestEventDesc||before.lastEventDesc||before.最新节点||before.最后节点||'';
    const sourceMs=Date.parse(`${item.sourceReportDate}T00:00:00+07:00`); const daysOpen=Number.isFinite(sourceMs)?Math.max(0,Math.floor((now-sourceMs)/86400000)):0;
    rows.push({shipmentCode:item.shipmentCode,businessType:upper(item.businessType),sourceReportDate:item.sourceReportDate,lastReportDate:item.lastReportDate,status:item.status,
      currentState:normalized.currentState,apiStatus:item.currentApiStatus||item.apiStatus||'',latestNode,latestEventTime:latestTime,previousEventTime:previousTime,
      hasNewNode:Boolean(latestTime&&(!previousTime||latestTime>previousTime)),daysOpen,category,
      pendingDays:number(current.pendingDistinctDayCount??current.Pending次数??before.pendingDistinctDayCount??before.Pending次数),ocDays:number(current.OC天数??before.OC天数),
      closeReason:item.closeReason||'',updatedAt:item.currentUpdatedAt||item.updatedAt||''});
  }
  return rows.slice(0,Math.max(1,Math.min(1000,Number(limit)||500)));
}

function v28Carry(req,res){
  try{
    const status=['OPEN','CLOSED','ALL'].includes(upper(req.query.status||'OPEN'))?upper(req.query.status||'OPEN'):'OPEN';
    const businessType=['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].includes(upper(req.query.businessType||''))?upper(req.query.businessType):'ALL';
    const rows=carryRows({status,businessType,limit:req.query.limit||req.query.pageSize});
    const counts=Object.fromEntries(['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].map(type=>[type,0]));
    for(const row of carryRows({status,businessType:'ALL',limit:5000})) if(counts[row.businessType]!==undefined) counts[row.businessType]++;
    const summary={total:rows.length,newNode:rows.filter(r=>r.hasNewNode).length,stale3:rows.filter(r=>r.daysOpen>=3&&!r.hasNewNode).length,closed:rows.filter(r=>upper(r.status)==='CLOSED').length};
    res.setHeader('Cache-Control','private, max-age=5');
    res.json({ok:true,status,businessType,businessSummary:{ALL:Object.values(counts).reduce((a,b)=>a+b,0),...counts},summary,rows,pageSize:rows.length,generatedAt:new Date().toISOString(),terminalPolicy:'POD_RETURN_SPECIAL_NORMAL_EXCLUDED'});
  }catch(error){console.error('[V28][CARRY]',error);res.status(500).json({ok:false,error:error.message||String(error)});}
}

function prepareShopeeResume(req,res,next){
  try{
    const db=getDb();
    const report=db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='SHOPEE' ORDER BY reportDate DESC LIMIT 1").get();
    const reportDate=String(report?.reportDate||'');
    if(reportDate){
      const statuses=[];
      for(const record of db.prepare("SELECT shipmentCode,rawJson FROM business_scan_results WHERE businessType='SHOPEE' AND reportDate=?").all(reportDate)){
        const raw=safeJson(record.rawJson,{}); const state=upper(raw.currentState||raw.scanNormalizedState||''); const query=String(raw.查询状态||'');
        const success=Boolean(record.shipmentCode) && state!=='SCAN_PENDING_RETRY' && !/refresh_failed|scan_retry|failed/i.test(query);
        statuses.push({businessType:'SHOPEE',reportDate,shipmentCode:upper(record.shipmentCode),status:success?'success':'failed',resultCount:success?1:0,errorMessage:success?'':'SCAN_RETRY_REQUIRED',checkedAt:new Date().toISOString()});
      }
      db.prepare("DELETE FROM business_api_batches WHERE businessType='SHOPEE' AND reportDate=?").run(reportDate);
      const stateRow=db.prepare("SELECT valueJson FROM business_states WHERE businessType='SHOPEE'").get();
      if(stateRow?.valueJson){
        const state=safeJson(stateRow.valueJson,{}); state.scanQueryStatus=statuses; state.apiBatchStatus=[];
        db.prepare("UPDATE business_states SET valueJson=?,updatedAt=? WHERE businessType='SHOPEE'").run(JSON.stringify(state),new Date().toISOString());
      }
      req.v28ResumePrepared={reportDate,restoredScanStatuses:statuses.filter(x=>x.status==='success').length};
    }
    next();
  }catch(error){console.error('[V28][RESUME_PREP]',error);next();}
}

function persistManualTracking(req,res,next){
  const originalJson=res.json.bind(res);
  res.json=payload=>{
    try{
      if(payload?.ok && upper(payload.businessType)==='SHOPEE' && Array.isArray(payload.rows) && payload.rows.length){
        updateCarryoverResults({snapshotId:`MANUAL_TRACK_${Date.now()}`,reportDate:String(payload.reportDate||req.body?.reportDate||new Date().toISOString().slice(0,10)),rows:payload.rows});
      }
    }catch(error){console.warn('[V28][MANUAL_TRACK_PERSIST]',error);}
    return originalJson(payload);
  };
  next();
}

const originalGet=express.application.get;
express.application.get=function v28Get(path,...handlers){
  if(path==='/api/v27/metric-detail') return originalGet.call(this,path,v28MetricDetail);
  if(path==='/api/v27/carry-monitor'||path==='/api/v27/carry-monitor-business') return originalGet.call(this,path,v28Carry);
  return originalGet.call(this,path,...handlers);
};

const originalPost=express.application.post;
express.application.post=function v28Post(path,...handlers){
  if(path==='/api/shopee/run/resume') return originalPost.call(this,path,prepareShopeeResume,...handlers);
  if(path==='/api/track-query') return originalPost.call(this,path,persistManualTracking,...handlers);
  return originalPost.call(this,path,...handlers);
};

export const V28_RUNTIME_PATCH_ID='2026-08-08-v28-metric-resume-carry-terminal-policy';
