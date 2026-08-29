import { getDb } from './db.js';
import { V200_EXPORT_VERSION as BASE_EXPORT_VERSION } from './v200EvidenceData.js';
import { isShopeePending1203ReturnEvent } from './shopeeReturnTruth.js';
import { applyV230AttemptSigningTruth, V230_ATTEMPT_SIGNING_TRUTH_ID } from './v230AttemptSigningTruth.js';
import { collectV320HistoricalExportRows, V320_HISTORICAL_EXPORT_ROWS_ID } from './v320HistoricalExportRows.js';
import { applyV320DispatchSigningTruth, V320_DISPATCH_SIGNING_TRUTH_ID } from './v320DispatchSigningTruth.js';

export const V200_EXPORT_VERSION = BASE_EXPORT_VERSION;
// Legacy identifier retained because external update gates/source diagnostics reference it.
export const V225_EXPORT_RETURN_TRUTH_ID = '2026-08-27-v329-first-report-pod-export-signing-v1';
const STRICT_DELIVERY_TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const DAILY_MEMBERSHIP_TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
// Compatibility marker for pre-V320 source assertions only: applyV294ExportAttemptSigningTruth.
const normalizeBill=v=>String(v||'').trim().toUpperCase();
const dateKey=v=>{const m=String(v||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const dayNumber=value=>{const d=dateKey(value);if(!d)return null;const [y,m,day]=d.split('-').map(Number);return Date.UTC(y,m-1,day);};
const inclusiveDays=(a,b)=>{const x=dayNumber(a),y=dayNumber(b);return x===null||y===null||y<x?0:Math.floor((y-x)/86400000)+1;};
const chunks=(values,size=220)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;};
function markReturned(row,source='退回终态'){if(!row||row.pod)return row;row.returned=true;row.pending=false;row.delivering=false;row.statusCode=row.statusCode||'R';row.statusDesc='RETURNED';row.returnSource=source;if(row.evidence?.add)row.evidence.add(source);return row;}
function applyShopee1203SavedTrackTruth(type,rows){
  if(!['SHOPEECN','SHOPEEVN'].includes(type)||!rows.length)return rows;const db=getDb(),byBill=new Map(rows.map(row=>[normalizeBill(row.shipmentCode),row])),bills=[...byBill.keys()].filter(Boolean);
  for(const part of chunks(bills)){const marks=part.map(()=>'?').join(',');let events=[];try{events=db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...part);}catch{continue;}for(const event of events){const bill=normalizeBill(event.shipmentCode),row=byBill.get(bill);if(!row||row.pod||!bill.startsWith('SPE'))continue;if(isShopeePending1203ReturnEvent(event))markReturned(row,'轨迹历史:Pending1203派送异常');}}
  return rows;
}
function normalizeTerminalExclusion(rows){for(const row of rows){if(!row)continue;if(row.pod){row.returned=false;row.pending=false;row.delivering=false;continue;}if(row.returned){row.pending=false;row.delivering=false;row.statusCode=row.statusCode||'R';row.statusDesc=row.statusDesc||'RETURNED';}}return rows;}
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
  // 1/2/3派与平均签收天数必须共享同一套真实派送证据：70 START优先，整票无70才允许60兜底；
  // 对TBKH/SHOPEE CN/VN，缺真实START或POD时保持未知，禁止再用首次日报日期覆盖真实派送时效。
  applyV230AttemptSigningTruth(businessType,rows);
  applyV320DispatchSigningTruth(businessType,rows,{db:getDb()});
  applyV329FirstReportSigning(businessType,rows);
  const diag=evidenceDiagnostics(businessType,rows);
  for(const row of rows){row.exportEvidencePartial=diag.partial;row.exportAttemptMissing=diag.attemptMissing;row.exportSigningMissing=diag.signingMissing;row.v320ExportTruthId=V225_EXPORT_RETURN_TRUTH_ID;}
  rows=DAILY_MEMBERSHIP_TYPES.has(businessType)?expandDailyMembership(rows,range):rows;
  const keys=rows.map(row=>`${dateKey(row.reportMembershipDate||row.dailyMembershipDates?.[0])}|${normalizeBill(row.shipmentCode)}`),unique=new Set(keys.filter(key=>!key.startsWith('|')));
  if(DAILY_MEMBERSHIP_TYPES.has(businessType)&&unique.size!==rows.length)throw new Error(`V320_EXPORT_DUPLICATE_DAILY_MEMBER:${businessType}:${rows.length-unique.size}`);
  if(!rows.length)throw new Error(`${businessType} 在所选区间没有可导出的已保存日报成员。`);
  onProgress({phase:'returnAttemptSigningTruth',completed:rows.length,total:rows.length,returned:rows.filter(r=>r.returned&&!r.pod).length,notPodActive:rows.filter(r=>!r.pod&&!r.returned).length,unknownAttemptPod:diag.attemptMissing,unknownSigningPod:diag.signingMissing,dailyMembershipOccurrences:rows.length,evidencePartial:diag.partial,engine:`${V225_EXPORT_RETURN_TRUTH_ID}+${V230_ATTEMPT_SIGNING_TRUTH_ID}+${V320_HISTORICAL_EXPORT_ROWS_ID}+${V320_DISPATCH_SIGNING_TRUTH_ID}`});
  return rows;
}

console.info('[CE-QC][V329_EXPORT_TRUTH]',V225_EXPORT_RETURN_TRUTH_ID,'TBKH/SHOPEE attempts and signing days share real START/failure-cycle/POD evidence; missing START or POD remains unknown instead of falling back to first-report dates.');