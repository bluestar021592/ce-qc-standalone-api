import express from 'express';
import { getDb } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';
import { loadV351UnifiedWhppMembership } from './v351WhppUnifiedDashboardBridgePatch.js';

const PATCH_ID='2026-08-22-v216-whpp-import-parity-v1';
const ROUTE='/api/v132/whpp-fast-summary';

function dateOnly(value=''){
  const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function safeJson(value,fallback={}){
  try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}
  catch{return fallback;}
}
function num(value){
  const n=Number(value||0);
  return Number.isFinite(n)?n:0;
}
function billOf(row={}){
  return String(row.shipmentCode||row.运单号||row.waybill||'').trim().toUpperCase();
}
function uniqueRows(rows=[]){
  const map=new Map();
  for(const row of rows||[]){
    const bill=billOf(row);
    if(bill)map.set(bill,{...row,shipmentCode:bill,运单号:bill,businessType:'WHPP'});
  }
  return [...map.values()];
}
function normalizeSqlFinalFact(row={}){
  const normalized={...row};
  if(Number(row.isPod||0)===1){
    normalized.isPod=1;
    normalized.是否POD='是';
    normalized.POD状态='POD';
    normalized.currentState='POD';
    if(!String(normalized.primaryCategory||'').trim())normalized.primaryCategory='POD';
  }
  return normalized;
}
function latestDate(db,requested=''){
  const explicit=dateOnly(requested);
  if(explicit)return explicit;
  const candidates=[];
  for(const sql of [
    "SELECT MAX(reportDate) reportDate FROM unified_import_batches WHERE status='VALID'",
    "SELECT MAX(reportDate) reportDate FROM business_daily_reports WHERE businessType='WHPP'",
    "SELECT MAX(reportDate) reportDate FROM business_history_summary WHERE businessType='WHPP'"
  ]){
    try{const d=dateOnly(db.prepare(sql).get()?.reportDate||'');if(d)candidates.push(d);}catch{}
  }
  return candidates.sort().at(-1)||'';
}
function loadUnifiedMembership(db,reportDate){
  const membership=loadV351UnifiedWhppMembership(reportDate,db);
  return {
    present:Boolean(membership.present),
    rows:membership.rows||[],
    source:membership.membershipSource||(membership.present?'LATEST_VALID_UNIFIED_MEMBERSHIP':'WHPP_STANDARD_DAILY'),
    batchId:String(membership.batchId||''),
    snapshotId:String(membership.snapshotId||''),
    recoveredFromPreservedWhpp:Boolean(membership.recoveredFromPreservedWhpp)
  };
}
function loadStandardMembership(db,reportDate){
  const daily=db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);
  if(!daily)return {present:false,rows:[],source:'EMPTY'};
  const rows=uniqueRows(db.prepare(`SELECT shipmentCode,rowJson FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row=>({
      ...safeJson(row.rowJson,{}),shipmentCode:row.shipmentCode,运单号:row.shipmentCode,businessType:'WHPP',reportDate
    })));
  const expected=num(daily.totalCount);
  const present=expected===rows.length;
  return {present,rows:present?rows:[],source:present?(expected===0?'WHPP_STANDARD_DAILY_ZERO':'WHPP_STANDARD_DAILY'):'INCOMPLETE',expected,actual:rows.length};
}
function loadFinalFacts(db,reportDate,membershipRows=[]){
  const members=uniqueRows(membershipRows);
  const memberByBill=new Map(members.map(row=>[billOf(row),row]));
  const memberSet=new Set(memberByBill.keys());
  return uniqueRows(db.prepare(`SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson
    FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row=>{
      const raw=safeJson(row.rawJson,{});
      return normalizeSqlFinalFact({
        ...raw,
        shipmentCode:row.shipmentCode,
        运单号:row.shipmentCode,
        businessType:'WHPP',
        reportDate,
        isPod:num(row.isPod),
        primaryCategory:row.primaryCategory||raw.primaryCategory||raw.主分类||'',
        apiStatus:row.apiStatus||raw.apiStatus||'',
        carryStatus:row.carryStatus||raw.carryStatus||'',
        latestEventTime:row.latestEventTime||raw.latestEventTime||raw.最后节点时间||'',
        latestEventDesc:row.latestEventDesc||raw.latestEventDesc||raw.最后节点||'',
        latestNode:row.latestNode||raw.latestNode||''
      });
    }))
    .filter(row=>memberSet.has(billOf(row)))
    .map(row=>{
      const member=memberByBill.get(billOf(row))||{};
      return {
        ...member,
        ...row,
        regionCode:String(row.regionCode||row.区域||member.regionCode||member.区域||'').trim().toUpperCase()
      };
    });
}
function assertVisibleConsistency(dashboard={}){
  const metrics=dashboard.metrics||{};
  const regions=dashboard.regions||{};
  const keys=['total','pod','returned','cancelled','unresolved','pending1','pending2','pending3','oc1','oc2','oc3'];
  const mismatches=[];
  for(const key of keys){
    const top=num(metrics[key]);
    const regional=['PP','PV','UNKNOWN'].reduce((sum,code)=>sum+num(regions?.[code]?.[key]),0);
    if(top!==regional)mismatches.push(`${key}=${top}/${regional}`);
  }
  if(mismatches.length){
    const error=new Error(`WHPP可见看板真值不一致：${mismatches.join(', ')}`);
    error.code='WHPP_VISIBLE_TRUTH_MISMATCH';
    throw error;
  }
}
function buildFastSummary(requested=''){
  const started=Date.now();
  const db=getDb();
  const reportDate=latestDate(db,requested);
  if(!reportDate){
    const dashboard=buildWhppDashboard({businessType:'WHPP',reportDate:'',dailyReportReady:true,pnhBills:[],dailyParseRows:[],finalRows:[]});
    return {ok:true,patchId:PATCH_ID,reportDate:'',total:0,completed:false,snapshotStatus:'EMPTY',metrics:{...dashboard.metrics,retryPending:0},regions:dashboard.regions,accounting:dashboard.accounting,dashboard:{businessType:'WHPP',reportDate:'',metrics:{...dashboard.metrics,retryPending:0},regions:dashboard.regions,accounting:dashboard.accounting},summarySource:'EMPTY',generatedAt:new Date().toISOString(),serverBuildMs:Date.now()-started};
  }

  // Fresh imports write WHPP directly into business_daily_reports +
  // business_daily_parse_rows. That normalized daily membership is the primary
  // authority, including an exact persisted zero. V351 is retained only as a
  // disaster/history fallback when the standard cohort is missing/incomplete.
  const standard=loadStandardMembership(db,reportDate);
  const unified=standard.present?{present:false,rows:[],source:'STANDARD_PRIMARY_NO_FALLBACK'}:loadUnifiedMembership(db,reportDate);
  const membershipRows=standard.present?standard.rows:unified.rows;
  const facts=loadFinalFacts(db,reportDate,membershipRows);
  const dashboard=buildWhppDashboard({
    businessType:'WHPP',
    reportDate,
    dailyReportReady:true,
    pnhBills:uniqueRows(membershipRows).map(billOf),
    dailyParseRows:uniqueRows(membershipRows),
    finalRows:facts
  });
  assertVisibleConsistency(dashboard);

  const history=db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);
  const historySource=safeJson(history?.summaryJson,{});
  const retryPending=num(historySource.retryPending);
  const memberCount=uniqueRows(membershipRows).length;
  const completed=memberCount===0?standard.present||Boolean(history):facts.length>=memberCount;
  const metrics={...dashboard.metrics,retryPending};
  const snapshotStatus=completed?(retryPending>0?'COMPLETED_WITH_RETRY':'COMPLETED'):(metrics.total>0?'PENDING':'EMPTY');
  const slimDashboard={businessType:'WHPP',reportDate,metrics,regions:dashboard.regions,accounting:dashboard.accounting};
  return {
    ok:true,
    patchId:PATCH_ID,
    reportDate,
    total:num(metrics.total),
    completed,
    snapshotStatus,
    metrics,
    regions:dashboard.regions,
    accounting:dashboard.accounting,
    state:{reportDate,dailyReportReady:true,snapshotStatus},
    dashboard:slimDashboard,
    summarySource:standard.present?standard.source:(unified.present?unified.source:'EMPTY'),
    finalEvidenceRows:facts.length,
    generatedAt:new Date().toISOString(),
    serverBuildMs:Date.now()-started
  };
}

const previousListen=express.application.listen;
let installed=false;
express.application.listen=function v216WhppInstantSummaryListen(...args){
  if(!installed){
    installed=true;
    this.get(ROUTE,(req,res)=>{
      const started=Date.now();
      try{
        const payload=buildFastSummary(req.query.reportDate||req.query.date||'');
        const duration=Date.now()-started;
        res.setHeader('Cache-Control','no-store');
        res.setHeader('X-CE-QC-WHPP-Summary','V352');
        res.setHeader('Server-Timing',`whppSummary;dur=${duration}`);
        if(duration>=250)console.log(`[CE-QC][PERF][WHPP_VISIBLE_TRUTH] ${ROUTE} ${duration}ms reportDate=${payload.reportDate||''}`);
        res.json(payload);
      }catch(error){
        res.status(500).json({ok:false,patchId:PATCH_ID,code:error?.code||'WHPP_VISIBLE_TRUTH_ERROR',error:error?.message||String(error)});
      }
    });
  }
  return previousListen.apply(this,args);
};

export function inspectV132WhppFastSummary(reportDate=''){
  return buildFastSummary(reportDate);
}
export const V132_WHPP_FAST_INTEGRATION_PATCH_ID=PATCH_ID;