import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { ensureV246TrackingSchema, applyV246StrictAttemptEvidence } from './v246TrackingLedgerCore.js';
import { activeBusinessProcessingDetails, cambodiaClock } from './carryoverRefreshScheduler.js';

export const V262_SHOPEE_STRICT_EVIDENCE_ID='2026-08-23-v263-three-business-attempt-signing-retry-v1';
export const V263_DELIVERY_KPI_TYPES=Object.freeze(['TBKH','SHOPEECN','SHOPEEVN']);
const TYPE_SET=new Set(V263_DELIVERY_KPI_TYPES);
const LOOKBACK_DAYS=Math.max(30,Math.min(400,Number(process.env.V262_STRICT_LOOKBACK_DAYS||400)));
const MAX_PER_RUN=Math.max(100,Math.min(2000,Number(process.env.V262_STRICT_MAX_PER_RUN||1200)));
const CHUNK=Math.max(10,Math.min(100,Number(process.env.V262_STRICT_CHUNK||50)));
const START_DELAY_MS=Math.max(120_000,Math.min(15*60_000,Number(process.env.V262_STRICT_START_DELAY_MS||240_000)));
const RETRY_BLOCKED_MS=Math.max(5*60_000,Number(process.env.V262_STRICT_BLOCKED_RETRY_MS||15*60_000));
const PERIODIC_MS=Math.max(2*60*60_000,Number(process.env.V262_STRICT_PERIODIC_MS||2*60*60_000));
const UNKNOWN_RETRY_MS=Math.max(60*60_000,Number(process.env.V263_UNKNOWN_ATTEMPT_RETRY_MS||2*60*60_000));
let running=false,startTimer=null,periodicTimer=null,blockedTimer=null;

