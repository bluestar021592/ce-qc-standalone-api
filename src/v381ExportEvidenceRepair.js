import { getDb } from './db.js';
import { CEClient } from './ceClient.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { ensureV246TrackingSchema, applyV246StrictAttemptEvidence } from './v246TrackingLedgerCore.js';
import { backfillV294StrictAttemptsFromSavedEvidence } from './v294AttemptSigningTruth.js';

export const V381_EXPORT_EVIDENCE_REPAIR_ID='2026-08-31-v381-shopee-export-scoped-evidence-repair-v1';
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);
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

function selectionOf(type,range={}){
  const businessType=text(type).toUpperCase(),fromDate=dateKey(range.from||range.fromDate),toDate=dateKey(range.to||range.toDate);
  if(!SHOPEE_TYPES.has(businessType))return null;
  if(!fromDate||!toDate||fromDate>toDate)throw new Error('V381_EXPORT_EVIDENCE_RANGE_INVALID');
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
  const businessType=text(type).toUpperCase();if(!SHOPEE_TYPES.has(businessType)||!rows.length)return rows;
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

export async function prepareV381ShopeeExportEvidence({type,range,db=getDb(),client=null,onProgress=()=>{}}={}){
  const selection=selectionOf(type,range);if(!selection)return{ok:true,skipped:true,reason:'NON_SHOPEE',queried:0,total:0,unresolved:0};
  ensureV246TrackingSchema(db);
  // First reuse every saved strict trajectory already in SQLite. Only genuinely
  // incomplete POD tickets are allowed to reach the CE trajectory API.
  backfillV294StrictAttemptsFromSavedEvidence({reportDate:selection.toDate,fromDate:selection.fromDate,businessTypes:[selection.businessType],db,reason:'V381_EXPORT_PREP_SAVED'});
  let todo=listV381ExportEvidenceCandidates(selection.businessType,selection,{db});
  const total=todo.length;
  onProgress({phase:'evidenceRepair',completed:0,total,queried:0,failed:0,unresolved:total,batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY});
  if(!total)return{ok:true,version:V381_EXPORT_EVIDENCE_REPAIR_ID,...selection,total:0,queried:0,failed:0,updated:0,unresolved:0};

  const ce=client||new CEClient(),groups=chunks(todo),stats={completed:0,queried:0,failed:0,updated:0};
  await mapLimit(groups,V381_EXPORT_TRACK_CONCURRENCY,async group=>{
    const bills=group.map(row=>billOf(row.shipmentCode)).filter(Boolean);let events=[];
    try{events=await ce.trackQuery(bills);stats.queried+=bills.length;}
    catch{stats.failed+=bills.length;stats.completed+=group.length;onProgress({phase:'evidenceRepair',...stats,total,unresolved:Math.max(0,total-stats.completed),batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY});return;}
    const byBill=new Map();for(const event of events||[]){const bill=eventBill(event);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(event);}
    const evidenceRows=[];
    for(const row of group){
      const bill=billOf(row.shipmentCode),billEvents=byBill.get(bill)||[];if(!billEvents.length)continue;
      const strict=analyzeV246ShopeeAttemptCycle(billEvents,{podDate:row.podDate||''}),old=safeJson(row.evidenceJson,{}),oldStarts=Array.isArray(old.starts)?old.starts:[],oldFailures=Array.isArray(old.failures)?old.failures:[];
      const starts=strict.starts?.length?strict.starts:oldStarts,failures=strict.failures?.length?strict.failures:oldFailures,attemptNo=Number(strict.attemptNo||0)>0?Number(strict.attemptNo):Number(row.attemptNo||0),podDate=strict.podDate||dateKey(row.podDate);
      if(!podDate&&!attemptNo&&!starts.length)continue;
      evidenceRows.push({shipmentCode:bill,businessType:selection.businessType,podDate,attemptNo,source:Number(strict.attemptNo||0)>0?strict.source:(text(row.attemptSource)||'V381_KEEP_SAVED_STRICT_ATTEMPT'),startMode:strict.startMode||'',starts,failures});
    }
    if(evidenceRows.length){const applied=applyV246StrictAttemptEvidence(evidenceRows,{db,reason:'V381_EXPORT_PREP_TRACK'});stats.updated+=Number(applied?.updated||0);}
    stats.completed+=group.length;onProgress({phase:'evidenceRepair',...stats,total,unresolved:Math.max(0,total-stats.completed),batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY});
  });
  todo=listV381ExportEvidenceCandidates(selection.businessType,selection,{db});
  const result={ok:true,version:V381_EXPORT_EVIDENCE_REPAIR_ID,...selection,total,queried:stats.queried,failed:stats.failed,updated:stats.updated,unresolved:todo.length};
  onProgress({phase:'evidenceRepairDone',...result,batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY});
  return result;
}

console.info('[CE-QC][V381_EXPORT_EVIDENCE_REPAIR]',V381_EXPORT_EVIDENCE_REPAIR_ID,'Shopee export preflight reuses saved evidence first, then queries only incomplete terminal POD tickets at 50x4; export hydration is direct ledger POD/strict START/attempt only.');
