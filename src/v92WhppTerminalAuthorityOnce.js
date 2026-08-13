import crypto from 'node:crypto';
import { getDb, nowIso } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';
import { V92_WHPP_TERMINAL_AUTHORITY_ID, repairWhppTerminalAuthority } from './v92WhppTerminalAuthority.js';

const META_KEY='v92_whpp_terminal_authority_last_run';
const SUMMARY_META_KEY='v92_whpp_completed_summary_reconciled_v2';
function safe(value){try{return JSON.parse(String(value||''))||{};}catch{return{};}}
function upper(value){return String(value??'').trim().toUpperCase();}
function billOf(row={}){return upper(row.shipmentCode||row.运单号||row.waybill||'');}
function unique(values=[]){return [...new Set(values.map(value=>String(value||'').trim()).filter(Boolean))];}

function loadCompletedDateState(db,date){
  const dailyRows=db.prepare("SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY id").all(date)
    .map(row=>({...safe(row.rowJson),shipmentCode:upper(row.shipmentCode),businessType:'WHPP',reportDate:date}));
  const finalRows=db.prepare("SELECT shipmentCode,rawJson FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode").all(date)
    .map(row=>({...safe(row.rawJson),shipmentCode:upper(row.shipmentCode),businessType:'WHPP',reportDate:date}));
  return{businessType:'WHPP',reportDate:date,pnhBills:dailyRows.map(billOf),dailyParseRows:dailyRows,finalRows};
}

function metricSignature(metrics={}){
  const keys=['total','pod','returned','cancelled','unresolved','pending1','pending2','pending3','pendingNonContinuous','oc1','oc2','oc3','cycle2','inboundNoScan','delivery','workOrder','phnomPenhShop','provinceShop'];
  return Object.fromEntries(keys.map(key=>[key,Number(metrics?.[key]||0)]));
}
function sameMetrics(a={},b={}){return JSON.stringify(metricSignature(a))===JSON.stringify(metricSignature(b));}

function createReconciledSnapshot(db,date,state,dashboard,now){
  const snapshotId=`WHPP-V92-SUMMARY-${date}-${crypto.randomUUID()}`;
  const compact={...state,snapshotId,snapshotStatus:'COMPLETED',terminalAuthorityVersion:V92_WHPP_TERMINAL_AUTHORITY_ID};
  const payload={state:compact,dashboard:{...dashboard,snapshotId},status:'VALID',reconciliationStatus:'COMPLETED',repair:{patchId:V92_WHPP_TERMINAL_AUTHORITY_ID,reason:'COMPLETED_HISTORY_RECONCILED_TO_NORMALIZED_TERMINAL_TRUTH',generatedAt:now}};
  db.prepare('INSERT INTO business_export_snapshots(snapshotId,businessType,reportDate,runId,payloadJson,generatedAt,createdAt) VALUES(?,?,?,?,?,?,?)')
    .run(snapshotId,'WHPP',date,'V92_TERMINAL_AUTHORITY',JSON.stringify(payload),now,now);
  db.prepare('INSERT INTO business_history_summary(businessType,reportDate,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?) ON CONFLICT(businessType,reportDate) DO UPDATE SET summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt')
    .run('WHPP',date,JSON.stringify({...dashboard.metrics,accounting:dashboard.accounting,snapshotId,terminalAuthorityVersion:V92_WHPP_TERMINAL_AUTHORITY_ID}),now,now);
  return snapshotId;
}

function reconcileCompletedWhppHistory(db){
  const meta=safe(db.prepare('SELECT value FROM app_meta WHERE key=?').get(SUMMARY_META_KEY)?.value);
  if(meta.patchId===V92_WHPP_TERMINAL_AUTHORITY_ID)return{skipped:true,checked:Number(meta.checked||0),rebuilt:Number(meta.rebuilt||0),dates:meta.dates||[]};

  const completedDates=db.prepare("SELECT DISTINCT reportDate FROM business_export_snapshots WHERE businessType='WHPP' AND COALESCE(runId,'')<>'V92_TERMINAL_AUTHORITY' ORDER BY reportDate").all().map(row=>String(row.reportDate||'')).filter(Boolean);
  const now=nowIso();
  const rebuilt=[];
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const date of completedDates){
      const state=loadCompletedDateState(db,date);
      if(!state.pnhBills.length||!state.finalRows.length)continue;
      const dashboard=buildWhppDashboard(state);
      const history=safe(db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=?").get(date)?.summaryJson);
      const latestSnapshot=db.prepare("SELECT payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC,id DESC LIMIT 1").get(date);
      const snapshotPayload=safe(latestSnapshot?.payloadJson);
      const snapshotMetrics=snapshotPayload?.dashboard?.metrics||snapshotPayload?.view?.metrics||{};
      if(!sameMetrics(history,dashboard.metrics)||!sameMetrics(snapshotMetrics,dashboard.metrics)){
        createReconciledSnapshot(db,date,state,dashboard,now);
        rebuilt.push(date);
      }
    }
    db.prepare('INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt')
      .run(SUMMARY_META_KEY,JSON.stringify({patchId:V92_WHPP_TERMINAL_AUTHORITY_ID,checked:completedDates.length,rebuilt:rebuilt.length,dates:rebuilt,runAt:now}),now);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return{skipped:false,checked:completedDates.length,rebuilt:rebuilt.length,dates:rebuilt};
}

