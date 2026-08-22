import express from 'express';
import { getDb } from './db.js';

export const V234_DASHBOARD_LIVE_TRUTH_ID='2026-08-22-v234-instant-dashboard-live-truth-v2';
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
function batchBySnapshot(snapshotId=''){if(!snapshotId)return null;return getDb().prepare(`SELECT b.snapshotId,b.reportDate,COALESCE(s.status,'') AS snapshotStatus FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.snapshotId=? ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(snapshotId)||null;}
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
  const first=firstNumber(m,['firstAttemptRate','firstPodRate','dispatchAttempt1Rate']);const base=firstNumber(m,['total','today','pnh']);
  if(first>0&&base>0){out.__firstWeighted=(out.__firstWeighted||0)+first*base;out.__firstBase=(out.__firstBase||0)+base;}
}
function finish(out){
  out.unresolved=Math.max(0,out.total-out.pod-out.returned-out.cancelled);
  out.podRate=pct(out.pod,out.total);out.returnRate=pct(out.returned,out.total);out.cancelRate=pct(out.cancelled,out.total);out.unresolvedRate=pct(out.unresolved,out.total);
  out.pendingRate=pct(out.pending1,out.total);out.deliveryRate=pct(out.deliveryStay||out.delivery,out.total);out.ocRate=pct(out.oc1,out.total);out.closureRate=pct(out.pod+out.returned+out.cancelled,out.total);
  out.firstRate=out.__firstBase?Number((out.__firstWeighted/out.__firstBase).toFixed(2)):pct(out.attempt1,out.pod||out.total);
  delete out.__firstWeighted;delete out.__firstBase;return out;
}
function cacheRows(reportDate,snapshotId=''){
  const params=[reportDate];let clause='';if(snapshotId){clause=' AND snapshotId=?';params.push(snapshotId);}
  try{return getDb().prepare(`SELECT businessType,regionCode,metricsJson,snapshotId,snapshotStatus,refreshedAt FROM dashboard_daily_cache WHERE reportDate=? ${clause} AND snapshotStatus='COMPLETED' ORDER BY businessType,regionCode`).all(...params);}catch{return[];}
}
function whppSummary(reportDate){
  const out=blank('WHPP',reportDate);let payload={};
  try{const row=getDb().prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);if(row){payload={...payload,...safeJson(row.summaryJson)};if(payload.total===undefined)payload.total=n(row.totalCount);}}catch{}
  try{const row=getDb().prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);if(row)payload={...payload,...safeJson(row.summaryJson)};}catch{}
  addMetric(out,payload);out.ready=out.total>0||Object.keys(payload).length>0;return finish(out);
}
function summarizeRows(type,date,rows=[]){const out=blank(type,date);for(const row of rows){if(String(row.businessType||'').toUpperCase()!==type)continue;addMetric(out,safeJson(row.metricsJson));out.ready=true;out.snapshotId=row.snapshotId||'';out.refreshedAt=row.refreshedAt||'';}return finish(out);}
function currentSummaries(reportDate=''){
  const batch=latestBatch(reportDate);const date=batch?.reportDate||reportDate;const key=`current|${date}|${batch?.snapshotId||''}`;const hit=memory.get(key);if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;
  const rows=cacheRows(date,batch?.snapshotId||'');const business=Object.fromEntries(TYPES.map(type=>[type,summarizeRows(type,date,rows)]));
  const result={ok:true,patchId:V234_DASHBOARD_LIVE_TRUTH_ID,reportDate:date,snapshotId:batch?.snapshotId||'',snapshotStatus:batch?.snapshotStatus||'',business,whpp:whppSummary(date),cacheRowCount:rows.length};memory.set(key,{at:Date.now(),value:result});return result;
}
function trendDates(from,to){const db=getDb();if(from===to)return db.prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate<=? ORDER BY reportDate DESC LIMIT 7`).all(to).map(r=>r.reportDate).sort();return db.prepare(`SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ? ORDER BY reportDate ASC LIMIT 180`).all(from,to).map(r=>r.reportDate);}
function trendPayload(type,from,to){
  const dates=trendDates(from,to),daily=[];
  for(const date of dates){
    if(type==='WHPP'){daily.push(whppSummary(date));continue;}
    const rows=cacheRows(date,'');
    if(type==='ALL'){const out=blank('ALL',date);for(const row of rows){if(TYPES.includes(String(row.businessType||'').toUpperCase())){addMetric(out,safeJson(row.metricsJson));out.ready=true;}}const w=whppSummary(date);if(w.ready){addMetric(out,w);out.ready=true;}daily.push(finish(out));}
    else daily.push(summarizeRows(type,date,rows));
  }
  const v=(x,key)=>x.ready?x[key]:null;
  return{ok:true,patchId:V234_DASHBOARD_LIVE_TRUTH_ID,businessType:type,fromDate:dates[0]||from,toDate:dates.at(-1)||to,dates,daily,ticket:daily.map(x=>v(x,'total')),pod:daily.map(x=>v(x,'pod')),podRate:daily.map(x=>v(x,'podRate')),returned:daily.map(x=>v(x,'returned')),returnRate:daily.map(x=>v(x,'returnRate')),pending1:daily.map(x=>v(x,'pending1')),pendingRate:daily.map(x=>v(x,'pendingRate')),delivering:daily.map(x=>x.ready?(x.deliveryStay||x.delivery):null),deliveringRate:daily.map(x=>v(x,'deliveryRate')),ocRate:daily.map(x=>v(x,'ocRate')),firstRate:daily.map(x=>v(x,'firstRate'))};
}
function stateFromMetric(type,m,batch={}){
  const common={viewBusinessType:type,reportDate:m.reportDate||batch.reportDate||'',snapshotId:m.snapshotId||batch.snapshotId||'',snapshotStatus:m.ready?'COMPLETED':(batch.snapshotStatus||'IMPORTED'),dailyReportReady:Boolean(m.total),total:m.total,pnhBills:[],dailyParseRows:[],finalRows:[],scanResults:[],trackResults:[],trackEvents:[],carryBills:[],nextCarryBills:[],podLocks:[],historySummary:[],dailyParseSummary:{totalRecognized:m.total,pnh:m.total},processing:{running:false,paused:false,phase:m.ready?'处理完成':'状态缓存待完成'},_v234Fast:true};
  if(type.startsWith('SHOPEE')){const group=type==='SHOPEECN'?'CN':'VN';const metrics={...m,dispatchAttempt1:m.attempt1,dispatchAttempt2:m.attempt2,dispatchAttempt3:m.attempt3,dispatchAttempt1Rate:pct(m.attempt1,m.pod||m.total),dispatchAttempt2Rate:pct(m.attempt2,m.pod||m.total),dispatchAttempt3Rate:pct(m.attempt3,m.pod||m.total),firstAttemptRate:m.firstRate};return{...common,businessType:'SHOPEE',dashboard:{businessType:'SHOPEE',reportDate:common.reportDate,metrics,recipientGroups:{ALL:{metrics,regions:{}},[group]:{metrics,regions:{}}},regions:{},routing:{},dashboardRows:[]},detailTabs:{all:{rows:[],total:m.total}}};}
  return{...common,businessType:type,dashboard:{pnh:m.total,totalMonitored:m.total,todayPod:m.pod,podRate:m.podRate,abnormalCount:m.unresolved,categories:{pendingTotal:m.pending1,ocTotal:m.oc1},metrics:{...m},routing:{}},detailTabs:{allData:{rows:[],total:m.total}}};
}
function metricCondition(type,tab){
  const shopee=type.startsWith('SHOPEE'),clean=String(tab||'all').replace(/^(ALL|CN|VN|OTHER)_/,'');
  if(shopee){const m={all:'1=1',pod:'COALESCE(f.isPod,0)=1',returned:"COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%')",unresolved:"COALESCE(f.isPod,0)=0 AND NOT (COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%')",pending1:"COALESCE(CAST(json_extract(f.rawJson,'$.\"Pending次数\"') AS INTEGER),CAST(json_extract(f.rawJson,'$.\"Pending当前次数\"') AS INTEGER),0)>=1",pending2:"COALESCE(CAST(json_extract(f.rawJson,'$.\"Pending次数\"') AS INTEGER),0)>=2",pending3:"COALESCE(CAST(json_extract(f.rawJson,'$.\"Pending次数\"') AS INTEGER),0)>=3",oc1:"COALESCE(CAST(json_extract(f.rawJson,'$.\"OC天数\"') AS INTEGER),0)>=1",oc2:"COALESCE(CAST(json_extract(f.rawJson,'$.\"OC天数\"') AS INTEGER),0)>=2",oc3:"COALESCE(CAST(json_extract(f.rawJson,'$.\"OC天数\"') AS INTEGER),0)>=3",cycle2:"COALESCE(CAST(json_extract(f.rawJson,'$.\"盘点天数\"') AS INTEGER),0)>=2",inboundNoScan:"COALESCE(json_extract(f.rawJson,'$.\"入库无扫描节点\"'),'')='是' OR COALESCE(f.primaryCategory,'') LIKE '%入库无扫描%'",deliveryStay:"COALESCE(CAST(json_extract(f.rawJson,'$.\"派送中停留天数\"') AS INTEGER),0)>0 OR COALESCE(f.primaryCategory,'')='派送中停留'"};return m[clean]||'1=1';}
  const m={allData:'1=1',podClosed:'COALESCE(f.isPod,0)=1',accountingReturned:"COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%')",accountingOpen:"COALESCE(f.isPod,0)=0 AND NOT (COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%')",pendingAll:'COALESCE(f.pendingDays,0)>=1',pending2plus:'COALESCE(f.pendingDays,0)>=2',pending3:'COALESCE(f.pendingDays,0)>=3',ocAll:'COALESCE(f.ocDays,0)>=1',oc2plus:'COALESCE(f.ocDays,0)>=2',oc3:'COALESCE(f.ocDays,0)>=3',cycle2:'COALESCE(f.cycleCountDays,0)>=2',inboundNoScan:"COALESCE(f.primaryCategory,'') LIKE '%入库无扫描%'",workOrderAbnormal:"COALESCE(f.primaryCategory,'') LIKE '%工单%'",provinceOpen:"UPPER(COALESCE(f.regionCode,''))='PV' AND COALESCE(f.isPod,0)=0"};return m[clean]||'1=1';
}
function detailPayload({type,from,to,tab,page,pageSize}){
  const db=getDb(),shopee=type.startsWith('SHOPEE'),condition=metricCondition(type,tab),offset=(page-1)*pageSize;
  const latest=`WITH ranked AS (SELECT reportDate,snapshotId,ROW_NUMBER() OVER(PARTITION BY reportDate ORDER BY createdAt DESC,batchId DESC) rn FROM unified_import_batches WHERE status='VALID' AND reportDate BETWEEN ? AND ?), latest AS (SELECT reportDate,snapshotId FROM ranked WHERE rn=1)`;
  const base=shopee?`${latest},base AS (SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,f.isPod,f.primaryCategory,f.latestEventDesc AS lastEventDesc,f.latestEventTime AS lastEventTime,f.rawJson FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate WHERE u.businessType=?)`:`${latest},base AS (SELECT u.reportDate,u.businessType,u.regionCode,u.shipmentCode,f.isPod,f.primaryCategory,f.pendingDays,f.ocDays,f.cycleCountDays,f.lastEventDesc,f.lastEventTime,f.rawJson FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate WHERE u.businessType=?)`;
  const params=[from,to,type],count=n(db.prepare(`${base} SELECT COUNT(*) AS c FROM base f WHERE ${condition}`).get(...params)?.c);
  const rows=db.prepare(`${base} SELECT * FROM base f WHERE ${condition} ORDER BY reportDate DESC,lastEventTime DESC,shipmentCode LIMIT ? OFFSET ?`).all(...params,pageSize,offset).map(row=>{const raw=safeJson(row.rawJson);return{...raw,shipmentCode:row.shipmentCode,businessType:row.businessType,reportDate:row.reportDate,regionCode:row.regionCode,POD状态:n(row.isPod)===1?'POD':'未POD',当前分类:row.primaryCategory||raw.当前分类||'',最新节点:row.lastEventDesc||raw.最新节点||raw.最后节点||'',最新时间:row.lastEventTime||raw.最新时间||raw.最后节点时间||''};});
  return{ok:true,patchId:V234_DASHBOARD_LIVE_TRUTH_ID,businessType:type,fromDate:from,toDate:to,tab,page,pageSize,total:count,rows};
}
function currentHandler(req,res){try{res.setHeader('Cache-Control','private,max-age=10');res.json(currentSummaries(dateKey(req.query.reportDate)));}catch(error){res.status(500).json({ok:false,error:error.message||String(error)});}}
function businessStateHandler(req,res){try{const type=String(req.params.type||'').toUpperCase();if(!TYPES.includes(type))return res.status(400).json({ok:false,error:'业务板块无效'});const batch=batchBySnapshot(String(req.query.snapshotId||''))||latestBatch(dateKey(req.query.reportDate));const summary=currentSummaries(batch?.reportDate||'');const metric=summary.business[type];res.setHeader('Cache-Control','private,max-age=10');res.json({ok:true,businessType:type,reportDate:summary.reportDate,snapshotId:summary.snapshotId,snapshotStatus:metric?.ready?'COMPLETED':summary.snapshotStatus,state:stateFromMetric(type,metric||blank(type,summary.reportDate),batch||{})});}catch(error){res.status(500).json({ok:false,error:error.message||String(error)});}}
function trendHandler(req,res){try{const type=String(req.query.businessType||'ALL').toUpperCase(),to=dateKey(req.query.to),from=dateKey(req.query.from)||to;if(!TYPE_SET.has(type)||!from||!to||from>to)return res.status(400).json({ok:false,error:'参数无效'});res.setHeader('Cache-Control','private,max-age=20');res.json(trendPayload(type,from,to));}catch(error){res.status(500).json({ok:false,error:error.message||String(error)});}}
function detailHandler(req,res){try{const type=String(req.query.businessType||'').toUpperCase(),to=dateKey(req.query.to),from=dateKey(req.query.from)||to;if(!TYPES.includes(type)||!from||!to)return res.status(400).json({ok:false,error:'参数无效'});const page=Math.max(1,n(req.query.page)||1),pageSize=Math.max(1,Math.min(200,n(req.query.pageSize)||200));res.json(detailPayload({type,from,to,tab:String(req.query.tab||'all'),page,pageSize}));}catch(error){console.error('[CE-QC][V234_DETAIL]',error);res.status(500).json({ok:false,error:error.message||String(error)});}}

