import { getDb, nowIso } from './db.js';
import { analyzeV246ShopeeAttemptCycle } from './shopeeAttemptCycleV246.js';
import {
  ensureV246TrackingSchema,
  reconcileV246TrackingLedger,
  applyV246StrictAttemptEvidence,
  v246InclusiveDays
} from './v246TrackingLedgerCore.js';

export const V294_ATTEMPT_SIGNING_TRUTH_ID = '2026-08-31-v380-persisted-strict-start-export-bridge-v5';
export const V294_ATTEMPT_TYPES = Object.freeze(['TBKH','SHOPEECN','SHOPEEVN']);
const TYPE_SET = new Set(V294_ATTEMPT_TYPES);
const text = value => String(value ?? '').trim();
const billOf = value => text(value).toUpperCase();
const dateKey = value => { const match = text(value).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/); return match ? `${match[1]}-${match[2]}-${match[3]}` : ''; };
const safeJson = (value, fallback = {}) => { if (value && typeof value === 'object') return value; try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; } };
const chunks = (values, size = 250) => { const out=[]; for(let index=0;index<values.length;index+=size)out.push(values.slice(index,index+size)); return out; };
const strictSource = value => /^V246_STRICT_TRACK:/i.test(text(value)) || /严格.*START|START.*失败.*START/i.test(text(value));

