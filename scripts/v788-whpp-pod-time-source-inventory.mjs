// V788 independent, read-only WHPP POD signing-time source inventory.
// Status 60 proves delivery success, not the delivery timestamp.
// No production access, no HTTP calls, no ledger/time-lock writes, no waybill IDs in results.
import {v788ReadSourceMembershipSignature,verifyV788PersistedSidecar}
  from './v788-whpp-tms-evidence-sidecar.mjs';
import {trustedWhppPodTime} from '../src/whppPodTimeEvidence.js';

const EXPLICIT_KEYS=[
  'podTime','POD时间','签收时间','podDateTime','podDate','deliveryTime',
  'deliveryCompletedAt','deliveredAt','deliveredTime','signedTime',
  'signedAt','signTime','signDateTime','actualDeliveryTime'
];
const SOURCE_KEYS=['sidecar','podLock','savedTrack','savedEvent','savedScan','savedFinal'];
const norm=value=>String(value||'').trim().toUpperCase();
function safeJson(raw){
  // Stored rows arrive as JSON text, but callers may have already parsed
  // the TMS payload. Parsing "[object Object]" would silently drop real
  // explicitly signed time fields and misreport missing POD evidence.
  if(raw&&typeof raw==='object'&&!Array.isArray(raw))return raw;
  try{
    const obj=JSON.parse(String(raw||'{}'));
    return obj&&typeof obj==='object'&&!Array.isArray(obj)?obj:{};
  }catch{return {}}
}
function pickExplicitAll(raw,source,date){
  const obj=safeJson(raw),values=new Set();
  // Inspect ALL explicitly named signing fields. Picking only the first
  // would silently hide two contradictory POD times within the SAME row.
  for(const key of EXPLICIT_KEYS){
    const value=trustedWhppPodTime({source,podTime:obj[key]},date);
    if(value)values.add(value);
  }
  return [...values];
}
function tablePresent(db,name){
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name);
}
function limitedRows(stmt,...args){return stmt?stmt.all(...args):[]}
export function summarizeV788WhppPodTimeSources(sourceDb,proofDb,expectedSignature=''){
  if(!sourceDb||!proofDb)throw Error('V788_POD_TIME_READONLY_HANDLES_REQUIRED');
  // Caller supplies two isolated READ-ONLY handles. This function executes
  // only prepared SELECT statements and does not change connection pragmas:
  // setting query_only on a caller-owned handle would accidentally lock later
  // separate test transactions on that same SQLite connection.
  const proof=verifyV788PersistedSidecar(proofDb,expectedSignature);
  if(proof.verified!==true)return{
    available:false,reason:'TMS_SIDECAR_NOT_VERIFIED',
    signingTimeAccepted:false,productionModified:false
  };
  if(v788ReadSourceMembershipSignature(sourceDb)!==expectedSignature)return{
    available:false,reason:'ISOLATED_SOURCE_SIGNATURE_MISMATCH',
    signingTimeAccepted:false,productionModified:false
  };
  const exists=Object.fromEntries([
    ['podLock','business_pod_locks'],['savedTrack','business_shipment_tracks'],
    ['savedEvent','business_track_events'],
    ['savedScan','business_scan_results'],['savedFinal','business_final_rows']
  ].map(([key,table])=>[key,tablePresent(sourceDb,table)]));
  const statements={
    podLock:exists.podLock?sourceDb.prepare("SELECT podTime,source FROM business_pod_locks WHERE businessType='WHPP' AND shipmentCode=?"):null,
    savedTrack:exists.savedTrack?sourceDb.prepare("SELECT shipmentStatus,rawJson FROM business_shipment_tracks WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=?"):null,
    savedEvent:exists.savedEvent?sourceDb.prepare("SELECT rawJson FROM business_track_events WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=? ORDER BY id"):null,
    savedScan:exists.savedScan?sourceDb.prepare("SELECT isPod,orderStatus,rawJson FROM business_scan_results WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=?"):null,
    savedFinal:exists.savedFinal?sourceDb.prepare("SELECT isPod,rawJson FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=?"):null
  };
  const rows=proofDb.prepare("SELECT reportDate,shipmentCode,shipmentStatus,explicitPodTime FROM v788_tms_evidence ORDER BY reportDate,shipmentCode").all();
  const sourceCounts=Object.fromEntries(SOURCE_KEYS.map(k=>[k,0]));
  const byDate=Object.fromEntries(['2026-07-01','2026-07-02'].map(date=>[date,{
    podMembers:0,timeCandidateMembers:0,missingTimeMembers:0,
    conflictingTimeMembers:0,ambiguousSourceMembers:0,manualReviewMembers:0,
    unambiguousTimeCandidateMembers:0
  }]));
  const seenCodes=new Set();
  let podMembers=0,timeCandidateMembers=0,missingTimeMembers=0,conflictingTimeMembers=0;
  let ambiguousSourceMembers=0,manualReviewMembers=0,unambiguousTimeCandidateMembers=0;
  let invalidOrAmbiguousRows=0;
  for(const row of rows){
    const code=norm(row.shipmentCode),date=String(row.reportDate||'');
    // Legacy POD locks are keyed by business + waybill, without source
    // date. Do not reuse one lock across distinct historical date members.
    if(seenCodes.has(code))return{
      available:false,reason:'CROSS_DATE_WAYBILL_ID_AMBIGUOUS',
      signingTimeAccepted:false,productionModified:false
    };
    seenCodes.add(code);
    if(row.shipmentStatus!=='60')continue;
    if(!Object.hasOwn(byDate,date))return{
      available:false,reason:'UNEXPECTED_POD_SOURCE_DATE',
      signingTimeAccepted:false,productionModified:false
    };
    podMembers++;byDate[date].podMembers++;
    const times=new Set(),found=new Set();
    let sourceAmbiguous=false;
    const add=(source,candidates)=>{
      for(const time of candidates||[]){
        if(!time)continue;
        found.add(source);
        times.add(time);
      }
    };
    add('sidecar',[trustedWhppPodTime({
      source:'whpp_shipment_status_60_explicit_pod_time',
      podTime:row.explicitPodTime
    },date)]);
    const locks=limitedRows(statements.podLock,code);
    if(locks.length>1){invalidOrAmbiguousRows++;sourceAmbiguous=true;}
    else if(locks.length===1)
      add('podLock',[trustedWhppPodTime(locks[0],date)]);
    const tracks=limitedRows(statements.savedTrack,date,code);
    if(tracks.length>1){invalidOrAmbiguousRows++;sourceAmbiguous=true;}
    else if(tracks.length===1&&String(tracks[0].shipmentStatus)==='60'){
      const saved=safeJson(tracks[0].rawJson);
      if(saved.shipmentStatus&&String(saved.shipmentStatus).trim()!=='60'){
        invalidOrAmbiguousRows++;sourceAmbiguous=true;
      }else add('savedTrack',pickExplicitAll(saved,
        'whpp_shipment_status_60_explicit_pod_time',date));
    }
    // Stored event history may carry explicit signedAt/POD time, but its
    // generic eventTime/creationDate/lastUpdateDate is never a POD timestamp.
    // Sidecar has independently attested that this exact member is TMS 60.
    const events=limitedRows(statements.savedEvent,date,code);
    for(const event of events){
      add('savedEvent',pickExplicitAll(event.rawJson,'whpp_strict_track_event',date));
    }
    const scans=limitedRows(statements.savedScan,date,code);
    if(scans.length>1){invalidOrAmbiguousRows++;sourceAmbiguous=true;}
    else if(scans.length===1
      &&(Number(scans[0].isPod)===1||String(scans[0].orderStatus)==='85'))
      add('savedScan',pickExplicitAll(scans[0].rawJson,'whpp_saved_scan_pod_time',date));
    const finals=limitedRows(statements.savedFinal,date,code);
    if(finals.length>1){invalidOrAmbiguousRows++;sourceAmbiguous=true;}
    else if(finals.length===1&&Number(finals[0].isPod)===1)
      add('savedFinal',pickExplicitAll(finals[0].rawJson,'whpp_saved_final_pod_time',date));
    for(const source of found)sourceCounts[source]++;
    if(!times.size){missingTimeMembers++;byDate[date].missingTimeMembers++;}
    else{timeCandidateMembers++;byDate[date].timeCandidateMembers++;}
    if(times.size>1){conflictingTimeMembers++;byDate[date].conflictingTimeMembers++;}
    if(sourceAmbiguous){ambiguousSourceMembers++;byDate[date].ambiguousSourceMembers++;}
    if(times.size>1||sourceAmbiguous){
      manualReviewMembers++;byDate[date].manualReviewMembers++;
    }else if(times.size===1){
      unambiguousTimeCandidateMembers++;
      byDate[date].unambiguousTimeCandidateMembers++;
    }
  }
  // This is an inventory of explicit saved timestamps, NOT approval to
  // regenerate a signing-day KPI or to update formal POD locks.
  return{
    version:'V788_WHPP_POD_TIME_SOURCE_INVENTORY_V1',
    available:true,reason:'CANDIDATES_FOR_MANUAL_EVIDENCE_REVIEW',
    podMembers,timeCandidateMembers,missingTimeMembers,conflictingTimeMembers,
    unambiguousTimeCandidateMembers,
    ambiguousSourceMembers,manualReviewMembers,
    ambiguousSourceRows:invalidOrAmbiguousRows,
    bySource:sourceCounts,byDate,
    sourceTablesPresent:exists,
    independentTmsStatusVerified:true,
    signingTimeAccepted:false,formalSigningDaysAccepted:false,
    historicalLedgerModified:false,productionModified:false,
    note:'只读取D盘验收副本和证据SQLite，明确时间字段为候选证据；状态60本身、更新时间和文件时间均不能当作签收时间。'
  };
}
