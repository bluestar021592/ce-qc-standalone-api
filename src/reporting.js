import { cleanMainBills, isExcludedBill } from './storage.js';
import { isSpecialCategory } from './specialNode.js';

export function buildDashboardData(state = {}) {
  const finalRows = safeFinalRows(state);
  const openRows = finalRows.filter(row => row?.是否POD !== '是');
  const scanResults = Array.isArray(state.scanResults) ? state.scanResults : [];
  const trackResults = Array.isArray(state.trackResults) ? state.trackResults : [];
  const podBillSet = new Set();
  for (const row of finalRows) if (isPodRow(row)) podBillSet.add(billOf(row));
  for (const row of scanResults.filter(isPodRow)) podBillSet.add(billOf(row));
  for (const row of trackResults.filter(isPodRow)) podBillSet.add(billOf(row));

  const pnh = (state.pnhBills || []).length;
  const scanTotal = scanResults.length || (state.scanPool || []).length;
  const monitoredBills = cleanMainBills(
    scanResults.length
      ? scanResults.map(billOf)
      : ((state.scanPool || []).length ? state.scanPool : [...(state.pnhBills || []), ...(state.carryBills || [])])
  );
  const returnBills = uniqueRows(finalRows.filter(row => Number(row?.重复返仓天数 || 0) > 0 || String(row?.返仓日期 || '').trim()));
  const abnormalBills = uniqueRows(finalRows.filter(isAnyAbnormalRow));
  const categories = buildCategoryCounts(openRows, finalRows);
  const abnormalOpen = finalRows.filter(isCoreAbnormalRow).length;
  const filteredNextCarry = nextCarryRows(state);

  return {
    pnh,
    totalMonitored: monitoredBills.length,
    todayPod: podBillSet.size,
    podRate: rateNumber(podBillSet.size, pnh),
    podRateText: rateText(podBillSet.size, pnh),
    nonPnh: (state.nonPnhBills || []).length,
    excluded: (state.excludedBills || []).length,
    duplicates: (state.duplicateBills || []).length,
    carry: (state.carryBills || []).length,
    scanTotal,
    scanPod: scanResults.filter(isPodRow).map(billOf).filter(Boolean).length,
    needTrack: (state.needTrackBills || []).length || Math.max(0, scanTotal - podBillSet.size),
    trackEvents: (state.trackEvents || []).length,
    trackPod: trackResults.filter(isPodRow).map(billOf).filter(Boolean).length,
    nextCarry: filteredNextCarry.length,
    openRate: rateNumber(abnormalOpen, scanTotal),
    openRateText: rateText(abnormalOpen, scanTotal),
    pendingRate: rateNumber(categories.pendingTotal, scanTotal),
    pendingRateText: rateText(categories.pendingTotal, scanTotal),
    ocRate: rateNumber(categories.ocTotal, scanTotal),
    ocRateText: rateText(categories.ocTotal, scanTotal),
    deliveryRate: rateNumber(categories.deliveryTotal, scanTotal),
    deliveryRateText: rateText(categories.deliveryTotal, scanTotal),
    returnCount: returnBills.length,
    returnRate: rateNumber(returnBills.length, monitoredBills.length),
    returnRateText: rateText(returnBills.length, monitoredBills.length),
    abnormalCount: abnormalBills.length,
    abnormalRate: rateNumber(abnormalBills.length, monitoredBills.length),
    abnormalRateText: rateText(abnormalBills.length, monitoredBills.length),
    abnormalOpen,
    categories,
    startedAt: state.lastRunSummary?.startedAt || state.lastRun?.startedAt || '',
    completedAt: state.lastRunSummary?.completedAt || state.lastRun?.completedAt || '',
    durationSeconds: state.lastRunSummary?.durationSeconds || state.lastRun?.durationSeconds || 0
  };
}

export function buildCoreKpis(state = {}) {
  const dashboard = buildDashboardData(state);
  const critical = buildCriticalDashboard(state);
  return {
    totalCount: dashboard.totalMonitored,
    firstPodRate: dashboard.podRate,
    firstPodRateText: dashboard.podRateText,
    anomalyCount: dashboard.abnormalCount,
    anomalyRate: dashboard.abnormalRate,
    anomalyRateText: dashboard.abnormalRateText,
    severeCount: Number(critical.summary?.[0]?.value || 0),
    comparisons: {
      totalCount: previousComparison('总件数', dashboard.totalMonitored, state),
      firstPodRate: previousComparison('首投POD率', dashboard.podRate, state, true),
      anomalyRate: previousComparison('异常率', dashboard.abnormalRate, state, true),
      severeCount: previousComparison('严重异常总件数', Number(critical.summary?.[0]?.value || 0), state)
    }
  };
}

