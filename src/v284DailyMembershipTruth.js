import { getDb } from './db.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';

export const V284_DAILY_MEMBERSHIP_TRUTH_ID = '2026-08-24-v284-daily-membership-ledger-truth-v1';
export const V284_TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const UNIFIED_TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);
const CCSL_TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = Object.freeze(['SHOPEECN','SHOPEEVN']);
const ALL_TYPES = new Set(V284_TYPES);
const CACHE_MS = 30_000;
const cache = new Map();

const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const pct = (value,total) => total ? Number((n(value) * 100 / n(total)).toFixed(2)) : 0;
const dateKey = value => { const s=String(value||'').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
const add = (target,row,key) => { target[key]=(target[key]||0)+n(row?.[key]); };

function emptyFact(type,date='',regionCode='ALL') {
  return {
    reportDate:date,businessType:type,regionCode,total:0,matched:0,pod:0,sameDayPod:0,ocCurrent:0,
    pendingNonContinuous:0,pending3:0,oc1:0,oc2:0,cycle2:0,shopRetention2:0,workOrder:0,inboundNoScan:0,provinceOpen:0,returned:0,
    attempt1:0,attempt2:0,attempt3:0,attemptUnknown:0,signingDaysSum:0,signingDaysCount:0,
    podRate:0,sameDayPodRate:0,ocRate:0,coverageRate:0,attemptCoverageRate:0,attempt1Rate:null,attempt2Rate:null,attempt3Rate:null,avgPodDays:null,ready:false
  };
}
function finishFact(row) {
  row.total=n(row.total); row.matched=n(row.matched); row.pod=n(row.pod); row.sameDayPod=n(row.sameDayPod); row.ocCurrent=n(row.ocCurrent);
  for (const key of ['pendingNonContinuous','pending3','oc1','oc2','cycle2','shopRetention2','workOrder','inboundNoScan','provinceOpen','returned','attempt1','attempt2','attempt3','attemptUnknown','signingDaysSum','signingDaysCount']) row[key]=n(row[key]);
  row.coverageRate=pct(row.matched,row.total); row.podRate=pct(row.pod,row.total); row.sameDayPodRate=pct(row.sameDayPod,row.total); row.ocRate=pct(row.ocCurrent,row.total);
  const known=row.attempt1+row.attempt2+row.attempt3;
  row.attemptUnknown=Math.max(row.attemptUnknown,Math.max(0,row.pod-known));
  row.attemptCoverageRate=row.pod?pct(Math.min(row.pod,known),row.pod):0;
  const hasAttempt=row.pod>0&&known>0;
  row.attempt1Rate=hasAttempt?pct(row.attempt1,row.pod):null; row.attempt2Rate=hasAttempt?pct(row.attempt2,row.pod):null; row.attempt3Rate=hasAttempt?pct(row.attempt3,row.pod):null;
  row.avgPodDays=row.signingDaysCount?Number((row.signingDaysSum/row.signingDaysCount).toFixed(2)):null;
  row.ready=row.total===0||row.matched>=row.total;
  return row;
}
function mergeFacts(type,date,rows=[]) {
  const out=emptyFact(type,date,'ALL');
  for (const row of rows.filter(Boolean)) for (const key of ['total','matched','pod','sameDayPod','ocCurrent','pendingNonContinuous','pending3','oc1','oc2','cycle2','shopRetention2','workOrder','inboundNoScan','provinceOpen','returned','attempt1','attempt2','attempt3','attemptUnknown','signingDaysSum','signingDaysCount']) add(out,row,key);
  return finishFact(out);
}
function validRange(fromDate,toDate) {
  const from=dateKey(fromDate),to=dateKey(toDate);
  if(!from||!to||from>to) throw new Error('V284日期范围无效');
  return {from,to};
}

function queryUnifiedRegionFacts(from,to,db) {
  ensureV246TrackingSchema(db);
  const rows=db.prepare(`
    WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
             ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ), latest AS (
      SELECT reportDate,snapshotId FROM ranked WHERE rn=1
    ), valid AS (
      SELECT DISTINCT l.reportDate,u.businessType,UPPER(TRIM(u.shipmentCode)) shipmentCode,
        CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP' WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV' ELSE 'UNKNOWN' END regionCode
      FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN') AND TRIM(COALESCE(u.shipmentCode,''))<>''
    ), joined AS (
      SELECT v.*,
        CASE WHEN l.shipmentCode IS NOT NULL OR cf.shipmentCode IS NOT NULL OR sf.shipmentCode IS NOT NULL THEN 1 ELSE 0 END matched,
        CASE WHEN l.shipmentCode IS NOT NULL THEN CASE WHEN l.terminalReason='POD' THEN 1 ELSE 0 END
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.isPod,0) ELSE COALESCE(cf.isPod,0) END isPod,
        CASE WHEN l.shipmentCode IS NOT NULL THEN CASE WHEN l.terminalReason='RETURNED' THEN 1 ELSE 0 END
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN CASE WHEN COALESCE(json_extract(sf.rawJson,'$."退回状态"'),'')='已退回' OR UPPER(COALESCE(sf.currentMainCategory,sf.primaryCategory,''))='RETURNED' OR COALESCE(sf.primaryCategory,'')='退回' THEN 1 ELSE 0 END
             ELSE CASE WHEN COALESCE(json_extract(cf.rawJson,'$."退回状态"'),'')='已退回' OR UPPER(COALESCE(json_extract(cf.rawJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED') OR COALESCE(cf.primaryCategory,cf.category,'')='退回' THEN 1 ELSE 0 END END isReturned,
        CASE WHEN l.shipmentCode IS NOT NULL THEN CASE WHEN l.trackingStatus='TERMINAL' THEN 1 ELSE 0 END
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN CASE WHEN COALESCE(sf.isPod,0)=1 OR COALESCE(json_extract(sf.rawJson,'$."退回状态"'),'')='已退回' OR UPPER(COALESCE(json_extract(sf.rawJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN 1 ELSE 0 END
             ELSE CASE WHEN COALESCE(cf.isPod,0)=1 OR COALESCE(json_extract(cf.rawJson,'$."退回状态"'),'')='已退回' OR UPPER(COALESCE(json_extract(cf.rawJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN 1 ELSE 0 END END isTerminal,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.currentCategory,l.currentState,'')
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.currentMainCategory,sf.primaryCategory,'') ELSE COALESCE(cf.primaryCategory,cf.category,'') END category,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.currentStateJson,'{}')
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.rawJson,'{}') ELSE COALESCE(cf.rawJson,'{}') END stateJson,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.podDate,'')
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(sf.rawJson,'$."POD时间"'),''),NULLIF(json_extract(sf.rawJson,'$.podTime'),''),NULLIF(json_extract(sf.rawJson,'$."签收时间"'),''),NULLIF(sf.latestEventTime,''),''),1,10),'/','-')
             ELSE REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(cf.rawJson,'$."POD时间"'),''),NULLIF(json_extract(cf.rawJson,'$.podTime'),''),NULLIF(json_extract(cf.rawJson,'$."签收时间"'),''),NULLIF(cf.lastEventTime,''),''),1,10),'/','-') END podDate,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.attemptNo,0)
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(NULLIF(sf.podAttemptNo,0),NULLIF(sf.currentAttemptNo,0),CAST(json_extract(sf.rawJson,'$.podAttemptNo') AS INTEGER),CAST(json_extract(sf.rawJson,'$.currentAttemptNo') AS INTEGER),0) ELSE 0 END attemptNo,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.signingDays,0) ELSE 0 END signingDays,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(CAST(json_extract(l.currentStateJson,'$."Pending天数"') AS INTEGER),CAST(json_extract(l.currentStateJson,'$.pendingDays') AS INTEGER),CAST(json_extract(l.currentStateJson,'$."Pending当前天数"') AS INTEGER),0)
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(CAST(json_extract(sf.rawJson,'$."Pending天数"') AS INTEGER),CAST(json_extract(sf.rawJson,'$.pendingDays') AS INTEGER),0)
             ELSE COALESCE(cf.pendingDays,CAST(json_extract(cf.rawJson,'$."Pending天数"') AS INTEGER),CAST(json_extract(cf.rawJson,'$.pendingDays') AS INTEGER),0) END pendingDays,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(CAST(json_extract(l.currentStateJson,'$."OC天数"') AS INTEGER),CAST(json_extract(l.currentStateJson,'$.ocDays') AS INTEGER),0)
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(CAST(json_extract(sf.rawJson,'$."OC天数"') AS INTEGER),CAST(json_extract(sf.rawJson,'$.ocDays') AS INTEGER),0)
             ELSE COALESCE(cf.ocDays,CAST(json_extract(cf.rawJson,'$."OC天数"') AS INTEGER),CAST(json_extract(cf.rawJson,'$.ocDays') AS INTEGER),0) END ocDays,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(CAST(json_extract(l.currentStateJson,'$."盘点天数"') AS INTEGER),CAST(json_extract(l.currentStateJson,'$.cycleCountDays') AS INTEGER),0)
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(CAST(json_extract(sf.rawJson,'$."盘点天数"') AS INTEGER),CAST(json_extract(sf.rawJson,'$.cycleCountDays') AS INTEGER),0)
             ELSE COALESCE(cf.cycleCountDays,CAST(json_extract(cf.rawJson,'$."盘点天数"') AS INTEGER),CAST(json_extract(cf.rawJson,'$.cycleCountDays') AS INTEGER),0) END cycleDays,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(json_extract(l.currentStateJson,'$.shopState'),'')
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.shopState,'') ELSE COALESCE(cf.shopState,'') END shopState,
        CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(CAST(json_extract(l.currentStateJson,'$.shopRetentionNaturalDays') AS INTEGER),CAST(json_extract(l.currentStateJson,'$."门店滞留天数"') AS INTEGER),0)
             WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.shopRetentionNaturalDays,0) ELSE COALESCE(cf.shopRetentionNaturalDays,0) END shopRetentionDays
      FROM valid v
      LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=v.shipmentCode AND l.businessType=v.businessType
      LEFT JOIN final_rows cf ON v.businessType IN ('CE','CEAF','TBKH','ALI1688') AND cf.shipmentCode=v.shipmentCode AND cf.reportDate=v.reportDate
      LEFT JOIN business_final_rows sf ON v.businessType IN ('SHOPEECN','SHOPEEVN') AND sf.businessType='SHOPEE' AND sf.shipmentCode=v.shipmentCode AND sf.reportDate=v.reportDate
    ), classified AS (
      SELECT *,
        CASE WHEN UPPER(TRIM(category)) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION') OR category IN ('仓库自提','自提','CECN滞留包裹','CEZT滞留包裹','580滞留包裹') THEN 1 ELSE 0 END isSpecial,
        CASE WHEN COALESCE(json_extract(stateJson,'$."Pending不连续"'),'')='是' OR COALESCE(json_extract(stateJson,'$.pendingFactDateContinuity'),'')='不连续' OR COALESCE(json_extract(stateJson,'$."Pending事实连续性"'),'')='不连续' OR COALESCE(json_extract(stateJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END pendingNonContinuousFlag,
        CASE WHEN UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%' OR UPPER(COALESCE(json_extract(stateJson,'$."当前状态"'),''))='OC' OR UPPER(COALESCE(json_extract(stateJson,'$."状态标识"'),''))='OC' THEN 1 ELSE 0 END ocFlag
      FROM joined
    )
    SELECT reportDate,businessType,regionCode,COUNT(*) total,SUM(matched) matched,SUM(isPod) pod,
      SUM(CASE WHEN isPod=1 AND podDate=reportDate THEN 1 ELSE 0 END) sameDayPod,
      SUM(CASE WHEN isTerminal=0 AND isSpecial=0 AND ocFlag=1 THEN 1 ELSE 0 END) ocCurrent,
      SUM(CASE WHEN isTerminal=0 AND isSpecial=0 AND pendingNonContinuousFlag=1 THEN 1 ELSE 0 END) pendingNonContinuous,
      SUM(CASE WHEN isTerminal=0 AND isSpecial=0 AND pendingDays>=3 THEN 1 ELSE 0 END) pending3,
      SUM(CASE WHEN isTerminal=0 AND isSpecial=0 AND (ocDays>=1 OR ocFlag=1) THEN 1 ELSE 0 END) oc1,
      SUM(CASE WHEN isTerminal=0 AND isSpecial=0 AND ocDays>=2 THEN 1 ELSE 0 END) oc2,
      SUM(CASE WHEN isTerminal=0 AND isSpecial=0 AND cycleDays>=2 THEN 1 ELSE 0 END) cycle2,
      SUM(CASE WHEN isTerminal=0 AND isSpecial=0 AND shopState='SHOP_ARRIVED_CURRENT' AND shopRetentionDays>=2 THEN 1 ELSE 0 END) shopRetention2,
      SUM(CASE WHEN isTerminal=0 AND isSpecial=0 AND category LIKE '%工单%' THEN 1 ELSE 0 END) workOrder,
      SUM(CASE WHEN isTerminal=0 AND isSpecial=0 AND (category LIKE '%入库无扫描%' OR COALESCE(json_extract(stateJson,'$."入库无扫描节点"'),'')='是') THEN 1 ELSE 0 END) inboundNoScan,
      SUM(CASE WHEN regionCode='PV' AND isTerminal=0 AND isSpecial=0 AND isReturned=0 THEN 1 ELSE 0 END) provinceOpen,
      SUM(isReturned) returned,
      SUM(CASE WHEN isPod=1 AND attemptNo=1 THEN 1 ELSE 0 END) attempt1,
      SUM(CASE WHEN isPod=1 AND attemptNo=2 THEN 1 ELSE 0 END) attempt2,
      SUM(CASE WHEN isPod=1 AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3,
      SUM(CASE WHEN isPod=1 AND attemptNo=0 THEN 1 ELSE 0 END) attemptUnknown,
      SUM(CASE WHEN isPod=1 AND signingDays>0 THEN signingDays ELSE 0 END) signingDaysSum,
      SUM(CASE WHEN isPod=1 AND signingDays>0 THEN 1 ELSE 0 END) signingDaysCount
    FROM classified GROUP BY reportDate,businessType,regionCode ORDER BY reportDate,businessType,regionCode
  `).all(from,to);
  return rows.map(row=>finishFact({...emptyFact(String(row.businessType||''),String(row.reportDate||''),String(row.regionCode||'UNKNOWN')),...row}));
}

function queryWhppRegionFacts(from,to,db) {
  ensureV246TrackingSchema(db);
  let rows=[];
  try {
    rows=db.prepare(`
      WITH valid AS (
        SELECT DISTINCT reportDate,UPPER(TRIM(shipmentCode)) shipmentCode
        FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? AND TRIM(COALESCE(shipmentCode,''))<>''
      ), joined AS (
        SELECT v.reportDate,v.shipmentCode,l.shipmentCode ledgerBill,f.shipmentCode finalBill,
          CASE WHEN l.shipmentCode IS NOT NULL THEN CASE WHEN l.terminalReason='POD' THEN 1 ELSE 0 END ELSE COALESCE(f.isPod,0) END isPod,
          CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.podDate,'') ELSE REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(f.latestEventTime,''),''),1,10),'/','-') END podDate,
          CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.currentCategory,l.currentState,'') ELSE COALESCE(f.primaryCategory,'') END category,
          CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.currentStateJson,'{}') ELSE COALESCE(f.rawJson,'{}') END stateJson,
          CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.attemptNo,0) ELSE 0 END attemptNo,
          CASE WHEN l.shipmentCode IS NOT NULL THEN COALESCE(l.signingDays,0) ELSE 0 END signingDays,
          CASE WHEN l.shipmentCode IS NOT NULL THEN CASE WHEN l.trackingStatus='TERMINAL' THEN 1 ELSE 0 END ELSE CASE WHEN COALESCE(f.isPod,0)=1 THEN 1 ELSE 0 END END isTerminal
        FROM valid v LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=v.shipmentCode AND l.businessType='WHPP'
        LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
      ) SELECT reportDate,'WHPP' businessType,'UNKNOWN' regionCode,COUNT(*) total,SUM(CASE WHEN ledgerBill IS NOT NULL OR finalBill IS NOT NULL THEN 1 ELSE 0 END) matched,SUM(isPod) pod,
        SUM(CASE WHEN isPod=1 AND podDate=reportDate THEN 1 ELSE 0 END) sameDayPod,
        SUM(CASE WHEN isTerminal=0 AND (UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%' OR UPPER(COALESCE(json_extract(stateJson,'$."当前状态"'),''))='OC') THEN 1 ELSE 0 END) ocCurrent,
        SUM(CASE WHEN isPod=1 AND attemptNo=1 THEN 1 ELSE 0 END) attempt1,SUM(CASE WHEN isPod=1 AND attemptNo=2 THEN 1 ELSE 0 END) attempt2,SUM(CASE WHEN isPod=1 AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3,SUM(CASE WHEN isPod=1 AND attemptNo=0 THEN 1 ELSE 0 END) attemptUnknown,
        SUM(CASE WHEN isPod=1 AND signingDays>0 THEN signingDays ELSE 0 END) signingDaysSum,SUM(CASE WHEN isPod=1 AND signingDays>0 THEN 1 ELSE 0 END) signingDaysCount
      FROM joined GROUP BY reportDate ORDER BY reportDate
    `).all(from,to);
  } catch { return []; }
  return rows.map(row=>finishFact({...emptyFact('WHPP',String(row.reportDate||''),'UNKNOWN'),...row}));
}

function sourceDates(from,to,includeWhpp,db) {
  const rows=includeWhpp?db.prepare(`SELECT reportDate FROM (SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? UNION SELECT DISTINCT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ?) ORDER BY reportDate`).all(from,to,from,to):db.prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate`).all(from,to);
  return rows.map(row=>String(row.reportDate||'')).filter(Boolean);
}
function recentDates(to,type,limit,db) {
  const includeWhpp=type==='WHPP'||type==='ALL';
  const rows=includeWhpp?db.prepare(`SELECT reportDate FROM (SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? UNION SELECT DISTINCT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND reportDate<=?) ORDER BY reportDate DESC LIMIT ?`).all(to,to,limit):db.prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? ORDER BY reportDate DESC LIMIT ?`).all(to,limit);
  return rows.map(row=>String(row.reportDate||'')).filter(Boolean).sort();
}

