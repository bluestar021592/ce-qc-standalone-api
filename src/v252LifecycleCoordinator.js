import express from 'express';
import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { collectV200Rows } from './v200EvidenceData.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { activeBusinessProcessingDetails, cambodiaClock } from './carryoverRefreshScheduler.js';
import {
  ensureV246TrackingSchema,
  reconcileV246TrackingLedger,
  applyV246EvidenceRows,
  applyV246StrictAttemptEvidence,
  v246DateKey
} from './v246TrackingLedgerCore.js';

export const V252_LIFECYCLE_COORDINATOR_ID='2026-08-23-v252-qc-lifecycle-coordinator-v3';
const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];
const POLL_MS=60_000;
const STARTUP_SYNC_DELAY_MS=Math.max(30_000,Math.min(180_000,Number(process.env.V252_STARTUP_SYNC_DELAY_MS||45_000)));
const LOCAL_AUDIT_MS=30*60_000;
const STRICT_CHUNK=Math.max(10,Math.min(100,Number(process.env.V252_STRICT_TRACK_CHUNK||50)));
const STRICT_MAX_PER_SYNC=Math.max(200,Math.min(3000,Number(process.env.V252_STRICT_MAX_PER_SYNC||1200)));
const BACKGROUND_LIFECYCLE_ENABLED=String(process.env.CE_QC_ENABLE_V252_BACKGROUND_LIFECYCLE||'')==='1';
let timer=null,startupTimer=null,syncing=false,lastLocalAuditAt=0,lastCarrySeen='',lastCarryRowSeen='';

const text=value=>String(value??'').trim();
const billOf=value=>text(value).toUpperCase();
const dateKey=value=>v246DateKey(value);
function addDays(date,days){const key=dateKey(date);if(!key)return'';const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function getMeta(db,key){try{return text(db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value);}catch{return'';}}
function setMeta(db,key,value){db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(key,String(value??''),nowIso());}
function latestCarryRowAt(db){try{return text(db.prepare('SELECT MAX(updatedAt) value FROM carryover_open_items').get()?.value);}catch{return'';}}
function eventBill(row={}){return billOf(row.shipmentCode||row.运单号||row.waybill||row.waybillNo||row.billCode||row.trackingNo);}
function flattenTrackResult(value){if(Array.isArray(value))return value;if(!value||typeof value!=='object')return[];for(const key of ['data','rows','list','records','events','result']){const child=value[key];if(Array.isArray(child))return child.flatMap(item=>Array.isArray(item)?item:[item]);if(child&&typeof child==='object'){const nested=flattenTrackResult(child);if(nested.length)return nested;}}return[];}
async function queryTrackWithFallback(client,bills){if(!bills.length)return{events:[],failed:[]};try{return{events:flattenTrackResult(await client.trackQuery(bills)),failed:[]};}catch(error){if(bills.length===1)return{events:[],failed:[{shipmentCode:bills[0],error:error?.message||String(error)}]};const mid=Math.ceil(bills.length/2),left=await queryTrackWithFallback(client,bills.slice(0,mid)),right=await queryTrackWithFallback(client,bills.slice(mid));return{events:[...left.events,...right.events],failed:[...left.failed,...right.failed]};}}

function trackingSelection(days=30){const today=cambodiaClock().date;return{businessType:'ALL',fromDate:addDays(today,-(days-1)),toDate:today,days};}
function strictCandidates(db){
  ensureV246TrackingSchema(db);
  return db.prepare(`SELECT l.shipmentCode,l.businessType,l.firstReportDate,l.lastImportedDate,l.trackingStatus,l.terminalReason,l.podDate,l.attemptNo,l.attemptSource,l.lastCheckedAt,
      MAX(COALESCE(s.updatedAt,''),COALESCE(c.updatedAt,'')) AS sourceUpdatedAt
    FROM qc_tracking_ledger l
    LEFT JOIN shipment_current_state s ON s.shipmentCode=l.shipmentCode
    LEFT JOIN carryover_open_items c ON c.shipmentCode=l.shipmentCode
    WHERE l.businessType IN ('SHOPEECN','SHOPEEVN')
      AND (
        (l.trackingStatus='OPEN' AND (
          l.attemptSource NOT LIKE 'V246_STRICT_TRACK:V252_OPEN:%'
          OR MAX(COALESCE(s.updatedAt,''),COALESCE(c.updatedAt,''))>COALESCE(l.lastCheckedAt,'')
        ))
        OR
        (l.terminalReason='POD' AND (l.attemptSource LIKE 'V246_STRICT_TRACK:V252_OPEN:%' OR l.attemptSource NOT LIKE 'V246_STRICT_TRACK:%'))
      )
    ORDER BY CASE WHEN l.terminalReason='POD' THEN 0 ELSE 1 END, sourceUpdatedAt DESC,l.updatedAt DESC,l.firstReportDate DESC
    LIMIT ?`).all(STRICT_MAX_PER_SYNC);
}

export function applyV252OpenAttemptEvidence(rows=[],{db=getDb(),reason='V252_OPEN_STRICT_TRACK'}={}){
  ensureV246TrackingSchema(db);
  const get=db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?');
  const update=db.prepare(`UPDATE qc_tracking_ledger SET attemptNo=?,attemptSource=?,evidenceJson=?,lastCheckedAt=?,lastRepairReason=?,updatedAt=? WHERE shipmentCode=? AND trackingStatus='OPEN'`);
  const audit=db.prepare('INSERT INTO qc_tracking_audit(shipmentCode,businessType,action,reason,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?)');
  const now=nowIso();let updated=0,known=0,changed=0;
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of rows){const bill=billOf(row.shipmentCode),old=get.get(bill);if(!bill||!old||old.trackingStatus!=='OPEN'||!SHOPEE_TYPES.includes(text(old.businessType).toUpperCase()))continue;const attemptNo=Math.max(0,Math.min(3,Number(row.attemptNo||0))),source=`V246_STRICT_TRACK:V252_OPEN:${text(row.source||'START_FAILURE_CYCLE')}`;const evidence=JSON.stringify({source,reason,attemptNo,startMode:row.startMode||'',starts:row.starts||[],failures:row.failures||[],checkedAt:now});const before=JSON.stringify({attemptNo:Number(old.attemptNo||0),attemptSource:old.attemptSource||''});update.run(attemptNo,source,evidence,now,reason,now,bill);const afterRow=get.get(bill)||{},after=JSON.stringify({attemptNo:Number(afterRow.attemptNo||0),attemptSource:afterRow.attemptSource||''});if(before!==after){changed+=1;audit.run(bill,old.businessType,'OPEN_ATTEMPT_EVIDENCE',reason,before,after,now);}updated+=1;if(attemptNo>0)known+=1;}
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return{updated,known,changed};
}

