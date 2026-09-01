import { getDb } from './db.js';
import { loadRangeDashboard as loadRangeDashboardV320 } from './rangeDashboardStoreV320.js';

const CCSL_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688']);
const SHOPEE_TYPES = Object.freeze(['SHOPEECN', 'SHOPEEVN']);
const FINAL_RULE_VERSION = '2026-09-01-v401-v320-final-normal-flow-v1';

/**
 * Final range-normalization layer.
 *
 * V320 remains the authoritative source/snapshot/cache selection engine. This
 * wrapper only overlays business rules that must stay identical to realtime:
 * - eventCode 26 PICKUP_SUCCESS / 正常流转 is normal open flow;
 * - store Pending/OC is a normal store context and never becomes retention;
 * - store transfer >=2 natural days and true store retention >=2 remain abnormal;
 * - Pending3+, non-continuous Pending, OC2+, cycle2+, inbound-no-scan and work
 *   order are the dedicated CCSL abnormal thresholds;
 * - CECN/CEZT/580/self-pickup and return-in-progress are excluded from ordinary
 *   abnormal/open counts;
 * - all adjustment membership is selected independently per date + business so
 *   a later same-day sibling import cannot erase another business.
 */
export function loadRangeDashboard(fromDate, toDate) {
  const range = loadRangeDashboardV320(fromDate, toDate);
  const ccsl = queryCcslAdjustments(range.fromDate, range.toDate);
  const shopee = queryShopeeAdjustments(range.fromDate, range.toDate);

  for (const type of CCSL_TYPES) applyCcslState(range.states?.[type], ccsl.get(type) || emptyAdjustment());
  applyCcslState(range.aggregates?.CCSL, sumAdjustments([...ccsl.values()]));

  for (const type of SHOPEE_TYPES) {
    const rows = shopee.filter(row => row.businessType === type);
    applyShopeeState(range.states?.[type], rows, type);
  }
  applyShopeeState(range.aggregates?.SHOPEE, shopee, 'SHOPEE');

  return {
    ...range,
    finalRuleVersion: FINAL_RULE_VERSION,
    finalNormalizationApplied: true
  };
}

function applyCcslState(state, adjustment) {
  if (!state?.dashboard) return;
  Object.assign(state.dashboard, {
    normalOperationalOpen: adjustment.normalOperationalOpen,
    normalShopOpen: adjustment.normalShopOpen,
    shopRetention2: adjustment.shopRetention2,
    shopTransit2: adjustment.shopTransit2,
    unknownShopCode: adjustment.unknownShopCode,
    shopPending: adjustment.shopPending,
    shopOc: adjustment.shopOc,
    returned: adjustment.returned,
    returnInProgress: adjustment.returnInProgress,
    specialClosed: adjustment.specialClosed,
    abnormalCount: adjustment.dedicatedAbnormal
  });
  state.dashboard.categories = {
    ...(state.dashboard.categories || {}),
    shopRetention2: adjustment.shopRetention2,
    shopTransit2: adjustment.shopTransit2,
    unknownShopCode: adjustment.unknownShopCode,
    shopPending: adjustment.shopPending,
    shopOc: adjustment.shopOc
  };

  for (const key of ['coreAbnormal', 'abnormal']) {
    if (state.detailTabs?.[key]) state.detailTabs[key].total = adjustment.dedicatedAbnormal;
  }
  normalizeCcslDashboardRows(state.detailTabs?.dashboard?.rows, adjustment);
}

function normalizeCcslDashboardRows(rows, adjustment) {
  if (!Array.isArray(rows)) return;
  upsertDashboardRow(rows, '门店滞留2天+', adjustment.shopRetention2, 'shopStuck');
  upsertDashboardRow(rows, '门店途中2天+', adjustment.shopTransit2, 'shopTransit2');
  upsertDashboardRow(rows, '未知门店编码', adjustment.unknownShopCode, 'unknownShopCode');
}

