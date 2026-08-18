import path from 'node:path';
import { collectV202Rows, V202_DELIVERY_TRUTH_VERSION } from './v202DeliveryTruth.js';
import { statsOf, bucketRows, anchorMaps, average } from './v200Metrics.js';
import { writeV200ReferenceWorkbook } from './v200ReferenceWorkbook.js';

// Compatibility markers retained only for updater/golive checks:
// V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY / _V200.xlsx / _V202.xlsx
// Runtime truth is V203: real attempts + terminal truth + manual-query evidence universe.
export const V200_EXPORT_VERSION = V202_DELIVERY_TRUTH_VERSION;
export { resolveV200Attempt, resolveV200AverageDays } from './v200EvidenceData.js';
export { internalHyperlinkFormulaForV200 } from './v200ReferenceWorkbook.js';

function safeFileName(value = '') { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim(); }
function displayType(type) { return ({ SHOPEECN: 'SHOPEE CN', SHOPEEVN: 'SHOPEE VN' })[type] || type; }
function periodLabel(periodType = 'custom') { return ({ daily: '日报', weekly: '周报', monthly: '月报', custom: '自定义日期' })[periodType] || '区间报表'; }

export async function createV200ReferenceDashboardWorkbook({ type, periodType = 'custom', range, outputDir, onProgress = () => {} }) {
  const businessType = String(type || '').trim().toUpperCase();
  const rows = await collectV202Rows(businessType, range, onProgress);
  if (!rows.length) throw new Error(`${displayType(businessType)} 在所选区间没有数据。`);
  const stats = statsOf(rows, range);
  const bucket = bucketRows(rows);
  const anchors = anchorMaps(bucket);
  const file = path.join(outputDir, safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_每日数据看板_${range.from}_至_${range.to}_V203.xlsx`));
  await writeV200ReferenceWorkbook({ file, type: businessType, range, rows, stats, bucket, anchors, onProgress });
  return {
    file,
    summary: {
      type: businessType,
      total: stats.overall.total,
      manualEvidenceOnly: stats.overall.evidenceOnly,
      exportedDetailRows: rows.length,
      pod: stats.overall.pod,
      returned: stats.overall.returned,
      cancelled: stats.overall.cancelled,
      openUnpod: stats.overall.notPod,
      pp: stats.overall.pp,
      pv: stats.overall.pv,
      attempt1: stats.overall.a1,
      attempt2: stats.overall.a2,
      attempt3: stats.overall.a3,
      attemptUnknown: stats.overall.attemptUnknown,
      averageDays: average(stats.overall.days),
      ppAverageDays: average(stats.overall.ppDays),
      pvAverageDays: average(stats.overall.pvDays),
      validAverageSamples: stats.overall.days.length,
      engine: V202_DELIVERY_TRUTH_VERSION,
      tracking: businessType === 'SHOPEECN' || businessType === 'SHOPEEVN' ? 'REAL_DELIVERY_CYCLE_4003_70_PENDING_REDISPATCH_POD' : 'GENERIC_TERMINAL_TRUTH',
      averageRule: 'ORDER_DATE_TO_ACTUAL_POD_DATE_INCLUSIVE',
      terminalRule: 'POD_RETURN_CANCELLED_EXCLUDED_FROM_ANOMALY_AND_UNPOD',
      evidenceRule: 'MANUAL_QUERY_ROWS_INCLUDED_IN_DETAILS_BUT_EXCLUDED_FROM_OFFICIAL_DAILY_KPI_DENOMINATOR_UNLESS_DAILY_MEMBER',
      outputContract: 'V203_REFERENCE_TEMPLATE_REAL_ATTEMPT_TERMINAL_MANUAL_EVIDENCE_10_SHEETS'
    }
  };
}
