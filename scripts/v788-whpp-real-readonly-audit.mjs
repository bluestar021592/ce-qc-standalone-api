import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { trustedWhppPodTime } from '../src/whppPodTimeEvidence.js';

// V788 read-only acceptance audit. Never prints shipment identifiers, names,
// phone numbers, addresses, raw JSON or the database path. No writes, API calls,
// cache regeneration, VACUUM, or application startup side effects.
const VERSION='V788_WHPP_REAL_READONLY_AUDIT_V3';

function safeObject(value){
  try { const v=JSON.parse(String(value||'{}')); return v&&typeof v==='object'?v:{}; }
  catch { return {}; }
}
function validateActive72(db){
  const stored=db.prepare("SELECT value FROM app_meta WHERE key='shop_current_complete_codes_v780'").get();
  if(!stored)return {status:'MISSING',count:0,uniqueCount:0};
  const config=safeObject(stored.value);
  const members=Array.isArray(config.members)?config.members:[];
  const codes=members.map(m=>String(m?.code||'').trim().toUpperCase());
  const valid=config.mode==='COMPLETE'&&members.length===72&&new Set(codes).size===72
    &&members.every((m,i)=>/^(?:(?:CP|FS)\d{6}|(?:PV|PNH)\d{3})$/.test(codes[i])
      &&String(m?.name||'').trim().length>0);
  return {status:valid?'ACTIVE_72':'INVALID',count:members.length,uniqueCount:new Set(codes).size};
}
function truthCategory(state,status){
  if(status==='60')return state==='POD'?'strictPOD':'contradiction';
  if(status==='81')return ['RETURNED','RETURN_COMPLETED'].includes(state)?'strictReturned':'contradiction';
  if(status==='80')return ['POD','RETURNED','RETURN_COMPLETED'].includes(state)?'contradiction':'returning80';
  if(['POD','RETURNED','RETURN_COMPLETED'].includes(state))return 'labelOnlyTerminal';
  return 'otherUnverified';
}
function emptyDay(date){
  return {date,sourceMembers:0,withCurrent:0,strictPOD:0,strictReturned:0,returning80:0,
    contradiction:0,labelOnlyTerminal:0,otherUnverified:0,
    scannedMembers:0,finalizedMembers:0,withExplicitPodTime:0,
    ledgerOpenWithStrictTerminal:0,scanAndFinalComplete:false,
    allStrictTerminalEvidence:false,eligibleForStrictExportFallback:false,
    normalizedPOD:0,normalizedReturned:0,normalizedNonterminal:0,
    scanPOD:0,finalPOD:0,finalReturnCompleted:0,
    matchedPODAgainstScanOrFinal:0,matchedReturnAgainstFinal:0,
    conflictingTerminalEvidence:0,explicitPODTimeFromSavedEvidence:0,
    tms60InOtherEvidence:0,tms81InOtherEvidence:0,
    hasFullMembershipNotVerifiedOutcome:false,
    savedPodLockMembers:0,trustedPodLockOnPOD:0,rejectedPodLockOnPOD:0,
    trustedPodLockOnNonPOD:0,ledgerOpenWithNormalizedTerminal:0,
    ledgerTerminalWithNonterminal:0,ledgerTerminalContradictingTms:0,
    trustedPodTimeCoveragePct:null,podLockTablePresent:false};
}
function fullDateFromEvidence(value){
  const s=String(value||'').trim();
  const match=s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T].*)?$/);
  if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const probe=new Date(Date.UTC(year,month-1,day));
  return probe.getUTCFullYear()===year&&probe.getUTCMonth()+1===month&&probe.getUTCDate()===day;
}
function explicitPODDate(...payloads){
  const keys=['POD时间','podTime','podDate','podAt','podClosedAt',
    'deliveredAt','deliveryCompletedAt','签收时间'];
  for(const payload of payloads){
    if(!payload||typeof payload!=='object')continue;
    for(const key of keys)if(fullDateFromEvidence(payload[key]))return true;
  }
  return false;
}
function terminalStatusFrom(row={}){
  return String(row.shipmentStatus||row?.shipmentTrack?.shipmentStatus||'').trim();
}
function isFinalCompletedReturn(row={}){
  return ['已退回','退回完成','RETURNED','RETURN_COMPLETED']
    .includes(String(row.primaryCategory||row['退回状态']||row.currentState||'').trim().toUpperCase());
}
const GROUPS=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
// Same newest completed VALID batch selection as the seven-business export.
// These are source-membership counts, NOT claims that API terminal evidence
// or the exported file's row-level contents have been verified.
function sevenBusinessSourceConservation(db,whppRows=[]){
  const table=n=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n));
  if(!['unified_import_batches','unified_snapshots','unified_import_rows'].every(table))
    return {available:false,reason:'UNIFIED_SOURCE_TABLES_MISSING',byDate:[]};
  const latest=new Map();
  const batches=db.prepare("SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId FROM unified_import_batches b "+
    "JOIN unified_snapshots s ON s.snapshotId=b.snapshotId "+
    "WHERE b.status='VALID' AND s.status='COMPLETED' ORDER BY b.reportDate ASC,b.createdAt DESC,b.batchId DESC").all();
  for(const b of batches)if(!latest.has(b.reportDate))latest.set(b.reportDate,b);
  const whppByDate=new Map();
  for(const row of whppRows){
    const date=String(row.reportDate||'');
    if(!whppByDate.has(date))whppByDate.set(date,new Set());
    whppByDate.get(date).add(String(row.shipmentCode||'').trim().toUpperCase());
  }
  const dates=[...new Set([...latest.keys(),...whppByDate.keys()])].sort();
  const sourceBySnapshot=db.prepare("SELECT businessType,UPPER(TRIM(shipmentCode)) code FROM unified_import_rows WHERE snapshotId=?");
  const byDate=dates.map(date=>{
    const batch=latest.get(date);
    const whpp=whppByDate.get(date)||new Set();
    const groups=Object.fromEntries(GROUPS.map(x=>[x,0]));
    const seenByGroup=new Set(),unifiedCodes=new Set();
    let unifiedRows=0,duplicateBusinessRows=0,outOfScopeRows=0;
    if(batch){
      for(const row of sourceBySnapshot.all(batch.snapshotId)){
        const group=String(row.businessType||'').trim().toUpperCase();
        const bill=String(row.code||'').trim().toUpperCase();
        if(!GROUPS.includes(group)||!bill){outOfScopeRows++;continue}
        unifiedRows++;
        const key=group+'|'+bill;
        if(seenByGroup.has(key)){duplicateBusinessRows++;continue}
        seenByGroup.add(key);
        groups[group]++;
        unifiedCodes.add(bill);
      }
    }
    const uniqueBusinessEntries=Object.values(groups).reduce((a,b)=>a+b,0);
    const crossBusinessDuplicates=uniqueBusinessEntries-unifiedCodes.size;
    const whppOverlap=[...whpp].filter(bill=>unifiedCodes.has(bill)).length;
    const union=new Set([...unifiedCodes,...whpp]).size;
    const sourceSum=uniqueBusinessEntries+whpp.size;
    return {date,completedValidUnifiedBatch:Boolean(batch),sixBusinessRows:unifiedRows,
      sixBusinessCounts:groups,sixBusinessUniqueWithinGroups:uniqueBusinessEntries,
      duplicateBusinessRows,crossBusinessDuplicates,outOfScopeRows,
      whppIndependentSourceMembers:whpp.size,whppOverlapWithSix:whppOverlap,
      sevenBusinessSourceSum:sourceSum,sevenBusinessDistinctUnion:union,
      reconciled:sourceSum===union&&duplicateBusinessRows===0&&outOfScopeRows===0};
  });
  return {available:true,scope:'LATEST_VALID_COMPLETED_SOURCE_MEMBERSHIP_ONLY',
    caveat:'Source conservation does not verify actual exported file contents, POD completion or signing timing.',
    datesChecked:byDate.length,byDate};
}
export function auditV788Readonly(db){
  db.exec('PRAGMA query_only=ON');
  const active72=validateActive72(db);
  const rows=db.prepare("SELECT DISTINCT reportDate, UPPER(TRIM(shipmentCode)) shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY reportDate,shipmentCode").all();
  const findCurrent=db.prepare("SELECT state,stateJson FROM shipment_current_state WHERE shipmentCode=? AND businessType='WHPP' AND reportDate=?");
  const findLedger=db.prepare("SELECT trackingStatus,terminalReason FROM qc_tracking_ledger WHERE shipmentCode=? AND businessType='WHPP'");
  const findScan=db.prepare("SELECT isPod,orderStatus,rawJson FROM business_scan_results WHERE shipmentCode=? AND businessType='WHPP' AND reportDate=? LIMIT 1");
  const findFinal=db.prepare("SELECT isPod,primaryCategory,rawJson FROM business_final_rows WHERE shipmentCode=? AND businessType='WHPP' AND reportDate=? LIMIT 1");
  const podLockTablePresent=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_pod_locks'").get());
  const findPodLock=podLockTablePresent?db.prepare("SELECT podTime,source FROM business_pod_locks WHERE businessType='WHPP' AND shipmentCode=? LIMIT 1"):null;
  const days=new Map();
  for(const row of rows){
    const day=String(row.reportDate||'');
    if(!days.has(day))days.set(day,emptyDay(day));
    const d=days.get(day);d.sourceMembers++;
    const current=findCurrent.get(row.shipmentCode,day);
    const raw=safeObject(current?.stateJson);
    const state=String(current?.state||raw.currentState||'').trim().toUpperCase();
    const status=String(raw.shipmentStatus||raw?.shipmentTrack?.shipmentStatus||'').trim();
    const bucket=truthCategory(state,status);
    d[bucket]++;
    if(current)d.withCurrent++;
    if(bucket==='strictPOD'){
      const podTime=String(raw.podTime||raw['POD时间']||raw.podAt||raw.deliveredAt||'').trim();
      if(podTime)d.withExplicitPodTime++;
    }
    const scan=findScan.get(row.shipmentCode,day);
    const final=findFinal.get(row.shipmentCode,day);
    const scanRaw=safeObject(scan?.rawJson);
    const finalRaw=safeObject(final?.rawJson);
    if(scan)d.scannedMembers++;
    if(final)d.finalizedMembers++;
    const normalizedPOD=state==='POD';
    const normalizedReturned=['RETURNED','RETURN_COMPLETED'].includes(state);
    if(normalizedPOD)d.normalizedPOD++;
    else if(normalizedReturned)d.normalizedReturned++;
    else d.normalizedNonterminal++;
    d.podLockTablePresent=podLockTablePresent;
    const lock=findPodLock?.get(row.shipmentCode);
    const trustedLock=lock?trustedWhppPodTime(lock,day):'';
    if(lock)d.savedPodLockMembers++;
    if(normalizedPOD){
      if(trustedLock)d.trustedPodLockOnPOD++;
      else if(lock)d.rejectedPodLockOnPOD++;
    }else if(trustedLock)d.trustedPodLockOnNonPOD++;
    const scanPOD=Boolean(scan)&&(Number(scan.isPod||0)===1||String(scan.orderStatus||'')==='85');
    const finalPOD=Boolean(final)&&Number(final.isPod||0)===1;
    const finalReturned=Boolean(final)&&isFinalCompletedReturn({...finalRaw,primaryCategory:final.primaryCategory});
    if(scanPOD)d.scanPOD++;
    if(finalPOD)d.finalPOD++;
    if(finalReturned)d.finalReturnCompleted++;
    if(normalizedPOD&&(scanPOD||finalPOD))d.matchedPODAgainstScanOrFinal++;
    if(normalizedReturned&&finalReturned)d.matchedReturnAgainstFinal++;
    if((normalizedPOD&&finalReturned)||(normalizedReturned&&(scanPOD||finalPOD)))
      d.conflictingTerminalEvidence++;
    if(normalizedPOD&&explicitPODDate(raw,scanRaw,finalRaw))
      d.explicitPODTimeFromSavedEvidence++;
    if(terminalStatusFrom(scanRaw)==='60'||terminalStatusFrom(finalRaw)==='60')
      d.tms60InOtherEvidence++;
    if(terminalStatusFrom(scanRaw)==='81'||terminalStatusFrom(finalRaw)==='81')
      d.tms81InOtherEvidence++;
    const ledger=findLedger.get(row.shipmentCode);
    const ledgerState=String(ledger?.trackingStatus||'').toUpperCase();
    const ledgerReason=String(ledger?.terminalReason||'').toUpperCase();
    if(ledgerState==='OPEN'&&(normalizedPOD||normalizedReturned))
      d.ledgerOpenWithNormalizedTerminal++;
    if(ledgerState==='TERMINAL'&&!normalizedPOD&&!normalizedReturned)
      d.ledgerTerminalWithNonterminal++;
    if(ledgerState==='TERMINAL'&&(
      bucket==='contradiction'||bucket==='returning80'
      ||(ledgerReason==='POD'&&normalizedReturned)
      ||(ledgerReason==='RETURNED'&&normalizedPOD)))
      d.ledgerTerminalContradictingTms++;
    if((bucket==='strictPOD'||bucket==='strictReturned')&&String(ledger?.trackingStatus||'').toUpperCase()==='OPEN')
      d.ledgerOpenWithStrictTerminal++;
  }
  const byDate=[...days.values()];
  for(const d of byDate){
    d.scanAndFinalComplete=d.sourceMembers>0&&d.scannedMembers===d.sourceMembers&&d.finalizedMembers===d.sourceMembers;
    d.allStrictTerminalEvidence=d.sourceMembers>0&&(d.strictPOD+d.strictReturned)===d.sourceMembers;
    d.eligibleForStrictExportFallback=d.allStrictTerminalEvidence&&!d.scanAndFinalComplete;
    d.hasFullMembershipNotVerifiedOutcome=d.scanAndFinalComplete&&!d.allStrictTerminalEvidence;
    d.trustedPodTimeCoveragePct=d.normalizedPOD>0
      ?Math.round(d.trustedPodLockOnPOD/d.normalizedPOD*10000)/100:null;
  }
  const totals=emptyDay('ALL');
  for(const d of byDate){
    for(const key of ['sourceMembers','withCurrent','strictPOD','strictReturned','returning80',
      'contradiction','labelOnlyTerminal','otherUnverified','scannedMembers','finalizedMembers',
      'withExplicitPodTime','ledgerOpenWithStrictTerminal','normalizedPOD','normalizedReturned',
      'normalizedNonterminal','scanPOD','finalPOD','finalReturnCompleted',
      'matchedPODAgainstScanOrFinal','matchedReturnAgainstFinal',
      'conflictingTerminalEvidence','explicitPODTimeFromSavedEvidence',
      'tms60InOtherEvidence','tms81InOtherEvidence',
      'savedPodLockMembers','trustedPodLockOnPOD','rejectedPodLockOnPOD',
      'trustedPodLockOnNonPOD','ledgerOpenWithNormalizedTerminal',
      'ledgerTerminalWithNonterminal','ledgerTerminalContradictingTms'])totals[key]+=d[key];
  }
  totals.scanAndFinalComplete=totals.sourceMembers>0&&totals.scannedMembers===totals.sourceMembers
    &&totals.finalizedMembers===totals.sourceMembers;
  totals.allStrictTerminalEvidence=totals.sourceMembers>0&&(totals.strictPOD+totals.strictReturned)===totals.sourceMembers;
  totals.eligibleForStrictExportFallback=totals.allStrictTerminalEvidence&&!totals.scanAndFinalComplete;
  totals.hasFullMembershipNotVerifiedOutcome=totals.scanAndFinalComplete&&!totals.allStrictTerminalEvidence;
  totals.podLockTablePresent=podLockTablePresent;
  totals.trustedPodTimeCoveragePct=totals.normalizedPOD>0
    ?Math.round(totals.trustedPodLockOnPOD/totals.normalizedPOD*10000)/100:null;
  return {version:VERSION,readOnly:true,source:'local-database-copy',
    limitations:'Counts show saved labels and locally stored scan/final evidence separately; record presence is not proof that API scans succeeded, and no TMS 60/81 means strict terminal status is unverified. Saved POD-lock coverage counts only member-matched POD records with whitelisted evidence provenance, valid timestamp and a date on or after their daily source date. It does not establish external TMS confirmation or full signature-time accuracy.',
    active72,whpp:{byDate,totals},
    sevenBusinessSource:sevenBusinessSourceConservation(db,rows)};
}
export function auditDatabaseFile(dbFile){
  if(!dbFile||!fs.existsSync(dbFile))throw Error('请通过 --db= 指定存在的验收数据库副本文件；正式数据库不会被自动探测');
  const db=new DatabaseSync(dbFile,{readOnly:true});
  try{return auditV788Readonly(db)}finally{db.close()}
}
if(process.argv[1]&&process.argv[1].replaceAll('\\','/').endsWith('v788-whpp-real-readonly-audit.mjs')){
  const arg=process.argv.slice(2).find(x=>x.startsWith('--db='));
  if(!arg)throw Error('用法: node scripts/v788-whpp-real-readonly-audit.mjs --db=验收数据库副本路径');
  console.log(JSON.stringify(auditDatabaseFile(arg.slice(5)),null,2));
}