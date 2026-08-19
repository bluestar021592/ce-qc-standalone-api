import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';

export const V208_SHOPEE_EVIDENCE_VERSION='2026-08-19-v208-shopee-full-trajectory-evidence-v1';
const TYPES=['SHOPEECN','SHOPEEVN'];
const BATCH_SIZE=Math.max(50,Math.min(300,Number(process.env.V208_SHOPEE_TRACK_BATCH||200)));
const MAX_PER_RUN=Math.max(BATCH_SIZE,Math.min(20000,Number(process.env.V208_SHOPEE_TRACK_MAX_PER_RUN||6000)));
const INTERVAL_MS=Math.max(30*60_000,Number(process.env.V208_SHOPEE_TRACK_INTERVAL_MS||2*60*60_000));
const STARTUP_DELAY_MS=Math.max(45_000,Number(process.env.V208_SHOPEE_TRACK_STARTUP_DELAY_MS||120_000));
const OPEN_REFRESH_MS=Math.max(30*60_000,Number(process.env.V208_SHOPEE_OPEN_REFRESH_MS||2*60*60_000));
const INCOMPLETE_REFRESH_MS=Math.max(2*60*60_000,Number(process.env.V208_SHOPEE_INCOMPLETE_REFRESH_MS||12*60*60_000));
let timer=null,startupTimer=null,workerChild=null,kickTimer=null,inFlight=false;