export function buildDashboardRows(state = {}) {
  const d = buildDashboardData(state);
  const c = d.categories;
  const date = state.reportDate || '-';
  const rows = [
    metric(date, '基础', '今日PNH', d.pnh, d.pnh ? '正常' : '需跟进', '导入日报识别的今日PNH票数', 'dailyParse'),
    metric(date, '基础', '今日POD', d.todayPod, '正常', '订单扫描或轨迹判断已POD', 'podClosed'),
    metric(date, '基础', '首投POD率', d.podRateText, podRateStatus(d.podRate), '今日POD / 今日PNH', 'podClosed'),
    metric(date, '基础', '异常率', d.abnormalRateText, countStatus(d.abnormalCount), '当日全部异常去重运单数 / 有效监控总件数', 'allData'),
    metric(date, '基础', '跨日遗留', d.carry, d.carry ? '需跟进' : '正常', '长期JSON或上一轮明日继续带入', 'carry'),
    metric(date, '基础', '明日继续监控', d.nextCarry, d.nextCarry ? '需跟进' : '正常', '本轮处理后仍需第二天继续扫描和轨迹', 'nextCarry'),
    metric(date, '基础', '延迟POD', c.delayedPod, countStatus(c.delayedPod), 'POD时间早于日报日期，作为历史POD补锁', 'delayedPod'),
    metric(date, '特殊节点', '仓库自提件', c.selfPickup, countStatus(c.selfPickup), '最后有效轨迹命中仓库自提，排除普通异常', 'selfPickup'),
    metric(date, '特殊节点', 'CECN滞留包裹', c.cecnRetention, countStatus(c.cecnRetention), '最后有效轨迹节点为CE:CECN或CEL:CECN', 'cecnRetention'),
    metric(date, '特殊节点', 'CEZT滞留包裹', c.ceztRetention, countStatus(c.ceztRetention), '最后有效轨迹节点为CE:CEZT或CEL:CEZT', 'ceztRetention'),
    metric(date, '特殊节点', '580滞留包裹', c.ccsl580Retention, countStatus(c.ccsl580Retention), '最后有效轨迹节点为580或CCSL580', 'ccsl580Retention'),

    metric(date, 'Pending', 'Pending率', d.pendingRateText, countStatus(c.pendingTotal), 'Pending总票数 / 扫描量', 'pendingAll'),
    metric(date, 'Pending', 'Pending1+', c.pendingTotal, countStatus(c.pendingTotal), '当前Pending自然日数至少1天', 'pendingAll'),
    metric(date, 'Pending', 'Pending2+', c.pending2 + c.pending3plus, countStatus(c.pending2 + c.pending3plus), '当前Pending自然日数至少2天', 'pending2plus'),
    metric(date, 'Pending', 'Pending3+', c.pending3plus, countStatus(c.pending3plus), '当前Pending自然日数至少3天', 'pending3'),
    metric(date, 'Pending', 'Pending连续3天以上', c.pendingConsecutive3, countStatus(c.pendingConsecutive3), '唯一日期连续3天及以上Pending', 'pendingConsecutive3'),
    metric(date, 'Pending', 'Pending不连续', c.pendingNonContinuous, countStatus(c.pendingNonContinuous), 'Pending日期存在中断', 'pendingNonContinuous'),
    metric(date, 'Pending', 'Pending有图片', c.pendingWithImage, countStatus(c.pendingWithImage), 'Pending节点识别到图片/fileId/附件证据', 'pendingWithImage'),
    metric(date, 'Pending', 'Pending无图片', c.pendingWithoutImage, countStatus(c.pendingWithoutImage), 'Pending节点缺少有效图片证据或API无图片字段', 'pendingWithoutImage'),
    metric(date, 'Pending', 'Pending图片异常', c.pictureException, countStatus(c.pictureException), '图片字段为空/无效/缺少证据', 'pictureException'),

    metric(date, 'OC', 'OC率', d.ocRateText, countStatus(c.ocTotal), 'OC总票数 / 扫描量', 'ocAll'),
    metric(date, 'OC', 'OC1+', c.ocTotal, countStatus(c.ocTotal), '当前OC自然日数至少1天', 'ocAll'),
    metric(date, 'OC', 'OC2+', c.oc2Only + c.oc3plus, countStatus(c.oc2Only + c.oc3plus), '当前OC自然日数至少2天', 'oc2plus'),
    metric(date, 'OC', 'OC3+', c.oc3plus, countStatus(c.oc3plus), '当前OC自然日数至少3天', 'oc3'),

    metric(date, '盘点', '盘点1天', c.cycle1, countStatus(c.cycle1), 'CCSL相关盘点累计1天', 'cycle1'),
    metric(date, '盘点', '盘点2天', c.cycle2Only, countStatus(c.cycle2Only), 'CCSL相关盘点累计2天', 'cycle2'),
    metric(date, '盘点', '盘点3天以上', c.cycle3plus, countStatus(c.cycle3plus), 'CCSL相关盘点累计3天及以上', 'cycle3'),

    metric(date, '派送', '派送停留率', d.deliveryRateText, countStatus(c.deliveryTotal), '派送停留总票数 / 扫描量', 'deliveryAll'),
    metric(date, '派送', '派送停留1天', c.delivery1, countStatus(c.delivery1), '派送中累计1天未POD', 'delivery1'),
    metric(date, '派送', '派送停留2天', c.delivery2Only, countStatus(c.delivery2Only), '派送中累计2天未POD', 'delivery2'),
    metric(date, '派送', '派送停留3天以上', c.delivery3plus, countStatus(c.delivery3plus), '派送中累计3天及以上未POD', 'delivery3'),

    metric(date, '门店', '门店入库包裹数', c.shopInbound, countStatus(c.shopInbound), '已出现到达门店/门店入库节点', 'shopInbound'),
    metric(date, '门店', '门店未入库', c.shopNotInbound, countStatus(c.shopNotInbound), '发往门店但尚未见到达门店/入库节点', 'shopNotInbound'),
    metric(date, '门店', '门店途中', c.shopTransit, countStatus(c.shopTransit), '离开CEZT/网点后下一个网点为门店，尚未见到达门店', 'shopTransit'),
    metric(date, '门店', '门店途中1天', c.shopTransit1, countStatus(c.shopTransit1), '发往门店累计1天未入库', 'shopTransit'),
    metric(date, '门店', '门店途中2天', c.shopTransit2, countStatus(c.shopTransit2), '发往门店累计2天未入库', 'shopTransit'),
    metric(date, '门店', '门店途中3天以上', c.shopTransit3plus, countStatus(c.shopTransit3plus), '发往门店累计3天及以上未入库', 'shopTransit'),
    metric(date, '门店', '门店入库1天', c.shopInbound1, countStatus(c.shopInbound1), '到达门店累计1天未POD', 'shopInbound'),
    metric(date, '门店', '门店入库2天', c.shopInbound2, countStatus(c.shopInbound2), '到达门店累计2天未POD', 'shopInbound'),
    metric(date, '门店', '门店入库3天以上', c.shopInbound3plus, countStatus(c.shopInbound3plus), '到达门店累计3天及以上未POD', 'shopInbound'),
    metric(date, '门店', '门店滞留', c.shopStuck, countStatus(c.shopStuck), '到达门店后跨日仍未POD', 'shopStuck'),

    metric(date, '节点', '节点未更新', c.nodeDateStale, countStatus(c.nodeDateStale), '最后节点日期早于日报归属日期', 'nodeDateStale'),
    metric(date, '节点', '节点未更新1天', c.nodeStale1, countStatus(c.nodeStale1), '最后节点日期早于日报日期1天', 'nodeDateStale'),
    metric(date, '节点', '节点未更新2天', c.nodeStale2, countStatus(c.nodeStale2), '最后节点日期早于日报日期2天', 'nodeDateStale'),
    metric(date, '节点', '节点未更新3天以上', c.nodeStale3plus, countStatus(c.nodeStale3plus), '最后节点日期早于日报日期3天及以上', 'nodeDateStale'),
    metric(date, '节点', '包裹无动作', c.noAction, countStatus(c.noAction), '轨迹接口无返回或无有效动作', 'noAction'),

    metric(date, 'TBKH门店', 'TBKH门店总数', c.tbkhShop, countStatus(c.tbkhShop), 'TBKH开头且命中门店CP码/门店名称', 'tbkhShop'),
    metric(date, 'TBKH门店', 'TBKH门店途中', c.tbkhShopTransit, countStatus(c.tbkhShopTransit), 'TBKH门店包裹发往门店未入库', 'tbkhShop'),
    metric(date, 'TBKH门店', 'TBKH门店入库', c.tbkhShopInbound, countStatus(c.tbkhShopInbound), 'TBKH门店包裹已到达门店', 'tbkhShop'),
    metric(date, 'TBKH门店', 'TBKH门店滞留1天', c.tbkhShopStuck1, countStatus(c.tbkhShopStuck1), 'TBKH门店入库/途中累计1天未POD', 'tbkhShop'),
    metric(date, 'TBKH门店', 'TBKH门店滞留2天', c.tbkhShopStuck2, countStatus(c.tbkhShopStuck2), 'TBKH门店入库/途中累计2天未POD', 'tbkhShop'),
    metric(date, 'TBKH门店', 'TBKH门店滞留3天以上', c.tbkhShopStuck3plus, countStatus(c.tbkhShopStuck3plus), 'TBKH门店入库/途中累计3天及以上未POD', 'tbkhShop'),
    metric(date, 'TBKH门店', 'TBKH门店未POD', c.tbkhShopNotPod, countStatus(c.tbkhShopNotPod), 'TBKH门店包裹仍未POD', 'tbkhShop'),

    metric(date, '异常', '入库无扫描节点', c.inboundNoScan, countStatus(c.inboundNoScan), '未进入有效派送/Pending/OC/盘点轨迹', 'inboundNoScan'),
    metric(date, '工单', '工单未处理', c.workOrderAbnormal, countStatus(c.workOrderAbnormal), '当前CCSL有效监控中仍需人工复核处理的运单', 'workOrderAbnormal'),
    metric(date, '工单', '工单未完结率', d.openRateText, d.abnormalOpen ? '需跟进' : '正常', '未POD且非最终分流/门店类的异常占比', 'coreAbnormal')
  ];
  return rows.map(row => {
    const metricKey = row.metricKey || row.项目;
    const trend = getMetricTrend(metricKey, state.reportDate || '', 7, state, row.数值, row.状态);
    return { ...row, metricKey, 迷你走势: trendChars(trend), 迷你走势数据: trend };
  });
}

