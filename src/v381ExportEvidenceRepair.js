import { getDb } from './db.js';
import { CEClient } from './ceClient.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { ensureV246TrackingSchema, applyV246StrictAttemptEvidence } from './v246TrackingLedgerCore.js';
import { backfillV294StrictAttemptsFromSavedEvidence, V294_ATTEMPT_TYPES } from './v294AttemptSigningTruth.js';

export const V381_EXPORT_EVIDENCE_REPAIR_ID='2026-08-31-v381-shopee-export-scoped-evidence-repair-v1';
export const V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID='2026-09-08-v482-three-business-export-scoped-evidence-repair-v1';
const STRICT_TYPES=new Set(V294_ATTEMPT_TYPES);
export const V381_EXPORT_TRACK_BATCH=50;
export const V381_EXPORT_TRACK_CONCURRENCY=4;
const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
const dateKey=v=>{const m=text(v).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const chunks=(values,size=V381_EXPORT_TRACK_BATCH)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
const safeJson=(value,fallback={})=>{try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}};
const strictAttemptSource=value=>/^V246_STRICT_TRACK:/i.test(text(value))||/严格.*START|START.*失败.*START/i.test(text(value));

function eventBill(row={}){return billOf(row.shipmentCode||row.运单号||row.waybill||row.waybillNo||row.billCode||row.trackingNo);}
async function mapLimit(values,limit,worker){let next=0;const result=new Array(values.length);async function run(){while(true){const index=next++;if(index>=values.length)return;result[index]=await worker(values[index],index);}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,values.length))},()=>run()));return result;}

export function isV482StrictExportEvidenceType(type){return STRICT_TYPES.has(text(type).toUpperCase());}

function selectionOf(type,range={}){
  const businessType=text(type).toUpperCase(),fromDate=dateKey(range.from||range.fromDate),toDate=dateKey(range.to||range.toDate);
  if(!STRICT_TYPES.has(businessType))return null;
  if(!fromDate||!toDate||fromDate>toDate)throw new Error('V482_EXPORT_EVIDENCE_RANGE_INVALID');
  return{businessType,fromDate,toDate};
}

export function listV381ExportEvidenceCandidates(type,range,{db=getDb()}={}){
  const selection=selectionOf(type,range);if(!selection)return[];
  ensureV246TrackingSchema(db);
  return db.prepare(`SELECT shipmentCode,businessType,firstReportDate,lastImportedDate,podDate,attemptNo,attemptSource,evidenceJson
    FROM qc_tracking_ledger
    WHERE businessType=? AND terminalReason='POD' AND firstReportDate<=? AND lastImportedDate>=?
      AND (
        TRIM(COALESCE(podDate,''))=''
        OR COALESCE(attemptNo,0)<=0
        OR TRIM(COALESCE(CASE WHEN json_valid(evidenceJson) THEN json_extract(evidenceJson,'$.starts[0].time') END,''))=''
      )
    ORDER BY firstReportDate,shipmentCode`).all(selection.businessType,selection.toDate,selection.fromDate);
}

export function hydrateV381LedgerStartEvidence(type,rows=[],{db=getDb()}={}){
  const businessType=text(type).toUpperCase();if(!STRICT_TYPES.has(businessType)||!rows.length)return rows;
  ensureV246TrackingSchema(db);
  const byBill=new Map(rows.map(row=>[billOf(row?.shipmentCode||row?.运单号),row]).filter(([bill])=>bill));
  const bills=[...byBill.keys()];
  for(const part of chunks(bills,250)){
    const marks=part.map(()=>'?').join(',');if(!marks)continue;
    const ledger=db.prepare(`SELECT shipmentCode,podDate,attemptNo,attemptSource,evidenceJson FROM qc_tracking_ledger WHERE businessType=? AND shipmentCode IN (${marks})`).all(businessType,...part);
    for(const locked of ledger){
      const bill=billOf(locked.shipmentCode),row=byBill.get(bill);if(!row)continue;
      const evidence=safeJson(locked.evidenceJson,{}),firstStart=text(evidence?.starts?.[0]?.time),attempt=Math.max(0,Math.min(3,Number(locked.attemptNo||0))),attemptSource=text(locked.attemptSource);
      if(dateKey(locked.podDate))row.podDate=dateKey(locked.podDate);
      if(!text(row.firstAttemptAt)&&firstStart)row.firstAttemptAt=firstStart;
      if(!text(row.dispatchStartAt)&&firstStart)row.dispatchStartAt=firstStart;
      if(attempt>0&&strictAttemptSource(attemptSource)){
        row.attemptNo=attempt;row.trackAttemptNo=attempt;row.podAttemptNo=attempt;row.currentAttemptNo=attempt;row.attemptSource=attemptSource;row.attemptEvidenceComplete=true;
      }
    }
  }
  return rows;
}

