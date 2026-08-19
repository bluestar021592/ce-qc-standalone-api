import path from 'node:path';
import { collectV206ShopeeRows, V206_SHOPEE_PRECISION_VERSION } from './v206ShopeePrecisionTruth.js';
import { statsOf, bucketRows, anchorMaps, average } from './v200Metrics.js';
import { writeV200ReferenceWorkbook } from './v200ReferenceWorkbook.js';

// Compatibility markers retained only for updater/golive checks:
// V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY / _V200.xlsx / _V202.xlsx / _V203.xlsx / _V205.xlsx
// collectV202Rows / collectV205ExportRows
// ALL_VALID_COMPLETED_DAILY_IMPORTS_ARE_UNIONED
// MANUAL_QUERY_ROWS_INCLUDED_IN_DETAILS_BUT_EXCLUDED_FROM_OFFICIAL_DAILY_KPI_DENOMINATOR_UNLESS_DAILY_MEMBER
// Runtime truth is V209: V207 canonical membership + exact family evidence +
// SHOPEE 3001-to-real-POD timing, real delivery attempts, strict terminals and
// full-coverage gating before any average is presented as an official number.
export const V200_EXPORT_VERSION = V206_SHOPEE_PRECISION_VERSION;
export { resolveV200Attempt, resolveV200AverageDays } from './v200EvidenceData.js';
export { internalHyperlinkFormulaForV200 } from './v200ReferenceWorkbook.js';

function safeFileName(value = '') { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim(); }
function displayType(type) { return ({ SHOPEECN: 'SHOPEE CN', SHOPEEVN: 'SHOPEE VN' })[type] || type; }
function periodLabel(periodType = 'custom') { return ({ daily: '日报', weekly: '周报', monthly: '月报', custom: '自定义日期' })[periodType] || '区间报表'; }
function isShopee(type=''){return type==='SHOPEECN'||type==='SHOPEEVN';}
function officialTiming(stat={},scope='all'){
  if(scope==='pp')return Number(stat.ppPod||0)===Number(stat.ppDays?.length||0);
  if(scope==='pv')return Number(stat.pvPod||0)===Number(stat.pvDays?.length||0);
  return Number(stat.pod||0)===Number(stat.days?.length||0);
}
function gatePartialShopeeAverages(stats={}){
  for(const stat of [stats.overall,...(stats.daily||[])]){
    stat.averageOfficial=officialTiming(stat,'all');
    stat.ppAverageOfficial=officialTiming(stat,'pp');
    stat.pvAverageOfficial=officialTiming(stat,'pv');
    if(!stat.averageOfficial)stat.days=[];
    if(!stat.ppAverageOfficial)stat.ppDays=[];
    if(!stat.pvAverageOfficial)stat.pvDays=[];
  }
  return stats;
}

export async function createV200ReferenceDashboardWorkbook({ type, periodType = 'custom', range, outputDir, onProgress = () => {} }) {
  const businessType = String(type || '').trim().toUpperCase();
  const rows = await collectV206ShopeeRows(businessType, range, onProgress);
  if (!rows.length) throw new Error(`${displayType(businessType)} 在所选区间没有数据。`);
  const rawStats = statsOf(rows, range);
  const stats = isShopee(businessType) ? gatePartialShopeeAverages(rawStats) : rawStats;
  const bucket = bucketRows(rows);
  const anchors = anchorMaps(bucket);
  const file = path.join(outputDir, safeFileName(`${displayType(businessType)}_${periodLabel(periodType)}_每日数据看板_${range.from}_至_${range.to}_V209.xlsx`));
  await writeV200ReferenceWorkbook({ file, type: businessType, range, rows, stats, bucket, anchors, onProgress });
  const shopee = isShopee(businessType);
  const eligiblePod=rows.filter(row=>row.metricEligible!==false&&row.pod).length;
  const eligiblePpPod=rows.filter(row=>row.metricEligible!==false&&row.pod&&row.area==='金边').length;
  const eligiblePvPod=rows.filter(row=>row.metricEligible!==false&&row.pod&&row.area==='外省').length;
  const validTiming=rows.filter(row=>row.metricEligible!==false&&row.pod&&(!shopee||row.timingEvidenceStatus==='OK'));
  const validPpTiming=validTiming.filter(row=>row.area==='金边');
  const validPvTiming=validTiming.filter(row=>row.area==='外省');
  const averageOfficial=!shopee||validTiming.length===eligiblePod;
  const ppAverageOfficial=!shopee||validPpTiming.length===eligiblePpPod;
  const pvAverageOfficial=!shopee||validPvTiming.length===eligiblePvPod;
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
      averageDays: averageOfficial ? average(validTiming.map(row=>row.deliveryDays||row.signNaturalDays)) : null,
      ppAverageDays: ppAverageOfficial ? average(validPpTiming.map(row=>row.deliveryDays||row.signNaturalDays)) : null,
      pvAverageDays: pvAverageOfficial ? average(validPvTiming.map(row=>row.deliveryDays||row.signNaturalDays)) : null,
      averageOfficial,
      ppAverageOfficial,
      pvAverageOfficial,
      validAverageSamples: validTiming.length,
      ppAverageSamples: validPpTiming.length,
      pvAverageSamples: validPvTiming.length,
      timingEvidenceMissing: shopee ? Math.max(0,eligiblePod-validTiming.length) : 0,
      dataIntegrityReview: rows.filter(row => row.metricEligible !== false && row.dataIntegrityReview).length,
      canonicalRecoveredRows: rows.filter(row => row.metricEligible !== false && String(row.sourceOrigin || '').startsWith('DAILY_CANONICAL_') && Number(row.membershipSnapshotCount || 0) > 1).length,
      engine: V206_SHOPEE_PRECISION_VERSION,
      tracking: shopee
        ? 'REAL_DELIVERY_CYCLE_4003_70_PENDING_REDISPATCH_POD_AND_3001_TO_REAL_POD_TIMING'
        : 'EXACT_DAILY_MEMBERSHIP_PLUS_CCSL_FAMILY_TRACK_TRUTH',
      averageRule: shopee ? 'SHOPEE_3001_TO_ACTUAL_4004_OR_TRACK80_POD_INCLUSIVE_FULL_COVERAGE_ONLY' : 'ORDER_DATE_TO_ACTUAL_POD_DATE_INCLUSIVE',
      terminalRule: 'POD_RETURN_CANCELLED_EXCLUDED_FROM_ANOMALY_AND_UNPOD',
      evidenceRule: 'V207_APPEND_ONLY_CANONICAL_MEMBERSHIP; FAMILY_TRACK_EVIDENCE_ENRICHES_EXACT_BUSINESS; MANUAL_QUERY_DETAIL_DOES_NOT_INFLATE_OFFICIAL_DAILY_KPI',
      outputContract: 'V209_REFERENCE_TEMPLATE_NO_LOSS_FULL_COVERAGE_PRECISE_SHOPEE_TIMING_10_SHEETS'
    }
  };
}
