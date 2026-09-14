import path from 'node:path';
import ExcelJS from 'exceljs';
import { collectV200Rows, V200_EXPORT_VERSION } from './v225ExportReturnTruth.js';
import { statsOf, bucketRows, anchorMaps, completeAttemptRatio, completeSigningAverage, assertV200BucketConservation } from './v200Metrics.js';
import { writeV200ReferenceWorkbook } from './v200ReferenceWorkbook.js';
import { V294_METRIC_COMPLETENESS_ID } from './v294MetricCompletenessTruth.js';
import { repairV484StrictExportEvidence, isV484StrictExportEvidenceType, V484_STRICT_EXPORT_EVIDENCE_OWNER_ID } from './v484StrictExportEvidenceOwner.js';
import { assertV514CanonicalExportMembership, V514_CANONICAL_EXPORT_MEMBERSHIP_GUARD_ID } from './v514CanonicalExportMembershipGuard.js';

export { V200_EXPORT_VERSION } from './v225ExportReturnTruth.js';
export { resolveV200Attempt, resolveV200AverageDays } from './v200EvidenceData.js';
export { internalHyperlinkFormulaForV200 } from './v200ReferenceWorkbook.js';

const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const V200_REQUIRED_DETAIL_SHEETS=['全部明细','金边明细','外省明细','门店明细','POD明细','未POD明细','分配派送中明细','Pending明细','退回明细'];
const V200_REQUIRED_DETAIL_HEADERS=['日期','运单编号','下单时间','状态标识','状态说明','收件省份','区域分类','当前门店','当前省份','收件人','收件人手机','收件地址','派件时间','派件门店','派件省份','派件快递员','异常编码','异常描述','备注'];
function safeFileName(value = '') { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim(); }
function displayType(type) { return ({ SHOPEECN: 'SHOPEE CN', SHOPEEVN: 'SHOPEE VN' })[type] || type; }
function periodLabel(periodType = 'custom') { return ({ daily: '日报', weekly: '周报', monthly: '月报', custom: '自定义日期' })[periodType] || '区间报表'; }
function dateKey(value = '') { const m = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; }
function membershipDate(row = {}) { return dateKey(row.reportMembershipDate || row.dailyMembershipDates?.[0] || row.firstReportDate); }
function positiveDays(value) { const n = Number(value); return Number.isFinite(n) && n > 0; }
function realAttempt(value) { const n = Number(value); return Number.isFinite(n) && n >= 1 && n <= 3; }

export function assertV200ExportRange(rows = [], range = {}) {
  const from = dateKey(range.from), to = dateKey(range.to);
  if (!from || !to || from > to) throw new Error('V200_EXPORT_RANGE_INVALID');
  const outside = rows.filter(row => {
    const date = membershipDate(row);
    return !date || date < from || date > to;
  });
  if (outside.length) {
    const sample = outside.slice(0, 5).map(row => `${membershipDate(row) || '?'}:${String(row.shipmentCode || '')}`).join(',');
    throw new Error(`V200_EXPORT_RANGE_LEAK:${outside.length}:${sample}`);
  }
  return true;
}

