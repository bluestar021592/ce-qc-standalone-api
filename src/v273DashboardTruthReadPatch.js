import express from 'express';
import { getDb } from './db.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';

export const V273_DASHBOARD_TRUTH_ID='2026-08-24-v273-ledger-backed-seven-business-trends-v1';
const TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP','CCSL','SHOPEE','ALL']);
const UNIFIED_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];
const CACHE_MS=15000;
const memory=new Map();
const previousGet=express.application.get;
let registered=false;
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=(v,t)=>t?Number((n(v)*100/n(t)).toFixed(2)):0;
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,matched:0,pod:0,ocCurrent:0,sameDayPod:0,podRate:0,ocRate:0,sameDayPodRate:0,ready:false,coverageRate:0};}
function finish(row){row.total=n(row.total);row.matched=n(row.matched);row.pod=n(row.pod);row.ocCurrent=n(row.ocCurrent);row.sameDayPod=n(row.sameDayPod);row.coverageRate=pct(row.matched,row.total);row.podRate=pct(row.pod,row.total);row.ocRate=pct(row.ocCurrent,row.total);row.sameDayPodRate=pct(row.sameDayPod,row.total);row.ready=row.total===0||row.matched>=row.total;return row;}
function merge(type,date,rows=[]){const out=blank(type,date),valid=rows.filter(Boolean);for(const row of valid){out.total+=n(row.total);out.matched+=n(row.matched);out.pod+=n(row.pod);out.ocCurrent+=n(row.ocCurrent);out.sameDayPod+=n(row.sameDayPod);}return finish(out);}
function selectedDates(type,from,to,db){const single=from===to,includeWhpp=['WHPP','ALL'].includes(type);const base=single?'reportDate<=?':'reportDate BETWEEN ? AND ?';const order=single?'DESC':'ASC',limit=single?7:180;let rows=[];if(includeWhpp){const sql=`SELECT reportDate FROM (SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND ${base} UNION SELECT DISTINCT reportDate FROM business_daily_reports WHERE businessType='WHPP' AND ${base}) ORDER BY reportDate ${order} LIMIT ${limit}`;rows=single?db.prepare(sql).all(to,to):db.prepare(sql).all(from,to,from,to);}else{const sql=`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND ${base} ORDER BY reportDate ${order} LIMIT ${limit}`;rows=single?db.prepare(sql).all(to):db.prepare(sql).all(from,to);}const dates=rows.map(r=>String(r.reportDate||'')).filter(Boolean);return single?dates.sort():dates;}
function latestBatches(dates,db){if(!dates.length)return new Map();const marks=dates.map(()=>'?').join(',');const rows=db.prepare(`WITH ranked AS (SELECT reportDate,snapshotId,createdAt,batchId,ROW_NUMBER() OVER(PARTITION BY reportDate ORDER BY createdAt DESC,batchId DESC) rn FROM unified_import_batches WHERE status='VALID' AND reportDate IN (${marks})) SELECT reportDate,snapshotId FROM ranked WHERE rn=1`).all(...dates);return new Map(rows.map(r=>[String(r.reportDate||''),String(r.snapshotId||'')]));}
function pairsCte(dates,batches){const pairs=dates.map(d=>[d,batches.get(d)||'']).filter(([,s])=>s);return pairs.length?{sql:pairs.map(()=>'(?,?)').join(','),params:pairs.flat()}:null;}
function evidenceReadySql(alias='l'){return `(${alias}.shipmentCode IS NOT NULL AND (${alias}.terminalReason<>'' OR ${alias}.lastCheckedAt<>'' OR UPPER(TRIM(COALESCE(${alias}.currentState,''))) NOT IN ('','OPEN','PENDING_SCAN'))) `;}
function ocSql(alias='l'){return `(${alias}.trackingStatus='OPEN' AND (UPPER(TRIM(COALESCE(${alias}.currentState,'')))='OC' OR UPPER(TRIM(COALESCE(${alias}.currentCategory,'')))='OC' OR UPPER(TRIM(COALESCE(${alias}.currentCategory,''))) LIKE 'OC%' OR COALESCE(${alias}.currentCategory,'') LIKE '%OC滞留%' OR UPPER(COALESCE(json_extract(${alias}.currentStateJson,'$."当前状态"'),''))='OC' OR UPPER(COALESCE(json_extract(${alias}.currentStateJson,'$."状态标识"'),''))='OC'))`;}
function unifiedFacts(dates,batches,scope,db){const out=new Map(),cte=pairsCte(dates,batches);if(!cte||!scope.length)return out;ensureV246TrackingSchema(db);const marks=scope.map(()=>'?').join(',');const rows=db.prepare(`WITH latest(reportDate,snapshotId) AS (VALUES ${cte.sql}), valid AS (
 SELECT l.reportDate,u.businessType,UPPER(TRIM(u.shipmentCode)) shipmentCode FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate WHERE u.businessType IN (${marks})
) SELECT v.reportDate,v.businessType,COUNT(*) total,
 SUM(CASE WHEN ${evidenceReadySql('q')} THEN 1 ELSE 0 END) matched,
 SUM(CASE WHEN q.terminalReason='POD' THEN 1 ELSE 0 END) pod,
 SUM(CASE WHEN q.terminalReason='POD' AND q.podDate=v.reportDate THEN 1 ELSE 0 END) sameDayPod,
 SUM(CASE WHEN ${ocSql('q')} THEN 1 ELSE 0 END) ocCurrent
 FROM valid v LEFT JOIN qc_tracking_ledger q ON q.shipmentCode=v.shipmentCode AND q.businessType=v.businessType GROUP BY v.reportDate,v.businessType`).all(...cte.params,...scope);for(const raw of rows){const row=finish({...blank(raw.businessType,raw.reportDate),...raw});out.set(`${row.reportDate}|${row.businessType}`,row);}return out;}