export function applyV381LedgerExportTruth(type,rows=[],{db=getDb()}={}){
  return hydrateV381LedgerStartEvidence(type,rows,{db});
}

export async function prepareV482StrictExportEvidence({type,range,db=getDb(),client=null,onProgress=()=>{}}={}){
  const selection=selectionOf(type,range);if(!selection)return{ok:true,skipped:true,reason:'NON_STRICT_BUSINESS',queried:0,total:0,unresolved:0};
  ensureV246TrackingSchema(db);

  // Candidate-first is important because the single-business worker and the common
  // V200 owner can both reach this compatibility module. If ledger evidence is
  // already complete, return immediately without a second historical backfill.
  let todo=listV381ExportEvidenceCandidates(selection.businessType,selection,{db});
  if(!todo.length)return{ok:true,version:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID,...selection,total:0,queried:0,failed:0,updated:0,unresolved:0,reusedComplete:true};

  // Reuse every saved strict trajectory already in SQLite before any CE request.
  // Only genuinely incomplete terminal POD tickets may reach the trajectory API.
  backfillV294StrictAttemptsFromSavedEvidence({reportDate:selection.toDate,fromDate:selection.fromDate,businessTypes:[selection.businessType],db,reason:'V482_EXPORT_PREP_SAVED'});
  todo=listV381ExportEvidenceCandidates(selection.businessType,selection,{db});
  const total=todo.length;
  onProgress({phase:'evidenceRepair',completed:0,total,queried:0,failed:0,unresolved:total,batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID});
  if(!total)return{ok:true,version:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID,...selection,total:0,queried:0,failed:0,updated:0,unresolved:0,reusedSaved:true};

  const ce=client||new CEClient(),groups=chunks(todo),stats={completed:0,queried:0,failed:0,updated:0};
  await mapLimit(groups,V381_EXPORT_TRACK_CONCURRENCY,async group=>{
    const bills=group.map(row=>billOf(row.shipmentCode)).filter(Boolean);let events=[];
    try{events=await ce.trackQuery(bills);stats.queried+=bills.length;}
    catch{stats.failed+=bills.length;stats.completed+=group.length;onProgress({phase:'evidenceRepair',...stats,total,unresolved:Math.max(0,total-stats.completed),batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID});return;}
    const byBill=new Map();for(const event of events||[]){const bill=eventBill(event);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(event);}
    const evidenceRows=[];
    for(const row of group){
      const bill=billOf(row.shipmentCode),billEvents=byBill.get(bill)||[];if(!billEvents.length)continue;
      const strict=analyzeV246ShopeeAttemptCycle(billEvents,{podDate:row.podDate||''}),old=safeJson(row.evidenceJson,{}),oldStarts=Array.isArray(old.starts)?old.starts:[],oldFailures=Array.isArray(old.failures)?old.failures:[];
      const starts=strict.starts?.length?strict.starts:oldStarts,failures=strict.failures?.length?strict.failures:oldFailures,attemptNo=Number(strict.attemptNo||0)>0?Number(strict.attemptNo):Number(row.attemptNo||0),podDate=strict.podDate||dateKey(row.podDate);
      if(!podDate&&!attemptNo&&!starts.length)continue;
      evidenceRows.push({shipmentCode:bill,businessType:selection.businessType,podDate,attemptNo,source:Number(strict.attemptNo||0)>0?strict.source:(text(row.attemptSource)||'V482_KEEP_SAVED_STRICT_ATTEMPT'),startMode:strict.startMode||'',starts,failures});
    }
    if(evidenceRows.length){const applied=applyV246StrictAttemptEvidence(evidenceRows,{db,reason:'V482_EXPORT_PREP_TRACK'});stats.updated+=Number(applied?.updated||0);}
    stats.completed+=group.length;onProgress({phase:'evidenceRepair',...stats,total,unresolved:Math.max(0,total-stats.completed),batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID});
  });
  todo=listV381ExportEvidenceCandidates(selection.businessType,selection,{db});
  const result={ok:true,version:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID,...selection,total,queried:stats.queried,failed:stats.failed,updated:stats.updated,unresolved:todo.length};
  onProgress({phase:'evidenceRepairDone',...result,batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID});
  return result;
}

// Compatibility export retained for V381 callers. Its implementation now delegates
// to the one strict three-business owner, so legacy callers gain TBKH safety without
// creating a second evidence-repair mechanism.
export async function prepareV381ShopeeExportEvidence(options={}){
  return prepareV482StrictExportEvidence(options);
}

console.info('[CE-QC][V482_STRICT_EXPORT_EVIDENCE_REPAIR]',V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID,'TBKH + SHOPEECN + SHOPEEVN export preflight: candidate-first, saved SQLite evidence first, then only unresolved terminal POD trajectory at 50x4. V381 compatibility export remains available.');