function billOf(value=''){return String(value||'').trim().toUpperCase();}
function safeJson(value,fallback={}){if(value&&typeof value==='object')return value;try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;}}
function eventCode(row={}){const raw=safeJson(row.rawJson,{});return String(row.eventCode||row.trackingEventCode||row.statusCode||raw.eventCode||raw.trackingEventCode||raw.statusCode||'').trim().toUpperCase();}
function eventTime(row={}){const raw=safeJson(row.rawJson,{});return String(row.eventTime||raw.eventTime||raw.creationDate||raw.lastUpdateDate||'').trim();}
function eventText(row={}){const raw=safeJson(row.rawJson,{});return [row.eventCode,row.trackingEventCode,row.statusCode,row.trackingEventDesc,row.trackingEventDescZh,row.trackingEventDescKm,row.remark,row.place,row.eventShop,row.locationCode,raw.eventCode,raw.trackingEventCode,raw.statusCode,raw.trackingEventDesc,raw.trackingEventDescZh,raw.trackingEventDescKm,raw.remark,raw.place,raw.eventShop,raw.locationCode].map(v=>String(v||'')).join(' ');}
function is3001(row={}){return eventCode(row)==='3001'||/(?:^|[^0-9A-Z])3001(?:$|[^0-9A-Z])|TRANSPORT\s+TO\s+CENTRAL\s+WAREHOUSE\s+IN\s+PHNOM\s+PENH/i.test(`${eventCode(row)} ${eventText(row)}`);}
function isPod(row={}){const c=eventCode(row);return c==='4004'||c==='80'||/\bPOD\b|DELIVERED|签收|妥投|4004/i.test(eventText(row));}
function isStart(row={}){const c=eventCode(row);return c==='4003'||c==='70'||/OUT\s*FOR\s*DELIVERY|DELIVER\s*TO\s*BUYER|派送中|派件中/i.test(eventText(row));}
function isFail(row={}){return eventCode(row)==='150'||/\bPENDING\b|派送失败|无法联系|无人接听/i.test(eventText(row));}
function chunks(values=[],size=BATCH_SIZE){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
function eventKey(row={}){return createHash('sha1').update(`${billOf(row.shipmentCode||row.运单号)}|${eventTime(row)}|${eventCode(row)}|${eventText(row).slice(0,500)}`).digest('hex');}

export function ensureV208ShopeeEvidenceSchema(db=getDb()){
  db.exec(`CREATE TABLE IF NOT EXISTS v208_shopee_evidence_refresh(
    businessType TEXT NOT NULL,shipmentCode TEXT NOT NULL,firstReportDate TEXT,lastReportDate TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',eventCount INTEGER NOT NULL DEFAULT 0,has3001 INTEGER NOT NULL DEFAULT 0,
    hasPod INTEGER NOT NULL DEFAULT 0,attemptStartCount INTEGER NOT NULL DEFAULT 0,failureEventCount INTEGER NOT NULL DEFAULT 0,
    failCount INTEGER NOT NULL DEFAULT 0,lastFetchedAt TEXT,lastError TEXT,lastEventAt TEXT,updatedAt TEXT NOT NULL,
    PRIMARY KEY(businessType,shipmentCode)
  );
  CREATE INDEX IF NOT EXISTS idx_v208_refresh_status ON v208_shopee_evidence_refresh(status,lastFetchedAt,businessType);
  CREATE TABLE IF NOT EXISTS v208_shopee_event_keys(eventKey TEXT PRIMARY KEY,businessType TEXT NOT NULL,shipmentCode TEXT NOT NULL,eventTime TEXT,eventCode TEXT,createdAt TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_v208_event_bill ON v208_shopee_event_keys(businessType,shipmentCode,eventTime);`);
  return true;
}

function candidates(db,max=MAX_PER_RUN){
  ensureV208ShopeeEvidenceSchema(db);
  const openCutoff=new Date(Date.now()-OPEN_REFRESH_MS).toISOString(),incompleteCutoff=new Date(Date.now()-INCOMPLETE_REFRESH_MS).toISOString();
  return db.prepare(`SELECT o.businessType,o.shipmentCode,MIN(o.reportDate) firstReportDate,MAX(o.reportDate) lastReportDate,r.status,r.lastFetchedAt,r.failCount
    FROM v207_daily_ownership o LEFT JOIN v208_shopee_evidence_refresh r ON r.businessType=o.businessType AND r.shipmentCode=o.shipmentCode
    WHERE o.businessType IN ('SHOPEECN','SHOPEEVN')
    GROUP BY o.businessType,o.shipmentCode
    HAVING r.shipmentCode IS NULL OR r.status='PENDING' OR r.status='ERROR' OR (r.status='OPEN' AND COALESCE(r.lastFetchedAt,'')<?) OR (r.status IN ('INCOMPLETE_3001','INCOMPLETE_POD','NO_EVENTS') AND COALESCE(r.lastFetchedAt,'')<?)
    ORDER BY CASE WHEN r.shipmentCode IS NULL THEN 0 WHEN r.status IN ('PENDING','ERROR') THEN 1 WHEN r.status='OPEN' THEN 2 ELSE 3 END,MAX(o.reportDate) DESC,o.shipmentCode
    LIMIT ?`).all(openCutoff,incompleteCutoff,Math.max(1,Number(max||MAX_PER_RUN)));
}
function byBill(rows=[]){const map=new Map();for(const row of rows){const bill=billOf(row.shipmentCode||row.运单号);if(!bill)continue;if(!map.has(bill))map.set(bill,[]);map.get(bill).push(row);}return map;}
function persistEvents(db,candidate,eventRows=[]){const now=nowIso(),existing=new Set();try{for(const row of db.prepare('SELECT eventKey FROM v208_shopee_event_keys WHERE businessType=? AND shipmentCode=?').all(candidate.businessType,candidate.shipmentCode))existing.add(row.eventKey);}catch{}
  const insertKey=db.prepare('INSERT OR IGNORE INTO v208_shopee_event_keys(eventKey,businessType,shipmentCode,eventTime,eventCode,createdAt) VALUES(?,?,?,?,?,?)');
  const insertEvent=db.prepare('INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES(?,?,?,?,?,?,?)');
  let inserted=0;
  db.exec('BEGIN IMMEDIATE');
  try{for(const raw of eventRows){const row={...raw,shipmentCode:billOf(raw.shipmentCode||raw.运单号||candidate.shipmentCode)},key=eventKey(row);if(existing.has(key))continue;insertKey.run(key,candidate.businessType,candidate.shipmentCode,eventTime(row),eventCode(row),now);insertEvent.run(candidate.businessType,candidate.shipmentCode,candidate.lastReportDate||candidate.firstReportDate||'',eventTime(row),eventCode(row),JSON.stringify(raw),now);existing.add(key);inserted++;}db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}return inserted;
}
function classifyFetch(events=[]){const eventCount=events.length,has3001=events.some(is3001),hasPod=events.some(isPod),attemptStartCount=events.filter(isStart).length,failureEventCount=events.filter(isFail).length,lastEventAt=events.map(eventTime).filter(Boolean).sort().at(-1)||'';let status='OPEN';if(!eventCount)status='NO_EVENTS';else if(hasPod&&has3001)status='COMPLETE';else if(hasPod&&!has3001)status='INCOMPLETE_3001';else if(!hasPod&&has3001)status='OPEN';else status='INCOMPLETE_POD';return{status,eventCount,has3001,hasPod,attemptStartCount,failureEventCount,lastEventAt};}
function updateRefresh(db,candidate,summary,error=''){const now=nowIso(),failed=Boolean(error);db.prepare(`INSERT INTO v208_shopee_evidence_refresh(businessType,shipmentCode,firstReportDate,lastReportDate,status,eventCount,has3001,hasPod,attemptStartCount,failureEventCount,failCount,lastFetchedAt,lastError,lastEventAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(businessType,shipmentCode) DO UPDATE SET firstReportDate=excluded.firstReportDate,lastReportDate=excluded.lastReportDate,status=excluded.status,eventCount=MAX(v208_shopee_evidence_refresh.eventCount,excluded.eventCount),has3001=MAX(v208_shopee_evidence_refresh.has3001,excluded.has3001),hasPod=MAX(v208_shopee_evidence_refresh.hasPod,excluded.hasPod),attemptStartCount=MAX(v208_shopee_evidence_refresh.attemptStartCount,excluded.attemptStartCount),failureEventCount=MAX(v208_shopee_evidence_refresh.failureEventCount,excluded.failureEventCount),failCount=CASE WHEN excluded.lastError<>'' THEN v208_shopee_evidence_refresh.failCount+1 ELSE 0 END,lastFetchedAt=excluded.lastFetchedAt,lastError=excluded.lastError,lastEventAt=CASE WHEN excluded.lastEventAt>v208_shopee_evidence_refresh.lastEventAt THEN excluded.lastEventAt ELSE v208_shopee_evidence_refresh.lastEventAt END,updatedAt=excluded.updatedAt`)
    .run(candidate.businessType,candidate.shipmentCode,candidate.firstReportDate||'',candidate.lastReportDate||'',failed?'ERROR':summary.status,Number(summary.eventCount||0),summary.has3001?1:0,summary.hasPod?1:0,Number(summary.attemptStartCount||0),Number(summary.failureEventCount||0),failed?Number(candidate.failCount||0)+1:0,now,String(error||'').slice(0,1200),summary.lastEventAt||'',now);}

export async function runV208ShopeeEvidenceSync({reason='SCHEDULED',max=MAX_PER_RUN}={}){
  if(inFlight)return{ok:true,skipped:true,reason:'ALREADY_RUNNING'};inFlight=true;const db=getDb();ensureV208ShopeeEvidenceSchema(db);const list=candidates(db,max);if(!list.length){inFlight=false;return{ok:true,requested:0,complete:0,open:0,incomplete:0,errors:0,reason};}
  const client=new CEClient();let requested=0,inserted=0,complete=0,open=0,incomplete=0,errors=0,batches=0;try{
    for(const group of chunks(list,BATCH_SIZE)){
      const bills=group.map(row=>row.shipmentCode);let rows=[];
      try{rows=await client.trackQuery(bills);batches++;requested+=bills.length;}catch(error){errors+=group.length;for(const candidate of group)updateRefresh(db,candidate,{status:'ERROR',eventCount:0},error?.message||String(error));if(/401|403|AUTH|登录/i.test(String(error?.message||error)))break;continue;}
      const map=byBill(Array.isArray(rows)?rows:[]);
      for(const candidate of group){const events=map.get(candidate.shipmentCode)||[];try{inserted+=persistEvents(db,candidate,events);const summary=classifyFetch(events);updateRefresh(db,candidate,summary);if(summary.status==='COMPLETE')complete++;else if(summary.status==='OPEN')open++;else incomplete++;}catch(error){errors++;updateRefresh(db,candidate,{status:'ERROR',eventCount:events.length},error?.message||String(error));}}
    }
    try{db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run('v208_shopee_evidence_last_result',JSON.stringify({reason,requested,inserted,complete,open,incomplete,errors,batches}).slice(0,3000),nowIso());}catch{}
    console.log('[CE-QC][V208_SHOPEE_EVIDENCE]',JSON.stringify({reason,requested,inserted,complete,open,incomplete,errors,batches}));return{ok:errors===0,reason,requested,inserted,complete,open,incomplete,errors,batches,version:V208_SHOPEE_EVIDENCE_VERSION};
  }finally{inFlight=false;}
}

function launchWorker(reason='BACKGROUND'){
  if(workerChild)return{started:false,reason:'WORKER_ALREADY_RUNNING',pid:workerChild.pid||0};const file=fileURLToPath(new URL('./v208ShopeePrecisionEvidenceWorker.js',import.meta.url));try{workerChild=spawn(process.execPath,[file,reason],{cwd:process.cwd(),env:{...process.env,CE_QC_V208_WORKER:'1'},windowsHide:true,detached:false,stdio:['ignore','inherit','inherit']});const pid=workerChild.pid||0;workerChild.once('error',error=>{console.error('[CE-QC][V208_WORKER_SPAWN_FAILED]',error?.stack||error);workerChild=null;});workerChild.once('exit',(code,signal)=>{console.log(`[CE-QC][V208_WORKER] exit code=${code??'null'}${signal?` signal=${signal}`:''}`);workerChild=null;});return{started:true,pid};}catch(error){workerChild=null;return{started:false,reason:'SPAWN_FAILED',error:error?.message||String(error)};}}
export function kickV208ShopeeEvidenceBackfill(reason='IMPORT'){if(process.env.CI||process.env.NODE_ENV==='test')return{scheduled:false,reason:'TEST'};if(kickTimer||workerChild)return{scheduled:false,reason:'ALREADY_SCHEDULED_OR_RUNNING'};kickTimer=setTimeout(()=>{kickTimer=null;launchWorker(reason);},15_000);kickTimer.unref?.();return{scheduled:true,delayMs:15_000};}
export function startV208ShopeeEvidenceScheduler(){if(timer||startupTimer)return{started:false,reason:'ALREADY_STARTED'};if(process.env.CI||process.env.NODE_ENV==='test')return{started:false,reason:'TEST'};ensureV208ShopeeEvidenceSchema(getDb());startupTimer=setTimeout(()=>{startupTimer=null;launchWorker('STARTUP');},STARTUP_DELAY_MS);startupTimer.unref?.();timer=setInterval(()=>launchWorker('TWO_HOUR'),INTERVAL_MS);timer.unref?.();console.log(`[CE-QC][V208_SHOPEE_EVIDENCE] scheduler ready interval=${INTERVAL_MS}ms maxPerRun=${MAX_PER_RUN}`);return{started:true,intervalMs:INTERVAL_MS,maxPerRun:MAX_PER_RUN};}
function statusPayload(){const db=getDb();ensureV208ShopeeEvidenceSchema(db);const byStatus={};for(const row of db.prepare('SELECT status,COUNT(*) count FROM v208_shopee_evidence_refresh GROUP BY status').all())byStatus[row.status]=Number(row.count||0);const pending=Number(db.prepare(`SELECT COUNT(*) count FROM v207_daily_ownership o LEFT JOIN v208_shopee_evidence_refresh r ON r.businessType=o.businessType AND r.shipmentCode=o.shipmentCode WHERE o.businessType IN ('SHOPEECN','SHOPEEVN') AND r.shipmentCode IS NULL`).get()?.count||0);return{ok:true,version:V208_SHOPEE_EVIDENCE_VERSION,started:Boolean(timer||startupTimer),workerPid:workerChild?.pid||0,pendingNotFetched:pending,byStatus,lastResult:safeJson(db.prepare("SELECT value FROM app_meta WHERE key='v208_shopee_evidence_last_result'").get()?.value||'{}',{})};}

let routesInstalled=false;const previousListen=express.application.listen;
express.application.listen=function v208ShopeeEvidenceListen(...args){if(!routesInstalled){routesInstalled=true;this.get('/api/v208/shopee-evidence/status',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(statusPayload());});this.post('/api/v208/shopee-evidence/start',(req,res)=>res.json({ok:true,...kickV208ShopeeEvidenceBackfill('MANUAL_API')}));startV208ShopeeEvidenceScheduler();}return previousListen.apply(this,args);};