export function buildCriticalDashboard(state = {}) {
  const finalRows = safeFinalRows(state);
  const openRows = finalRows.filter(row => row?.是否POD !== '是');
  const buckets = buildDetailBuckets(openRows, finalRows, state);
  const definitions = [
    criticalDef('criticalOc2plus', 'OC 2天及以上', buckets.oc2plus || [], 'oc2plus', row => countOf(row, 'OC天数'), true),
    criticalDef('criticalCycle2plus', '盘点 2天及以上', buckets.cycle2plus || [], 'cycle2plus', row => countOf(row, '盘点天数', '盘点次数'), true),
    criticalDef('criticalShopStuck2', '门店滞留 2天及以上', (buckets.shopStuck || []).filter(row => shopDays(row) >= 2), 'shopStuck', shopDays, true),
    criticalDef('criticalInboundNoScan', '入库无扫描节点', buckets.inboundNoScan || [], 'inboundNoScan', row => countOf(row, '节点未更新天数'), true),
    criticalDef('criticalShopTransit2', '门店途中 2天及以上', (buckets.shopTransit || []).filter(row => shopDays(row) >= 2), 'shopTransit', shopDays, true)
  ];
  const rows = definitions.map(def => criticalRow(def, state));
  const allRows = uniqueRows(definitions.flatMap(def => def.rows));
  return {
    summary: [
      { label: '严重异常总件数', value: allRows.length, detailTab: 'criticalAll' }
    ],
    rows,
    detailRows: {
      criticalAll: allRows,
      ...Object.fromEntries(definitions.map(def => [def.key, def.rows]))
    }
  };
}

export function buildDetailTabs(state = {}) {
  const finalRows = safeFinalRows(state);
  const openRows = finalRows.filter(row => row?.是否POD !== '是');
  const coreAbnormal = finalRows.filter(isCoreAbnormalRow);
  const buckets = buildDetailBuckets(openRows, finalRows, state);
  const critical = buildCriticalDashboard(state);
  return Object.fromEntries(Object.entries({
    dashboard: buildDashboardRows(state),
    dailyParse: state.dailyParseRows || state.daily?.details || [],
    scanResults: state.scanResults || [],
    trackResults: state.trackResults || [],
    trackEvents: state.trackEvents || [],
    podClosed: finalRows.filter(row => row?.是否POD === '是' || row?.异常分类 === 'POD闭环'),
    abnormalOpen: coreAbnormal,
    coreAbnormal,
    allData: finalRows,
    podLocks: cleanMainBills(state.podLocks || []).map(wb => ({ 运单号: wb })),
    ...buckets,
    ...critical.detailRows
  }).map(([key, rows]) => [key, previewRows(rows)]));
}

export function getXlsxSheetRows(state = {}) {
  const finalRows = safeFinalRows(state);
  const openRows = finalRows.filter(row => row?.是否POD !== '是');
  const buckets = buildDetailBuckets(openRows, finalRows, state);
  return {
    dashboard: buildDashboardRows(state).map(row => ({
      日期: row.日期,
      模块: row.模块,
      指标: row.项目,
      数值: row.数值,
      状态: row.状态,
      迷你走势: row.迷你走势,
      迷你走势数据: row.迷你走势数据,
      说明: row.说明,
      明细Tab: row.明细Tab
    })),
    dailyParse: state.dailyParseRows || state.daily?.details || [],
    scanResults: state.scanResults || [],
    trackResults: state.trackResults || [],
    trackEvents: state.trackEvents || [],
    podClosed: finalRows.filter(row => row?.是否POD === '是' || row?.异常分类 === 'POD闭环'),
    abnormalOpen: finalRows.filter(isCoreAbnormalRow),
    unresolved: finalRows.filter(isCoreAbnormalRow),
    severeAbnormal: finalRows.filter(row => isCoreAbnormalRow(row) && isSevereAbnormalRow(row)),
    ...buckets,
    nextCarry: nextCarryRows(state),
    podLocks: cleanMainBills(state.podLocks || []).map(wb => ({ 运单号: wb }))
  };
}

