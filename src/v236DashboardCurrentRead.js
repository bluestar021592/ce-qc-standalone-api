import { getDb } from './db.js';
import { normalizedDashboardCoverageReady } from './v235DashboardCurrentCache.js';

export const V236_DASHBOARD_CURRENT_READ_ID='2026-08-27-v335-per-business-current-summary-v1';
export const V236_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
const SUMMARY_CACHE_MS=10_000;
const summaryCache=new Map();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
function safeJson(value){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||'{}'))||{});}catch{return{};}}
function firstNumber(obj,keys){for(const key of keys){if(obj&&obj[key]!==undefined&&obj[key]!==null&&Number.isFinite(Number(obj[key])))return Number(obj[key]);}return 0;}
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,returned:0,cancelled:0,unresolved:0,sameDayPod:0,sameDayPodRate:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,ocCurrent:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,delivery:0,deliveryStay:0,provinceOpen:0,attempt1:0,attempt2:0,attempt3:0,firstRate:null,ready:false,regions:{}};}
function addMetric(out,m={}){
  out.total+=firstNumber(m,['total','today','pnh','todayPnh','totalMonitored']);
  out.pod+=firstNumber(m,['pod','todayPod','scanPod','signed']);
  out.returned+=firstNumber(m,['returned','returnCount','returnedCount']);
  out.cancelled+=firstNumber(m,['cancelled','cancelCount']);
  out.sameDayPod+=firstNumber(m,['sameDayPod','firstDayPod','sameDayPodCount']);
  out.pending1+=firstNumber(m,['pending1','pending','pendingTotal']);out.pending2+=firstNumber(m,['pending2']);out.pending3+=firstNumber(m,['pending3','pending3plus']);
  out.pendingNonContinuous+=firstNumber(m,['pendingNonContinuous','pendingGap']);out.ocCurrent+=firstNumber(m,['ocCurrent','currentOc']);out.oc1+=firstNumber(m,['oc1']);out.oc2+=firstNumber(m,['oc2']);out.oc3+=firstNumber(m,['oc3','oc3plus']);
  out.cycle2+=firstNumber(m,['cycle2','cycle2plus']);out.inboundNoScan+=firstNumber(m,['inboundNoScan']);
  out.delivery+=firstNumber(m,['delivery1','delivery','delivering']);out.deliveryStay+=firstNumber(m,['deliveryStay','delivery1','delivering']);
  out.provinceOpen+=firstNumber(m,['provinceOpen','pvOpen']);out.attempt1+=firstNumber(m,['attempt1','dispatchAttempt1']);out.attempt2+=firstNumber(m,['attempt2','dispatchAttempt2']);out.attempt3+=firstNumber(m,['attempt3','dispatchAttempt3']);
}
function finish(out){
  out.unresolved=Math.max(0,out.total-out.pod-out.returned-out.cancelled);
  out.podRate=pct(out.pod,out.total);out.returnRate=pct(out.returned,out.total);out.cancelRate=pct(out.cancelled,out.total);out.unresolvedRate=pct(out.unresolved,out.total);
  out.pendingRate=pct(out.pending1,out.total);out.deliveryRate=pct(out.deliveryStay||out.delivery,out.total);out.ocRate=pct(out.ocCurrent,out.total);out.sameDayPodRate=pct(out.sameDayPod,out.total);out.closureRate=pct(out.pod+out.returned+out.cancelled,out.total);
  const attempts=out.attempt1+out.attempt2+out.attempt3;out.firstRate=attempts>0?pct(out.attempt1,out.pod||attempts):null;return out;
}
function latestDate(reportDate=''){
  const date=String(reportDate||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(date))return date;
  const row=getDb().prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,batchId DESC LIMIT 1").get();return String(row?.reportDate||'').slice(0,10);
}
function latestBatchForType(date,type){
  if(!date||!V236_TYPES.includes(type))return null;
  return getDb().prepare(`SELECT b.snapshotId,b.reportDate,COALESCE(s.status,'') AS snapshotStatus,b.createdAt,b.batchId
    FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND b.reportDate=? AND EXISTS (
      SELECT 1 FROM unified_import_rows u WHERE u.snapshotId=b.snapshotId AND u.reportDate=b.reportDate AND UPPER(TRIM(u.businessType))=? AND TRIM(COALESCE(u.shipmentCode,''))<>''
    ) ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(date,type)||null;
}
function latestCompatibilityBatch(date){if(!date)return null;return getDb().prepare("SELECT b.snapshotId,b.reportDate,COALESCE(s.status,'') AS snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' AND b.reportDate=? ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1").get(date)||null;}
function importedCount(snapshotId='',type=''){if(!snapshotId||!type)return 0;return n(getDb().prepare('SELECT COUNT(*) AS c FROM unified_import_rows WHERE snapshotId=? AND UPPER(TRIM(businessType))=? AND TRIM(COALESCE(shipmentCode,\'\'))<>\'\'').get(snapshotId,type)?.c);}
function exactCacheRows(date,snapshotId){try{return getDb().prepare("SELECT businessType,regionCode,metricsJson,snapshotId,refreshedAt FROM dashboard_daily_cache WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED' ORDER BY businessType,regionCode").all(date,snapshotId);}catch{return[];}}
function zeroRow(type,snapshotId){return{businessType:type,regionCode:'',metricsJson:JSON.stringify({total:0,pod:0,returned:0,cancelled:0,sameDayPod:0,ocCurrent:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,delivery1:0,deliveryStay:0,provinceOpen:0,attempt1:0,attempt2:0,attempt3:0}),snapshotId,refreshedAt:'DIRECT_NORMALIZED'};}
function directCcslRows(date,snapshotId){
  return getDb().prepare(`
    WITH valid AS (
      SELECT u.businessType,u.shipmentCode,u.regionCode FROM unified_import_rows u
      WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')
    ), facts AS (
      SELECT v.*,COALESCE(f.isPod,0) AS isPod,
        CASE WHEN COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$."退回状态"'),'')='已退回' OR COALESCE(f.primaryCategory,f.category,'') LIKE '%退回%') THEN 1 ELSE 0 END AS isReturned,
        COALESCE(f.pendingDays,0) AS pendingDays,COALESCE(f.ocDays,0) AS ocDays,COALESCE(f.cycleCountDays,0) AS cycleCountDays,COALESCE(f.deliveringDays,0) AS deliveringDays,
        COALESCE(f.primaryCategory,f.category,'') AS category,COALESCE(f.rawJson,'{}') AS rawJson,
        REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(f.lastEventTime,''),''),1,10),'/','-') AS podDate
      FROM valid v LEFT JOIN final_rows f ON f.shipmentCode=v.shipmentCode AND f.reportDate=?
    )
    SELECT businessType,'' AS regionCode,COUNT(*) AS total,SUM(isPod) AS pod,SUM(isReturned) AS returned,0 AS cancelled,
      SUM(CASE WHEN isPod=1 AND podDate=? THEN 1 ELSE 0 END) AS sameDayPod,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND (
        ocDays>=1 OR UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%'
        OR UPPER(COALESCE(json_extract(rawJson,'$."当前状态"'),''))='OC'
        OR UPPER(COALESCE(json_extract(rawJson,'$."状态标识"'),''))='OC'
      ) THEN 1 ELSE 0 END) AS ocCurrent,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND pendingDays>=1 THEN 1 ELSE 0 END) AS pending1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND pendingDays>=2 THEN 1 ELSE 0 END) AS pending2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND pendingDays>=3 THEN 1 ELSE 0 END) AS pending3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND COALESCE(json_extract(rawJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND ocDays>=1 THEN 1 ELSE 0 END) AS oc1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND ocDays>=2 THEN 1 ELSE 0 END) AS oc2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND ocDays>=3 THEN 1 ELSE 0 END) AS oc3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND cycleCountDays>=2 THEN 1 ELSE 0 END) AS cycle2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND deliveringDays>=1 THEN 1 ELSE 0 END) AS delivery1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND category LIKE '%入库无扫描%' THEN 1 ELSE 0 END) AS inboundNoScan,
      SUM(CASE WHEN UPPER(COALESCE(regionCode,''))='PV' AND isPod=0 AND isReturned=0 THEN 1 ELSE 0 END) AS provinceOpen,
      0 AS attempt1,0 AS attempt2,0 AS attempt3
    FROM facts GROUP BY businessType ORDER BY businessType
  `).all(snapshotId,date,date,date).map(row=>({...row,metricsJson:JSON.stringify(row),snapshotId,refreshedAt:'DIRECT_NORMALIZED'}));
}
function directShopeeRows(date,snapshotId){
  return getDb().prepare(`
    WITH valid AS (
      SELECT u.businessType,u.shipmentCode,CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP' WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV' ELSE 'UNKNOWN' END AS regionCode
      FROM unified_import_rows u WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN ('SHOPEECN','SHOPEEVN')
    ), facts AS (
      SELECT v.*,COALESCE(f.isPod,0) AS isPod,
        CASE WHEN COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$."退回状态"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%' OR COALESCE(f.rawJson,'') LIKE '%1203--派送异常%') THEN 1 ELSE 0 END AS isReturned,
        CASE WHEN COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$."订单取消"'),'')='是' OR COALESCE(f.primaryCategory,'') LIKE '%取消%') THEN 1 ELSE 0 END AS isCancelled,
        COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0) AS pendingCount,
        COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0) AS ocDays,COALESCE(CAST(json_extract(f.rawJson,'$."盘点天数"') AS INTEGER),0) AS cycleDays,
        COALESCE(CAST(json_extract(f.rawJson,'$."派送中停留天数"') AS INTEGER),0) AS deliveryDays,COALESCE(f.primaryCategory,'') AS category,COALESCE(f.rawJson,'{}') AS rawJson,
        REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(f.latestEventTime,''),''),1,10),'/','-') AS podDate,
        COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0) AS podAttemptNo
      FROM valid v LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=v.shipmentCode AND f.reportDate=?
    )
    SELECT businessType,regionCode,COUNT(*) AS total,SUM(isPod) AS pod,SUM(isReturned) AS returned,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=1 THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN isPod=1 AND podDate=? THEN 1 ELSE 0 END) AS sameDayPod,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND (
        ocDays>=1 OR UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%'
        OR UPPER(COALESCE(json_extract(rawJson,'$."当前状态"'),''))='OC'
        OR UPPER(COALESCE(json_extract(rawJson,'$."状态标识"'),''))='OC'
      ) THEN 1 ELSE 0 END) AS ocCurrent,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND pendingCount>=1 THEN 1 ELSE 0 END) AS pending1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND pendingCount>=2 THEN 1 ELSE 0 END) AS pending2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND pendingCount>=3 THEN 1 ELSE 0 END) AS pending3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND COALESCE(json_extract(rawJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND ocDays>=1 THEN 1 ELSE 0 END) AS oc1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND ocDays>=2 THEN 1 ELSE 0 END) AS oc2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND ocDays>=3 THEN 1 ELSE 0 END) AS oc3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND cycleDays>=2 THEN 1 ELSE 0 END) AS cycle2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND (COALESCE(json_extract(rawJson,'$."入库无扫描节点"'),'')='是' OR category LIKE '%入库无扫描%') THEN 1 ELSE 0 END) AS inboundNoScan,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND (deliveryDays>0 OR category='派送中停留') THEN 1 ELSE 0 END) AS deliveryStay,
      SUM(CASE WHEN regionCode='PV' AND isPod=0 AND isReturned=0 AND isCancelled=0 THEN 1 ELSE 0 END) AS provinceOpen,
      SUM(CASE WHEN isPod=1 AND podAttemptNo=1 THEN 1 ELSE 0 END) AS attempt1,
      SUM(CASE WHEN isPod=1 AND podAttemptNo=2 THEN 1 ELSE 0 END) AS attempt2,
      SUM(CASE WHEN isPod=1 AND podAttemptNo>=3 THEN 1 ELSE 0 END) AS attempt3
    FROM facts GROUP BY businessType,regionCode ORDER BY businessType,regionCode
  `).all(snapshotId,date,date,date).map(row=>({...row,metricsJson:JSON.stringify(row),snapshotId,refreshedAt:'DIRECT_NORMALIZED'}));
}
function directRowsForType(type,date,snapshotId){const rows=type.startsWith('SHOPEE')?directShopeeRows(date,snapshotId):directCcslRows(date,snapshotId);return rows.filter(row=>String(row.businessType||'').toUpperCase()===type);}
function metricFromRows(type,date,rows,importedTotal=0){const out=blank(type,date),matching=rows.filter(row=>String(row.businessType||'').toUpperCase()===type);if(matching.length){for(const row of matching)addMetric(out,safeJson(row.metricsJson||row));out.ready=true;out.snapshotId=matching[0]?.snapshotId||'';out.refreshedAt=matching.map(row=>row.refreshedAt||'').sort().at(-1)||'';if(type.startsWith('SHOPEE'))for(const code of ['PP','PV','UNKNOWN']){const regionRows=matching.filter(row=>String(row.regionCode||'').toUpperCase()===code),region=blank(type,date);for(const row of regionRows)addMetric(region,safeJson(row.metricsJson||row));region.ready=regionRows.length>0;out.regions[code]=finish(region);}}else out.total=n(importedTotal);return finish(out);}
function whpp(date,rows=[]){const cached=rows.filter(row=>String(row.businessType||'').toUpperCase()==='WHPP');if(cached.length){const out=blank('WHPP',date);for(const row of cached)addMetric(out,safeJson(row.metricsJson||row));out.ready=true;out.snapshotId=cached[0]?.snapshotId||'';out.refreshedAt=cached.map(row=>row.refreshedAt||'').sort().at(-1)||'';return finish(out);}const out=blank('WHPP',date);let payload={};try{const row=getDb().prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);if(row){payload={...safeJson(row.summaryJson)};if(payload.total===undefined)payload.total=n(row.totalCount);}}catch{}try{const row=getDb().prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);if(row)payload={...payload,...safeJson(row.summaryJson)};}catch{}addMetric(out,payload);out.ready=out.total>0||Object.keys(payload).length>0;return finish(out);}
function mergeMetricList(type,date,list=[]){const out=blank(type,date);for(const item of list)addMetric(out,item||{});out.ready=list.some(item=>item?.ready);return finish(out);}
function mergeRegions(metrics=[]){const out={};for(const code of ['PP','PV','UNKNOWN'])out[code]=mergeMetricList('SHOPEE','',metrics.map(m=>m?.regions?.[code]).filter(Boolean));return out;}

export function readV236CurrentSummary(reportDate='',options={}){
  const cacheOnly=Boolean(options?.cacheOnly),date=latestDate(reportDate),compat=latestCompatibilityBatch(date),batches=Object.fromEntries(V236_TYPES.map(type=>[type,latestBatchForType(date,type)]));
  const snapshotIds=Object.fromEntries(V236_TYPES.map(type=>[type,batches[type]?.snapshotId||''])),signature=V236_TYPES.map(type=>`${type}:${snapshotIds[type]}`).join('|'),key=`${cacheOnly?'CACHE':'CURRENT'}|${date}|${signature}`;const hit=summaryCache.get(key);if(hit&&Date.now()-hit.at<SUMMARY_CACHE_MS)return hit.value;
  const business={},readSources={};
  for(const type of V236_TYPES){
    const batch=batches[type],snapshotId=batch?.snapshotId||'',total=importedCount(snapshotId,type);let rows=[],source=snapshotId?'IMPORT_ONLY':'NO_DAILY_REPORT';
    if(snapshotId){rows=exactCacheRows(date,snapshotId).filter(row=>String(row.businessType||'').toUpperCase()===type);if(rows.length)source='EXACT_DASHBOARD_CACHE_PER_BUSINESS';else if(!cacheOnly&&normalizedDashboardCoverageReady(batch)){rows=directRowsForType(type,date,snapshotId);source='DIRECT_NORMALIZED_PER_BUSINESS';}}
    business[type]=metricFromRows(type,date,rows,total);if(snapshotId&&!business[type].snapshotId)business[type].snapshotId=snapshotId;readSources[type]=source;
  }
  const result={ok:true,readId:V236_DASHBOARD_CURRENT_READ_ID,reportDate:date,snapshotId:compat?.snapshotId||'',snapshotIds,snapshotStatus:compat?.snapshotStatus||'',business,whpp:whpp(date,[]),cacheRowCount:Object.values(readSources).filter(v=>v==='EXACT_DASHBOARD_CACHE_PER_BUSINESS').length,readSource:'PER_BUSINESS_LATEST_VALID',readSources,cacheOnly,readyBusinessCount:Object.values(business).filter(item=>item.ready).length};
  if(result.readyBusinessCount===V236_TYPES.length)summaryCache.set(key,{at:Date.now(),value:result});return result;
}
export function stateFromV236Metric(type,m={},summary={}){const common={viewBusinessType:type,reportDate:summary.reportDate||'',snapshotId:m.snapshotId||summary.snapshotId||'',snapshotStatus:m.ready?'COMPLETED':(summary.snapshotStatus||'IMPORTED'),dailyReportReady:Boolean(m.total),total:m.total,pnhBills:[],dailyParseRows:[],finalRows:[],scanResults:[],trackResults:[],trackEvents:[],carryBills:[],nextCarryBills:[],podLocks:[],historySummary:[],dailyParseSummary:{totalRecognized:m.total,pnh:m.total},processing:{running:false,paused:false,phase:m.ready?'处理完成':'正式结果待完成'},_v238FreshExact:true};if(type.startsWith('SHOPEE')){const group=type==='SHOPEECN'?'CN':'VN',metrics={...m,dispatchAttempt1:m.attempt1,dispatchAttempt2:m.attempt2,dispatchAttempt3:m.attempt3,dispatchAttempt1Rate:pct(m.attempt1,m.pod||m.total),dispatchAttempt2Rate:pct(m.attempt2,m.pod||m.total),dispatchAttempt3Rate:pct(m.attempt3,m.pod||m.total),firstAttemptRate:m.firstRate,firstDayPod:m.sameDayPod,firstDayPodRate:m.sameDayPodRate},regions=m.regions||{};return{...common,businessType:'SHOPEE',dashboard:{businessType:'SHOPEE',reportDate:common.reportDate,metrics,recipientGroups:{ALL:{metrics,regions},[group]:{metrics,regions}},regions,routing:{},dashboardRows:[]},detailTabs:{all:{rows:[],total:m.total}}};}return{...common,businessType:type,dashboard:{pnh:m.total,totalMonitored:m.total,todayPod:m.pod,podRate:m.podRate,abnormalCount:m.unresolved,categories:{pendingTotal:m.pending1,ocTotal:m.oc1},metrics:{...m,firstDayPod:m.sameDayPod,firstDayPodRate:m.sameDayPodRate},routing:{}},detailTabs:{allData:{rows:[],total:m.total}}};}
export function aggregateV236State(scope='CCSL',summary=readV236CurrentSummary()){const normalized=String(scope||'CCSL').toUpperCase();if(normalized==='SHOPEE'){const cn=summary.business.SHOPEECN||blank('SHOPEECN',summary.reportDate),vn=summary.business.SHOPEEVN||blank('SHOPEEVN',summary.reportDate),all=mergeMetricList('SHOPEE',summary.reportDate,[cn,vn]);all.regions=mergeRegions([cn,vn]);const common={businessType:'SHOPEE',viewBusinessType:'SHOPEE',reportDate:summary.reportDate,snapshotId:summary.snapshotId,snapshotStatus:all.ready?'COMPLETED':summary.snapshotStatus,dailyReportReady:Boolean(all.total),pnhBills:[],dailyParseRows:[],finalRows:[],scanResults:[],trackResults:[],trackEvents:[],carryBills:[],nextCarryBills:[],podLocks:[],historySummary:[],dailyParseSummary:{totalRecognized:all.total,groupCounts:{CN:cn.total,VN:vn.total}},processing:{running:false,paused:false,phase:all.ready?'处理完成':'正式结果待完成'},_v238FreshExact:true};return{...common,dashboard:{businessType:'SHOPEE',reportDate:summary.reportDate,metrics:all,recipientGroups:{ALL:{metrics:all,regions:all.regions},CN:{metrics:cn,regions:cn.regions||{}},VN:{metrics:vn,regions:vn.regions||{}}},regions:all.regions,routing:{},dashboardRows:[]},detailTabs:{all:{rows:[],total:all.total}}};}const parts=CCSL_TYPES.map(type=>summary.business[type]||blank(type,summary.reportDate)),all=mergeMetricList('CCSL',summary.reportDate,parts);return{businessType:'CCSL',viewBusinessType:'CCSL',reportDate:summary.reportDate,snapshotId:summary.snapshotId,snapshotStatus:all.ready?'COMPLETED':summary.snapshotStatus,dailyReportReady:Boolean(all.total),pnhBills:[],dailyParseRows:[],finalRows:[],scanResults:[],trackResults:[],trackEvents:[],carryBills:[],nextCarryBills:[],podLocks:[],historySummary:[],dailyParseSummary:{totalRecognized:all.total,pnh:all.total},processing:{running:false,paused:false,phase:all.ready?'处理完成':'正式结果待完成'},dashboard:{pnh:all.total,totalMonitored:all.total,todayPod:all.pod,podRate:all.podRate,abnormalCount:all.unresolved,categories:{pendingTotal:all.pending1,ocTotal:all.oc1},metrics:all,routing:{}},detailTabs:{allData:{rows:[],total:all.total}},_v238FreshExact:true};}

export function invalidateV236CurrentSummary(){summaryCache.clear();}
globalThis.__CE_QC_INVALIDATE_V236_CURRENT_SUMMARY__=invalidateV236CurrentSummary;

console.info('[CE-QC][V236_CURRENT_SUMMARY]',V236_DASHBOARD_CURRENT_READ_ID,'same-date current cards select the latest VALID snapshot independently for each business; unrelated imports cannot zero CN/VN/TBKH/CE siblings.');