export function assertShopeeExportTruth(businessType, rows = [], stats = {}) {
  const type = String(businessType || '').toUpperCase();
  if (!SHOPEE_TYPES.has(type)) return true;
  const podRows = rows.filter(row => row?.pod === true);
  const missingAttempt = podRows.filter(row => !realAttempt(row.attemptNo));
  const missingPodDate = podRows.filter(row => !dateKey(row.podDate || row.podTime || row.POD时间));
  const missingSigningDays = podRows.filter(row => !positiveDays(row.signingDays || row.deliveryDays));
  const unknownRegion = rows.filter(row => !['金边', '外省'].includes(String(row.area || '')));
  const o = stats.overall || {};
  const reconciliation = {
    total: Number(o.total || 0), pp: Number(o.pp || 0), pv: Number(o.pv || 0), unknown: Number(o.unknown || 0),
    pod: Number(o.pod || 0), returned: Number(o.returned || 0), notPod: Number(o.notPod || 0),
    a1: Number(o.a1 || 0), a2: Number(o.a2 || 0), a3: Number(o.a3 || 0), attemptUnknown: Number(o.attemptUnknown || 0),
    signingSamples: Array.isArray(o.days) ? o.days.length : 0,
    ppPod: Number(o.ppPod || 0), pvPod: Number(o.pvPod || 0),
    ppSigningSamples: Array.isArray(o.ppDays) ? o.ppDays.length : 0,
    pvSigningSamples: Array.isArray(o.pvDays) ? o.pvDays.length : 0
  };
  const failures = [];
  if (unknownRegion.length || reconciliation.unknown !== 0 || reconciliation.pp + reconciliation.pv !== reconciliation.total) failures.push(`REGION:${unknownRegion.length}/${reconciliation.unknown}`);
  if (reconciliation.pod + reconciliation.returned + reconciliation.notPod !== reconciliation.total) failures.push(`STATUS:${reconciliation.pod}+${reconciliation.returned}+${reconciliation.notPod}!=${reconciliation.total}`);
  if (missingAttempt.length || reconciliation.attemptUnknown !== 0 || reconciliation.a1 + reconciliation.a2 + reconciliation.a3 !== reconciliation.pod) failures.push(`ATTEMPT:${missingAttempt.length}/${reconciliation.attemptUnknown}`);
  if (missingPodDate.length) failures.push(`POD_DATE:${missingPodDate.length}`);
  if (missingSigningDays.length || reconciliation.signingSamples !== reconciliation.pod) failures.push(`SIGNING:${missingSigningDays.length}/${reconciliation.signingSamples}/${reconciliation.pod}`);
  if (reconciliation.ppSigningSamples !== reconciliation.ppPod) failures.push(`PP_SIGNING:${reconciliation.ppSigningSamples}/${reconciliation.ppPod}`);
  if (reconciliation.pvSigningSamples !== reconciliation.pvPod) failures.push(`PV_SIGNING:${reconciliation.pvSigningSamples}/${reconciliation.pvPod}`);
  for (const day of stats.daily || []) {
    const total = Number(day.total || 0), pod = Number(day.pod || 0), returned = Number(day.returned || 0), notPod = Number(day.notPod || 0);
    const a1 = Number(day.a1 || 0), a2 = Number(day.a2 || 0), a3 = Number(day.a3 || 0), unknown = Number(day.attemptUnknown || 0);
    if (Number(day.pp || 0) + Number(day.pv || 0) !== total || Number(day.unknown || 0) !== 0) failures.push(`DAY_REGION:${day.date}`);
    if (pod + returned + notPod !== total) failures.push(`DAY_STATUS:${day.date}`);
    if (a1 + a2 + a3 !== pod || unknown !== 0) failures.push(`DAY_ATTEMPT:${day.date}`);
    if ((day.days || []).length !== pod) failures.push(`DAY_SIGNING:${day.date}`);
    if ((day.ppDays || []).length !== Number(day.ppPod || 0)) failures.push(`DAY_PP_SIGNING:${day.date}`);
    if ((day.pvDays || []).length !== Number(day.pvPod || 0)) failures.push(`DAY_PV_SIGNING:${day.date}`);
  }
  if (failures.length) {
    const sample = [...missingAttempt, ...missingPodDate, ...missingSigningDays, ...unknownRegion].slice(0, 8).map(row => String(row.shipmentCode || row.运单号 || '')).filter(Boolean);
    const error = new Error(`SHOPEE_EXPORT_TRUTH_INCOMPLETE:${type}:${[...new Set(failures)].join('|')}${sample.length ? `:sample=${sample.join(',')}` : ''}`);
    error.code = 'SHOPEE_EXPORT_TRUTH_INCOMPLETE';
    error.diagnostics = { businessType: type, failures: [...new Set(failures)], reconciliation, sample };
    throw error;
  }
  return true;
}

async function validateWrittenV200Workbook(file,bucket){
  const expectedNames=['每日看板',...V200_REQUIRED_DETAIL_SHEETS];
  const expectedSet=new Set(expectedNames);
  const expectedRows=new Map(V200_REQUIRED_DETAIL_SHEETS.map(name=>[name,Number(bucket[name]?.length||0)+1]));
  const actualRows=new Map();
  const actualHeaders=new Map();
  const seen=[];
  const reader=new ExcelJS.stream.xlsx.WorkbookReader(file,{worksheets:'emit',sharedStrings:'cache',styles:'ignore',hyperlinks:'ignore'});
  for await(const sheet of reader){
    seen.push(sheet.name);
    if(!expectedSet.has(sheet.name))continue;
    let rows=0,header=null;
    for await(const row of sheet){
      rows+=1;
      if(rows===1&&V200_REQUIRED_DETAIL_SHEETS.includes(sheet.name)){
        header=(Array.isArray(row.values)?row.values.slice(1):[]).map(value=>String(value??''));
      }
    }
    actualRows.set(sheet.name,rows);
    if(header)actualHeaders.set(sheet.name,header);
  }
  const unexpected=seen.filter(name=>!expectedSet.has(name));
  if(unexpected.length)throw new Error(`V200_WRITTEN_WORKBOOK_UNEXPECTED_SHEET:${unexpected.join(',')}`);
  const missing=expectedNames.filter(name=>!actualRows.has(name));
  if(missing.length)throw new Error(`V200_WRITTEN_WORKBOOK_SHEET_MISSING:${missing.join(',')}`);
  if(seen.length!==expectedNames.length)throw new Error(`V200_WRITTEN_WORKBOOK_SHEET_COUNT_MISMATCH:${seen.length}/${expectedNames.length}`);
  const rowMismatches=[];
  const headerMismatches=[];
  for(const name of V200_REQUIRED_DETAIL_SHEETS){
    const wanted=expectedRows.get(name),found=actualRows.get(name);
    if(found!==wanted)rowMismatches.push(`${name}:${found}/${wanted}`);
    const header=actualHeaders.get(name)||[];
    if(JSON.stringify(header)!==JSON.stringify(V200_REQUIRED_DETAIL_HEADERS))headerMismatches.push(name);
  }
  if(rowMismatches.length)throw new Error(`V200_WRITTEN_WORKBOOK_ROW_MISMATCH:${rowMismatches.join('|')}`);
  if(headerMismatches.length)throw new Error(`V200_WRITTEN_WORKBOOK_HEADER_MISMATCH:${headerMismatches.join(',')}`);
  return{status:'PASSED',sheets:Object.fromEntries([...actualRows.entries()]),detailSheets:V200_REQUIRED_DETAIL_SHEETS.length,headerContract:'PASSED',sheetCount:seen.length};
}