async function refreshStrictAttempts(selection,client=new CEClient()){
  const db=getDb(),candidates=strictCandidates(db);let queried=0,failed=0;const openEvidence=[],podEvidence=[];
  for(let offset=0;offset<candidates.length;offset+=STRICT_CHUNK){const chunk=candidates.slice(offset,offset+STRICT_CHUNK),bills=chunk.map(row=>billOf(row.shipmentCode)).filter(Boolean),outcome=await queryTrackWithFallback(client,bills);queried+=bills.length;failed+=outcome.failed.length;const byBill=new Map();for(const event of outcome.events){const bill=eventBill(event);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(event);}const failedBills=new Set(outcome.failed.map(row=>billOf(row.shipmentCode)));for(const row of chunk){const bill=billOf(row.shipmentCode);if(!bill||failedBills.has(bill))continue;const strict=analyzeV246ShopeeAttemptCycle(byBill.get(bill)||[],{podDate:row.terminalReason==='POD'?row.podDate||'':''});const item={shipmentCode:bill,businessType:row.businessType,attemptNo:strict.attemptNo,source:strict.source,startMode:strict.startMode,starts:strict.starts,failures:strict.failures,podDate:strict.podDate||row.podDate||''};if(row.terminalReason==='POD')podEvidence.push(item);else openEvidence.push(item);}}
  const openApplied=applyV252OpenAttemptEvidence(openEvidence,{db,reason:'V252_CONTINUOUS_OPEN_ATTEMPT'});
  const podApplied=applyV246StrictAttemptEvidence(podEvidence,{db,reason:'V252_FINAL_POD_ATTEMPT'});
  return{candidates:candidates.length,queried,failed,open:openApplied,pod:podApplied,limited:candidates.length>=STRICT_MAX_PER_SYNC};
}

async function syncEvidence(selection,{reason='V252_SYNC',client=new CEClient()}={}){
  const db=getDb();
  const blockers=activeBusinessProcessingDetails(db);if(blockers.active)return{ok:true,skipped:true,reason:'FOREGROUND_PROCESSING_ACTIVE'};
  const repair=reconcileV246TrackingLedger(selection,{db,reason:`${reason}:LEDGER_RECONCILE`});
  const evidence=[];const warnings=[];
  for(const type of SHOPEE_TYPES){try{const rows=await collectV200Rows(type,{from:selection.fromDate,to:selection.toDate},()=>{});evidence.push({businessType:type,rows:rows.length,...applyV246EvidenceRows(rows,{db,reason:`${reason}:${type}:POD_EVIDENCE`})});}catch(error){warnings.push(`${type}:${error?.message||error}`);}}
  const strict=await refreshStrictAttempts(selection,client);
  const finalRepair=reconcileV246TrackingLedger(selection,{db,reason:`${reason}:FINAL_RECONCILE`});
  setMeta(db,'v252_lifecycle_last_sync_at',nowIso());setMeta(db,'v252_lifecycle_last_sync_reason',reason);
  return{ok:true,reason,repair,evidence,strict,finalRepair,warnings};
}

function lightweightLedgerAudit(days=90,reason='V252_LIGHT_AUDIT'){
  const db=getDb(),selection=trackingSelection(days),result=reconcileV246TrackingLedger(selection,{db,reason});
  setMeta(db,'v252_lifecycle_last_audit_at',nowIso());
  return result;
}

