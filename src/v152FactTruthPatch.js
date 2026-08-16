import express from 'express';
import { getDb } from './db.js';
import { loadLightweightUnifiedBusinessState } from './lightweightDashboardStore.js';
import { summarizeLightweightCcslState, summarizeLightweightShopeeState } from './lightweightDashboardSummary.js';
import { buildDashboardData, buildDashboardRows, buildDetailTabs } from './reporting.js';
import { buildShopeeDashboard } from './shopeeReporting.js';

const PATCH_ID = '2026-08-16-v152-multi-generation-fact-truth-v1';
const WRAPPED = Symbol.for('ce-qc.v152-fact-truth-get');
const TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; }
}
function codeOf(row = {}) { return String(row.shipmentCode || row.运单号 || row.waybill || row.billNo || '').trim().toUpperCase(); }
function dateOnly(value = '') { const text = String(value || '').trim().slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''; }
function rate(a,b){ const n=Number(a||0),d=Number(b||0); return d?Number((n*100/d).toFixed(2)):0; }
function normalizeType(value='') {
  const raw=String(value||'').toUpperCase().replace(/[\s_-]+/g,'');
  if(raw==='SHOPEECN'||raw==='CN')return 'SHOPEECN';
  if(raw==='SHOPEEVN'||raw==='VN')return 'SHOPEEVN';
  if(raw==='CEAF'||raw==='CCAF')return 'CEAF';
  if(raw==='TBKH')return 'TBKH';
  if(raw==='ALI1688'||raw==='1688')return 'ALI1688';
  if(raw==='CE')return 'CE';
  return '';
}
function dedupeRows(rows=[]){
  const map=new Map();
  for(const row of rows){const bill=codeOf(row);if(bill)map.set(bill,{...row,shipmentCode:bill,运单号:bill});}
  return [...map.values()];
}
function latestValidBatch(db,snapshotId=''){
  const id=String(snapshotId||'').trim();
  if(id){
    const row=db.prepare(`SELECT b.*,COALESCE(s.status,'') snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.snapshotId=? ORDER BY b.createdAt DESC LIMIT 1`).get(id);
    if(row)return row;
  }
  return db.prepare(`SELECT b.*,COALESCE(s.status,'') snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' ORDER BY b.reportDate DESC,b.createdAt DESC LIMIT 1`).get()||null;
}
function latestLegacyDate(db){
  return String(db.prepare(`SELECT MAX(reportDate) reportDate FROM (
    SELECT reportDate FROM daily_reports
    UNION ALL SELECT reportDate FROM business_daily_reports
    UNION ALL SELECT reportDate FROM shipment_daily_snapshots
  )`).get()?.reportDate||'');
}
function sourceNameForDate(db,date,type,batch){
  if(batch?.sourceName)return batch.sourceName;
  if(SHOPEE_TYPES.has(type))return String(db.prepare("SELECT sourceFile FROM business_daily_reports WHERE businessType='SHOPEE' AND reportDate=? LIMIT 1").get(date)?.sourceFile||'');
  return String(db.prepare('SELECT sourceFile FROM daily_reports WHERE reportDate=? LIMIT 1').get(date)?.sourceFile||'');
}
function normalizeMemberRow(row={},type){
  const bill=codeOf(row); if(!bill)return null;
  return {
    ...row,
    shipmentCode:bill,运单号:bill,businessType:type,
    regionCode:String(row.regionCode||row.region_code||row.区域||''),
    region_code:String(row.region_code||row.regionCode||row.区域||''),
    recipientRaw:String(row.recipientRaw||row.recipient_raw||''),
    recipientNormalized:String(row.recipientNormalized||row.recipient_normalized||''),
    recipient_raw:String(row.recipient_raw||row.recipientRaw||''),
    recipient_normalized:String(row.recipient_normalized||row.recipientNormalized||''),
    recipient_group:type==='SHOPEECN'?'CN':type==='SHOPEEVN'?'VN':String(row.recipient_group||''),
    result:'PNH'
  };
}
function explicitLegacyCcslType(row={}){
  const direct=normalizeType(row.businessType||row.业务板块||row.业务类型||row.classificationType||'');
  if(CCSL_TYPES.has(direct))return direct;
  const text=[row.classificationReason,row.classificationMatchedValue,row.recipientNormalized,row.recipientRaw,row.recipient_normalized,row.recipient_raw,row.customerName,row.productCode,row.rawText,row.原始行摘要].filter(Boolean).join(' ').toUpperCase();
  if(/(?:CEAF|CCAF|空运)/.test(text))return 'CEAF';
  if(/TBKH/.test(text))return 'TBKH';
  if(/ALI\s*1688|ALI1688|\b1688\b/.test(text))return 'ALI1688';
  if(/SHOPEE(?:CN|VN)?/.test(text))return '';
  return 'CE';
}
function unifiedMembers(db,type,date,snapshotId=''){
  const params=[];
  let where="u.businessType=?";params.push(type);
  if(snapshotId){where+=' AND u.snapshotId=?';params.push(snapshotId);}else{where+=' AND u.reportDate=?';params.push(date);}
  const rows=db.prepare(`SELECT u.shipmentCode,u.regionCode,u.recipientRaw,u.recipientNormalized,u.sheetName,u.rowNumber,u.classificationReason,u.classificationSource,u.classificationMatchedValue,u.classificationWarning,u.rowJson FROM unified_import_rows u ${snapshotId?'':"INNER JOIN unified_import_batches b ON b.snapshotId=u.snapshotId AND b.status='VALID'"} WHERE ${where} ORDER BY u.shipmentCode`).all(...params);
  return dedupeRows(rows.map(row=>normalizeMemberRow({...safeJson(row.rowJson,{}),...row},type)).filter(Boolean));
}
function snapshotMembers(db,type,date,snapshotId=''){
  let id=String(snapshotId||'').trim();
  if(!id){id=String(db.prepare('SELECT snapshotId FROM shipment_daily_snapshots WHERE reportDate=? AND businessType=? ORDER BY createdAt DESC LIMIT 1').get(date,type)?.snapshotId||'');}
  if(!id)return [];
  const rows=db.prepare('SELECT shipmentCode,regionCode,rowJson FROM shipment_daily_snapshots WHERE snapshotId=? AND businessType=? ORDER BY shipmentCode').all(id,type);
  return dedupeRows(rows.map(row=>normalizeMemberRow({...safeJson(row.rowJson,{}),...row},type)).filter(Boolean));
}
function legacyMembers(db,type,date){
  if(SHOPEE_TYPES.has(type)){
    const group=type==='SHOPEECN'?'CN':'VN';
    const rows=db.prepare("SELECT shipmentCode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rowNumber,source_row_number,rowJson FROM business_daily_parse_rows WHERE businessType='SHOPEE' AND reportDate=? AND UPPER(COALESCE(recipient_group,''))=? ORDER BY shipmentCode").all(date,group);
    return dedupeRows(rows.map(row=>normalizeMemberRow({...safeJson(row.rowJson,{}),...row},type)).filter(Boolean));
  }
  const rows=db.prepare("SELECT shipmentCode,result,reason,rowJson,rowNumber,sheetName FROM daily_parse_rows WHERE reportDate=? AND COALESCE(result,'PNH') NOT IN ('非PNH','排除','重复') ORDER BY shipmentCode").all(date);
  return dedupeRows(rows.map(row=>({...safeJson(row.rowJson,{}),...row})).filter(row=>explicitLegacyCcslType(row)===type).map(row=>normalizeMemberRow(row,type)).filter(Boolean));
}
function membersFor(db,type,date,snapshotId=''){
  let rows=unifiedMembers(db,type,date,snapshotId); if(rows.length)return {rows,source:'UNIFIED_IMPORT_ROWS'};
  rows=snapshotMembers(db,type,date,snapshotId); if(rows.length)return {rows,source:'SHIPMENT_DAILY_SNAPSHOTS'};
  rows=legacyMembers(db,type,date); if(rows.length)return {rows,source:'LEGACY_DAILY_ROWS'};
  return {rows:[],source:'EMPTY'};
}
function memberSet(rows=[]){return new Set(rows.map(codeOf).filter(Boolean));}
function ccslFinalRows(db,date,type,members){
  if(!members.size)return [];
  const rows=db.prepare(`SELECT shipmentCode,isPod,category,qcConclusion,lastEvent,lastEventTime,lastEventCode,lastEventDesc,lastEventTargetNode,lastEventActionType,matchedRule,matchedShopCode,matchedShopName,primaryCategory,pendingDays,ocDays,cycleCountDays,assignDays,deliveringDays,trackNodeCount,eventCourier,pickupShop,deliveryShop,productCode,customerName FROM final_rows WHERE reportDate=? ORDER BY shipmentCode`).all(date);
  return rows.filter(row=>members.has(String(row.shipmentCode||'').toUpperCase())).map(row=>({
    ...row,businessType:type,运单号:row.shipmentCode,是否POD:Number(row.isPod||0)===1?'是':'否',
    主分类:row.primaryCategory||row.category||'',异常分类:Number(row.isPod||0)===1?'POD闭环':(row.primaryCategory||row.category||''),
    QC判断:row.qcConclusion||'',最后节点:row.lastEventDesc||row.lastEvent||'',最后节点时间:row.lastEventTime||'',
    Pending天数:Number(row.pendingDays||0),Pending次数:Number(row.pendingDays||0),OC天数:Number(row.ocDays||0),盘点天数:Number(row.cycleCountDays||0)
  }));
}
function shopeeFinalRows(db,date,type,members){
  if(!members.size)return [];
  const rows=db.prepare(`SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,targetShopCode,currentShopCode,shopName,shopCycleId,shopTransferStartedAt,shopArrivedAt,shopLastEventAt,shopPendingAt,shopPendingReason,shopRetentionNaturalDays,shopState,shopStateReason,currentMainCategory,firstAttemptAt,currentAttemptNo,podAttemptNo,attemptStatus,attemptConfidence,attemptUnknownReason,attemptCalculatedAt FROM business_final_rows WHERE businessType='SHOPEE' AND reportDate=? ORDER BY shipmentCode`).all(date);
  const group=type==='SHOPEECN'?'CN':'VN';
  return rows.filter(row=>members.has(String(row.shipmentCode||'').toUpperCase())).map(row=>({
    ...row,businessType:type,viewBusinessType:type,运单号:row.shipmentCode,recipient_group:group,recipientGroup:group,
    是否POD:Number(row.isPod||0)===1?'是':'否',primaryCategory:row.currentMainCategory||row.primaryCategory||'',主分类:row.currentMainCategory||row.primaryCategory||'',
    异常分类:Number(row.isPod||0)===1?'POD闭环':(row.currentMainCategory||row.primaryCategory||''),API状态:row.apiStatus||'',
    最后节点时间:row.latestEventTime||'',最后节点:row.latestEventDesc||row.latestNode||'',门店编码:row.currentShopCode||row.targetShopCode||'',门店名称:row.shopName||'',门店入库时间:row.shopArrivedAt||''
  }));
}
function scanRows(db,date,type,members){
  if(!members.size)return [];
  if(SHOPEE_TYPES.has(type)){
    return db.prepare("SELECT shipmentCode,isPod,orderStatus,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number FROM business_scan_results WHERE businessType='SHOPEE' AND reportDate=? ORDER BY shipmentCode").all(date)
      .filter(row=>members.has(String(row.shipmentCode||'').toUpperCase())).map(row=>({...row,businessType:type,运单号:row.shipmentCode,是否POD:Number(row.isPod||0)===1||String(row.orderStatus||'')==='85'?'是':'否'}));
  }
  return db.prepare('SELECT shipmentCode,sourceType,orderStatus,isPod,scanCategory,pickupShop,deliveryShop,productCode,customerName FROM scan_results WHERE reportDate=? ORDER BY shipmentCode').all(date)
    .filter(row=>members.has(String(row.shipmentCode||'').toUpperCase())).map(row=>({...row,businessType:type,运单号:row.shipmentCode,是否POD:Number(row.isPod||0)===1||String(row.orderStatus||'')==='85'?'是':'否'}));
}
function runFor(db,date,type){
  if(SHOPEE_TYPES.has(type))return db.prepare("SELECT * FROM business_run_locks WHERE businessType='SHOPEE' AND reportDate=? ORDER BY updatedAt DESC LIMIT 1").get(date)||null;
  return db.prepare('SELECT * FROM run_locks WHERE reportDate=? LIMIT 1').get(date)||null;
}
function finalCounts(db,date,type,members){
  if(!members.size)return {pod:0,oc:0,firstPod:0,a1:0,a2:0,a3:0,unknown:0};
  if(SHOPEE_TYPES.has(type)){
    const rows=db.prepare("SELECT shipmentCode,isPod,currentMainCategory,primaryCategory,podAttemptNo,currentAttemptNo FROM business_final_rows WHERE businessType='SHOPEE' AND reportDate=?").all(date).filter(row=>members.has(String(row.shipmentCode||'').toUpperCase()));
    let pod=0,oc=0,a1=0,a2=0,a3=0,unknown=0;
    for(const row of rows){
      if(/OC/i.test(String(row.currentMainCategory||row.primaryCategory||'')))oc++;
      if(Number(row.isPod||0)!==1)continue;pod++;
      const a=Math.max(0,Number(row.podAttemptNo||row.currentAttemptNo||0));
      if(a===1)a1++;else if(a===2)a2++;else if(a>=3)a3++;else unknown++;
    }
    return {pod,oc,firstPod:a1,a1,a2,a3,unknown};
  }
  const rows=db.prepare('SELECT shipmentCode,isPod,ocDays FROM final_rows WHERE reportDate=?').all(date).filter(row=>members.has(String(row.shipmentCode||'').toUpperCase()));
  const pod=rows.filter(row=>Number(row.isPod||0)===1).length;
  const oc=rows.filter(row=>Number(row.ocDays||0)>0).length;
  return {pod,oc,firstPod:pod,a1:0,a2:0,a3:0,unknown:0};
}
function globalDates(db,throughDate='9999-12-31',limit=30){
  const max=Math.max(2,Math.min(120,Number(limit||30)));
  const rows=db.prepare(`SELECT reportDate FROM (
    SELECT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=?
    UNION SELECT reportDate FROM daily_reports WHERE reportDate<=?
    UNION SELECT reportDate FROM business_daily_reports WHERE reportDate<=?
    UNION SELECT reportDate FROM shipment_daily_snapshots WHERE reportDate<=?
  ) WHERE reportDate<>'' GROUP BY reportDate ORDER BY reportDate DESC LIMIT ?`).all(throughDate,throughDate,throughDate,throughDate,max);
  return rows.map(row=>String(row.reportDate||'')).filter(Boolean);
}
function historyFor(type,throughDate,limit=30){
  const db=getDb();
  const dates=globalDates(db,throughDate,Math.max(limit,14));
  const out=[];
  for(const date of dates){
    const latest=db.prepare("SELECT snapshotId FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(date)||{};
    const membership=membersFor(db,type,date,latest.snapshotId||'');
    const total=membership.rows.length;
    const counts=finalCounts(db,date,type,memberSet(membership.rows));
    out.push({reportDate:date,businessType:type,source:membership.source,summary:{reportDate:date,today:total,pnh:total,todayPnh:total,todayPod:counts.pod,scanPod:counts.pod,podRate:rate(counts.pod,total),firstPodRate:rate(counts.firstPod,total),ocRate:rate(counts.oc,total)},attempts:counts});
    if(out.length>=limit)break;
  }
  return out.sort((a,b)=>a.reportDate.localeCompare(b.reportDate));
}
function aggregateHistory(states=[]){
  const byDate=new Map();
  for(const state of states){for(const item of state.historySummary||[]){const s=item.summary||{};const date=item.reportDate||s.reportDate;if(!date)continue;if(!byDate.has(date))byDate.set(date,{total:0,pod:0,first:0,oc:0});const v=byDate.get(date),t=Number(s.today??s.pnh??0);v.total+=t;v.pod+=Number(s.todayPod??s.scanPod??0);v.first+=t*Number(s.firstPodRate||0)/100;v.oc+=t*Number(s.ocRate||0)/100;}}
  return [...byDate.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([reportDate,v])=>({reportDate,summary:{reportDate,today:v.total,pnh:v.total,todayPnh:v.total,todayPod:Math.round(v.pod),scanPod:Math.round(v.pod),podRate:rate(v.pod,v.total),firstPodRate:rate(v.first,v.total),ocRate:rate(v.oc,v.total)}}));
}
function buildFallbackState(type,date,snapshotId=''){
  const db=getDb();
  const membership=membersFor(db,type,date,snapshotId);
  const dailyRows=membership.rows;
  const bills=dailyRows.map(codeOf).filter(Boolean);
  const members=memberSet(dailyRows);
  const finals=SHOPEE_TYPES.has(type)?shopeeFinalRows(db,date,type,members):ccslFinalRows(db,date,type,members);
  const scans=scanRows(db,date,type,members);
  const carry=db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE businessType=? AND status='OPEN' AND lastReportDate<=? ORDER BY shipmentCode").all(type,date).map(row=>row.shipmentCode).filter(bill=>members.has(String(bill||'').toUpperCase()));
  const podLocks=[...new Set(finals.filter(row=>row.是否POD==='是').map(codeOf).filter(Boolean))];
  const run=runFor(db,date,type);
  const batch=latestValidBatch(db,snapshotId)||db.prepare("SELECT b.*,COALESCE(s.status,'') snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.reportDate=? AND b.status='VALID' ORDER BY b.createdAt DESC LIMIT 1").get(date)||null;
  const state={
    businessType:type,viewBusinessType:type,reportDate:date,sourceName:sourceNameForDate(db,date,type,batch),batchId:batch?.batchId||'',snapshotId:batch?.snapshotId||snapshotId||`LEGACY:${date}`,snapshotStatus:batch?.snapshotStatus||'LEGACY_SAVED',dailyReportReady:bills.length>0,
    pnhBills:bills,nonPnhBills:[],excludedBills:[],duplicateBills:[],dailyParseRows:dailyRows,dailyParseSummary:{totalRecognized:bills.length,pnh:bills.length,nonPnh:0,excluded:0,duplicates:0,groupCounts:{CN:type==='SHOPEECN'?bills.length:0,VN:type==='SHOPEEVN'?bills.length:0}},
    finalRows:finals,scanResults:scans,scanPool:bills,needTrackBills:scans.filter(row=>row.是否POD!=='是').map(codeOf).filter(Boolean),trackResults:finals,trackEvents:[],carryBills:carry,nextCarryBills:carry,podLocks,
    historySummary:historyFor(type,date,30),currentRun:run,lastRunSummary:run?{runId:run.runId,reportDate:date,runStatus:run.status}:null,processing:run?{running:run.status==='running',paused:run.status==='paused',phase:run.currentStage||'',batchIndex:Number(run.batchIndex||0),totalBatches:Number(run.totalBatches||0),error:run.errorMessage||''}:{running:false,paused:false,phase:''},logs:[],_v152FactSource:membership.source,_normalizedSqliteRead:true
  };
  return state;
}
function authoritativeRawState(type,{snapshotId='',dateHint=''}={}){
  let light=null;
  try{light=loadLightweightUnifiedBusinessState(type,snapshotId);}catch{}
  if((light?.pnhBills||[]).length>0){
    return {...light,historySummary:historyFor(type,light.reportDate||dateHint||'9999-12-31',30),_v152FactSource:'LIGHTWEIGHT_UNIFIED'};
  }
  const db=getDb();
  const batch=latestValidBatch(db,snapshotId);
  const date=dateOnly(light?.reportDate)||dateOnly(batch?.reportDate)||dateOnly(dateHint)||dateOnly(latestLegacyDate(db));
  return date?buildFallbackState(type,date,batch?.snapshotId||snapshotId):buildFallbackState(type,'',snapshotId);
}
function decorateState(type,raw){
  if(SHOPEE_TYPES.has(type)){
    const dashboard=buildShopeeDashboard({...raw,businessType:'SHOPEE'});
    return {...raw,businessType:'SHOPEE',viewBusinessType:type,total:(raw.pnhBills||[]).length,dailySummary:raw.dailyParseSummary||{},dashboard,detailTabs:dashboard.detailTabs};
  }
  const dashboard=buildDashboardData(raw);
  const state={...raw,viewBusinessType:type,dashboard,detailTabs:buildDetailTabs(raw)};
  state.detailTabs.dashboard={label:`${type}总看板`,rows:buildDashboardRows(raw),total:buildDashboardRows(raw).length};
  return state;
}
function aggregateRaw(scope,states){
  const active=states.filter(Boolean);if(!active.length)return {};
  const ref=active[0];const unique=key=>[...new Set(active.flatMap(state=>(state[key]||[]).map(item=>typeof item==='string'?item:codeOf(item))).filter(Boolean))];
  return {businessType:scope,reportDate:ref.reportDate,sourceName:ref.sourceName,snapshotId:ref.snapshotId,snapshotStatus:active.every(s=>s.snapshotStatus==='COMPLETED')?'COMPLETED':ref.snapshotStatus,dailyReportReady:true,pnhBills:unique('pnhBills'),nonPnhBills:[],excludedBills:[],duplicateBills:[],dailyParseRows:active.flatMap(s=>s.dailyParseRows||[]),dailyParseSummary:{totalRecognized:active.reduce((n,s)=>n+(s.pnhBills||[]).length,0),pnh:active.reduce((n,s)=>n+(s.pnhBills||[]).length,0),groupCounts:{CN:active.find(s=>s.viewBusinessType==='SHOPEECN'||s.businessType==='SHOPEECN')?.pnhBills?.length||0,VN:active.find(s=>s.viewBusinessType==='SHOPEEVN'||s.businessType==='SHOPEEVN')?.pnhBills?.length||0}},finalRows:active.flatMap(s=>s.finalRows||[]),scanResults:active.flatMap(s=>s.scanResults||[]),scanPool:unique('pnhBills'),needTrackBills:unique('needTrackBills'),trackResults:active.flatMap(s=>s.trackResults||[]),trackEvents:[],carryBills:unique('carryBills'),nextCarryBills:unique('nextCarryBills'),podLocks:unique('podLocks'),historySummary:aggregateHistory(active),currentRun:ref.currentRun||null,lastRunSummary:ref.lastRunSummary||null,processing:ref.processing||{running:false,paused:false,phase:''},logs:[],_v152FactSource:'AGGREGATED_FACT_STATES'};
}
function compactBoardState(state={}){
  return {...state,dailyParseRows:[],scanResults:[],trackResults:[],trackEvents:[],finalRows:[],carryBills:[],nextCarryBills:[],podLocks:[],needTrackBills:[],logs:[],_v152Compact:true};
}
function repairBusinessResponse(req,body){
  if(!body||body.ok===false)return body;
  const type=normalizeType(req.params?.businessType||body.businessType||body.state?.viewBusinessType||body.state?.businessType||'');if(!TYPES.includes(type))return body;
  const sid=String(req.query?.snapshotId||body.snapshotId||'');
  const hint=dateOnly(body.reportDate||body.state?.reportDate||'');
  const existingTotal=Number(body.state?.pnhBills?.length||body.state?.total||0);
  if(existingTotal>0&&body.state?._v152FactSource)return body;
  const raw=authoritativeRawState(type,{snapshotId:sid,dateHint:hint});
  if((raw.pnhBills||[]).length===0&&existingTotal>0)return body;
  const state=decorateState(type,raw);
  return {...body,ok:true,businessType:type,reportDate:raw.reportDate,snapshotId:raw.snapshotId,snapshotStatus:raw.snapshotStatus,state:req.query?.compact==='1'?compactBoardState(state):state,factSource:raw._v152FactSource||''};
}
function repairBootstrap(body){
  if(!body||body.ok===false)return body;
  const db=getDb();
  const imported=body.unifiedImport||body.import||null;
  const batch=latestValidBatch(db,String(imported?.snapshotId||''));
  const date=dateOnly(imported?.reportDate)||dateOnly(batch?.reportDate)||dateOnly(latestLegacyDate(db));
  const sid=String(imported?.snapshotId||batch?.snapshotId||'');
  const rawByType={};const decorated={};
  for(const type of TYPES){rawByType[type]=authoritativeRawState(type,{snapshotId:sid,dateHint:date});decorated[type]=decorateState(type,rawByType[type]);}
  body.businessStates={...(body.businessStates||{}),...Object.fromEntries(TYPES.map(type=>[type,compactBoardState(decorated[type])]))};
  const ccslRaw=aggregateRaw('CCSL',['CE','CEAF','TBKH','ALI1688'].map(type=>rawByType[type]));
  const shopeeRaw=aggregateRaw('SHOPEE',['SHOPEECN','SHOPEEVN'].map(type=>rawByType[type]));
  if(ccslRaw.reportDate){const summary=summarizeLightweightCcslState(ccslRaw,{});body.state={...(body.state||{}),...summary,dbStatus:body.state?.dbStatus||summary.dbStatus,network:body.state?.network||summary.network,shopCodes:body.state?.shopCodes||summary.shopCodes};}
  if(shopeeRaw.reportDate){const summary=summarizeLightweightShopeeState(shopeeRaw,{});body.shopeeState={...(body.shopeeState||{}),...summary,dbStatus:body.shopeeState?.dbStatus||summary.dbStatus};}
  body.factTruth={patchId:PATCH_ID,reportDate:date,snapshotId:sid,counts:Object.fromEntries(TYPES.map(type=>[type,(rawByType[type].pnhBills||[]).length]))};
  return body;
}
function whppHistory(throughDate,limit=30){
  const db=getDb();const rows=db.prepare("SELECT reportDate,totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate<=? ORDER BY reportDate DESC LIMIT ?").all(throughDate||'9999-12-31',Math.max(2,Math.min(120,limit)));
  return rows.reverse().map(row=>{const s=safeJson(db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(row.reportDate)?.summaryJson,{});const total=Number(s.total??row.totalCount??0),pod=Number(s.pod??0),oc=Number(s.oc1??s.oc??0);return {reportDate:row.reportDate,summary:{today:total,pnh:total,todayPod:pod,scanPod:pod,podRate:Number(s.podRate??rate(pod,total)),firstPodRate:Number(s.firstPodRate??s.podRate??rate(pod,total)),ocRate:Number(s.ocRate??rate(oc,total))},attempts:{a1:0,a2:0,a3:0,unknown:0}};});
}
function trendRows(type,throughDate,limit=30){
  if(type==='WHPP')return whppHistory(throughDate,limit);
  if(type==='CCSL'){
    const all=['CE','CEAF','TBKH','ALI1688'].map(t=>historyFor(t,throughDate,limit));
    const fake=all.map((history,i)=>({historySummary:history,viewBusinessType:['CE','CEAF','TBKH','ALI1688'][i]}));
    return aggregateHistory(fake);
  }
  if(type==='SHOPEE'){
    const all=['SHOPEECN','SHOPEEVN'].map(t=>historyFor(t,throughDate,limit));
    const fake=all.map((history,i)=>({historySummary:history,viewBusinessType:['SHOPEECN','SHOPEEVN'][i]}));
    return aggregateHistory(fake);
  }
  return historyFor(type,throughDate,limit);
}
function trendResponse(req,body){
  const type=String(req.query?.businessType||'CCSL').toUpperCase();
  if(![...TYPES,'CCSL','SHOPEE','WHPP'].includes(type))return body;
  const to=dateOnly(req.query?.to)||dateOnly(body?.requestedToDate)||dateOnly(body?.toDate)||'9999-12-31';
  const from=dateOnly(req.query?.from)||to;
  let rows=trendRows(type,to,60);
  if(from!==to)rows=rows.filter(row=>row.reportDate>=from&&row.reportDate<=to);
  else rows=rows.slice(-7);
  const dates=rows.map(row=>row.reportDate);
  const payload={ok:true,businessType:type,requestedFromDate:from,requestedToDate:to,fromDate:dates[0]||from,toDate:dates.at(-1)||to,trendWindowDates:dates,dates,ticket:[],podRate:[],ocRate:[],firstRate:[],attempt1:[],attempt2:[],attempt3:[],attempt1Count:[],attempt2Count:[],attempt3Count:[],attemptDenominator:[],attemptUnknownPod:[],factSource:'V152_MULTI_GENERATION_FACTS'};
  for(const row of rows){const s=row.summary||{};payload.ticket.push(Number(s.today??s.pnh??0));payload.podRate.push(Number(s.podRate||0));payload.ocRate.push(Number(s.ocRate||0));payload.firstRate.push(Number(s.firstPodRate??s.podRate??0));if(SHOPEE_TYPES.has(type)){const a=row.attempts||{};const total=Number(s.today??s.pnh??0);payload.attemptDenominator.push(total);payload.attempt1Count.push(Number(a.a1||0));payload.attempt2Count.push(Number(a.a2||0));payload.attempt3Count.push(Number(a.a3||0));payload.attempt1.push(rate(a.a1,total));payload.attempt2.push(rate(a.a2,total));payload.attempt3.push(rate(a.a3,total));payload.attemptUnknownPod.push(Number(a.unknown||0));}}
  return payload;
}
function wrapJson(handler,kind){
  return function v152FactJsonGuard(req,res,next){
    const original=res.json.bind(res);
    res.json=function v152FactJson(body){
      try{
        if(kind==='bootstrap')body=repairBootstrap(body);
        else if(kind==='business')body=repairBusinessResponse(req,body);
        else if(kind==='trend')body=trendResponse(req,body);
      }catch(error){console.warn(`[CE-QC][V152_FACT_TRUTH] ${kind} fallback skipped:`,error?.message||error);}
      return original(body);
    };
    return handler.call(this,req,res,next);
  };
}
const previousGet=express.application.get;
if(typeof previousGet==='function'&&!previousGet[WRAPPED]){
  const wrapped=function v152FactTruthGet(path,...handlers){
    let kind='';
    if(path==='/api/bootstrap')kind='bootstrap';
    else if(path==='/api/business-state/:businessType')kind='business';
    else if(path==='/api/v27/trends')kind='trend';
    if(!kind||!handlers.length)return previousGet.call(this,path,...handlers);
    const final=handlers.pop();
    if(typeof final!=='function'){handlers.push(final);return previousGet.call(this,path,...handlers);}
    return previousGet.call(this,path,...handlers,wrapJson(final,kind));
  };
  Object.defineProperty(wrapped,WRAPPED,{value:true});
  express.application.get=wrapped;
}

export const V152_FACT_TRUTH_PATCH_ID=PATCH_ID;
export const __test={normalizeType,explicitLegacyCcslType};
