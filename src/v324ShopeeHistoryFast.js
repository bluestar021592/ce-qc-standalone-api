import { getDb } from './db.js';

export const V324_SHOPEE_HISTORY_FAST_ID='2026-08-26-v327-shopee-history-indexed-summary-census-v1';
const TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const CACHE_MS=30_000;
const cache=new Map();
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):null;
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function hasTable(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function safeJson(v){try{return v&&typeof v==='object'?v:JSON.parse(String(v||'{}'));}catch{return{};}}
function blank(type,date){return{businessType:type,reportDate:date,total:0,matched:0,pod:0,podRate:0,ocCurrent:0,ocRate:0,sameDayPod:0,sameDayPodRate:0,attempt1:0,attempt2:0,attempt3:0,attemptUnknown:0,attemptEvidenceCount:0,attemptCoverageRate:null,dispatchSigningDaysCount:0,dispatchSigningDaysSum:0,signingDaysCount:0,signingDaysSum:0,signingSampleCount:0,signingCoverageRate:null,avgDispatchSigningDays:null,avgSigningDays:null,ready:false,ledgerReady:false,evidenceIncomplete:false};}
function finish(type,row={}){const out={...blank(type,dateKey(row.reportDate)),...row};out.total=n(out.total);out.matched=n(out.matched);out.pod=n(out.pod);out.ocCurrent=n(out.ocCurrent);out.sameDayPod=n(out.sameDayPod);out.attempt1=n(out.attempt1);out.attempt2=n(out.attempt2);out.attempt3=n(out.attempt3);out.attemptEvidenceCount=out.attempt1+out.attempt2+out.attempt3;out.attemptUnknown=Math.max(0,out.pod-out.attemptEvidenceCount);out.attemptCoverageRate=pct(out.attemptEvidenceCount,out.pod);out.dispatchSigningDaysCount=n(out.dispatchSigningDaysCount);out.dispatchSigningDaysSum=n(out.dispatchSigningDaysSum);out.signingDaysCount=out.dispatchSigningDaysCount;out.signingDaysSum=out.dispatchSigningDaysSum;out.signingSampleCount=out.dispatchSigningDaysCount;out.signingCoverageRate=pct(out.dispatchSigningDaysCount,out.pod);out.avgDispatchSigningDays=out.dispatchSigningDaysCount?Number((out.dispatchSigningDaysSum/out.dispatchSigningDaysCount).toFixed(2)):null;out.avgSigningDays=out.avgDispatchSigningDays;out.podRate=pct(out.pod,out.total)??0;out.ocRate=pct(out.ocCurrent,out.total)??0;out.sameDayPodRate=pct(out.sameDayPod,out.total)??0;out.ready=Boolean(row.summaryReady)||(out.total>0&&out.matched>=out.total);out.ledgerReady=true;out.evidenceIncomplete=out.ready&&out.pod>0&&(out.attemptUnknown>0||out.dispatchSigningDaysCount<out.pod);out.attemptEvidenceComplete=out.pod===0||out.attemptUnknown===0;out.signingEvidenceComplete=out.pod===0||out.dispatchSigningDaysCount>=out.pod;return out;}
function groupOf(type){return type==='SHOPEECN'?'CN':'VN';}
function membershipUnion(type,group,{from='',to='',db=getDb(),upperOnly=false}={}){
  const parts=[],params=[];
  if(hasTable(db,'business_daily_parse_rows')){
    parts.push(`SELECT reportDate,shipmentCode FROM business_daily_parse_rows WHERE businessType IN ('SHOPEE',?) AND recipient_group=? AND reportDate ${upperOnly?'<=?':'BETWEEN ? AND ?'} AND shipmentCode<>''`);
    params.push(type,group,...(upperOnly?[to]:[from,to]));
  }
  if(hasTable(db,'shipment_daily_snapshots')){
    parts.push(`SELECT reportDate,shipmentCode FROM shipment_daily_snapshots WHERE (businessType=? OR (businessType='SHOPEE' AND CASE WHEN json_valid(rowJson) THEN COALESCE(json_extract(rowJson,'$.recipient_group'),json_extract(rowJson,'$.recipientGroup'),'') ELSE '' END=?)) AND reportDate ${upperOnly?'<=?':'BETWEEN ? AND ?'} AND shipmentCode<>''`);
    params.push(type,group,...(upperOnly?[to]:[from,to]));
  }
  return{sql:parts.length?parts.join(' UNION ALL '):`SELECT '' reportDate,'' shipmentCode WHERE 0`,params};
}
function censusDates(type,toDate,db){const to=dateKey(toDate);if(!to)return[];const group=groupOf(type),set=new Set(),members=membershipUnion(type,group,{to,db,upperOnly:true});try{for(const r of db.prepare(`WITH persisted_members AS (${members.sql}) SELECT DISTINCT reportDate FROM persisted_members WHERE reportDate<>'' ORDER BY reportDate`).all(...members.params)){const d=dateKey(r.reportDate);if(d&&d<=to)set.add(d);}}catch{}
  const small=[
    ['business_history_summary',`businessType IN ('SHOPEE',?)`],
    ['business_daily_reports',`businessType IN ('SHOPEE',?)`],
    ['business_export_snapshots',`businessType IN ('SHOPEE',?) AND COALESCE(status,'VALID')='VALID'`]
  ];
  for(const [table,where] of small){if(!hasTable(db,table))continue;try{for(const r of db.prepare(`SELECT DISTINCT reportDate FROM ${table} WHERE ${where} AND reportDate<=? ORDER BY reportDate`).all(type,to)){const d=dateKey(r.reportDate);if(d&&d<=to)set.add(d);}}catch{}}
  const dates=[...set].sort();return dates.length>180?dates.slice(-180):dates;
}
function explicitGroupSummary(summary,group){const roots=[summary?.groups?.[group],summary?.recipientGroups?.[group],summary?.recipient_groups?.[group],summary?.dashboard?.groups?.[group],summary?.dashboard?.recipientGroups?.[group],summary?.[group]].filter(v=>v&&typeof v==='object');for(const src of roots){const total=[src.total,src.sourceTotal,src.totalCount,src.ticket,src.tickets].find(v=>Number.isFinite(Number(v)));if(total===undefined)continue;const pod=[src.pod,src.podCount,src.todayPod].find(v=>Number.isFinite(Number(v)));const oc=[src.ocCurrent,src.oc,src.ocCount].find(v=>Number.isFinite(Number(v)));const same=[src.sameDayPod,src.firstDayPod].find(v=>Number.isFinite(Number(v)));return{total:n(total),matched:n(total),pod:n(pod),ocCurrent:n(oc),sameDayPod:n(same),summaryReady:true};}return null;}
function summaryFallback(type,dates,db){const out=new Map();if(!dates.length||!hasTable(db,'business_history_summary'))return out;const marks=dates.map(()=>'?').join(','),group=groupOf(type);try{const rows=db.prepare(`SELECT reportDate,summaryJson FROM business_history_summary WHERE businessType IN ('SHOPEE',?) AND reportDate IN (${marks})`).all(type,...dates);for(const r of rows){const fact=explicitGroupSummary(safeJson(r.summaryJson),group);if(fact)out.set(dateKey(r.reportDate),finish(type,{...fact,reportDate:dateKey(r.reportDate)}));}}catch{}return out;}
function baseHistory(type,from,to,db,withLedger=true){const group=groupOf(type),members=membershipUnion(type,group,{from,to,db,upperOnly:false}),ledgerJoin=withLedger?`LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=m.shipmentCode AND l.businessType=?`:'';const ledgerFields=withLedger?`,l.terminalReason,l.attemptNo,l.attemptSource,l.podDate,l.evidenceJson`:`,'' terminalReason,0 attemptNo,'' attemptSource,'' podDate,'{}' evidenceJson`;const sql=`WITH persisted_members AS (${members.sql}), members AS (
  SELECT reportDate,shipmentCode FROM persisted_members WHERE reportDate<>'' AND shipmentCode<>'' GROUP BY reportDate,shipmentCode
), facts AS (
  SELECT m.reportDate,m.shipmentCode,CASE WHEN f.shipmentCode IS NULL THEN 0 ELSE 1 END matched,COALESCE(f.isPod,0) isPod,COALESCE(f.primaryCategory,'') category,COALESCE(f.latestEventTime,'') latestEventTime,COALESCE(f.rawJson,'{}') rawJson${ledgerFields},
    CASE WHEN ${withLedger?'json_valid(l.evidenceJson)':'0'} THEN COALESCE(json_extract(${withLedger?'l.evidenceJson':'\'{}\''},'$.starts[0].time'),'') ELSE '' END dispatchAt,
    COALESCE(NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$.\"POD时间\"') END,''),NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$.podTime') END,''),NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$.\"签收时间\"') END,''),CASE WHEN COALESCE(f.isPod,0)=1 THEN NULLIF(f.latestEventTime,'') ELSE '' END,${withLedger?'CASE WHEN COALESCE(f.isPod,0)=1 THEN NULLIF(l.podDate,\'\') ELSE \'\' END':'\'\''},'') podAt
  FROM members m
  LEFT JOIN business_final_rows f ON f.businessType IN ('SHOPEE',?) AND f.reportDate=m.reportDate AND f.shipmentCode=m.shipmentCode AND f.recipient_group=?
  ${ledgerJoin}
), norm AS (
  SELECT *,REPLACE(SUBSTR(dispatchAt,1,10),'/','-') dispatchDate,REPLACE(SUBSTR(podAt,1,10),'/','-') podDay FROM facts
)
SELECT reportDate,COUNT(*) total,SUM(matched) matched,SUM(isPod) pod,
  SUM(CASE WHEN isPod=1 AND podDay=reportDate THEN 1 ELSE 0 END) sameDayPod,
  SUM(CASE WHEN isPod=0 AND matched=1 AND (category='OC' OR category LIKE 'OC%' OR category LIKE '%OC滞留%') THEN 1 ELSE 0 END) ocCurrent,
  SUM(CASE WHEN isPod=1 AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo=1 THEN 1 ELSE 0 END) attempt1,
  SUM(CASE WHEN isPod=1 AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo=2 THEN 1 ELSE 0 END) attempt2,
  SUM(CASE WHEN isPod=1 AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3,
  SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDay<>'' AND julianday(podDay)>=julianday(dispatchDate) THEN CAST(julianday(podDay)-julianday(dispatchDate)+1 AS INTEGER) ELSE 0 END) dispatchSigningDaysSum,
  SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDay<>'' AND julianday(podDay)>=julianday(dispatchDate) THEN 1 ELSE 0 END) dispatchSigningDaysCount
FROM norm GROUP BY reportDate ORDER BY reportDate`;
  const params=[...members.params,type,group];if(withLedger)params.push(type);return db.prepare(sql).all(...params).map(row=>finish(type,row));}

export function readV324ShopeeHistory(businessType='',toDate='',db=getDb()){
  const type=String(businessType||'').toUpperCase(),to=dateKey(toDate);if(!TYPES.has(type))throw new Error('V327历史快速读取仅支持SHOPEECN/SHOPEEVN');if(!to)throw new Error('日期无效');const key=`${type}|${to}`,hit=cache.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;const dates=censusDates(type,to,db);if(!dates.length)return{ok:true,id:V324_SHOPEE_HISTORY_FAST_ID,businessType:type,requestedToDate:to,fromDate:to,toDate:to,dates:[],daily:[],historyExpanded:true,source:'V327_NO_PERSISTED_SHOPEE_HISTORY'};const from=dates[0],last=dates.at(-1),byDate=new Map();try{for(const row of baseHistory(type,from,last,db,hasTable(db,'qc_tracking_ledger')))byDate.set(row.reportDate,row);}catch(error){console.warn('[CE-QC][V327_SHOPEE_HISTORY_FAST_FAILED]',type,error?.message||error);}const summary=summaryFallback(type,dates,db);const daily=dates.map(d=>byDate.get(d)||summary.get(d)||finish(type,{...blank(type,d),reportDate:d}));const value={ok:true,id:V324_SHOPEE_HISTORY_FAST_ID,businessType:type,requestedToDate:to,fromDate:from,toDate:last,dates,daily,historyExpanded:true,availableDayCount:dates.length,source:'V327_INDEXED_MEMBERSHIP_PLUS_PERSISTED_SUMMARY_DATE_CENSUS',definitions:{history:'SHOPEE历史面板读取截至所选日期已经持久化的全部日报日期；日期目录同时识别日报成员、历史摘要、正式快照和日报记录，不再因为成员表轮换只剩当天。',attempts:'1/2/3派仅使用V246严格START周期证据。',averageDays:'平均派件→签收天数使用严格轨迹第一条真实START至真实POD日，自然日同日=1天。',missingFinal:'有日报日期但缺逐票成员或对应日处理结果时，该日保持未知，不伪造0。',performance:'历史成员和结果查询使用原始规范化字段命中现有业务+日期索引，避免UPPER/TRIM破坏索引；不调用CE接口。'}};cache.set(key,{at:Date.now(),value});return value;}
export function clearV324ShopeeHistoryCache(){cache.clear();}
console.info('[CE-QC][V327_SHOPEE_HISTORY_FAST]',V324_SHOPEE_HISTORY_FAST_ID,'indexed exact-value predicates + small persisted-summary date census restore rotated history without full-table scans; missing facts remain unknown.');
