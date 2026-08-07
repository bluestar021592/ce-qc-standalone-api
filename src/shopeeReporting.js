import { getMetricTrend, trendChars } from './reporting.js';
import { recipientGroupOf } from './recipientGroup.js';

// OTHER is retained only in the import audit. It is never a Shopee business
// group and therefore cannot reach dashboard, carry, trend or export metrics.
export const SHOPEE_RECIPIENT_GROUPS = Object.freeze(['ALL', 'CN', 'VN']);

const STORE_METRICS = Object.freeze([
  ['在途门店', 'shopTransit', 'shopTransit', '件'],
  ['到达门店', 'shopArrived', 'shopArrived', '件'],
  ['门店Pending', 'shopPending', 'shopPending', '件'],
  ['门店滞留1天+', 'shopRetention1', 'shopRetention1', '件'],
  ['门店滞留2天+', 'shopRetention2', 'shopRetention2', '件'],
  ['门店滞留3天+', 'shopRetention3', 'shopRetention3', '件']
]);

const PUBLIC_METRICS = Object.freeze([
  ['今日总单', 'total', 'all', '件'],
  ['今日POD', 'pod', 'pod', '件'],
  ['POD率', 'podRate', 'pod', '%'],
  ['首派成功率', 'firstAttemptRate', 'firstAttempt', '%'],
  ['Pending1+', 'pending1', 'pending1', '件'],
  ['Pending2+', 'pending2', 'pending2', '件'],
  ['Pending3+', 'pending3plus', 'pending3', '件'],
  ['OC1+', 'oc1', 'oc1', '件'],
  ['OC2+', 'oc2', 'oc2', '件'],
  ['OC3+', 'oc3plus', 'oc3', '件'],
  ['盘点2天+', 'cycle2plus', 'cycle2', '件'],
  ['入库无扫描', 'inboundNoScan', 'inboundNoScan', '件'],
  ['退回件', 'returned', 'returned', '件'],
  ['退回率', 'returnRate', 'returned', '%'],
  ['退回处理中', 'returnInProgress', 'returnInProgress', '件']
  ,['派送中', 'deliveryStay', 'deliveryStay', '件']
  ,['派送中率', 'deliveryStayRate', 'deliveryStay', '%']
  ,['中转节点停留', 'transitHubStay', 'transitHubStay', '件']
  ,['严重超时未更新', 'severeOverdue', 'severeOverdue', '件']
  ,['外省派送中', 'pvDelivery', 'pvDelivery', '件']
  ,['外省门店滞留', 'pvStoreRetention', 'pvStoreRetention', '件']
  ,['外省门店入库无节点', 'pvStoreInboundNoScan', 'pvStoreInboundNoScan', '件']
  ,['外省其他未闭环', 'pvOtherUnresolved', 'pvOtherUnresolved', '件']
]);

