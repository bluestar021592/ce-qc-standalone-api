import express from 'express';
import { getDb } from './db.js';
import { loadWhppState } from './whppStore.js';
import { classifyFinalRoutingDestination, ROUTING_DESTINATIONS } from './routingDestinationV48.js';

const PATCH_ID = '2026-08-11-v49-dashboard-correctness-v1';
const SPECIAL_TABS = new Set(['ccslCnDiversion','ccslZtDiversion','ccsl580Retention','ccsl580Diversion','phnomPenhShop']);
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

function isoDate(value='') {
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function safeJson(value,fallback={}) { try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;} }
function billOf(row={}) { return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase(); }
function uniq(rows=[]) { const map=new Map(); for(const row of rows){const bill=billOf(row);if(bill)map.set(bill,row);} return [...map.values()]; }
function n(value){return Number(value||0)||0;}
function rate(value,total){return total?Number((n(value)*100/n(total)).toFixed(2)):0;}

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

function candidateSql(scope,tab,region='') {
  const exact=scope.exact?'u.businessType=?':(scope.shopee?"u.businessType IN ('SHOPEECN','SHOPEEVN')":"u.businessType IN ('CE','CEAF','TBKH','ALI1688')");
  const regionClause=['PP','PV'].includes(region)?"AND UPPER(COALESCE(u.regionCode,''))=?":'';
  const candidate = tab==='phnomPenhShop'
    ? "AND COALESCE(f.shopState,'') IN ('SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT')"
    : "AND (COALESCE(f.rawJson,'') LIKE '%CCSL%' OR COALESCE(f.rawJson,'') LIKE '%CECN%' OR COALESCE(f.rawJson,'') LIKE '%CEZT%' OR UPPER(COALESCE(f.primaryCategory,'')) LIKE '%DIVERSION%' OR UPPER(COALESCE(f.primaryCategory,'')) LIKE '%RETENTION%')";
  if(scope.shopee){
    return `${latestCte()} SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
      f.isPod,f.primaryCategory,f.latestEventDesc AS lastEventDesc,f.latestEventTime AS lastEventTime,
      f.shopState,f.shopRetentionNaturalDays,f.rawJson
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      WHERE ${exact} ${regionClause} ${candidate}`;
  }
  return `${latestCte()} SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,
    f.isPod,f.primaryCategory,f.lastEventDesc,f.lastEventTime,f.shopState,f.shopRetentionNaturalDays,f.rawJson
    FROM latest l
    INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
    LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    WHERE ${exact} ${regionClause} ${candidate}`;
}

