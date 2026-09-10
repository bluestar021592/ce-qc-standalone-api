import { getDb } from './db.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { applyV246StrictAttemptEvidence } from './v246TrackingLedgerCore.js';
import {
  listV483StrictExportRowGaps,
  applyV483StrictTruthToExportRows,
  repairV483StrictExportRows,
  V483_EXPORT_MEMBER_EVIDENCE_ID
} from './v381ExportEvidenceRepair.js';
import { recoverV485ArchivedTrackEvents, V485_STRICT_TRACK_EVIDENCE_ID } from './v485StrictTrackEvidence.js';
import { recoverV497ArchivedConfirmPodDates, V497_ARCHIVED_CONFIRM_POD_DATE_ID } from './v497ArchivedConfirmPodEvidence.js';

export const V484_STRICT_EXPORT_EVIDENCE_OWNER_ID='2026-09-09-v492-shopee-only-strict-export-evidence-v1';
const LOCAL_BATCH=220;
const V484_STRICT_EXPORT_EVIDENCE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);
const text=value=>String(value??'').trim();
const billOf=value=>text(value).toUpperCase();
const chunks=(values,size=LOCAL_BATCH)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};

// The V483/V484 attempt/signing evidence contract is Shopee-specific.
// TBKH has valid tracking events, but does not share the Shopee attempt/signing semantics,
// so formal TBKH export must not be blocked by this gate.
export function isV484StrictExportEvidenceType(type){return V484_STRICT_EXPORT_EVIDENCE_TYPES.has(text(type).toUpperCase());}

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

function persistAppliedEvidence(evidenceRows,db,reason){
  if(!evidenceRows.length)return 0;
  const persisted=applyV246StrictAttemptEvidence(evidenceRows,{db,reason});
  return Number(persisted?.updated||0);
}

function applyConfirmPodDates(gaps,evidenceByBill){
  let recovered=0;
  for(const record of gaps){
    if(text(record?.podDate))continue;
    const evidence=evidenceByBill.get(billOf(record?.shipmentCode));if(!evidence?.podDate)continue;
    let touched=false;
    for(const row of Array.isArray(record.rows)?record.rows:[]){
      if(!text(row.podDate)){row.podDate=evidence.podDate;touched=true;}
      if(!/\d{4}/.test(text(row.podTime)))row.podTime=evidence.timestamp||evidence.podDate;
      row.podSource='V497_V266_CONFIRM_TERMINAL_TIME';
      row.v497ArchivedConfirmPodDateId=V497_ARCHIVED_CONFIRM_POD_DATE_ID;
      row.v497ArchivedConfirmPodDateField=evidence.field||'';
    }
    if(touched){record.podDate=evidence.podDate;recovered+=1;}
  }
  return recovered;
}

async function applyConfirmArchivePass({businessType,range,rows,gaps,onProgress,mode}){
  const missingPod=gaps.filter(item=>!text(item?.podDate)),bills=missingPod.map(item=>billOf(item.shipmentCode)).filter(Boolean);
  if(!bills.length)return{podDateRecovered:0,filesConsidered:0,processedFiles:0,matchedFiles:0,requestBillsMatched:0,podDateBills:0,readErrors:0,truncated:false,unresolved:listV483StrictExportRowGaps(businessType,rows).length};
  const archive=await recoverV497ArchivedConfirmPodDates({range,targetBills:bills,mode,onProgress});
  const podDateRecovered=applyConfirmPodDates(missingPod,archive.evidenceByBill),remaining=listV483StrictExportRowGaps(businessType,rows).length;
  onProgress({phase:'strictExportEvidenceSavedDone',confirmArchive:true,confirmArchiveMode:mode,completed:archive.processedFiles,total:archive.filesConsidered,matchedFiles:archive.matchedFiles,requestBillsMatched:archive.requestBillsMatched,podDateBills:archive.podDateBills,readErrors:archive.readErrors,truncated:archive.truncated,podDateRecovered,unresolved:remaining,evidenceRepairVersion:V497_ARCHIVED_CONFIRM_POD_DATE_ID});
  return{...archive,podDateRecovered,unresolved:remaining};
}