export function buildShopeeDashboard(state = {}) {
  const rows = uniqueRows(state.finalRows || []);
  const dailyRows = buildDailyRows(state, rows);
  const carryRows = rowsForBills(rows, state.carryBills || []);
  const nextCarryRows = rowsForBills(rows, state.nextCarryBills?.length ? state.nextCarryBills : (state.carryBills || []));
  const recipientGroups = {};
  for (const group of SHOPEE_RECIPIENT_GROUPS) {
    recipientGroups[group] = summarizeRecipientGroup(group, dailyRows, rows, carryRows, nextCarryRows);
  }

  const reconciliation = reconcileRecipientGroups(recipientGroups);
  const current = { ...recipientGroups.ALL.metrics };
  const groups = recipientGroups.ALL.groups;
  const abnormalRows = uniqueRows([
    ...groups.pending1, ...groups.oc1, ...groups.inboundNoScan, ...groups.returnRequired
  ]);
  current.queried = new Set([...(state.scanResults || []), ...(state.trackResults || [])].map(billOf).filter(Boolean)).size;
  current.unpod = Math.max(0, current.total - current.pod);
  current.abnormal = abnormalRows.length;
  current.carry = groups.carry.length;
  current.nextCarry = groups.nextCarry.length;
  current.pendingContinuous = groups.pendingContinuous.length;
  current.pendingNonContinuous = groups.pendingNonContinuous.length;
  current.deliveryStay = groups.deliveryStay.length;
  current.nodeStale = groups.nodeStale.length;
  current.noTrack = groups.noTrack.length;
  current.retry = groups.retry.length;
  current.returnRequired = groups.returnRequired.length;
  current.returned = groups.returned.length;
  current.transitHubStay = groups.transitHubStay.length;
  current.severeOverdue = groups.severeOverdue.length;

  const dashboardRows = SHOPEE_RECIPIENT_GROUPS.flatMap(group => metricRowsForGroup(group, recipientGroups[group], state));
  const detailTabs = buildShopeeDetailTabs(state, recipientGroups, abnormalRows);
  detailTabs.dashboard = { label: 'SHOPEE总看板', rows: dashboardRows, total: dashboardRows.length };
  const regions = buildRegionSummary(dailyRows, rows);

  return {
    businessType: 'SHOPEE',
    reportDate: state.reportDate || '',
    snapshotId: state.snapshotId || '',
    metrics: current,
    recipientGroups: Object.fromEntries(Object.entries(recipientGroups).map(([group, value]) => [group, publicGroupSummary(value)])),
    recipientReconciliation: reconciliation,
    importMeta: {
      sourceName: state.sourceName || '',
      importedAt: state.daily?.importedAt || state.dailyParseSummary?.importedAt || '',
      recipientHeader: state.dailyParseSummary?.recipientHeader || '',
      conflictCount: Number(state.dailyParseSummary?.conflictCount || state.recipientConflicts?.length || 0),
      warnings: state.dailyParseSummary?.warnings || []
    },
    regions,
    regionTrends: buildRegionTrends(state, regions),
    recipientTrends: buildRecipientTrends(state, recipientGroups),
    statusCounts: {
      Pending: current.pending1,
      OC: current.oc1,
      派送中: current.deliveryStay,
      无轨迹: current.noTrack,
      待重试: current.retry,
      退回待处理: current.returnRequired,
      已退回: current.returned,
      POD: current.pod,
      其他已识别节点: rows.filter(row => !isPod(row) && !isTrackedException(row)).length
    },
    dashboardRows,
    detailTabs
  };
}

export function buildShopeeDetailTabs(state = {}, suppliedGroups = null, suppliedAbnormal = null) {
  const rows = uniqueRows(state.finalRows || []);
  const dailyRows = buildDailyRows(state, rows);
  const carryRows = rowsForBills(rows, state.carryBills || []);
  const nextCarryRows = rowsForBills(rows, state.nextCarryBills?.length ? state.nextCarryBills : (state.carryBills || []));
  const recipientGroups = suppliedGroups || Object.fromEntries(SHOPEE_RECIPIENT_GROUPS.map(group => [group, summarizeRecipientGroup(group, dailyRows, rows, carryRows, nextCarryRows)]));
  const allGroups = recipientGroups.ALL.groups;
  const abnormalRows = suppliedAbnormal || uniqueRows([
    ...allGroups.pending1, ...allGroups.oc1, ...allGroups.inboundNoScan, ...allGroups.returnRequired
  ]);
  const tabs = {
    shopTransit: tab('在途门店', visibleRows(allGroups.shopTransit)),
    shopArrived: tab('到达门店', visibleRows(allGroups.shopArrived)),
    shopPending: tab('门店Pending', visibleRows(allGroups.shopPending)),
    shopRetention1: tab('门店滞留1天+', visibleRows(allGroups.shopRetention1)),
    shopRetention2: tab('门店滞留2天+', visibleRows(allGroups.shopRetention2)),
    shopRetention3: tab('门店滞留3天+', visibleRows(allGroups.shopRetention3)),
    all: tab('全部明细', visibleRows(allGroups.all)),
    pod: tab('已签收', visibleRows(allGroups.pod)),
    firstAttempt: tab('首派成功', visibleRows(allGroups.firstAttempt)),
    abnormal: tab('全部异常', visibleRows(abnormalRows)),
    pending1: tab('Pending1+', visibleRows(allGroups.pending1)),
    pending2: tab('Pending2+', visibleRows(allGroups.pending2)),
    pending3: tab('Pending3+', visibleRows(allGroups.pending3)),
    oc1: tab('OC1+', visibleRows(allGroups.oc1)),
    oc2: tab('OC2+', visibleRows(allGroups.oc2)),
    oc3: tab('OC3+', visibleRows(allGroups.oc3)),
    cycle2: tab('盘点2天+', visibleRows(allGroups.cycle2)),
    inboundNoScan: tab('入库无扫描', visibleRows(allGroups.inboundNoScan)),
    transitHubStay: tab('中转节点停留', visibleRows(allGroups.transitHubStay)),
    severeOverdue: tab('严重超时未更新', visibleRows(allGroups.severeOverdue)),
    returned: tab('已退回件', visibleRows(allGroups.returned)),
    unresolved: tab('当前未闭环', visibleRows(allGroups.unresolved)),
    returnInProgress: tab('退回处理中', visibleRows(allGroups.returnInProgress)),
    returnRequired: tab('退回待处理', visibleRows(allGroups.returnRequired)),
    pvDelivery: tab('外省派送中', visibleRows(allGroups.pvDelivery)),
    pvStoreRetention: tab('外省门店滞留', visibleRows(allGroups.pvStoreRetention)),
    pvStoreInboundNoScan: tab('外省门店入库无节点', visibleRows(allGroups.pvStoreInboundNoScan)),
    pvOtherUnresolved: tab('外省其他未闭环', visibleRows(allGroups.pvOtherUnresolved)),
    pp: tab('本省PP明细', visibleRows(rows.filter(row => normalizedRegion(row) === 'PP'))),
    pv: tab('外省PV明细', visibleRows(rows.filter(row => normalizedRegion(row) === 'PV'))),
    recipientConflicts: tab('收件人分组冲突', (state.recipientConflicts || []).map(conflict => ({
      shipmentCode: conflict.shipmentCode,
      recipient_group: 'CONFLICT',
      recipient_group_reason: 'RECIPIENT_GROUP_CONFLICT',
      conflictGroups: (conflict.groups || []).join(' / '),
      sourceRows: JSON.stringify(conflict.rows || [])
    })))
  };
  tabs.byRecipientGroup = {};
  for (const group of SHOPEE_RECIPIENT_GROUPS) {
    const groupTabs = tabsForRecipientGroup(group, recipientGroups[group]);
    tabs.byRecipientGroup[group] = groupTabs;
    for (const [key, value] of Object.entries(groupTabs)) tabs[`${group}_${key}`] = value;
  }
  return tabs;
}

