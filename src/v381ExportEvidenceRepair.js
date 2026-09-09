import { getDb } from './db.js';
import { CEClient } from './ceClient.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import { ensureV246TrackingSchema, applyV246StrictAttemptEvidence, v246InclusiveDays } from './v246TrackingLedgerCore.js';
import { backfillV294StrictAttemptsFromSavedEvidence, V294_ATTEMPT_TYPES } from './v294AttemptSigningTruth.js';
import { normalizeV485TrackRows, V485_STRICT_TRACK_EVIDENCE_ID } from './v485StrictTrackEvidence.js';

export const V381_EXPORT_EVIDENCE_REPAIR_ID='2026-08-31-v381-shopee-export-scoped-evidence-repair-v1';
export const V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID='2026-09-08-v482-three-business-export-scoped-evidence-repair-v1';
export const V483_EXPORT_MEMBER_EVIDENCE_ID='2026-09-08-v483-export-member-driven-strict-evidence-v1';
const STRICT_TYPES=new Set(V294_ATTEMPT_TYPES);
const PREPARED_RANGES_BY_DB=new WeakMap();
export const V381_EXPORT_TRACK_BATCH=50;
export const V381_EXPORT_TRACK_CONCURRENCY=4;
const text=v=>String(v??'').trim();
const billOf=v=>text(v).toUpperCase();
const dateKey=v=>{const m=text(v).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const chunks=(values,size=V381_EXPORT_TRACK_BATCH)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
const safeJson=(value,fallback={})=>{try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}};
const strictAttemptSource=value=>/^V246_STRICT_TRACK:/i.test(text(value))||/严格.*START|START.*失败.*START/i.test(text(value));
const positiveAttempt=value=>{const n=Number(value||0);return Number.isFinite(n)&&n>0?Math.min(3,Math.floor(n)):0;};

function eventBill(row={}){return billOf(row.shipmentCode||row.运单号||row.waybill||row.waybillNo||row.billCode||row.trackingNo);}
async function mapLimit(values,limit,worker){let next=0;const result=new Array(values.length);async function run(){while(true){const index=next++;if(index>=values.length)return;result[index]=await worker(values[index],index);}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,values.length))},()=>run()));return result;}
function preparedRangesFor(db){let ranges=PREPARED_RANGES_BY_DB.get(db);if(!ranges){ranges=new Map();PREPARED_RANGES_BY_DB.set(db,ranges);}return ranges;}

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
  const preparedRanges=preparedRangesFor(db),cacheKey=`${selection.businessType}|${selection.fromDate}|${selection.toDate}`;
  if(preparedRanges.has(cacheKey))return{...preparedRanges.get(cacheKey),reusedInProcess:true};
  ensureV246TrackingSchema(db);

  // Compatibility/maintenance path only since V484. Formal export no longer calls
  // this full-range reconcile/backfill before actual export membership is known.
  backfillV294StrictAttemptsFromSavedEvidence({reportDate:selection.toDate,fromDate:selection.fromDate,businessTypes:[selection.businessType],db,reason:'V482_EXPORT_PREP_SAVED'});
  let todo=listV381ExportEvidenceCandidates(selection.businessType,selection,{db});
  const total=todo.length;
  onProgress({phase:'evidenceRepair',completed:0,total,queried:0,failed:0,unresolved:total,batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID});
  if(!total){const result={ok:true,version:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID,...selection,total:0,queried:0,failed:0,updated:0,unresolved:0,reusedSaved:true};preparedRanges.set(cacheKey,result);return result;}

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
  preparedRanges.set(cacheKey,result);
  onProgress({phase:'evidenceRepairDone',...result,batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID});
  return result;
}

export function listV483StrictExportRowGaps(type,rows=[]){
  const businessType=text(type).toUpperCase();if(!STRICT_TYPES.has(businessType)||!Array.isArray(rows)||!rows.length)return[];
  const byBill=new Map();
  for(const row of rows){
    if(!row?.pod)continue;
    const bill=billOf(row.shipmentCode||row.运单号);if(!bill)continue;
    let item=byBill.get(bill);if(!item){item={shipmentCode:bill,businessType,podDate:'',attemptKnown:false,signingKnown:false,rows:[]};byBill.set(bill,item);}
    item.rows.push(row);
    item.podDate=item.podDate||dateKey(row.podDate||row.podTime||row.POD时间);
    if(positiveAttempt(row.attemptNo||row.trackAttemptNo||row.podAttemptNo||row.currentAttemptNo))item.attemptKnown=true;
    if(Number.isFinite(Number(row.signingDays||row.deliveryDays))&&Number(row.signingDays||row.deliveryDays)>0)item.signingKnown=true;
  }
  return[...byBill.values()].filter(item=>!item.podDate||!item.attemptKnown||!item.signingKnown);
}