const previousUse=express.application.use;let installed=false;
express.application.use=function v234Use(...args){const candidates=args.flat().filter(v=>typeof v==='function');if(!installed&&candidates.some(fn=>fn.name==='serveStatic')){installed=true;this.get('/api/v234/current-summary',currentHandler);this.get('/api/v234/business-state/:type',businessStateHandler);this.get('/api/v234/trends',trendHandler);this.get('/api/v234/metric-detail',detailHandler);console.info('[CE-QC][V234]',V234_DASHBOARD_LIVE_TRUTH_ID,'routes installed after auth middleware');}return previousUse.apply(this,args);};

const originalSend=express.response.send;
express.response.send=function v234Inject(body){if(typeof body==='string'&&body.includes('</body>')&&body.includes('CE Express')){const chart='/dashboard-chart-v18.js?v=20260822-v234-2',client='/v234-dashboard-live.js?v=20260822-v234-2';const tags=[];if(!body.includes(chart))tags.push(`  <script src="${chart}"></script>`);if(!body.includes(client))tags.push(`  <script src="${client}"></script>`);if(tags.length)body=body.replace('</body>',`${tags.join('\n')}\n</body>`);this.setHeader?.('X-CE-QC-V234',V234_DASHBOARD_LIVE_TRUTH_ID);}return originalSend.call(this,body);};
