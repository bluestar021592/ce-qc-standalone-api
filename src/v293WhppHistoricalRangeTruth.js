import { getDb } from './db.js';

export const V293_WHPP_HISTORICAL_RANGE_TRUTH_ID='2026-08-25-v293-whpp-history-range-fallback-v1';
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
const date=value=>{const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};
function safeJson(value){try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return{};}}
function pick(summary,keys=[],fallback=0){for(const key of keys){const value=summary?.[key];if(value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value)))return Number(value);}return Number(fallback||0);}
function finish(row){
  row.total=n(row.total);row.matched=n(row.matched);row.pod=n(row.pod);row.sameDayPod=n(row.sameDayPod);row.ocCurrent=n(row.ocCurrent);
  for(const key of ['pendingNonContinuous','pending3','oc1','oc2','cycle2','shopRetention2','workOrder','inboundNoScan','provinceOpen','returned','attempt1','attempt2','attempt3','attemptUnknown','signingDaysSum','signingDaysCount'])row[key]=n(row[key]);
  row.coverageRate=pct(row.matched,row.total);row.podRate=pct(row.pod,row.total);row.sameDayPodRate=pct(row.sameDayPod,row.total);row.ocRate=pct(row.ocCurrent,row.total);
  const known=row.attempt1+row.attempt2+row.attempt3;row.attemptUnknown=Math.max(row.attemptUnknown,Math.max(0,row.pod-known));row.attemptCoverageRate=row.pod?pct(Math.min(row.pod,known),row.pod):null;
  row.attempt1Rate=row.pod&&known?pct(row.attempt1,row.pod):null;row.attempt2Rate=row.pod&&known?pct(row.attempt2,row.pod):null;row.attempt3Rate=row.pod&&known?pct(row.attempt3,row.pod):null;
  row.avgPodDays=row.signingDaysCount?Number((row.signingDaysSum/row.signingDaysCount).toFixed(2)):null;row.ready=row.total===0||row.matched>=row.total;row.ledgerReady=row.ready;return row;
}
function fromHistory(row={}){
  const summary=safeJson(row.summaryJson);const total=pick(summary,['total','today','todayTotal'],row.totalCount);
  const hasCompletedSummary=Boolean(String(row.summaryJson||'').trim());
  return finish({
    reportDate:String(row.reportDate||''),businessType:'WHPP',regionCode:'UNKNOWN',total,matched:hasCompletedSummary?total:0,
    pod:pick(summary,['pod','todayPod','podCount','签收件数']),sameDayPod:pick(summary,['sameDayPod','firstDayPod','firstPod','首日POD']),
    ocCurrent:pick(summary,['ocCurrent','todayOc','currentOc','当日OC']),pendingNonContinuous:pick(summary,['pendingNonContinuous','pendingDiscontinuous','Pending不连续']),
    pending3:pick(summary,['pending3','pending3plus','pending3Plus']),oc1:pick(summary,['oc1']),oc2:pick(summary,['oc2']),cycle2:pick(summary,['cycle2','cycle2plus']),
    shopRetention2:pick(summary,['shopRetention2','activeStoreRetention','storeRetention2']),workOrder:pick(summary,['workOrder','ticketOpen']),inboundNoScan:pick(summary,['inboundNoScan']),
    provinceOpen:pick(summary,['provinceOpen','regionPvUnresolved']),returned:pick(summary,['returned']),attempt1:pick(summary,['attempt1','dispatchAttempt1']),attempt2:pick(summary,['attempt2','dispatchAttempt2']),attempt3:pick(summary,['attempt3','dispatchAttempt3']),attemptUnknown:pick(summary,['attemptUnknown','dispatchAttemptUnclassifiedPod']),
    signingDaysSum:pick(summary,['signingDaysSum']),signingDaysCount:pick(summary,['signingDaysCount']),historyFallback:true,historySource:hasCompletedSummary?'WHPP_BUSINESS_HISTORY_SUMMARY':'WHPP_DAILY_REPORT_TOTAL_ONLY'
  });
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
  const byDate=new Map((canonicalDaily||[]).filter(row=>String(row?.businessType||'').toUpperCase()==='WHPP').map(row=>[String(row.reportDate||''),row]));
  for(const history of readV293WhppHistoricalRangeFacts(fromDate,toDate,db)){
    const current=byDate.get(history.reportDate);
    if(!current||n(current.total)<n(history.total))byDate.set(history.reportDate,history);
  }
  return [...byDate.values()].sort((a,b)=>String(a.reportDate||'').localeCompare(String(b.reportDate||'')));
}

console.info('[CE-QC][V293_WHPP_HISTORY_RANGE]',V293_WHPP_HISTORICAL_RANGE_TRUTH_ID,'historical WHPP source totals come from WHPP daily report ledger; completed history summaries fill facts only when canonical V284 daily membership is missing/shrunk; read-only, no SQLite mutation.');