export function applyV483StrictTruthToExportRows(record={},strict={}){
  const rows=Array.isArray(record.rows)?record.rows:[],starts=Array.isArray(strict.starts)?strict.starts:[],failures=Array.isArray(strict.failures)?strict.failures:[];
  const attemptNo=positiveAttempt(strict.attemptNo),podDate=dateKey(strict.podDate)||dateKey(record.podDate);
  const firstStart=starts.map(item=>text(item?.time||item?.eventTime||item)).filter(Boolean).sort()[0]||'';
  const firstStartDate=dateKey(firstStart),signingDays=podDate&&firstStartDate?(v246InclusiveDays(firstStartDate,podDate)||0):0;
  for(const row of rows){
    if(podDate){row.podDate=podDate;if(!text(row.podTime))row.podTime=podDate;}
    if(attemptNo>0){row.attemptNo=attemptNo;row.trackAttemptNo=attemptNo;row.podAttemptNo=attemptNo;row.currentAttemptNo=attemptNo;row.attemptSource=`V246_STRICT_TRACK:${text(strict.source||'V483_EXPORT_MEMBER_TRACK')}`;row.attemptEvidenceComplete=true;}
    if(firstStart){row.firstAttemptAt=firstStart;row.dispatchStartAt=firstStart;row.dispatchStartDate=firstStartDate;}
    if(signingDays>0){row.signingDays=signingDays;row.deliveryDays=signingDays;row.signingDaysSource='V483实际导出POD成员真实START→POD';row.deliveryDaysSource=row.signingDaysSource;row.dispatchSigningEvidenceComplete=true;row.signingEvidenceComplete=true;}
    row.v483StrictExportEvidenceId=V483_EXPORT_MEMBER_EVIDENCE_ID;
  }
  return{resolved:Boolean(podDate&&attemptNo>0&&signingDays>0),attemptNo,podDate,firstStart,signingDays,evidenceRow:{shipmentCode:record.shipmentCode,businessType:record.businessType,podDate,attemptNo,source:text(strict.source||'V483_EXPORT_MEMBER_TRACK'),startMode:strict.startMode||'',starts,failures}};
}

