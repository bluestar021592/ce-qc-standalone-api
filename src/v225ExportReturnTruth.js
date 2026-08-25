import { getDb } from './db.js';
import { collectV200Rows as collectBaseRows, V200_EXPORT_VERSION as BASE_EXPORT_VERSION } from './v200EvidenceData.js';
import { listCompletedWhppSnapshots } from './v87WhppExportStore.js';
import { isShopeePending1203ReturnEvent } from './shopeeReturnTruth.js';
import { applyV230AttemptSigningTruth, V230_ATTEMPT_SIGNING_TRUTH_ID } from './v230AttemptSigningTruth.js';
import { applyV294ExportAttemptSigningTruth, V294_ATTEMPT_SIGNING_TRUTH_ID } from './v294AttemptSigningTruth.js';

export const V200_EXPORT_VERSION = BASE_EXPORT_VERSION;
export const V225_EXPORT_RETURN_TRUTH_ID = '2026-08-25-v294-zero-loss-three-way-export-parity-v3';
const UNIFIED_TYPES=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);
const STRICT_DELIVERY_TYPES=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
const DAILY_MEMBERSHIP_TYPES=new Set([...UNIFIED_TYPES,'WHPP']);

function normalizeBill(value = '') { return String(value || '').trim().toUpperCase(); }
function dateKey(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function chunks(values = [], size = 220) { const out=[]; for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size)); return out; }