async function applyArchivePass({businessType,range,rows,gaps,db,onProgress,mode}){
  const bills=gaps.map(item=>billOf(item.shipmentCode)).filter(Boolean);
  const archive=await recoverV485ArchivedTrackEvents({range,targetBills:bills,mode,onProgress});
  const evidenceRows=[];let resolved=0;
  for(const record of gaps){
    const bill=billOf(record.shipmentCode),events=archive.eventsByBill.get(bill)||[];
    if(!events.length)continue;
    const strict=analyzeV246ShopeeAttemptCycle(events,{podDate:record.podDate||''}),applied=applyV483StrictTruthToExportRows(record,strict);
    if(applied.attemptNo>0||applied.signingDays>0||applied.podDate)evidenceRows.push(applied.evidenceRow);
    if(applied.resolved)resolved+=1;
  }
  const updated=persistAppliedEvidence(evidenceRows,db,`V485_ARCHIVE_${String(mode||'').toUpperCase()}`),remaining=listV483StrictExportRowGaps(businessType,rows).length;
  onProgress({phase:'strictExportEvidenceArchiveDone',mode,completed:archive.processedFiles,total:archive.filesConsidered,matchedFiles:archive.matchedFiles,requestBillsMatched:archive.requestBillsMatched,eventBills:archive.eventBills,readErrors:archive.readErrors,truncated:archive.truncated,resolved,updated,unresolved:remaining,evidenceRepairVersion:V485_STRICT_TRACK_EVIDENCE_ID});
  return{...archive,resolved,updated,unresolved:remaining};
}