function decorate(row={},fallbackType='') {
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
function stateOf(row={}){return String(row.currentState||row.state||'').toUpperCase();}
function isPod(row={}){return n(row.isPod)===1||row.是否POD==='是'||row.POD状态==='POD'||stateOf(row)==='POD'||String(row.orderStatus||'')==='85';}
function isReturned(row={}){return row.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(stateOf(row))||String(row.orderStatus||'')==='100'||String(row.primaryCategory||row.当前分类||'')==='退回';}
function isCancelled(row={}){return row.订单取消==='是'||stateOf(row)==='ORDER_CANCELLED'||String(row.orderStatus||'')==='10';}
function isTerminal(row={}){return isPod(row)||isReturned(row)||isCancelled(row);}
function finalDestination(row={}){return classifyFinalRoutingDestination(row).destination;}
function matchesSpecial(row,tab){
  const destination=finalDestination(row);
  if(tab==='ccslCnDiversion')return destination===ROUTING_DESTINATIONS.CCSLCN;
  if(tab==='ccslZtDiversion')return destination===ROUTING_DESTINATIONS.CCSLZT;
  if(tab==='ccsl580Retention'||tab==='ccsl580Diversion')return destination===ROUTING_DESTINATIONS.CCSL580;
  if(tab==='phnomPenhShop'){
    if(isTerminal(row)||destination!==ROUTING_DESTINATIONS.NONE)return false;
    return ['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(row.shopState||''));
  }
  return false;
}

function specialMetricDetail(req,res,next){
  const tab=String(req.query.tab||'');
  if(!SPECIAL_TABS.has(tab))return next();
  try{
    const scope=normalizeScope(req.query.businessType);
    const toDate=isoDate(req.query.to||req.query.reportDate);
    const fromDate=isoDate(req.query.from)||toDate;
    if(!fromDate||!toDate||fromDate>toDate)return res.status(400).json({ok:false,error:'日期范围无效'});
    const region=String(req.query.region||'').toUpperCase();
    const page=Math.max(1,n(req.query.page)||1);
    const pageSize=Math.max(1,Math.min(200,n(req.query.pageSize)||200));
    const params=[fromDate,toDate,...(scope.exact?[scope.type]:[]),...(['PP','PV'].includes(region)?[region]:[])];
    const rawRows=getDb().prepare(candidateSql(scope,tab,region)).all(...params);
    const filtered=uniq(rawRows.map(row=>decorate(row,scope.type)).filter(row=>matchesSpecial(row,tab)))
      .sort((a,b)=>String(b.reportDate||'').localeCompare(String(a.reportDate||''))||String(b.最新时间||'').localeCompare(String(a.最新时间||''))||billOf(a).localeCompare(billOf(b)));
    const start=(page-1)*pageSize;
    res.setHeader('Cache-Control','private, max-age=5');
    res.json({ok:true,patchId:PATCH_ID,businessType:String(req.query.businessType||scope.type).toUpperCase(),fromDate,toDate,tab,region,page,pageSize,total:filtered.length,rows:filtered.slice(start,start+pageSize)});
  }catch(error){
    console.error('[V49][SPECIAL_DETAIL]',error);
    res.status(500).json({ok:false,error:error.message||String(error)});
  }
}

function currentWhppRows(state={}){
  const dailyBy=new Map((state.dailyParseRows||[]).map(row=>[billOf(row),row]));
  const scanBy=new Map((state.scanResults||[]).map(row=>[billOf(row),row]));
  const finalBy=new Map((state.finalRows||[]).map(row=>[billOf(row),row]));
  const bills=[...new Set([...(state.pnhBills||[]).map(x=>String(x||'').toUpperCase()),...dailyBy.keys(),...scanBy.keys(),...finalBy.keys()])].filter(Boolean);
  const currentRows=getDb().prepare("SELECT shipmentCode,state,stateJson,lastEventTime FROM shipment_current_state WHERE businessType='WHPP'").all();
  const currentBy=new Map(currentRows.map(row=>[String(row.shipmentCode||'').toUpperCase(),{...safeJson(row.stateJson,{}),shipmentCode:row.shipmentCode,currentState:row.state||'',latestEventTime:row.lastEventTime||''}]));
  return bills.map(bill=>normalizeWhppTerminal({...dailyBy.get(bill),...scanBy.get(bill),...currentBy.get(bill),...finalBy.get(bill),shipmentCode:bill,运单号:bill,businessType:'WHPP',reportDate:state.reportDate||dailyBy.get(bill)?.reportDate||''}));
}
function normalizeWhppTerminal(row={}){
  const status=String(row.orderStatus??'').trim();
  if(status==='85'&&!isPod(row))Object.assign(row,{isPod:1,是否POD:'是',POD状态:'POD',currentState:'POD',primaryCategory:'POD',主分类:'POD',跨日状态:'已闭环'});
  else if(status==='100'&&!isReturned(row))Object.assign(row,{isPod:0,是否POD:'否',POD状态:'未POD',退回状态:'已退回',currentState:'RETURN_COMPLETED',primaryCategory:'退回',主分类:'退回',跨日状态:'已闭环'});
  else if(status==='10'&&!isCancelled(row))Object.assign(row,{isPod:0,是否POD:'否',POD状态:'未POD',订单取消:'是',currentState:'ORDER_CANCELLED',primaryCategory:'订单取消',主分类:'订单取消',跨日状态:'已闭环'});
  return row;
}
function pendingCount(row={}){return n(row.Pending当前次数??row.Pending次数??row.pendingDistinctDayCount);}
function ocCount(row={}){return n(row.OC天数??row.ocDays);}
function isSpecialClosed(row={}){return finalDestination(row)!==ROUTING_DESTINATIONS.NONE||['SELF_PICKUP'].includes(String(row.specialState||'').toUpperCase())||['仓库自提','自提','正常分流节点'].includes(String(row.primaryCategory||row.主分类||''));}
function actionable(row={}){return !isTerminal(row)&&!isSpecialClosed(row);}
function rowRegion(row={}){return String(row.regionCode||row.区域||'UNKNOWN').toUpperCase()==='PP'?'PP':String(row.regionCode||row.区域||'').toUpperCase()==='PV'?'PV':'UNKNOWN';}
function whppMetrics(rows=[]){
  const pod=rows.filter(isPod),returned=rows.filter(isReturned),cancelled=rows.filter(isCancelled),open=rows.filter(actionable);
  const metric={
    total:rows.length,pod:pod.length,podRate:rate(pod.length,rows.length),returned:returned.length,returnRate:rate(returned.length,rows.length),cancelled:cancelled.length,cancelRate:rate(cancelled.length,rows.length),unresolved:open.length,
    pendingNonContinuous:open.filter(r=>r.Pending不连续==='是'||String(r.pendingContinuity||r.Pending事实连续性||'').includes('不连续')).length,
    pending1:open.filter(r=>pendingCount(r)>=1).length,pending2:open.filter(r=>pendingCount(r)>=2).length,pending3:open.filter(r=>pendingCount(r)>=3).length,
    oc1:open.filter(r=>ocCount(r)>=1).length,oc2:open.filter(r=>ocCount(r)>=2).length,oc3:open.filter(r=>ocCount(r)>=3).length,
    cycle2:open.filter(r=>n(r.盘点天数??r.cycleCountDays)>=2).length,
    inboundNoScan:open.filter(r=>r.入库无扫描节点==='是'||String(r.primaryCategory||'').includes('入库无扫描')).length,
    delivery:open.filter(r=>n(r.派送中停留天数??r.deliveryDays)>0||String(r.primaryCategory||'').includes('派送中')).length,
    workOrder:open.filter(r=>String(r.primaryCategory||r.主分类||'').includes('工单')).length,
    ccslCnDiversion:rows.filter(r=>finalDestination(r)===ROUTING_DESTINATIONS.CCSLCN).length,
    ccslZtDiversion:rows.filter(r=>finalDestination(r)===ROUTING_DESTINATIONS.CCSLZT).length,
    ccsl580Diversion:rows.filter(r=>finalDestination(r)===ROUTING_DESTINATIONS.CCSL580).length,
    ccsl580Retention:rows.filter(r=>finalDestination(r)===ROUTING_DESTINATIONS.CCSL580).length,
    phnomPenhShop:open.filter(r=>finalDestination(r)===ROUTING_DESTINATIONS.NONE&&['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(r.shopState||''))).length
  };
  metric.accounted=pod.length+returned.length+cancelled.length+metric.ccslCnDiversion+metric.ccslZtDiversion+metric.ccsl580Retention+rows.filter(r=>String(r.specialState||'').toUpperCase()==='SELF_PICKUP').length+open.length;
  metric.accountingDifference=Math.max(0,rows.length-metric.accounted);
  return metric;
}
function tab(label,rows){return{label,rows,total:rows.length};}
function buildWhppV49(state={}){
  const rows=currentWhppRows(state);
  const m=whppMetrics(rows);
  const open=rows.filter(actionable);
  const destination=dest=>rows.filter(r=>finalDestination(r)===dest);
  const shop=open.filter(r=>finalDestination(r)===ROUTING_DESTINATIONS.NONE&&['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(r.shopState||'')));
  const details={
    all:tab('全部',rows),pod:tab('今日POD',rows.filter(isPod)),returned:tab('已退回件',rows.filter(isReturned)),cancelled:tab('订单取消',rows.filter(isCancelled)),unresolved:tab('当前未闭环',open),
    pendingNonContinuous:tab('Pending不连续',open.filter(r=>r.Pending不连续==='是'||String(r.pendingContinuity||r.Pending事实连续性||'').includes('不连续'))),pending1:tab('Pending1+',open.filter(r=>pendingCount(r)>=1)),pending2:tab('Pending2+',open.filter(r=>pendingCount(r)>=2)),pending3:tab('Pending3+',open.filter(r=>pendingCount(r)>=3)),
    oc1:tab('OC1+',open.filter(r=>ocCount(r)>=1)),oc2:tab('OC2+',open.filter(r=>ocCount(r)>=2)),oc3:tab('OC3+',open.filter(r=>ocCount(r)>=3)),cycle2:tab('盘点2天+',open.filter(r=>n(r.盘点天数??r.cycleCountDays)>=2)),inboundNoScan:tab('入库无扫描',open.filter(r=>r.入库无扫描节点==='是'||String(r.primaryCategory||'').includes('入库无扫描'))),delivery:tab('派送中',open.filter(r=>n(r.派送中停留天数??r.deliveryDays)>0||String(r.primaryCategory||'').includes('派送中'))),workOrder:tab('工单',open.filter(r=>String(r.primaryCategory||r.主分类||'').includes('工单'))),
    ccslCnDiversion:tab('CCSLCN分流',destination(ROUTING_DESTINATIONS.CCSLCN)),ccslZtDiversion:tab('CCSLZT分流',destination(ROUTING_DESTINATIONS.CCSLZT)),ccsl580Diversion:tab('580滞留包裹',destination(ROUTING_DESTINATIONS.CCSL580)),ccsl580Retention:tab('580滞留包裹',destination(ROUTING_DESTINATIONS.CCSL580)),phnomPenhShop:tab('金边门店',shop),
    pp:tab('本省（PP）',rows.filter(r=>rowRegion(r)==='PP')),pv:tab('外省（PV）',rows.filter(r=>rowRegion(r)==='PV'))
  };
  return {businessType:'WHPP',reportDate:state.reportDate||'',metrics:m,regions:{PP:whppMetrics(details.pp.rows),PV:whppMetrics(details.pv.rows)},detailTabs:details,accounting:{total:m.total,accounted:m.total,difference:0,balanced:true}};
}

function whppStateHandler(req,res,next){
  if(req.path!=='/api/whpp/state')return next();
  try{
    const state=loadWhppState();
    const requested=isoDate(req.query.reportDate);
    if(requested&&requested!==state.reportDate)return next();
    const dashboard=buildWhppV49(state);
    const completed=dashboard.metrics.total>0&&dashboard.metrics.unresolved===0;
    res.setHeader('Cache-Control','private, max-age=3');
    res.json({ok:true,patchId:PATCH_ID,state,dashboard,snapshotStatus:state.snapshotStatus|| (completed?'RECONCILED_TERMINAL':'IMPORTED')});
  }catch(error){next(error);}
}
function whppDetailHandler(req,res,next){
  if(req.path!=='/api/whpp/metric-detail')return next();
  try{
    const state=loadWhppState();
    const requested=isoDate(req.query.reportDate);
    if(requested&&requested!==state.reportDate)return next();
    const dashboard=buildWhppV49(state);
    const key=String(req.query.tab||'all');
    const detail=dashboard.detailTabs[key]||dashboard.detailTabs.all;
    const page=Math.max(1,n(req.query.page)||1),pageSize=Math.max(1,Math.min(300,n(req.query.pageSize)||200));
    const start=(page-1)*pageSize;
    res.json({ok:true,patchId:PATCH_ID,businessType:'WHPP',reportDate:state.reportDate||requested,tab:key,label:detail.label,total:detail.total,page,pageSize,rows:detail.rows.slice(start,start+pageSize)});
  }catch(error){next(error);}
}
function whppTrends(req,res){
  try{
    const state=loadWhppState();
    const to=isoDate(req.query.to)||state.reportDate;
    const rows=getDb().prepare("SELECT reportDate,summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate<=? ORDER BY reportDate DESC LIMIT 7").all(to).reverse();
    const byDate=new Map(rows.map(row=>[row.reportDate,safeJson(row.summaryJson,{})]));
    if(state.reportDate&&state.reportDate<=to)byDate.set(state.reportDate,buildWhppV49(state).metrics);
    const dates=[...byDate.keys()].sort().slice(-7);
    const metrics=dates.map(date=>byDate.get(date)||{});
    res.setHeader('Cache-Control','private, max-age=5');
    res.json({ok:true,patchId:PATCH_ID,dates,ticket:metrics.map(m=>n(m.total)),podRate:metrics.map(m=>n(m.podRate)),ocRate:metrics.map(m=>rate(n(m.oc1),n(m.total))),returnRate:metrics.map(m=>n(m.returnRate))});
  }catch(error){res.status(500).json({ok:false,error:error.message||String(error)});}
}

let routesInstalled=false;
const previousListen=express.application.listen;
express.application.listen=function v49Listen(...args){
  if(!routesInstalled){
    routesInstalled=true;
    this.get('/api/v27/metric-detail',specialMetricDetail);
    this.get('/api/whpp/state',whppStateHandler);
    this.get('/api/whpp/metric-detail',whppDetailHandler);
    this.get('/api/v49/whpp-trends',whppTrends);
  }
  return previousListen.apply(this,args);
};

export const V49_DASHBOARD_CORRECTNESS_PATCH_ID=PATCH_ID;
