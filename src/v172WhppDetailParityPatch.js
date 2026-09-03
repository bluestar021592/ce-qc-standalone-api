import express from 'express';
import { getDb } from './db.js';
import { loadWhppState } from './whppStore.js';
import { buildWhppDashboard } from './whppReporting.js';

const PATCH_ID='2026-09-03-v419-whpp-global-range-detail-current-truth-v2';
const ROUTE='/api/v172/whpp-metric-detail';
const MAX_RANGE_DAYS=180;

function dateOnly(value=''){const text=String(value||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function regionOf(row={}){const code=String(row.regionCode||row.区域||'').trim().toUpperCase();return code==='PP'?'PP':code==='PV'?'PV':'UNKNOWN';}
function normalizeTab(value='all'){const raw=String(value||'all').trim(),aliases={podRate:'pod',returnRate:'returned','签收率':'pod','签收件数':'pod','今日POD':'pod','区间POD':'pod','POD率':'pod','已退回件':'returned','当前未闭环':'unresolved','订单取消':'cancelled','Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','派送中':'delivery','CCSLCN':'ccslCnDiversion','CEZT':'ccslZtDiversion','CCSL580':'ccsl580Retention','金边门店':'phnomPenhShop','外省门店':'provinceShop'};return aliases[raw]||raw||'all';}
function rangeDays(from,to){const a=Date.parse(`${from}T00:00:00Z`),b=Date.parse(`${to}T00:00:00Z`);return!Number.isFinite(a)||!Number.isFinite(b)||b<a?0:Math.floor((b-a)/86400000)+1;}
function memberDates(from,to){
  const db=getDb(),dates=new Set();
  try{for(const row of db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate").all(from,to))if(dateOnly(row.reportDate))dates.add(dateOnly(row.reportDate));}catch{}
  try{for(const row of db.prepare("SELECT DISTINCT reportDate FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate").all(from,to))if(dateOnly(row.reportDate))dates.add(dateOnly(row.reportDate));}catch{}
  try{for(const row of db.prepare("SELECT DISTINCT reportDate FROM unified_import_rows WHERE UPPER(TRIM(businessType))='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate").all(from,to))if(dateOnly(row.reportDate))dates.add(dateOnly(row.reportDate));}catch{}
  return[...dates].sort();
}
function currentWhppRows(bills=[]){
  const db=getDb(),out=new Map(),codes=[...new Set(bills.map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))];
  for(let i=0;i<codes.length;i+=300){const part=codes.slice(i,i+300),marks=part.map(()=>'?').join(',');if(!marks)continue;let rows=[];try{rows=db.prepare(`SELECT shipmentCode,businessType,reportDate,state,apiStatus,lastEventTime,stateJson,updatedAt FROM shipment_current_state WHERE UPPER(TRIM(businessType))='WHPP' AND UPPER(TRIM(shipmentCode)) IN (${marks})`).all(...part);}catch{rows=[];}for(const row of rows)out.set(String(row.shipmentCode||'').trim().toUpperCase(),row);}
  return out;
}
function overlayCurrentTruth(state={}){
  const bills=[...new Set([...(state.pnhBills||[]).map(String),...(state.dailyParseRows||[]).map(billOf),...(state.finalRows||[]).map(billOf)].map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))];if(!bills.length)return state;
  const current=currentWhppRows(bills),daily=new Map((state.dailyParseRows||[]).map(row=>[billOf(row),row])),finals=new Map((state.finalRows||[]).map(row=>[billOf(row),row])),merged=[];
  for(const bill of bills){const c=current.get(bill),raw=safeJson(c?.stateJson,{}),base={...(daily.get(bill)||{}),...(finals.get(bill)||{}),...raw};if(c){base.currentState=c.state||base.currentState||'';base.apiStatus=c.apiStatus||base.apiStatus||base.API状态||'';base.API状态=base.API状态||c.apiStatus||'';base.latestEventTime=c.lastEventTime||base.latestEventTime||base.最后节点时间||'';base.最后节点时间=base.最后节点时间||c.lastEventTime||'';const terminal=String(c.state||'').toUpperCase();if(terminal==='POD'){base.是否POD='是';base.POD状态='POD';base.退回状态='';}if(['RETURNED','RETURN_COMPLETED'].includes(terminal)&&base.是否POD!=='是')base.退回状态='已退回';base.currentTruthUpdatedAt=c.updatedAt||'';base.currentTruthSource='SHIPMENT_CURRENT_STATE';}base.shipmentCode=bill;base.运单号=bill;base.businessType='WHPP';merged.push(base);}
  return{...state,pnhBills:bills,finalRows:merged};
}
function directStateForDate(reportDate){
  const db=getDb();let source=[];
  try{source=db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY source_row_number,rowNumber,id").all(reportDate).map(row=>({...safeJson(row.rowJson,{}),shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),运单号:String(row.shipmentCode||'').trim().toUpperCase()}));}catch{source=[];}
  if(!source.length){
    try{const batch=db.prepare(`SELECT b.snapshotId FROM unified_import_batches b WHERE b.status='VALID' AND b.reportDate=? AND EXISTS(SELECT 1 FROM unified_import_rows u WHERE u.snapshotId=b.snapshotId AND UPPER(TRIM(u.businessType))='WHPP') ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(reportDate);if(batch?.snapshotId)source=db.prepare("SELECT shipmentCode,regionCode,rowJson FROM unified_import_rows WHERE snapshotId=? AND UPPER(TRIM(businessType))='WHPP' ORDER BY rowNumber,shipmentCode").all(batch.snapshotId).map(row=>({...safeJson(row.rowJson,{}),shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),运单号:String(row.shipmentCode||'').trim().toUpperCase(),regionCode:row.regionCode||safeJson(row.rowJson,{}).regionCode||''}));}catch{source=[];}
  }
  const bills=[...new Set(source.map(billOf).filter(Boolean))];if(!bills.length)return{businessType:'WHPP',reportDate,pnhBills:[],dailyParseRows:[],finalRows:[],detailMembershipSource:'NO_SAVED_DAILY_MEMBERS'};
  let finals=[];try{finals=db.prepare("SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode").all(reportDate).map(row=>({...safeJson(row.rawJson,{}),shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),运单号:String(row.shipmentCode||'').trim().toUpperCase(),是否POD:Number(row.isPod||0)===1?'是':safeJson(row.rawJson,{}).是否POD||'否',primaryCategory:row.primaryCategory||safeJson(row.rawJson,{}).primaryCategory||'',apiStatus:row.apiStatus||'',carryStatus:row.carryStatus||'',latestEventTime:row.latestEventTime||'',latestEventDesc:row.latestEventDesc||'',latestNode:row.latestNode||''}));}catch{finals=[];}
  return{businessType:'WHPP',reportDate,pnhBills:bills,dailyParseRows:source,finalRows:finals,detailMembershipSource:source[0]?.classificationReason?'UNIFIED_IMPORT_ROWS':'PERSISTED_DAILY_MEMBER_ROWS'};
}
function stateForDate(reportDate=''){
  const requested=dateOnly(reportDate),current=loadWhppState();if(!requested||requested===dateOnly(current.reportDate))return overlayCurrentTruth(current);
  const row=getDb().prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC,id DESC LIMIT 1").get(requested);
  if(row){const payload=safeJson(row.payloadJson,{}),saved=payload.state||{};if((saved.pnhBills||[]).length||(saved.dailyParseRows||[]).length)return overlayCurrentTruth({...saved,businessType:'WHPP',reportDate:requested,detailMembershipSource:'BUSINESS_EXPORT_SNAPSHOT'});}
  return overlayCurrentTruth(directStateForDate(requested));
}
function rowsForState(reportDate,tab,region=''){const state=stateForDate(reportDate),dashboard=buildWhppDashboard(state),detail=dashboard.detailTabs?.[tab]||dashboard.detailTabs?.all||{label:tab,rows:[]};let rows=Array.isArray(detail.rows)?detail.rows:[];if(region==='PP'||region==='PV')rows=rows.filter(row=>regionOf(row)===region);return{label:detail.label||tab,rows:rows.map(row=>({...row,reportMembershipDate:reportDate,日报日期:reportDate,detailMembershipSource:row.detailMembershipSource||state.detailMembershipSource||''}))};}
function build(query={}){
  const tab=normalizeTab(query.tab||query.metric||'all'),region=String(query.region||'').trim().toUpperCase(),explicitFrom=dateOnly(query.from||query.fromDate||''),explicitTo=dateOnly(query.to||query.toDate||''),single=dateOnly(query.reportDate||query.date||''),from=explicitFrom||single,to=explicitTo||single||from;
  if(!from||!to||from>to)throw new Error('WHPP明细日期范围无效。');const days=rangeDays(from,to);if(days>MAX_RANGE_DAYS)throw new Error(`WHPP明细单次日期范围最多${MAX_RANGE_DAYS}天。`);
  const dates=from===to?[from]:memberDates(from,to);let label=tab;const rows=[];for(const reportDate of dates){const part=rowsForState(reportDate,tab,region);label=part.label||label;rows.push(...part.rows);}rows.sort((a,b)=>String(a.reportMembershipDate||'').localeCompare(String(b.reportMembershipDate||''))||billOf(a).localeCompare(billOf(b)));
  const page=Math.max(1,Number(query.page||1)),pageSize=Math.max(1,Math.min(500,Number(query.pageSize||200))),start=(page-1)*pageSize,regionLabel=region==='PP'?'本省PP':region==='PV'?'外省PV':'';
  return{ok:true,patchId:PATCH_ID,businessType:'WHPP',reportDate:to,fromDate:from,toDate:to,range:from!==to,dates,tab,region,label:`${regionLabel}${regionLabel?' · ':''}${label}`,total:rows.length,page,pageSize,rows:rows.slice(start,start+pageSize),truthSource:'DAILY_MEMBERSHIP_PLUS_LATEST_SHIPMENT_CURRENT_STATE'};
}

const previousListen=express.application.listen;let installed=false;
express.application.listen=function v419WhppGlobalRangeDetailListen(...args){if(!installed){installed=true;this.get(ROUTE,(req,res)=>{try{res.setHeader('Cache-Control','no-store');res.setHeader('X-CE-QC-WHPP-Detail',PATCH_ID);res.json(build(req.query||{}));}catch(error){res.status(500).json({ok:false,patchId:PATCH_ID,error:error?.message||String(error)});}});}return previousListen.apply(this,args);};
export function inspectV172WhppDetail(query={}){return build(query);}
export const V172_WHPP_DETAIL_PARITY_PATCH_ID=PATCH_ID;