export async function repairV484StrictExportEvidence({type,range,rows=[],db=getDb(),client=null,onProgress=()=>{}}={}){
  const businessType=text(type).toUpperCase();
  if(!isV484StrictExportEvidenceType(businessType))return{ok:true,skipped:true,reason:'NON_STRICT_BUSINESS',total:0,localResolved:0,confirmPodRecovered:0,archiveResolved:0,remoteQueried:0,unresolved:0};

  let gaps=listV483StrictExportRowGaps(businessType,rows),initialTotal=gaps.length,completed=0,updated=0;
  onProgress({phase:'strictExportEvidenceSaved',completed:0,total:initialTotal,unresolved:initialTotal,localBatch:LOCAL_BATCH,evidenceRepairVersion:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID});
  for(const group of chunks(gaps)){
    const eventsByBill=savedEventsForGapGroup(businessType,group,db),evidenceRows=[];
    for(const record of group){
      const bill=billOf(record.shipmentCode),strict=analyzeV246ShopeeAttemptCycle(eventsByBill.get(bill)||[],{podDate:record.podDate||''});
      const applied=applyV483StrictTruthToExportRows(record,strict);
      if(applied.attemptNo>0||applied.signingDays>0||applied.podDate)evidenceRows.push(applied.evidenceRow);
    }
    updated+=persistAppliedEvidence(evidenceRows,db,'V484_EXPORT_MEMBER_SAVED');
    completed+=group.length;
    const remaining=listV483StrictExportRowGaps(businessType,rows).length;
    onProgress({phase:'strictExportEvidenceSaved',completed,total:initialTotal,updated,unresolved:remaining,localBatch:LOCAL_BATCH,evidenceRepairVersion:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID});
  }

  gaps=listV483StrictExportRowGaps(businessType,rows);
  const localResolved=Math.max(0,initialTotal-gaps.length);
  onProgress({phase:'strictExportEvidenceSavedDone',completed:initialTotal,total:initialTotal,updated,localResolved,unresolved:gaps.length,localBatch:LOCAL_BATCH,evidenceRepairVersion:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID});
  if(!gaps.length)return{ok:true,version:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID,businessType,total:initialTotal,localResolved,confirmPodRecovered:0,archiveResolved:0,remoteQueried:0,updated,unresolved:0};

  const confirmRecent=await applyConfirmArchivePass({businessType,range,rows,gaps,onProgress,mode:'recent'});
  gaps=listV483StrictExportRowGaps(businessType,rows);
  let confirmHistory={podDateRecovered:0,filesConsidered:0,processedFiles:0,matchedFiles:0,requestBillsMatched:0,podDateBills:0,readErrors:0,truncated:false,unresolved:gaps.length};
  if(gaps.some(item=>!text(item?.podDate))){confirmHistory=await applyConfirmArchivePass({businessType,range,rows,gaps,onProgress,mode:'history'});gaps=listV483StrictExportRowGaps(businessType,rows);}
  const confirmPodRecovered=Number(confirmRecent.podDateRecovered||0)+Number(confirmHistory.podDateRecovered||0);
  if(!gaps.length)return{ok:true,version:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID,businessType,total:initialTotal,localResolved,confirmPodRecovered,confirmRecent,confirmHistory,archiveResolved:0,remoteQueried:0,updated,unresolved:0};

  const recentArchive=await applyArchivePass({businessType,range,rows,gaps,db,onProgress,mode:'recent'});updated+=recentArchive.updated;
  gaps=listV483StrictExportRowGaps(businessType,rows);
  let historyArchive={resolved:0,updated:0,filesConsidered:0,processedFiles:0,matchedFiles:0,requestBillsMatched:0,eventBills:0,readErrors:0,truncated:false,unresolved:gaps.length};
  if(gaps.length){historyArchive=await applyArchivePass({businessType,range,rows,gaps,db,onProgress,mode:'history'});updated+=historyArchive.updated;gaps=listV483StrictExportRowGaps(businessType,rows);}
  const archiveResolved=Math.max(0,initialTotal-localResolved-gaps.length);
  if(!gaps.length)return{ok:true,version:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID,businessType,total:initialTotal,localResolved,confirmPodRecovered,confirmRecent,confirmHistory,archiveResolved,archiveRecent:recentArchive,archiveHistory:historyArchive,remoteQueried:0,updated,unresolved:0};

  let remote;
  try{
    remote=await repairV483StrictExportRows({type:businessType,range,rows,db,client,onProgress(info={}){onProgress({...info,v484Residual:true,evidenceRepairVersion:V483_EXPORT_MEMBER_EVIDENCE_ID,confirmPodRecovered,archiveResolved});}});
  }catch(error){
    if(error?.code==='V483_STRICT_EXPORT_EVIDENCE_INCOMPLETE'){
      const confirmRequestBillsMatched=Math.max(Number(confirmRecent.requestBillsMatched||0),Number(confirmHistory.requestBillsMatched||0)),confirmPodDateBills=Math.max(Number(confirmRecent.podDateBills||0),Number(confirmHistory.podDateBills||0));
      error.diagnostics={...(error.diagnostics||{}),v497ArchivedConfirmPodDateId:V497_ARCHIVED_CONFIRM_POD_DATE_ID,confirmPodRecovered,confirmRequestBillsMatched,confirmPodDateBills,confirmReadErrors:Number(confirmRecent.readErrors||0)+Number(confirmHistory.readErrors||0),confirmTruncated:Boolean(confirmRecent.truncated||confirmHistory.truncated)};
      error.message=`${error.message}:v497ConfirmRecovered=${confirmPodRecovered}:v497ConfirmMatched=${confirmRequestBillsMatched}:v497ConfirmPodDates=${confirmPodDateBills}`;
    }
    throw error;
  }
  return{...remote,ownerVersion:V484_STRICT_EXPORT_EVIDENCE_OWNER_ID,total:initialTotal,localResolved,confirmPodRecovered,confirmRecent,confirmHistory,archiveResolved,archiveRecent:recentArchive,archiveHistory:historyArchive,remoteQueried:Number(remote?.queried||0),updated:updated+Number(remote?.updated||0)};
}

console.info('[CE-QC][V492_STRICT_EXPORT_EVIDENCE_OWNER]',V484_STRICT_EXPORT_EVIDENCE_OWNER_ID,V485_STRICT_TRACK_EVIDENCE_ID,V497_ARCHIVED_CONFIRM_POD_DATE_ID,'formal CN/VN export keeps Shopee strict evidence repair; exact-member V266 confirm terminal timestamps may fill only real missing POD dates before track evidence; TBKH bypasses Shopee-only attempt/signing gate.');
