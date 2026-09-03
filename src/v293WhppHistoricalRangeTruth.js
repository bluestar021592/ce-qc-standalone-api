import { getDb } from './db.js';

export const V293_WHPP_HISTORICAL_RANGE_TRUTH_ID='2026-08-25-v293-whpp-history-range-fallback-v1';
export const V293_WHPP_HISTORY_MEMBERSHIP_INTEGRITY_ID='2026-08-29-v293-whpp-history-membership-integrity-v2';
export const V419_WHPP_HISTORY_SUMMARY_FAILCLOSED_ID='2026-09-03-v419-whpp-history-summary-metric-failclosed-v1';
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
const date=value=>{const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
function safeJson(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return{};}}
function pick(summary,keys=[],fallback=0){for(const key of keys){const value=summary?.[key];if(value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value)))return Number(value);}return Number(fallback||0);}
function pickOptional(summary,keys=[]){for(const key of keys){const value=summary?.[key];if(value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value)))return Number(value);}return null;}
function finish(row){
  row.total=n(row.total);row.matched=n(row.matched);row.pod=n(row.pod);row.sameDayPod=n(row.sameDayPod);row.ocCurrent=n(row.ocCurrent);
  for(const key of ['pendingNonContinuous','pending3','oc1','oc2','cycle2','shopRetention2','workOrder','inboundNoScan','provinceOpen','returned','attempt1','attempt2','attempt3','attemptUnknown','signingDaysSum','signingDaysCount'])row[key]=n(row[key]);
  row.coverageRate=pct(row.matched,row.total);row.podRate=pct(row.pod,row.total);row.sameDayPodRate=pct(row.sameDayPod,row.total);row.ocRate=pct(row.ocCurrent,row.total);
  const known=row.attempt1+row.attempt2+row.attempt3;row.attemptUnknown=Math.max(row.attemptUnknown,Math.max(0,row.pod-known));row.attemptCoverageRate=row.pod?pct(Math.min(row.pod,known),row.pod):null;
  row.attempt1Rate=row.pod&&known?pct(row.attempt1,row.pod):null;row.attempt2Rate=row.pod&&known?pct(row.attempt2,row.pod):null;row.attempt3Rate=row.pod&&known?pct(row.attempt3,row.pod):null;
  row.avgPodDays=row.signingDaysCount?Number((row.signingDaysSum/row.signingDaysCount).toFixed(2)):null;row.ready=row.total===0||row.matched>=row.total;row.ledgerReady=row.ready;return row;
}
function fromHistory(row={}){
  const summary=safeJson(row.summaryJson);
  const expectedTotal=n(row.totalCount);
  const summaryTotal=pickOptional(summary,['total','today','todayTotal']);
  const hasCompletedSummary=Boolean(String(row.summaryJson||'').trim());
  const historySummaryVerified=hasCompletedSummary&&summaryTotal!==null&&n(summaryTotal)===expectedTotal;
  // V419: history metrics are evidence only when their own denominator exactly
  // matches the preserved WHPP daily-report denominator. A stale/corrupt summary
  // may keep the trusted daily total visible, but none of its POD/Pending/OC/
  // return/attempt/signing facts are publishable. This is deliberately fail-closed.
  const metric=(keys=[],fallback=0)=>historySummaryVerified?pick(summary,keys,fallback):0;
  return finish({
    reportDate:String(row.reportDate||''),businessType:'WHPP',regionCode:'UNKNOWN',total:expectedTotal,matched:historySummaryVerified?expectedTotal:0,
    pod:metric(['pod','todayPod','podCount','签收件数']),sameDayPod:metric(['sameDayPod','firstDayPod','firstPod','首日POD']),
    ocCurrent:metric(['ocCurrent','todayOc','currentOc','当日OC']),pendingNonContinuous:metric(['pendingNonContinuous','pendingDiscontinuous','Pending不连续']),
    pending3:metric(['pending3','pending3plus','pending3Plus']),oc1:metric(['oc1']),oc2:metric(['oc2']),cycle2:metric(['cycle2','cycle2plus']),
    shopRetention2:metric(['shopRetention2','activeStoreRetention','storeRetention2']),workOrder:metric(['workOrder','ticketOpen']),inboundNoScan:metric(['inboundNoScan']),
    provinceOpen:metric(['provinceOpen','regionPvUnresolved']),returned:metric(['returned']),attempt1:metric(['attempt1','dispatchAttempt1']),attempt2:metric(['attempt2','dispatchAttempt2']),attempt3:metric(['attempt3','dispatchAttempt3']),attemptUnknown:metric(['attemptUnknown','dispatchAttemptUnclassifiedPod']),
    signingDaysSum:metric(['signingDaysSum']),signingDaysCount:metric(['signingDaysCount']),historyFallback:historySummaryVerified,
    historySource:historySummaryVerified?'WHPP_BUSINESS_HISTORY_SUMMARY':hasCompletedSummary?'WHPP_HISTORY_SUMMARY_REJECTED_DENOMINATOR':'WHPP_HISTORY_SUMMARY_MISSING',historySummaryVerified,historySummaryTotal:summaryTotal,expectedTotal,
    historyFailClosedId:V419_WHPP_HISTORY_SUMMARY_FAILCLOSED_ID
  });
}
function incompleteError(reportDate,expected,actual){
  const error=new Error(`WHPP_STANDARD_DAILY_INCOMPLETE:${reportDate}:${expected}/${actual}`);
  error.code='WHPP_STANDARD_DAILY_INCOMPLETE';error.reportDate=reportDate;error.expected=n(expected);error.actual=n(actual);return error;
}
function tableExists(db,name){
  try{return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)?.ok);}catch{return false;}
}
function readMembershipCounts(from,to,db){
  if(!tableExists(db,'business_daily_parse_rows'))return {available:false,byDate:new Map()};
  const rows=db.prepare(`
    SELECT reportDate,COUNT(DISTINCT UPPER(TRIM(shipmentCode))) actual
    FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? AND TRIM(COALESCE(shipmentCode,''))<>''
    GROUP BY reportDate
  `).all(from,to);
  return {available:true,byDate:new Map(rows.map(row=>[String(row.reportDate||''),n(row.actual)]))};
}
function zeroFact(reportDate){
  return finish({reportDate,businessType:'WHPP',regionCode:'UNKNOWN',total:0,matched:0,historyFallback:false,historySource:'WHPP_STANDARD_DAILY_ZERO',historySummaryVerified:false,expectedTotal:0});
}
export function readV293WhppHistoricalRangeFacts(fromDate,toDate,db=getDb()){
  const from=date(fromDate),to=date(toDate);if(!from||!to||from>to)throw new Error('V293 WHPP日期范围无效');
  const rows=db.prepare(`
    SELECT r.reportDate,r.totalCount,h.summaryJson
    FROM business_daily_reports r
    LEFT JOIN business_history_summary h ON h.businessType='WHPP' AND h.reportDate=r.reportDate
    WHERE r.businessType='WHPP' AND r.reportDate BETWEEN ? AND ?
    ORDER BY r.reportDate
  `).all(from,to);
  return rows.map(fromHistory);
}
export function mergeV293WhppHistoricalRange(canonicalDaily=[],fromDate='',toDate='',db=getDb()){
  const from=date(fromDate),to=date(toDate);if(!from||!to||from>to)throw new Error('V293 WHPP日期范围无效');
  const byDate=new Map((canonicalDaily||[]).filter(row=>String(row?.businessType||'').toUpperCase()==='WHPP').map(row=>[String(row.reportDate||''),row]));
  const historyByDate=new Map(readV293WhppHistoricalRangeFacts(from,to,db).map(row=>[String(row.reportDate||''),row]));
  const reports=db.prepare(`SELECT reportDate,totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate`).all(from,to);
  const membership=readMembershipCounts(from,to,db);

  for(const report of reports){
    const reportDate=String(report.reportDate||'');
    const expected=n(report.totalCount);
    const current=byDate.get(reportDate);
    const actual=membership.available?n(membership.byDate.get(reportDate)):n(current?.total);
    const history=historyByDate.get(reportDate);

    if(actual>expected||(actual>0&&actual<expected))throw incompleteError(reportDate,expected,actual);

    if(expected===0){
      if(actual!==0)throw incompleteError(reportDate,expected,actual);
      if(current&&n(current.total)!==0)throw incompleteError(reportDate,expected,n(current.total));
      if(!current)byDate.set(reportDate,zeroFact(reportDate));
      continue;
    }

    if(actual===expected){
      if(current){
        if(n(current.total)!==expected)throw incompleteError(reportDate,expected,n(current.total));
        continue;
      }
      if(history?.historySummaryVerified){byDate.set(reportDate,history);continue;}
      if(history){byDate.set(reportDate,history);continue;}
      byDate.set(reportDate,finish({reportDate,businessType:'WHPP',regionCode:'UNKNOWN',total:expected,matched:0,historyFallback:false,historySource:'WHPP_COMPLETE_MEMBERSHIP_WITHOUT_ANALYSIS',expectedTotal:expected}));
      continue;
    }

    // actual===0 with expected>0 means the historical parse membership was fully
    // rotated away. Only an exact completed history summary may restore metrics.
    // An unverified/mismatched summary is denominator-only fail-closed truth: it
    // keeps total visible but all analysis facts are zero and the day stays unready.
    // A partially-present membership never reaches this branch and is rejected above.
    if(history?.historySummaryVerified){byDate.set(reportDate,history);continue;}
    if(history){byDate.set(reportDate,history);continue;}
    byDate.set(reportDate,finish({reportDate,businessType:'WHPP',regionCode:'UNKNOWN',total:expected,matched:0,historyFallback:false,historySource:'WHPP_ROTATED_MEMBERSHIP_WITHOUT_VERIFIED_HISTORY',expectedTotal:expected}));
  }
  return [...byDate.values()].sort((a,b)=>String(a.reportDate||'').localeCompare(String(b.reportDate||'')));
}

console.info('[CE-QC][V293_WHPP_HISTORY_RANGE]',V293_WHPP_HISTORICAL_RANGE_TRUTH_ID,V293_WHPP_HISTORY_MEMBERSHIP_INTEGRITY_ID,V419_WHPP_HISTORY_SUMMARY_FAILCLOSED_ID,'WHPP history recovery distinguishes complete current membership from fully rotated membership; partial membership fails closed; mismatched history keeps only the trusted daily denominator and cannot publish stale analysis metrics; read-only, no SQLite mutation.');
