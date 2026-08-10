import { getDb } from './db.js';
import { loadRangeDashboard as loadRangeDashboardV33 } from './rangeDashboardStoreV33.js';

const CCSL_TYPES = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);

/**
 * V34 routing-location correction.
 *
 * Business rules:
 * 1) CEL:CCSLCN / CEL:CCSLZT are normal diversion destinations. They must be
 *    visible as dedicated dashboard counters and excluded from ordinary open
 *    abnormal counts. Historical CECN / CEZT aliases are normalized here too.
 * 2) Every recognized CP/FS/PV/PNH shop flow is a Phnom Penh shop operational
 *    location. It must be shown in one dedicated "金边门店" counter and must not
 *    be labelled as "外省门店" merely because the recipient province is PV.
 */
export function loadRangeDashboard(fromDate, toDate) {
  const range = loadRangeDashboardV33(fromDate, toDate);
  const facts = queryRoutingFacts(range.fromDate, range.toDate);

  for (const [type, state] of Object.entries(range.states || {})) {
    if (CCSL_TYPES.has(type)) patchCcslState(state, summarize(facts.filter(row => row.businessType === type)), type);
    if (SHOPEE_TYPES.has(type)) patchShopeeState(state, facts.filter(row => row.businessType === type), type);
  }
  patchCcslState(range.aggregates?.CCSL, summarize(facts.filter(row => CCSL_TYPES.has(row.businessType))), 'CCSL');
  patchShopeeState(range.aggregates?.SHOPEE, facts.filter(row => SHOPEE_TYPES.has(row.businessType)), 'SHOPEE');

  return {
    ...range,
    queryMode: `${range.queryMode || 'SQL'}+ROUTING_LOCATION_V34`,
    routingRuleVersion: '2026-08-10-ccslcn-ccslzt-phnom-penh-shop-v1'
  };
}

function queryRoutingFacts(fromDate, toDate) {
  const db = getDb();
  return db.prepare(`
    WITH latest AS (
      SELECT b.reportDate,b.snapshotId
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s
        ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
      WHERE b.status='VALID'
        AND b.reportDate BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1
          FROM unified_import_batches newer
          INNER JOIN unified_snapshots ns
            ON ns.snapshotId=newer.snapshotId AND ns.status='COMPLETED'
          WHERE newer.status='VALID'
            AND newer.reportDate=b.reportDate
            AND newer.createdAt>b.createdAt
        )
    ), valid AS (
      SELECT DISTINCT
        u.reportDate,
        u.businessType,
        u.shipmentCode,
        CASE
          WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
          WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
          ELSE 'UNKNOWN'
        END AS regionCode
      FROM latest l
      INNER JOIN unified_import_rows u
        ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
    ), prepared AS (
      SELECT
        v.reportDate,
        v.businessType,
        v.regionCode,
        v.shipmentCode,
        COALESCE(f.primaryCategory,'') AS primaryCategory,
        COALESCE(f.shopState, json_extract(f.rawJson,'$.shopState'), '') AS shopState,
        UPPER(
          COALESCE(f.primaryCategory,'') || ' ' ||
          COALESCE(json_extract(f.rawJson,'$.specialState'),'') || ' ' ||
          COALESCE(json_extract(f.rawJson,'$.latestEffectiveTargetNodeCode'),'') || ' ' ||
          COALESCE(json_extract(f.rawJson,'$.latestEffectiveTargetNode'),'') || ' ' ||
          COALESCE(json_extract(f.rawJson,'$.latestNodeCode'),'') || ' ' ||
          COALESCE(json_extract(f.rawJson,'$.latestTrackingDescription'),'') || ' ' ||
          COALESCE(json_extract(f.rawJson,'$.lastEventDesc'),'') || ' ' ||
          COALESCE(json_extract(f.rawJson,'$.最后节点'),'')
        ) AS evidence
      FROM valid v
      LEFT JOIN business_final_rows f
        ON f.shipmentCode=v.shipmentCode
       AND f.reportDate=v.reportDate
       AND (
         (v.businessType IN ('SHOPEECN','SHOPEEVN') AND f.businessType='SHOPEE')
         OR f.businessType=v.businessType
       )
    )
    SELECT
      reportDate,
      businessType,
      regionCode,
      COUNT(*) AS total,
      SUM(CASE WHEN evidence LIKE '%CCSLCN%' OR evidence LIKE '%CECN_RETENTION%' OR evidence LIKE '%CECN滞留%' THEN 1 ELSE 0 END) AS ccslCnDiversion,
      SUM(CASE WHEN evidence LIKE '%CCSLZT%' OR evidence LIKE '%CEZT_RETENTION%' OR evidence LIKE '%CEZT滞留%' THEN 1 ELSE 0 END) AS ccslZtDiversion,
      SUM(CASE WHEN (evidence LIKE '%CCSLCN%' OR evidence LIKE '%CCSLCN_DIVERSION%')
                    AND UPPER(primaryCategory) NOT IN ('CECN_RETENTION','CECN滞留包裹')
               THEN 1 ELSE 0 END) AS ccslCnUnaccounted,
      SUM(CASE WHEN (evidence LIKE '%CCSLZT%' OR evidence LIKE '%CCSLZT_DIVERSION%')
                    AND UPPER(primaryCategory) NOT IN ('CEZT_RETENTION','CEZT滞留包裹')
               THEN 1 ELSE 0 END) AS ccslZtUnaccounted,
      SUM(CASE WHEN shopState IN ('SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT') THEN 1 ELSE 0 END) AS phnomPenhShop,
      SUM(CASE WHEN shopState='SHOP_TRANSFER_IN_PROGRESS' THEN 1 ELSE 0 END) AS phnomPenhShopTransit,
      SUM(CASE WHEN shopState='SHOP_ARRIVED_CURRENT' THEN 1 ELSE 0 END) AS phnomPenhShopArrived,
      SUM(CASE WHEN regionCode='PV' AND shopState='SHOP_TRANSFER_IN_PROGRESS' THEN 1 ELSE 0 END) AS pvShopTransit,
      SUM(CASE WHEN regionCode='PV' AND shopState='SHOP_ARRIVED_CURRENT' THEN 1 ELSE 0 END) AS pvShopArrived
    FROM prepared
    GROUP BY reportDate,businessType,regionCode
    ORDER BY reportDate,businessType,regionCode
  `).all(fromDate, toDate).map(normalizeRow);
}

