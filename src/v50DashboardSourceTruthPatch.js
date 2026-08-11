import express from 'express';
import { getDb } from './db.js';
import { loadWhppState } from './whppStore.js';
import { buildWhppDashboard } from './whppReporting.js';
import { classifyFinalRoutingDestination, ROUTING_DESTINATIONS } from './routingDestinationV48.js';

const PATCH_ID = '2026-08-11-v50-dashboard-source-truth-v1';
const SPECIAL_TABS = new Set(['ccslCnDiversion','ccslZtDiversion','ccsl580Retention','ccsl580Diversion','phnomPenhShop']);
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

function isoDate(value='') {
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function safeJson(value,fallback={}) { try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;} }
function billOf(row={}) { return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase(); }
function number(value){const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;}
function uniqueRows(rows=[]) { const map=new Map(); for(const row of rows){const bill=billOf(row);if(bill)map.set(bill,row);} return [...map.values()]; }

function latestCte(){
  return `WITH ranked AS (
    SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
      ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) AS rn
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
  ), latest AS (SELECT reportDate,snapshotId FROM ranked WHERE rn=1)`;
}

function normalizeScope(raw='') {
  const type=String(raw||'').toUpperCase();
  if(CCSL_TYPES.has(type))return {type,shopee:false,exact:true};
  if(SHOPEE_TYPES.has(type))return {type,shopee:true,exact:true};
  if(type==='SHOPEE')return {type,shopee:true,exact:false};
  return {type:'CCSL',shopee:false,exact:false};
}

function specialCandidateSql(scope,tab,region='') {
  const typeFilter=scope.exact?'u.businessType=?':(scope.shopee?"u.businessType IN ('SHOPEECN','SHOPEEVN')":"u.businessType IN ('CE','CEAF','TBKH','ALI1688')");
  const regionClause=['PP','PV'].includes(region)?"AND UPPER(COALESCE(u.regionCode,''))=?":'';
  const candidate=tab==='phnomPenhShop'
    ? "AND COALESCE(f.shopState,'') IN ('SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT')"
    : "AND (COALESCE(f.rawJson,'') LIKE '%CCSL%' OR COALESCE(f.rawJson,'') LIKE '%CECN%' OR COALESCE(f.rawJson,'') LIKE '%CEZT%' OR UPPER(COALESCE(f.primaryCategory,'')) LIKE '%DIVERSION%' OR UPPER(COALESCE(f.primaryCategory,'')) LIKE '%RETENTION%')";
  if(scope.shopee){
    return `${latestCte()} SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
      f.isPod,f.primaryCategory,f.latestEventDesc AS lastEventDesc,f.latestEventTime AS lastEventTime,
      f.shopState,f.shopRetentionNaturalDays,f.rawJson
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE ${typeFilter} ${regionClause} ${candidate}`;
  }
  return `${latestCte()} SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
    f.isPod,f.primaryCategory,f.lastEventDesc,f.lastEventTime,f.shopState,f.shopRetentionNaturalDays,f.rawJson
    FROM latest l
    INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
    LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    WHERE ${typeFilter} ${regionClause} ${candidate}`;
}

function stateOf(row={}) { return String(row.persistedCurrentState||row.currentState||row.state||'').trim().toUpperCase(); }
function isPod(row={}) { return number(row.isPod)===1||row.是否POD==='是'||row.POD状态==='POD'||stateOf(row)==='POD'||String(row.orderStatus??row.scanOrderStatus??'').trim()==='85'; }
function isReturned(row={}) { return row.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(stateOf(row))||String(row.orderStatus??row.scanOrderStatus??'').trim()==='100'||String(row.primaryCategory||row.主分类||row.当前分类||'')==='退回'; }
function isCancelled(row={}) { return row.订单取消==='是'||row.取消状态==='已取消'||stateOf(row)==='ORDER_CANCELLED'||String(row.orderStatus??row.scanOrderStatus??'').trim()==='10'; }
function isTerminal(row={}) { return isPod(row)||isReturned(row)||isCancelled(row); }
function finalDestination(row={}) { return classifyFinalRoutingDestination(row).destination; }

