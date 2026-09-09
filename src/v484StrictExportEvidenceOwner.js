import { getDb } from './db.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { applyV246StrictAttemptEvidence } from './v246TrackingLedgerCore.js';
import {
  isV482StrictExportEvidenceType,
  listV483StrictExportRowGaps,
  applyV483StrictTruthToExportRows,
  repairV483StrictExportRows,
  V483_EXPORT_MEMBER_EVIDENCE_ID
} from './v381ExportEvidenceRepair.js';

export const V484_STRICT_EXPORT_EVIDENCE_OWNER_ID='2026-09-09-v484-actual-export-member-local-first-evidence-v1';
const LOCAL_BATCH=220;
const text=value=>String(value??'').trim();
const billOf=value=>text(value).toUpperCase();
const chunks=(values,size=LOCAL_BATCH)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};

export function isV484StrictExportEvidenceType(type){return isV482StrictExportEvidenceType(type);}

function pushEvents(result,rows=[],accept=()=>true){
  for(const row of rows){
    if(!accept(row))continue;
    const bill=billOf(row?.shipmentCode);if(!bill)continue;
    if(!result.has(bill))result.set(bill,[]);
    result.get(bill).push(row);
  }
}

function savedEventsForGapGroup(type,gaps,db){
  const businessType=text(type).toUpperCase(),bills=gaps.map(item=>billOf(item?.shipmentCode)).filter(Boolean),result=new Map(bills.map(bill=>[bill,[]]));
  if(!bills.length)return result;
  const marks=bills.map(()=>'?').join(',');
  if(businessType==='TBKH'){
    try{
      pushEvents(result,db.prepare(`SELECT shipmentCode,eventTime,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,rawJson,id
        FROM track_events WHERE shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...bills));
    }catch{}
    try{
      pushEvents(result,db.prepare(`SELECT shipmentCode,businessType,eventTime,eventCode,rawJson,id
        FROM business_track_events WHERE shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...bills),row=>text(row?.businessType).toUpperCase()==='TBKH');
    }catch{}
    return result;
  }
  try{
    pushEvents(result,db.prepare(`SELECT shipmentCode,businessType,eventTime,eventCode,rawJson,id
      FROM business_track_events WHERE shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...bills),row=>text(row?.businessType).toUpperCase()==='SHOPEE');
  }catch{}
  return result;
}

export async function repairV484StrictExportEvidence({type,range,rows=[],db=getDb(),client=null,onProgress=()=>{}}={}){
  const businessType=text(type).toUpperCase();
  if(!isV484StrictExportEvidenceType(businessType))return{ok:true,skipped:true,reason:'NON_STRICT_BUSINESS',total:0,localResolved:0,remoteQueried:0,unresolved:0};

  let gaps=listV483StrictExportRowGaps(businessType,rows),initialTotal=gaps.length,completed=0,updated=0;
  onProgress({phase:'strictExportEvidenceSaved',completed:0,total:initialTotal,unresolved:initialTotal,localBatch:LOCAL_BATCH,evidenceRepairVersion:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID});
  for(const group of chunks(gaps)){
    const eventsByBill=savedEventsForGapGroup(businessType,group,db),evidenceRows=[];
    for(const record of group){
      const bill=billOf(record.shipmentCode),strict=analyzeV246ShopeeAttemptCycle(eventsByBill.get(bill)||[],{podDate:record.podDate||''});
      const applied=applyV483StrictTruthToExportRows(record,strict);
      if(applied.attemptNo>0||applied.signingDays>0||applied.podDate)evidenceRows.push(applied.evidenceRow);
    }
    if(evidenceRows.length){const persisted=applyV246StrictAttemptEvidence(evidenceRows,{db,reason:'V484_EXPORT_MEMBER_SAVED'});updated+=Number(persisted?.updated||0);}
    completed+=group.length;
    const remaining=listV483StrictExportRowGaps(businessType,rows).length;
    onProgress({phase:'strictExportEvidenceSaved',completed,total:initialTotal,updated,unresolved:remaining,localBatch:LOCAL_BATCH,evidenceRepairVersion:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID});
  }

  gaps=listV483StrictExportRowGaps(businessType,rows);
  const localResolved=Math.max(0,initialTotal-gaps.length);
  onProgress({phase:'strictExportEvidenceSavedDone',completed:initialTotal,total:initialTotal,updated,localResolved,unresolved:gaps.length,localBatch:LOCAL_BATCH,evidenceRepairVersion:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID});
  if(!gaps.length)return{ok:true,version:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID,businessType,total:initialTotal,localResolved,remoteQueried:0,updated,unresolved:0};

  const remote=await repairV483StrictExportRows({type:businessType,range,rows,db,client,onProgress(info={}){onProgress({...info,v484Residual:true,evidenceRepairVersion:V483_EXPORT_MEMBER_EVIDENCE_ID});}});
  return{...remote,ownerVersion:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID,total:initialTotal,localResolved,remoteQueried:Number(remote?.queried||0),updated:updated+Number(remote?.updated||0)};
}

console.info('[CE-QC][V484_STRICT_EXPORT_EVIDENCE_OWNER]',V484_STRICT_EXPORT_EVIDENCE_OWNER_ID,'formal TBKH/CN/VN export no longer performs full-range V482 reconcile/backfill; actual export POD gaps read saved trajectory by bare shipmentCode first, then only residual gaps use V483 50x4.');