export function safeFinalRows(state = {}) {
  const podSet = new Set(cleanMainBills(state.podLocks || []));
  const sourceRows = Array.isArray(state.finalRows)
    ? state.finalRows
    : Object.values(state.finalRows || {});
  return sourceRows
    .filter(row => {
      const wb = billOf(row);
      return wb && !isExcludedBill(wb);
    })
    .filter(row => row.是否POD === '是' || !podSet.has(billOf(row)));
}

function buildCategoryCounts(openRows, finalRows) {
  const ordinaryRows = openRows.filter(row => !isShopRow(row) && !isNormalFinalDiversionRow(row) && !isRefreshFailedRow(row) && !isSpecialCategory(row));
  const shopRows = finalRows.filter(isShopRow);
  const shopOpenRows = shopRows.filter(row => row?.是否POD !== '是');
  const shopTransitRows = shopOpenRows.filter(isShopTransitRow);
  const shopInboundRows = shopRows.filter(isShopInboundRow);
  const shopStuckRows = shopOpenRows.filter(isShopStuckRow);
  const nodeRows = ordinaryRows.filter(row => row?.节点日期未更新 === '是' || row?.异常分类 === '节点日期未更新');
  const tbkhShopRows = shopRows.filter(isTbkhRow);
  const tbkhOpenRows = tbkhShopRows.filter(row => row?.是否POD !== '是');
  const tbkhStuckRows = tbkhOpenRows.filter(row => Number(row?.门店滞留天数 || row?.门店未更新天数 || 0) > 0);

  const pendingTotal = ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') > 0).length;
  const ocTotal = ordinaryRows.filter(row => countOf(row, 'OC天数') > 0).length;
  const deliveryTotal = ordinaryRows.filter(row => countOf(row, '派送中天数', '派件中天数') > 0).length;

  return {
    pendingTotal,
    pending1: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') === 1).length,
    pending2: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') === 2).length,
    pending3plus: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') >= 3).length,
    pendingConsecutive3: ordinaryRows.filter(isPendingConsecutive3Row).length,
    pendingNonContinuous: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') >= 2 && row?.Pending连续性 === '不连续').length,
    pendingWithImage: ordinaryRows.filter(isPendingWithImageRow).length,
    pendingWithoutImage: ordinaryRows.filter(isPendingWithoutImageRow).length,
    pictureException: ordinaryRows.filter(isPictureExceptionRow).length,
    ocTotal,
    oc1: ordinaryRows.filter(row => countOf(row, 'OC天数') === 1).length,
    oc2Only: ordinaryRows.filter(row => countOf(row, 'OC天数') === 2).length,
    oc3plus: ordinaryRows.filter(row => countOf(row, 'OC天数') >= 3).length,
    cycle1: ordinaryRows.filter(row => countOf(row, '盘点天数', '盘点次数') === 1).length,
    cycle2Only: ordinaryRows.filter(row => countOf(row, '盘点天数', '盘点次数') === 2).length,
    cycle3plus: ordinaryRows.filter(row => countOf(row, '盘点天数', '盘点次数') >= 3).length,
    deliveryTotal,
    delivery1: ordinaryRows.filter(row => countOf(row, '派送中天数', '派件中天数') === 1).length,
    delivery2Only: ordinaryRows.filter(row => countOf(row, '派送中天数', '派件中天数') === 2).length,
    delivery3plus: ordinaryRows.filter(row => countOf(row, '派送中天数', '派件中天数') >= 3).length,
    assign2: ordinaryRows.filter(row => countOf(row, '派件分配天数') >= 2).length,
    inboundNoScan: ordinaryRows.filter(row => row?.异常分类 === '入库无扫描').length,
    noAction: ordinaryRows.filter(isNoActionRow).length,
    nodeDateStale: nodeRows.length,
    nodeStale1: nodeRows.filter(row => staleDays(row) === 1).length,
    nodeStale2: nodeRows.filter(row => staleDays(row) === 2).length,
    nodeStale3plus: nodeRows.filter(row => staleDays(row) >= 3).length,
    delayedPod: finalRows.filter(row => row?.延迟POD === '是').length,
    shopTransit: shopTransitRows.length,
    shopArrived: shopInboundRows.length,
    shopPending: shopInboundRows.filter(row => (row.storeTags || row.tags || []).includes('SHOP_PENDING')).length,
    shopRetention1: shopInboundRows.filter(row => shopDays(row) >= 1).length,
    shopRetention2: shopInboundRows.filter(row => shopDays(row) >= 2).length,
    shopRetention3: shopInboundRows.filter(row => shopDays(row) >= 3).length,
    shopTransit1: shopTransitRows.filter(row => shopDays(row) === 1).length,
    shopTransit2: shopTransitRows.filter(row => shopDays(row) === 2).length,
    shopTransit3plus: shopTransitRows.filter(row => shopDays(row) >= 3).length,
    shopInbound: shopInboundRows.length,
    shopInbound1: shopInboundRows.filter(row => shopDays(row) === 1).length,
    shopInbound2: shopInboundRows.filter(row => shopDays(row) === 2).length,
    shopInbound3plus: shopInboundRows.filter(row => shopDays(row) >= 3).length,
    shopStuck: shopStuckRows.length,
    shopNotInbound: shopTransitRows.length,
    tbkhShop: tbkhShopRows.length,
    tbkhShopTransit: tbkhOpenRows.filter(isShopTransitRow).length,
    tbkhShopInbound: tbkhShopRows.filter(isShopInboundRow).length,
    tbkhShopStuck1: tbkhStuckRows.filter(row => shopDays(row) === 1).length,
    tbkhShopStuck2: tbkhStuckRows.filter(row => shopDays(row) === 2).length,
    tbkhShopStuck3plus: tbkhStuckRows.filter(row => shopDays(row) >= 3).length,
    tbkhShopNotPod: tbkhOpenRows.length,
    finalDiversion: openRows.filter(isNormalFinalDiversionRow).length,
    workOrderAbnormal: ordinaryRows.filter(row => ['工单未处理', '工单异常'].includes(row?.异常分类)).length,
    selfPickup: finalRows.filter(row => String(row.specialState || row.primaryCategory || '') === 'SELF_PICKUP').length,
    cecnRetention: finalRows.filter(row => String(row.specialState || row.primaryCategory || '') === 'CECN_RETENTION').length,
    ceztRetention: finalRows.filter(row => String(row.specialState || row.primaryCategory || '') === 'CEZT_RETENTION').length,
    ccsl580Retention: finalRows.filter(row => String(row.specialState || row.primaryCategory || '') === 'CCSL580_RETENTION').length
  };
}

