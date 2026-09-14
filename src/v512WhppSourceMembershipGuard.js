import { getDb } from './db.js';

export const V512_WHPP_SOURCE_MEMBERSHIP_GUARD_ID='2026-09-14-v512-whpp-source-membership-conservation-v2';

function dateKey(value=''){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function dateList(from,to){const out=[];const d=new Date(`${from}T00:00:00Z`),end=new Date(`${to}T00:00:00Z`);while(d<=end){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;}
function bill(value){return String(value?.shipmentCode??value?.waybill??value??'').normalize('NFKC').trim().toUpperCase().replace(/\s+/g,'');}
function normalizeBills(values=[]){return (values||[]).map(bill).filter(Boolean);}

export function reconcileWhppSourceMembership({sourceBills=[],processedBills=[],reportedCount=null,reportPresent=false}={}){
  const sourceRows=normalizeBills(sourceBills),processedRows=normalizeBills(processedBills);
  const sourceSet=new Set(sourceRows),processedSet=new Set(processedRows);
  const missingFromProcessed=[...sourceSet].filter(code=>!processedSet.has(code));
  const unexpectedProcessed=[...processedSet].filter(code=>!sourceSet.has(code));
  const sourceDuplicateRows=Math.max(0,sourceRows.length-sourceSet.size);
  const processedDuplicateRows=Math.max(0,processedRows.length-processedSet.size);
  const reported=reportPresent&&Number.isFinite(Number(reportedCount))?Math.max(0,Number(reportedCount)):null;
  const reportMatchesSource=reportPresent?reported===sourceSet.size:(sourceSet.size===0&&processedSet.size===0);
  const passed=reportMatchesSource
    &&sourceDuplicateRows===0
    &&processedDuplicateRows===0
    &&missingFromProcessed.length===0
    &&unexpectedProcessed.length===0;
  return{
    id:V512_WHPP_SOURCE_MEMBERSHIP_GUARD_ID,
    sourceRows:sourceRows.length,sourceUnique:sourceSet.size,
    processedRows:processedRows.length,processedUnique:processedSet.size,
    sourceDuplicateRows,processedDuplicateRows,
    reportPresent:Boolean(reportPresent),reportedCount:reported,reportMatchesSource,
    missingFromProcessed:missingFromProcessed.slice(0,50),
    unexpectedProcessed:unexpectedProcessed.slice(0,50),
    passed
  };
}

export function assertWhppSourceMembershipRange({fromDate,toDate,db=getDb()}={}){
  const from=dateKey(fromDate),to=dateKey(toDate);
  if(!from||!to||from>to){const error=new Error('WHPP源数据守恒检查日期范围无效。');error.code='V512_INVALID_RANGE';throw error;}
  const days=[];const failures=[];
  for(const reportDate of dateList(from,to)){
    const batch=db.prepare("SELECT snapshotId,batchId,reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(reportDate);
    if(!batch?.snapshotId){
      days.push({
        id:V512_WHPP_SOURCE_MEMBERSHIP_GUARD_ID,reportDate,passed:true,enforced:false,legacyCompatible:true,
        reason:'NO_VALID_UNIFIED_SOURCE_LEGACY_COMPAT',sourceUnique:0,processedUnique:0,
        missingFromProcessed:[],unexpectedProcessed:[]
      });
      continue;
    }
    const sourceBills=db.prepare("SELECT shipmentCode FROM unified_import_rows WHERE snapshotId=? AND businessType='WHPP' ORDER BY shipmentCode").all(batch.snapshotId).map(row=>row.shipmentCode);
    const processedBills=db.prepare("SELECT shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode").all(reportDate).map(row=>row.shipmentCode);
    const report=db.prepare("SELECT totalCount,rowid FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? ORDER BY rowid DESC LIMIT 1").get(reportDate)||null;
    const reconciliation=reconcileWhppSourceMembership({sourceBills,processedBills,reportedCount:report?.totalCount,reportPresent:Boolean(report)});
    const result={reportDate,snapshotId:batch.snapshotId,batchId:batch.batchId,enforced:true,legacyCompatible:false,...reconciliation};
    days.push(result);if(!result.passed)failures.push(result);
  }
  if(failures.length){
    const sample=failures.slice(0,5).map(item=>`${item.reportDate}:源${Number(item.sourceUnique||0)}/WHPP处理${Number(item.processedUnique||0)}/日报${item.reportPresent?Number(item.reportedCount||0):'缺失'}${item.missingFromProcessed?.length?`，漏${item.missingFromProcessed.slice(0,3).join('、')}`:''}${item.unexpectedProcessed?.length?`，多${item.unexpectedProcessed.slice(0,3).join('、')}`:''}`).join('；');
    const error=new Error(`WHPP源日报成员与WHPP处理成员不一致，已阻止导出，避免总数看似正常但实际漏票/串板。${sample}`);
    error.code='WHPP_SOURCE_MEMBERSHIP_CONSERVATION_FAILED';
    error.guardId=V512_WHPP_SOURCE_MEMBERSHIP_GUARD_ID;
    error.failures=failures;
    throw error;
  }
  const authoritative=days.filter(item=>item.enforced);
  const legacySkipped=days.filter(item=>!item.enforced);
  return{
    ok:true,id:V512_WHPP_SOURCE_MEMBERSHIP_GUARD_ID,fromDate:from,toDate:to,
    requestedDays:days.length,daysChecked:authoritative.length,authoritativeDays:authoritative.length,legacySkippedDays:legacySkipped.length,
    sourceWhppTotal:authoritative.reduce((sum,item)=>sum+Number(item.sourceUnique||0),0),
    processedWhppTotal:authoritative.reduce((sum,item)=>sum+Number(item.processedUnique||0),0),
    days
  };
}
