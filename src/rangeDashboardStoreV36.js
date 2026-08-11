import { getDb } from './db.js';
import { loadRangeDashboard as loadRangeDashboardV33 } from './rangeDashboardStoreV33.js';
import { classifyFinalRoutingDestination, ROUTING_DESTINATIONS } from './routingDestinationV48.js';

const CCSL_TYPES = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);

/**
 * V36 final-location routing correction.
 *
 * The routing cards are mutually exclusive and use only each parcel's FINAL
 * effective trajectory destination. Historical visits to CCSLCN / CCSLZT /
 * CCSL580 are never concatenated into evidence and therefore can never make one
 * parcel appear in several routing cards.
 *
 * Canonical business display:
 *   CEL:CCSLCN  -> CCSLCN分流
 *   CEL:CCSLZT  -> CCSLZT分流
 *   CEL:CCSL580 -> 580滞留包裹
 *
 * All three are special/normal destinations and remain excluded from ordinary
 * Pending/OC/work-order/inbound-no-scan abnormal buckets.
 */
export function loadRangeDashboard(fromDate, toDate) {
  // Bypass V34/V35 because those versions used broad concatenated text evidence.
  // V33 contains the preceding source/snapshot, Shopee attempt and final rules.
  const range = loadRangeDashboardV33(fromDate, toDate);
  const facts = queryFinalLocationFacts(range.fromDate, range.toDate);

  for (const [type, state] of Object.entries(range.states || {})) {
    if (CCSL_TYPES.has(type)) patchCcslState(state, facts.filter(row => row.businessType === type), type);
    if (SHOPEE_TYPES.has(type)) patchShopeeState(state, facts.filter(row => row.businessType === type), type);
  }

  patchCcslState(range.aggregates?.CCSL, facts.filter(row => CCSL_TYPES.has(row.businessType)), 'CCSL');
  patchShopeeState(range.aggregates?.SHOPEE, facts.filter(row => SHOPEE_TYPES.has(row.businessType)), 'SHOPEE');

  return {
    ...range,
    queryMode: `${range.queryMode || 'SQL'}+FINAL_LOCATION_ROUTING_V36`,
    routingRuleVersion: '2026-08-11-final-location-exclusive-v36'
  };
}

function queryFinalLocationFacts(fromDate, toDate) {
  const rows = getDb().prepare(`
    WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.createdAt,b.batchId,
        ROW_NUMBER() OVER (
          PARTITION BY b.reportDate
          ORDER BY b.createdAt DESC,b.batchId DESC
        ) AS rn
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s
        ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
    ), latest AS (
      SELECT reportDate,snapshotId FROM ranked WHERE rn=1
    ), valid AS (
      SELECT DISTINCT
        u.reportDate,u.businessType,u.shipmentCode,
        CASE
          WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
          WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
          ELSE 'UNKNOWN'
        END AS regionCode
      FROM latest l
      INNER JOIN unified_import_rows u
        ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
      WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN')
    )
    SELECT
      v.reportDate,v.businessType,v.shipmentCode,v.regionCode,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.primaryCategory,'') ELSE COALESCE(cf.primaryCategory,'') END AS primaryCategory,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.shopState,'') ELSE COALESCE(cf.shopState,'') END AS shopState,
      CASE WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN COALESCE(sf.rawJson,'{}') ELSE COALESCE(cf.rawJson,'{}') END AS rawJson
    FROM valid v
    LEFT JOIN final_rows cf
      ON v.businessType IN ('CE','CEAF','TBKH','ALI1688')
     AND cf.shipmentCode=v.shipmentCode AND cf.reportDate=v.reportDate
    LEFT JOIN business_final_rows sf
      ON v.businessType IN ('SHOPEECN','SHOPEEVN')
     AND sf.businessType='SHOPEE'
     AND sf.shipmentCode=v.shipmentCode AND sf.reportDate=v.reportDate
    ORDER BY v.reportDate,v.businessType,v.shipmentCode
  `).all(fromDate, toDate);

  return rows.map(row => {
    let raw = {};
    try { raw = JSON.parse(row.rawJson || '{}'); } catch {}
    const merged = {
      ...raw,
      shipmentCode: row.shipmentCode,
      运单号: row.shipmentCode,
      reportDate: row.reportDate,
      businessType: row.businessType,
      regionCode: row.regionCode,
      primaryCategory: row.primaryCategory || raw.primaryCategory || raw.主分类 || '',
      shopState: row.shopState || raw.shopState || ''
    };
    const route = classifyFinalRoutingDestination(merged);
    return {
      ...merged,
      routingDestination: route.destination,
      finalRoutingNode: route.finalNode,
      routingSourceField: route.sourceField,
      routingFallback: route.usedFallback,
      routingAlreadySpecial: recognizedSpecial(merged, route.destination)
    };
  });
}

