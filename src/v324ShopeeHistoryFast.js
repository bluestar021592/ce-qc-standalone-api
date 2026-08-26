import { getDb } from './db.js';

export const V324_SHOPEE_HISTORY_FAST_ID='2026-08-26-v324-shopee-full-uploaded-history-fast-v4';
const TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const CACHE_MS=30_000;
const cache=new Map();
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):null;
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function hasTable(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function blank(type,date){return{businessType:type,reportDate:date,total:0,matched:0,pod:0,podRate:0,ocCurrent:0,ocRate:0,sameDayPod:0,sameDayPodRate:0,attempt1:0,attempt2:0,attempt3:0,attemptUnknown:0,attemptEvidenceCount:0,attemptCoverageRate:null,dispatchSigningDaysCount:0,dispatchSigningDaysSum:0,signingDaysCount:0,signingDaysSum:0,signingSampleCount:0,signingCoverageRate:null,avgDispatchSigningDays:null,avgSigningDays:null,ready:false,ledgerReady:false,evidenceIncomplete:false};}
function finish(type,row={}){const out={...blank(type,dateKey(row.reportDate)),...row};out.total=n(out.total);out.matched=n(out.matched);out.pod=n(out.pod);out.ocCurrent=n(out.ocCurrent);out.sameDayPod=n(out.sameDayPod);out.attempt1=n(out.attempt1);out.attempt2=n(out.attempt2);out.attempt3=n(out.attempt3);out.attemptEvidenceCount=out.attempt1+out.attempt2+out.attempt3;out.attemptUnknown=Math.max(0,out.pod-out.attemptEvidenceCount);out.attemptCoverageRate=pct(out.attemptEvidenceCount,out.pod);out.dispatchSigningDaysCount=n(out.dispatchSigningDaysCount);out.dispatchSigningDaysSum=n(out.dispatchSigningDaysSum);out.signingDaysCount=out.dispatchSigningDaysCount;out.signingDaysSum=out.dispatchSigningDaysSum;out.signingSampleCount=out.dispatchSigningDaysCount;out.signingCoverageRate=pct(out.dispatchSigningDaysCount,out.pod);out.avgDispatchSigningDays=out.dispatchSigningDaysCount?Number((out.dispatchSigningDaysSum/out.dispatchSigningDaysCount).toFixed(2)):null;out.avgSigningDays=out.avgDispatchSigningDays;out.podRate=pct(out.pod,out.total)??0;out.ocRate=pct(out.ocCurrent,out.total)??0;out.sameDayPodRate=pct(out.sameDayPod,out.total)??0;out.ready=out.total>0&&out.matched>=out.total;out.ledgerReady=true;out.evidenceIncomplete=out.pod>0&&(out.attemptUnknown>0||out.dispatchSigningDaysCount<out.pod);out.attemptEvidenceComplete=out.pod===0||out.attemptUnknown===0;out.signingEvidenceComplete=out.pod===0||out.dispatchSigningDaysCount>=out.pod;return out;}
function groupOf(type){return type==='SHOPEECN'?'CN':'VN';}
function membershipUnion(type,group,{from='',to='',db=getDb(),upperOnly=false}={}){
  const parts=[],params=[];
  if(hasTable(db,'business_daily_parse_rows')){
    parts.push(`SELECT reportDate,UPPER(TRIM(shipmentCode)) shipmentCode FROM business_daily_parse_rows WHERE (UPPER(TRIM(businessType))='SHOPEE' OR UPPER(TRIM(businessType))=?) AND UPPER(TRIM(COALESCE(recipient_group,'')))=? AND reportDate ${upperOnly?'<=?':'BETWEEN ? AND ?'} AND TRIM(COALESCE(shipmentCode,''))<>''`);
    params.push(type,group,...(upperOnly?[to]:[from,to]));
  }
  if(hasTable(db,'shipment_daily_snapshots')){
    parts.push(`SELECT reportDate,UPPER(TRIM(shipmentCode)) shipmentCode FROM shipment_daily_snapshots WHERE (UPPER(TRIM(businessType))=? OR (UPPER(TRIM(businessType))='SHOPEE' AND CASE WHEN json_valid(rowJson) THEN UPPER(TRIM(COALESCE(json_extract(rowJson,'$.recipient_group'),json_extract(rowJson,'$.recipientGroup'),''))) ELSE '' END=?)) AND reportDate ${upperOnly?'<=?':'BETWEEN ? AND ?'} AND TRIM(COALESCE(shipmentCode,''))<>''`);
    params.push(type,group,...(upperOnly?[to]:[from,to]));
  }
  return{sql:parts.length?parts.join(' UNION ALL '):`SELECT '' reportDate,'' shipmentCode WHERE 0`,params};
}
function availableRange(type,toDate,db){const to=dateKey(toDate);if(!to)return null;const group=groupOf(type),members=membershipUnion(type,group,{to,db,upperOnly:true});try{const row=db.prepare(`WITH persisted_members AS (${members.sql}) SELECT MIN(reportDate) minDate,MAX(reportDate) maxDate,COUNT(DISTINCT reportDate) dayCount FROM persisted_members WHERE reportDate<>''`).get(...members.params)||{};const from=dateKey(row.minDate),max=dateKey(row.maxDate);return from&&max?{from,to:max,dayCount:n(row.dayCount)}:null;}catch{return null;}}
function baseHistory(type,from,to,db,withLedger=true){const group=groupOf(type),members=membershipUnion(type,group,{from,to,db,upperOnly:false}),ledgerJoin=withLedger?`LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=m.shipmentCode AND UPPER(TRIM(l.businessType))=?`:'';const ledgerFields=withLedger?`,l.terminalReason,l.attemptNo,l.attemptSource,l.podDate,l.evidenceJson`:`,'' terminalReason,0 attemptNo,'' attemptSource,'' podDate,'{}' evidenceJson`;const sql=`WITH persisted_members AS (${members.sql}), members AS (
  SELECT reportDate,shipmentCode FROM persisted_members WHERE reportDate<>'' AND shipmentCode<>'' GROUP BY reportDate,shipmentCode
), facts AS (
  SELECT m.reportDate,m.shipmentCode,CASE WHEN f.shipmentCode IS NULL THEN 0 ELSE 1 END matched,COALESCE(f.isPod,0) isPod,COALESCE(f.primaryCategory,'') category,COALESCE(f.latestEventTime,'') latestEventTime,COALESCE(f.rawJson,'{}') rawJson${ledgerFields},
    CASE WHEN ${withLedger?'json_valid(l.evidenceJson)':'0'} THEN COALESCE(json_extract(${withLedger?'l.evidenceJson':'\'{}\''},'$.starts[0].time'),'') ELSE '' END dispatchAt,
    COALESCE(NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$.\"POD时间\"') END,''),NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$.podTime') END,''),NULLIF(CASE WHEN json_valid(f.rawJson) THEN json_extract(f.rawJson,'$.\"签收时间\"') END,''),CASE WHEN COALESCE(f.isPod,0)=1 THEN NULLIF(f.latestEventTime,'') ELSE '' END,${withLedger?'CASE WHEN COALESCE(f.isPod,0)=1 THEN NULLIF(l.podDate,\'\') ELSE \'\' END':'\'\''},'') podAt
  FROM members m
  LEFT JOIN business_final_rows f ON (UPPER(TRIM(f.businessType))='SHOPEE' OR UPPER(TRIM(f.businessType))=?) AND UPPER(TRIM(f.shipmentCode))=m.shipmentCode AND f.reportDate=m.reportDate
  ${ledgerJoin}
), norm AS (
  SELECT *,REPLACE(SUBSTR(dispatchAt,1,10),'/','-') dispatchDate,REPLACE(SUBSTR(podAt,1,10),'/','-') podDay FROM facts
)
SELECT reportDate,COUNT(*) total,SUM(matched) matched,SUM(isPod) pod,
  SUM(CASE WHEN isPod=1 AND podDay=reportDate THEN 1 ELSE 0 END) sameDayPod,
  SUM(CASE WHEN isPod=0 AND matched=1 AND (UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%') THEN 1 ELSE 0 END) ocCurrent,
  SUM(CASE WHEN isPod=1 AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo=1 THEN 1 ELSE 0 END) attempt1,
  SUM(CASE WHEN isPod=1 AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo=2 THEN 1 ELSE 0 END) attempt2,
  SUM(CASE WHEN isPod=1 AND attemptSource LIKE 'V246_STRICT_TRACK%' AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3,
  SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDay<>'' AND julianday(podDay)>=julianday(dispatchDate) THEN CAST(julianday(podDay)-julianday(dispatchDate)+1 AS INTEGER) ELSE 0 END) dispatchSigningDaysSum,
  SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDay<>'' AND julianday(podDay)>=julianday(dispatchDate) THEN 1 ELSE 0 END) dispatchSigningDaysCount
FROM norm GROUP BY reportDate ORDER BY reportDate`;
const params=[...members.params,type];if(withLedger)params.push(type);return db.prepare(sql).all(...params).map(row=>finish(type,row));}

export function readV324ShopeeHistory(businessType='',toDate='',db=getDb()){
  const type=String(businessType||'').toUpperCase(),to=dateKey(toDate);if(!TYPES.has(type))throw new Error('V324历史快速读取仅支持SHOPEECN/SHOPEEVN');if(!to)throw new Error('日期无效');const key=`${type}|${to}`,hit=cache.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;const range=availableRange(type,to,db);if(!range)return{ok:true,id:V324_SHOPEE_HISTORY_FAST_ID,businessType:type,requestedToDate:to,fromDate:to,toDate:to,dates:[],daily:[],historyExpanded:true,source:'V324_NO_PERSISTED_SHOPEE_HISTORY'};let daily=[];try{daily=baseHistory(type,range.from,range.to,db,hasTable(db,'qc_tracking_ledger'));}catch(error){console.warn('[CE-QC][V324_SHOPEE_HISTORY_FAST_FAILED]',type,error?.message||error);daily=[];}const value={ok:true,id:V324_SHOPEE_HISTORY_FAST_ID,businessType:type,requestedToDate:to,fromDate:range.from,toDate:range.to,dates:daily.map(r=>r.reportDate),daily,historyExpanded:true,availableDayCount:range.dayCount,source:'V324_INDEXED_DAILY_MEMBERSHIP_UNION_PLUS_EXACT_DAILY_FINAL_PLUS_STRICT_LEDGER',definitions:{history:'SHOPEE历史面板自动读取截至所选日期已经持久化的全部日报日期；同时识别历史日报成员表和shipment_daily_snapshots历史快照，不要求顶部手动拉多日范围。',attempts:'1/2/3派仅使用V246严格START周期证据。',averageDays:'平均派件→签收天数使用严格轨迹第一条真实START至真实POD日，自然日同日=1天。',missingFinal:'历史日报成员存在但对应日处理结果未完整保存时，只显示总票数，其余状态事实保持未知。',performance:'只查询有日期/业务索引的历史成员并按业务+单号+日期连接对应日结果/严格账本；不做全库历史事实表联合扫描，不调用CE接口。'}};cache.set(key,{at:Date.now(),value});return value;}

export function clearV324ShopeeHistoryCache(){cache.clear();}
console.info('[CE-QC][V324_SHOPEE_HISTORY_FAST]',V324_SHOPEE_HISTORY_FAST_ID,'auto history unions indexed daily parse membership + shipment_daily_snapshots, then joins exact per-day final rows + strict ledger; incomplete facts stay unknown; no full-history fact scan.');
