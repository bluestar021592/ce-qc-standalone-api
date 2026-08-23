import { getDb, nowIso } from './db.js';
import { CEClient } from './ceClient.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { ensureV246TrackingSchema } from './v246TrackingLedgerCore.js';
import { activeBusinessProcessingDetails } from './carryoverRefreshScheduler.js';
import { normalizeV262TrackPayload } from './v262ShopeeStrictEvidenceBackfill.js';

export const V264_TBKH_OPEN_ATTEMPT_ID='2026-08-23-v264-tbkh-open-attempt-lifecycle-v1';
const POLL_MS=60_000;
const START_DELAY_MS=120_000;
const UNKNOWN_RETRY_MS=2*60*60_000;
const MAX_PER_RUN=600;
const CHUNK=50;
let running=false,timer=null,startTimer=null;

const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
function eventBill(row={}){return billOf(row.shipmentCode||row.运单号||row.waybill||row.waybillNo||row.billCode||row.trackingNo||row.orderNo);}

function localEventsForBills(db,bills=[]){
  const out=new Map();if(!bills.length)return out;const marks=bills.map(()=>'?').join(',');
  const add=row=>{const bill=eventBill(row);if(!bill)return;if(!out.has(bill))out.set(bill,[]);out.get(bill).push(row);};
  try{for(const row of db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson FROM business_track_events WHERE UPPER(TRIM(shipmentCode)) IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...bills))add(row);}catch{}
  try{for(const row of db.prepare(`SELECT shipmentCode,eventTime,COALESCE(eventCode,trackingEventCode,'') eventCode,rawJson FROM track_events WHERE UPPER(TRIM(shipmentCode)) IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...bills))add(row);}catch{}
  return out;
}

async function queryWithFallback(client,bills=[]){
  if(!bills.length)return{events:[],failed:[]};
  try{return{events:normalizeV262TrackPayload(await client.trackQuery(bills)),failed:[]};}
  catch(error){
    if(bills.length===1)return{events:[],failed:[{shipmentCode:bills[0],error:error?.message||String(error)}]};
    const mid=Math.ceil(bills.length/2),left=await queryWithFallback(client,bills.slice(0,mid)),right=await queryWithFallback(client,bills.slice(mid));
    return{events:[...left.events,...right.events],failed:[...left.failed,...right.failed]};
  }
}

export function v264ShouldTrackTbkhOpen(row={}){
  return String(row.businessType||'').toUpperCase()==='TBKH'&&String(row.trackingStatus||'').toUpperCase()==='OPEN';
}

function candidates(db){
  ensureV246TrackingSchema(db);const retryBefore=new Date(Date.now()-UNKNOWN_RETRY_MS).toISOString();
  return db.prepare(`SELECT l.shipmentCode,l.businessType,l.trackingStatus,l.attemptNo,l.attemptSource,l.lastCheckedAt,
      MAX(COALESCE(s.updatedAt,''),COALESCE(c.updatedAt,'')) AS sourceUpdatedAt
    FROM qc_tracking_ledger l
    LEFT JOIN shipment_current_state s ON s.shipmentCode=l.shipmentCode
    LEFT JOIN carryover_open_items c ON c.shipmentCode=l.shipmentCode
    WHERE l.businessType='TBKH' AND l.trackingStatus='OPEN'
      AND (
        l.attemptSource NOT LIKE 'V246_STRICT_TRACK:V264_TBKH_OPEN:%'
        OR MAX(COALESCE(s.updatedAt,''),COALESCE(c.updatedAt,''))>COALESCE(l.lastCheckedAt,'')
        OR (COALESCE(l.attemptNo,0)=0 AND COALESCE(l.lastCheckedAt,'')<=?)
      )
    ORDER BY CASE WHEN COALESCE(l.lastCheckedAt,'')='' THEN 0 ELSE 1 END,sourceUpdatedAt DESC,l.updatedAt DESC
    LIMIT ?`).all(retryBefore,MAX_PER_RUN).filter(v264ShouldTrackTbkhOpen);
}

export function applyV264TbkhOpenEvidence(rows=[],{db=getDb(),reason='V264_TBKH_OPEN'}={}){
  ensureV246TrackingSchema(db);const get=db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?');
  const update=db.prepare(`UPDATE qc_tracking_ledger SET attemptNo=?,attemptSource=?,evidenceJson=?,lastCheckedAt=?,lastRepairReason=?,updatedAt=? WHERE shipmentCode=? AND businessType='TBKH' AND trackingStatus='OPEN'`);
  const audit=db.prepare('INSERT INTO qc_tracking_audit(shipmentCode,businessType,action,reason,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?)');
  const now=nowIso();let updated=0,changed=0,known=0;
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of rows){
      const bill=billOf(row.shipmentCode),old=get.get(bill);if(!bill||!v264ShouldTrackTbkhOpen(old))continue;
      const attemptNo=Math.max(0,Math.min(3,Number(row.attemptNo||0)));
      const source=`V246_STRICT_TRACK:V264_TBKH_OPEN:${text(row.source||'START_FAILURE_CYCLE')}`;
      const before=JSON.stringify({attemptNo:Number(old.attemptNo||0),attemptSource:old.attemptSource||''});
      const evidence=JSON.stringify({source,reason,attemptNo,startMode:row.startMode||'',starts:row.starts||[],failures:row.failures||[],checkedAt:now});
      update.run(attemptNo,source,evidence,now,reason,now,bill);
      const afterRow=get.get(bill)||{},after=JSON.stringify({attemptNo:Number(afterRow.attemptNo||0),attemptSource:afterRow.attemptSource||''});
      if(before!==after){changed+=1;audit.run(bill,'TBKH','OPEN_ATTEMPT_EVIDENCE',reason,before,after,now);}
      updated+=1;if(attemptNo>0)known+=1;
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return{updated,changed,known};
}

export async function runV264TbkhOpenAttemptLifecycle({client=new CEClient(),reason='AUTO'}={}){
  if(running)return{ok:true,skipped:true,reason:'ALREADY_RUNNING'};
  const db=getDb(),blockers=activeBusinessProcessingDetails(db);if(blockers.active)return{ok:true,skipped:true,reason:'FOREGROUND_PROCESSING_ACTIVE'};
  running=true;const startedAt=nowIso();
  try{
    const rows=candidates(db);if(!rows.length)return{ok:true,id:V264_TBKH_OPEN_ATTEMPT_ID,reason,startedAt,candidates:0,localKnown:0,apiQueried:0,apiFailed:0,updated:0};
    const localEvidence=[],unresolved=[];let localKnown=0,apiQueried=0,apiFailed=0;
    for(let offset=0;offset<rows.length;offset+=CHUNK){
      const chunk=rows.slice(offset,offset+CHUNK),bills=chunk.map(r=>billOf(r.shipmentCode)),stored=localEventsForBills(db,bills);
      for(const row of chunk){const strict=analyzeV246ShopeeAttemptCycle(stored.get(billOf(row.shipmentCode))||[],{podDate:''});if(strict.attemptNo>0){localKnown+=1;localEvidence.push({shipmentCode:row.shipmentCode,...strict});}else unresolved.push(row);}
    }
    const localApplied=localEvidence.length?applyV264TbkhOpenEvidence(localEvidence,{db,reason:`${reason}:LOCAL_STORED_TRACK`}):{updated:0,changed:0,known:0};
    const apiEvidence=[];
    for(let offset=0;offset<unresolved.length;offset+=CHUNK){
      const chunk=unresolved.slice(offset,offset+CHUNK),bills=chunk.map(r=>billOf(r.shipmentCode)),outcome=await queryWithFallback(client,bills);apiQueried+=bills.length;apiFailed+=outcome.failed.length;
      const byBill=new Map();for(const event of outcome.events){const bill=eventBill(event);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(event);}const failed=new Set(outcome.failed.map(r=>billOf(r.shipmentCode)));
      for(const row of chunk){const bill=billOf(row.shipmentCode);if(failed.has(bill))continue;const strict=analyzeV246ShopeeAttemptCycle(byBill.get(bill)||[],{podDate:''});apiEvidence.push({shipmentCode:bill,...strict});}
    }
    const apiApplied=apiEvidence.length?applyV264TbkhOpenEvidence(apiEvidence,{db,reason:`${reason}:CE_TRACK`}):{updated:0,changed:0,known:0};
    const result={ok:true,id:V264_TBKH_OPEN_ATTEMPT_ID,reason,startedAt,completedAt:nowIso(),candidates:rows.length,localKnown,apiQueried,apiFailed,updated:localApplied.updated+apiApplied.updated,known:localApplied.known+apiApplied.known,changed:localApplied.changed+apiApplied.changed};
    console.log('[CE-QC][V264_TBKH_OPEN_ATTEMPT]',JSON.stringify(result));return result;
  }catch(error){console.warn('[CE-QC][V264_TBKH_OPEN_ATTEMPT] failed:',error?.message||error);return{ok:false,id:V264_TBKH_OPEN_ATTEMPT_ID,reason,error:error?.message||String(error)};}
  finally{running=false;}
}

function start(){
  if(process.env.CI||process.env.NODE_ENV==='test'||String(process.env.CE_QC_DISABLE_V246_TRACKING||'')==='1')return;
  startTimer=setTimeout(()=>runV264TbkhOpenAttemptLifecycle({reason:'STARTUP_AUTO'}),START_DELAY_MS);startTimer.unref?.();
  timer=setInterval(()=>runV264TbkhOpenAttemptLifecycle({reason:'CONTINUOUS_POLL'}),POLL_MS);timer.unref?.();
  console.log('[CE-QC][V264_TBKH_OPEN_ATTEMPT]',V264_TBKH_OPEN_ATTEMPT_ID,'enabled: TBKH OPEN attempts follow stored trajectory first, CE retry second; POD finalization/signing days remain locked by V246/V262.');
}
start();
