import fs from 'node:fs';

function patchScope(file, startMarker, endMarker, patches) {
  let source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${file}: missing start marker ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  if (end < 0) throw new Error(`${file}: missing end marker ${endMarker}`);
  let scope = source.slice(start, end);
  for (const { label, before, after } of patches) {
    if (scope.includes(after)) continue;
    const count = scope.split(before).length - 1;
    if (count !== 1) throw new Error(`${file} ${label}: expected one match, got ${count}`);
    scope = scope.replace(before, after);
  }
  fs.writeFileSync(file, source.slice(0, start) + scope + source.slice(end), 'utf8');
}

patchScope('src/rangeDashboardStoreV31.js', 'function queryCcslDailyLatest', 'function queryShopeeDailyLatest', [
  {
    label: 'CCSL current store retention only',
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
    label: 'CCSL pickup success is normal flow',
    before: `      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`,
    after: `      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='PICKUP_SUCCESS'
                OR COALESCE(f.primaryCategory,f.category,'')='正常流转'
               THEN 1 ELSE 0 END) AS normalOperationalOpen,
      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function queryShopeeDailyLatest', 'function buildCcslState', [
  {
    label: 'Shopee current store retention1 only',
    before: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=1 THEN 1 ELSE 0 END) AS shopRetention1,`,
    after: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT'
                AND COALESCE(f.shopRetentionNaturalDays,0)>=1
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,'') NOT IN ('门店Pending','门店OC')
               THEN 1 ELSE 0 END) AS shopRetention1,`
  },
  {
    label: 'Shopee current store retention2 only',
    before: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=2 THEN 1 ELSE 0 END) AS shopRetention2,`,
    after: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT'
                AND COALESCE(f.shopRetentionNaturalDays,0)>=2
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,'') NOT IN ('门店Pending','门店OC')
               THEN 1 ELSE 0 END) AS shopRetention2,`
  },
  {
    label: 'Shopee current store retention3 only',
    before: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=3 THEN 1 ELSE 0 END) AS shopRetention3,`,
    after: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT'
                AND COALESCE(f.shopRetentionNaturalDays,0)>=3
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('SHOP_PENDING','SHOP_OC')
                AND COALESCE(f.primaryCategory,'') NOT IN ('门店Pending','门店OC')
               THEN 1 ELSE 0 END) AS shopRetention3,`
  },
  {
    label: 'Shopee pickup success is normal flow',
    before: `      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`,
    after: `      SUM(CASE WHEN UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='PICKUP_SUCCESS'
                OR COALESCE(f.primaryCategory,'')='正常流转'
               THEN 1 ELSE 0 END) AS normalOperationalOpen,
      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function buildCcslState', 'function buildShopeeState', [
  {
    label: 'CCSL normal flow subtotal',
    before: `  const normalShopOpen = sum(rows, 'normalShopOpen');
  const specialClosed = sum(rows, 'specialClosed');`,
    after: `  const normalShopOpen = sum(rows, 'normalShopOpen');
  const normalOperationalOpen = sum(rows, 'normalOperationalOpen');
  const specialClosed = sum(rows, 'specialClosed');`
  },
  {
    label: 'CCSL transfer2 metric',
    before: `'inboundNoScan','workOrder','shopRetention2','provinceOpen'`,
    after: `'inboundNoScan','workOrder','shopRetention2','shopTransit2','provinceOpen'`
  },
  {
    label: 'CCSL abnormal denominator',
    before: `      normalShopOpen,
      specialClosed,
      abnormalCount: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - specialClosed),`,
    after: `      normalShopOpen,
      normalOperationalOpen,
      specialClosed,
      abnormalCount: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - normalOperationalOpen - specialClosed),`
  },
  {
    label: 'CCSL abnormal detail denominator',
    before: `      coreAbnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - specialClosed) },
      abnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - specialClosed) }`,
    after: `      coreAbnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - normalOperationalOpen - specialClosed) },
      abnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - normalOperationalOpen - specialClosed) }`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function ccslDashboardRows', 'function shopeeDashboardRows', [
  {
    label: 'CCSL transfer2 dashboard row',
    before: `['工单未处理', m.workOrder, 'workOrderAbnormal'], ['门店滞留2天+', m.shopRetention2, 'shopStuck'], ['外省未完结POD件', m.provinceOpen, 'provinceOpen'],`,
    after: `['工单未处理', m.workOrder, 'workOrderAbnormal'], ['门店滞留2天+', m.shopRetention2, 'shopStuck'], ['门店途中2天+', m.shopTransit2, 'shopTransit2'], ['外省未完结POD件', m.provinceOpen, 'provinceOpen'],`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function summarizeShopeeRows', 'function mergeDailyRows', [
  {
    label: 'Shopee unresolved denominator',
    before: `returned, returnRate: rate(returned, total), unresolved: Math.max(0, total - pod - returned - sum(rows, 'returnInProgress') - sum(rows, 'normalShopOpen') - specialClosed), accounted: total, accountingDifference: 0,`,
    after: `returned, returnRate: rate(returned, total), unresolved: Math.max(0, total - pod - returned - sum(rows, 'returnInProgress') - sum(rows, 'normalShopOpen') - sum(rows, 'normalOperationalOpen') - specialClosed), accounted: total, accountingDifference: 0,`
  },
  {
    label: 'Shopee normal flow output',
    before: `returnInProgress: sum(rows, 'returnInProgress'), normalShopOpen: sum(rows, 'normalShopOpen'), returnRequired:`,
    after: `returnInProgress: sum(rows, 'returnInProgress'), normalShopOpen: sum(rows, 'normalShopOpen'), normalOperationalOpen: sum(rows, 'normalOperationalOpen'), returnRequired:`
  }
]);

patchScope('src/rangeDashboardStoreV31.js', 'function mergeDailyRows', 'function mergeShopeeDailyRows', [
  {
    label: 'merge final range fields',
    before: `'shopRetention2','provinceOpen','selfPickup','cecnRetention','ceztRetention','retention580','returned','returnInProgress','normalShopOpen','specialClosed'`,
    after: `'shopRetention2','shopTransit2','provinceOpen','selfPickup','cecnRetention','ceztRetention','retention580','returned','returnInProgress','normalShopOpen','normalOperationalOpen','specialClosed'`
  }
]);

patchScope('src/shopeeAnalyzerV30.js', 'function correctedPvDisposition', 'function rebuildTags', [
  {
    label: 'store Pending OC are not store retention',
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
