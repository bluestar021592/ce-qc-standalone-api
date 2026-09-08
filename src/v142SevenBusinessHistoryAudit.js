import { getDb } from './db.js';

export const V142_HISTORY_AUDIT_ID = '2026-09-07-v451-snapshot-indexed-readonly-history-audit-v2-fail-closed';
export const V456_WHPP_AUTHORITY_DIAGNOSTIC_ID = '2026-09-08-v456-whpp-finalized-snapshot-authority-diagnostic-v1';
export const V457_WHPP_LEGACY_COMPLETION_RECOVERY_ID = '2026-09-08-v457-whpp-legacy-metadata-loss-attestation-v1';
const CORE_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const CCSL_TYPES = ['CE','CEAF','TBKH','ALI1688'];
const ALL_TYPES = [...CORE_TYPES,'WHPP'];
const SNAPSHOT_CHUNK_SIZE = 300;
const WHPP_COMPLETE_STATUSES = new Set(['COMPLETED','COMPLETED_WITH_RETRY']);

function iso(value='') { const text=String(value||'').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:''; }
function dates(from,to){ const out=[]; const d=new Date(`${from}T00:00:00Z`), end=new Date(`${to}T00:00:00Z`); while(d<=end){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);} return out; }
function tableExists(db,name){ return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)); }
function rows(db,sql,...params){ return db.prepare(sql).all(...params); }
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function token(value){return String(value??'').normalize('NFKC').trim().toUpperCase().replace(/[\s_-]+/g,'');}
function hasAirMarker(row={}){const raw=row?.raw&&typeof row.raw==='object'?row.raw:row;return Object.values(raw||{}).some(value=>['CCAF','CEAF'].includes(token(value)));}
function key(...parts){return parts.map(value=>String(value??'')).join('|');}
function num(value){return Number(value||0);}
function owns(object,keyName){return Boolean(object&&typeof object==='object'&&Object.prototype.hasOwnProperty.call(object,keyName));}
function mapLatest(list,dateField='reportDate'){
  const out=new Map();
  for(const row of list){const date=iso(row?.[dateField]);if(date)out.set(date,row);}
  return out;
}
function mapGrouped(list,keyOf){const out=new Map();for(const row of list)out.set(keyOf(row),row);return out;}
function mapListsByDate(list,dateField='reportDate'){
  const out=new Map();
  for(const row of list){const date=iso(row?.[dateField]);if(!date)continue;if(!out.has(date))out.set(date,[]);out.get(date).push(row);}
  return out;
}
function chunked(list,size=SNAPSHOT_CHUNK_SIZE){const out=[];for(let i=0;i<list.length;i+=size)out.push(list.slice(i,i+size));return out;}
function placeholders(list){return list.map(()=>'?').join(',');}

export function coreSnapshotCompletionDecision({validBatch=false,snapshotCompleted=false,ccslTotal=0,coveredCcsl=0}={}){
  const total=Number(ccslTotal||0),covered=Number(coveredCcsl||0);
  if(!validBatch)return {complete:false,reason:'NO_VALID_CORE_BATCH',zeroTicketDay:false,legacyCoverageRecovered:false};
  if(snapshotCompleted)return {complete:true,reason:'FORMAL_CORE_SNAPSHOT_COMPLETED',zeroTicketDay:total===0,legacyCoverageRecovered:false};
  if(total===0)return {complete:true,reason:'VALID_ZERO_CCSL_TICKETS',zeroTicketDay:true,legacyCoverageRecovered:false};
  if(covered>=total)return {complete:true,reason:'LEGACY_FINAL_ROWS_FULL_COVERAGE',zeroTicketDay:false,legacyCoverageRecovered:true};
  return {complete:false,reason:'CORE_SNAPSHOT_NOT_COMPLETED',zeroTicketDay:false,legacyCoverageRecovered:false};
}