function applyShopeeState(state, rows, label) {
  if (!state?.dashboard) return;
  const all = sumAdjustments(rows);
  const groups = state.dashboard.recipientGroups || {};
  const allMetrics = groups.ALL?.metrics || state.dashboard.metrics;

  applyShopeeMetrics(allMetrics, all);
  if (state.dashboard.metrics && state.dashboard.metrics !== allMetrics) applyShopeeMetrics(state.dashboard.metrics, all);

  if (groups.CN?.metrics) applyShopeeMetrics(groups.CN.metrics, sumAdjustments(rows.filter(row => row.businessType === 'SHOPEECN')));
  if (groups.VN?.metrics) applyShopeeMetrics(groups.VN.metrics, sumAdjustments(rows.filter(row => row.businessType === 'SHOPEEVN')));

  for (const regionCode of ['PP', 'PV', 'UNKNOWN']) {
    const regionAdj = sumAdjustments(rows.filter(row => row.regionCode === regionCode));
    const allRegion = groups.ALL?.regions?.[regionCode] || state.dashboard.regions?.[regionCode];
    if (allRegion) applyShopeeMetrics(allRegion, regionAdj);
    if (state.dashboard.regions?.[regionCode] && state.dashboard.regions[regionCode] !== allRegion) {
      applyShopeeMetrics(state.dashboard.regions[regionCode], regionAdj);
    }
    if (groups.CN?.regions?.[regionCode]) applyShopeeMetrics(groups.CN.regions[regionCode], sumAdjustments(rows.filter(row => row.businessType === 'SHOPEECN' && row.regionCode === regionCode)));
    if (groups.VN?.regions?.[regionCode]) applyShopeeMetrics(groups.VN.regions[regionCode], sumAdjustments(rows.filter(row => row.businessType === 'SHOPEEVN' && row.regionCode === regionCode)));
  }

  if (state.detailTabs?.abnormal) state.detailTabs.abnormal.total = Number(allMetrics?.unresolved || 0);
  if (state.dashboard.detailTabs?.abnormal) state.dashboard.detailTabs.abnormal.total = Number(allMetrics?.unresolved || 0);
  state.dashboard.finalAdjustment = { label, ...all };
}

function applyShopeeMetrics(metrics, adjustment) {
  if (!metrics) return;
  metrics.normalOperationalOpen = adjustment.normalOperationalOpen;
  metrics.normalShopOpen = adjustment.normalShopOpen;
  metrics.shopRetention1 = adjustment.shopRetention1;
  metrics.shopRetention2 = adjustment.shopRetention2;
  metrics.shopRetention3 = adjustment.shopRetention3;
  metrics.shopTransit2 = adjustment.shopTransit2;
  metrics.unknownShopCode = adjustment.unknownShopCode;
  metrics.shopPending = adjustment.shopPending;
  metrics.shopOc = adjustment.shopOc;
  metrics.returnInProgress = adjustment.returnInProgress;
  metrics.specialClosed = adjustment.specialClosed;
  // V320 unresolved already excludes POD/returned/cancelled. Remove only the
  // additional mutually exclusive normal/special open states exactly once.
  metrics.unresolved = Math.max(0, Number(metrics.unresolved || 0) - adjustment.normalExcludedOpen);
}

function upsertDashboardRow(rows, label, value, tab) {
  const found = rows.find(row => row?.项目 === label || row?.metricKey === label);
  if (found) {
    found.数值 = Number(value || 0);
    found.数值原值 = Number(value || 0);
    found.状态 = Number(value || 0) > 0 ? '需跟进' : '正常';
    found.明细Tab = tab;
    return;
  }
  const date = rows[0]?.日期 || '';
  rows.push({ 日期: date, 项目: label, metricKey: label, 数值: Number(value || 0), 数值原值: Number(value || 0), 状态: Number(value || 0) > 0 ? '需跟进' : '正常', 明细Tab: tab });
}

