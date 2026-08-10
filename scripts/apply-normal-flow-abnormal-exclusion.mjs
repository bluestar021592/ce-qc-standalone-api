import fs from 'node:fs';

function patchFile(file, patches) {
  let source = fs.readFileSync(file, 'utf8');
  for (const { before, after, label } of patches) {
    if (source.includes(after)) continue;
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`${file} ${label}: expected exactly one match, got ${count}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(file, source, 'utf8');
}

patchFile('src/reporting.js', [
  {
    label: 'exclude normal return/store flows from abnormalCount',
    before: `function isAnyAbnormalRow(row = {}) {
  return row?.是否POD !== '是'
    && !isNormalFinalDiversionRow(row)
    && !isRefreshFailedRow(row)
    && !isSpecialRetentionRow(row);
}

function isRefreshFailedRow(row = {}) {`,
    after: `function isAnyAbnormalRow(row = {}) {
  return row?.是否POD !== '是'
    && !isNormalReturnFlowRow(row)
    && !isNormalFinalDiversionRow(row)
    && !isRefreshFailedRow(row)
    && !isSpecialRetentionRow(row)
    && !isNormalShopFlowRow(row);
}

function isNormalReturnFlowRow(row = {}) {
  const state = String(row?.currentState || row?.scanNormalizedState || '').toUpperCase();
  const returnStatus = String(row?.退回状态 || '').trim();
  return ['RETURN_COMPLETED', 'RETURNED', 'RETURN_IN_PROGRESS'].includes(state)
    || ['已退回', '退回处理中'].includes(returnStatus)
    || ['退回', '退回处理中'].includes(String(row?.primaryCategory || row?.主分类 || row?.异常分类 || '').trim());
}

function isNormalShopFlowRow(row = {}) {
  if (!isShopRow(row)) return false;
  const category = String(row?.primaryCategory || row?.主分类 || row?.异常分类 || '').trim();
  const state = String(row?.currentState || '').toUpperCase();
  const retentionDays = shopDays(row);
  const explicitStoreAbnormal = category === '门店滞留'
    || category === '门店途中2天+'
    || category === '门店途中3天+'
    || (row?.shopState === 'SHOP_ARRIVED_CURRENT' && retentionDays >= 2 && !['SHOP_PENDING', 'SHOP_OC'].includes(state));
  return !explicitStoreAbnormal;
}

function isRefreshFailedRow(row = {}) {`
  }
]);

patchFile('src/rangeDashboardStoreV31.js', [
  {
    label: 'CCSL return-in-progress and normal shop counts',
    before: `      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回'
                OR UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED')
                OR COALESCE(f.primaryCategory,f.category,'')='退回'
               THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`,
    after: `      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='已退回'
                OR UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) IN ('RETURNED','RETURN_COMPLETED')
                OR COALESCE(f.primaryCategory,f.category,'')='退回'
               THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$.\"退回状态\"'),'')='退回处理中'
                OR UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='RETURN_IN_PROGRESS'
                OR COALESCE(f.primaryCategory,f.category,'')='退回处理中'
               THEN 1 ELSE 0 END) AS returnInProgress,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_TRANSFER_IN_PROGRESS'
                OR (COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND (
                  COALESCE(f.shopRetentionNaturalDays,0)<2
                  OR UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) IN ('SHOP_PENDING','SHOP_OC')
                  OR COALESCE(f.primaryCategory,f.category,'') IN ('门店Pending','门店OC')
                ))
               THEN 1 ELSE 0 END) AS normalShopOpen,
      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,'')) IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')`
  },
  {
    label: 'Shopee normal shop open count',
    before: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND (
                  UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='SHOP_PENDING'
                  OR COALESCE(f.primaryCategory,'')='门店Pending'
                ) THEN 1 ELSE 0 END) AS shopPending,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=1 THEN 1 ELSE 0 END) AS shopRetention1,`,
    after: `      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND (
                  UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),''))='SHOP_PENDING'
                  OR COALESCE(f.primaryCategory,'')='门店Pending'
                ) THEN 1 ELSE 0 END) AS shopPending,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_TRANSFER_IN_PROGRESS'
                OR (COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND (
                  COALESCE(f.shopRetentionNaturalDays,0)<2
                  OR UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) IN ('SHOP_PENDING','SHOP_OC')
                  OR COALESCE(f.primaryCategory,'') IN ('门店Pending','门店OC')
                ))
               THEN 1 ELSE 0 END) AS normalShopOpen,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=1 THEN 1 ELSE 0 END) AS shopRetention1,`
  },
  {
    label: 'CCSL range abnormal denominator',
    before: `function buildCcslState(label, rows, range, completedDates) {
  const daily = mergeDailyRows(rows);
  const total = sum(rows, 'total');
  const pod = sum(rows, 'pod');
  const returned = sum(rows, 'returned');
  const specialClosed = sum(rows, 'specialClosed');`,
    after: `function buildCcslState(label, rows, range, completedDates) {
  const daily = mergeDailyRows(rows);
  const total = sum(rows, 'total');
  const pod = sum(rows, 'pod');
  const returned = sum(rows, 'returned');
  const returnInProgress = sum(rows, 'returnInProgress');
  const normalShopOpen = sum(rows, 'normalShopOpen');
  const specialClosed = sum(rows, 'specialClosed');`
  },
  {
    label: 'CCSL range abnormal output',
    before: `      returned,
      specialClosed,
      abnormalCount: Math.max(0, total - pod - returned - specialClosed),`,
    after: `      returned,
      returnInProgress,
      normalShopOpen,
      specialClosed,
      abnormalCount: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - specialClosed),`
  },
  {
    label: 'CCSL range detail abnormal output',
    before: `      coreAbnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - specialClosed) },
      abnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - specialClosed) }`,
    after: `      coreAbnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - specialClosed) },
      abnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod - returned - returnInProgress - normalShopOpen - specialClosed) }`
  },
  {
    label: 'merge CCSL daily normal-flow fields',
    before: `'provinceOpen','selfPickup','cecnRetention','ceztRetention','retention580','returned','specialClosed']`,
    after: `'provinceOpen','selfPickup','cecnRetention','ceztRetention','retention580','returned','returnInProgress','normalShopOpen','specialClosed']`
  },
  {
    label: 'Shopee unresolved normal-flow exclusions',
    before: `    returned, returnRate: rate(returned, total), unresolved: Math.max(0, total - pod - returned - specialClosed), accounted: total, accountingDifference: 0,
    returnInProgress: sum(rows, 'returnInProgress'),`,
    after: `    returned, returnRate: rate(returned, total), unresolved: Math.max(0, total - pod - returned - sum(rows, 'returnInProgress') - sum(rows, 'normalShopOpen') - specialClosed), accounted: total, accountingDifference: 0,
    returnInProgress: sum(rows, 'returnInProgress'), normalShopOpen: sum(rows, 'normalShopOpen'),`
  }
]);