// V456: current/non-zero WHPP completion uses the same exact daily authority as
// formal export. A completed surviving daily header must point to one exact
// non-invalid/non-failed finalizedSnapshotId.
export function whppCompletionAuthorityDecision({reportPresent=false,reported=0,summary={},snapshotRows=[]}={}){
  const total=Math.max(0,Number(reported||0));
  const dailyStatus=String(summary?.snapshotStatus||summary?.reconciliationStatus||'').trim().toUpperCase();
  const finalizedSnapshotId=String(summary?.finalizedSnapshotId||'').trim();
  const completedFlag=summary?.completed===true;
  const dailyCompleted=completedFlag&&WHPP_COMPLETE_STATUSES.has(dailyStatus)&&Boolean(finalizedSnapshotId);
  const candidates=(snapshotRows||[]).filter(row=>row&&typeof row==='object');
  const exact=finalizedSnapshotId?candidates.find(row=>String(row.snapshotId||'').trim()===finalizedSnapshotId)||null:null;
  const exactStatus=String(exact?.status||'').trim().toUpperCase();
  const exactReconciliation=String(exact?.reconciliationStatus||'').trim().toUpperCase();
  const exactRejected=Boolean(exact&&(exactStatus==='INVALID'||exactReconciliation==='FAILED'));
  const explicitCompleted=Boolean(exact&&exactStatus==='VALID'&&exactReconciliation==='COMPLETED');
  let eligible=false,reason='';
  if(!reportPresent)reason='WHPP_DAILY_REPORT_MISSING';
  else if(total<=0){eligible=true;reason='WHPP_ZERO_TICKET_DAILY';}
  else if(!completedFlag||!WHPP_COMPLETE_STATUSES.has(dailyStatus))reason='WHPP_DAILY_NOT_COMPLETED';
  else if(!finalizedSnapshotId)reason='WHPP_FINALIZED_SNAPSHOT_ID_MISSING';
  else if(!exact)reason='WHPP_FINALIZED_SNAPSHOT_ROW_MISSING';
  else if(exactRejected)reason='WHPP_FINALIZED_SNAPSHOT_INVALID_OR_FAILED';
  else{eligible=true;reason=explicitCompleted?'WHPP_VALID_COMPLETED_SNAPSHOT':'WHPP_LEGACY_FINALIZED_SNAPSHOT_ATTESTED';}
  return{
    eligible,reason,reportPresent:Boolean(reportPresent),reported:total,completedFlag,dailyStatus,dailyCompleted,finalizedSnapshotId,
    snapshotCandidateCount:candidates.length,exactSnapshotFound:Boolean(exact),exactSnapshotStatus:exactStatus,exactReconciliationStatus:exactReconciliation,
    explicitCompleted,legacyAttested:eligible&&total>0&&!explicitCompleted
  };
}

// V457: old replay/import code could overwrite a previously completed WHPP daily
// summary back to {batchId,snapshotId,total} while leaving the immutable final
// snapshot, history-summary attestation and member final facts intact. Recovery is
// read-only and deliberately stronger than a count-equality shortcut. It is
// allowed only when completion fields are absent (never when they explicitly say
// failed/incomplete), every normalized daily member has same-date final coverage,
// exactly one non-rejected snapshot survives, and business_history_summary points
// to that exact snapshot. Any ambiguity remains fail-closed.
export function whppLegacyCompletionRecoveryDecision({reportPresent=false,reported=0,summary={},dailyRows=0,coveredDailyRows=0,snapshotRows=[],historySnapshotId=''}={}){
  const total=Math.max(0,Number(reported||0));
  const metadataAbsent=!owns(summary,'completed')&&!owns(summary,'snapshotStatus')&&!owns(summary,'reconciliationStatus')&&!owns(summary,'finalizedSnapshotId');
  const allCandidates=(snapshotRows||[]).filter(row=>row&&typeof row==='object');
  const viable=allCandidates.filter(row=>String(row.status||'').trim().toUpperCase()!=='INVALID'&&String(row.reconciliationStatus||'').trim().toUpperCase()!=='FAILED');
  const historyId=String(historySnapshotId||'').trim();
  const only=viable.length===1?viable[0]:null;
  const recoveredSnapshotId=String(only?.snapshotId||'').trim();
  const dailyCount=Math.max(0,Number(dailyRows||0)),covered=Math.max(0,Number(coveredDailyRows||0));
  let eligible=false,reason='WHPP_LEGACY_RECOVERY_NOT_APPLICABLE';
  if(!reportPresent)reason='WHPP_DAILY_REPORT_MISSING';
  else if(total<=0)reason='WHPP_LEGACY_RECOVERY_NOT_REQUIRED_ZERO';
  else if(!metadataAbsent)reason='WHPP_LEGACY_RECOVERY_NOT_APPLICABLE';
  else if(dailyCount!==total)reason='WHPP_LEGACY_DAILY_MEMBERSHIP_INCOMPLETE';
  else if(covered!==total)reason='WHPP_LEGACY_FINAL_COVERAGE_INCOMPLETE';
  else if(viable.length!==1)reason=viable.length?'WHPP_LEGACY_SNAPSHOT_AMBIGUOUS':'WHPP_LEGACY_SNAPSHOT_MISSING';
  else if(!historyId)reason='WHPP_LEGACY_HISTORY_ATTESTATION_MISSING';
  else if(historyId!==recoveredSnapshotId)reason='WHPP_LEGACY_HISTORY_SNAPSHOT_MISMATCH';
  else{eligible=true;reason='WHPP_LEGACY_COMPLETION_METADATA_LOST_ATTESTED';}
  return{eligible,reason,metadataAbsent,dailyRows:dailyCount,coveredDailyRows:covered,historySnapshotId:historyId,viableSnapshotCandidateCount:viable.length,recoveredSnapshotId,allSnapshotCandidateCount:allCandidates.length,v457RecoveryId:V457_WHPP_LEGACY_COMPLETION_RECOVERY_ID};
}