export function reconcileRecipientGroups(recipientGroups = {}) {
  const checks = [];
  for (const key of ['total', 'pod', 'pending1', 'pending2', 'pending3plus', 'oc1', 'oc2', 'oc3plus', 'inboundNoScan', 'transitHubStay', 'severeOverdue', 'returned', 'returnInProgress', 'shopTransit', 'shopArrived', 'shopPending', 'shopRetention1', 'shopRetention2', 'shopRetention3', 'pvDelivery', 'pvStoreRetention', 'pvStoreInboundNoScan', 'pvOtherUnresolved']) {
    const all = Number(recipientGroups.ALL?.metrics?.[key] || 0);
    const parts = ['CN', 'VN'].reduce((sum, group) => sum + Number(recipientGroups[group]?.metrics?.[key] || 0), 0);
    checks.push({ key, all, parts, difference: all - parts, passed: all === parts });
  }
  return {
    status: checks.every(check => check.passed) ? 'PASSED' : 'FAILED_RECONCILIATION',
    checks,
    checkedAt: new Date().toISOString()
  };
}

function summarizeRecipientGroup(group, dailyRows, rows, carryRows, nextCarryRows) {
  const eligible = list => (list || []).filter(row => ['CN', 'VN'].includes(recipientGroupOf(row)));
  const select = list => group === 'ALL' ? eligible(list) : eligible(list).filter(row => recipientGroupOf(row) === group);
  const groupDaily = uniqueRows(select(dailyRows));
  const groupRows = uniqueRows(select(rows));
  const groups = buildGroups(groupRows, select(carryRows), select(nextCarryRows));
  Object.assign(groups, buildStoreGroups(groupRows));
  const regions = buildRegionSummary(groupDaily, groupRows);
  const eligibleFirstAttempt = groupDaily.filter(row => row.API状态 !== '失败' && row.查询状态 !== 'refresh_failed' && Boolean(row.finalRowAvailable));
  const firstAttempt = eligibleFirstAttempt.filter(row => isPod(row) && Number(row.Pending最大次数 || row.Pending次数 || 0) === 0 && Number(row.OC最大天数 || row.OC天数 || 0) === 0);
  const pod = groupDaily.filter(isPod);
  const returnedDaily = groupDaily.filter(isReturned);
  const unresolved = groupDaily.filter(row => !isPod(row) && !isReturned(row));
  const dispatchAttempt1 = groupDaily.filter(row => isPod(row) && dispatchDayNo(row) === 1);
  const dispatchAttempt2 = groupDaily.filter(row => isPod(row) && dispatchDayNo(row) === 2);
  const dispatchAttempt3 = groupDaily.filter(row => isPod(row) && dispatchDayNo(row) >= 3);
  return {
    group,
    dailyRows: groupDaily,
    monitorRows: groupRows,
    monitorCount: groupRows.length,
    regions,
    groups: { ...groups, all: groupDaily, pod, firstAttempt, unresolved },
    metrics: {
      total: groupDaily.length,
      pod: pod.length,
      podRate: rate(pod.length, groupDaily.length),
      firstAttemptCount: firstAttempt.length,
      firstAttemptEligible: eligibleFirstAttempt.length,
      firstAttemptRate: rate(firstAttempt.length, eligibleFirstAttempt.length),
      pending1: groups.pending1.length,
      pending2: groups.pending2.length,
      pending3plus: groups.pending3.length,
      oc1: groups.oc1.length,
      oc2: groups.oc2.length,
      oc3plus: groups.oc3.length,
      cycle2plus: groups.cycle2.length,
      inboundNoScan: groups.inboundNoScan.length,
      returned: groups.returned.length,
      returnRate: rate(groups.returned.length, groupDaily.length),
      unresolved: unresolved.length,
      accounted: pod.length + returnedDaily.length + unresolved.length,
      accountingDifference: groupDaily.length - pod.length - returnedDaily.length - unresolved.length,
      returnInProgress: groups.returnInProgress.length,
      deliveryStay: groups.deliveryStay.length,
      deliveryStayRate: rate(groups.deliveryStay.length, groupDaily.length),
      dispatchAttempt1: dispatchAttempt1.length,
      dispatchAttempt2: dispatchAttempt2.length,
      dispatchAttempt3: dispatchAttempt3.length,
      dispatchAttemptDenominator: groupDaily.length,
      dispatchAttempt1Rate: rate(dispatchAttempt1.length, groupDaily.length),
      dispatchAttempt2Rate: rate(dispatchAttempt2.length, groupDaily.length),
      dispatchAttempt3Rate: rate(dispatchAttempt3.length, groupDaily.length),
      transitHubStay: groups.transitHubStay.length,
      severeOverdue: groups.severeOverdue.length,
      shopTransit: groups.shopTransit.length,
      shopArrived: groups.shopArrived.length,
      shopPending: groups.shopPending.length,
      shopRetention1: groups.shopRetention1.length,
      shopRetention2: groups.shopRetention2.length,
      shopRetention3: groups.shopRetention3.length
      ,pvDelivery: groups.pvDelivery.length
      ,pvStoreRetention: groups.pvStoreRetention.length
      ,pvStoreInboundNoScan: groups.pvStoreInboundNoScan.length
      ,pvOtherUnresolved: groups.pvOtherUnresolved.length
    }
  };
}

