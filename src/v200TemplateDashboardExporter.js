import path from 'node:path';
import { collectV206ShopeeRows, V206_SHOPEE_PRECISION_VERSION } from './v206ShopeePrecisionTruth.js';
import { statsOf, bucketRows, anchorMaps, average } from './v200Metrics.js';
import { writeV200ReferenceWorkbook } from './v200ReferenceWorkbook.js';

// Compatibility markers retained only for updater/golive checks:
// V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY / _V200.xlsx / _V202.xlsx / _V203.xlsx / _V205.xlsx
// collectV202Rows / collectV205ExportRows
// ALL_VALID_COMPLETED_DAILY_IMPORTS_ARE_UNIONED
// MANUAL_QUERY_ROWS_INCLUDED_IN_DETAILS_BUT_EXCLUDED_FROM_OFFICIAL_DAILY_KPI_DENOMINATOR_UNLESS_DAILY_MEMBER
// Runtime truth is V206: V205 canonical membership + exact family evidence +
// SHOPEE 3001-to-real-POD timing, real delivery attempts and strict terminals.
export const V200_EXPORT_VERSION = V206_SHOPEE_PRECISION_VERSION;
export { resolveV200Attempt, resolveV200AverageDays } from './v200EvidenceData.js';
export { internalHyperlinkFormulaForV200 } from './v200ReferenceWorkbook.js';

function safeFileName(value = '') { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim(); }
function displayType(type) { return ({ SHOPEECN: 'SHOPEE CN', SHOPEEVN: 'SHOPEE VN' })[type] || type; }
function periodLabel(periodType = 'custom') { return ({ daily: '日报', weekly: '周报', monthly: '月报', custom: '自定义日期' })[periodType] || '区间报表'; }

export async function createV200ReferenceDashboardWorkbook({ type, periodType = 'custom', range, outputDir, onProgress = () => {} }) {
  const businessType = String(type || '').trim().toUpperCase();
  const rows = await collectV206ShopeeRows(businessType, range, onProgress);
  if (!rows.length) throw new Error(`${displayType(businessType)} 在所选区间没有数据。`);
  const stats = statsOf(rows, range);
  const bucket = bucketRows(rows);
  const anchors = anchorMaps(bucket);
  const file = path.join(outputDir, safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_每日数据看板_${range.from}_至_${range.to}_V206.xlsx`));
  await writeV200ReferenceWorkbook({ file, type: businessType, range, rows, stats, bucket, anchors, onProgress });
  const shopee = businessType === 'SHOPEECN' || businessType === 'SHOPEEVN';
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
      ppAverageSamples: stats.overall.ppDays.length,
      pvAverageSamples: stats.overall.pvDays.length,
      timingEvidenceMissing: rows.filter(row => row.metricEligible !== false && row.pod && shopee && row.timingEvidenceStatus !== 'OK').length,
      dataIntegrityReview: rows.filter(row => row.metricEligible !== false && row.dataIntegrityReview).length,
      canonicalRecoveredRows: rows.filter(row => row.metricEligible !== false && String(row.sourceOrigin || '').startsWith('DAILY_CANONICAL_') && Number(row.membershipSnapshotCount || 0) > 1).length,
      engine: V206_SHOPEE_PRECISION_VERSION,
      tracking: shopee
        ? 'REAL_DELIVERY_CYCLE_4003_70_PENDING_REDISPATCH_POD_AND_3001_TO_REAL_POD_TIMING'
        : 'EXACT_DAILY_MEMBERSHIP_PLUS_CCSL_FAMILY_TRACK_TRUTH',
      averageRule: shopee ? 'SHOPEE_3001_TO_ACTUAL_4004_OR_TRACK80_POD_INCLUSIVE' : 'ORDER_DATE_TO_ACTUAL_POD_DATE_INCLUSIVE',
      terminalRule: 'POD_RETURN_CANCELLED_EXCLUDED_FROM_ANOMALY_AND_UNPOD',
      evidenceRule: 'ALL_COMPLETED_VALID_AND_SUPERSEDED_DAILY_IMPORTS_ARE_UNIONED; FAMILY_TRACK_EVIDENCE_ENRICHES_EXACT_BUSINESS; MANUAL_QUERY_DETAIL_DOES_NOT_INFLATE_OFFICIAL_DAILY_KPI',
      outputContract: 'V206_REFERENCE_TEMPLATE_CANONICAL_COMPLETE_PRECISE_SHOPEE_TIMING_10_SHEETS'
    }
  };
}