function loadBulkHistory(db,from,to){
  const started=Date.now();
  const exists={};
  for(const name of ['final_rows','business_daily_reports','business_daily_parse_rows','business_final_rows','business_export_snapshots','business_history_summary','carryover_open_items','scan_results','business_scan_results','business_track_events'])exists[name]=tableExists(db,name);

  // V451: unified_import_rows is a very large table whose useful leading index is
  // snapshotId. Never scan it by reportDate. Resolve the one VALID batch selected
  // for each day from the small batch table first, then read only those snapshots.
  const batchRows=rows(db,`SELECT b.batchId,b.snapshotId,b.reportDate,b.sourceName,b.createdAt,b.status,s.status AS snapshotStatus
    FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.reportDate=b.reportDate
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ORDER BY b.reportDate,b.createdAt,b.rowid`,from,to);
  const batches=mapLatest(batchRows);
  const selectedSnapshotIds=[...new Set([...batches.values()].map(row=>String(row?.snapshotId||'').trim()).filter(Boolean))];

  const coreCountRows=[];
  const coverageRows=[];
  const ceafRows=[];
  for(const snapshotIds of chunked(selectedSnapshotIds)){
    const marks=placeholders(snapshotIds);
    coreCountRows.push(...rows(db,`SELECT snapshotId,reportDate,businessType,COUNT(*) count
      FROM unified_import_rows
      WHERE snapshotId IN (${marks}) AND businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN')
      GROUP BY snapshotId,reportDate,businessType`,...snapshotIds));
    if(exists.final_rows){
      coverageRows.push(...rows(db,`SELECT u.reportDate,u.snapshotId,COUNT(DISTINCT u.shipmentCode) covered
        FROM unified_import_rows u JOIN final_rows f ON f.reportDate=u.reportDate AND f.shipmentCode=u.shipmentCode
        WHERE u.snapshotId IN (${marks}) AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')
        GROUP BY u.reportDate,u.snapshotId`,...snapshotIds));
    }
    ceafRows.push(...rows(db,`SELECT reportDate,snapshotId,shipmentCode FROM unified_import_rows
      WHERE snapshotId IN (${marks}) AND businessType='CEAF' AND TRIM(COALESCE(shipmentCode,''))<>''`,...snapshotIds));
  }

  const coreCounts=new Map();
  for(const row of coreCountRows){
    const k=key(row.reportDate,row.snapshotId);if(!coreCounts.has(k))coreCounts.set(k,Object.fromEntries(CORE_TYPES.map(type=>[type,0])));
    const target=coreCounts.get(k);if(Object.hasOwn(target,row.businessType))target[row.businessType]=num(row.count);
  }
  const ccslCoverage=mapGrouped(coverageRows,row=>key(row.reportDate,row.snapshotId));

  const dailyReports=exists.business_daily_reports?mapLatest(rows(db,`SELECT reportDate,totalCount,sourceFile,summaryJson,rowid
    FROM business_daily_reports WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate,rowid`,from,to)):new Map();
  const dailyParseRows=exists.business_daily_parse_rows?rows(db,`SELECT reportDate,COUNT(DISTINCT shipmentCode) dailyRows
    FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? GROUP BY reportDate`,from,to):[];
  const dailyParse=mapGrouped(dailyParseRows,row=>iso(row.reportDate));

  const exactCoverageRows=exists.business_daily_parse_rows&&exists.business_final_rows?rows(db,`SELECT d.reportDate,
      COUNT(DISTINCT d.shipmentCode) dailyRows,
      COUNT(DISTINCT CASE WHEN f.shipmentCode IS NOT NULL THEN d.shipmentCode END) coveredDailyRows
    FROM business_daily_parse_rows d
    LEFT JOIN business_final_rows f
      ON f.businessType='WHPP' AND f.reportDate=d.reportDate AND f.shipmentCode=d.shipmentCode
    WHERE d.businessType='WHPP' AND d.reportDate BETWEEN ? AND ? AND TRIM(COALESCE(d.shipmentCode,''))<>''
    GROUP BY d.reportDate`,from,to):[];
  const whppExactCoverage=mapGrouped(exactCoverageRows,row=>iso(row.reportDate));

  const finalRows=exists.business_final_rows?rows(db,`SELECT reportDate,
      COUNT(DISTINCT shipmentCode) finalRows,
      COUNT(DISTINCT CASE WHEN UPPER(COALESCE(apiStatus,'')) IN ('API_PENDING_RETRY','FAILED','RETRY') THEN shipmentCode END) retryPending
    FROM business_final_rows WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? GROUP BY reportDate`,from,to):[];
  const whppFinal=mapGrouped(finalRows,row=>iso(row.reportDate));

  // V456/V457 keep snapshot authority metadata-only and date-bounded. Payload JSON
  // is never materialized on the history safety path.
  const snapshotRows=exists.business_export_snapshots?rows(db,`SELECT reportDate,snapshotId,status,reconciliationStatus,createdAt,id
    FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate,createdAt,id`,from,to):[];
  const whppSnapshotRows=mapListsByDate(snapshotRows);

  const whppHistorySnapshotIds=new Map();
  if(exists.business_history_summary){
    for(const row of rows(db,`SELECT reportDate,summaryJson FROM business_history_summary
      WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate`,from,to)){
      const date=iso(row.reportDate),snapshotId=String(safeJson(row.summaryJson,{}).snapshotId||'').trim();
      if(date&&snapshotId)whppHistorySnapshotIds.set(date,snapshotId);
    }
  }

  const ceafMembers=new Map();
  for(const row of ceafRows){const k=key(row.reportDate,row.snapshotId);if(!ceafMembers.has(k))ceafMembers.set(k,new Set());ceafMembers.get(k).add(String(row.shipmentCode||'').trim().toUpperCase());}

  // WHPP daily_parse_rows has a businessType/reportDate leading index, so this
  // bounded lookup remains safe. It is used only for the CEAF source-membership check.
  const markerRows=exists.business_daily_parse_rows?rows(db,`SELECT reportDate,shipmentCode,rowJson FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ?
      AND (COALESCE(rowJson,'') LIKE '%CCAF%' OR COALESCE(rowJson,'') LIKE '%CEAF%')`,from,to):[];
  const airMarkers=new Map();
  for(const row of markerRows){
    if(!hasAirMarker(safeJson(row.rowJson,{})))continue;
    const date=iso(row.reportDate),bill=String(row.shipmentCode||'').trim().toUpperCase();if(!date||!bill)continue;
    if(!airMarkers.has(date))airMarkers.set(date,new Set());airMarkers.get(date).add(bill);
  }

  return{exists,batches,selectedSnapshotIds,coreCounts,ccslCoverage,dailyReports,dailyParse,whppExactCoverage,whppFinal,whppSnapshotRows,whppHistorySnapshotIds,ceafMembers,airMarkers,bulkReadMs:Date.now()-started};
}