function metricRowsForGroup(group, summary, state) {
  return [...PUBLIC_METRICS, ...STORE_METRICS].map(([label, key, tabKey, unit]) => {
    const value = Number(summary.metrics[key] || 0);
    const isRate = unit === '%';
    const status = isRate ? (value >= 90 ? 'normal' : 'warning') : (['total', 'pod'].includes(key) ? 'volume' : countStatus(value));
    const metricKey = `${group}_${label}`;
    const trend = getMetricTrend('SHOPEE', metricKey, state.reportDate || '', 7, state, value, status);
    return {
      日期: state.reportDate || '',
      recipientGroup: group,
      板块: recipientGroupLabel(group),
      项目: label,
      metricKey,
      数值: isRate ? `${value}%` : value,
      数值原值: value,
      单位: unit,
      状态: status,
      明细Tab: `${group}_${tabKey}`,
      最长滞留: longestStay(summary.groups[tabKey] || []),
      迷你走势: trendChars(trend),
      迷你走势数据: trend
    };
  });
}

function tabsForRecipientGroup(group, summary) {
  const label = recipientGroupLabel(group);
  const groups = summary.groups;
  return {
    shopTransit: tab(`${label}在途门店`, visibleRows(groups.shopTransit)),
    shopArrived: tab(`${label}到达门店`, visibleRows(groups.shopArrived)),
    shopPending: tab(`${label}门店Pending`, visibleRows(groups.shopPending)),
    shopRetention1: tab(`${label}门店滞留1天+`, visibleRows(groups.shopRetention1)),
    shopRetention2: tab(`${label}门店滞留2天+`, visibleRows(groups.shopRetention2)),
    shopRetention3: tab(`${label}门店滞留3天+`, visibleRows(groups.shopRetention3)),
    all: tab(`${label}今日总单`, visibleRows(groups.all)),
    pod: tab(`${label}今日POD`, visibleRows(groups.pod)),
    firstAttempt: tab(`${label}首派成功`, visibleRows(groups.firstAttempt)),
    pending1: tab(`${label} Pending1+`, visibleRows(groups.pending1)),
    pending2: tab(`${label} Pending2+`, visibleRows(groups.pending2)),
    pending3: tab(`${label} Pending3+`, visibleRows(groups.pending3)),
    oc1: tab(`${label} OC1+`, visibleRows(groups.oc1)),
    oc2: tab(`${label} OC2+`, visibleRows(groups.oc2)),
    oc3: tab(`${label} OC3+`, visibleRows(groups.oc3)),
    cycle2: tab(`${label}盘点2天+`, visibleRows(groups.cycle2)),
    inboundNoScan: tab(`${label}入库无扫描`, visibleRows(groups.inboundNoScan)),
    transitHubStay: tab(`${label}中转节点停留`, visibleRows(groups.transitHubStay)),
    severeOverdue: tab(`${label}严重超时未更新`, visibleRows(groups.severeOverdue)),
    returned: tab(`${label}已退回件`, visibleRows(groups.returned)),
    unresolved: tab(`${label}当前未闭环`, visibleRows(groups.unresolved)),
    attempt1: tab(`${label}1派POD`, visibleRows(groups.all.filter(row => isPod(row) && dispatchDayNo(row) === 1))),
    attempt2: tab(`${label}2派POD`, visibleRows(groups.all.filter(row => isPod(row) && dispatchDayNo(row) === 2))),
    attempt3: tab(`${label}3派及以上POD`, visibleRows(groups.all.filter(row => isPod(row) && dispatchDayNo(row) >= 3))),
    returnInProgress: tab(`${label}退回处理中`, visibleRows(groups.returnInProgress))
    ,deliveryStay: tab(`${label}派送中`, visibleRows(groups.deliveryStay))
    ,pvDelivery: tab(`${label}外省派送中`, visibleRows(groups.pvDelivery))
    ,pvStoreRetention: tab(`${label}外省门店滞留`, visibleRows(groups.pvStoreRetention))
    ,pvStoreInboundNoScan: tab(`${label}外省门店入库无节点`, visibleRows(groups.pvStoreInboundNoScan))
    ,pvOtherUnresolved: tab(`${label}外省其他未闭环`, visibleRows(groups.pvOtherUnresolved))
  };
}

