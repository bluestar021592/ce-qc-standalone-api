import path from 'node:path';
import { collectV201TrackedRows, V201_TRACKED_EXPORT_VERSION } from './v201TrackedEvidenceData.js';
import { statsOf, bucketRows, anchorMaps, average } from './v200Metrics.js';
import { writeV200ReferenceWorkbook } from './v200ReferenceWorkbook.js';

export const V200_EXPORT_VERSION = V201_TRACKED_EXPORT_VERSION;
export { resolveV200Attempt, resolveV200AverageDays } from './v200EvidenceData.js';
export { internalHyperlinkFormulaForV200 } from './v200ReferenceWorkbook.js';

function safeFileName(value = '') { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim(); }
function displayType(type) { return ({ SHOPEECN: 'SHOPEE CN', SHOPEEVN: 'SHOPEE VN' })[type] || type; }
function periodLabel(periodType = 'custom') { return ({ daily: '日报', weekly: '周报', monthly: '月报', custom: '自定义日期' })[periodType] || '区间报表'; }

export async function createV200ReferenceDashboardWorkbook({ type, periodType = 'custom', range, outputDir, onProgress = () => {} }) {
  const businessType = String(type || '').trim().toUpperCase();
  const rows = await collectV201TrackedRows(businessType, range, onProgress);
  if (!rows.length) throw new Error(`${displayType(businessType)} 在所选区间没有数据。`);
  const stats = statsOf(rows, range);
  const bucket = bucketRows(rows);
  const anchors = anchorMaps(bucket);
  const file = path.join(outputDir, safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_每日数据看板_${range.from}_至_${range.to}_V201.xlsx`));
  await writeV200ReferenceWorkbook({ file, type: businessType, range, rows, stats, bucket, anchors, onProgress });
  return {
    file,
    summary: {
      type: businessType,
      total: stats.overall.total,
      pod: stats.overall.pod,
      pp: stats.overall.pp,
      pv: stats.overall.pv,
      attempt1: stats.overall.a1,
      attempt2: stats.overall.a2,
      attempt3: stats.overall.a3,
      attemptUnknown: stats.overall.attemptUnknown,
      averageDays: average(stats.overall.days),
      ppAverageDays: average(stats.overall.ppDays),
      pvAverageDays: average(stats.overall.pvDays),
      engine: V201_TRACKED_EXPORT_VERSION,
      tracking: businessType === 'SHOPEECN' || businessType === 'SHOPEEVN' ? 'PERSISTED_SHOPEE_DISPATCH_FACTS' : 'GENERIC_V200_FACTS',
      outputContract: 'V201_REFERENCE_TEMPLATE_PERSISTENT_SHOPEE_TRACKING_10_SHEETS'
    }
  };
}
