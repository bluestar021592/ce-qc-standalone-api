import express from 'express';
import { getDb } from './db.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';

export const V253_DASHBOARD_FAST_PATH_ID='2026-08-23-v253-cache-independent-dashboard-fastpath-v3';
const TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP','CCSL','SHOPEE','ALL']);
const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];
const memory=new Map();
const CACHE_MS=30_000;
const previousGet=express.application.get;
let registered=false;

const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
const dateKey=value=>{const s=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,ocCurrent:0,sameDayPod:0,podRate:0,ocRate:0,sameDayPodRate:0,ready:false,matched:0};}
function finish(row){row.total=n(row.total);row.pod=n(row.pod);row.ocCurrent=n(row.ocCurrent);row.sameDayPod=n(row.sameDayPod);row.matched=n(row.matched);row.podRate=pct(row.pod,row.total);row.ocRate=pct(row.ocCurrent,row.total);row.sameDayPodRate=pct(row.sameDayPod,row.total);row.ready=row.total===0?true:row.matched>=row.total;return row;}
function merge(type,date,rows=[]){const out=blank(type,date);const valid=rows.filter(Boolean);for(const row of valid){out.total+=n(row.total);out.pod+=n(row.pod);out.ocCurrent+=n(row.ocCurrent);out.sameDayPod+=n(row.sameDayPod);out.matched+=n(row.matched);}out.ready=valid.length>0&&valid.every(row=>row.ready);out.podRate=pct(out.pod,out.total);out.ocRate=pct(out.ocCurrent,out.total);out.sameDayPodRate=pct(out.sameDayPod,out.total);return out;}

function selectedDates(type,from,to,db=getDb()){
  const single=from===to;
  const includeWhpp=['WHPP','ALL'].includes(type);
  const sql=includeWhpp?`SELECT reportDate FROM (SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' ${single?'AND reportDate<=?':'AND reportDate BETWEEN ? AND ?'} UNION SELECT DISTINCT reportDate FROM business_daily_reports WHERE businessType='WHPP' ${single?'AND reportDate<=?':'AND reportDate BETWEEN ? AND ?'}) ORDER BY reportDate ${single?'DESC':'ASC'} LIMIT ${single?'7':'180'}`:`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' ${single?'AND reportDate<=?':'AND reportDate BETWEEN ? AND ?'} ORDER BY reportDate ${single?'DESC':'ASC'} LIMIT ${single?'7':'180'}`;
  let rows;
  if(includeWhpp)rows=single?db.prepare(sql).all(to,to):db.prepare(sql).all(from,to,from,to);
  else rows=single?db.prepare(sql).all(to):db.prepare(sql).all(from,to);
  const dates=rows.map(r=>String(r.reportDate||'')).filter(Boolean);return single?dates.sort():dates;
}
function latestBatches(dates,db=getDb()){
  if(!dates.length)return new Map();const marks=dates.map(()=>'?').join(',');
  const rows=db.prepare(`WITH ranked AS (SELECT reportDate,snapshotId,createdAt,batchId,ROW_NUMBER() OVER(PARTITION BY reportDate ORDER BY createdAt DESC,batchId DESC) rn FROM unified_import_batches WHERE status='VALID' AND reportDate IN (${marks})) SELECT reportDate,snapshotId FROM ranked WHERE rn=1`).all(...dates);
  return new Map(rows.map(r=>[String(r.reportDate||''),String(r.snapshotId||'')]));
}
function valuesCte(dates,batches){const pairs=dates.map(d=>[d,batches.get(d)||'']).filter(([,s])=>s);if(!pairs.length)return null;return{sql:pairs.map(()=>'(?,?)').join(','),params:pairs.flat()};}