function buildDailyRows(state, finalRows) {
  const finalByBill = new Map(finalRows.map(row => [billOf(row), row]));
  const acceptedRows = (state.dailyParseRows || []).filter(row => ['CN', 'VN'].includes(recipientGroupOf(row)) && (!row.importStatus || ['ACCEPTED', 'DUPLICATE_SAME_GROUP'].includes(row.importStatus)));
  const dailyByBill = new Map();
  for (const row of acceptedRows) {
    const bill = billOf(row);
    if (bill && !dailyByBill.has(bill)) dailyByBill.set(bill, row);
  }
  return [...new Set(state.pnhBills || [])].map(value => String(value || '').trim().toUpperCase()).filter(Boolean).map(bill => {
    const daily = dailyByBill.get(bill) || {};
    const final = finalByBill.get(bill);
    return {
      ...daily,
      ...(final || {}),
      shipmentCode: bill,
      运单号: bill,
      recipient_group: final?.recipient_group || daily.recipient_group || 'OTHER',
      finalRowAvailable: Boolean(final)
    };
  });
}

function buildGroups(rows, carryRows, nextCarryRows) {
  return {
    all: rows,
    pod: rows.filter(isPod),
    firstAttempt: [],
    pending1: rows.filter(row => Number(row.Pending次数 || row.Pending当前次数 || 0) >= 1),
    pending2: rows.filter(row => Number(row.Pending次数 || row.Pending当前次数 || 0) >= 2),
    pending3: rows.filter(row => Number(row.Pending次数 || row.Pending当前次数 || 0) >= 3),
    pendingContinuous: rows.filter(row => row.Pending连续 === '是' || row.Pending连续性 === '连续'),
    pendingNonContinuous: rows.filter(row => row.Pending不连续 === '是' || row.Pending连续性 === '不连续'),
    oc1: rows.filter(row => Number(row.OC天数 || 0) >= 1),
    oc2: rows.filter(row => Number(row.OC天数 || 0) >= 2),
    oc3: rows.filter(row => Number(row.OC天数 || 0) >= 3),
    cycle2: rows.filter(row => Number(row.盘点天数 || 0) >= 2),
    inboundNoScan: rows.filter(row => row.入库无扫描节点 === '是' || categoryOf(row) === '入库无扫描节点'),
    transitHubStay: rows.filter(row => row.中转节点停留 === '是' || categoryOf(row) === '中转节点停留'),
    severeOverdue: rows.filter(row => row.严重超时 === '是' || categoryOf(row) === '严重超时未更新'),
    attempt1: rows.filter(row => isPod(row) && dispatchDayNo(row) === 1),
    attempt2: rows.filter(row => isPod(row) && dispatchDayNo(row) === 2),
    attempt3: rows.filter(row => isPod(row) && dispatchDayNo(row) >= 3),
    deliveryStay: rows.filter(row => Number(row.派送中停留天数 || 0) > 0 || categoryOf(row) === '派送中停留'),
    nodeStale: rows.filter(row => Number(row.节点未更新天数 || 0) > 0 || categoryOf(row) === '节点未更新'),
    noTrack: rows.filter(row => row.无轨迹 === '是' || categoryOf(row) === '无轨迹'),
    retry: rows.filter(row => row.查询状态 === 'refresh_failed' || row.API状态 === '失败' || ['待重试', 'API失败待重试'].includes(categoryOf(row))),
    returnRequired: rows.filter(row => row.returnRequired === true || row.退回待处理 === '是' || ['三次Pending后未退回', '三次Pending后继续派送'].includes(categoryOf(row))),
    returned: rows.filter(row => row.退回状态 === '已退回' || categoryOf(row) === '退回'),
    returnInProgress: rows.filter(row => row.退回状态 === '退回处理中' || row.currentState === 'RETURN_IN_PROGRESS'),
    pvDelivery: rows.filter(row => pvDisposition(row) === 'PV_DELIVERY_IN_PROGRESS'),
    pvStoreRetention: rows.filter(row => pvDisposition(row) === 'PV_STORE_RETENTION'),
    pvStoreInboundNoScan: rows.filter(row => pvDisposition(row) === 'PV_STORE_INBOUND_NO_SCAN'),
    pvOtherUnresolved: rows.filter(row => pvDisposition(row) === 'PV_OTHER_UNRESOLVED'),
    carry: uniqueRows(carryRows),
    nextCarry: uniqueRows(nextCarryRows)
  };
}

