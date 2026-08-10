import { getDb } from './db.js';
import { loadRangeDashboard as loadRangeDashboardV34 } from './rangeDashboardStoreV34.js';

const CCSL_TYPES = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);

/**
 * V35: CEL:CCSL580 / CEL:580 is a normal diversion destination.
 *
 * Reaching 580 is not itself a retention abnormality. A future 580-retention
 * rule must be based on an explicit elapsed-time threshold supplied by the
 * business owner. Until then we expose only the normal diversion counter and
 * preserve legacy stored rows without turning them into generic abnormalities.
 */
export function loadRangeDashboard(fromDate, toDate) {
  const range = loadRangeDashboardV34(fromDate, toDate);
  const facts = query580Facts(range.fromDate, range.toDate);

  for (const [type, state] of Object.entries(range.states || {})) {
    if (CCSL_TYPES.has(type)) patchCcslState(state, summarize(facts.filter(row => row.businessType === type)));
    if (SHOPEE_TYPES.has(type)) patchShopeeState(state, summarize(facts.filter(row => row.businessType === type)));
  }
  patchCcslState(range.aggregates?.CCSL, summarize(facts.filter(row => CCSL_TYPES.has(row.businessType))));
  patchShopeeState(range.aggregates?.SHOPEE, summarize(facts.filter(row => SHOPEE_TYPES.has(row.businessType))));

  return {
    ...range,
    queryMode: `${range.queryMode || 'SQL'}+CCSL580_DIVERSION_V35`,
    routingRuleVersion: '2026-08-10-ccslcn-ccslzt-ccsl580-phnom-penh-shop-v2'
  };
}

function query580Facts(fromDate, toDate) {
  const db = getDb();
  return db.prepare(`
    WITH latest AS (
      SELECT b.reportDate,b.snapshotId
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId AND s.status='COMPLETED'
      WHERE b.status='VALID' AND b.reportDate BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1
          FROM unified_import_batches newer
          INNER JOIN unified_snapshots ns ON ns.snapshotId=newer.snapshotId AND ns.status='COMPLETED'
          WHERE newer.status='VALID' AND newer.reportDate=b.reportDate AND newer.createdAt>b.createdAt
        )
    ), valid AS (
      SELECT DISTINCT u.reportDate,u.businessType,u.shipmentCode
      FROM latest l
      INNER JOIN unified_import_rows u ON u.snapshotId=l.snapshotId AND u.reportDate=l.reportDate
    ), prepared AS (
      SELECT v.reportDate,v.businessType,v.shipmentCode,
        UPPER(CASE
          WHEN v.businessType IN ('SHOPEECN','SHOPEEVN') THEN
            COALESCE(sf.primaryCategory,'') || ' ' ||
            COALESCE(json_extract(sf.rawJson,'$.specialState'),'') || ' ' ||
            COALESCE(json_extract(sf.rawJson,'$.latestEffectiveTargetNodeCode'),'') || ' ' ||
            COALESCE(json_extract(sf.rawJson,'$.latestEffectiveTargetNode'),'') || ' ' ||
            COALESCE(json_extract(sf.rawJson,'$.latestNodeCode'),'') || ' ' ||
            COALESCE(json_extract(sf.rawJson,'$.latestTrackingDescription'),'') || ' ' ||
            COALESCE(json_extract(sf.rawJson,'$.lastEventDesc'),'') || ' ' ||
            COALESCE(json_extract(sf.rawJson,'$.最后节点'),'')
          ELSE
            COALESCE(cf.primaryCategory,'') || ' ' ||
            COALESCE(json_extract(cf.rawJson,'$.specialState'),'') || ' ' ||
            COALESCE(json_extract(cf.rawJson,'$.latestEffectiveTargetNodeCode'),'') || ' ' ||
            COALESCE(json_extract(cf.rawJson,'$.latestEffectiveTargetNode'),'') || ' ' ||
            COALESCE(json_extract(cf.rawJson,'$.latestNodeCode'),'') || ' ' ||
            COALESCE(json_extract(cf.rawJson,'$.latestTrackingDescription'),'') || ' ' ||
            COALESCE(json_extract(cf.rawJson,'$.lastEventDesc'),'') || ' ' ||
            COALESCE(json_extract(cf.rawJson,'$.最后节点'),'')
        END) AS evidence
      FROM valid v
      LEFT JOIN final_rows cf
        ON v.businessType IN ('CE','CEAF','TBKH','ALI1688')
       AND cf.shipmentCode=v.shipmentCode AND cf.reportDate=v.reportDate
      LEFT JOIN business_final_rows sf
        ON v.businessType IN ('SHOPEECN','SHOPEEVN')
       AND sf.businessType='SHOPEE' AND sf.shipmentCode=v.shipmentCode AND sf.reportDate=v.reportDate
    )
    SELECT reportDate,businessType,
      SUM(CASE WHEN evidence LIKE '%CCSL580%' OR evidence LIKE '%CEL:580%' OR evidence LIKE '%LATEST_NODE_580%' THEN 1 ELSE 0 END) AS ccsl580Diversion
    FROM prepared
    GROUP BY reportDate,businessType
    ORDER BY reportDate,businessType
  `).all(fromDate, toDate).map(row => ({
    reportDate: row.reportDate,
    businessType: row.businessType,
    ccsl580Diversion: Number(row.ccsl580Diversion || 0)
  }));
}