async function admitImportedDate(reportDate){
  const date=dateKey(reportDate);if(!date)return null;const db=getDb();
  const selection={businessType:'ALL',fromDate:date,toDate:date,days:1};
  const result=reconcileV246TrackingLedger(selection,{db,reason:'V252_IMPORT_IMMEDIATE_ADMISSION'});
  setMeta(db,'v252_last_import_admitted_date',date);setMeta(db,'v252_last_import_admitted_at',nowIso());
  console.log('[CE-QC][V252_IMPORT_ADMISSION]',JSON.stringify({date,expected:result.expected,repaired:result.repaired,open:result.open,terminal:result.terminal}));
  return result;
}

async function lifecycleTick(){
  if(syncing)return;const db=getDb(),now=Date.now(),carryAt=getMeta(db,'carry_refresh_last_success_at'),carryRowAt=latestCarryRowAt(db);const carryChanged=Boolean(carryAt&&carryAt!==lastCarrySeen),stateChanged=Boolean(carryRowAt&&carryRowAt!==lastCarryRowSeen),localDue=now-lastLocalAuditAt>=LOCAL_AUDIT_MS;if(!carryChanged&&!stateChanged&&!localDue)return;if(activeBusinessProcessingDetails(db).active)return;syncing=true;try{
    if(carryChanged||stateChanged){const reason=carryChanged?'V252_AFTER_TWO_HOUR_OPEN_REFRESH':'V252_AFTER_CARRY_STATE_CHANGE',result=await syncEvidence(trackingSelection(30),{reason});if(!result?.skipped){lastCarrySeen=carryAt||lastCarrySeen;lastCarryRowSeen=carryRowAt||lastCarryRowSeen;lastLocalAuditAt=Date.now();console.log('[CE-QC][V252_LIFECYCLE_SYNC]',JSON.stringify({reason,strict:result.strict,repair:result.finalRepair?.repaired||0,warnings:result.warnings||[]}));}}
    else if(localDue){const result=lightweightLedgerAudit(90,'V252_30MIN_ANTI_LEAK_AUDIT');lastLocalAuditAt=Date.now();console.log('[CE-QC][V252_LIGHT_AUDIT]',JSON.stringify({expected:result.expected,repaired:result.repaired,reopened:result.reopened,open:result.open}));}
  }catch(error){console.warn('[CE-QC][V252_LIFECYCLE_SYNC_FAILED]',error?.message||error);}finally{syncing=false;}}

const previousPost=express.application.post;
function importAdmissionMiddleware(req,res,next){const originalJson=res.json.bind(res);res.json=function v252ImportAdmissionJson(payload){if(!res.locals.__v252AdmissionQueued&&res.statusCode<400&&payload?.reportDate){res.locals.__v252AdmissionQueued=true;setImmediate(()=>admitImportedDate(payload.reportDate).catch(error=>console.warn('[CE-QC][V252_IMPORT_ADMISSION_FAILED]',error?.message||error)));}return originalJson(payload);};next();}
express.application.post=function v252LifecyclePost(pathValue,...handlers){if(String(pathValue||'')==='/api/import/unified-daily-report')return previousPost.call(this,pathValue,importAdmissionMiddleware,...handlers);return previousPost.call(this,pathValue,...handlers);};

function start(){if(timer||process.env.CI||process.env.NODE_ENV==='test'||String(process.env.CE_QC_DISABLE_V246_TRACKING||'')==='1')return;if(!BACKGROUND_LIFECYCLE_ENABLED){console.log('[CE-QC][V252_BACKGROUND_LIFECYCLE_DISABLED]',V252_LIFECYCLE_COORDINATOR_ID,'import admission remains event-driven; startup 90-day audit, periodic carry-state sync and automatic CE strict tracking are disabled by default.');return;}const db=getDb();lastCarrySeen=getMeta(db,'carry_refresh_last_success_at');lastCarryRowSeen=latestCarryRowAt(db);lastLocalAuditAt=Date.now();startupTimer=setTimeout(()=>{try{const result=lightweightLedgerAudit(90,'V252_STARTUP_90DAY_ADMISSION_AUDIT');lastLocalAuditAt=Date.now();console.log('[CE-QC][V252_STARTUP_AUDIT]',JSON.stringify({expected:result.expected,repaired:result.repaired,reopened:result.reopened,open:result.open}));}catch(error){console.warn('[CE-QC][V252_STARTUP_AUDIT_FAILED]',error?.message||error);}},STARTUP_SYNC_DELAY_MS);startupTimer.unref?.();timer=setInterval(()=>lifecycleTick().catch(error=>console.warn('[CE-QC][V252_TICK_FAILED]',error?.message||error)),POLL_MS);timer.unref?.();console.log('[CE-QC][V252_BACKGROUND_LIFECYCLE_ENABLED]',V252_LIFECYCLE_COORDINATOR_ID,'explicit opt-in enabled: startup audit + carry-state lifecycle sync + strict tracking.');}
start();

export const V252_LIFECYCLE_TEST_API={admitImportedDate,syncEvidence,refreshStrictAttempts,lifecycleTick,lightweightLedgerAudit};