function ccslFallback(dates,batches,db=getDb()){
  const cte=valuesCte(dates,batches);const out=new Map();if(!cte)return out;
  const rows=db.prepare(`WITH latest(reportDate,snapshotId) AS (VALUES ${cte.sql}), valid AS (
    SELECT l.reportDate,u.businessType,u.shipmentCode FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688')
  ), facts AS (
    SELECT v.reportDate,v.businessType,v.shipmentCode,f.shipmentCode AS matchedBill,COALESCE(f.isPod,0) isPod,COALESCE(f.ocDays,0) ocDays,COALESCE(f.primaryCategory,f.category,'') category,COALESCE(f.rawJson,'{}') rawJson,
      REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(f.lastEventTime,''),''),1,10),'/','-') podDate
    FROM valid v LEFT JOIN final_rows f ON f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
  ) SELECT reportDate,businessType,COUNT(*) total,COUNT(matchedBill) matched,SUM(isPod) pod,
    SUM(CASE WHEN isPod=1 AND podDate=reportDate THEN 1 ELSE 0 END) sameDayPod,
    SUM(CASE WHEN isPod=0 AND (ocDays>=1 OR UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%' OR UPPER(COALESCE(json_extract(rawJson,'$."当前状态"'),''))='OC' OR UPPER(COALESCE(json_extract(rawJson,'$."状态标识"'),''))='OC') THEN 1 ELSE 0 END) ocCurrent
    FROM facts GROUP BY reportDate,businessType`).all(...cte.params);
  for(const raw of rows){const row=finish({...blank(raw.businessType,raw.reportDate),...raw});out.set(`${row.reportDate}|${row.businessType}`,row);}return out;
}

function shopeeFallback(dates,batches,db=getDb()){
  ensureV246TrackingSchema(db);const cte=valuesCte(dates,batches);const out=new Map();if(!cte)return out;
  const rows=db.prepare(`WITH latest(reportDate,snapshotId) AS (VALUES ${cte.sql}), valid AS (
    SELECT l.reportDate,u.businessType,u.shipmentCode FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate WHERE u.businessType IN ('SHOPEECN','SHOPEEVN')
  ), facts AS (
    SELECT v.reportDate,v.businessType,v.shipmentCode,l.shipmentCode ledgerBill,f.shipmentCode finalBill,
      CASE WHEN l.terminalReason='POD' THEN 1 ELSE COALESCE(f.isPod,0) END isPod,
      COALESCE(NULLIF(l.podDate,''),REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(f.latestEventTime,''),''),1,10),'/','-')) podDate,
      CASE WHEN l.trackingStatus='OPEN' AND (UPPER(TRIM(COALESCE(l.currentState,'')))='OC' OR UPPER(TRIM(COALESCE(l.currentCategory,'')))='OC' OR UPPER(TRIM(COALESCE(l.currentCategory,''))) LIKE 'OC%' OR COALESCE(l.currentCategory,'') LIKE '%OC滞留%' OR UPPER(COALESCE(json_extract(l.currentStateJson,'$."当前状态"'),''))='OC' OR UPPER(COALESCE(json_extract(l.currentStateJson,'$."状态标识"'),''))='OC') THEN 1
        WHEN (l.shipmentCode IS NULL OR l.trackingStatus='OPEN') AND COALESCE(f.isPod,0)=0 AND (UPPER(TRIM(COALESCE(f.primaryCategory,'')))='OC' OR UPPER(TRIM(COALESCE(f.primaryCategory,''))) LIKE 'OC%' OR COALESCE(f.primaryCategory,'') LIKE '%OC滞留%' OR UPPER(COALESCE(json_extract(f.rawJson,'$."当前状态"'),''))='OC') THEN 1 ELSE 0 END isOc
    FROM valid v LEFT JOIN qc_tracking_ledger l ON l.shipmentCode=v.shipmentCode AND l.businessType=v.businessType LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
  ) SELECT reportDate,businessType,COUNT(*) total,SUM(CASE WHEN ledgerBill IS NOT NULL OR finalBill IS NOT NULL THEN 1 ELSE 0 END) matched,SUM(isPod) pod,SUM(isOc) ocCurrent,SUM(CASE WHEN isPod=1 AND podDate=reportDate THEN 1 ELSE 0 END) sameDayPod FROM facts GROUP BY reportDate,businessType`).all(...cte.params);
  for(const raw of rows){const row=finish({...blank(raw.businessType,raw.reportDate),...raw});out.set(`${row.reportDate}|${row.businessType}`,row);}return out;
}