export async function createV200ReferenceDashboardWorkbook({ type, periodType = 'custom', range, outputDir, onProgress = () => {} }) {
  const businessType = String(type || '').trim().toUpperCase();
  const rows = await collectV200Rows(businessType, range, onProgress);
  const canonicalMembership = assertV514CanonicalExportMembership({ businessType, range, rows });
  if (!rows.length) throw new Error(`${displayType(businessType)} 在所选区间没有数据。`);
  assertV200ExportRange(rows, range);
  if (isV484StrictExportEvidenceType(businessType)) {
    await repairV484StrictExportEvidence({
      type: businessType,
      range,
      rows,
      onProgress(info = {}) {
        onProgress({ ...info, strictExportMemberRepair: true, evidenceRepairVersion: V484_STRICT_EXPORT_EVIDENCE_OWNER_ID });
      }
    });
  }
  const stats = statsOf(rows, range);
  const dailyTotal = stats.daily.reduce((sum, row) => sum + Number(row.total || 0), 0);
  if (Number(stats.overall.total || 0) !== rows.length || dailyTotal !== rows.length) {
    throw new Error(`V200_EXPORT_MEMBERSHIP_TOTAL_MISMATCH:rows=${rows.length}:overall=${stats.overall.total}:daily=${dailyTotal}`);
  }
  assertShopeeExportTruth(businessType, rows, stats);
  const bucket = bucketRows(rows);
  const workbookReconciliation = assertV200BucketConservation(bucket, { businessType });
  if (Number(workbookReconciliation.all || 0) !== rows.length) {
    throw new Error(`V200_WORKBOOK_SOURCE_RECONCILIATION_FAILED:${businessType}:source=${rows.length}:all=${workbookReconciliation.all}`);
  }
  const anchors = anchorMaps(bucket);
  const file = path.join(outputDir, safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_每日数据看板_${range.from}_至_${range.to}_V200.xlsx`));
  await writeV200ReferenceWorkbook({ file, type: businessType, range, rows, stats, bucket, anchors, onProgress });
  const writtenWorkbookCheck=await validateWrittenV200Workbook(file,bucket);
  const overall = stats.overall;
  const attempt1Rate = overall.pod ? completeAttemptRatio(overall, overall.a1) : 0;
  const attempt2Rate = overall.pod ? completeAttemptRatio(overall, overall.a2) : 0;
  const attempt3Rate = overall.pod ? completeAttemptRatio(overall, overall.a3) : 0;
  const averageDays = overall.pod ? completeSigningAverage(overall.days, overall.pod) : 0;
  const ppAverageDays = overall.ppPod ? completeSigningAverage(overall.ppDays, overall.ppPod) : 0;
  const pvAverageDays = overall.pvPod ? completeSigningAverage(overall.pvDays, overall.pvPod) : 0;
  return {
    file,
    summary: {
      type: businessType,
      range: { from: dateKey(range.from), to: dateKey(range.to) },
      total: overall.total,
      pod: overall.pod,
      notPod: overall.notPod,
      returned: overall.returned,
      delivery: overall.delivery,
      pending: overall.pending,
      store: overall.store,
      pp: overall.pp,
      pv: overall.pv,
      attempt1: overall.a1,
      attempt2: overall.a2,
      attempt3: overall.a3,
      attemptUnknown: overall.attemptUnknown,
      attempt1Rate,
      attempt2Rate,
      attempt3Rate,
      attemptEvidenceComplete: overall.pod === 0 || overall.attemptUnknown === 0,
      averageDays,
      ppAverageDays,
      pvAverageDays,
      signingEvidenceComplete: overall.pod === 0 || overall.days.length === overall.pod,
      canonicalMembership: { ...canonicalMembership, id: canonicalMembership.id || V514_CANONICAL_EXPORT_MEMBERSHIP_GUARD_ID },
      workbookReconciliation,
      writtenWorkbookCheck,
      metricCompletenessId: V294_METRIC_COMPLETENESS_ID,
      engine: V200_EXPORT_VERSION,
      outputContract: 'V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY'
    }
  };
}