function decorateSpecial(row={},fallbackType='') {
  const raw=safeJson(row.rawJson,{});
  const merged={...raw,...row};
  merged.businessType=row.businessType||fallbackType;
  merged.shipmentCode=row.shipmentCode||raw.shipmentCode||raw.运单号||'';
  merged.运单号=merged.shipmentCode;
  merged.区域=row.regionCode||raw.regionCode||raw.区域||'';
  merged.当前分类=row.primaryCategory||raw.primaryCategory||raw.主分类||raw.异常分类||'';
  merged.POD状态=isPod(merged)?'POD':'未POD';
  merged.最新节点=row.lastEventDesc||raw.latestEventDesc||raw.最新节点||raw.最后节点||'';
  merged.最新时间=row.lastEventTime||raw.latestEventTime||raw.最新时间||raw.最后节点时间||'';
  delete merged.rawJson;
  return merged;
}

function matchesSpecial(row,tab){
  if(isTerminal(row))return false;
  const destination=finalDestination(row);
  if(tab==='ccslCnDiversion')return destination===ROUTING_DESTINATIONS.CCSLCN;
  if(tab==='ccslZtDiversion')return destination===ROUTING_DESTINATIONS.CCSLZT;
  if(tab==='ccsl580Retention'||tab==='ccsl580Diversion')return destination===ROUTING_DESTINATIONS.CCSL580;
  if(tab==='phnomPenhShop')return destination===ROUTING_DESTINATIONS.NONE&&['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(row.shopState||''));
  return false;
}

function specialDetailPayload(query={}) {
  const tab=String(query.tab||'');
  if(!SPECIAL_TABS.has(tab))return null;
  const scope=normalizeScope(query.businessType);
  const toDate=isoDate(query.to||query.reportDate);
  const fromDate=isoDate(query.from)||toDate;
  if(!fromDate||!toDate||fromDate>toDate){const error=new Error('日期范围无效');error.status=400;throw error;}
  const region=String(query.region||'').toUpperCase();
  const page=Math.max(1,number(query.page)||1);
  const pageSize=Math.max(1,Math.min(200,number(query.pageSize)||200));
  const params=[fromDate,toDate,...(scope.exact?[scope.type]:[]),...(['PP','PV'].includes(region)?[region]:[])];
  const rows=getDb().prepare(specialCandidateSql(scope,tab,region)).all(...params)
    .map(row=>decorateSpecial(row,scope.type))
    .filter(row=>matchesSpecial(row,tab));
  const filtered=uniqueRows(rows).sort((a,b)=>String(b.reportDate||'').localeCompare(String(a.reportDate||''))||String(b.最新时间||'').localeCompare(String(a.最新时间||''))||billOf(a).localeCompare(billOf(b)));
  const start=(page-1)*pageSize;
  return {ok:true,patchId:PATCH_ID,businessType:String(query.businessType||scope.type).toUpperCase(),fromDate,toDate,tab,region,page,pageSize,total:filtered.length,rows:filtered.slice(start,start+pageSize)};
}

function specialDetailHandler(req,res,next){
  try{
    const payload=specialDetailPayload(req.query);
    if(!payload)return typeof next==='function'?next():res.status(400).json({ok:false,error:'指标无效'});
    res.setHeader('Cache-Control','private, max-age=3');
    res.json(payload);
  }catch(error){
    console.error('[V50][SPECIAL_DETAIL]',error);
    res.status(error.status||500).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});
  }
}

function inflateRows(table,reportDate,jsonColumn){
  if(!reportDate)return[];
  const rows=getDb().prepare(`SELECT * FROM ${table} WHERE businessType='WHPP' AND reportDate=?`).all(reportDate);
  return rows.map(row=>({ ...safeJson(row?.[jsonColumn],{}), ...row }));
}

