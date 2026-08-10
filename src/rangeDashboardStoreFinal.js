import { getDb } from './db.js';
import { loadRangeDashboard as loadRangeDashboardV31 } from './rangeDashboardStoreV31.js';

const CCSL_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688']);
const SHOPEE_TYPES = Object.freeze(['SHOPEECN', 'SHOPEEVN']);

/**
 * Final range-normalization layer.
 *
 * V31 remains the source/snapshot selection engine. This wrapper only applies
 * business rules that must stay identical to the realtime analyzer:
 * - eventCode 26 PICKUP_SUCCESS is normal open flow, never ordinary abnormal;
 * - store Pending/OC never double-count as store retention;
 * - store transfer 2+ is separately visible and remains abnormal;
 * - unknown structured shop codes remain visible for manual review.
 */
export function loadRangeDashboard(fromDate, toDate) {
  const range = loadRangeDashboardV31(fromDate, toDate);
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
    queryMode: 'SQL_SOURCE_VALID_PLUS_ANALYSIS_COMPLETED_FINAL_V1',
    finalRuleVersion: '2026-08-10-final-trajectory-state-machine-v1'
  };
}

function applyCcslState(state, adjustment) {
  if (!state?.dashboard) return;
  const ordinaryBefore = Number(state.dashboard.abnormalCount || 0);
  const ordinaryAfter = Math.max(0, ordinaryBefore - adjustment.normalOperationalOpen);
  Object.assign(state.dashboard, {
    normalOperationalOpen: adjustment.normalOperationalOpen,
    shopRetention2: adjustment.shopRetention2,
    shopTransit2: adjustment.shopTransit2,
    unknownShopCode: adjustment.unknownShopCode,
    shopPending: adjustment.shopPending,
    shopOc: adjustment.shopOc,
    abnormalCount: ordinaryAfter
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
    if (state.detailTabs?.[key]) state.detailTabs[key].total = ordinaryAfter;
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

  // buildShopeeState intentionally shares the same ALL metrics/region objects
  // between dashboard.metrics/dashboard.regions and recipientGroups.ALL. Apply
  // the final adjustment to each object identity only once to avoid double
  // subtraction of normal open-flow parcels.
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
  metrics.shopRetention1 = adjustment.shopRetention1;
  metrics.shopRetention2 = adjustment.shopRetention2;
  metrics.shopRetention3 = adjustment.shopRetention3;
  metrics.shopTransit2 = adjustment.shopTransit2;
  metrics.unknownShopCode = adjustment.unknownShopCode;
  metrics.shopPending = adjustment.shopPending;
  metrics.shopOc = adjustment.shopOc;
  metrics.unresolved = Math.max(0, Number(metrics.unresolved || 0) - adjustment.normalOperationalOpen);
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
    ${latestSnapshotCte()}
    , valid AS (
      SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode
      FROM latest l
      JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688')
    )
    SELECT v.businessType,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='PICKUP_SUCCESS'
                OR COALESCE(f.primaryCategory,f.category,'')='正常流转' THEN 1 ELSE 0 END) AS normalOperationalOpen,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=2
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,f.category,'') NOT IN ('门店Pending','门店OC') THEN 1 ELSE 0 END) AS shopRetention2,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_TRANSFER_IN_PROGRESS'
                AND COALESCE(CAST(json_extract(f.rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS shopTransit2,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='UNKNOWN_SHOP_CODE'
                OR COALESCE(f.primaryCategory,f.category,'')='未知门店编码' THEN 1 ELSE 0 END) AS unknownShopCode,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='SHOP_PENDING'
                OR COALESCE(f.primaryCategory,f.category,'')='门店Pending' THEN 1 ELSE 0 END) AS shopPending,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='SHOP_OC'
                OR COALESCE(f.primaryCategory,f.category,'')='门店OC' THEN 1 ELSE 0 END) AS shopOc,
      0 AS shopRetention1,0 AS shopRetention3
    FROM valid v
    LEFT JOIN final_rows f ON f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
    GROUP BY v.businessType
  `).all(fromDate, toDate).map(normalizeAdjustment);
  return new Map(rows.map(row => [row.businessType, row]));
}

function queryShopeeAdjustments(fromDate, toDate) {
  return getDb().prepare(`
    ${latestSnapshotCte()}
    , valid AS (
      SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode,
        CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
             WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
             ELSE 'UNKNOWN' END AS regionCode
      FROM latest l
      JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('SHOPEECN','SHOPEEVN')
    )
    SELECT v.businessType,v.regionCode,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='PICKUP_SUCCESS'
                OR COALESCE(f.primaryCategory,'')='正常流转' THEN 1 ELSE 0 END) AS normalOperationalOpen,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=1
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,'') NOT IN ('门店Pending','门店OC') THEN 1 ELSE 0 END) AS shopRetention1,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=2
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,'') NOT IN ('门店Pending','门店OC') THEN 1 ELSE 0 END) AS shopRetention2,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=3
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,'') NOT IN ('门店Pending','门店OC') THEN 1 ELSE 0 END) AS shopRetention3,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_TRANSFER_IN_PROGRESS'
                AND COALESCE(CAST(json_extract(f.rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS shopTransit2,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='UNKNOWN_SHOP_CODE'
                OR COALESCE(f.primaryCategory,'')='未知门店编码' THEN 1 ELSE 0 END) AS unknownShopCode,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='SHOP_PENDING'
                OR COALESCE(f.primaryCategory,'')='门店Pending' THEN 1 ELSE 0 END) AS shopPending,
      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='SHOP_OC'
                OR COALESCE(f.primaryCategory,'')='门店OC' THEN 1 ELSE 0 END) AS shopOc
    FROM valid v
    LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
    GROUP BY v.businessType,v.regionCode
  `).all(fromDate, toDate).map(normalizeAdjustment);
}

function latestSnapshotCte() {
  return `WITH ranked_snapshots AS (
    SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
      ROW_NUMBER() OVER (PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) AS rn
    FROM unified_import_batches b
    JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
    WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
  ), latest AS (SELECT reportDate,snapshotId FROM ranked_snapshots WHERE rn=1)`;
}

function normalizeAdjustment(row = {}) {
  return {
    businessType: String(row.businessType || ''),
    regionCode: String(row.regionCode || ''),
    normalOperationalOpen: Number(row.normalOperationalOpen || 0),
    shopRetention1: Number(row.shopRetention1 || 0),
    shopRetention2: Number(row.shopRetention2 || 0),
    shopRetention3: Number(row.shopRetention3 || 0),
    shopTransit2: Number(row.shopTransit2 || 0),
    unknownShopCode: Number(row.unknownShopCode || 0),
    shopPending: Number(row.shopPending || 0),
    shopOc: Number(row.shopOc || 0)
  };
}

function emptyAdjustment() {
  return normalizeAdjustment({});
}

function sumAdjustments(rows = []) {
  const total = emptyAdjustment();
  for (const row of rows || []) {
    for (const key of ['normalOperationalOpen','shopRetention1','shopRetention2','shopRetention3','shopTransit2','unknownShopCode','shopPending','shopOc']) {
      total[key] += Number(row?.[key] || 0);
    }
  }
  return total;
}