function patchCcslState(state, rows, label) {
  if (!state?.dashboard) return;
  const summary = summarize(rows);
  const subtract = summary.routingUnaccounted;

  state.dashboard.routing = { label, ...summary };
  state.dashboard.categories = {
    ...(state.dashboard.categories || {}),
    ccslCnDiversion: summary.ccslCnDiversion,
    ccslZtDiversion: summary.ccslZtDiversion,
    ccsl580Retention: summary.ccsl580Retention,
    // Compatibility only: old readers may still ask for this key. It represents
    // the same mutually-exclusive CEL:CCSL580 rows and must never be a 2nd bucket.
    ccsl580Diversion: summary.ccsl580Retention,
    phnomPenhShop: summary.phnomPenhShop
  };

  if (subtract > 0) {
    state.dashboard.abnormalCount = Math.max(0, Number(state.dashboard.abnormalCount || 0) - subtract);
    for (const key of ['coreAbnormal', 'abnormal']) {
      if (state.detailTabs?.[key]) state.detailTabs[key].total = Math.max(0, Number(state.detailTabs[key].total || 0) - subtract);
    }
  }

  state.detailTabs ||= {};
  state.detailTabs.ccslCnDiversion = tab('CCSLCN分流', rows.filter(row => row.routingDestination === ROUTING_DESTINATIONS.CCSLCN));
  state.detailTabs.ccslZtDiversion = tab('CCSLZT分流', rows.filter(row => row.routingDestination === ROUTING_DESTINATIONS.CCSLZT));
  state.detailTabs.ccsl580Retention = tab('580滞留包裹', rows.filter(row => row.routingDestination === ROUTING_DESTINATIONS.CCSL580));
  state.detailTabs.ccsl580Diversion = state.detailTabs.ccsl580Retention;
  state.detailTabs.phnomPenhShop = tab('金边门店', rows.filter(isPhnomPenhShop));

  state.detailTabs.dashboard ||= { label: `${label}总看板`, rows: [], total: 0 };
  state.detailTabs.dashboard.rows ||= [];
  const dashboardRows = state.detailTabs.dashboard.rows;
  upsertExclusiveMetric(dashboardRows, ['CECN滞留包裹','CCSLCN分流'], 'CCSLCN分流', summary.ccslCnDiversion, 'ccslCnDiversion');
  upsertExclusiveMetric(dashboardRows, ['CEZT滞留包裹','CCSLZT分流'], 'CCSLZT分流', summary.ccslZtDiversion, 'ccslZtDiversion');
  upsertExclusiveMetric(dashboardRows, ['CCSL580分流','CCSL580滞留包裹','580滞留包裹'], '580滞留包裹', summary.ccsl580Retention, 'ccsl580Retention');
  upsertExclusiveMetric(dashboardRows, ['金边门店'], '金边门店', summary.phnomPenhShop, 'phnomPenhShop');
  state.detailTabs.dashboard.total = dashboardRows.length;
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
  state.detailTabs.ccslCnDiversion = tab('CCSLCN分流', rows.filter(row => row.routingDestination === ROUTING_DESTINATIONS.CCSLCN));
  state.detailTabs.ccslZtDiversion = tab('CCSLZT分流', rows.filter(row => row.routingDestination === ROUTING_DESTINATIONS.CCSLZT));
  state.detailTabs.ccsl580Retention = tab('580滞留包裹', rows.filter(row => row.routingDestination === ROUTING_DESTINATIONS.CCSL580));
  state.detailTabs.ccsl580Diversion = state.detailTabs.ccsl580Retention;
  state.detailTabs.phnomPenhShop = tab('金边门店', rows.filter(isPhnomPenhShop));
  if (dashboard.detailTabs) {
    dashboard.detailTabs.ccslCnDiversion = state.detailTabs.ccslCnDiversion;
    dashboard.detailTabs.ccslZtDiversion = state.detailTabs.ccslZtDiversion;
    dashboard.detailTabs.ccsl580Retention = state.detailTabs.ccsl580Retention;
    dashboard.detailTabs.ccsl580Diversion = state.detailTabs.ccsl580Retention;
    dashboard.detailTabs.phnomPenhShop = state.detailTabs.phnomPenhShop;
  }
}