function buildDetailBuckets(openRows, finalRows, state) {
  const ordinaryRows = openRows.filter(row => !isShopRow(row) && !isNormalFinalDiversionRow(row) && !isRefreshFailedRow(row) && !isSpecialCategory(row));
  const shopRows = finalRows.filter(isShopRow);
  const shopOpenRows = shopRows.filter(row => row?.是否POD !== '是');
  const shopTransitRows = shopOpenRows.filter(isShopTransitRow);
  const shopInboundRows = shopRows.filter(isShopInboundRow);
  const shopStuckRows = shopOpenRows.filter(isShopStuckRow);
  const tbkhShopRows = shopRows.filter(isTbkhRow);
  const nodeRows = ordinaryRows.filter(row => row?.节点日期未更新 === '是' || row?.异常分类 === '节点日期未更新');

  return {
    carry: cleanMainBills(state.carryBills || []).map(wb => ({ 运单号: wb, 来源类型: '跨日遗留' })),
    nextCarry: nextCarryRows(state),
    pendingAll: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') > 0),
    pending1: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') === 1),
    pending2: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') === 2),
    pending2plus: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') >= 2),
    pending3: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') >= 3),
    pendingConsecutive3: ordinaryRows.filter(isPendingConsecutive3Row),
    pendingNonContinuous: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') >= 2 && row?.Pending连续性 === '不连续'),
    pendingWithImage: ordinaryRows.filter(isPendingWithImageRow),
    pendingWithoutImage: ordinaryRows.filter(isPendingWithoutImageRow),
    pictureException: ordinaryRows.filter(isPictureExceptionRow),
    ocAll: ordinaryRows.filter(row => countOf(row, 'OC天数') > 0),
    oc1: ordinaryRows.filter(row => countOf(row, 'OC天数') === 1),
    oc2: ordinaryRows.filter(row => countOf(row, 'OC天数') === 2),
    oc3: ordinaryRows.filter(row => countOf(row, 'OC天数') >= 3),
    oc2plus: ordinaryRows.filter(row => countOf(row, 'OC天数') >= 2),
    cycle1: ordinaryRows.filter(row => countOf(row, '盘点天数', '盘点次数') === 1),
    cycle2: ordinaryRows.filter(row => countOf(row, '盘点天数', '盘点次数') === 2),
    cycle3: ordinaryRows.filter(row => countOf(row, '盘点天数', '盘点次数') >= 3),
    cycle2plus: ordinaryRows.filter(row => countOf(row, '盘点天数', '盘点次数') >= 2),
    deliveryAll: ordinaryRows.filter(row => countOf(row, '派送中天数', '派件中天数') > 0),
    delivery1: ordinaryRows.filter(row => countOf(row, '派送中天数', '派件中天数') === 1),
    delivery2: ordinaryRows.filter(row => countOf(row, '派送中天数', '派件中天数') === 2),
    delivery3: ordinaryRows.filter(row => countOf(row, '派送中天数', '派件中天数') >= 3),
    delivery2plus: ordinaryRows.filter(row => countOf(row, '派送中天数', '派件中天数') >= 2),
    assign2: ordinaryRows.filter(row => countOf(row, '派件分配天数') >= 2),
    inboundNoScan: ordinaryRows.filter(row => row?.异常分类 === '入库无扫描'),
    workOrderAbnormal: ordinaryRows.filter(row => ['工单未处理', '工单异常'].includes(row?.异常分类)),
    noAction: ordinaryRows.filter(isNoActionRow),
    nodeDateStale: nodeRows,
    nodeStale1: nodeRows.filter(row => staleDays(row) === 1),
    nodeStale2: nodeRows.filter(row => staleDays(row) === 2),
    nodeStale3: nodeRows.filter(row => staleDays(row) >= 3),
    delayedPod: finalRows.filter(row => row?.延迟POD === '是'),
    selfPickup: finalRows.filter(row => String(row.specialState || row.primaryCategory || '') === 'SELF_PICKUP'),
    cecnRetention: finalRows.filter(row => String(row.specialState || row.primaryCategory || '') === 'CECN_RETENTION'),
    ceztRetention: finalRows.filter(row => String(row.specialState || row.primaryCategory || '') === 'CEZT_RETENTION'),
    ccsl580Retention: finalRows.filter(row => String(row.specialState || row.primaryCategory || '') === 'CCSL580_RETENTION'),
    shopTransit: shopTransitRows,
    shopArrived: shopInboundRows,
    shopPending: shopInboundRows.filter(row => (row.storeTags || row.tags || []).includes('SHOP_PENDING')),
    shopRetention1: shopInboundRows.filter(row => shopDays(row) >= 1),
    shopRetention2: shopInboundRows.filter(row => shopDays(row) >= 2),
    shopRetention3: shopInboundRows.filter(row => shopDays(row) >= 3),
    shopTransit1: shopTransitRows.filter(row => shopDays(row) === 1),
    shopTransit2: shopTransitRows.filter(row => shopDays(row) === 2),
    shopTransit3: shopTransitRows.filter(row => shopDays(row) >= 3),
    shopInbound: shopInboundRows,
    shopInbound1: shopInboundRows.filter(row => shopDays(row) === 1),
    shopInbound2: shopInboundRows.filter(row => shopDays(row) === 2),
    shopInbound3: shopInboundRows.filter(row => shopDays(row) >= 3),
    shopStuck: shopStuckRows,
    shopNotInbound: shopTransitRows,
    tbkhShop: tbkhShopRows,
    tbkhShopTransit: tbkhShopRows.filter(row => row?.是否POD !== '是' && isShopTransitRow(row)),
    tbkhShopInbound: tbkhShopRows.filter(isShopInboundRow),
    tbkhShopStuck1: tbkhShopRows.filter(row => row?.是否POD !== '是' && shopDays(row) === 1),
    tbkhShopStuck2: tbkhShopRows.filter(row => row?.是否POD !== '是' && shopDays(row) === 2),
    tbkhShopStuck3: tbkhShopRows.filter(row => row?.是否POD !== '是' && shopDays(row) >= 3),
    tbkhShopNotPod: tbkhShopRows.filter(row => row?.是否POD !== '是'),
    finalDiversion: openRows.filter(isNormalFinalDiversionRow)
  };
}