function whppForDate(bulk,reportDate){
  const report=bulk.dailyReports.get(reportDate)||null;
  const daily=num(bulk.dailyParse.get(reportDate)?.dailyRows);
  const exactCoverage=bulk.whppExactCoverage.get(reportDate)||{};
  const coveredDailyRows=num(exactCoverage.coveredDailyRows);
  const finals=num(bulk.whppFinal.get(reportDate)?.finalRows);
  const retry=num(bulk.whppFinal.get(reportDate)?.retryPending);
  const reported=Number(report?.totalCount??daily);
  const summary=safeJson(report?.summaryJson,{});
  const snapshotRows=bulk.whppSnapshotRows.get(reportDate)||[];
  let authority=whppCompletionAuthorityDecision({reportPresent:Boolean(report),reported,summary,snapshotRows});
  const recovery=whppLegacyCompletionRecoveryDecision({reportPresent:Boolean(report),reported,summary,dailyRows:daily,coveredDailyRows,snapshotRows,historySnapshotId:bulk.whppHistorySnapshotIds.get(reportDate)||''});
  if(!authority.eligible&&recovery.eligible){
    authority={...authority,eligible:true,reason:recovery.reason,finalizedSnapshotId:recovery.recoveredSnapshotId,legacyAttested:true,legacyMetadataRecovered:true};
  }
  return{
    reportPresent:Boolean(report),reported,dailyRows:daily,coveredDailyRows,finalRows:finals,retryPending:retry,
    snapshotPresent:Boolean(authority.eligible),snapshotId:authority.eligible?authority.finalizedSnapshotId:'',
    authorityReason:authority.reason,dailyCompleted:authority.dailyCompleted,completedFlag:authority.completedFlag,dailySnapshotStatus:authority.dailyStatus,
    finalizedSnapshotId:authority.finalizedSnapshotId,snapshotCandidateCount:authority.snapshotCandidateCount,exactSnapshotFound:authority.exactSnapshotFound,
    exactSnapshotStatus:authority.exactSnapshotStatus,exactReconciliationStatus:authority.exactReconciliationStatus,
    explicitCompleted:authority.explicitCompleted,legacyAttested:authority.legacyAttested,legacyMetadataRecovered:Boolean(authority.legacyMetadataRecovered),
    historySnapshotId:recovery.historySnapshotId,viableSnapshotCandidateCount:recovery.viableSnapshotCandidateCount,recoveryReason:recovery.reason,
    v456AuthorityDiagnosticId:V456_WHPP_AUTHORITY_DIAGNOSTIC_ID,v457LegacyRecoveryId:V457_WHPP_LEGACY_COMPLETION_RECOVERY_ID
  };
}
function airForDate(bulk,reportDate,snapshotId){
  const markerSet=bulk.airMarkers.get(reportDate)||new Set();
  const ceafSet=bulk.ceafMembers.get(key(reportDate,snapshotId))||new Set();
  const missingBills=[...markerSet].filter(code=>!ceafSet.has(code));
  return{markers:markerSet.size,ceafMembers:ceafSet.size,mismatch:missingBills.length,missingBills:missingBills.slice(0,50)};
}

