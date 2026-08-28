import path from 'node:path';
import { collectV200Rows, V200_EXPORT_VERSION } from './v225ExportReturnTruth.js';
import { statsOf, bucketRows, anchorMaps, completeAttemptRatio, completeSigningAverage } from './v200Metrics.js';
import { writeV200ReferenceWorkbook } from './v200ReferenceWorkbook.js';
import { V294_METRIC_COMPLETENESS_ID } from './v294MetricCompletenessTruth.js';

export { V200_EXPORT_VERSION } from './v225ExportReturnTruth.js';
export { resolveV200Attempt, resolveV200AverageDays } from './v200EvidenceData.js';
export { internalHyperlinkFormulaForV200 } from './v200ReferenceWorkbook.js';

function safeFileName(value = '') { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim(); }
function displayType(type) { return ({ SHOPEECN: 'SHOPEE CN', SHOPEEVN: 'SHOPEE VN' })[type] || type; }
function periodLabel(periodType = 'custom') { return ({ daily: '日报', weekly: '周报', monthly: '月报', custom: '自定义日期' })[periodType] || '区间报表'; }
function dateKey(value = '') { const m = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; }
function membershipDate(row = {}) { return dateKey(row.reportMembershipDate || row.dailyMembershipDates?.[0] || row.firstReportDate); }

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

export async function createV200ReferenceDashboardWorkbook({ type, periodType = 'custom', range, outputDir, onProgress = () => {} }) {
  const businessType = String(type || '').trim().toUpperCase();
  const rows = await collectV200Rows(businessType, range, onProgress);
  if (!rows.length) throw new Error(`${displayType(businessType)} 在所选区间没有数据。`);
  assertV200ExportRange(rows, range);
  const stats = statsOf(rows, range);
  const dailyTotal = stats.daily.reduce((sum, row) => sum + Number(row.total || 0), 0);
  if (Number(stats.overall.total || 0) !== rows.length || dailyTotal !== rows.length) {
    throw new Error(`V200_EXPORT_MEMBERSHIP_TOTAL_MISMATCH:rows=${rows.length}:overall=${stats.overall.total}:daily=${dailyTotal}`);
  }
  const bucket = bucketRows(rows);
  const anchors = anchorMaps(bucket);
  const file = path.join(outputDir, safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_每日数据看板_${range.from}_至_${range.to}_V200.xlsx`));
  await writeV200ReferenceWorkbook({ file, type: businessType, range, rows, stats, bucket, anchors, onProgress });
  const overall = stats.overall;
  const attempt1Rate = completeAttemptRatio(overall, overall.a1);
  const attempt2Rate = completeAttemptRatio(overall, overall.a2);
  const attempt3Rate = completeAttemptRatio(overall, overall.a3);
  const averageDays = completeSigningAverage(overall.days, overall.pod);
  const ppAverageDays = completeSigningAverage(overall.ppDays, overall.ppPod);
  const pvAverageDays = completeSigningAverage(overall.pvDays, overall.pvPod);
  return {
    file,
    summary: {
      type: businessType,
      range: { from: dateKey(range.from), to: dateKey(range.to) },
      total: overall.total,
      pod: overall.pod,
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
      metricCompletenessId: V294_METRIC_COMPLETENESS_ID,
      engine: V200_EXPORT_VERSION,
      outputContract: 'V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY'
    }
  };
}