function whppFallback(dates,batches,db=getDb()){
  const out=new Map();if(!dates.length)return out;const marks=dates.map(()=>'?').join(',');const batchRows=dates.map(d=>[d,batches.get(d)||'']);const batchCase=`CASE p.reportDate ${batchRows.map(()=>`WHEN ? THEN ?`).join(' ')} ELSE '' END`;
  const rows=db.prepare(`WITH valid AS (
    SELECT DISTINCT p.reportDate,UPPER(TRIM(p.shipmentCode)) shipmentCode FROM business_daily_parse_rows p
    WHERE p.businessType='WHPP' AND p.reportDate IN (${marks}) AND TRIM(COALESCE(p.shipmentCode,''))<>''
      AND NOT EXISTS (SELECT 1 FROM unified_import_rows u WHERE u.snapshotId=(${batchCase}) AND u.businessType='CEAF' AND u.shipmentCode=UPPER(TRIM(p.shipmentCode)))
  ), facts AS (
    SELECT v.reportDate,v.shipmentCode,f.shipmentCode matchedBill,COALESCE(f.isPod,0) isPod,COALESCE(f.primaryCategory,'') category,COALESCE(f.rawJson,'{}') rawJson,
      REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(f.latestEventTime,''),''),1,10),'/','-') podDate
    FROM valid v LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
  ) SELECT reportDate,COUNT(*) total,COUNT(matchedBill) matched,SUM(isPod) pod,SUM(CASE WHEN isPod=1 AND podDate=reportDate THEN 1 ELSE 0 END) sameDayPod,
    SUM(CASE WHEN isPod=0 AND (UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%' OR UPPER(COALESCE(json_extract(rawJson,'$."当前状态"'),''))='OC' OR UPPER(COALESCE(json_extract(rawJson,'$."状态标识"'),''))='OC') THEN 1 ELSE 0 END) ocCurrent FROM facts GROUP BY reportDate`).all(...dates,...batchRows.flat());
  for(const raw of rows){const row=finish({...blank('WHPP',raw.reportDate),...raw,businessType:'WHPP'});out.set(`${row.reportDate}|WHPP`,row);}return out;
}

export function readV253DashboardTrends(businessType='ALL',fromDate='',toDate=''){
  const type=String(businessType||'ALL').toUpperCase(),to=dateKey(toDate),from=dateKey(fromDate)||to;if(!TYPES.has(type))throw new Error('业务板块无效');if(!from||!to||from>to)throw new Error('日期范围无效');const key=`T|${type}|${from}|${to}`,hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return{...hit.value,memoryCacheHit:true};
  const db=getDb(),dates=selectedDates(type,from,to,db),batches=latestBatches(dates,db);
  const needCcsl=CCSL_TYPES.includes(type)||type==='CCSL'||type==='ALL';const needShopee=SHOPEE_TYPES.includes(type)||type==='SHOPEE'||type==='ALL';const needWhpp=type==='WHPP'||type==='ALL';
  const ccsl=needCcsl?ccslFallback(dates,batches,db):new Map(),shopee=needShopee?shopeeFallback(dates,batches,db):new Map(),whpp=needWhpp?whppFallback(dates,batches,db):new Map();
  const pick=(date,t)=>t==='WHPP'?whpp.get(`${date}|WHPP`)||blank('WHPP',date):CCSL_TYPES.includes(t)?ccsl.get(`${date}|${t}`)||blank(t,date):SHOPEE_TYPES.includes(t)?shopee.get(`${date}|${t}`)||blank(t,date):null;
  const daily=dates.map(date=>{if(CCSL_TYPES.includes(type)||SHOPEE_TYPES.includes(type)||type==='WHPP')return pick(date,type);if(type==='CCSL')return merge('CCSL',date,CCSL_TYPES.map(t=>pick(date,t)));if(type==='SHOPEE')return merge('SHOPEE',date,SHOPEE_TYPES.map(t=>pick(date,t)));return merge('ALL',date,[...CCSL_TYPES.map(t=>pick(date,t)),...SHOPEE_TYPES.map(t=>pick(date,t)),pick(date,'WHPP')]);});
  const value=(row,key)=>row?.ready?n(row[key]):null;const result={ok:true,readId:V253_DASHBOARD_FAST_PATH_ID,businessType:type,requestedFromDate:from,requestedToDate:to,fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,ticket:daily.map(r=>value(r,'total')),pod:daily.map(r=>value(r,'pod')),podRate:daily.map(r=>value(r,'podRate')),oc:daily.map(r=>value(r,'ocCurrent')),ocRate:daily.map(r=>value(r,'ocRate')),sameDayPod:daily.map(r=>value(r,'sameDayPod')),sameDayPodRate:daily.map(r=>value(r,'sameDayPodRate')),missingDates:daily.filter(r=>!r.ready).map(r=>r.reportDate),source:'V253_BULK_NORMALIZED_READ_NO_DASHBOARD_CACHE',definitions:{podRate:'POD/当日总票',ocRate:'当前真实OC/当日总票',sameDayPodRate:'首日报当日完成POD/当日总票'}};memory.set(key,{at:Date.now(),value:result});return result;
}