function nextCarryRows(state) {
  const podSet = new Set(cleanMainBills(state.podLocks || []));
  const finalDiversion = new Set((state.finalRows || [])
    .filter(isNormalFinalDiversionRow)
    .map(billOf)
    .filter(Boolean));
  const specialClosed = new Set((state.finalRows || [])
    .filter(isSpecialRetentionRow)
    .map(billOf)
    .filter(Boolean));
  return cleanMainBills(state.nextCarryBills || state.carryBills || [])
    .filter(wb => !podSet.has(wb))
    .filter(wb => !finalDiversion.has(wb))
    .filter(wb => !specialClosed.has(wb))
    .map(wb => ({ 运单号: wb, 来源类型: '明日继续' }));
}

function isCoreAbnormalRow(row = {}) {
  return row?.是否POD !== '是'
    && !isNormalFinalDiversionRow(row)
    && !isRefreshFailedRow(row)
    && !isSpecialRetentionRow(row)
    && !isShopRow(row);
}

function isSpecialRetentionRow(row = {}) {
  return ['SELF_PICKUP', 'CECN_RETENTION', 'CEZT_RETENTION', 'CCSL580_RETENTION']
    .includes(String(row.specialState || row.primaryCategory || row.主分类 || ''));
}

function isSevereAbnormalRow(row = {}) {
  const days = Math.max(
    countOf(row, 'Pending次数', 'Pending天数'),
    countOf(row, 'OC天数'),
    countOf(row, '盘点天数', '盘点次数'),
    countOf(row, '节点未更新天数')
  );
  return /SEVERE|CRITICAL|严重/i.test(String(row.severity || row.严重等级 || row.异常分类 || '')) || days >= 3;
}

function isAnyAbnormalRow(row = {}) {
  return row?.是否POD !== '是'
    && !isNormalFinalDiversionRow(row)
    && !isRefreshFailedRow(row)
    && !isSpecialRetentionRow(row);
}

function isRefreshFailedRow(row = {}) {
  return row?.查询状态 === 'refresh_failed' || row?.异常分类 === 'API查询失败';
}

function isNormalFinalDiversionRow(row = {}) {
  return row?.异常分类 === '正常分流节点'
    || row?.异常分类 === '最终分流排除'
    || row?.primaryCategory === '正常分流节点'
    || row?.matchedRule === 'NORMAL_FINAL_HUB';
}

function isPodRow(row) {
  return row?.是否POD === '是' || row?.异常分类 === 'POD闭环' || String(row?.orderStatus || '') === '85';
}

function isNoActionRow(row = {}) {
  return row?.包裹无动作 === '是' || row?.异常分类 === '包裹无动作' || row?.异常分类 === '轨迹无返回';
}

function isShopRow(row = {}) {
  if (row?.shopState || row?.targetShopCode || row?.currentShopCode) return true;
  return row?.是否门店链路 === '是'
    || Boolean(row?.门店编码 || row?.门店名称 || row?.门店状态)
    || /^门店/.test(String(row?.异常分类 || ''));
}

function isShopTransitRow(row = {}) {
  if (row?.shopState === 'SHOP_TRANSFER_IN_PROGRESS') return true;
  return row?.门店状态 === '门店途中' || row?.异常分类 === '门店途中' || row?.异常分类 === '门店未入库';
}

function isShopInboundRow(row = {}) {
  if (row?.shopState === 'SHOP_ARRIVED_CURRENT' || row?.shopArrivedAt) return true;
  return Boolean(row?.门店入库时间)
    || row?.门店动作类型 === '门店入库'
    || row?.门店状态 === '门店入库'
    || row?.门店状态 === '门店滞留'
    || row?.异常分类 === '门店入库'
    || row?.异常分类 === '门店滞留';
}

function isShopStuckRow(row = {}) {
  if (row?.shopState === 'SHOP_ARRIVED_CURRENT' && shopDays(row) >= 1) return true;
  return row?.门店状态 === '门店滞留'
    || row?.异常分类 === '门店滞留'
    || (isShopInboundRow(row) && shopDays(row) >= 2);
}

function isTbkhRow(row = {}) {
  return row?.TBKH门店包裹 === '是'
    || billOf(row).startsWith('TBKH')
    || /TBKH/i.test([row?.业务来源, row?.customerCode, row?.customerName, row?.rawSummary, row?.原始返回摘要, row?.原始轨迹摘要].map(x => String(x || '')).join(' '));
}

function isPendingWithImageRow(row = {}) {
  return countOf(row, 'Pending次数', 'Pending天数') > 0
    && (Number(row?.Pending有图片次数 || 0) > 0 || row?.Pending图片状态 === 'HAS_IMAGE' || row?.最新Pending有图片 === '是');
}

function isPendingWithoutImageRow(row = {}) {
  return countOf(row, 'Pending次数', 'Pending天数') > 0
    && (Number(row?.Pending无图片次数 || 0) > 0 || ['NO_IMAGE', 'IMAGE_FIELD_EMPTY', 'IMAGE_FIELD_INVALID', 'UNKNOWN_API_NO_FIELD'].includes(row?.Pending图片状态) || row?.Pending图片完整 === '否' || row?.Pending图片完整 === '无法判断');
}

function isPictureExceptionRow(row = {}) {
  return row?.图片异常标记 === '是' || ['NO_IMAGE', 'IMAGE_FIELD_EMPTY', 'IMAGE_FIELD_INVALID'].includes(row?.Pending图片状态);
}

function isPendingConsecutive3Row(row = {}) {
  return row?.Pending连续3天以上 === '是'
    || (row?.Pending连续性 === '连续' && dateListCount(row?.Pending日期) >= 3);
}

function staleDays(row = {}) {
  return Number(row?.节点未更新天数 || row?.noUpdateDays || 0) || 0;
}

function shopDays(row = {}) {
  if (Number(row?.shopRetentionNaturalDays || 0) > 0) return Number(row.shopRetentionNaturalDays);
  return Number(row?.门店滞留天数 || row?.门店未更新天数 || row?.shopNoUpdateDays || 0) || 0;
}