function pvDisposition(row = {}) {
  if (row.pvOpenDisposition) return row.pvOpenDisposition;
  if (normalizedRegion(row) !== 'PV' || isPod(row) || isReturned(row) || isApiFailure(row)) return '';
  if (row.shopState === 'SHOP_ARRIVED_CURRENT') {
    return Number(row.shopRetentionNaturalDays || 0) >= 2 ? 'PV_STORE_RETENTION' : 'PV_STORE_INBOUND_NO_SCAN';
  }
  if (row.shopState === 'SHOP_TRANSFER_IN_PROGRESS' || Number(row.派送中停留天数 || 0) > 0) return 'PV_DELIVERY_IN_PROGRESS';
  return 'PV_OTHER_UNRESOLVED';
}

function isApiFailure(row = {}) {
  const status = String(row.API状态 || row.查询状态 || row.queryStatus || '').trim().toUpperCase();
  return status === '失败' || status === 'REFRESH_FAILED' || status === 'SCAN_FAILED' || status === 'TRACK_FAILED';
}

function buildStoreGroups(rows = []) {
  return {
    shopTransit: rows.filter(row => row.shopState === 'SHOP_TRANSFER_IN_PROGRESS'),
    shopArrived: rows.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT'),
    shopPending: rows.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT' && (row.storeTags || row.tags || []).includes('SHOP_PENDING')),
    shopRetention1: rows.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT' && Number(row.shopRetentionNaturalDays || 0) >= 1),
    shopRetention2: rows.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT' && Number(row.shopRetentionNaturalDays || 0) >= 2),
    shopRetention3: rows.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT' && Number(row.shopRetentionNaturalDays || 0) >= 3)
  };
}

function publicGroupSummary(summary) {
  return {
    group: summary.group,
    metrics: summary.metrics,
    monitorCount: summary.monitorCount,
    regions: summary.regions,
    detailCounts: Object.fromEntries(Object.entries(summary.groups).map(([key, rows]) => [key, rows.length]))
  };
}