function queryCcslAdjustments(fromDate, toDate) {
  const rows = getDb().prepare(`
    ${latestBusinessSnapshotCte()}
    , valid AS (
      SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode
      FROM latest l
      JOIN unified_import_rows u
        ON u.snapshotId=l.snapshotId
       AND u.reportDate=l.reportDate
       AND UPPER(TRIM(u.businessType))=l.businessType
      WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688')
    ), facts AS (
      SELECT v.businessType,v.reportDate,v.shipmentCode,
        COALESCE(f.isPod,0) AS isPod,
        COALESCE(f.pendingDays,0) AS pendingDays,
        COALESCE(f.ocDays,0) AS ocDays,
        COALESCE(f.cycleCountDays,0) AS cycleCountDays,
        COALESCE(f.deliveringDays,0) AS deliveringDays,
        COALESCE(f.shopState,'') AS shopState,
        COALESCE(f.shopRetentionNaturalDays,0) AS shopRetentionNaturalDays,
        COALESCE(f.primaryCategory,f.category,'') AS category,
        COALESCE(f.rawJson,'{}') AS rawJson
      FROM valid v
      LEFT JOIN final_rows f ON f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
    )
    SELECT businessType,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='PICKUP_SUCCESS'
                OR category='正常流转' THEN 1 ELSE 0 END) AS normalOperationalOpen,
      SUM(CASE WHEN shopState='SHOP_ARRIVED_CURRENT' AND shopRetentionNaturalDays>=2
                AND UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND category NOT IN ('门店Pending','门店OC') THEN 1 ELSE 0 END) AS shopRetention2,
      SUM(CASE WHEN shopState='SHOP_TRANSFER_IN_PROGRESS'
                AND COALESCE(CAST(json_extract(rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS shopTransit2,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='UNKNOWN_SHOP_CODE'
                OR category='未知门店编码' THEN 1 ELSE 0 END) AS unknownShopCode,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='SHOP_PENDING'
                OR category='门店Pending' THEN 1 ELSE 0 END) AS shopPending,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='SHOP_OC'
                OR category='门店OC' THEN 1 ELSE 0 END) AS shopOc,
      SUM(CASE WHEN COALESCE(json_extract(rawJson,'$."退回状态"'),'')='已退回'
                OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED')
                OR category='退回' THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN COALESCE(json_extract(rawJson,'$."退回状态"'),'')='退回处理中'
                OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='RETURN_IN_PROGRESS'
                OR category='退回处理中' THEN 1 ELSE 0 END) AS returnInProgress,
      SUM(CASE WHEN (shopState='SHOP_TRANSFER_IN_PROGRESS'
                  AND COALESCE(CAST(json_extract(rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)<2)
                OR (shopState='SHOP_ARRIVED_CURRENT' AND (
                  shopRetentionNaturalDays<2
                  OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('SHOP_PENDING','SHOP_OC')
                  OR category IN ('门店Pending','门店OC')
                )) THEN 1 ELSE 0 END) AS normalShopOpen,
      SUM(CASE WHEN UPPER(category) IN ('SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION')
                OR category IN ('仓库自提','自提','CCSLCN分流','CCSLZT分流','CECN滞留包裹','CEZT滞留包裹','580滞留包裹')
               THEN 1 ELSE 0 END) AS specialClosed,
      SUM(CASE WHEN isPod=0
                AND NOT (
                  COALESCE(json_extract(rawJson,'$."退回状态"'),'') IN ('已退回','退回处理中')
                  OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED','RETURN_IN_PROGRESS','PICKUP_SUCCESS','SHOP_PENDING','SHOP_OC')
                  OR category IN ('退回','退回处理中','正常流转','门店Pending','门店OC','仓库自提','自提','CCSLCN分流','CCSLZT分流','CECN滞留包裹','CEZT滞留包裹','580滞留包裹')
                  OR UPPER(category) IN ('SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION')
                )
                AND (
                  pendingDays>=3
                  OR COALESCE(json_extract(rawJson,'$."Pending不连续"'),'')='是'
                  OR COALESCE(json_extract(rawJson,'$.pendingFactDateContinuity'),'')='不连续'
                  OR COALESCE(json_extract(rawJson,'$."Pending事实连续性"'),'')='不连续'
                  OR (COALESCE(CAST(json_extract(rawJson,'$.pendingDistinctDayCount') AS INTEGER),0)>=2 AND COALESCE(json_extract(rawJson,'$."Pending连续性"'),'')='不连续')
                  OR ocDays>=2
                  OR cycleCountDays>=2
                  OR category LIKE '%入库无扫描%'
                  OR COALESCE(json_extract(rawJson,'$."入库无扫描节点"'),'')='是'
                  OR category LIKE '%工单%'
                  OR (shopState='SHOP_ARRIVED_CURRENT' AND shopRetentionNaturalDays>=2)
                  OR (shopState='SHOP_TRANSFER_IN_PROGRESS' AND COALESCE(CAST(json_extract(rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)>=2)
                  OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='UNKNOWN_SHOP_CODE'
                  OR category='未知门店编码'
                ) THEN 1 ELSE 0 END) AS dedicatedAbnormal,
      0 AS shopRetention1,0 AS shopRetention3,0 AS normalExcludedOpen
    FROM facts
    GROUP BY businessType
  `).all(fromDate, toDate).map(normalizeAdjustment);
  return new Map(rows.map(row => [row.businessType, row]));
}