function patchCcslState(state, routing) {
  if (!state?.dashboard) return;
  state.dashboard.routing = { ...(state.dashboard.routing || {}), ...routing };
  state.dashboard.categories = {
    ...(state.dashboard.categories || {}),
    ccsl580Diversion: routing.ccsl580Diversion,
    ccsl580Retention: 0
  };
  state.detailTabs ||= {};
  state.detailTabs.ccsl580Diversion = { label: 'CCSL580分流', rows: [], total: routing.ccsl580Diversion };
  const rows = state.detailTabs?.dashboard?.rows;
  if (Array.isArray(rows)) renameOrUpsert(rows, ['580滞留包裹','CCSL580滞留包裹','CCSL580分流'], 'CCSL580分流', routing.ccsl580Diversion, 'ccsl580Diversion');
}

function patchShopeeState(state, routing) {
  if (!state?.dashboard) return;
  state.dashboard.routing = { ...(state.dashboard.routing || {}), ...routing };
  const patched = new Set();
  const patchMetrics = metrics => {
    if (!metrics || patched.has(metrics)) return;
    patched.add(metrics);
    metrics.ccsl580Diversion = routing.ccsl580Diversion;
    if ('ccsl580Retention' in metrics) metrics.ccsl580Retention = 0;
  };
  patchMetrics(state.dashboard.metrics);
  const groups = state.dashboard.recipientGroups || {};
  patchMetrics(groups.ALL?.metrics);
  patchMetrics(groups.CN?.metrics);
  patchMetrics(groups.VN?.metrics);
  for (const regionCode of ['PP','PV','UNKNOWN']) {
    patchMetrics(state.dashboard.regions?.[regionCode]);
    patchMetrics(groups.ALL?.regions?.[regionCode]);
    patchMetrics(groups.CN?.regions?.[regionCode]);
    patchMetrics(groups.VN?.regions?.[regionCode]);
  }
  state.detailTabs ||= {};
  state.detailTabs.ccsl580Diversion = { label: 'CCSL580分流', rows: [], total: routing.ccsl580Diversion };
  if (state.dashboard.detailTabs) state.dashboard.detailTabs.ccsl580Diversion = state.detailTabs.ccsl580Diversion;
}

function renameOrUpsert(rows, aliases, label, value, tab) {
  let found = rows.find(row => aliases.includes(row?.项目) || aliases.includes(row?.metricKey));
  if (!found) {
    found = { 日期: rows[0]?.日期 || '', 项目: label, metricKey: label, 数值: 0, 数值原值: 0, 状态: '正常分流', 明细Tab: tab };
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
  return { ccsl580Diversion: rows.reduce((sum, row) => sum + Number(row.ccsl580Diversion || 0), 0) };
}