function buildRecipientTrends(state, recipientGroups) {
  const output = {};
  for (const group of ['CN', 'VN']) {
    const metrics = recipientGroups[group].metrics;
    output[group] = {
      firstAttemptRate: getMetricTrend('SHOPEE', `${group}_首派成功率`, state.reportDate || '', 7, state, metrics.firstAttemptRate, metrics.firstAttemptRate >= 90 ? 'normal' : 'warning'),
      ocRate: getMetricTrend('SHOPEE', `${group}_OC率`, state.reportDate || '', 7, state, rate(metrics.oc1, recipientGroups[group].monitorCount), metrics.oc1 ? 'warning' : 'normal'),
      podRate: getMetricTrend('SHOPEE', `${group}_POD率`, state.reportDate || '', 7, state, metrics.podRate, metrics.podRate >= 90 ? 'normal' : 'warning')
      ,returnCount: getMetricTrend('SHOPEE', `${group}_退回件`, state.reportDate || '', 7, state, metrics.returned, metrics.returned ? 'warning' : 'normal')
      ,returnRate: getMetricTrend('SHOPEE', `${group}_退回率`, state.reportDate || '', 7, state, metrics.returnRate, metrics.returned ? 'warning' : 'normal')
    };
  }
  return output;
}

function buildRegionSummary(dailyRows, rows) {
  const summarize = regionCode => {
    const daily = dailyRows.filter(row => normalizedRegion(row) === regionCode);
    const monitor = rows.filter(row => normalizedRegion(row) === regionCode);
    const pod = daily.filter(isPod).length;
    return {
      regionCode,
      total: daily.length,
      pod,
      podRate: rate(pod, daily.length),
      pending1: monitor.filter(row => Number(row.Pending次数 || row.Pending当前次数 || 0) >= 1).length,
      pending2: monitor.filter(row => Number(row.Pending次数 || row.Pending当前次数 || 0) >= 2).length,
      pending3: monitor.filter(row => Number(row.Pending次数 || row.Pending当前次数 || 0) >= 3).length,
      oc1: monitor.filter(row => Number(row.OC天数 || 0) >= 1).length,
      oc2: monitor.filter(row => Number(row.OC天数 || 0) >= 2).length,
      oc3: monitor.filter(row => Number(row.OC天数 || 0) >= 3).length,
      inboundNoScan: monitor.filter(row => row.入库无扫描节点 === '是').length,
      returnRequired: monitor.filter(row => row.returnRequired === true || row.退回待处理 === '是').length,
      returned: monitor.filter(row => row.退回状态 === '已退回' || categoryOf(row) === '退回').length,
      returnInProgress: monitor.filter(row => row.退回状态 === '退回处理中' || row.currentState === 'RETURN_IN_PROGRESS').length,
      dispatchAttempt1Count: daily.filter(row => isPod(row) && dispatchDayNo(row) === 1).length,
      dispatchAttempt2Count: daily.filter(row => isPod(row) && dispatchDayNo(row) === 2).length,
      dispatchAttempt3Count: daily.filter(row => isPod(row) && dispatchDayNo(row) >= 3).length,
      dispatchAttemptDenominator: daily.length,
      dispatchAttempt1Rate: rate(daily.filter(row => isPod(row) && dispatchDayNo(row) === 1).length, daily.length),
      dispatchAttempt2Rate: rate(daily.filter(row => isPod(row) && dispatchDayNo(row) === 2).length, daily.length),
      dispatchAttempt3Rate: rate(daily.filter(row => isPod(row) && dispatchDayNo(row) >= 3).length, daily.length),
      shopTransit: monitor.filter(row => row.shopState === 'SHOP_TRANSFER_IN_PROGRESS').length,
      shopArrived: monitor.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT').length,
      shopPending: monitor.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT' && (row.storeTags || row.tags || []).includes('SHOP_PENDING')).length,
      shopRetention1: monitor.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT' && Number(row.shopRetentionNaturalDays || 0) >= 1).length,
      shopRetention2: monitor.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT' && Number(row.shopRetentionNaturalDays || 0) >= 2).length,
      shopRetention3: monitor.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT' && Number(row.shopRetentionNaturalDays || 0) >= 3).length
    };
  };
  return { PP: summarize('PP'), PV: summarize('PV'), UNKNOWN: summarize('UNKNOWN') };
}

function buildRegionTrends(state, regions) {
  const output = {};
  for (const code of ['PP', 'PV']) {
    const row = regions[code] || {};
    output[code] = {
      podRate: getMetricTrend('SHOPEE', `${code}签收率`, state.reportDate || '', 7, state, row.podRate || 0, row.podRate >= 90 ? 'normal' : 'warning'),
      pendingRate: getMetricTrend('SHOPEE', `${code}Pending率`, state.reportDate || '', 7, state, rate(row.pending1, row.total), row.pending1 ? 'warning' : 'normal'),
      ocRate: getMetricTrend('SHOPEE', `${code}OC率`, state.reportDate || '', 7, state, rate(row.oc1, row.total), row.oc1 ? 'warning' : 'normal')
    };
  }
  return output;
}

