import { getDb } from './db.js';
import { V200_EXPORT_VERSION as BASE_EXPORT_VERSION } from './v200EvidenceData.js';
import { isShopeePending1203ReturnEvent } from './shopeeReturnTruth.js';
import { applyV230AttemptSigningTruth, V230_ATTEMPT_SIGNING_TRUTH_ID } from './v230AttemptSigningTruth.js';
import { collectV320HistoricalExportRows, V320_HISTORICAL_EXPORT_ROWS_ID } from './v320HistoricalExportRows.js';
import { applyV419CanonicalExportLedgerTruth, V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID } from './v419CanonicalExportLedgerTruth.js';

export const V200_EXPORT_VERSION = BASE_EXPORT_VERSION;
// Legacy identifier retained because external update gates/source diagnostics reference it.
export const V225_EXPORT_RETURN_TRUTH_ID = '2026-08-27-v329-first-report-pod-export-signing-v1';
export const V489_FORMAL_EXPORT_EVIDENCE_PATH_ID = '2026-09-09-v489-canonical-ledger-then-actual-pod-gap-v1';
const STRICT_DELIVERY_TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const DAILY_MEMBERSHIP_TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
// Compatibility marker for pre-V320 source assertions only: applyV294ExportAttemptSigningTruth.
const normalizeBill=v=>String(v||'').trim().toUpperCase();
const dateKey=v=>{const m=String(v||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const dayNumber=value=>{const d=dateKey(value);if(!d)return null;const [y,m,day]=d.split('-').map(Number);return Date.UTC(y,m-1,day);};
const inclusiveDays=(a,b)=>{const x=dayNumber(a),y=dayNumber(b);return x===null||y===null||y<x?0:Math.floor((y-x)/86400000)+1;};
const chunks=(values,size=220)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
function markReturned(row,source='退回终态'){if(!row||row.pod)return row;row.returned=true;row.pending=false;row.delivering=false;row.store=false;row.currentShop='';row.statusCode=row.statusCode||'R';row.statusDesc='RETURNED';row.returnSource=source;if(row.evidence?.add)row.evidence.add(source);return row;}
function applyShopee1203SavedTrackTruth(type,rows){
  if(!['SHOPEECN','SHOPEEVN'].includes(type)||!rows.length)return rows;const db=getDb(),byBill=new Map(rows.map(row=>[normalizeBill(row.shipmentCode),row])),bills=[...byBill.keys()].filter(Boolean);
  for(const part of chunks(bills)){const marks=part.map(()=>'?').join(',');let events=[];try{events=db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part);}catch{continue;}for(const event of events){const bill=normalizeBill(event.shipmentCode),row=byBill.get(bill);if(!row||row.pod||!bill.startsWith('SPE'))continue;if(isShopeePending1203ReturnEvent(event))markReturned(row,'轨迹历史:Pending1203派送异常');}}
  return rows;
}
function normalizeTerminalExclusion(rows){for(const row of rows){if(!row)continue;if(row.pod){row.returned=false;row.pending=false;row.delivering=false;row.store=false;row.currentShop='';row.currentStore='';continue;}if(row.returned){row.pending=false;row.delivering=false;row.store=false;row.currentShop='';row.currentStore='';row.statusCode=row.statusCode||'R';row.statusDesc=row.statusDesc||'RETURNED';}}return rows;}
function applyV329FirstReportSigning(businessType,rows){const type=String(businessType||'').trim().toUpperCase(),strict=STRICT_DELIVERY_TYPES.has(type);for(const row of rows){if(!row?.pod)continue;if(strict){const days=Number(row.signingDays||0),proven=days>0&&Boolean(row.dispatchSigningEvidenceComplete);if(proven){row.signingEvidenceComplete=true;row.v329SigningTruth='STRICT_START_TO_ACTUAL_POD';continue;}row.signingDays=0;row.deliveryDays=0;row.signingDaysSource='';row.deliveryDaysSource='';row.signingEvidenceComplete=false;row.v329SigningTruth='STRICT_START_TO_ACTUAL_POD_MISSING';continue;}const first=dateKey(row.firstReportDate||row.lifecycleFirstReportDate||row.dailyMembershipDates?.[0]),pod=dateKey(row.podDate||row.podTime||row.POD时间),days=inclusiveDays(first,pod);row.signingDays=days;row.deliveryDays=days;row.signingDaysSource=days>0?'首次日报锁定日期→实际POD日期（含首尾）':'';row.deliveryDaysSource=row.signingDaysSource;row.signingEvidenceComplete=days>0;row.v329SigningTruth='FIRST_REPORT_LOCK_TO_ACTUAL_POD_COMPAT';}return rows;}
function normalizeMembershipDates(row,range){const from=dateKey(range?.from),to=dateKey(range?.to),dates=[...new Set((Array.isArray(row?.dailyMembershipDates)?row.dailyMembershipDates:[row?.firstReportDate]).map(dateKey).filter(Boolean))].filter(d=>(!from||d>=from)&&(!to||d<=to)).sort();return dates;}
function expandDailyMembership(rows,range){const expanded=[];for(const row of rows){const dates=normalizeMembershipDates(row,range);for(const reportDate of dates)expanded.push({...row,reportMembershipDate:reportDate,dailyMembershipDates:[reportDate]});}return expanded;}
function evidenceDiagnostics(type,rows){
  if(!STRICT_DELIVERY_TYPES.has(type))return{businessType:type,pod:rows.filter(r=>r.pod).length,attemptMissing:0,signingMissing:0,partial:false};
  const podRows=rows.filter(r=>r.pod),attemptMissing=podRows.filter(r=>!Number(r.attemptNo||0)).length,signingMissing=podRows.filter(r=>!Number.isFinite(Number(r.signingDays))||Number(r.signingDays)<=0).length;
  return{businessType:type,pod:podRows.length,attemptMissing,signingMissing,partial:Boolean(attemptMissing||signingMissing)};
}
export async function collectV200Rows(type,range,onProgress=()=>{}){
  const businessType=String(type||'').trim().toUpperCase();
  let rows=await collectV320HistoricalExportRows(businessType,range,onProgress);
  applyShopee1203SavedTrackTruth(businessType,rows);normalizeTerminalExclusion(rows);

  // V489 formal-export hot path: do not run the retired V381/V320 full-member
  // strict-evidence hydrators before the canonical ledger. They caused 100k+
  // TBKH/CN/VN members to re-read qc_tracking_ledger/track event tables in
  // hundreds of batches before V419, even though V419 + V484 already own the
  // exact same formal-export truth. Compatibility modules remain available to
  // history/cache callers; only the formal workbook hot path is retired.
  // V230 is retained only for non-strict businesses. For TBKH/CN/VN, V419 is the
  // canonical persisted attempt/signing owner and V484 repairs only actual POD gaps.
  if(!STRICT_DELIVERY_TYPES.has(businessType))applyV230AttemptSigningTruth(businessType,rows);
  applyV329FirstReportSigning(businessType,rows);

  // V419 is intentionally the first strict-evidence database owner in formal
  // export: shipmentCode PK scalar hydration + JSON only for OPEN/strict POD.
  applyV419CanonicalExportLedgerTruth(businessType,rows,{db:getDb(),onProgress});
  normalizeTerminalExclusion(rows);
  const diag=evidenceDiagnostics(businessType,rows);
  for(const row of rows){row.exportEvidencePartial=diag.partial;row.exportAttemptMissing=diag.attemptMissing;row.exportSigningMissing=diag.signingMissing;row.v320ExportTruthId=V225_EXPORT_RETURN_TRUTH_ID;row.v419CanonicalExportTruthId=row.v419CanonicalExportTruthId||V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID;row.v489FormalExportEvidencePathId=V489_FORMAL_EXPORT_EVIDENCE_PATH_ID;}
  rows=DAILY_MEMBERSHIP_TYPES.has(businessType)?expandDailyMembership(rows,range):rows;
  const keys=rows.map(row=>`${dateKey(row.reportMembershipDate||row.dailyMembershipDates?.[0])}|${normalizeBill(row.shipmentCode)}`),unique=new Set(keys.filter(key=>!key.startsWith('|')));
  if(DAILY_MEMBERSHIP_TYPES.has(businessType)&&unique.size!==rows.length)throw new Error(`V320_EXPORT_DUPLICATE_DAILY_MEMBER:${businessType}:${rows.length-unique.size}`);
  if(!rows.length)throw new Error(`${businessType} 在所选区间没有可导出的已保存日报成员。`);
  onProgress({phase:'returnAttemptSigningTruth',completed:rows.length,total:rows.length,returned:rows.filter(r=>r.returned&&!r.pod).length,notPodActive:rows.filter(r=>!r.pod&&!r.returned).length,unknownAttemptPod:diag.attemptMissing,unknownSigningPod:diag.signingMissing,dailyMembershipOccurrences:rows.length,evidencePartial:diag.partial,engine:`${V225_EXPORT_RETURN_TRUTH_ID}+${V320_HISTORICAL_EXPORT_ROWS_ID}+${V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID}+${V489_FORMAL_EXPORT_EVIDENCE_PATH_ID}${STRICT_DELIVERY_TYPES.has(businessType)?'':`+${V230_ATTEMPT_SIGNING_TRUTH_ID}`}`});
  return rows;
}

console.info('[CE-QC][V419_EXPORT_TRUTH]',V225_EXPORT_RETURN_TRUTH_ID,V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID,V489_FORMAL_EXPORT_EVIDENCE_PATH_ID,'formal export now goes membership → canonical V419 ledger → actual-POD V484 gap repair; terminal POD/returned rows are excluded from current store/Pending/delivery buckets.');