function markReturned(row, source = '退回终态') {
  if (!row || row.pod) return row;
  row.returned = true; row.pending = false; row.delivering = false;
  row.statusCode = row.statusCode || 'R'; row.statusDesc = 'RETURNED'; row.returnSource = source;
  if (row.evidence?.add) row.evidence.add(source);
  return row;
}
function applyShopee1203SavedTrackTruth(type, rows) {
  if (!['SHOPEECN', 'SHOPEEVN'].includes(type) || !rows.length) return rows;
  const db = getDb(); const byBill = new Map(rows.map(row => [normalizeBill(row.shipmentCode), row])); const bills = [...byBill.keys()].filter(Boolean);
  for (const chunk of chunks(bills)) {
    const marks = chunk.map(() => '?').join(','); let events = [];
    try { events = db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,id`).all(...chunk); }
    catch { continue; }
    for (const event of events) {
      const bill = normalizeBill(event.shipmentCode), row = byBill.get(bill);
      if (!row || row.pod || !bill.startsWith('SPE')) continue;
      if (isShopeePending1203ReturnEvent(event)) markReturned(row, '轨迹历史:Pending1203派送异常');
    }
  }
  return rows;
}
function normalizeTerminalExclusion(rows) {
  for (const row of rows) {
    if (!row) continue;
    if (row.pod) { row.returned=false; row.pending=false; row.delivering=false; continue; }
    if (row.returned) { row.pending=false; row.delivering=false; row.statusCode=row.statusCode||'R'; row.statusDesc=row.statusDesc||'RETURNED'; }
  }
  return rows;
}

function exactUnifiedMembership(type, range, db=getDb()){
  const from=dateKey(range?.from),to=dateKey(range?.to);
  if(!from||!to||from>to)throw new Error('V294导出日期范围无效');
  const rows=db.prepare(`
    WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
        ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn
      FROM unified_import_batches b
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ), latest AS (SELECT reportDate,snapshotId FROM ranked WHERE rn=1)
    SELECT DISTINCT l.reportDate,UPPER(TRIM(u.shipmentCode)) shipmentCode
    FROM latest l JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
    WHERE UPPER(TRIM(u.businessType))=? AND TRIM(COALESCE(u.shipmentCode,''))<>''
    ORDER BY l.reportDate,shipmentCode
  `).all(from,to,type);
  const datesByBill=new Map(),dates=new Set(),countByDate=new Map();
  for(const row of rows){
    const bill=normalizeBill(row.shipmentCode),date=dateKey(row.reportDate);if(!bill||!date)continue;
    if(!datesByBill.has(bill))datesByBill.set(bill,[]);datesByBill.get(bill).push(date);dates.add(date);countByDate.set(date,(countByDate.get(date)||0)+1);
  }
  return {datesByBill,expectedOccurrences:rows.length,dates:[...dates].sort(),countByDate};
}
function exactWhppMembership(range,db=getDb()){
  const from=dateKey(range?.from),to=dateKey(range?.to);
  if(!from||!to||from>to)throw new Error('V294 WHPP导出日期范围无效');
  const snapshots=listCompletedWhppSnapshots(from,to);
  const datesByBill=new Map(),countByDate=new Map();let expectedOccurrences=0;
  for(const snapshot of snapshots){
    const reportDate=dateKey(snapshot.reportDate);if(!reportDate)continue;
    const dailyBills=new Set();
    for(const row of snapshot.payload?.finalRows||[]){
      const bill=normalizeBill(row.shipmentCode||row.运单号);if(!bill||dailyBills.has(bill))continue;
      dailyBills.add(bill);expectedOccurrences+=1;
      if(!datesByBill.has(bill))datesByBill.set(bill,[]);datesByBill.get(bill).push(reportDate);
    }
    countByDate.set(reportDate,dailyBills.size);
  }
  const reports=db.prepare(`SELECT reportDate,totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate BETWEEN ? AND ? ORDER BY reportDate`).all(from,to);
  for(const report of reports){
    const d=dateKey(report.reportDate),expected=Math.max(0,Number(report.totalCount||0)),actual=countByDate.get(d)||0;
    if(expected!==actual)throw new Error(`V294_WHPP_EXPORT_DAILY_MEMBERSHIP_MISMATCH:${d}:expected=${expected}:actual=${actual}`);
  }
  const missingReportDates=[...countByDate.keys()].filter(d=>!reports.some(row=>dateKey(row.reportDate)===d));
  if(missingReportDates.length)throw new Error(`V294_WHPP_EXPORT_REPORT_LEDGER_MISSING:${missingReportDates.join(',')}`);
  return {datesByBill,expectedOccurrences,dates:[...countByDate.keys()].sort(),countByDate};
}
function exactMembership(type,range,db=getDb()){
  if(UNIFIED_TYPES.has(type))return exactUnifiedMembership(type,range,db);
  if(type==='WHPP')return exactWhppMembership(range,db);
  return {datesByBill:new Map(),expectedOccurrences:null,dates:[],countByDate:new Map()};
}
function applyExactMembershipAndExpand(type,rows,range,db=getDb()){
  if(!DAILY_MEMBERSHIP_TYPES.has(type))return rows;
  const membership=exactMembership(type,range,db);
  const byBill=new Map(rows.map(row=>[normalizeBill(row.shipmentCode||row.运单号),row]));
  const missing=[];
  for(const bill of membership.datesByBill.keys())if(!byBill.has(bill))missing.push(bill);
  if(missing.length)throw new Error(`V294_EXPORT_MEMBERSHIP_MISSING:${type}:${missing.length}:${missing.slice(0,20).join(',')}`);
  const expanded=[];
  for(const [bill,dates] of membership.datesByBill){
    const row=byBill.get(bill);if(!row)continue;
    for(const reportDate of dates)expanded.push({...row,reportMembershipDate:reportDate,dailyMembershipDates:[reportDate]});
  }
  if(expanded.length!==membership.expectedOccurrences)throw new Error(`V294_EXPORT_MEMBERSHIP_COUNT_MISMATCH:${type}:expected=${membership.expectedOccurrences}:actual=${expanded.length}`);
  rows.splice(0,rows.length,...expanded);
  return rows;
}
function assertStrictEvidenceComplete(type,rows){
  if(!STRICT_DELIVERY_TYPES.has(type))return;
  const podRows=rows.filter(row=>row.pod);
  const attemptMissing=podRows.filter(row=>!row.attemptEvidenceComplete||!Number(row.attemptNo||0));
  const signingMissing=podRows.filter(row=>!dateKey(row.podDate)||!Number.isFinite(Number(row.signingDays))||Number(row.signingDays)<=0);
  if(attemptMissing.length||signingMissing.length){
    const err=new Error(`V294_EXPORT_EVIDENCE_INCOMPLETE:${type}:POD=${podRows.length}:attemptMissing=${attemptMissing.length}:signingMissing=${signingMissing.length}`);
    err.code='V294_EXPORT_EVIDENCE_INCOMPLETE';
    err.details={businessType:type,pod:podRows.length,attemptMissing:attemptMissing.map(row=>row.shipmentCode).slice(0,30),signingMissing:signingMissing.map(row=>row.shipmentCode).slice(0,30)};
    throw err;
  }
}

export async function collectV200Rows(type, range, onProgress = () => {}) {
  const businessType = String(type || '').trim().toUpperCase();
  const rows = await collectBaseRows(businessType, range, onProgress);
  applyShopee1203SavedTrackTruth(businessType, rows);
  normalizeTerminalExclusion(rows);
  applyV230AttemptSigningTruth(businessType, rows);
  applyV294ExportAttemptSigningTruth(businessType, rows, { range });
  assertStrictEvidenceComplete(businessType,rows);
  applyExactMembershipAndExpand(businessType,rows,range);
  const uniqueDailyKeys=new Set(rows.map(row=>`${dateKey(row.reportMembershipDate||row.dailyMembershipDates?.[0])}|${normalizeBill(row.shipmentCode)}`));
  if(DAILY_MEMBERSHIP_TYPES.has(businessType)&&uniqueDailyKeys.size!==rows.length)throw new Error(`V294_EXPORT_DUPLICATE_DAILY_MEMBER:${businessType}:${rows.length-uniqueDailyKeys.size}`);
  onProgress({
    phase: 'returnAttemptSigningTruth',
    completed: rows.length,
    total: rows.length,
    returned: rows.filter(row => row.returned && !row.pod).length,
    notPodActive: rows.filter(row => !row.pod && !row.returned).length,
    unknownAttemptPod: rows.filter(row => row.pod && STRICT_DELIVERY_TYPES.has(businessType) && !Number(row.attemptNo || 0)).length,
    dailyMembershipOccurrences: rows.length,
    engine: `${V225_EXPORT_RETURN_TRUTH_ID}+${V230_ATTEMPT_SIGNING_TRUTH_ID}+${V294_ATTEMPT_SIGNING_TRUTH_ID}`
  });
  return rows;
}