function rowsForBills(rows, bills) {
  const byBill = new Map(rows.map(row => [billOf(row), row]));
  return [...new Set((bills || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))]
    .map(bill => byBill.get(bill) || { businessType: 'SHOPEE', shipmentCode: bill, 运单号: bill, recipient_group: 'OTHER', 是否POD: '否', POD状态: '未POD', carry状态: 'active', 跨日状态: '跨日续查', API状态: '待查询', primaryCategory: '跨日遗留', 主分类: '跨日遗留' });
}

function visibleRows(rows) { return uniqueRows(rows || []).map(publicShopeeRow); }

function publicShopeeRow(row = {}) {
  const hiddenCategories = new Set(['派送中停留', '节点未更新', '无轨迹', 'API失败待重试', '待重试', '跨日遗留']);
  const output = { ...row };
  for (const key of ['派送中停留天数', '节点未更新天数', '无轨迹', '查询状态', 'API状态', 'carry状态', '跨日状态', 'finalRowAvailable']) delete output[key];
  for (const key of ['primaryCategory', '主分类', '当前分类', '异常分类']) {
    if (hiddenCategories.has(String(output[key] || '').trim())) output[key] = '其他已识别节点';
  }
  return output;
}

function isTrackedException(row) {
  return Number(row.Pending次数 || 0) > 0 || Number(row.OC天数 || 0) > 0 || Number(row.派送中停留天数 || 0) > 0
    || Number(row.节点未更新天数 || 0) > 0 || row.入库无扫描节点 === '是' || row.无轨迹 === '是' || row.查询状态 === 'refresh_failed';
}

function recipientGroupLabel(group) {
  return { ALL: '全部合计', CN: 'ShopeeCN（中国）', VN: 'ShopeeVN（越南）', OTHER: '其他/待确认' }[group] || group;
}

function isPod(row = {}) {
  const state = String(row.currentState || row.scanNormalizedState || row.POD状态 || '').trim().toUpperCase();
  return state === 'POD' || String(row.orderStatus || '').trim() === '85' || row.是否POD === '是';
}
function isReturned(row = {}) {
  const state = String(row.currentState || row.scanNormalizedState || row.returnState || '').trim().toUpperCase();
  return state === 'RETURN_COMPLETED'
    || row.退回状态 === '已退回' || categoryOf(row) === '退回';
}
function dispatchDayNo(row = {}) {
  const explicit = Number(row.dispatchDayNo || 0);
  if (explicit > 0) return Math.min(3, explicit);
  const start = String(row.reportDate || row.日报日期 || '').slice(0, 10);
  const end = String(row.POD时间 || row.podTime || row.terminalObservedAt || row.lastCheckedAt || row.analysisDate || '').slice(0, 10);
  const startMs = Date.parse(`${start}T00:00:00+07:00`);
  const endMs = Date.parse(`${end}T00:00:00+07:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.min(3, Math.max(1, Math.floor((endMs - startMs) / 86400000) + 1));
}
function categoryOf(row = {}) { return row.primaryCategory || row.主分类 || row.异常分类 || '其他已识别节点'; }
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase(); }
function uniqueRows(rows = []) { const map = new Map(); for (const row of rows) if (billOf(row)) map.set(billOf(row), row); return [...map.values()]; }
function tab(label, rows) { return { label, rows, total: rows.length }; }
function countStatus(value) { return Number(value || 0) > 0 ? 'warning' : 'normal'; }
function rate(value, total) { return total ? Number(((Number(value || 0) / Number(total)) * 100).toFixed(2)) : 0; }
function longestStay(rows = []) {
  const max = Math.max(0, ...rows.map(row => Math.max(Number(row.OC天数 || 0), Number(row.派送中停留天数 || 0), Number(row.节点未更新天数 || 0))));
  return max ? `${max}天` : '—';
}
function normalizedRegion(row = {}) {
  const code = String(row.regionCode || row.区域 || '').toUpperCase();
  if (code.startsWith('PP') || row.regionType === 'PHNOM_PENH') return 'PP';
  if (code.startsWith('PV') || row.regionType === 'PROVINCE') return 'PV';
  return 'UNKNOWN';
}