export async function repairV483StrictExportRows({type,range,rows=[],db=getDb(),client=null,onProgress=()=>{}}={}){
  const selection=selectionOf(type,range);if(!selection)return{ok:true,skipped:true,reason:'NON_STRICT_BUSINESS',total:0,queried:0,unresolved:0};
  let gaps=listV483StrictExportRowGaps(selection.businessType,rows),total=gaps.length;
  onProgress({phase:'strictExportEvidence',completed:0,total,queried:0,failed:0,unresolved:total,eventBills:0,normalizedEvents:0,batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V483_EXPORT_MEMBER_EVIDENCE_ID,trackNormalizerVersion:V485_STRICT_TRACK_EVIDENCE_ID});
  if(!total)return{ok:true,version:V483_EXPORT_MEMBER_EVIDENCE_ID,...selection,total:0,queried:0,failed:0,updated:0,unresolved:0,eventBills:0,normalizedEvents:0};

  const ce=client||new CEClient(),gapByBill=new Map(gaps.map(item=>[item.shipmentCode,item])),groups=chunks([...gapByBill.keys()]),eventBillSet=new Set(),stats={completed:0,queried:0,failed:0,updated:0,resolved:0,rawRows:0,normalizedEvents:0};
  await mapLimit(groups,V381_EXPORT_TRACK_CONCURRENCY,async bills=>{
    let rawEvents=[];
    try{rawEvents=await ce.trackQuery(bills);stats.queried+=bills.length;stats.rawRows+=Array.isArray(rawEvents)?rawEvents.length:0;}
    catch{stats.failed+=bills.length;stats.completed+=bills.length;onProgress({phase:'strictExportEvidence',...stats,total,eventBills:eventBillSet.size,unresolved:Math.max(0,total-stats.resolved),batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V483_EXPORT_MEMBER_EVIDENCE_ID,trackNormalizerVersion:V485_STRICT_TRACK_EVIDENCE_ID});return;}
    const events=normalizeV485TrackRows(rawEvents,{fallbackBills:bills});stats.normalizedEvents+=events.length;
    const byBill=new Map();for(const event of events){const bill=eventBill(event);if(!bill)continue;if(!byBill.has(bill))byBill.set(bill,[]);byBill.get(bill).push(event);eventBillSet.add(bill);}
    const evidenceRows=[];
    for(const bill of bills){
      const record=gapByBill.get(bill);if(!record)continue;
      const strict=analyzeV246ShopeeAttemptCycle(byBill.get(bill)||[],{podDate:record.podDate||''}),applied=applyV483StrictTruthToExportRows(record,strict);
      if(applied.attemptNo>0||applied.signingDays>0||applied.podDate)evidenceRows.push(applied.evidenceRow);
      if(applied.resolved)stats.resolved+=1;
    }
    if(evidenceRows.length){const persisted=applyV246StrictAttemptEvidence(evidenceRows,{db,reason:'V485_EXPORT_MEMBER_TRACK'});stats.updated+=Number(persisted?.updated||0);}
    stats.completed+=bills.length;onProgress({phase:'strictExportEvidence',...stats,total,eventBills:eventBillSet.size,unresolved:Math.max(0,total-stats.resolved),batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V483_EXPORT_MEMBER_EVIDENCE_ID,trackNormalizerVersion:V485_STRICT_TRACK_EVIDENCE_ID});
  });

  gaps=listV483StrictExportRowGaps(selection.businessType,rows);
  const missingAttempt=gaps.filter(item=>!item.attemptKnown).length,missingSigning=gaps.filter(item=>!item.signingKnown).length,missingPodDate=gaps.filter(item=>!item.podDate).length;
  const result={ok:gaps.length===0,version:V483_EXPORT_MEMBER_EVIDENCE_ID,...selection,total,queried:stats.queried,failed:stats.failed,rawRows:stats.rawRows,normalizedEvents:stats.normalizedEvents,eventBills:eventBillSet.size,noEventBills:Math.max(0,total-eventBillSet.size),updated:stats.updated,resolved:total-gaps.length,unresolved:gaps.length,missingAttempt,missingSigning,missingPodDate,sample:gaps.slice(0,8).map(item=>item.shipmentCode),trackNormalizerVersion:V485_STRICT_TRACK_EVIDENCE_ID};
  onProgress({phase:'strictExportEvidenceDone',...result,batchSize:V381_EXPORT_TRACK_BATCH,concurrency:V381_EXPORT_TRACK_CONCURRENCY,evidenceRepairVersion:V483_EXPORT_MEMBER_EVIDENCE_ID});
  if(gaps.length){const error=new Error(`V483_STRICT_EXPORT_EVIDENCE_INCOMPLETE:${selection.businessType}:missingAttempt=${missingAttempt}:missingSigning=${missingSigning}:missingPodDate=${missingPodDate}:queried=${result.queried}:failed=${result.failed}:eventBills=${result.eventBills}:normalizedEvents=${result.normalizedEvents}${result.sample.length?`:sample=${result.sample.join(',')}`:''}`);error.code='V483_STRICT_EXPORT_EVIDENCE_INCOMPLETE';error.diagnostics=result;throw error;}
  return result;
}

// Compatibility export retained for V381 callers. Its implementation now delegates
// to the one strict three-business owner, so legacy callers gain TBKH safety without
// creating a second evidence-repair mechanism.
export async function prepareV381ShopeeExportEvidence(options={}){
  return prepareV482StrictExportEvidence(options);
}

console.info('[CE-QC][V483_STRICT_EXPORT_EVIDENCE]',V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID,V483_EXPORT_MEMBER_EVIDENCE_ID,V485_STRICT_TRACK_EVIDENCE_ID,'TBKH + SHOPEECN + SHOPEEVN actual export POD membership uses normalized nested CE track events; unresolved rows fail with remote queried/failed/event coverage diagnostics.');
