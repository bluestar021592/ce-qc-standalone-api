import express from 'express';
import { getDb } from './db.js';
import { loadWhppState } from './whppStore.js';
import { buildWhppDashboard } from './whppReporting.js';

const PATCH_ID='2026-09-03-v419-whpp-immutable-membership-detail-v6';
const ROUTE='/api/v172/whpp-metric-detail';
const MAX_RANGE_DAYS=180;

function dateOnly(value=''){const text=String(value||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function billOf(row={}){return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();}
function uniqueBills(values=[]){return[...new Set(values.map(value=>typeof value==='string'?String(value||'').trim().toUpperCase():billOf(value)).filter(Boolean))];}
function regionOf(row={}){const code=String(row.regionCode||row.区域||'').trim().toUpperCase();return code==='PP'?'PP':code==='PV'?'PV':'UNKNOWN';}
function normalizeTab(value='all'){const raw=String(value||'all').trim(),aliases={podRate:'pod',returnRate:'returned','签收率':'pod','签收件数':'pod','今日POD':'pod','区间POD':'pod','POD率':'pod','已退回件':'returned','当前未闭环':'unresolved','订单取消':'cancelled','Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan','派送中':'delivery','CCSLCN':'ccslCnDiversion','CEZT':'ccslZtDiversion','CCSL580':'ccsl580Retention','金边门店':'phnomPenhShop','外省门店':'provinceShop'};return aliases[raw]||raw||'all';}
function rangeDays(from,to){const a=Date.parse(`${from}T00:00:00Z`),b=Date.parse(`${to}T00:00:00Z`);return!Number.isFinite(a)||!Number.isFinite(b)||b<a?0:Math.floor((b-a)/86400000)+1;}
function standardMembershipMeta(reportDate){
  const db=getDb();let header=null,actual=0;
  try{header=db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate)||null;}catch{header=null;}
  if(!header)return{header:false,expected:null,actual:0,complete:false,rotated:true};
  const expected=Math.max(0,Number(header.totalCount||0));
  try{actual=Number(db.prepare("SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''").get(reportDate)?.count||0);}catch{actual=0;}
  if(actual===expected)return{header:true,expected,actual,complete:true,rotated:false};
  if(expected>0&&actual===0)return{header:true,expected,actual,complete:false,rotated:true};
  const error=new Error(`WHPP_STANDARD_DAILY_INCOMPLETE:${reportDate}:${expected}/${actual}`);error.code='WHPP_STANDARD_DAILY_INCOMPLETE';error.reportDate=reportDate;error.expected=expected;error.actual=actual;throw error;
}
function memberDates(from,to){
  const db=getDb(),dates=new Set();
  try{for(const row of db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate").all(from,to))if(dateOnly(row.reportDate))dates.add(dateOnly(row.reportDate));}catch{}
  try{for(const row of db.prepare("SELECT DISTINCT reportDate FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY reportDate").all(from,to))if(dateOnly(row.reportDate))dates.add(dateOnly(row.reportDate));}catch{}
  try{for(const row of db.prepare("SELECT DISTINCT u.reportDate FROM unified_import_rows u INNER JOIN unified_import_batches b ON b.snapshotId=u.snapshotId AND b.reportDate=u.reportDate AND b.status='VALID' WHERE UPPER(TRIM(u.businessType))='WHPP' AND u.reportDate BETWEEN ? AND ? ORDER BY u.reportDate").all(from,to))if(dateOnly(row.reportDate))dates.add(dateOnly(row.reportDate));}catch{}
  return[...dates].sort();
}
function currentWhppRows(bills=[]){
  const db=getDb(),out=new Map(),codes=uniqueBills(bills);
  for(let i=0;i<codes.length;i+=300){const part=codes.slice(i,i+300),marks=part.map(()=>'?').join(',');if(!marks)continue;let rows=[];try{rows=db.prepare(`SELECT shipmentCode,businessType,reportDate,state,apiStatus,lastEventTime,stateJson,updatedAt FROM shipment_current_state WHERE UPPER(TRIM(businessType))='WHPP' AND UPPER(TRIM(shipmentCode)) IN (${marks})`).all(...part);}catch{rows=[];}for(const row of rows)out.set(String(row.shipmentCode||'').trim().toUpperCase(),row);}
  return out;
}
function membershipMismatch(reportDate,pnhCount,dailyCount,code='WHPP_DETAIL_SNAPSHOT_MEMBERSHIP_MISMATCH'){
  const error=new Error(`${code}:${reportDate}:${pnhCount}/${dailyCount}`);error.code=code;error.reportDate=reportDate;error.pnhCount=pnhCount;error.dailyCount=dailyCount;return error;
}
function restrictStateToImmutableMembership(state={},reportDate='',integrity=null,source='WHPP_IMMUTABLE_DAILY'){
  const pnh=uniqueBills(state.pnhBills||[]),dailyRows=Array.isArray(state.dailyParseRows)?state.dailyParseRows:[],dailyBills=uniqueBills(dailyRows),pnhSorted=[...pnh].sort(),dailySorted=[...dailyBills].sort();
  if(pnh.length&&dailyBills.length){const same=pnhSorted.length===dailySorted.length&&pnhSorted.every((bill,index)=>bill===dailySorted[index]);if(!same)throw membershipMismatch(reportDate,pnh.length,dailyBills.length,source==='CURRENT_WHPP_STATE'?'WHPP_DETAIL_CURRENT_MEMBERSHIP_MISMATCH':'WHPP_DETAIL_SNAPSHOT_MEMBERSHIP_MISMATCH');}
  const bills=pnh.length?pnh:dailyBills;
  if(integrity?.header&&integrity.expected!==null&&bills.length!==integrity.expected){const error=new Error(`WHPP_DETAIL_RECOVERED_MEMBERSHIP_MISMATCH:${reportDate}:${integrity.expected}/${bills.length}:${source}`);error.code='WHPP_DETAIL_RECOVERED_MEMBERSHIP_MISMATCH';error.reportDate=reportDate;error.expected=integrity.expected;error.actual=bills.length;error.source=source;throw error;}
  if(!bills.length){if(integrity?.expected===0)return{businessType:'WHPP',reportDate,pnhBills:[],dailyParseRows:[],finalRows:[],detailMembershipSource:'WHPP_STANDARD_DAILY_ZERO'};return{businessType:'WHPP',reportDate,pnhBills:[],dailyParseRows:[],finalRows:[],detailMembershipSource:'NO_SAVED_DAILY_MEMBERS'};}
  const allowed=new Set(bills),dailyByBill=new Map(dailyRows.map(row=>[billOf(row),row]).filter(([bill])=>allowed.has(bill))),finalRows=(Array.isArray(state.finalRows)?state.finalRows:[]).filter(row=>allowed.has(billOf(row)));
  return{...state,businessType:'WHPP',reportDate,pnhBills:bills,dailyParseRows:bills.map(bill=>dailyByBill.get(bill)||{shipmentCode:bill,运单号:bill}),finalRows,detailMembershipSource:source};
}
function overlayCurrentTruth(state={}){
  // State has already been restricted to immutable daily membership. finalRows
  // may enrich those members but can never add carryover membership here.
  const bills=uniqueBills(state.pnhBills?.length?state.pnhBills:state.dailyParseRows||[]);if(!bills.length)return{...state,pnhBills:[],finalRows:[]};
  const current=currentWhppRows(bills),daily=new Map((state.dailyParseRows||[]).map(row=>[billOf(row),row])),finals=new Map((state.finalRows||[]).map(row=>[billOf(row),row])),merged=[];
  for(const bill of bills){const c=current.get(bill),raw=safeJson(c?.stateJson,{}),base={...(daily.get(bill)||{}),...(finals.get(bill)||{}),...raw};if(c){base.currentState=c.state||base.currentState||'';base.apiStatus=c.apiStatus||base.apiStatus||base.API状态||'';base.API状态=base.API状态||c.apiStatus||'';base.latestEventTime=c.lastEventTime||base.latestEventTime||base.最后节点时间||'';base.最后节点时间=base.最后节点时间||c.lastEventTime||'';const terminal=String(c.state||'').toUpperCase();if(terminal==='POD'){base.是否POD='是';base.POD状态='POD';base.退回状态='';}if(['RETURNED','RETURN_COMPLETED'].includes(terminal)&&base.是否POD!=='是')base.退回状态='已退回';base.currentTruthUpdatedAt=c.updatedAt||'';base.currentTruthSource='SHIPMENT_CURRENT_STATE';}base.shipmentCode=bill;base.运单号=bill;base.businessType='WHPP';merged.push(base);}
  return{...state,pnhBills:bills,finalRows:merged};
}
function directStateForDate(reportDate){
  const db=getDb();let source=[],sourceKind='PERSISTED_DAILY_MEMBER_ROWS';
  try{source=db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY source_row_number,rowNumber,id").all(reportDate).map(row=>({...safeJson(row.rowJson,{}),shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),运单号:String(row.shipmentCode||'').trim().toUpperCase()}));}catch{source=[];}
  if(!source.length){
    try{const batch=db.prepare(`SELECT b.snapshotId FROM unified_import_batches b WHERE b.status='VALID' AND b.reportDate=? AND EXISTS(SELECT 1 FROM unified_import_rows u WHERE u.snapshotId=b.snapshotId AND UPPER(TRIM(u.businessType))='WHPP' AND TRIM(COALESCE(u.shipmentCode,''))<>'') ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(reportDate);if(batch?.snapshotId){source=db.prepare("SELECT shipmentCode,regionCode,rowJson FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND UPPER(TRIM(businessType))='WHPP' ORDER BY rowNumber,shipmentCode").all(batch.snapshotId,reportDate).map(row=>({...safeJson(row.rowJson,{}),shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),运单号:String(row.shipmentCode||'').trim().toUpperCase(),regionCode:row.regionCode||safeJson(row.rowJson,{}).regionCode||''}));sourceKind='VALID_UNIFIED_IMPORT_ROWS';}}catch{source=[];}
  }
  const bills=uniqueBills(source);if(!bills.length)return{businessType:'WHPP',reportDate,pnhBills:[],dailyParseRows:[],finalRows:[],detailMembershipSource:'NO_SAVED_DAILY_MEMBERS'};
  let finals=[];for(let i=0;i<bills.length;i+=300){const part=bills.slice(i,i+300),marks=part.map(()=>'?').join(',');try{finals.push(...getDb().prepare(`SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? AND UPPER(TRIM(shipmentCode)) IN (${marks}) ORDER BY shipmentCode`).all(reportDate,...part).map(row=>({...safeJson(row.rawJson,{}),shipmentCode:String(row.shipmentCode||'').trim().toUpperCase(),运单号:String(row.shipmentCode||'').trim().toUpperCase(),是否POD:Number(row.isPod||0)===1?'是':safeJson(row.rawJson,{}).是否POD||'否',primaryCategory:row.primaryCategory||safeJson(row.rawJson,{}).primaryCategory||'',apiStatus:row.apiStatus||'',carryStatus:row.carryStatus||'',latestEventTime:row.latestEventTime||'',latestEventDesc:row.latestEventDesc||'',latestNode:row.latestNode||''})));}catch{}}
  return{businessType:'WHPP',reportDate,pnhBills:bills,dailyParseRows:source,finalRows:finals,detailMembershipSource:sourceKind};
}
function validCompletedSnapshotState(reportDate){
  const row=getDb().prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? AND COALESCE(status,'VALID')='VALID' AND COALESCE(reconciliationStatus,'COMPLETED')='COMPLETED' ORDER BY createdAt DESC,id DESC LIMIT 1").get(reportDate);
  if(!row)return null;const payload=safeJson(row.payloadJson,{}),saved=payload.state||{};return saved&&typeof saved==='object'?saved:null;
}
function stateForDate(reportDate=''){
  const requested=dateOnly(reportDate),current=loadWhppState();if(!requested){const unrestricted=restrictStateToImmutableMembership(current,dateOnly(current.reportDate),null,'CURRENT_WHPP_STATE');return overlayCurrentTruth(unrestricted);}
  const integrity=standardMembershipMeta(requested);
  if(requested===dateOnly(current.reportDate)){const normalized=restrictStateToImmutableMembership(current,requested,integrity,'CURRENT_WHPP_STATE');return overlayCurrentTruth(normalized);}
  if(integrity.complete){
    if(integrity.expected===0)return{businessType:'WHPP',reportDate:requested,pnhBills:[],dailyParseRows:[],finalRows:[],detailMembershipSource:'WHPP_STANDARD_DAILY_ZERO'};
    return overlayCurrentTruth(restrictStateToImmutableMembership(directStateForDate(requested),requested,integrity,'PERSISTED_DAILY_MEMBER_ROWS'));
  }
  // Fully rotated history: exact VALID unified membership is preferred before
  // loading an old snapshot payload. This mirrors the WHPP export owner.
  const direct=directStateForDate(requested);
  if((direct.pnhBills||[]).length)return overlayCurrentTruth(restrictStateToImmutableMembership(direct,requested,integrity,direct.detailMembershipSource||'VALID_UNIFIED_IMPORT_ROWS'));
  const saved=validCompletedSnapshotState(requested);
  if(saved){const normalized=restrictStateToImmutableMembership(saved,requested,integrity,'BUSINESS_EXPORT_SNAPSHOT_VALID_COMPLETED');if(!(normalized.pnhBills||[]).length){const error=new Error(`WHPP_DETAIL_MEMBERSHIP_UNRECOVERABLE:${requested}`);error.code='WHPP_DETAIL_MEMBERSHIP_UNRECOVERABLE';error.reportDate=requested;throw error;}return overlayCurrentTruth(normalized);}
  return overlayCurrentTruth(direct);
}
function rowsForState(reportDate,tab,region=''){const state=stateForDate(reportDate),dashboard=buildWhppDashboard(state),detail=dashboard.detailTabs?.[tab]||dashboard.detailTabs?.all||{label:tab,rows:[]};let rows=Array.isArray(detail.rows)?detail.rows:[];if(region==='PP'||region==='PV')rows=rows.filter(row=>regionOf(row)===region);return{label:detail.label||tab,rows:rows.map(row=>({...row,reportMembershipDate:reportDate,日报日期:reportDate,detailMembershipSource:row.detailMembershipSource||state.detailMembershipSource||''}))};}
function build(query={}){
  const tab=normalizeTab(query.tab||query.metric||'all'),region=String(query.region||'').trim().toUpperCase(),explicitFrom=dateOnly(query.from||query.fromDate||''),explicitTo=dateOnly(query.to||query.toDate||''),single=dateOnly(query.reportDate||query.date||''),from=explicitFrom||single,to=explicitTo||single||from;
  if(!from||!to||from>to)throw new Error('WHPP明细日期范围无效。');const days=rangeDays(from,to);if(days>MAX_RANGE_DAYS)throw new Error(`WHPP明细单次日期范围最多${MAX_RANGE_DAYS}天。`);
  const dates=from===to?[from]:memberDates(from,to);let label=tab;const rows=[];for(const reportDate of dates){const part=rowsForState(reportDate,tab,region);label=part.label||label;rows.push(...part.rows);}rows.sort((a,b)=>String(a.reportMembershipDate||'').localeCompare(String(b.reportMembershipDate||''))||billOf(a).localeCompare(billOf(b)));
  const page=Math.max(1,Number(query.page||1)),pageSize=Math.max(1,Math.min(500,Number(query.pageSize||200))),start=(page-1)*pageSize,regionLabel=region==='PP'?'本省PP':region==='PV'?'外省PV':'';
  return{ok:true,patchId:PATCH_ID,businessType:'WHPP',reportDate:to,fromDate:from,toDate:to,range:from!==to,dates,tab,region,label:`${regionLabel}${regionLabel?' · ':''}${label}`,total:rows.length,page,pageSize,rows:rows.slice(start,start+pageSize),truthSource:'IMMUTABLE_DAILY_MEMBERSHIP_PLUS_LATEST_SHIPMENT_CURRENT_STATE'};
}

const previousListen=express.application.listen;let installed=false;
express.application.listen=function v419WhppGlobalRangeDetailListen(...args){if(!installed){installed=true;this.get(ROUTE,(req,res)=>{try{res.setHeader('Cache-Control','no-store');res.setHeader('X-CE-QC-WHPP-Detail',PATCH_ID);res.json(build(req.query||{}));}catch(error){res.status(500).json({ok:false,patchId:PATCH_ID,error:error?.message||String(error)});}});}return previousListen.apply(this,args);};
export function inspectV172WhppDetail(query={}){return build(query);}
export const V172_WHPP_DETAIL_PARITY_PATCH_ID=PATCH_ID;