function patchCcslState(state, routing, label) {
  if (!state?.dashboard) return;
  state.dashboard.routing = { label, ...routing };
  state.dashboard.categories = {
    ...(state.dashboard.categories || {}),
    ccslCnDiversion: routing.ccslCnDiversion,
    ccslZtDiversion: routing.ccslZtDiversion,
    phnomPenhShop: routing.phnomPenhShop
  };

  const subtract = routing.ccslCnUnaccounted + routing.ccslZtUnaccounted;
  if (subtract > 0) {
    state.dashboard.abnormalCount = Math.max(0, Number(state.dashboard.abnormalCount || 0) - subtract);
    for (const key of ['coreAbnormal', 'abnormal']) {
      if (state.detailTabs?.[key]) state.detailTabs[key].total = Math.max(0, Number(state.detailTabs[key].total || 0) - subtract);
    }
  }

  state.detailTabs ||= {};
  state.detailTabs.ccslCnDiversion = { label: 'CCSLCN分流', rows: [], total: routing.ccslCnDiversion };
  state.detailTabs.ccslZtDiversion = { label: 'CCSLZT分流', rows: [], total: routing.ccslZtDiversion };
  state.detailTabs.phnomPenhShop = { label: '金边门店', rows: [], total: routing.phnomPenhShop };

  const rows = state.detailTabs?.dashboard?.rows;
  if (Array.isArray(rows)) {
    renameOrUpsert(rows, ['CECN滞留包裹', 'CCSLCN分流'], 'CCSLCN分流', routing.ccslCnDiversion, 'ccslCnDiversion');
    renameOrUpsert(rows, ['CEZT滞留包裹', 'CCSLZT分流'], 'CCSLZT分流', routing.ccslZtDiversion, 'ccslZtDiversion');
    renameOrUpsert(rows, ['金边门店'], '金边门店', routing.phnomPenhShop, 'phnomPenhShop');
  }
}