const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
const dateKey=v=>{const m=String(v||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
function addDays(date,days){const key=dateKey(date);if(!key)return'';const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function safeJson(v){try{return v&&typeof v==='object'?v:JSON.parse(String(v||'{}'));}catch{return{};}}
function eventBill(row={}){return billOf(row.shipmentCode||row.运单号||row.waybill||row.waybillNo||row.billCode||row.trackingNo||row.orderNo);}

export function v262ShouldRetryStrictRow(row={}){
  return String(row.terminalReason||'').toUpperCase()==='POD'&&TYPE_SET.has(String(row.businessType||'').toUpperCase())&&Number(row.attemptNo||0)===0;
}

export function normalizeV262TrackPayload(value,inheritedBill='',out=[],seen=new WeakSet(),depth=0){
  if(depth>6||value===null||value===undefined)return out;
  if(Array.isArray(value)){for(const item of value)normalizeV262TrackPayload(item,inheritedBill,out,seen,depth+1);return out;}
  if(typeof value!=='object')return out;
  if(seen.has(value))return out;seen.add(value);
  const ownBill=eventBill(value)||billOf(inheritedBill);
  const eventLike=value.eventCode!==undefined||value.trackingEventCode!==undefined||value.statusCode!==undefined||value.eventTime!==undefined||value.creationDate!==undefined||value.lastUpdateDate!==undefined||value.trackingEventDesc!==undefined||value.trackingEventDescZh!==undefined;
  if(eventLike)out.push({...value,shipmentCode:ownBill||eventBill(value)});
  for(const [key,child] of Object.entries(value)){
    if(key==='rawJson'||child===null||child===undefined||typeof child!=='object')continue;
    normalizeV262TrackPayload(child,ownBill,out,seen,depth+1);
  }
  return out;
}

function localEvent(row={}){
  const raw=safeJson(row.rawJson);return{...raw,shipmentCode:billOf(row.shipmentCode),businessType:row.businessType||raw.businessType||'',eventTime:row.eventTime||raw.eventTime||raw.creationDate||raw.lastUpdateDate||'',eventCode:row.eventCode||raw.eventCode||raw.trackingEventCode||'',trackingEventCode:raw.trackingEventCode||row.eventCode||'',rawJson:raw};
}
function localEventsForBills(db,bills){
  const byBill=new Map();if(!bills.length)return byBill;const marks=bills.map(()=>'?').join(',');
  const add=row=>{const bill=billOf(row.shipmentCode);if(!bill)return;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(localEvent(row));};
  try{for(const row of db.prepare(`SELECT businessType,shipmentCode,eventTime,eventCode,rawJson FROM business_track_events WHERE UPPER(TRIM(shipmentCode)) IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...bills))add(row);}catch{}
  try{for(const row of db.prepare(`SELECT '' AS businessType,shipmentCode,eventTime,COALESCE(eventCode,trackingEventCode,'') eventCode,rawJson FROM track_events WHERE UPPER(TRIM(shipmentCode)) IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...bills))add(row);}catch{}
  return byBill;
}
async function queryWithFallback(client,bills){
  if(!bills.length)return{events:[],failed:[]};
  try{return{events:normalizeV262TrackPayload(await client.trackQuery(bills)),failed:[]};}
  catch(error){if(bills.length===1)return{events:[],failed:[{shipmentCode:bills[0],error:error?.message||String(error)}]};const mid=Math.ceil(bills.length/2),left=await queryWithFallback(client,bills.slice(0,mid)),right=await queryWithFallback(client,bills.slice(mid));return{events:[...left.events,...right.events],failed:[...left.failed,...right.failed]};}
}
function evidenceRow(row,strict){return{shipmentCode:billOf(row.shipmentCode),businessType:row.businessType,attemptNo:strict.attemptNo,source:strict.source,startMode:strict.startMode,starts:strict.starts,failures:strict.failures,podDate:strict.podDate||row.podDate||''};}
function unknownCandidates(db){
  ensureV246TrackingSchema(db);const today=cambodiaClock().date,from=addDays(today,-(LOOKBACK_DAYS-1)),retryBefore=new Date(Date.now()-UNKNOWN_RETRY_MS).toISOString();
  return db.prepare(`SELECT shipmentCode,businessType,firstReportDate,lastImportedDate,podDate,attemptNo,attemptSource,lastCheckedAt,terminalReason
    FROM qc_tracking_ledger
    WHERE terminalReason='POD' AND businessType IN ('TBKH','SHOPEECN','SHOPEEVN') AND attemptNo=0
      AND firstReportDate BETWEEN ? AND ? AND (lastCheckedAt='' OR lastCheckedAt IS NULL OR lastCheckedAt<=?)
    ORDER BY CASE WHEN lastCheckedAt='' OR lastCheckedAt IS NULL THEN 0 ELSE 1 END,lastCheckedAt,firstReportDate,shipmentCode LIMIT ?`).all(from,today,retryBefore,MAX_PER_RUN).filter(v262ShouldRetryStrictRow);
}

export async function runV262ShopeeStrictEvidenceBackfill({client=new CEClient(),reason='AUTO'}={}){
  if(running)return{ok:true,skipped:true,reason:'ALREADY_RUNNING'};const db=getDb();ensureV246TrackingSchema(db);const blockers=activeBusinessProcessingDetails(db);if(blockers.active)return{ok:true,skipped:true,reason:'FOREGROUND_PROCESSING_ACTIVE',blockers:blockers.blockers?.slice?.(0,3)||[]};
  running=true;const startedAt=nowIso();try{
    const candidates=unknownCandidates(db);if(!candidates.length)return{ok:true,id:V262_SHOPEE_STRICT_EVIDENCE_ID,reason,startedAt,candidates:0,localKnown:0,apiQueried:0,apiFailed:0,known:0,unknown:0};
    let localKnown=0,apiQueried=0,apiFailed=0;const localEvidence=[],unresolved=[];
    for(let offset=0;offset<candidates.length;offset+=CHUNK){const chunk=candidates.slice(offset,offset+CHUNK),bills=chunk.map(r=>billOf(r.shipmentCode)),local=localEventsForBills(db,bills);for(const row of chunk){const strict=analyzeV246ShopeeAttemptCycle(local.get(billOf(row.shipmentCode))||[],{podDate:row.podDate||''});if(strict.attemptNo>0){localKnown+=1;localEvidence.push(evidenceRow(row,strict));}else unresolved.push(row);}}
    let localApplied={updated:0,known:0,unknown:0,podDateFilled:0,corrected:0};if(localEvidence.length)localApplied=applyV246StrictAttemptEvidence(localEvidence,{db,reason:`V263:${reason}:LOCAL_STORED_TRACK`});
    const apiEvidence=[];
    for(let offset=0;offset<unresolved.length;offset+=CHUNK){const chunk=unresolved.slice(offset,offset+CHUNK),bills=chunk.map(r=>billOf(r.shipmentCode));const outcome=await queryWithFallback(client,bills);apiQueried+=bills.length;apiFailed+=outcome.failed.length;const byBill=new Map();for(const event of outcome.events){const bill=eventBill(event);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(event);}const failed=new Set(outcome.failed.map(r=>billOf(r.shipmentCode)));for(const row of chunk){const bill=billOf(row.shipmentCode);if(failed.has(bill))continue;const strict=analyzeV246ShopeeAttemptCycle(byBill.get(bill)||[],{podDate:row.podDate||''});apiEvidence.push(evidenceRow(row,strict));}}
    let apiApplied={updated:0,known:0,unknown:0,podDateFilled:0,corrected:0};if(apiEvidence.length)apiApplied=applyV246StrictAttemptEvidence(apiEvidence,{db,reason:`V263:${reason}:CE_TRACK_RETRY_UNKNOWN`});
    const result={ok:true,id:V262_SHOPEE_STRICT_EVIDENCE_ID,types:V263_DELIVERY_KPI_TYPES,reason,startedAt,completedAt:nowIso(),candidates:candidates.length,localKnown,localUpdated:localApplied.updated,apiQueried,apiFailed,apiUpdated:apiApplied.updated,known:localApplied.known+apiApplied.known,unknown:apiApplied.unknown,podDateFilled:localApplied.podDateFilled+apiApplied.podDateFilled};
    console.log('[CE-QC][V263_DELIVERY_EVIDENCE]',JSON.stringify(result));return result;
  }catch(error){console.warn('[CE-QC][V263_DELIVERY_EVIDENCE] failed:',error?.message||error);return{ok:false,id:V262_SHOPEE_STRICT_EVIDENCE_ID,reason,error:error?.message||String(error)};}finally{running=false;}
}

function retryIfBlocked(){clearTimeout(blockedTimer);blockedTimer=setTimeout(async()=>{const r=await runV262ShopeeStrictEvidenceBackfill({reason:'BLOCKED_RETRY'});if(r?.skipped&&r.reason==='FOREGROUND_PROCESSING_ACTIVE')retryIfBlocked();},RETRY_BLOCKED_MS);blockedTimer.unref?.();}
function start(){
  if(process.env.CI||process.env.NODE_ENV==='test'||String(process.env.CE_QC_DISABLE_V262_STRICT_BACKFILL||'')==='1')return;
  startTimer=setTimeout(async()=>{const r=await runV262ShopeeStrictEvidenceBackfill({reason:'STARTUP_AUTO'});if(r?.skipped&&r.reason==='FOREGROUND_PROCESSING_ACTIVE')retryIfBlocked();},START_DELAY_MS);startTimer.unref?.();
  periodicTimer=setInterval(async()=>{const r=await runV262ShopeeStrictEvidenceBackfill({reason:'TWO_HOUR_AUTO'});if(r?.skipped&&r.reason==='FOREGROUND_PROCESSING_ACTIVE')retryIfBlocked();},PERIODIC_MS);periodicTimer.unref?.();
  console.log(`[CE-QC][V263_DELIVERY_EVIDENCE] ${V262_SHOPEE_STRICT_EVIDENCE_ID} enabled for TBKH + SHOPEECN + SHOPEEVN only: stored-track first + CE retry for POD attemptNo=0; ${LOOKBACK_DAYS}d lookback, every ${Math.round(PERIODIC_MS/3600000)}h.`);
}
start();