function whppFacts(dates,db){const out=new Map();if(!dates.length)return out;ensureV246TrackingSchema(db);const marks=dates.map(()=>'?').join(',');const rows=db.prepare(`WITH valid AS (
 SELECT DISTINCT p.reportDate,UPPER(TRIM(p.shipmentCode)) shipmentCode FROM business_daily_parse_rows p
 LEFT JOIN qc_tracking_ledger owner ON owner.shipmentCode=UPPER(TRIM(p.shipmentCode))
 WHERE p.businessType='WHPP' AND p.reportDate IN (${marks}) AND TRIM(COALESCE(p.shipmentCode,''))<>'' AND (owner.shipmentCode IS NULL OR owner.businessType='WHPP')
) SELECT v.reportDate,COUNT(*) total,
 SUM(CASE WHEN ${evidenceReadySql('q')} THEN 1 ELSE 0 END) matched,
 SUM(CASE WHEN q.terminalReason='POD' THEN 1 ELSE 0 END) pod,
 SUM(CASE WHEN q.terminalReason='POD' AND q.podDate=v.reportDate THEN 1 ELSE 0 END) sameDayPod,
 SUM(CASE WHEN ${ocSql('q')} THEN 1 ELSE 0 END) ocCurrent
 FROM valid v LEFT JOIN qc_tracking_ledger q ON q.shipmentCode=v.shipmentCode AND q.businessType='WHPP' GROUP BY v.reportDate`).all(...dates);for(const raw of rows){const row=finish({...blank('WHPP',raw.reportDate),...raw,businessType:'WHPP'});out.set(`${row.reportDate}|WHPP`,row);}return out;}
export function readV273DashboardTrends(businessType='ALL',fromDate='',toDate='',db=getDb()){
 const type=String(businessType||'ALL').toUpperCase(),to=dateKey(toDate),from=dateKey(fromDate)||to;if(!TYPES.has(type))throw new Error('业务板块无效');if(!from||!to||from>to)throw new Error('日期范围无效');const key=`${type}|${from}|${to}`,hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return{...hit.value,memoryCacheHit:true};const dates=selectedDates(type,from,to,db),batches=latestBatches(dates,db);
 const scope=UNIFIED_TYPES.includes(type)?[type]:type==='CCSL'?CCSL_TYPES:type==='SHOPEE'?SHOPEE_TYPES:type==='ALL'?UNIFIED_TYPES:[];const unified=unifiedFacts(dates,batches,scope,db),whpp=(type==='WHPP'||type==='ALL')?whppFacts(dates,db):new Map();const pick=(d,t)=>t==='WHPP'?whpp.get(`${d}|WHPP`)||blank('WHPP',d):unified.get(`${d}|${t}`)||blank(t,d);
 const daily=dates.map(d=>{if(UNIFIED_TYPES.includes(type))return pick(d,type);if(type==='WHPP')return pick(d,'WHPP');if(type==='CCSL')return merge('CCSL',d,CCSL_TYPES.map(t=>pick(d,t)));if(type==='SHOPEE')return merge('SHOPEE',d,SHOPEE_TYPES.map(t=>pick(d,t)));return merge('ALL',d,[...UNIFIED_TYPES.map(t=>pick(d,t)),pick(d,'WHPP')]);});
 const value=(r,k)=>r?.ready?n(r[k]):null;const result={ok:true,id:V273_DASHBOARD_TRUTH_ID,businessType:type,fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,ticket:daily.map(r=>n(r.total)),pod:daily.map(r=>value(r,'pod')),podRate:daily.map(r=>value(r,'podRate')),oc:daily.map(r=>value(r,'ocCurrent')),ocRate:daily.map(r=>value(r,'ocRate')),sameDayPod:daily.map(r=>value(r,'sameDayPod')),sameDayPodRate:daily.map(r=>value(r,'sameDayPodRate')),coverageRate:daily.map(r=>r.coverageRate),missingDates:daily.filter(r=>!r.ready).map(r=>r.reportDate),source:'LATEST_VALID_DAILY_MEMBERSHIP_PLUS_V246_LEDGER',definitions:{podRate:'当前已POD/当日日报总票',ocRate:'当前真实OC/当日日报总票',sameDayPodRate:'日报当日完成POD/当日日报总票'}};memory.set(key,{at:Date.now(),value:result});return result;
}
function handler(req,res){try{const data=readV273DashboardTrends(req.query.businessType,req.query.from,req.query.to);res.setHeader('Cache-Control','private,max-age=10');res.setHeader('X-CE-QC-V273',V273_DASHBOARD_TRUTH_ID);res.json(data);}catch(e){res.status(400).json({ok:false,id:V273_DASHBOARD_TRUTH_ID,error:e?.message||String(e)});}}
function register(app){if(registered)return;registered=true;previousGet.call(app,'/api/v273/trends',handler);console.info('[CE-QC][V273_TRENDS]',V273_DASHBOARD_TRUTH_ID,'registered after auth; daily membership + V246 ledger truth, no dashboard cache dependency.');}
express.application.get=function v273Route(pathValue,...handlers){if(!registered&&String(pathValue||'')==='/api/v234/trends')register(this);return previousGet.call(this,pathValue,...handlers);};