function queryShopeeAdjustments(fromDate, toDate) {
  return getDb().prepare(`
    ${latestBusinessSnapshotCte()}
    , valid AS (
      SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode,
        CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
             WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
             ELSE 'UNKNOWN' END AS regionCode
      FROM latest l
      JOIN unified_import_rows u
        ON u.snapshotId=l.snapshotId
       AND u.reportDate=l.reportDate
       AND UPPER(TRIM(u.businessType))=l.businessType
      WHERE u.businessType IN ('SHOPEECN','SHOPEEVN')
    ), facts AS (
      SELECT v.businessType,v.regionCode,v.reportDate,v.shipmentCode,
        COALESCE(f.isPod,0) AS isPod,
        COALESCE(f.shopState,'') AS shopState,
        COALESCE(f.shopRetentionNaturalDays,0) AS shopRetentionNaturalDays,
        COALESCE(f.primaryCategory,'') AS category,
        COALESCE(f.rawJson,'{}') AS rawJson
      FROM valid v
      LEFT JOIN business_final_rows f
        ON f.businessType='SHOPEE' AND f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
    )
    SELECT businessType,regionCode,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='PICKUP_SUCCESS'
                OR category='正常流转' THEN 1 ELSE 0 END) AS normalOperationalOpen,
      SUM(CASE WHEN shopState='SHOP_ARRIVED_CURRENT' AND shopRetentionNaturalDays>=1
                AND UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND category NOT IN ('门店Pending','门店OC') THEN 1 ELSE 0 END) AS shopRetention1,
      SUM(CASE WHEN shopState='SHOP_ARRIVED_CURRENT' AND shopRetentionNaturalDays>=2
                AND UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND category NOT IN ('门店Pending','门店OC') THEN 1 ELSE 0 END) AS shopRetention2,
      SUM(CASE WHEN shopState='SHOP_ARRIVED_CURRENT' AND shopRetentionNaturalDays>=3
                AND UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND category NOT IN ('门店Pending','门店OC') THEN 1 ELSE 0 END) AS shopRetention3,
      SUM(CASE WHEN shopState='SHOP_TRANSFER_IN_PROGRESS'
                AND COALESCE(CAST(json_extract(rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS shopTransit2,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='UNKNOWN_SHOP_CODE'
                OR category='未知门店编码' THEN 1 ELSE 0 END) AS unknownShopCode,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='SHOP_PENDING'
                OR category='门店Pending' THEN 1 ELSE 0 END) AS shopPending,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='SHOP_OC'
                OR category='门店OC' THEN 1 ELSE 0 END) AS shopOc,
      SUM(CASE WHEN COALESCE(json_extract(rawJson,'$."退回状态"'),'')='退回处理中'
                OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='RETURN_IN_PROGRESS'
                OR category='退回处理中' THEN 1 ELSE 0 END) AS returnInProgress,
      SUM(CASE WHEN (shopState='SHOP_TRANSFER_IN_PROGRESS'
                  AND COALESCE(CAST(json_extract(rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)<2)
                OR (shopState='SHOP_ARRIVED_CURRENT' AND (
                  shopRetentionNaturalDays<2
                  OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('SHOP_PENDING','SHOP_OC')
                  OR category IN ('门店Pending','门店OC')
                )) THEN 1 ELSE 0 END) AS normalShopOpen,
      SUM(CASE WHEN UPPER(category) IN ('SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION')
                OR category IN ('仓库自提','自提','CCSLCN分流','CCSLZT分流','CECN滞留包裹','CEZT滞留包裹','580滞留包裹')
               THEN 1 ELSE 0 END) AS specialClosed,
      SUM(CASE WHEN isPod=0 AND (
        UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='PICKUP_SUCCESS'
        OR category='正常流转'
        OR COALESCE(json_extract(rawJson,'$."退回状态"'),'')='退回处理中'
        OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),''))='RETURN_IN_PROGRESS'
        OR category='退回处理中'
        OR UPPER(category) IN ('SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION')
        OR category IN ('仓库自提','自提','CCSLCN分流','CCSLZT分流','CECN滞留包裹','CEZT滞留包裹','580滞留包裹')
        OR (shopState='SHOP_TRANSFER_IN_PROGRESS' AND COALESCE(CAST(json_extract(rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)<2)
        OR (shopState='SHOP_ARRIVED_CURRENT' AND (
          shopRetentionNaturalDays<2
          OR UPPER(COALESCE(json_extract(rawJson,'$.currentState'),'')) IN ('SHOP_PENDING','SHOP_OC')
          OR category IN ('门店Pending','门店OC')
        ))
      ) THEN 1 ELSE 0 END) AS normalExcludedOpen,
      0 AS returned,0 AS dedicatedAbnormal
    FROM facts
    GROUP BY businessType,regionCode
  `).all(fromDate, toDate).map(normalizeAdjustment);
}