export function resolveV294Attempt({ pod=false,podDate='',events=[],ledgerAttemptNo=0,ledgerAttemptSource='',podAttemptNo=0 }={}){
  if(!pod)return{attemptNo:0,source:'',proven:true,strict:null};
  const strict=analyzeV246ShopeeAttemptCycle(events,{podDate});
  if(strict.attemptNo>0)return{attemptNo:strict.attemptNo,source:strict.source,proven:true,strict};
  const ledgerNo=Math.max(0,Math.min(3,Number(ledgerAttemptNo||0)));
  if(ledgerNo>0&&strictSource(ledgerAttemptSource))return{attemptNo:ledgerNo,source:text(ledgerAttemptSource),proven:true,strict};
  const explicit=Math.max(0,Math.min(3,Number(podAttemptNo||0)));
  if(explicit>0)return{attemptNo:explicit,source:'POD锁定明确派次',proven:true,strict};
  return{attemptNo:0,source:'无真实START/失败循环或明确POD派次证据',proven:false,strict};
}
export function resolveV294SigningDays(firstReportDate,podDate){const first=dateKey(firstReportDate),pod=dateKey(podDate);return first&&pod?(v246InclusiveDays(first,pod)??0):0;}
function membershipTruth(type,bills,range,db){
  const firstDates=new Map(),dailyDates=new Map(bills.map(bill=>[bill,[]])),from=dateKey(range?.from||range?.fromDate),to=dateKey(range?.to||range?.toDate);
  for(const part of chunks(bills,220)){const marks=part.map(()=>'?').join(',');if(!marks)continue;const rows=db.prepare(`WITH ranked AS (SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn FROM unified_import_batches b WHERE b.status='VALID'), valid AS (SELECT r.reportDate,UPPER(TRIM(u.shipmentCode)) shipmentCode,UPPER(TRIM(u.businessType)) businessType FROM ranked r JOIN unified_import_rows u ON u.snapshotId=r.snapshotId AND u.reportDate=r.reportDate WHERE r.rn=1 AND TRIM(COALESCE(u.shipmentCode,''))<>'') SELECT shipmentCode,reportDate FROM valid WHERE businessType=? AND shipmentCode IN (${marks}) ORDER BY shipmentCode,reportDate`).all(type,...part);for(const row of rows){const bill=billOf(row.shipmentCode),date=dateKey(row.reportDate);if(!bill||!date)continue;const old=firstDates.get(bill);if(!old||date<old)firstDates.set(bill,date);if((!from||date>=from)&&(!to||date<=to)){if(!dailyDates.has(bill))dailyDates.set(bill,[]);if(!dailyDates.get(bill).includes(date))dailyDates.get(bill).push(date);}}}
  for(const dates of dailyDates.values())dates.sort();return{firstDates,dailyDates};
}
function ledgerRows(type,bills,db){ensureV246TrackingSchema(db);const result=new Map();for(const part of chunks(bills,300)){const marks=part.map(()=>'?').join(',');if(!marks)continue;const rows=db.prepare(`SELECT shipmentCode,businessType,firstReportDate,lastImportedDate,terminalReason,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt FROM qc_tracking_ledger WHERE businessType=? AND shipmentCode IN (${marks})`).all(type,...part);for(const row of rows)result.set(billOf(row.shipmentCode),row);}return result;}
function pushEvents(result,rows=[]){for(const row of rows){const bill=billOf(row.shipmentCode);if(!bill)continue;if(!result.has(bill))result.set(bill,[]);result.get(bill).push(row);}}
function trackEventsByBill(type,bills,db){const result=new Map(bills.map(bill=>[bill,[]]));for(const part of chunks(bills,220)){const marks=part.map(()=>'?').join(',');if(!marks)continue;if(type==='TBKH'){try{pushEvents(result,db.prepare(`SELECT shipmentCode,eventTime,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,rawJson,id FROM track_events WHERE shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part));}catch{}try{pushEvents(result,db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events WHERE businessType='TBKH' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part));}catch{}continue;}try{pushEvents(result,db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,id FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part));}catch{}}return result;}
export function applyV294ExportAttemptSigningTruth(businessType,rows=[],{db=getDb(),range={}}={}){
  const type=text(businessType).toUpperCase();if(!TYPE_SET.has(type)||!rows.length)return rows;
  const bills=[...new Set(rows.map(row=>billOf(row?.shipmentCode||row?.运单号)).filter(Boolean))],membership=membershipTruth(type,bills,range,db),ledger=ledgerRows(type,bills,db),events=trackEventsByBill(type,bills,db);
  for(const row of rows){const bill=billOf(row?.shipmentCode||row?.运单号);if(!bill)continue;const locked=ledger.get(bill)||{},originalRangeDate=dateKey(row.firstReportDate),firstReportDate=membership.firstDates.get(bill)||dateKey(locked.firstReportDate)||originalRangeDate,dailyMembershipDates=membership.dailyDates.get(bill)||[],pod=Boolean(row.pod)||text(locked.terminalReason).toUpperCase()==='POD',podDate=dateKey(locked.podDate)||dateKey(row.podDate||row.podTime||row.POD时间),stateJson=safeJson(locked.currentStateJson,{}),ledgerEvidence=safeJson(locked.evidenceJson,{}),persistedStart=strictSource(locked.attemptSource)?text(ledgerEvidence?.starts?.[0]?.time):'';
    const attempt=resolveV294Attempt({pod,podDate,events:events.get(bill)||[],ledgerAttemptNo:locked.attemptNo,ledgerAttemptSource:locked.attemptSource,podAttemptNo:row.podAttemptNo||stateJson.podAttemptNo});
    if(firstReportDate)row.firstReportDate=firstReportDate;row.dailyMembershipDates=dailyMembershipDates.length?dailyMembershipDates:(originalRangeDate?[originalRangeDate]:[]);row.dailyMembershipSource='所选区间内每个日期的最新VALID综合日报精确成员';if(podDate)row.podDate=podDate;if(persistedStart&&!text(row.firstAttemptAt))row.firstAttemptAt=persistedStart;
    row.attemptNo=attempt.attemptNo;row.trackAttemptNo=attempt.attemptNo;row.attemptSource=attempt.source;row.attemptEvidenceComplete=attempt.proven;row.v294TruthId=V294_ATTEMPT_SIGNING_TRUTH_ID;row.v294PersistedStrictStart=persistedStart;
  }
  return rows;
}
function earliestValidReportDate(db,fallback=''){const row=db.prepare("SELECT MIN(reportDate) reportDate FROM unified_import_batches WHERE status='VALID'").get();return dateKey(row?.reportDate)||dateKey(fallback);}
export function backfillV294StrictAttemptsFromSavedEvidence({reportDate='',fromDate='',businessTypes=V294_ATTEMPT_TYPES,db=getDb(),reason='V294_POST_PROCESS'}={}){
  const toDate=dateKey(reportDate);if(!toDate)return{ok:false,skipped:true,reason:'REPORT_DATE_MISSING'};const requestedFrom=dateKey(fromDate),resolvedFrom=requestedFrom||earliestValidReportDate(db,toDate)||toDate;if(resolvedFrom>toDate)return{ok:false,skipped:true,reason:'DATE_RANGE_INVALID',fromDate:resolvedFrom,toDate};const types=[...new Set((businessTypes||[]).map(value=>text(value).toUpperCase()).filter(type=>TYPE_SET.has(type)))];ensureV246TrackingSchema(db);const summary=[];
  for(const type of types){const reconcile=reconcileV246TrackingLedger({businessType:type,fromDate:resolvedFrom,toDate},{db,reason:`${reason}:RECONCILE:${type}`});const podRows=db.prepare(`SELECT shipmentCode,businessType,firstReportDate,lastImportedDate,podDate,attemptNo,attemptSource,currentStateJson FROM qc_tracking_ledger WHERE businessType=? AND terminalReason='POD' AND firstReportDate<=? AND lastImportedDate>=? ORDER BY shipmentCode`).all(type,toDate,resolvedFrom),bills=podRows.map(row=>billOf(row.shipmentCode)).filter(Boolean),events=trackEventsByBill(type,bills,db),evidenceRows=[];let unknown=0;for(const row of podRows){const bill=billOf(row.shipmentCode),strict=analyzeV246ShopeeAttemptCycle(events.get(bill)||[],{podDate:row.podDate||''});if(strict.attemptNo>0)evidenceRows.push({shipmentCode:bill,businessType:type,attemptNo:strict.attemptNo,source:strict.source,startMode:strict.startMode,starts:strict.starts,failures:strict.failures,podDate:strict.podDate||row.podDate||''});else unknown+=1;}const applied=evidenceRows.length?applyV246StrictAttemptEvidence(evidenceRows,{db,reason:`${reason}:SAVED_TRACK:${type}`}):{updated:0,known:0,unknown:0,podDateFilled:0,corrected:0};summary.push({businessType:type,fromDate:resolvedFrom,toDate,reconciled:reconcile.expected,pod:podRows.length,strictCandidates:evidenceRows.length,unknown,...applied});}
  return{ok:true,version:V294_ATTEMPT_SIGNING_TRUTH_ID,fromDate:resolvedFrom,toDate,summary,completedAt:nowIso()};
}
console.info('[CE-QC][V380_V294_EXPORT_BRIDGE]',V294_ATTEMPT_SIGNING_TRUTH_ID,'export reads persisted strict START evidence + real POD date from qc_tracking_ledger; signing days remain owned by strict START-to-POD calculation, never report-date fallback.');