function patchShopeeState(state, rows, label) {
  if (!state?.dashboard) return;
  const dashboard = state.dashboard;
  const all = summarize(rows);
  dashboard.routing = { label, ...all };

  const patched = new Set();
  const patchUnique = (metrics, summary) => {
    if (!metrics || patched.has(metrics)) return;
    patched.add(metrics);
    patchShopeeMetrics(metrics, summary);
  };

  patchUnique(dashboard.metrics, all);
  const groups = dashboard.recipientGroups || {};
  patchUnique(groups.ALL?.metrics, all);
  patchUnique(groups.CN?.metrics, summarize(rows.filter(row => row.businessType === 'SHOPEECN')));
  patchUnique(groups.VN?.metrics, summarize(rows.filter(row => row.businessType === 'SHOPEEVN')));

  for (const regionCode of ['PP','PV','UNKNOWN']) {
    patchUnique(dashboard.regions?.[regionCode], summarize(rows.filter(row => row.regionCode === regionCode)));
    patchUnique(groups.ALL?.regions?.[regionCode], summarize(rows.filter(row => row.regionCode === regionCode)));
    patchUnique(groups.CN?.regions?.[regionCode], summarize(rows.filter(row => row.businessType === 'SHOPEECN' && row.regionCode === regionCode)));
    patchUnique(groups.VN?.regions?.[regionCode], summarize(rows.filter(row => row.businessType === 'SHOPEEVN' && row.regionCode === regionCode)));
  }

  state.detailTabs ||= {};
  state.detailTabs.ccslCnDiversion = { label: 'CCSLCN分流', rows: [], total: all.ccslCnDiversion };
  state.detailTabs.ccslZtDiversion = { label: 'CCSLZT分流', rows: [], total: all.ccslZtDiversion };
  state.detailTabs.phnomPenhShop = { label: '金边门店', rows: [], total: all.phnomPenhShop };
  if (dashboard.detailTabs) {
    dashboard.detailTabs.ccslCnDiversion = state.detailTabs.ccslCnDiversion;
    dashboard.detailTabs.ccslZtDiversion = state.detailTabs.ccslZtDiversion;
    dashboard.detailTabs.phnomPenhShop = state.detailTabs.phnomPenhShop;
  }
}

function patchShopeeMetrics(metrics, routing) {
  if (!metrics) return;
  metrics.ccslCnDiversion = routing.ccslCnDiversion;
  metrics.ccslZtDiversion = routing.ccslZtDiversion;
  metrics.phnomPenhShop = routing.phnomPenhShop;
  metrics.phnomPenhShopTransit = routing.phnomPenhShopTransit;
  metrics.phnomPenhShopArrived = routing.phnomPenhShopArrived;

  // Shop routing is a Phnom Penh operational location. Do not expose these rows
  // as an "external province store" category. Recipient province remains intact
  // for PP/PV recipient analysis; only the operational-location label changes.
  if ('pvDelivery' in metrics) metrics.pvDelivery = Math.max(0, Number(metrics.pvDelivery || 0) - routing.pvShopTransit);
  if ('pvStoreRetention' in metrics) metrics.pvStoreRetention = 0;
  if ('pvStoreInboundNoScan' in metrics) metrics.pvStoreInboundNoScan = 0;

  const subtract = routing.ccslCnUnaccounted + routing.ccslZtUnaccounted;
  if ('unresolved' in metrics && subtract > 0) metrics.unresolved = Math.max(0, Number(metrics.unresolved || 0) - subtract);
}

function renameOrUpsert(rows, aliases, label, value, tab) {
  let found = rows.find(row => aliases.includes(row?.项目) || aliases.includes(row?.metricKey));
  if (!found) {
    found = { 日期: rows[0]?.日期 || '', 项目: label, metricKey: label, 数值: Number(value || 0), 数值原值: Number(value || 0), 状态: '正常', 明细Tab: tab };
    rows.push(found);
  }
  found.项目 = label;
  found.metricKey = label;
  found.数值 = Number(value || 0);
  found.数值原值 = Number(value || 0);
  found.明细Tab = tab;
  found.状态 = '正常分流';
}

function summarize(rows = []) {
  const result = {
    total: 0,
    ccslCnDiversion: 0,
    ccslZtDiversion: 0,
    ccslCnUnaccounted: 0,
    ccslZtUnaccounted: 0,
    phnomPenhShop: 0,
    phnomPenhShopTransit: 0,
    phnomPenhShopArrived: 0,
    pvShopTransit: 0,
    pvShopArrived: 0
  };
  for (const row of rows) {
    for (const key of Object.keys(result)) result[key] += Number(row?.[key] || 0);
  }
  return result;
}

function normalizeRow(row) {
  const result = { ...row };
  for (const [key, value] of Object.entries(result)) {
    if (['reportDate','businessType','regionCode'].includes(key)) continue;
    result[key] = Number(value || 0);
  }
  return result;
}