function latestBusinessSnapshotCte() {
  return `WITH ranked_business_snapshots AS (
    SELECT
      u.reportDate,
      UPPER(TRIM(u.businessType)) AS businessType,
      u.snapshotId,
      COALESCE(s.status,'') AS snapshotStatus,
      b.createdAt,
      b.batchId,
      ROW_NUMBER() OVER (
        PARTITION BY u.reportDate,UPPER(TRIM(u.businessType))
        ORDER BY b.createdAt DESC,b.batchId DESC
      ) AS rn
    FROM unified_import_rows u
    JOIN unified_import_batches b
      ON b.snapshotId=u.snapshotId AND b.reportDate=u.reportDate
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID'
      AND b.reportDate BETWEEN ? AND ?
      AND TRIM(COALESCE(u.shipmentCode,''))<>''
    GROUP BY u.reportDate,UPPER(TRIM(u.businessType)),u.snapshotId,COALESCE(s.status,''),b.createdAt,b.batchId
  ), latest AS (
    SELECT reportDate,businessType,snapshotId
    FROM ranked_business_snapshots
    WHERE rn=1 AND snapshotStatus='COMPLETED'
  )`;
}

function normalizeAdjustment(row = {}) {
  return {
    businessType: String(row.businessType || ''),
    regionCode: String(row.regionCode || ''),
    normalOperationalOpen: Number(row.normalOperationalOpen || 0),
    normalShopOpen: Number(row.normalShopOpen || 0),
    shopRetention1: Number(row.shopRetention1 || 0),
    shopRetention2: Number(row.shopRetention2 || 0),
    shopRetention3: Number(row.shopRetention3 || 0),
    shopTransit2: Number(row.shopTransit2 || 0),
    unknownShopCode: Number(row.unknownShopCode || 0),
    shopPending: Number(row.shopPending || 0),
    shopOc: Number(row.shopOc || 0),
    returned: Number(row.returned || 0),
    returnInProgress: Number(row.returnInProgress || 0),
    specialClosed: Number(row.specialClosed || 0),
    normalExcludedOpen: Number(row.normalExcludedOpen || 0),
    dedicatedAbnormal: Number(row.dedicatedAbnormal || 0)
  };
}

function emptyAdjustment() {
  return normalizeAdjustment({});
}

function sumAdjustments(rows = []) {
  const total = emptyAdjustment();
  for (const row of rows || []) {
    for (const key of [
      'normalOperationalOpen','normalShopOpen','shopRetention1','shopRetention2','shopRetention3','shopTransit2',
      'unknownShopCode','shopPending','shopOc','returned','returnInProgress','specialClosed','normalExcludedOpen','dedicatedAbnormal'
    ]) {
      total[key] += Number(row?.[key] || 0);
    }
  }
  return total;
}
