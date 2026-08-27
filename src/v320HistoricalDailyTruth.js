import { getDb } from './db.js';

export const V320_HISTORICAL_DAILY_TRUTH_ID='2026-08-27-v335-per-business-latest-valid-history-v1';
const STANDARD=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const TYPES=new Set([...STANDARD,'CCSL','SHOPEE','ALL']);
const CORE=new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE=new Set(['SHOPEECN','SHOPEEVN']);
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(a,b)=>b?Number((n(a)*100/n(b)).toFixed(2)):0;
const dateKey=v=>{const m=String(v||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const safeJson=v=>{try{return v&&typeof v==='object'?v:(JSON.parse(String(v||'{}'))||{});}catch{return{};}};
function hasTable(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function rows(db,sql,params=[]){try{return db.prepare(sql).all(...params);}catch{return[];}}
function marks(values){return values.map(()=>'?').join(',');}
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,ocCurrent:0,sameDayPod:0,podRate:0,ocRate:0,sameDayPodRate:0,attempt1:0,attempt2:0,attempt3:0,attemptUnknown:0,attemptEvidenceCount:0,attemptCoverageRate:null,dispatchSigningDaysCount:0,dispatchSigningDaysSum:0,avgDispatchSigningDays:null,avgSigningDays:null,signingDaysCount:0,signingDaysSum:0,signingCoverageRate:null,ready:false,evidenceComplete:false};}
function finish(row){
  row.total=n(row.total);row.pod=n(row.pod);row.ocCurrent=n(row.ocCurrent);row.sameDayPod=n(row.sameDayPod);
  row.attempt1=n(row.attempt1);row.attempt2=n(row.attempt2);row.attempt3=n(row.attempt3);
  row.attemptEvidenceCount=row.attempt1+row.attempt2+row.attempt3;row.attemptUnknown=Math.max(0,row.pod-row.attemptEvidenceCount);
  row.attemptCoverageRate=row.pod?pct(row.attemptEvidenceCount,row.pod):null;
  row.dispatchSigningDaysCount=n(row.dispatchSigningDaysCount||row.signingDaysCount);row.dispatchSigningDaysSum=n(row.dispatchSigningDaysSum||row.signingDaysSum);
  row.avgDispatchSigningDays=row.dispatchSigningDaysCount>0?Number((row.dispatchSigningDaysSum/row.dispatchSigningDaysCount).toFixed(2)):null;
  row.avgSigningDays=row.avgDispatchSigningDays;row.signingDaysCount=row.dispatchSigningDaysCount;row.signingDaysSum=row.dispatchSigningDaysSum;
  row.signingCoverageRate=row.pod?pct(row.dispatchSigningDaysCount,row.pod):null;
  row.podRate=pct(row.pod,row.total);row.ocRate=pct(row.ocCurrent,row.total);row.sameDayPodRate=pct(row.sameDayPod,row.total);
  row.ready=row.total>0||n(row.matched)>0;row.evidenceComplete=row.total===0||n(row.matched)>=row.total;
  row.attemptEvidenceComplete=row.pod===0||row.attemptUnknown===0;row.signingEvidenceComplete=row.pod===0||row.dispatchSigningDaysCount>=row.pod;
  return row;
}
function merge(type,date,parts=[]){
  const out=blank(type,date),valid=parts.filter(Boolean);for(const r of valid){for(const key of ['total','pod','ocCurrent','sameDayPod','attempt1','attempt2','attempt3','dispatchSigningDaysCount','dispatchSigningDaysSum','matched'])out[key]+=n(r[key]);}
  return finish(out);
}

export function listV320HistoricalDates({fromDate='',toDate='',expandSingle=true,db=getDb()}={}){
  const to=dateKey(toDate),from=dateKey(fromDate)||to;if(!to||!from||from>to)return[];
  const single=from===to&&expandSingle;const set=new Set();
  const specs=[
    ['unified_import_batches',"status='VALID'"],['shipment_daily_snapshots','1=1'],['daily_reports','1=1'],['business_daily_reports','1=1'],['business_history_summary','1=1'],['history_summary','1=1'],['business_daily_parse_rows','1=1'],['business_final_rows','1=1'],['final_rows','1=1']
  ];
  for(const [table,extra] of specs){if(!hasTable(db,table))continue;const sql=`SELECT DISTINCT reportDate FROM ${table} WHERE ${extra} AND reportDate ${single?'<=?':'BETWEEN ? AND ?'} ORDER BY reportDate`;
    for(const r of rows(db,sql,single?[to]:[from,to])){const d=dateKey(r.reportDate);if(d&&d<=to&&(!single?d>=from:true))set.add(d);}
  }
  const all=[...set].sort();return all.length>180?all.slice(-180):all;
}

function latestUnifiedCounts(db,dates){
  const out=new Map();if(!dates.length||!hasTable(db,'unified_import_batches')||!hasTable(db,'unified_import_rows'))return out;const m=marks(dates);
  const sql=`WITH candidates AS (
    SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,UPPER(TRIM(u.businessType)) businessType
    FROM unified_import_batches b JOIN unified_import_rows u ON u.snapshotId=b.snapshotId AND u.reportDate=b.reportDate
    WHERE b.status='VALID' AND b.reportDate IN (${m}) AND TRIM(COALESCE(u.shipmentCode,''))<>''
    GROUP BY b.reportDate,b.snapshotId,b.createdAt,b.batchId,UPPER(TRIM(u.businessType))
  ), ranked AS (
    SELECT reportDate,snapshotId,createdAt,batchId,businessType,
      ROW_NUMBER() OVER(PARTITION BY reportDate,businessType ORDER BY createdAt DESC,batchId DESC) rn
    FROM candidates
  )
  SELECT r.reportDate,r.businessType,COUNT(DISTINCT UPPER(TRIM(u.shipmentCode))) total
  FROM ranked r JOIN unified_import_rows u ON u.snapshotId=r.snapshotId AND u.reportDate=r.reportDate AND UPPER(TRIM(u.businessType))=r.businessType
  WHERE r.rn=1 AND TRIM(COALESCE(u.shipmentCode,''))<>''
  GROUP BY r.reportDate,r.businessType`;
  for(const r of rows(db,sql,dates))out.set(`${dateKey(r.reportDate)}|${String(r.businessType||'').toUpperCase()}`,n(r.total));return out;
}
function snapshotCounts(db,dates){
  const out=new Map();if(!dates.length||!hasTable(db,'shipment_daily_snapshots'))return out;const m=marks(dates);
  for(const r of rows(db,`SELECT reportDate,UPPER(TRIM(businessType)) businessType,COUNT(DISTINCT UPPER(TRIM(shipmentCode))) total FROM shipment_daily_snapshots WHERE reportDate IN (${m}) GROUP BY reportDate,UPPER(TRIM(businessType))`,dates))out.set(`${dateKey(r.reportDate)}|${String(r.businessType||'').toUpperCase()}`,n(r.total));return out;
}
function legacyShopeeCounts(db,dates){
  const out=new Map();if(!dates.length||!hasTable(db,'business_daily_parse_rows'))return out;const m=marks(dates);
  const sql=`SELECT reportDate,CASE WHEN UPPER(TRIM(COALESCE(recipient_group,'')))='CN' THEN 'SHOPEECN' WHEN UPPER(TRIM(COALESCE(recipient_group,'')))='VN' THEN 'SHOPEEVN' ELSE UPPER(TRIM(businessType)) END businessType,COUNT(DISTINCT UPPER(TRIM(shipmentCode))) total FROM business_daily_parse_rows WHERE reportDate IN (${m}) AND TRIM(COALESCE(shipmentCode,''))<>'' GROUP BY reportDate,CASE WHEN UPPER(TRIM(COALESCE(recipient_group,'')))='CN' THEN 'SHOPEECN' WHEN UPPER(TRIM(COALESCE(recipient_group,'')))='VN' THEN 'SHOPEEVN' ELSE UPPER(TRIM(businessType)) END`;
  for(const r of rows(db,sql,dates)){const type=String(r.businessType||'').toUpperCase();if(TYPES.has(type)||type==='WHPP')out.set(`${dateKey(r.reportDate)}|${type}`,n(r.total));}return out;
}
function whppReportCounts(db,dates){const out=new Map();if(!dates.length||!hasTable(db,'business_daily_reports'))return out;const m=marks(dates);for(const r of rows(db,`SELECT reportDate,MAX(totalCount) total FROM business_daily_reports WHERE UPPER(TRIM(businessType))='WHPP' AND reportDate IN (${m}) GROUP BY reportDate`,dates))out.set(`${dateKey(r.reportDate)}|WHPP`,n(r.total));return out;}

function coreFacts(db,dates,type){
  const out=new Map();if(!dates.length||!hasTable(db,'final_rows'))return out;const m=marks(dates);let source='';let params=[];
  if(hasTable(db,'shipment_daily_snapshots')){source=`SELECT DISTINCT reportDate,UPPER(TRIM(shipmentCode)) shipmentCode FROM shipment_daily_snapshots WHERE UPPER(TRIM(businessType))=? AND reportDate IN (${m})`;params=[type,...dates];}
  else return out;
  const sql=`WITH members AS (${source}), facts AS (SELECT m.reportDate,m.shipmentCode,f.shipmentCode matchedBill,COALESCE(f.isPod,0) isPod,COALESCE(f.ocDays,0) ocDays,COALESCE(f.primaryCategory,f.category,'') category,COALESCE(f.rawJson,'{}') rawJson,REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(f.lastEventTime,''),''),1,10),'/','-') podDate FROM members m LEFT JOIN final_rows f ON f.reportDate=m.reportDate AND UPPER(TRIM(f.shipmentCode))=m.shipmentCode) SELECT reportDate,COUNT(*) total,COUNT(matchedBill) matched,SUM(isPod) pod,SUM(CASE WHEN isPod=1 AND podDate=reportDate THEN 1 ELSE 0 END) sameDayPod,SUM(CASE WHEN isPod=0 AND (ocDays>=1 OR UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%') THEN 1 ELSE 0 END) ocCurrent FROM facts GROUP BY reportDate`;
  for(const r of rows(db,sql,params))out.set(dateKey(r.reportDate),finish({...blank(type,dateKey(r.reportDate)),...r,businessType:type}));return out;
}
function shopeeFacts(db,dates,type){
  const out=new Map();if(!dates.length||!hasTable(db,'business_final_rows'))return out;const group=type==='SHOPEECN'?'CN':'VN',m=marks(dates);
  const sql=`WITH facts AS (
    SELECT reportDate,shipmentCode,isPod,primaryCategory,latestEventTime,rawJson,COALESCE(podAttemptNo,CAST(json_extract(rawJson,'$.podAttemptNo') AS INTEGER),0) attemptNo,
      COALESCE(NULLIF(firstAttemptAt,''),NULLIF(json_extract(rawJson,'$.firstAttemptAt'),''),NULLIF(json_extract(rawJson,'$.首次派件时间'),''),NULLIF(json_extract(rawJson,'$.首次派送时间'),''),'') dispatchAt,
      COALESCE(NULLIF(json_extract(rawJson,'$."POD时间"'),''),NULLIF(json_extract(rawJson,'$.podTime'),''),NULLIF(json_extract(rawJson,'$."签收时间"'),''),CASE WHEN isPod=1 THEN latestEventTime ELSE '' END,'') podAt
    FROM business_final_rows WHERE reportDate IN (${m}) AND (UPPER(TRIM(businessType))=? OR UPPER(TRIM(businessType))='SHOPEE') AND UPPER(TRIM(COALESCE(recipient_group,'')))=?
  ), normalized AS (
    SELECT *,REPLACE(SUBSTR(podAt,1,10),'/','-') podDate,REPLACE(SUBSTR(dispatchAt,1,10),'/','-') dispatchDate FROM facts
  ) SELECT reportDate,COUNT(DISTINCT shipmentCode) matched,SUM(CASE WHEN isPod=1 THEN 1 ELSE 0 END) pod,
    SUM(CASE WHEN isPod=1 AND podDate=reportDate THEN 1 ELSE 0 END) sameDayPod,
    SUM(CASE WHEN isPod=0 AND (UPPER(TRIM(primaryCategory))='OC' OR UPPER(TRIM(primaryCategory)) LIKE 'OC%' OR primaryCategory LIKE '%OC滞留%') THEN 1 ELSE 0 END) ocCurrent,
    SUM(CASE WHEN isPod=1 AND attemptNo=1 THEN 1 ELSE 0 END) attempt1,SUM(CASE WHEN isPod=1 AND attemptNo=2 THEN 1 ELSE 0 END) attempt2,SUM(CASE WHEN isPod=1 AND attemptNo>=3 THEN 1 ELSE 0 END) attempt3,
    SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDate<>'' AND julianday(podDate)>=julianday(dispatchDate) THEN CAST(julianday(podDate)-julianday(dispatchDate)+1 AS INTEGER) ELSE 0 END) dispatchSigningDaysSum,
    SUM(CASE WHEN isPod=1 AND dispatchDate<>'' AND podDate<>'' AND julianday(podDate)>=julianday(dispatchDate) THEN 1 ELSE 0 END) dispatchSigningDaysCount
    FROM normalized GROUP BY reportDate`;
  for(const r of rows(db,sql,[...dates,'SHOPEE',group]))out.set(dateKey(r.reportDate),finish({...blank(type,dateKey(r.reportDate)),...r,businessType:type}));return out;
}
function whppFacts(db,dates){
  const out=new Map();if(!dates.length||!hasTable(db,'business_final_rows'))return out;const m=marks(dates);const sql=`SELECT reportDate,COUNT(DISTINCT shipmentCode) matched,SUM(COALESCE(isPod,0)) pod,SUM(CASE WHEN COALESCE(isPod,0)=0 AND (UPPER(TRIM(primaryCategory))='OC' OR UPPER(TRIM(primaryCategory)) LIKE 'OC%' OR primaryCategory LIKE '%OC滞留%') THEN 1 ELSE 0 END) ocCurrent,SUM(CASE WHEN COALESCE(isPod,0)=1 AND REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(rawJson,'$."POD时间"'),''),NULLIF(json_extract(rawJson,'$.podTime'),''),NULLIF(latestEventTime,''),''),1,10),'/','-')=reportDate THEN 1 ELSE 0 END) sameDayPod FROM business_final_rows WHERE UPPER(TRIM(businessType))='WHPP' AND reportDate IN (${m}) GROUP BY reportDate`;for(const r of rows(db,sql,dates))out.set(dateKey(r.reportDate),finish({...blank('WHPP',dateKey(r.reportDate)),...r,businessType:'WHPP'}));return out;
}

export function readV320HistoricalDaily(businessType='ALL',fromDate='',toDate='',options={}){
  const db=options.db||getDb(),type=String(businessType||'ALL').toUpperCase(),to=dateKey(toDate),from=dateKey(fromDate)||to;if(!TYPES.has(type))throw new Error('业务板块无效');if(!from||!to||from>to)throw new Error('日期范围无效');
  const dates=listV320HistoricalDates({fromDate:from,toDate:to,expandSingle:options.expandSingle!==false,db});
  const unified=latestUnifiedCounts(db,dates),snapshots=snapshotCounts(db,dates),legacy=legacyShopeeCounts(db,dates),whppCounts=whppReportCounts(db,dates);
  const facts={};for(const t of ['CE','CEAF','TBKH','ALI1688'])facts[t]=coreFacts(db,dates,t);for(const t of ['SHOPEECN','SHOPEEVN'])facts[t]=shopeeFacts(db,dates,t);facts.WHPP=whppFacts(db,dates);
  function one(t,d){const key=`${d}|${t}`;let total=n(unified.get(key));if(!total)total=n(snapshots.get(key));if(!total)total=n(legacy.get(key));if(!total&&t==='WHPP')total=n(whppCounts.get(key));const base=facts[t]?.get(d)||blank(t,d);base.total=total||n(base.matched);return finish(base);}
  const daily=dates.map(d=>{if(STANDARD.includes(type))return one(type,d);if(type==='CCSL')return merge('CCSL',d,['CE','CEAF','TBKH','ALI1688'].map(t=>one(t,d)));if(type==='SHOPEE')return merge('SHOPEE',d,['SHOPEECN','SHOPEEVN'].map(t=>one(t,d)));return merge('ALL',d,STANDARD.map(t=>one(t,d)));});
  return{ok:true,id:V320_HISTORICAL_DAILY_TRUTH_ID,readId:V320_HISTORICAL_DAILY_TRUTH_ID,businessType:type,requestedFromDate:from,requestedToDate:to,historyExpanded:from===to&&options.expandSingle!==false,fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,
    ticket:daily.map(r=>n(r.total)),pod:daily.map(r=>n(r.pod)),podRate:daily.map(r=>r.podRate),oc:daily.map(r=>n(r.ocCurrent)),ocRate:daily.map(r=>r.ocRate),sameDayPod:daily.map(r=>n(r.sameDayPod)),sameDayPodRate:daily.map(r=>r.sameDayPodRate),
    avgDispatchSigningDays:daily.map(r=>r.avgDispatchSigningDays),avgSigningDays:daily.map(r=>r.avgDispatchSigningDays),attempt1:daily.map(r=>n(r.attempt1)),attempt2:daily.map(r=>n(r.attempt2)),attempt3:daily.map(r=>n(r.attempt3)),attemptCoverageRate:daily.map(r=>r.attemptCoverageRate),signingSampleCount:daily.map(r=>n(r.dispatchSigningDaysCount)),
    source:'V320_PERSISTED_HISTORY_UNION_READ_ONLY',definitions:{history:'单日看板仍显示所选日期；逐日明细与走势图在起止日期相同时自动展示数据库中截至该日的全部已保存历史日期（最多180日）',averageDays:'平均派件→签收天数=真实首次派件START/firstAttemptAt到真实POD日期的自然日平均；同日=1天；仅缺失证据的票不参与平均，不再因为覆盖率不足把整日平均值隐藏为—',readPolicy:'只读已落库日报、历史快照和最终结果；同一天各业务独立选择自己的最新VALID日报；页面读取不调用CE接口'}
  };
}

console.info('[CE-QC][V320_HISTORICAL_DAILY_TRUTH]',V320_HISTORICAL_DAILY_TRUTH_ID,'historical membership selects the latest VALID snapshot independently per reportDate+businessType; later CN/VN/CEAF imports cannot erase same-date siblings.');