function dateListCount(value) {
  return String(value || '').split(',').map(x => x.trim()).filter(Boolean).length;
}

function billOf(row) {
  return String(row?.运单号 || row?.shipmentCode || row?.waybill || row?.billNo || row || '')
    .trim()
    .toUpperCase();
}

function countOf(row, ...keys) {
  for (const key of keys) {
    const value = Number(row?.[key] ?? 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function metric(date, module, item, value, status, note, detailTab = '') {
  return {
    日期: date,
    模块: module,
    项目: item,
    数值: value,
    状态: status,
    说明: note,
    明细Tab: detailTab
  };
}

function previewRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return { total: list.length, rows: list.slice(0, 200) };
}

function rateNumber(a, b) {
  if (!b) return 0;
  return Math.round((a / b) * 1000) / 10;
}

function rateText(a, b) {
  return `${rateNumber(a, b)}%`;
}

function podRateStatus(value) {
  if (value >= 90) return '正常';
  if (value >= 80) return '需跟进';
  return '重点关注';
}

function countStatus(value) {
  const n = parseMetricNumber(value);
  if (n >= 20) return '重点关注';
  if (n > 0) return '需跟进';
  return '正常';
}

function parseMetricNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value ?? '').replace(/,/g, '').match(/^-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function getMetricTrend(first, second, third = 7, fourth = {}, fifth = 0, sixth = '', seventh = '') {
  const explicitBusiness = ['CCSL', 'SHOPEE'].includes(String(first || '').toUpperCase());
  const businessType = explicitBusiness ? String(first).toUpperCase() : String(fourth?.businessType || 'CCSL').toUpperCase();
  const metricKey = explicitBusiness ? second : first;
  const reportDate = explicitBusiness ? third : second;
  const days = explicitBusiness ? fourth : third;
  const state = explicitBusiness ? fifth : fourth;
  const currentValue = explicitBusiness ? sixth : fifth;
  const currentStatus = explicitBusiness ? seventh : sixth;
  const limit = Math.max(2, Number(days || 7));
  const hasCurrentReport = validDateKey(reportDate);
  const endDate = hasCurrentReport ? reportDate : phnomPenhDateKey();
  const historyByDate = new Map((Array.isArray(state.historySummary) ? state.historySummary : [])
    .filter(item => !item?.businessType || String(item.businessType).toUpperCase() === businessType)
    .map(item => ({
      reportDate: String(item?.reportDate || item?.summary?.reportDate || ''),
      summary: item?.summary || item || {}
    }))
    .filter(item => validDateKey(item.reportDate))
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    .map(item => [item.reportDate, {
      value: historyMetricValue(metricKey, item.summary),
      status: historyMetricStatus(metricKey, item.summary)
    }]));

  const trend = Array.from({ length: limit }, (_, index) => {
    const date = shiftDateKey(endDate, index - limit + 1);
    const history = historyByDate.get(date);
    const raw = date === endDate && hasCurrentReport ? currentValue : history?.value;
    const status = date === endDate && hasCurrentReport ? currentStatus : history?.status;
    const hasData = raw !== null && raw !== undefined && raw !== '';
    return {
      date,
      value: hasData ? parseMetricNumber(raw) : null,
      hasData,
      status: hasData ? trendStatus(metricKey, status, raw) : 'missing'
    };
  });

  if (trend.length !== limit) throw new Error('TREND_LENGTH_INVALID');
  if (trend[trend.length - 1]?.date !== endDate) throw new Error('TREND_LATEST_DATE_NOT_ON_RIGHT');
  for (let index = 1; index < trend.length; index += 1) {
    if (trend[index - 1].date > trend[index].date) throw new Error('TREND_DATE_ORDER_INVALID');
  }
  return trend;
}

function miniTrend(label, value, state = {}) {
  return trendChars(getMetricTrend(label, state.reportDate || '', 7, state, value));
}

export function trendChars(trend = []) {
  const numeric = trend.filter(item => item?.hasData).map(item => Number(item.value || 0));
  const max = Math.max(1, ...numeric.map(v => Math.abs(v)));
  const levels = ['▁', '▂', '▃', '▄', '▅', '▆', '▇'];
  return trend.map(item => !item?.hasData
    ? '·'
    : levels[Math.max(0, Math.min(levels.length - 1, Math.round((Math.abs(Number(item.value || 0)) / max) * (levels.length - 1))))]
  ).join('');
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function shiftDateKey(value, offset) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Number(offset || 0)));
  return date.toISOString().slice(0, 10);
}

function phnomPenhDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function historyMetricValue(label, summary = {}) {
  if (summary.metrics && Object.prototype.hasOwnProperty.call(summary.metrics, label)) return summary.metrics[label];
  const aliases = {
    总件数: ['日报总件数', '今日PNH'],
    已签收: ['今日POD'],
    签收率: ['POD率', '首投POD率'],
    'Pending1+': ['Pending1次', 'Pending 1次'],
    'Pending2+': ['Pending2次', 'Pending 2次'],
    'Pending3+': ['Pending3次以上', 'Pending 3次及以上'],
    'OC1+': ['OC1天', 'OC 1天'],
    'OC2+': ['OC2天', 'OC 2天'],
    'OC3+': ['OC3天以上', 'OC 3天及以上'],
    入库无扫描: ['入库无扫描节点'],
    工单未处理: ['工单异常']
  };
  if (summary.metrics && aliases[label]) {
    for (const key of aliases[label]) {
      if (Object.prototype.hasOwnProperty.call(summary.metrics, key)) return summary.metrics[key];
    }
  }
  const aggregateGroups = CRITICAL_AGGREGATE_KEYS[label];
  if (aggregateGroups?.length && summary.metrics) {
    for (const keys of aggregateGroups) {
      const values = keys.map(key => summary.metrics[key]).filter(value => value !== null && value !== undefined && value !== '');
      if (values.length) return values.reduce((sum, value) => sum + parseMetricNumber(value), 0);
    }
  }
  const legacyCriticalLabel = CRITICAL_METRIC_LABELS[label];
  if (legacyCriticalLabel && summary.metrics && Object.prototype.hasOwnProperty.call(summary.metrics, legacyCriticalLabel)) {
    return summary.metrics[legacyCriticalLabel];
  }
  const byLabel = {
    总件数: summary.totalMonitored ?? summary.scanPool ?? summary.scanTotal,
    首投POD率: summary.podRate ?? summary.firstPodRate,
    异常率: summary.abnormalRate,
    严重异常总件数: summary.severeCount,
    今日PNH: summary.today ?? summary.pnh ?? summary.todayPnh,
    今日POD: summary.scanPod ?? summary.todayPod,
    首投POD率: summary.podRateText ?? summary.podRate,
    今日妥投率: summary.podRateText ?? summary.podRate,
    跨日遗留: summary.carry,
    明日继续监控: summary.nextCarry,
    Pending率: summary.pendingRateText ?? summary.pendingRate,
    OC率: summary.ocRateText ?? summary.ocRate,
    派送停留率: summary.deliveryRateText ?? summary.deliveryRate,
    入库无扫描节点: summary.inboundNoScan,
    工单未完结率: summary.openRateText ?? summary.openRate,
    延迟POD: summary.delayedPod
  };
  if (Object.prototype.hasOwnProperty.call(byLabel, label)) return byLabel[label];
  const compact = String(label || '').replace(/[^\w\u4e00-\u9fa5]/g, '');
  return summary[compact] ?? summary[label] ?? null;
}

