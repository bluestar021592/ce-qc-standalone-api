import fs from 'node:fs';

function patchScope(file, startMarker, endMarker, patches) {
  let source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${file}: start marker not found: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  if (end < 0) throw new Error(`${file}: end marker not found: ${endMarker}`);
  let scope = source.slice(start, end);
  for (const { label, before, after } of patches) {
    if (scope.includes(after)) continue;
    const count = scope.split(before).length - 1;
    if (count !== 1) throw new Error(`${file} ${label}: expected 1 match, got ${count}`);
    scope = scope.replace(before, after);
  }
  source = source.slice(0, start) + scope + source.slice(end);
  fs.writeFileSync(file, source, 'utf8');
}

const ccslNormalOperationalSql = `      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='PICKUP_SUCCESS'
                OR COALESCE(f.primaryCategory,f.category,'')='正常流转'
               THEN 1 ELSE 0 END) AS normalOperationalOpen,\n`;
const shopeeNormalOperationalSql = `      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='PICKUP_SUCCESS'
                OR COALESCE(f.primaryCategory,'')='正常流转'
               THEN 1 ELSE 0 END) AS normalOperationalOpen,\n`;

patchScope('src/rangeDashboardStoreV31.js', 'function queryCcslDailyLatest', 'function queryShopeeDailyLatest', [
  {
    label: 'exclude store context from retention2',
    before: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=2 THEN 1 ELSE 0 END) AS shopRetention2,`,
    after: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT'
                AND COALESCE(f.shopRetentionNaturalDays,0)>=2
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,f.category,'') NOT IN ('门店Pending','门店OC')
               THEN 1 ELSE 0 END) AS shopRetention2,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_TRANSFER_IN_PROGRESS'
                AND COALESCE(CAST(json_extract(f.rawJson,'$.shopTransferNaturalDays') AS INTEGER),0)>=2
               THEN 1 ELSE 0 END) AS shopTransit2,`
  },
  {
    label: 'normal operational SQL',
    before: `      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`,
    after: `${ccslNormalOperationalSql}      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function queryShopeeDailyLatest', 'function buildCcslState', [
  {
    label: 'exclude store context retention1',
    before: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=1 THEN 1 ELSE 0 END) AS shopRetention1,`,
    after: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT'
                AND COALESCE(f.shopRetentionNaturalDays,0)>=1
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,'') NOT IN ('门店Pending','门店OC')
               THEN 1 ELSE 0 END) AS shopRetention1,`
  },
  {
    label: 'exclude store context retention2',
    before: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=2 THEN 1 ELSE 0 END) AS shopRetention2,`,
    after: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT'
                AND COALESCE(f.shopRetentionNaturalDays,0)>=2
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,'') NOT IN ('门店Pending','门店OC')
               THEN 1 ELSE 0 END) AS shopRetention2,`
  },
  {
    label: 'exclude store context retention3',
    before: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=3 THEN 1 ELSE 0 END) AS shopRetention3,`,
    after: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT'
                AND COALESCE(f.shopRetentionNaturalDays,0)>=3
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,'') NOT IN ('门店Pending','门店OC')
               THEN 1 ELSE 0 END) AS shopRetention3,`
  },
  {
    label: 'normal operational SQL',
    before: `      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`,
    after: `${shopeeNormalOperationalSql}      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function buildCcslState', 'function buildShopeeState', [
  {
    label: 'read normal operational',
    before: `  const normalShopOpen = sum(rows, 'normalShopOpen');
  const specialClosed = sum(rows, 'specialClosed');`,
    after: `  const normalShopOpen = sum(rows, 'normalShopOpen');
  const normalOperationalOpen = sum(rows, 'normalOperationalOpen');
  const specialClosed = sum(rows, 'specialClosed');`
  },
  {
    label: 'metric list shop transit2',
    before: `'inboundNoScan','workOrder','shopRetention2','provinceOpen'`,
    after: `'inboundNoScan','workOrder','shopRetention2','shopTransit2','provinceOpen'`
  },
  {
    label: 'dashboard normal operational',
    before: `      normalShopOpen,
      specialClosed,
      abnormalCount: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - specialClosed),`,
    after: `      normalShopOpen,
      normalOperationalOpen,
      specialClosed,
      abnormalCount: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - normalOperationalOpen - specialClosed),`
  },
  {
    label: 'detail denominator',
    before: `      coreAbnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - specialClosed) },
      abnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - specialClosed) }`,
    after: `      coreAbnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - normalOperationalOpen - specialClosed) },
      abnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - normalOperationalOpen - specialClosed) }`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function ccslDashboardRows', 'function shopeeDashboardRows', [
  {
    label: 'dashboard shop transit2 row',
    before: `['工单未处理', m.workOrder, 'workOrderAbnormal'], ['门店滞留2天+', m.shopRetention2, 'shopStuck'], ['外省未完结POD件', m.provinceOpen, 'provinceOpen'],`,
    after: `['工单未处理', m.workOrder, 'workOrderAbnormal'], ['门店滞留2天+', m.shopRetention2, 'shopStuck'], ['门店途中2天+', m.shopTransit2, 'shopTransit2'], ['外省未完结POD件', m.provinceOpen, 'provinceOpen'],`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function summarizeShopeeRows', 'function mergeDailyRows', [
  {
    label: 'Shopee unresolved normal operational',
    before: `returned, returnRate: rate(returned, total), unresolved: Math.max(0, total - pod - returned - sum(rows, 'returnInProgress') - sum(rows, 'normalShopOpen') - specialClosed), accounted: total, accountingDifference: 0,`,
    after: `returned, returnRate: rate(returned, total), unresolved: Math.max(0, total - pod - returned - sum(rows, 'returnInProgress') - sum(rows, 'normalShopOpen') - sum(rows, 'normalOperationalOpen') - specialClosed), accounted: total, accountingDifference: 0,`
  },
  {
    label: 'Shopee expose normal operational',
    before: `returnInProgress: sum(rows, 'returnInProgress'), normalShopOpen: sum(rows, 'normalShopOpen'), returnRequired:`,
    after: `returnInProgress: sum(rows, 'returnInProgress'), normalShopOpen: sum(rows, 'normalShopOpen'), normalOperationalOpen: sum(rows, 'normalOperationalOpen'), returnRequired:`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function mergeDailyRows', 'function mergeShopeeDailyRows', [
  {
    label: 'merge normal operational and transfer',
    before: `'shopRetention2','provinceOpen','selfPickup','cecnRetention','ceztRetention','retention580','returned','returnInProgress','normalShopOpen','specialClosed'`,
    after: `'shopRetention2','shopTransit2','provinceOpen','selfPickup','cecnRetention','ceztRetention','retention580','returned','returnInProgress','normalShopOpen','normalOperationalOpen','specialClosed'`
  }
]);

patchScope('src/shopeeAnalyzerV30.js', 'function correctedPvDisposition', 'function rebuildTags', [
  {
    label: 'store context not retention',
    before: `  if (storeFlow.shopState === 'SHOP_ARRIVED_CURRENT') {
    return Number(storeFlow.shopRetentionNaturalDays || 0) >= 2 ? 'PV_STORE_RETENTION' : 'PV_STORE_NORMAL';
  }`,
    after: `  if (storeFlow.shopState === 'SHOP_ARRIVED_CURRENT') {
    if (['SHOP_PENDING','SHOP_OC'].includes(String(currentState || '').toUpperCase())) return 'PV_STORE_NORMAL';
    return Number(storeFlow.shopRetentionNaturalDays || 0) >= 2 ? 'PV_STORE_RETENTION' : 'PV_STORE_NORMAL';
  }`
  }
]);

patchScope('src/shopeeAnalyzerV31.js', `export const SHOPEE_ANALYSIS_RULE_VERSION`, `/**`, [
  {
    label: 'final rule version',
    before: `export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-09-scan-track-code-separation-v31';`,
    after: `export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-10-final-trajectory-state-machine-v1';`
  }
]);
