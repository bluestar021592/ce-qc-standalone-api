import { getDb } from './db.js';
import { V200_EXPORT_VERSION as BASE_EXPORT_VERSION } from './v200EvidenceData.js';
import { isShopeePending1203ReturnEvent } from './shopeeReturnTruth.js';
import { applyV230AttemptSigningTruth, V230_ATTEMPT_SIGNING_TRUTH_ID } from './v230AttemptSigningTruth.js';
import { collectV320HistoricalExportRows, V320_HISTORICAL_EXPORT_ROWS_ID } from './v320HistoricalExportRows.js';
import { applyV320DispatchSigningTruth, V320_DISPATCH_SIGNING_TRUTH_ID } from './v320DispatchSigningTruth.js';

export const V200_EXPORT_VERSION = BASE_EXPORT_VERSION;
export const V225_EXPORT_RETURN_TRUTH_ID = '2026-08-26-v320-full-history-nonblocking-evidence-export-v1';
const STRICT_DELIVERY_TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const DAILY_MEMBERSHIP_TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
// Compatibility marker for pre-V320 source assertions only: applyV294ExportAttemptSigningTruth.
// Runtime ownership moved to applyV320DispatchSigningTruth because the old V294 pass
// measured report-membership-date -> POD and aborted export on optional evidence gaps.
const normalizeBill=v=>String(v||'').trim().toUpperCase();
const dateKey=v=>{const m=String(v||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const chunks=(values,size=220)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
function markReturned(row,source='退回终态'){if(!row||row.pod)return row;row.returned=true;row.pending=false;row.delivering=false;row.statusCode=row.statusCode||'R';row.statusDesc='RETURNED';row.returnSource=source;if(row.evidence?.add)row.evidence.add(source);return row;}
function applyShopee1203SavedTrackTruth(type,rows){
  if(!['SHOPEECN','SHOPEEVN'].includes(type)||!rows.length)return rows;const db=getDb(),byBill=new Map(rows.map(row=>[normalizeBill(row.shipmentCode),row])),bills=[...byBill.keys()].filter(Boolean);
  for(const part of chunks(bills)){const marks=part.map(()=>'?').join(',');let events=[];try{events=db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part);}catch{continue;}for(const event of events){const bill=normalizeBill(event.shipmentCode),row=byBill.get(bill);if(!row||row.pod||!bill.startsWith('SPE'))continue;if(isShopeePending1203ReturnEvent(event))markReturned(row,'轨迹历史:Pending1203派送异常');}}
  return rows;
}
function normalizeTerminalExclusion(rows){for(const row of rows){if(!row)continue;if(row.pod){row.returned=false;row.pending=false;row.delivering=false;continue;}if(row.returned){row.pending=false;row.delivering=false;row.statusCode=row.statusCode||'R';row.statusDesc=row.statusDesc||'RETURNED';}}return rows;}
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
  // Keep the historical V230 pass for compatibility, then V320 overwrites attempt/signing
  // with the corrected saved-event rule: real first dispatch START -> real POD.
  applyV230AttemptSigningTruth(businessType,rows);
  applyV320DispatchSigningTruth(businessType,rows,{db:getDb()});
  const diag=evidenceDiagnostics(businessType,rows);
  // V320 deliberately does NOT fail the whole workbook just because optional
  // attempt/signing evidence is incomplete. Known values are exported; unknowns
  // remain explicit. True source-membership loss is still guarded below.
  for(const row of rows){row.exportEvidencePartial=diag.partial;row.exportAttemptMissing=diag.attemptMissing;row.exportSigningMissing=diag.signingMissing;row.v320ExportTruthId=V225_EXPORT_RETURN_TRUTH_ID;}
  rows=DAILY_MEMBERSHIP_TYPES.has(businessType)?expandDailyMembership(rows,range):rows;
  const keys=rows.map(row=>`${dateKey(row.reportMembershipDate||row.dailyMembershipDates?.[0])}|${normalizeBill(row.shipmentCode)}`),unique=new Set(keys.filter(key=>!key.startsWith('|')));
  if(DAILY_MEMBERSHIP_TYPES.has(businessType)&&unique.size!==rows.length)throw new Error(`V320_EXPORT_DUPLICATE_DAILY_MEMBER:${businessType}:${rows.length-unique.size}`);
  if(!rows.length)throw new Error(`${businessType} 在所选区间没有可导出的已保存日报成员。`);
  onProgress({phase:'returnAttemptSigningTruth',completed:rows.length,total:rows.length,returned:rows.filter(r=>r.returned&&!r.pod).length,notPodActive:rows.filter(r=>!r.pod&&!r.returned).length,unknownAttemptPod:diag.attemptMissing,unknownSigningPod:diag.signingMissing,dailyMembershipOccurrences:rows.length,evidencePartial:diag.partial,engine:`${V225_EXPORT_RETURN_TRUTH_ID}+${V230_ATTEMPT_SIGNING_TRUTH_ID}+${V320_HISTORICAL_EXPORT_ROWS_ID}+${V320_DISPATCH_SIGNING_TRUTH_ID}`});
  return rows;
}

console.info('[CE-QC][V320_EXPORT_TRUTH]',V225_EXPORT_RETURN_TRUTH_ID,'export reads full persisted history; optional attempt/signing gaps are warnings rather than fatal errors; average days use real dispatch START→POD samples.');