function loadWhppBaseState(reportDate=''){
  const current=loadWhppState();
  const target=reportDate||current.reportDate||'';
  if(!target||target===current.reportDate)return {...current,reportDate:target};
  const row=getDb().prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC LIMIT 1").get(target);
  if(!row)return {businessType:'WHPP',reportDate:target,dailyReportReady:false,pnhBills:[],dailyParseRows:[],scanResults:[],finalRows:[]};
  const payload=safeJson(row.payloadJson,{});
  return {...(payload.state||{}),businessType:'WHPP',reportDate:target};
}

function mapRows(rows=[]){const map=new Map();for(const row of rows){const bill=billOf(row);if(bill)map.set(bill,row);}return map;}

function normalizeWhppTerminal(row={}){
  const persisted=stateOf(row);
  const status=String(row.scanOrderStatus??row.orderStatus??'').trim();
  if(persisted==='POD'||status==='85'||isPod(row)){
    return {...row,isPod:1,是否POD:'是',POD状态:'POD',currentState:'POD',primaryCategory:'POD',主分类:'POD',异常分类:'POD',退回状态:'未退回',订单取消:'否',跨日状态:'已闭环',carry状态:'closed_pod',trackRequired:false,Pending次数:0,Pending当前次数:0,pendingDistinctDayCount:0,Pending不连续:'否',OC天数:0,盘点天数:0,派送中停留天数:0,入库无扫描节点:'否',shopState:'',shopRetentionNaturalDays:0};
  }
  if(['RETURNED','RETURN_COMPLETED'].includes(persisted)||status==='100'||isReturned(row)){
    return {...row,isPod:0,是否POD:'否',POD状态:'未POD',currentState:'RETURN_COMPLETED',primaryCategory:'退回',主分类:'退回',异常分类:'退回',退回状态:'已退回',订单取消:'否',跨日状态:'已闭环',carry状态:'closed_return',trackRequired:false,Pending次数:0,Pending当前次数:0,pendingDistinctDayCount:0,Pending不连续:'否',OC天数:0,盘点天数:0,派送中停留天数:0,入库无扫描节点:'否',shopState:'',shopRetentionNaturalDays:0};
  }
  if(persisted==='ORDER_CANCELLED'||status==='10'||isCancelled(row)){
    return {...row,isPod:0,是否POD:'否',POD状态:'未POD',currentState:'ORDER_CANCELLED',primaryCategory:'订单取消',主分类:'订单取消',异常分类:'订单取消',退回状态:'未退回',订单取消:'是',取消状态:'已取消',跨日状态:'已闭环',carry状态:'closed_cancelled',trackRequired:false,Pending次数:0,Pending当前次数:0,pendingDistinctDayCount:0,Pending不连续:'否',OC天数:0,盘点天数:0,派送中停留天数:0,入库无扫描节点:'否',shopState:'',shopRetentionNaturalDays:0};
  }
  return row;
}

function buildWhppSourceTruth(reportDate=''){
  const base=loadWhppBaseState(reportDate);
  const date=base.reportDate||reportDate||'';
  if(!date)return {state:base,dashboard:buildWhppDashboard(base),snapshotStatus:base.snapshotStatus||'EMPTY'};

  const stateDaily=Array.isArray(base.dailyParseRows)?base.dailyParseRows:[];
  const stateScan=Array.isArray(base.scanResults)?base.scanResults:[];
  const stateFinal=Array.isArray(base.finalRows)?base.finalRows:[];
  const dbDaily=inflateRows('business_daily_parse_rows',date,'rowJson');
  const dbScan=inflateRows('business_scan_results',date,'rawJson');
  const dbFinal=inflateRows('business_final_rows',date,'rawJson');
  const currentRows=getDb().prepare("SELECT * FROM shipment_current_state WHERE businessType='WHPP' AND reportDate=?").all(date)
    .map(row=>({...safeJson(row.stateJson,{}),...row,persistedCurrentState:row.state||'',currentLastEventTime:row.lastEventTime||''}));

  const dailyBy=mapRows([...stateDaily,...dbDaily]);
  const scanBy=mapRows([...stateScan,...dbScan]);
  const finalBy=mapRows([...stateFinal,...dbFinal]);
  const currentBy=mapRows(currentRows);
  const pnhBills=[...new Set([...(base.pnhBills||[]).map(code=>String(code||'').trim().toUpperCase()),...dailyBy.keys()])].filter(Boolean);
  const merged=pnhBills.map(bill=>{
    const scan=scanBy.get(bill)||{};
    const current=currentBy.get(bill)||{};
    return normalizeWhppTerminal({
      ...(dailyBy.get(bill)||{}),
      ...scan,
      ...(finalBy.get(bill)||{}),
      ...current,
      shipmentCode:bill,
      运单号:bill,
      businessType:'WHPP',
      reportDate:date,
      scanOrderStatus:String(scan.orderStatus??scan.scanOrderStatus??''),
      persistedCurrentState:String(current.persistedCurrentState||current.state||'')
    });
  });

  const synthetic={...base,businessType:'WHPP',reportDate:date,pnhBills,dailyParseRows:pnhBills.map(bill=>dailyBy.get(bill)||{shipmentCode:bill,运单号:bill,reportDate:date,businessType:'WHPP'}),scanResults:[...scanBy.values()],finalRows:merged};
  const dashboard=buildWhppDashboard(synthetic);
  const completed=dashboard.accounting?.balanced&&dashboard.metrics?.total>0;
  return {state:synthetic,dashboard,snapshotStatus:base.snapshotStatus|| (completed?'RECONCILED':'IMPORTED'),patchId:PATCH_ID};
}

