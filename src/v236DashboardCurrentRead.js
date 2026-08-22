import { getDb } from './db.js';

export const V236_DASHBOARD_CURRENT_READ_ID='2026-08-22-v236-fresh-exact-dashboard-read-v1';
export const V236_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
function safeJson(value){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||'{}'))||{});}catch{return{};}}
function firstNumber(obj,keys){for(const key of keys){if(obj&&obj[key]!==undefined&&obj[key]!==null&&Number.isFinite(Number(obj[key])))return Number(obj[key]);}return 0;}
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,returned:0,cancelled:0,unresolved:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,delivery:0,deliveryStay:0,provinceOpen:0,attempt1:0,attempt2:0,attempt3:0,firstRate:0,ready:false};}
function addMetric(out,m={}){
  out.total+=firstNumber(m,['total','today','pnh','todayPnh','totalMonitored']);
  out.pod+=firstNumber(m,['pod','todayPod','scanPod','signed']);
  out.returned+=firstNumber(m,['returned','returnCount','returnedCount']);
  out.cancelled+=firstNumber(m,['cancelled','cancelCount']);
  out.pending1+=firstNumber(m,['pending1','pending','pendingTotal']);
  out.pending2+=firstNumber(m,['pending2']);out.pending3+=firstNumber(m,['pending3','pending3plus']);
  out.pendingNonContinuous+=firstNumber(m,['pendingNonContinuous','pendingGap']);
  out.oc1+=firstNumber(m,['oc1']);out.oc2+=firstNumber(m,['oc2']);out.oc3+=firstNumber(m,['oc3','oc3plus']);
  out.cycle2+=firstNumber(m,['cycle2','cycle2plus']);out.inboundNoScan+=firstNumber(m,['inboundNoScan']);
  out.delivery+=firstNumber(m,['delivery1','delivery','delivering']);out.deliveryStay+=firstNumber(m,['deliveryStay','delivery1','delivering']);
  out.provinceOpen+=firstNumber(m,['provinceOpen','pvOpen']);
  out.attempt1+=firstNumber(m,['attempt1','dispatchAttempt1']);out.attempt2+=firstNumber(m,['attempt2','dispatchAttempt2']);out.attempt3+=firstNumber(m,['attempt3','dispatchAttempt3']);
}
function finish(out){
  out.unresolved=Math.max(0,out.total-out.pod-out.returned-out.cancelled);
  out.podRate=pct(out.pod,out.total);out.returnRate=pct(out.returned,out.total);out.cancelRate=pct(out.cancelled,out.total);out.unresolvedRate=pct(out.unresolved,out.total);
  out.pendingRate=pct(out.pending1,out.total);out.deliveryRate=pct(out.deliveryStay||out.delivery,out.total);out.ocRate=pct(out.oc1,out.total);out.closureRate=pct(out.pod+out.returned+out.cancelled,out.total);
  out.firstRate=pct(out.attempt1,out.pod||out.total);return out;
}
function latestBatch(reportDate=''){
  const db=getDb(),date=String(reportDate||'').slice(0,10);
  if(date)return db.prepare(`SELECT b.snapshotId,b.reportDate,COALESCE(s.status,'') AS snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' AND b.reportDate=? ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(date)||null;
  return db.prepare(`SELECT b.snapshotId,b.reportDate,COALESCE(s.status,'') AS snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' ORDER BY b.reportDate DESC,b.createdAt DESC,b.batchId DESC LIMIT 1`).get()||null;
}
function importedCounts(snapshotId=''){
  if(!snapshotId)return{};
  return Object.fromEntries(getDb().prepare(`SELECT businessType,COUNT(*) AS c FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType`).all(snapshotId).map(row=>[String(row.businessType||'').toUpperCase(),n(row.c)]));
}
function exactCacheRows(date,snapshotId){
  try{return getDb().prepare(`SELECT businessType,regionCode,metricsJson,snapshotId,refreshedAt FROM dashboard_daily_cache WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED' ORDER BY businessType,regionCode`).all(date,snapshotId);}catch{return[];}
}
function whpp(date){
  const out=blank('WHPP',date);let payload={};
  try{const row=getDb().prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);if(row){payload={...safeJson(row.summaryJson)};if(payload.total===undefined)payload.total=n(row.totalCount);}}catch{}
  try{const row=getDb().prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);if(row)payload={...payload,...safeJson(row.summaryJson)};}catch{}
  addMetric(out,payload);out.ready=out.total>0||Object.keys(payload).length>0;return finish(out);
}
export function readV236CurrentSummary(reportDate=''){
  const batch=latestBatch(reportDate);const date=batch?.reportDate||String(reportDate||'').slice(0,10);const counts=importedCounts(batch?.snapshotId||'');const rows=batch?.snapshotStatus==='COMPLETED'?exactCacheRows(date,batch.snapshotId):[];
  const business={};
  for(const type of V236_TYPES){
    const out=blank(type,date);const matching=rows.filter(row=>String(row.businessType||'').toUpperCase()===type);
    if(matching.length){for(const row of matching)addMetric(out,safeJson(row.metricsJson));out.ready=true;out.snapshotId=batch?.snapshotId||'';out.refreshedAt=matching.map(row=>row.refreshedAt||'').sort().at(-1)||'';}
    else out.total=n(counts[type]);
    business[type]=finish(out);
  }
  return{ok:true,readId:V236_DASHBOARD_CURRENT_READ_ID,reportDate:date,snapshotId:batch?.snapshotId||'',snapshotStatus:batch?.snapshotStatus||'',business,whpp:whpp(date),cacheRowCount:rows.length,readyBusinessCount:Object.values(business).filter(item=>item.ready).length};
}
export function stateFromV236Metric(type,m={},summary={}){
  const common={viewBusinessType:type,reportDate:summary.reportDate||'',snapshotId:summary.snapshotId||'',snapshotStatus:m.ready?'COMPLETED':(summary.snapshotStatus||'IMPORTED'),dailyReportReady:Boolean(m.total),total:m.total,pnhBills:[],dailyParseRows:[],finalRows:[],scanResults:[],trackResults:[],trackEvents:[],carryBills:[],nextCarryBills:[],podLocks:[],historySummary:[],dailyParseSummary:{totalRecognized:m.total,pnh:m.total},processing:{running:false,paused:false,phase:m.ready?'处理完成':'状态缓存待完成'},_v236FreshExact:true};
  if(type.startsWith('SHOPEE')){const group=type==='SHOPEECN'?'CN':'VN';const metrics={...m,dispatchAttempt1:m.attempt1,dispatchAttempt2:m.attempt2,dispatchAttempt3:m.attempt3,dispatchAttempt1Rate:pct(m.attempt1,m.pod||m.total),dispatchAttempt2Rate:pct(m.attempt2,m.pod||m.total),dispatchAttempt3Rate:pct(m.attempt3,m.pod||m.total),firstAttemptRate:m.firstRate};return{...common,businessType:'SHOPEE',dashboard:{businessType:'SHOPEE',reportDate:common.reportDate,metrics,recipientGroups:{ALL:{metrics,regions:{}},[group]:{metrics,regions:{}}},regions:{},routing:{},dashboardRows:[]},detailTabs:{all:{rows:[],total:m.total}}};}
  return{...common,businessType:type,dashboard:{pnh:m.total,totalMonitored:m.total,todayPod:m.pod,podRate:m.podRate,abnormalCount:m.unresolved,categories:{pendingTotal:m.pending1,ocTotal:m.oc1},metrics:{...m},routing:{}},detailTabs:{allData:{rows:[],total:m.total}}};
}
