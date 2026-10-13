import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// V788 read-only acceptance audit. Never prints shipment identifiers, names,
// phone numbers, addresses, raw JSON or the database path. No writes, API calls,
// cache regeneration, VACUUM, or application startup side effects.
const VERSION='V788_WHPP_REAL_READONLY_AUDIT_V1';

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
    allStrictTerminalEvidence:false,eligibleForStrictExportFallback:false};
}
export function auditV788Readonly(db){
  db.exec('PRAGMA query_only=ON');
  const active72=validateActive72(db);
  const rows=db.prepare("SELECT DISTINCT reportDate, UPPER(TRIM(shipmentCode)) shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY reportDate,shipmentCode").all();
  const findCurrent=db.prepare("SELECT state,stateJson FROM shipment_current_state WHERE shipmentCode=? AND businessType='WHPP' AND reportDate=?");
  const findLedger=db.prepare("SELECT trackingStatus,terminalReason FROM qc_tracking_ledger WHERE shipmentCode=? AND businessType='WHPP'");
  const hasScan=db.prepare("SELECT 1 ok FROM business_scan_results WHERE shipmentCode=? AND businessType='WHPP' AND reportDate=? LIMIT 1");
  const hasFinal=db.prepare("SELECT 1 ok FROM business_final_rows WHERE shipmentCode=? AND businessType='WHPP' AND reportDate=? LIMIT 1");
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
    if(hasScan.get(row.shipmentCode,day))d.scannedMembers++;
    if(hasFinal.get(row.shipmentCode,day))d.finalizedMembers++;
    const ledger=findLedger.get(row.shipmentCode);
    if((bucket==='strictPOD'||bucket==='strictReturned')&&String(ledger?.trackingStatus||'').toUpperCase()==='OPEN')
      d.ledgerOpenWithStrictTerminal++;
  }
  const byDate=[...days.values()];
  for(const d of byDate){
    d.scanAndFinalComplete=d.sourceMembers>0&&d.scannedMembers===d.sourceMembers&&d.finalizedMembers===d.sourceMembers;
    d.allStrictTerminalEvidence=d.sourceMembers>0&&(d.strictPOD+d.strictReturned)===d.sourceMembers;
    d.eligibleForStrictExportFallback=d.allStrictTerminalEvidence&&!d.scanAndFinalComplete;
  }
  const totals=emptyDay('ALL');
  for(const d of byDate){
    for(const key of ['sourceMembers','withCurrent','strictPOD','strictReturned','returning80',
      'contradiction','labelOnlyTerminal','otherUnverified','scannedMembers','finalizedMembers',
      'withExplicitPodTime','ledgerOpenWithStrictTerminal'])totals[key]+=d[key];
  }
  totals.scanAndFinalComplete=totals.sourceMembers>0&&totals.scannedMembers===totals.sourceMembers
    &&totals.finalizedMembers===totals.sourceMembers;
  totals.allStrictTerminalEvidence=totals.sourceMembers>0&&(totals.strictPOD+totals.strictReturned)===totals.sourceMembers;
  totals.eligibleForStrictExportFallback=totals.allStrictTerminalEvidence&&!totals.scanAndFinalComplete;
  return {version:VERSION,readOnly:true,source:'local-database-copy',
    limitations:'terminal status and explicit POD-time coverage only; not proof that actual remote scans or API calls succeeded',
    active72,whpp:{byDate,totals}};
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