function whppStateHandler(req,res){
  try{
    const reportDate=isoDate(req.query.reportDate);
    const payload=buildWhppSourceTruth(reportDate);
    res.setHeader('Cache-Control','private, max-age=2');
    res.json({ok:true,patchId:PATCH_ID,...payload});
  }catch(error){console.error('[V50][WHPP_STATE]',error);res.status(500).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});}
}

function whppDetailHandler(req,res){
  try{
    const reportDate=isoDate(req.query.reportDate);
    const payload=buildWhppSourceTruth(reportDate);
    const key=String(req.query.tab||'all');
    const detail=payload.dashboard?.detailTabs?.[key]||payload.dashboard?.detailTabs?.all||{label:key,rows:[],total:0};
    const page=Math.max(1,number(req.query.page)||1);
    const pageSize=Math.max(1,Math.min(300,number(req.query.pageSize)||200));
    const start=(page-1)*pageSize;
    res.setHeader('Cache-Control','private, max-age=2');
    res.json({ok:true,patchId:PATCH_ID,businessType:'WHPP',reportDate:payload.state?.reportDate||reportDate,tab:key,label:detail.label||key,total:Number(detail.total||detail.rows?.length||0),page,pageSize,rows:(detail.rows||[]).slice(start,start+pageSize)});
  }catch(error){console.error('[V50][WHPP_DETAIL]',error);res.status(500).json({ok:false,patchId:PATCH_ID,error:error.message||String(error)});}
}

// V42/V49 register WHPP routes lazily inside app.listen. Replacing the last
// route handler at registration time guarantees the source-truth reader owns the
// public endpoint regardless of import/listen wrapper order.
const previousGet=express.application.get;
express.application.get=function v50Get(pathValue,...handlers){
  if(arguments.length===1)return previousGet.apply(this,arguments);
  if(pathValue==='/api/whpp/state'&&handlers.length)return previousGet.call(this,pathValue,...handlers.slice(0,-1),whppStateHandler);
  if(pathValue==='/api/whpp/metric-detail'&&handlers.length)return previousGet.call(this,pathValue,...handlers.slice(0,-1),whppDetailHandler);
  return previousGet.call(this,pathValue,...handlers);
};

let installed=false;
const previousListen=express.application.listen;
express.application.listen=function v50Listen(...args){
  if(!installed){
    installed=true;
    this.get('/api/v50/special-detail',specialDetailHandler);
    this.get('/api/v50/whpp-state',whppStateHandler);
    this.get('/api/v50/whpp-metric-detail',whppDetailHandler);
  }
  return previousListen.apply(this,args);
};

export const V50_DASHBOARD_SOURCE_TRUTH_PATCH_ID=PATCH_ID;