export function readV284RegionFacts(fromDate,toDate,db=getDb()) {
  const {from,to}=validRange(fromDate,toDate); const key=`R|${from}|${to}`; const hit=cache.get(key); if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;
  const rows=[...queryUnifiedRegionFacts(from,to,db),...queryWhppRegionFacts(from,to,db)];
  const value={fromDate:from,toDate:to,rows,generatedAt:new Date().toISOString()}; cache.set(key,{at:Date.now(),value}); return value;
}
export function readV284DailyFacts(fromDate,toDate,db=getDb()) {
  const region=readV284RegionFacts(fromDate,toDate,db); const by=new Map();
  for(const row of region.rows){const key=`${row.reportDate}|${row.businessType}`;if(!by.has(key))by.set(key,[]);by.get(key).push(row);}
  return [...by.entries()].map(([key,rows])=>{const [date,type]=key.split('|');return mergeFacts(type,date,rows);}).sort((a,b)=>a.reportDate.localeCompare(b.reportDate)||a.businessType.localeCompare(b.businessType));
}
export function readV284DashboardTrends(businessType='ALL',fromDate='',toDate='',db=getDb()) {
  const type=String(businessType||'ALL').toUpperCase(); const to=dateKey(toDate),from=dateKey(fromDate)||to;
  if(!['ALL','CCSL','SHOPEE',...V284_TYPES].includes(type))throw new Error('V284业务板块无效'); if(!from||!to||from>to)throw new Error('V284日期范围无效');
  const dates=from===to?recentDates(to,type,7,db):sourceDates(from,to,type==='WHPP'||type==='ALL',db);
  if(!dates.length)return{ok:true,id:V284_DAILY_MEMBERSHIP_TRUTH_ID,businessType:type,dates:[],daily:[],ticket:[],pod:[],podRate:[],oc:[],ocRate:[],sameDayPod:[],sameDayPodRate:[],coverageRate:[],missingDates:[]};
  const facts=readV284DailyFacts(dates[0],dates.at(-1),db); const map=new Map(facts.map(row=>[`${row.reportDate}|${row.businessType}`,row]));
  const pick=(d,t)=>map.get(`${d}|${t}`)||emptyFact(t,d);
  const daily=dates.map(d=>{
    if(ALL_TYPES.has(type))return pick(d,type);
    if(type==='CCSL')return mergeFacts(type,d,CCSL_TYPES.map(t=>pick(d,t)));
    if(type==='SHOPEE')return mergeFacts(type,d,SHOPEE_TYPES.map(t=>pick(d,t)));
    return mergeFacts('ALL',d,[...UNIFIED_TYPES.map(t=>pick(d,t)),pick(d,'WHPP')]);
  });
  const val=(r,k)=>r.ready?n(r[k]):null;
  return {ok:true,id:V284_DAILY_MEMBERSHIP_TRUTH_ID,businessType:type,fromDate:dates[0],toDate:dates.at(-1),dates,daily,ticket:daily.map(r=>n(r.total)),pod:daily.map(r=>val(r,'pod')),podRate:daily.map(r=>val(r,'podRate')),oc:daily.map(r=>val(r,'ocCurrent')),ocRate:daily.map(r=>val(r,'ocRate')),sameDayPod:daily.map(r=>val(r,'sameDayPod')),sameDayPodRate:daily.map(r=>val(r,'sameDayPodRate')),coverageRate:daily.map(r=>r.coverageRate),missingDates:daily.filter(r=>!r.ready).map(r=>r.reportDate),source:'LATEST_VALID_DAILY_MEMBERSHIP_JOIN_V246_LEDGER_FINAL_FALLBACK',definitions:{podRate:'当前已POD/当日日报成员总票',ocRate:'当前真实OC/当日日报成员总票',sameDayPodRate:'日报当日完成POD/当日日报成员总票'}};
}
export function readV284ShopeeTrends(businessType='SHOPEECN',fromDate='',toDate='',options={},db=getDb()) {
  const type=String(businessType||'').toUpperCase(),to=dateKey(toDate),from=dateKey(fromDate)||to; if(!SHOPEE_TYPES.includes(type))throw new Error('V284仅支持SHOPEECN/SHOPEEVN'); if(!from||!to||from>to)throw new Error('V284日期范围无效');
  const exact=options?.exact===true,includeRegions=options?.includeRegions!==false; const dates=exact?[to]:(from===to?recentDates(to,type,7,db):sourceDates(from,to,false,db));
  if(!dates.length)return{ok:true,readId:V284_DAILY_MEMBERSHIP_TRUTH_ID,businessType:type,dates:[],daily:[],ticket:[],pod:[],podRate:[],avgPodDays:[],oc:[],ocRate:[],attempt1:[],attempt2:[],attempt3:[],attempt1Rate:[],attempt2Rate:[],attempt3Rate:[],attemptUnknown:[],attemptCoverageRate:[],ledgerReady:[],regionsIncluded:includeRegions,exact};
  const regionFacts=readV284RegionFacts(dates[0],dates.at(-1),db).rows.filter(row=>row.businessType===type&&dates.includes(row.reportDate));
  const daily=dates.map(date=>{
    const regions=regionFacts.filter(row=>row.reportDate===date); const all=mergeFacts(type,date,regions);
    const regionMap={}; if(includeRegions)for(const region of ['PP','PV','UNKNOWN'])regionMap[region]=finishFact({...emptyFact(type,date,region),...(regions.find(r=>r.regionCode===region)||{})});
    return {...all,oc:all.ocCurrent,ledgerReady:all.ready,ledgerCount:all.matched,cacheTotal:all.total,recoveredExtra:0,regions:regionMap,evidenceSource:all.ready?'V284_DAILY_MEMBERSHIP_V246_LEDGER':'V284_MEMBERSHIP_COVERAGE_INCOMPLETE'};
  });
  return {ok:true,readId:V284_DAILY_MEMBERSHIP_TRUTH_ID,businessType:type,fromDate:dates[0],toDate:dates.at(-1),dates,daily,regionsIncluded:includeRegions,exact,ticket:daily.map(r=>r.total),pod:daily.map(r=>r.ready?r.pod:null),podRate:daily.map(r=>r.ready?r.podRate:null),avgPodDays:daily.map(r=>r.ready?r.avgPodDays:null),oc:daily.map(r=>r.ready?r.ocCurrent:null),ocRate:daily.map(r=>r.ready?r.ocRate:null),attempt1:daily.map(r=>r.ready?r.attempt1:null),attempt2:daily.map(r=>r.ready?r.attempt2:null),attempt3:daily.map(r=>r.ready?r.attempt3:null),attempt1Rate:daily.map(r=>r.ready?r.attempt1Rate:null),attempt2Rate:daily.map(r=>r.ready?r.attempt2Rate:null),attempt3Rate:daily.map(r=>r.ready?r.attempt3Rate:null),attemptUnknown:daily.map(r=>r.ready?r.attemptUnknown:null),attemptCoverageRate:daily.map(r=>r.ready?r.attemptCoverageRate:null),ledgerReady:daily.map(r=>r.ready),coverageRate:daily.map(r=>r.coverageRate)};
}
export function summarizeV284Range(fromDate,toDate,db=getDb()) {
  const {from,to}=validRange(fromDate,toDate); const daily=readV284DailyFacts(from,to,db); const byType={};
  for(const type of UNIFIED_TYPES)byType[type]=mergeFacts(type,to,daily.filter(row=>row.businessType===type));
  const ccsl=mergeFacts('CCSL',to,CCSL_TYPES.map(type=>byType[type])); const shopee=mergeFacts('SHOPEE',to,SHOPEE_TYPES.map(type=>byType[type]));
  const dates=sourceDates(from,to,false,db); const missingDates=dates.filter(date=>UNIFIED_TYPES.some(type=>{const row=daily.find(r=>r.reportDate===date&&r.businessType===type);return row&&row.total>0&&!row.ready;}));
  return {id:V284_DAILY_MEMBERSHIP_TRUTH_ID,fromDate:from,toDate:to,dates,daily,byType,ccsl,shopee,sourceTotal:ccsl.total+shopee.total,analyzedTotal:ccsl.matched+shopee.matched,analysisPending:Math.max(0,ccsl.total+shopee.total-ccsl.matched-shopee.matched),missingDates,analysisComplete:missingDates.length===0&&(ccsl.matched+shopee.matched)>=ccsl.total+shopee.total};
}
export function invalidateV284DailyMembershipTruth(){cache.clear();}

globalThis.__CE_QC_INVALIDATE_V284_DAILY_MEMBERSHIP__=invalidateV284DailyMembershipTruth;
console.info('[CE-QC][V284_DAILY_MEMBERSHIP]',V284_DAILY_MEMBERSHIP_TRUTH_ID,'daily denominator=latest VALID report membership; status truth=V246 ledger first, legacy final rows fallback; firstReportDate is no longer used as daily cohort membership.');