function latestBatchForDate(date,db=getDb()){return db.prepare("SELECT snapshotId,reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(date)||null;}
export function readV253ShopeeRegion(type,date){
  const businessType=String(type||'').toUpperCase(),reportDate=dateKey(date);if(!SHOPEE_TYPES.includes(businessType)||!reportDate)throw new Error('Shopee区域参数无效');const key=`R|${businessType}|${reportDate}`,hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;const db=getDb();ensureV246TrackingSchema(db);const batch=latestBatchForDate(reportDate,db);if(!batch)return{ok:true,businessType,dates:[reportDate],daily:[{reportDate,regions:{}}]};
  const rows=db.prepare(`SELECT CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP' WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV' ELSE 'UNKNOWN' END regionCode,COUNT(*) total,SUM(CASE WHEN l.terminalReason='POD' THEN 1 ELSE 0 END) pod,SUM(CASE WHEN l.terminalReason='POD' AND l.attemptNo=1 THEN 1 ELSE 0 END) attempt1,SUM(CASE WHEN l.terminalReason='POD' AND l.attemptNo=2 THEN 1 ELSE 0 END) attempt2,SUM(CASE WHEN l.terminalReason='POD' AND l.attemptNo>=3 THEN 1 ELSE 0 END) attempt3 FROM qc_tracking_ledger l LEFT JOIN unified_import_rows u ON u.snapshotId=? AND u.businessType=? AND u.shipmentCode=l.shipmentCode WHERE l.businessType=? AND l.firstReportDate=? GROUP BY regionCode`).all(batch.snapshotId,businessType,businessType,reportDate);
  const regions={};for(const raw of rows){const total=n(raw.total),pod=n(raw.pod),a1=n(raw.attempt1),a2=n(raw.attempt2),a3=n(raw.attempt3),known=a1+a2+a3;regions[String(raw.regionCode||'UNKNOWN').toUpperCase()]={total,pod,attempt1:a1,attempt2:a2,attempt3:a3,attemptUnknown:Math.max(0,pod-known),attemptCoverageRate:pod?pct(known,pod):null,attempt1Rate:pod&&known?pct(a1,pod):null,attempt2Rate:pod&&known?pct(a2,pod):null,attempt3Rate:pod&&known?pct(a3,pod):null};}
  const result={ok:true,readId:V253_DASHBOARD_FAST_PATH_ID,businessType,fromDate:reportDate,toDate:reportDate,dates:[reportDate],daily:[{reportDate,regions,ledgerReady:true}],regionsIncluded:true,exact:true};memory.set(key,{at:Date.now(),value:result});return result;
}

export function readV253InstantSummary(requestedDate=''){
  const db=getDb(),date=dateKey(requestedDate);const batch=date?latestBatchForDate(date,db):db.prepare("SELECT snapshotId,reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC,batchId DESC LIMIT 1").get()||null;if(!batch)return{ok:true,patchId:V253_DASHBOARD_FAST_PATH_ID,reportDate:'',counts:{},total:0,shopeeWhpp:{}};const key=`I|${batch.snapshotId}|${batch.reportDate}`,hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return{...hit.value,cacheHit:true};
  const counts=Object.fromEntries(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].map(t=>[t,0]));for(const row of db.prepare('SELECT businessType,COUNT(*) c FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType').all(batch.snapshotId)){if(Object.hasOwn(counts,row.businessType))counts[row.businessType]=n(row.c);}const raw=n(db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(batch.reportDate)?.totalCount)||n(db.prepare("SELECT COUNT(DISTINCT shipmentCode) c FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(batch.reportDate)?.c);const overlap=n(db.prepare(`SELECT COUNT(DISTINCT u.shipmentCode) c FROM unified_import_rows u WHERE u.snapshotId=? AND u.businessType='CEAF' AND EXISTS(SELECT 1 FROM business_daily_parse_rows p WHERE p.businessType='WHPP' AND p.reportDate=? AND p.shipmentCode=u.shipmentCode)`).get(batch.snapshotId,batch.reportDate)?.c);counts.WHPP=Math.max(0,raw-overlap);const total=Object.values(counts).reduce((s,v)=>s+n(v),0);const result={ok:true,patchId:V253_DASHBOARD_FAST_PATH_ID,reportDate:batch.reportDate,snapshotId:batch.snapshotId,counts,total,shopeeWhpp:{},sourceCorrection:{removedFromWhpp:overlap,reason:'V253 drives overlap lookup from the small indexed CEAF slice; no WHPP-wide anti-join on first paint.'},generatedAt:new Date().toISOString(),cacheHit:false};memory.set(key,{at:Date.now(),value:result});return result;
}

function register(app){if(registered)return;registered=true;previousGet.call(app,'/api/v253/trends',(req,res)=>{try{const data=readV253DashboardTrends(req.query.businessType,req.query.from,req.query.to);res.setHeader('Cache-Control','private,max-age=15');res.setHeader('X-CE-QC-V253',V253_DASHBOARD_FAST_PATH_ID);res.json(data);}catch(error){res.status(500).json({ok:false,error:error?.message||String(error),readId:V253_DASHBOARD_FAST_PATH_ID});}});previousGet.call(app,'/api/v253/instant-dashboard',(req,res)=>{try{const data=readV253InstantSummary(req.query.date||req.query.reportDate||'');res.setHeader('Cache-Control','private,max-age=30');res.setHeader('X-CE-QC-V253',V253_DASHBOARD_FAST_PATH_ID);res.json(data);}catch(error){res.status(500).json({ok:false,error:error?.message||String(error),readId:V253_DASHBOARD_FAST_PATH_ID});}});previousGet.call(app,'/api/v253/shopee-region',(req,res)=>{try{const data=readV253ShopeeRegion(req.query.businessType,req.query.date||req.query.to);res.setHeader('Cache-Control','private,max-age=30');res.setHeader('X-CE-QC-V253',V253_DASHBOARD_FAST_PATH_ID);res.json(data);}catch(error){res.status(500).json({ok:false,error:error?.message||String(error),readId:V253_DASHBOARD_FAST_PATH_ID});}});console.info('[CE-QC][V253]',V253_DASHBOARD_FAST_PATH_ID,'registered cache-independent trend, instant-summary and indexed exact-region endpoints after auth middleware');}
express.application.get=function v253DashboardFastPathGet(pathValue,...handlers){const path=String(pathValue||'');if(!registered&&path==='/api/v234/trends')register(this);return previousGet.call(this,pathValue,...handlers);};
