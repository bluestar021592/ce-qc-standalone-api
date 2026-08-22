import express from 'express';
import { getDb } from './db.js';

export const V234_DASHBOARD_LIVE_TRUTH_ID='2026-08-22-v234-instant-dashboard-live-truth-v1';
const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const TYPE_SET=new Set([...TYPES,'WHPP','ALL']);
const CACHE_MS=15_000;
const memory=new Map();
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const pct=(value,total)=>total?Number((n(value)*100/n(total)).toFixed(2)):0;
const dateKey=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||'').slice(0,10))?String(value).slice(0,10):'';
function safeJson(value){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||'{}'))||{});}catch{return{};}}
function firstNumber(obj,keys){for(const key of keys){if(obj&&obj[key]!==undefined&&obj[key]!==null&&Number.isFinite(Number(obj[key])))return Number(obj[key]);}return 0;}
function latestBatch(reportDate=''){
  const db=getDb();
  if(reportDate)return db.prepare(`SELECT b.snapshotId,b.reportDate,COALESCE(s.status,'') AS snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' AND b.reportDate=? ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(reportDate)||null;
  return db.prepare(`SELECT b.snapshotId,b.reportDate,COALESCE(s.status,'') AS snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' ORDER BY b.reportDate DESC,b.createdAt DESC,b.batchId DESC LIMIT 1`).get()||null;
}
function blank(type,date=''){return{businessType:type,reportDate:date,total:0,pod:0,returned:0,cancelled:0,unresolved:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,delivery:0,deliveryStay:0,provinceOpen:0,attempt1:0,attempt2:0,attempt3:0,firstRate:0,ready:false};}
function addMetric(out,m={}){
  out.total+=firstNumber(m,['total','today','pnh','todayPnh','totalMonitored']);
  out.pod+=firstNumber(m,['pod','todayPod','scanPod','signed']);
  out.returned+=firstNumber(m,['returned','returnCount','returnedCount']);
  out.cancelled+=firstNumber(m,['cancelled','cancelCount']);
  out.pending1+=firstNumber(m,['pending1','pending','pendingTotal']);
  out.pending2+=firstNumber(m,['pending2']);
  out.pending3+=firstNumber(m,['pending3','pending3plus']);
  out.pendingNonContinuous+=firstNumber(m,['pendingNonContinuous','pendingGap']);
  out.oc1+=firstNumber(m,['oc1']);out.oc2+=firstNumber(m,['oc2']);out.oc3+=firstNumber(m,['oc3','oc3plus']);
  out.cycle2+=firstNumber(m,['cycle2','cycle2plus']);
  out.inboundNoScan+=firstNumber(m,['inboundNoScan']);
  out.delivery+=firstNumber(m,['delivery1','delivery','delivering']);
  out.deliveryStay+=firstNumber(m,['deliveryStay','delivery1','delivering']);
  out.provinceOpen+=firstNumber(m,['provinceOpen','pvOpen']);
  out.attempt1+=firstNumber(m,['attempt1','dispatchAttempt1']);
  out.attempt2+=firstNumber(m,['attempt2','dispatchAttempt2']);
  out.attempt3+=firstNumber(m,['attempt3','dispatchAttempt3']);
  const first=firstNumber(m,['firstAttemptRate','firstPodRate','dispatchAttempt1Rate']);
  if(first>0){out.__firstWeighted=(out.__firstWeighted||0)+first*Math.max(1,firstNumber(m,['total','today','pnh']));out.__firstBase=(out.__firstBase||0)+Math.max(1,firstNumber(m,['total','today','pnh']));}
}
function finish(out){
  out.unresolved=Math.max(0,out.total-out.pod-out.returned-out.cancelled);
  out.podRate=pct(out.pod,out.total);out.returnRate=pct(out.returned,out.total);out.cancelRate=pct(out.cancelled,out.total);
  out.unresolvedRate=pct(out.unresolved,out.total);out.pendingRate=pct(out.pending1,out.total);out.deliveryRate=pct(out.deliveryStay||out.delivery,out.total);out.ocRate=pct(out.oc1,out.total);
  out.closureRate=pct(out.pod+out.returned+out.cancelled,out.total);
  out.firstRate=out.__firstBase?Number((out.__firstWeighted/out.__firstBase).toFixed(2)):pct(out.attempt1,out.pod||out.total);
  delete out.__firstWeighted;delete out.__firstBase;return out;
}
function cacheRows(reportDate,snapshotId=''){
  const db=getDb();
  const params=[reportDate];let clause='';
  if(snapshotId){clause=' AND snapshotId=?';params.push(snapshotId);}
  try{return db.prepare(`SELECT businessType,regionCode,metricsJson,snapshotId,snapshotStatus,refreshedAt FROM dashboard_daily_cache WHERE reportDate=? ${clause} AND snapshotStatus='COMPLETED' ORDER BY businessType,regionCode`).all(...params);}catch{return[];}
}
function whppSummary(reportDate){
  const out=blank('WHPP',reportDate);let payload={};
  try{const row=getDb().prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);if(row){payload={...payload,...safeJson(row.summaryJson)};if(payload.total===undefined)payload.total=n(row.totalCount);}}catch{}
  try{const row=getDb().prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);if(row)payload={...payload,...safeJson(row.summaryJson)};}catch{}
  addMetric(out,payload);out.ready=out.total>0||Object.keys(payload).length>0;return finish(out);
}
function currentSummaries(reportDate=''){
  const batch=latestBatch(reportDate);const date=batch?.reportDate||reportDate;const key=`current|${date}|${batch?.snapshotId||''}`;const hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;
  const rows=cacheRows(date,batch?.snapshotId||'');const byType=Object.fromEntries(TYPES.map(type=>[type,blank(type,date)]));
  for(const row of rows){const type=String(row.businessType||'').toUpperCase();if(!byType[type])continue;addMetric(byType[type],safeJson(row.metricsJson));byType[type].ready=true;byType[type].snapshotId=row.snapshotId||batch?.snapshotId||'';byType[type].refreshedAt=row.refreshedAt||'';}
  for(const type of TYPES)finish(byType[type]);
  const result={ok:true,patchId:V234_DASHBOARD_LIVE_TRUTH_ID,reportDate:date,snapshotId:batch?.snapshotId||'',snapshotStatus:batch?.snapshotStatus||'',business:byType,whpp:whppSummary(date),cacheRowCount:rows.length};memory.set(key,{at:Date.now(),value:result});return result;
}
function trendDates(from,to){
  const db=getDb();if(from===to)return db.prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? ORDER BY reportDate DESC LIMIT 7`).all(to).map(r=>r.reportDate).sort();
  return db.prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC LIMIT 180`).all(from,to).map(r=>r.reportDate);
}
function trendPayload(type,from,to){
  const dates=trendDates(from,to);const daily=[];
  for(const date of dates){
    if(type==='WHPP'){daily.push(whppSummary(date));continue;}
    const batch=latestBatch(date);const rows=cacheRows(date,batch?.snapshotId||'');const wanted=type==='ALL'?TYPES:[type];const out=blank(type,date);
    for(const row of rows){if(!wanted.includes(String(row.businessType||'').toUpperCase()))continue;addMetric(out,safeJson(row.metricsJson));out.ready=true;}
    if(type==='ALL'){const w=whppSummary(date);if(w.ready){addMetric(out,w);out.ready=true;}}
    daily.push(finish(out));
  }
  return{ok:true,patchId:V234_DASHBOARD_LIVE_TRUTH_ID,businessType:type,fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,ticket:daily.map(x=>x.total),pod:daily.map(x=>x.pod),podRate:daily.map(x=>x.podRate),returned:daily.map(x=>x.returned),returnRate:daily.map(x=>x.returnRate),pending1:daily.map(x=>x.pending1),pendingRate:daily.map(x=>x.pendingRate),delivering:daily.map(x=>x.deliveryStay||x.delivery),deliveringRate:daily.map(x=>x.deliveryRate),ocRate:daily.map(x=>x.ocRate),firstRate:daily.map(x=>x.firstRate)};
}
function metricCondition(type,tab){
  const shopee=type.startsWith('SHOPEE');
  const clean=String(tab||'all').replace(/^(ALL|CN|VN|OTHER)_/,'');
  if(shopee){const m={all:'1=1',pod:'COALESCE(f.isPod,0)=1',returned:"COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%')",unresolved:"COALESCE(f.isPod,0)=0 AND NOT (COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%')",pending1:"COALESCE(CAST(json_extract(f.rawJson,'$.\"Pending次数\"') AS INTEGER),CAST(json_extract(f.rawJson,'$.\"Pending当前次数\"') AS INTEGER),0)>=1",pending2:"COALESCE(CAST(json_extract(f.rawJson,'$.\"Pending次数\"') AS INTEGER),0)>=2",pending3:"COALESCE(CAST(json_extract(f.rawJson,'$.\"Pending次数\"') AS INTEGER),0)>=3",oc1:"COALESCE(CAST(json_extract(f.rawJson,'$.\"OC天数\"') AS INTEGER),0)>=1",oc2:"COALESCE(CAST(json_extract(f.rawJson,'$.\"OC天数\"') AS INTEGER),0)>=2",oc3:"COALESCE(CAST(json_extract(f.rawJson,'$.\"OC天数\"') AS INTEGER),0)>=3",cycle2:"COALESCE(CAST(json_extract(f.rawJson,'$.\"盘点天数\"') AS INTEGER),0)>=2",inboundNoScan:"COALESCE(json_extract(f.rawJson,'$.\"入库无扫描节点\"'),'')='是' OR COALESCE(f.primaryCategory,'') LIKE '%入库无扫描%'",deliveryStay:"COALESCE(CAST(json_extract(f.rawJson,'$.\"派送中停留天数\"') AS INTEGER),0)>0 OR COALESCE(f.primaryCategory,'')='派送中停留'"};return m[clean]||'1=1';}
  const m={allData:'1=1',podClosed:'COALESCE(f.isPod,0)=1',accountingReturned:"COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%')",accountingOpen:"COALESCE(f.isPod,0)=0 AND NOT (COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%')",pendingAll:'COALESCE(f.pendingDays,0)>=1',pending2plus:'COALESCE(f.pendingDays,0)>=2',pending3:'COALESCE(f.pendingDays,0)>=3',ocAll:'COALESCE(f.ocDays,0)>=1',oc2plus:'COALESCE(f.ocDays,0)>=2',oc3:'COALESCE(f.ocDays,0)>=3',cycle2:'COALESCE(f.cycleCountDays,0)>=2',inboundNoScan:"COALESCE(f.primaryCategory,'') LIKE '%入库无扫描%'",workOrderAbnormal:"COALESCE(f.primaryCategory,'') LIKE '%工单%'",provinceOpen:"UPPER(COALESCE(u.regionCode,''))='PV' AND COALESCE(f.isPod,0)=0"};return m[clean]||'1=1';
}
function detailPayload({type,from,to,tab,page,pageSize}){
  const db=getDb();const shopee=type.startsWith('SHOPEE');const condition=metricCondition(type,tab);const offset=(page-1)*pageSize;
  const latest=`WITH ranked AS (SELECT reportDate,snapshotId,ROW_NUMBER() OVER(PARTITION BY reportDate ORDER BY createdAt DESC,batchId DESC) rn FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ?), latest AS (SELECT reportDate,snapshotId FROM ranked WHERE rn=1)`;
  const base=shopee?`${latest},base AS (SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,f.isPod,f.primaryCategory,f.latestEventDesc AS lastEventDesc,f.latestEventTime AS lastEventTime,f.rawJson FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate WHERE u.businessType=?)`:`${latest},base AS (SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,f.isPod,f.primaryCategory,f.pendingDays,f.ocDays,f.cycleCountDays,f.lastEventDesc,f.lastEventTime,f.rawJson FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate WHERE u.businessType=?)`;
  const params=[from,to,type];const count=n(db.prepare(`${base} SELECT COUNT(*) AS c FROM base f JOIN (SELECT 1) z ON 1=1 WHERE ${condition.replace(/u\./g,'f.').replace(/f\.regionCode/g,'f.regionCode')}`).get(...params)?.c);
  const rows=db.prepare(`${base} SELECT * FROM base f WHERE ${condition.replace(/u\./g,'f.')} ORDER BY reportDate DESC,lastEventTime DESC,shipmentCode LIMIT ? OFFSET ?`).all(...params,pageSize,offset).map(row=>{const raw=safeJson(row.rawJson);return{...raw,shipmentCode:row.shipmentCode,businessType:row.businessType,reportDate:row.reportDate,regionCode:row.regionCode,POD状态:n(row.isPod)===1?'POD':'未POD',当前分类:row.primaryCategory||raw.当前分类||'',最新节点:row.lastEventDesc||raw.最新节点||raw.最后节点||'',最新时间:row.lastEventTime||raw.最新时间||raw.最后节点时间||''};});
  return{ok:true,patchId:V234_DASHBOARD_LIVE_TRUTH_ID,businessType:type,fromDate:from,toDate:to,tab,page,pageSize,total:count,rows};
}
function currentHandler(req,res){try{const date=dateKey(req.query.reportDate);res.setHeader('Cache-Control','private,max-age=10');res.json(currentSummaries(date));}catch(error){res.status(500).json({ok:false,error:error.message||String(error)});}}
function trendHandler(req,res){try{const type=String(req.query.businessType||'ALL').toUpperCase();const to=dateKey(req.query.to),from=dateKey(req.query.from)||to;if(!TYPE_SET.has(type)||!from||!to||from>to)return res.status(400).json({ok:false,error:'参数无效'});res.setHeader('Cache-Control','private,max-age=20');res.json(trendPayload(type,from,to));}catch(error){res.status(500).json({ok:false,error:error.message||String(error)});}}
function detailHandler(req,res){try{const type=String(req.query.businessType||'').toUpperCase();const to=dateKey(req.query.to),from=dateKey(req.query.from)||to;if(!TYPES.includes(type)||!from||!to)return res.status(400).json({ok:false,error:'参数无效'});const page=Math.max(1,n(req.query.page)||1),pageSize=Math.max(1,Math.min(200,n(req.query.pageSize)||200));res.json(detailPayload({type,from,to,tab:String(req.query.tab||'all'),page,pageSize}));}catch(error){console.error('[CE-QC][V234_DETAIL]',error);res.status(500).json({ok:false,error:error.message||String(error)});}}

const previousUse=express.application.use;let installed=false;
express.application.use=function v234Use(...args){if(!installed){installed=true;this.get('/api/v234/current-summary',currentHandler);this.get('/api/v234/trends',trendHandler);this.get('/api/v234/metric-detail',detailHandler);console.info('[CE-QC][V234]',V234_DASHBOARD_LIVE_TRUTH_ID,'routes installed');}return previousUse.apply(this,args);};

const originalSend=express.response.send;
express.response.send=function v234Inject(body){if(typeof body==='string'&&body.includes('</body>')&&body.includes('CE Express')){if(!body.includes('/v234-dashboard-live.js?v=20260822-v234-1'))body=body.replace('</body>','  <script src="/v234-dashboard-live.js?v=20260822-v234-1"></script>\n</body>');this.setHeader?.('X-CE-QC-V234',V234_DASHBOARD_LIVE_TRUTH_ID);}return originalSend.call(this,body);};
