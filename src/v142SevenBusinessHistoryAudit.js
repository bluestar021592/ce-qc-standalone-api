import { getDb } from './db.js';

export const V142_HISTORY_AUDIT_ID = '2026-08-31-v388-seven-business-history-audit-export-range-scope-v1';
const CORE_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const CCSL_TYPES = ['CE','CEAF','TBKH','ALI1688'];
const ALL_TYPES = [...CORE_TYPES,'WHPP'];

function iso(value='') { const text=String(value||'').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:''; }
function dates(from,to){ const out=[]; const d=new Date(`${from}T00:00:00Z`), end=new Date(`${to}T00:00:00Z`); while(d<=end){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);} return out; }
function tableExists(db,name){ return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)); }
function count(db,sql,...params){ try{return Number(db.prepare(sql).get(...params)?.count||0);}catch{return 0;} }
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function token(value){return String(value??'').normalize('NFKC').trim().toUpperCase().replace(/[\s_-]+/g,'');}
function hasAirMarker(row={}){const raw=row?.raw&&typeof row.raw==='object'?row.raw:row;return Object.values(raw||{}).some(value=>['CCAF','CEAF'].includes(token(value)));}

function latestCoreBatch(db,reportDate){
  return db.prepare(`SELECT b.batchId,b.snapshotId,b.reportDate,b.sourceName,b.createdAt,b.status,s.status AS snapshotStatus
    FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate=? ORDER BY b.createdAt DESC LIMIT 1`).get(reportDate)||null;
}
function coreCounts(db,snapshotId){
  const result=Object.fromEntries(CORE_TYPES.map(type=>[type,0]));
  if(!snapshotId)return result;
  for(const row of db.prepare('SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType').all(snapshotId)) if(Object.hasOwn(result,row.businessType))result[row.businessType]=Number(row.count||0);
  return result;
}
function ccslCoverage(db,reportDate,snapshotId,ccslTotal){
  const total=Number(ccslTotal||0);
  if(total<=0)return {sourceTotal:0,covered:0,complete:true};
  if(!snapshotId||!tableExists(db,'final_rows'))return {sourceTotal:total,covered:0,complete:false};
  const covered=count(db,`SELECT COUNT(DISTINCT u.shipmentCode) count
    FROM unified_import_rows u
    JOIN final_rows f ON f.reportDate=? AND f.shipmentCode=u.shipmentCode
    WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')`,reportDate,snapshotId,reportDate);
  return {sourceTotal:total,covered,complete:covered>=total};
}
export function coreSnapshotCompletionDecision({validBatch=false,snapshotCompleted=false,ccslTotal=0,coveredCcsl=0}={}){
  const total=Number(ccslTotal||0),covered=Number(coveredCcsl||0);
  if(!validBatch)return {complete:false,reason:'NO_VALID_CORE_BATCH',zeroTicketDay:false,legacyCoverageRecovered:false};
  if(snapshotCompleted)return {complete:true,reason:'FORMAL_CORE_SNAPSHOT_COMPLETED',zeroTicketDay:total===0,legacyCoverageRecovered:false};
  if(total===0)return {complete:true,reason:'VALID_ZERO_CCSL_TICKETS',zeroTicketDay:true,legacyCoverageRecovered:false};
  if(covered>=total)return {complete:true,reason:'LEGACY_FINAL_ROWS_FULL_COVERAGE',zeroTicketDay:false,legacyCoverageRecovered:true};
  return {complete:false,reason:'CORE_SNAPSHOT_NOT_COMPLETED',zeroTicketDay:false,legacyCoverageRecovered:false};
}
function whppDay(db,reportDate){
  const report=tableExists(db,'business_daily_reports')?db.prepare("SELECT totalCount,sourceFile,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate):null;
  const daily=count(db,"SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?",reportDate);
  const finals=count(db,"SELECT COUNT(DISTINCT shipmentCode) count FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?",reportDate);
  const retry=count(db,"SELECT COUNT(DISTINCT shipmentCode) count FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? AND UPPER(COALESCE(apiStatus,'')) IN ('API_PENDING_RETRY','FAILED','RETRY')",reportDate);
  const snapshot=tableExists(db,'business_export_snapshots')?db.prepare("SELECT snapshotId,createdAt,payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC,id DESC LIMIT 1").get(reportDate):null;
  return {reportPresent:Boolean(report),reported:Number(report?.totalCount??daily),dailyRows:daily,finalRows:finals,retryPending:retry,snapshotPresent:Boolean(snapshot),snapshotId:String(snapshot?.snapshotId||'')};
}
function airMismatch(db,reportDate,snapshotId){
  if(!snapshotId||!tableExists(db,'business_daily_parse_rows'))return {markers:0,ceafMembers:0,mismatch:0,missingBills:[]};
  const markerBills=[];
  const candidates=db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND (COALESCE(rowJson,'') LIKE '%CCAF%' OR COALESCE(rowJson,'') LIKE '%CEAF%')").all(reportDate);
  for(const row of candidates){if(hasAirMarker(safeJson(row.rowJson,{})))markerBills.push(String(row.shipmentCode||'').trim().toUpperCase());}
  const ceafRows=db.prepare("SELECT shipmentCode FROM unified_import_rows WHERE snapshotId=? AND businessType='CEAF'").all(snapshotId);
  const ceafSet=new Set(ceafRows.map(row=>String(row.shipmentCode||'').trim().toUpperCase()).filter(Boolean));
  const missingBills=[...new Set(markerBills.filter(code=>code&&!ceafSet.has(code)))];
  return {markers:new Set(markerBills).size,ceafMembers:ceafSet.size,mismatch:missingBills.length,missingBills:missingBills.slice(0,50)};
}

export function auditSevenBusinessHistory({fromDate='2026-07-01',toDate='' }={}){
  const db=getDb();
  const latest=iso(db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate||'');
  const from=iso(fromDate)||'2026-07-01';
  const to=iso(toDate)||latest;
  if(!to||from>to)throw new Error('历史审计日期范围无效。');
  const expected=dates(from,to);
  const days=[];const missing=[];const incomplete=[];const warnings=[];
  let totalImported=0,totalWhpp=0,totalRetry=0;
  for(const reportDate of expected){
    const batch=latestCoreBatch(db,reportDate);
    if(!batch){missing.push(reportDate);days.push({reportDate,status:'MISSING_CORE_IMPORT'});continue;}
    const counts=coreCounts(db,batch.snapshotId);
    const coreTotal=Object.values(counts).reduce((a,b)=>a+Number(b||0),0);
    const ccslTotal=CCSL_TYPES.reduce((sum,type)=>sum+Number(counts[type]||0),0);
    const coverage=ccslCoverage(db,reportDate,batch.snapshotId,ccslTotal);
    const coreCompletion=coreSnapshotCompletionDecision({validBatch:true,snapshotCompleted:String(batch.snapshotStatus||'')==='COMPLETED',ccslTotal,coveredCcsl:coverage.covered});
    const whpp=whppDay(db,reportDate);
    const air=airMismatch(db,reportDate,batch.snapshotId);
    const issues=[];
    if(!coreCompletion.complete)issues.push('CORE_SNAPSHOT_NOT_COMPLETED');
    if(coreCompletion.zeroTicketDay)warnings.push({reportDate,type:'CCSL_ZERO_TICKET_DAY_AUTO_CLOSED',count:0});
    else if(coreCompletion.legacyCoverageRecovered)warnings.push({reportDate,type:'CORE_LEGACY_STATUS_RECOVERED_BY_FULL_FINAL_COVERAGE',count:coverage.covered});
    if(!whpp.reportPresent)issues.push('WHPP_DAILY_REPORT_MISSING');
    if(whpp.reported>0&&!whpp.snapshotPresent)issues.push('WHPP_SNAPSHOT_MISSING');
    if(whpp.dailyRows!==whpp.reported)issues.push('WHPP_DAILY_COUNT_MISMATCH');
    if(whpp.snapshotPresent&&whpp.finalRows<whpp.dailyRows)issues.push('WHPP_FINAL_ROWS_INCOMPLETE');
    if(air.mismatch>0)issues.push('CEAF_SOURCE_MEMBERSHIP_MISMATCH');
    if(issues.length)incomplete.push({reportDate,issues,ceafMissingBills:air.missingBills,ccslTotal,ccslFinalCoverage:coverage.covered,coreCompletion:coreCompletion.reason});
    if(whpp.retryPending>0)warnings.push({reportDate,type:'WHPP_RETRY_PENDING',count:whpp.retryPending});
    totalImported+=coreTotal+whpp.reported; totalWhpp+=whpp.reported; totalRetry+=whpp.retryPending;
    days.push({reportDate,status:issues.length?'CHECK_REQUIRED':'OK',snapshotId:batch.snapshotId,snapshotStatus:batch.snapshotStatus,coreCounts:counts,coreTotal,ccslTotal,ccslFinalCoverage:coverage.covered,coreCompletion,whpp,air,issues});
  }
  const openCarry=count(db,"SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate BETWEEN ? AND ?",from,to);
  const closedCarry=count(db,"SELECT COUNT(*) count FROM carryover_open_items WHERE status='CLOSED' AND sourceReportDate BETWEEN ? AND ?",from,to);
  const oldestOpen=String(db.prepare("SELECT MIN(sourceReportDate) value FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate BETWEEN ? AND ?").get(from,to)?.value||'');
  const currentEvidence={
    carryOpen:openCarry,carryClosed:closedCarry,oldestOpenDate:oldestOpen,
    carryOpenScope:'SOURCE_REPORT_DATE_BETWEEN_EXPORT_RANGE',carryOpenFromDate:from,carryOpenToDate:to,
    ccslFinalRows:count(db,'SELECT COUNT(*) count FROM final_rows WHERE reportDate BETWEEN ? AND ?',from,to),
    shopeeFinalRows:count(db,"SELECT COUNT(*) count FROM business_final_rows WHERE businessType='SHOPEE' AND reportDate BETWEEN ? AND ?",from,to),
    whppFinalRows:count(db,"SELECT COUNT(*) count FROM business_final_rows WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ?",from,to),
    ccslScanRows:count(db,'SELECT COUNT(*) count FROM scan_results WHERE reportDate BETWEEN ? AND ?',from,to),
    businessScanRows:count(db,'SELECT COUNT(*) count FROM business_scan_results WHERE reportDate BETWEEN ? AND ?',from,to),
    businessTrackEvents:count(db,'SELECT COUNT(*) count FROM business_track_events WHERE reportDate BETWEEN ? AND ?',from,to)
  };
  const exportReady=missing.length===0&&incomplete.length===0;
  return {ok:true,patchId:V142_HISTORY_AUDIT_ID,readOnly:true,fromDate:from,toDate:to,expectedDays:expected.length,daysPresent:expected.length-missing.length,missingDates:missing,incompleteDates:incomplete,warnings,totalImported,totalWhpp,totalRetryPending:totalRetry,currentEvidence,exportReady,exportStatus:exportReady?(totalRetry?'READY_WITH_RETRY':'READY'):'BLOCKED_UNTIL_REPAIRED',days};
}

export const V142_BUSINESS_TYPES=ALL_TYPES;