export function auditSevenBusinessHistory({fromDate='2026-07-01',toDate='' }={}){
  const totalStarted=Date.now(),db=getDb();
  const latest=iso(db.prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate||'');
  const from=iso(fromDate)||'2026-07-01';
  const to=iso(toDate)||latest;
  if(!to||from>to)throw new Error('历史审计日期范围无效。');
  const expected=dates(from,to),bulk=loadBulkHistory(db,from,to);
  const days=[];const missing=[];const incomplete=[];const warnings=[];
  let totalImported=0,totalWhpp=0,totalRetry=0,totalCcslCoverage=0,totalWhppFinal=0,totalWhppLegacyRecovered=0;
  for(const reportDate of expected){
    const batch=bulk.batches.get(reportDate)||null;
    if(!batch){missing.push(reportDate);days.push({reportDate,status:'MISSING_CORE_IMPORT'});continue;}
    const counts=bulk.coreCounts.get(key(reportDate,batch.snapshotId))||Object.fromEntries(CORE_TYPES.map(type=>[type,0]));
    const coreTotal=Object.values(counts).reduce((a,b)=>a+num(b),0);
    const ccslTotal=CCSL_TYPES.reduce((sum,type)=>sum+num(counts[type]),0);
    const covered=num(bulk.ccslCoverage.get(key(reportDate,batch.snapshotId))?.covered);
    const coverage={sourceTotal:ccslTotal,covered,complete:ccslTotal<=0||covered>=ccslTotal};
    const coreCompletion=coreSnapshotCompletionDecision({validBatch:true,snapshotCompleted:String(batch.snapshotStatus||'')==='COMPLETED',ccslTotal,coveredCcsl:covered});
    const whpp=whppForDate(bulk,reportDate);
    const air=airForDate(bulk,reportDate,batch.snapshotId);
    const issues=[];
    if(!coreCompletion.complete)issues.push('CORE_SNAPSHOT_NOT_COMPLETED');
    if(coreCompletion.zeroTicketDay)warnings.push({reportDate,type:'CCSL_ZERO_TICKET_DAY_AUTO_CLOSED',count:0});
    else if(coreCompletion.legacyCoverageRecovered)warnings.push({reportDate,type:'CORE_LEGACY_STATUS_RECOVERED_BY_FULL_FINAL_COVERAGE',count:covered});
    if(!whpp.reportPresent)issues.push('WHPP_DAILY_REPORT_MISSING');
    if(whpp.reported>0&&!whpp.snapshotPresent)issues.push('WHPP_SNAPSHOT_MISSING');
    if(whpp.dailyRows!==whpp.reported)issues.push('WHPP_DAILY_COUNT_MISMATCH');
    if(whpp.snapshotPresent&&whpp.coveredDailyRows<whpp.dailyRows)issues.push('WHPP_FINAL_ROWS_INCOMPLETE');
    if(air.mismatch>0)issues.push('CEAF_SOURCE_MEMBERSHIP_MISMATCH');
    if(whpp.legacyMetadataRecovered){totalWhppLegacyRecovered++;warnings.push({reportDate,type:'WHPP_LEGACY_COMPLETION_METADATA_RECOVERED',count:whpp.reported,snapshotId:whpp.snapshotId});}
    if(issues.length)incomplete.push({reportDate,issues,ceafMissingBills:air.missingBills,ccslTotal,ccslFinalCoverage:covered,coreCompletion:coreCompletion.reason,whpp});
    if(whpp.retryPending>0)warnings.push({reportDate,type:'WHPP_RETRY_PENDING',count:whpp.retryPending});
    totalImported+=coreTotal+whpp.reported; totalWhpp+=whpp.reported; totalRetry+=whpp.retryPending;
    totalCcslCoverage+=covered; totalWhppFinal+=whpp.finalRows;
    days.push({reportDate,status:issues.length?'CHECK_REQUIRED':'OK',snapshotId:batch.snapshotId,snapshotStatus:batch.snapshotStatus,coreCounts:counts,coreTotal,ccslTotal,ccslFinalCoverage:covered,coverage,coreCompletion,whpp,air,issues});
  }

  // V451: historical export readiness does not depend on diagnostic row totals
  // from scan/track/carryover mega tables. Those synchronous COUNT scans could
  // block the Node process for minutes on a 27GB DB. Keep the safety decision
  // fail-closed on actual completeness checks above.
  const currentEvidence={
    evidenceMode:'V451_INDEXED_AUDIT_ONLY',
    whppAuthorityDiagnostic:V456_WHPP_AUTHORITY_DIAGNOSTIC_ID,
    whppLegacyCompletionRecovery:V457_WHPP_LEGACY_COMPLETION_RECOVERY_ID,
    whppLegacyMetadataRecoveredDays:totalWhppLegacyRecovered,
    selectedCoreSnapshots:bulk.selectedSnapshotIds.length,
    checkedDays:expected.length,
    ccslCoveredRows:totalCcslCoverage,
    whppFinalRows:totalWhppFinal,
    heavyDiagnosticCountsSkipped:true,
    skippedDiagnostics:['carryover_open_items','final_rows_range_count','scan_results','business_scan_results','business_track_events'],
    skippedReason:'LARGE_TABLE_DIAGNOSTICS_ARE_NOT_REQUIRED_FOR_EXPORT_READINESS'
  };
  const exportReady=missing.length===0&&incomplete.length===0;
  const totalMs=Date.now()-totalStarted;
  return {ok:true,patchId:V142_HISTORY_AUDIT_ID,v456WhppAuthorityDiagnosticId:V456_WHPP_AUTHORITY_DIAGNOSTIC_ID,v457WhppLegacyRecoveryId:V457_WHPP_LEGACY_COMPLETION_RECOVERY_ID,readOnly:true,scanMode:'V451_SNAPSHOT_INDEXED_READ',fromDate:from,toDate:to,expectedDays:expected.length,daysPresent:expected.length-missing.length,missingDates:missing,incompleteDates:incomplete,warnings,totalImported,totalWhpp,totalRetryPending:totalRetry,currentEvidence,exportReady,exportStatus:exportReady?(totalRetry?'READY_WITH_RETRY':'READY'):'BLOCKED_UNTIL_REPAIRED',timing:{bulkReadMs:bulk.bulkReadMs,totalMs},days};
}

export const V142_BUSINESS_TYPES=ALL_TYPES;
