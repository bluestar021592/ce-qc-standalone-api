import { isWhppCancelledRow } from './whppAnalyzer.js';

/**
 * WHPP is a single local-business board. It follows the same operational KPI
 * semantics as Shopee but does not use Shopee CN/VN recipient groups.
 * Accounting buckets are mutually exclusive:
 * total = POD + returned + cancelled + normal special destinations + unresolved.
 */
export function buildWhppDashboard(state = {}) {
  const rows = uniqueRows(state.finalRows || []);
  const dailyRows = buildDailyRows(state, rows);
  const monitorRows = rows;
  const podRows = dailyRows.filter(isPod);
  const returnedRows = dailyRows.filter(row => !isPod(row) && isReturned(row));
  const cancelledRows = dailyRows.filter(row => !isPod(row) && !isReturned(row) && isWhppCancelledRow(row));
  const unresolvedRows = dailyRows.filter(row => !isPod(row) && !isReturned(row) && !isWhppCancelledRow(row) && !isNormalDiversion(row));
  const normalDiversionRows = dailyRows.filter(row => !isPod(row) && !isReturned(row) && !isWhppCancelledRow(row) && isNormalDiversion(row));
  const ccsl580Rows = normalDiversionRows.filter(row => ['CCSL580_RETENTION','CCSL580_DIVERSION'].includes(specialOf(row)));

  const actionable = monitorRows.filter(row => !isPod(row) && !isReturned(row) && !isWhppCancelledRow(row) && !isNormalDiversion(row));
  const metrics = {
    total: dailyRows.length,
    pod: podRows.length,
    podRate: rate(podRows.length, dailyRows.length),
    returned: returnedRows.length,
    returnRate: rate(returnedRows.length, dailyRows.length),
    cancelled: cancelledRows.length,
    cancelRate: rate(cancelledRows.length, dailyRows.length),
    unresolved: unresolvedRows.length,
    normalDiversion: normalDiversionRows.length,
    accounted: podRows.length + returnedRows.length + cancelledRows.length + unresolvedRows.length + normalDiversionRows.length,
    accountingDifference: dailyRows.length - podRows.length - returnedRows.length - cancelledRows.length - unresolvedRows.length - normalDiversionRows.length,
    pending1: actionable.filter(row => pendingDays(row) >= 1).length,
    pending2: actionable.filter(row => pendingDays(row) >= 2).length,
    pending3: actionable.filter(row => pendingDays(row) >= 3).length,
    pendingNonContinuous: actionable.filter(row => row.Pending不连续 === '是' || row.Pending连续性 === '不连续').length,
    oc1: actionable.filter(row => Number(row.OC天数 || 0) >= 1).length,
    oc2: actionable.filter(row => Number(row.OC天数 || 0) >= 2).length,
    oc3: actionable.filter(row => Number(row.OC天数 || 0) >= 3).length,
    cycle2: actionable.filter(row => Number(row.盘点天数 || 0) >= 2).length,
    inboundNoScan: actionable.filter(row => row.入库无扫描节点 === '是' || categoryOf(row).includes('入库无扫描')).length,
    delivery: actionable.filter(row => Number(row.派送中停留天数 || row.派送中天数 || 0) > 0 || /派送中/.test(categoryOf(row))).length,
    workOrder: actionable.filter(row => /工单/.test(categoryOf(row))).length,
    ccslCnDiversion: normalDiversionRows.filter(row => specialOf(row) === 'CCSLCN_DIVERSION').length,
    ccslZtDiversion: normalDiversionRows.filter(row => specialOf(row) === 'CCSLZT_DIVERSION').length,
    // CEL:CCSL580 is the dedicated 580 retention destination. The old
    // ccsl580Diversion key is retained only as a compatibility alias.
    ccsl580Retention: ccsl580Rows.length,
    ccsl580Diversion: ccsl580Rows.length,
    phnomPenhShop: monitorRows.filter(row => ['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(row.shopState || ''))).length,
    phnomPenhShopTransit: monitorRows.filter(row => row.shopState === 'SHOP_TRANSFER_IN_PROGRESS').length,
    phnomPenhShopArrived: monitorRows.filter(row => row.shopState === 'SHOP_ARRIVED_CURRENT').length,
    dispatchAttempt1: podRows.filter(row => dispatchDayNo(row) === 1).length,
    dispatchAttempt2: podRows.filter(row => dispatchDayNo(row) === 2).length,
    dispatchAttempt3: podRows.filter(row => dispatchDayNo(row) >= 3).length
  };
  metrics.dispatchAttempt1Rate = rate(metrics.dispatchAttempt1, metrics.total);
  metrics.dispatchAttempt2Rate = rate(metrics.dispatchAttempt2, metrics.total);
  metrics.dispatchAttempt3Rate = rate(metrics.dispatchAttempt3, metrics.total);
  metrics.firstAttemptRate = metrics.dispatchAttempt1Rate;

  const regions = {
    PP: buildRegion('PP', dailyRows, monitorRows),
    PV: buildRegion('PV', dailyRows, monitorRows),
    UNKNOWN: buildRegion('UNKNOWN', dailyRows, monitorRows)
  };

  const detailTabs = {
    all: tab('WHPP本土全部', dailyRows),
    pod: tab('今日POD', podRows),
    returned: tab('已退回件', returnedRows),
    cancelled: tab('订单取消', cancelledRows),
    unresolved: tab('当前未闭环', unresolvedRows),
    normalDiversion: tab('正常分流', normalDiversionRows),
    pending1: tab('Pending1+', actionable.filter(row => pendingDays(row) >= 1)),
    pending2: tab('Pending2+', actionable.filter(row => pendingDays(row) >= 2)),
    pending3: tab('Pending3+', actionable.filter(row => pendingDays(row) >= 3)),
    pendingNonContinuous: tab('Pending不连续', actionable.filter(row => row.Pending不连续 === '是' || row.Pending连续性 === '不连续')),
    oc1: tab('OC1+', actionable.filter(row => Number(row.OC天数 || 0) >= 1)),
    oc2: tab('OC2+', actionable.filter(row => Number(row.OC天数 || 0) >= 2)),
    oc3: tab('OC3+', actionable.filter(row => Number(row.OC天数 || 0) >= 3)),
    cycle2: tab('盘点2天+', actionable.filter(row => Number(row.盘点天数 || 0) >= 2)),
    inboundNoScan: tab('入库无扫描', actionable.filter(row => row.入库无扫描节点 === '是' || categoryOf(row).includes('入库无扫描'))),
    delivery: tab('派送中', actionable.filter(row => Number(row.派送中停留天数 || row.派送中天数 || 0) > 0 || /派送中/.test(categoryOf(row)))),
    workOrder: tab('工单', actionable.filter(row => /工单/.test(categoryOf(row)))),
    ccslCnDiversion: tab('CCSLCN分流', normalDiversionRows.filter(row => specialOf(row) === 'CCSLCN_DIVERSION')),
    ccslZtDiversion: tab('CCSLZT分流', normalDiversionRows.filter(row => specialOf(row) === 'CCSLZT_DIVERSION')),
    ccsl580Retention: tab('580滞留包裹', ccsl580Rows),
    ccsl580Diversion: tab('580滞留包裹', ccsl580Rows),
    phnomPenhShop: tab('金边门店', monitorRows.filter(row => ['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(row.shopState || '')))),
    attempt1: tab('1派POD', podRows.filter(row => dispatchDayNo(row) === 1)),
    attempt2: tab('2派POD', podRows.filter(row => dispatchDayNo(row) === 2)),
    attempt3: tab('3派及以上POD', podRows.filter(row => dispatchDayNo(row) >= 3)),
    pp: tab('本省PP', dailyRows.filter(row => regionOf(row) === 'PP')),
    pv: tab('外省PV', dailyRows.filter(row => regionOf(row) === 'PV'))
  };

  return {
    businessType: 'WHPP',
    reportDate: state.reportDate || '',
    snapshotId: state.snapshotId || '',
    metrics,
    regions,
    detailTabs,
    accounting: {
      total: metrics.total,
      pod: metrics.pod,
      returned: metrics.returned,
      cancelled: metrics.cancelled,
      normalDiversion: metrics.normalDiversion,
      unresolved: metrics.unresolved,
      accounted: metrics.accounted,
      difference: metrics.accountingDifference,
      balanced: metrics.accountingDifference === 0
    }
  };
}

function buildDailyRows(state, finalRows) {
  const byBill = new Map(finalRows.map(row => [billOf(row), row]));
  const dailyByBill = new Map((state.dailyParseRows || []).map(row => [billOf(row), row]));
  return [...new Set((state.pnhBills || []).map(code => String(code || '').trim().toUpperCase()).filter(Boolean))].map(bill => ({
    ...(dailyByBill.get(bill) || {}),
    ...(byBill.get(bill) || {}),
    shipmentCode: bill,
    运单号: bill,
    businessType: 'WHPP',
    finalRowAvailable: Boolean(byBill.get(bill))
  }));
}

function buildRegion(code, dailyRows, monitorRows) {
  const daily = dailyRows.filter(row => regionOf(row) === code);
  const monitor = monitorRows.filter(row => regionOf(row) === code);
  const pod = daily.filter(isPod).length;
  const returned = daily.filter(row => !isPod(row) && isReturned(row)).length;
  const cancelled = daily.filter(row => !isPod(row) && !isReturned(row) && isWhppCancelledRow(row)).length;
  const open = daily.filter(row => !isPod(row) && !isReturned(row) && !isWhppCancelledRow(row) && !isNormalDiversion(row)).length;
  return {
    regionCode: code,
    total: daily.length,
    pod,
    podRate: rate(pod, daily.length),
    returned,
    cancelled,
    unresolved: open,
    pending1: monitor.filter(row => isActionable(row) && pendingDays(row) >= 1).length,
    pending2: monitor.filter(row => isActionable(row) && pendingDays(row) >= 2).length,
    pending3: monitor.filter(row => isActionable(row) && pendingDays(row) >= 3).length,
    oc1: monitor.filter(row => isActionable(row) && Number(row.OC天数 || 0) >= 1).length,
    oc2: monitor.filter(row => isActionable(row) && Number(row.OC天数 || 0) >= 2).length,
    oc3: monitor.filter(row => isActionable(row) && Number(row.OC天数 || 0) >= 3).length,
    phnomPenhShop: monitor.filter(row => ['SHOP_TRANSFER_IN_PROGRESS','SHOP_ARRIVED_CURRENT'].includes(String(row.shopState || ''))).length
  };
}

function isActionable(row) {
  return !isPod(row) && !isReturned(row) && !isWhppCancelledRow(row) && !isNormalDiversion(row);
}

function isNormalDiversion(row = {}) {
  const special = specialOf(row);
  return ['SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION'].includes(special)
    || row.primaryCategory === '正常分流节点'
    || row.matchedRule === 'NORMAL_FINAL_HUB';
}

function specialOf(row = {}) {
  return String(row.specialState || row.primaryCategory || row.主分类 || '').trim().toUpperCase();
}

function isPod(row = {}) {
  return row.是否POD === '是' || row.POD状态 === 'POD' || String(row.currentState || '').toUpperCase() === 'POD';
}

function isReturned(row = {}) {
  const state = String(row.currentState || '').toUpperCase();
  return row.退回状态 === '已退回' || ['RETURNED','RETURN_COMPLETED'].includes(state) || String(row.primaryCategory || row.主分类 || '') === '退回';
}

function pendingDays(row = {}) {
  return Number(row.Pending当前次数 ?? row.Pending次数 ?? row.pendingDistinctDayCount ?? 0) || 0;
}

function regionOf(row = {}) {
  const code = String(row.regionCode || row.区域 || '').toUpperCase();
  return code === 'PP' ? 'PP' : code === 'PV' ? 'PV' : 'UNKNOWN';
}

function dispatchDayNo(row = {}) {
  const explicit = Number(row.podAttemptNo || row.dispatchAttemptNo || 0);
  if (explicit > 0) return explicit;
  const reportDate = dateOnly(row.reportDate || row.日报日期 || '');
  const podDate = dateOnly(row.POD时间 || row.podTime || row.podClosedAt || row.terminalObservedAt || row.latestEventTime || row.最后节点时间 || '');
  if (!reportDate || !podDate) return 0;
  const days = Math.floor((Date.parse(`${podDate}T00:00:00Z`) - Date.parse(`${reportDate}T00:00:00Z`)) / 86400000) + 1;
  return days > 0 ? days : 0;
}

function dateOnly(value = '') {
  const match = String(value || '').match(/(20\d{2})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function categoryOf(row = {}) {
  return String(row.primaryCategory || row.主分类 || row.异常分类 || '');
}

function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}

function uniqueRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const bill = billOf(row);
    if (bill) map.set(bill, row);
  }
  return [...map.values()];
}

function tab(label, rows) {
  return { label, rows: uniqueRows(rows), total: uniqueRows(rows).length };
}

function rate(value, total) {
  return total ? Number((Number(value || 0) * 100 / Number(total)).toFixed(2)) : 0;
}