function previousComparison(metricKey, currentValue, state = {}, isRate = false) {
  const trend = getMetricTrend(metricKey, state.reportDate || '', 2, state, currentValue);
  const previous = trend[0];
  if (!previous?.hasData) return { text: '暂无昨日数据', direction: 'flat', delta: null };
  const current = parseMetricNumber(currentValue);
  const prior = parseMetricNumber(previous.value);
  const delta = isRate ? current - prior : (prior ? ((current - prior) / Math.abs(prior)) * 100 : (current ? 100 : 0));
  return {
    text: `较昨日 ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`,
    direction: delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat'),
    delta
  };
}

function historyMetricStatus(label, summary = {}) {
  return summary?.metricStatuses?.[label]
    || summary?.metricsStatus?.[label]
    || '';
}

function trendStatus(metricKey, status, value) {
  const key = String(metricKey || '');
  if (/总件数|今日PNH|今日POD/.test(key)) return 'volume';
  const text = String(status || '');
  if (/正常|一致/.test(text)) return 'normal';
  if (/重点|严重|异常|错误|失败/.test(text)) return 'danger';
  if (/关注|跟进|警告/.test(text)) return 'warning';
  return parseMetricNumber(value) > 0 ? 'warning' : 'normal';
}

const CRITICAL_METRIC_LABELS = {
  criticalOc2plus: 'OC 2天及以上',
  criticalCycle2plus: '盘点 2天及以上',
  criticalShopStuck2: '门店滞留',
  criticalShopTransit2: '门店途中2天以上',
  criticalShopInbound2: '门店入库后2天以上无新动作',
  criticalShopInbound3: '门店入库后3天以上未POD',
  criticalTbkhTransit2: 'TBKH门店途中2天以上',
  criticalTbkhInbound2: 'TBKH门店入库后2天以上无动作',
  criticalOc2: 'OC 2天',
  criticalOc3: 'OC 3天以上',
  criticalPending3: 'Pending 3次以上',
  criticalPendingConsecutive3: 'Pending连续3天以上',
  criticalPendingImage: 'Pending图片异常 / 无有效图片证据',
  criticalCycle2: '盘点 2天',
  criticalCycle3: '盘点 3天以上',
  criticalDelivery2: '派送停留 2天',
  criticalDelivery3: '派送停留 3天以上',
  criticalNode2: '节点未更新 2天',
  criticalNode3: '节点未更新 3天以上',
  criticalInboundNoScan: '入库无扫描节点',
  criticalWorkOrder: '工单异常 / 工单未完结'
};

const CRITICAL_AGGREGATE_KEYS = {
  criticalOc2plus: [['criticalOc2', 'criticalOc3'], ['OC 2天', 'OC 3天以上']],
  criticalCycle2plus: [['criticalCycle2', 'criticalCycle3'], ['盘点 2天', '盘点 3天以上']],
  criticalShopStuck2: [['门店滞留']]
};

function criticalDef(key, label, rows, detailTab, daysOf, severe = false, escalateAt3 = false) {
  return { key, label, rows: uniqueRows(rows), detailTab, daysOf, severe, escalateAt3 };
}

function criticalRow(def, state) {
  const longest = Math.max(0, ...def.rows.map(row => Number(def.daysOf?.(row) || 0)));
  const severe = def.severe || (def.escalateAt3 && def.rows.some(row => Number(def.daysOf?.(row) || 0) >= 3));
  const latest = [...def.rows]
    .sort((a, b) => String(b?.最后节点时间 || b?.最后时间 || '').localeCompare(String(a?.最后节点时间 || a?.最后时间 || '')))[0];
  const trend = getMetricTrend(def.key, state.reportDate || '', 7, state, def.rows.length, severe ? '严重异常' : '需跟进');
  return {
    metricKey: def.key,
    严重等级: severe ? '严重异常' : '需跟进',
    异常类型: def.label,
    数量: def.rows.length,
    最长滞留: longest ? `${longest}天` : '-',
    指标说明: CRITICAL_NOTES[def.key] || '',
    最近节点: latest ? `${latest?.最后节点时间 || latest?.最后时间 || ''} ${latest?.最后节点 || latest?.异常分类 || ''}`.trim() : '-',
    迷你走势: trendChars(trend),
    迷你走势数据: trend,
    明细Tab: def.key,
    目标明细Tab: def.detailTab
  };
}

const CRITICAL_NOTES = {
  criticalOc2plus: '连续2天及以上返仓后仍未闭环',
  criticalCycle2plus: '连续停留在盘点环节2天及以上',
  criticalShopStuck2: '到达门店后2天及以上未POD/未流转',
  criticalInboundNoScan: '已入库但没有有效派送/Pending/OC/盘点动作',
  criticalShopTransit2: '发往CP白名单门店后2天及以上仍未入库'
};

function uniqueRows(rows = []) {
  const byBill = new Map();
  for (const row of rows || []) {
    const bill = billOf(row);
    if (bill && !byBill.has(bill)) byBill.set(bill, row);
  }
  return [...byBill.values()];
}

function longestRiskDays(row = {}) {
  return Math.max(
    countOf(row, 'Pending次数', 'Pending天数'),
    countOf(row, 'OC天数'),
    countOf(row, '盘点天数', '盘点次数'),
    countOf(row, '派送中天数', '派件中天数'),
    staleDays(row),
    shopDays(row)
  );
}