function cleanupPrematureRepairSnapshots(db,dates=[]){
  let removed=0;
  for(const date of dates||[]){
    const prior=db.prepare("SELECT 1 FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? AND COALESCE(runId,'')<>'V92_TERMINAL_AUTHORITY' LIMIT 1").get(date);
    if(prior)continue;
    const result=db.prepare("DELETE FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? AND runId='V92_TERMINAL_AUTHORITY'").run(date);
    removed+=Number(result.changes||0);
    const history=safe(db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=?").get(date)?.summaryJson);
    if(String(history.snapshotId||'').startsWith('WHPP-V92-'))db.prepare("DELETE FROM business_history_summary WHERE businessType='WHPP' AND reportDate=?").run(date);
  }
  return removed;
}

function ensureDerivedTerminalRows(db){
  const rows=db.prepare("SELECT reportDate,shipmentCode,isPod,primaryCategory,latestEventTime,rawJson FROM business_final_rows WHERE businessType='WHPP' AND COALESCE(json_extract(rawJson,'$.terminalAuthority'),0)=1").all();
  if(!rows.length)return 0;
  const now=nowIso();
  const current=db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt)
    VALUES(?,'WHPP',?,?,?,'SUCCESS',?,?,?)
    ON CONFLICT(shipmentCode) DO UPDATE SET businessType='WHPP',reportDate=excluded.reportDate,snapshotId=CASE WHEN COALESCE(shipment_current_state.snapshotId,'')='' THEN excluded.snapshotId ELSE shipment_current_state.snapshotId END,state=excluded.state,apiStatus='SUCCESS',lastEventTime=excluded.lastEventTime,stateJson=excluded.stateJson,updatedAt=excluded.updatedAt`);
  const carry=db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt)
    VALUES(?,'WHPP',?,?,?,?,?,'SUCCESS',?,?,?,?)
    ON CONFLICT(shipmentCode) DO UPDATE SET businessType='WHPP',lastReportDate=excluded.lastReportDate,lastSnapshotId=excluded.lastSnapshotId,status='CLOSED',apiStatus='SUCCESS',closeReason=excluded.closeReason,stateJson=excluded.stateJson,updatedAt=excluded.updatedAt`);
  const podLock=db.prepare("INSERT INTO business_pod_locks(businessType,shipmentCode,podTime,source,createdAt,updatedAt) VALUES('WHPP',?,?,'V92_TERMINAL_AUTHORITY',?,?) ON CONFLICT(businessType,shipmentCode) DO UPDATE SET podTime=excluded.podTime,source=excluded.source,updatedAt=excluded.updatedAt");
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of rows){
      const raw=safe(row.rawJson), state=upper(raw.currentState)||(Number(row.isPod||0)===1?'POD':String(row.primaryCategory||''));
      if(!['POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED'].includes(state))continue;
      const closeReason=state==='RETURNED'?'RETURN_COMPLETED':state;
      const snapshot=db.prepare("SELECT snapshotId FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC,id DESC LIMIT 1").get(row.reportDate)?.snapshotId||`V92-${row.reportDate}`;
      const at=String(row.latestEventTime||raw.terminalObservedAt||'');
      current.run(row.shipmentCode,row.reportDate,snapshot,closeReason,at,row.rawJson,now);
      carry.run(row.shipmentCode,row.reportDate,row.reportDate,snapshot,snapshot,'CLOSED',closeReason,row.rawJson,now,now);
      if(closeReason==='POD')podLock.run(row.shipmentCode,at,now,now);
    }
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return rows.length;
}

export function repairWhppTerminalAuthorityOnce(db=getDb()){
  const previous=safe(db.prepare('SELECT value FROM app_meta WHERE key=?').get(META_KEY)?.value);
  let result;
  if(previous.patchId===V92_WHPP_TERMINAL_AUTHORITY_ID){
    result={patchId:V92_WHPP_TERMINAL_AUTHORITY_ID,skipped:true,reason:'ALREADY_RECONCILED',scanned:Number(previous.scanned||0),repaired:Number(previous.repaired||0),affectedDates:previous.affectedDates||[]};
  }else{
    result=repairWhppTerminalAuthority(db);
    if(!result.repaired){const now=nowIso();db.prepare('INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt').run(META_KEY,JSON.stringify({...result,runAt:now}),now);}
  }
  const prematureSnapshotsRemoved=cleanupPrematureRepairSnapshots(db,result.affectedDates||[]);
  const derivedTerminalRowsEnsured=ensureDerivedTerminalRows(db);
  const completedHistory=reconcileCompletedWhppHistory(db);
  return{...result,prematureSnapshotsRemoved,derivedTerminalRowsEnsured,completedHistory};
}