function patchShopeeMetrics(metrics, summary) {
  if (!metrics) return;
  metrics.ccslCnDiversion = summary.ccslCnDiversion;
  metrics.ccslZtDiversion = summary.ccslZtDiversion;
  metrics.ccsl580Retention = summary.ccsl580Retention;
  metrics.ccsl580Diversion = summary.ccsl580Retention;
  metrics.phnomPenhShop = summary.phnomPenhShop;
  metrics.phnomPenhShopTransit = summary.phnomPenhShopTransit;
  metrics.phnomPenhShopArrived = summary.phnomPenhShopArrived;
  metrics.unresolved = Math.max(0, Number(metrics.unresolved || 0) - summary.routingUnaccounted);

  // A recognized CP/FS/PV/PNH store is a Phnom Penh operational location. Keep
  // recipient PP/PV analysis intact, but do not expose that operational location
  // as an "external province store" bucket.
  if ('pvDelivery' in metrics) metrics.pvDelivery = Math.max(0, Number(metrics.pvDelivery || 0) - summary.pvShopTransit);
  if ('pvStoreRetention' in metrics) metrics.pvStoreRetention = 0;
  if ('pvStoreInboundNoScan' in metrics) metrics.pvStoreInboundNoScan = 0;
}

function summarize(rows = []) {
  const cn = rows.filter(row => row.routingDestination === ROUTING_DESTINATIONS.CCSLCN);
  const zt = rows.filter(row => row.routingDestination === ROUTING_DESTINATIONS.CCSLZT);
  const r580 = rows.filter(row => row.routingDestination === ROUTING_DESTINATIONS.CCSL580);
  const shops = rows.filter(isPhnomPenhShop);
  return {
    ccslCnDiversion: cn.length,
    ccslZtDiversion: zt.length,
    ccsl580Retention: r580.length,
    phnomPenhShop: shops.length,
    phnomPenhShopTransit: shops.filter(row => row.shopState === 'SHOP_TRANSFER_IN_PROGRESS').length,
    phnomPenhShopArrived: shops.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT').length,
    pvShopTransit: shops.filter(row => row.regionCode === 'PV' && row.shopState === 'SHOP_TRANSFER_IN_PROGRESS').length,
    pvShopArrived: shops.filter(row => row.regionCode === 'PV' && row.shopState === 'SHOP_ARRIVED_CURRENT').length,
    routingUnaccounted: [...cn, ...zt, ...r580].filter(row => !row.routingAlreadySpecial).length
  };
}

function recognizedSpecial(row = {}, destination = '') {
  const value = String(row.specialState || row.primaryCategory || row.主分类 || '').trim().toUpperCase();
  if (destination === ROUTING_DESTINATIONS.CCSLCN) return ['CCSLCN_DIVERSION','CECN_RETENTION'].includes(value);
  if (destination === ROUTING_DESTINATIONS.CCSLZT) return ['CCSLZT_DIVERSION','CEZT_RETENTION'].includes(value);
  if (destination === ROUTING_DESTINATIONS.CCSL580) return ['CCSL580_RETENTION','CCSL580_DIVERSION'].includes(value);
  return false;
}

function isPhnomPenhShop(row = {}) {
  return ['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(row.shopState || ''));
}

function tab(label, rows = []) {
  const unique = new Map();
  for (const row of rows) {
    const bill = String(row.shipmentCode || row.运单号 || '').trim().toUpperCase();
    if (bill) unique.set(bill, row);
  }
  const values = [...unique.values()];
  return { label, rows: values, total: values.length };
}

function upsertExclusiveMetric(rows, aliases, label, value, tabName) {
  const aliasSet = new Set(aliases);
  let found = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index] || {};
    const name = String(row.项目 || row.metricKey || '');
    if (!aliasSet.has(name)) continue;
    if (!found) found = row;
    else rows.splice(index, 1);
  }
  if (!found) {
    found = { 日期: rows[0]?.日期 || '', 项目: label, metricKey: label, 数值: 0, 数值原值: 0, 状态: '正常分流', 明细Tab: tabName };
    rows.push(found);
  }
  found.项目 = label;
  found.metricKey = label;
  found.数值 = Number(value || 0);
  found.数值原值 = Number(value || 0);
  found.明细Tab = tabName;
  found.状态 = '正常分流';
}
