import { getDb, nowIso } from './db.js';
import { classifyV246Terminal } from './v246TrackingLedgerCore.js';

export const MANUAL_REFRESH_PUBLICATION_ID='2026-09-12-manual-refresh-publication-v2';
const CCSL_TYPES=new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);

function text(value=''){return String(value??'').trim();}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function dateKey(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function membershipKey(bill,type){return `${text(type).toUpperCase()}|${text(bill).toUpperCase()}`;}
function terminalOf(row={}){
  const payload=safeJson(row.stateJson,{});
  return classifyV246Terminal({state:row.state||payload.currentState||payload.scanNormalizedState||'',stateJson:payload});
}

export function publishManualRefreshTruth(refreshId,{db=getDb()}={}){
  const id=text(refreshId);
  if(!/^MANUAL-CARRY-/.test(id))return{ok:false,skipped:true,reason:'NOT_MANUAL_REFRESH_ID',publicationId:MANUAL_REFRESH_PUBLICATION_ID};
  const rows=db.prepare(`SELECT c.shipmentCode,UPPER(COALESCE(c.businessType,'')) businessType,c.state,c.apiStatus,c.lastEventTime,c.stateJson,c.updatedAt,
      o.sourceSnapshotId,o.sourceReportDate
    FROM shipment_current_state c
    LEFT JOIN carryover_open_items o ON o.shipmentCode=c.shipmentCode
    WHERE c.snapshotId=? ORDER BY c.shipmentCode`).all(id);
  if(!rows.length)return{ok:true,publicationId:MANUAL_REFRESH_PUBLICATION_ID,refreshId:id,published:0,terminalScanLocks:0,unbound:0,affectedDates:[]};

  const memberships=db.prepare(`WITH ranked AS (
      SELECT u.shipmentCode,UPPER(COALESCE(u.businessType,'')) businessType,u.snapshotId,u.reportDate,b.createdAt,u.id,
             ROW_NUMBER() OVER(PARTITION BY UPPER(COALESCE(u.businessType,'')),u.shipmentCode ORDER BY u.reportDate DESC,b.createdAt DESC,u.id DESC) rn
      FROM unified_import_rows u
      INNER JOIN unified_import_batches b ON b.snapshotId=u.snapshotId
      INNER JOIN shipment_current_state c ON c.shipmentCode=u.shipmentCode AND UPPER(COALESCE(c.businessType,''))=UPPER(COALESCE(u.businessType,''))
      WHERE c.snapshotId=? AND b.status='VALID'
    ) SELECT shipmentCode,businessType,snapshotId,reportDate FROM ranked WHERE rn=1`).all(id);
  const memberByBill=new Map(memberships.map(row=>[membershipKey(row.shipmentCode,row.businessType),row]));
  const allDates=db.prepare(`SELECT DISTINCT u.reportDate
      FROM unified_import_rows u
      INNER JOIN unified_import_batches b ON b.snapshotId=u.snapshotId
      INNER JOIN shipment_current_state c ON c.shipmentCode=u.shipmentCode AND UPPER(COALESCE(c.businessType,''))=UPPER(COALESCE(u.businessType,''))
      WHERE c.snapshotId=? AND b.status='VALID' AND u.reportDate<>'' ORDER BY u.reportDate`).all(id).map(row=>dateKey(row.reportDate)).filter(Boolean);

  const updateCurrent=db.prepare('UPDATE shipment_current_state SET snapshotId=?,reportDate=?,updatedAt=? WHERE shipmentCode=? AND snapshotId=?');
  const updateCcslScan=db.prepare("UPDATE scan_results SET isPod=?,needsTrackQuery=0,skipTrackReason=?,updatedAt=? WHERE shipmentCode=?");
  const updateBusinessScan=db.prepare("UPDATE business_scan_results SET isPod=?,needsTrackQuery=0,skipTrackReason=?,updatedAt=? WHERE businessType=? AND shipmentCode=?");
  const now=nowIso();
  let published=0,terminalScanLocks=0,unbound=0;
  const affected=new Set(allDates);
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of rows){
      const bill=text(row.shipmentCode).toUpperCase();
      const type=text(row.businessType).toUpperCase();
      const membership=memberByBill.get(membershipKey(bill,type))||null;
      const boundSnapshot=text(membership?.snapshotId||row.sourceSnapshotId);
      const boundDate=dateKey(membership?.reportDate||row.sourceReportDate);
      if(!boundSnapshot||!boundDate){unbound+=1;continue;}
      updateCurrent.run(boundSnapshot,boundDate,now,bill,id);
      affected.add(boundDate);
      const terminal=terminalOf(row);
      if(terminal.terminal){
        const reason=terminal.pod?'MANUAL_TERMINAL_POD':terminal.returned?'MANUAL_TERMINAL_RETURNED':'MANUAL_TERMINAL_CANCELLED';
        if(CCSL_TYPES.has(type))terminalScanLocks+=Number(updateCcslScan.run(terminal.pod?1:0,reason,now,bill).changes||0);
        else if(SHOPEE_TYPES.has(type)||type==='WHPP'){
          const storageType=SHOPEE_TYPES.has(type)?'SHOPEE':'WHPP';
          terminalScanLocks+=Number(updateBusinessScan.run(terminal.pod?1:0,reason,now,storageType,bill).changes||0);
        }
      }
      published+=1;
    }
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}

  let derivedRefresh=null;
  const dates=[...affected].filter(Boolean).sort();
  try{
    const refresh=globalThis.__CE_QC_REFRESH_LEDGER_DERIVED_DASHBOARDS__;
    if(typeof refresh==='function'&&dates.length)derivedRefresh=refresh(dates,'MANUAL_REFRESH_PUBLICATION');
  }catch(error){derivedRefresh={ok:false,error:error?.message||String(error)};}
  try{globalThis.__CE_QC_INVALIDATE_MANUAL_REFRESH_READ_CACHE__?.({refreshId:id,dates});}catch{}
  return{ok:true,publicationId:MANUAL_REFRESH_PUBLICATION_ID,refreshId:id,published,terminalScanLocks,unbound,affectedDates:dates,derivedRefresh};
}
