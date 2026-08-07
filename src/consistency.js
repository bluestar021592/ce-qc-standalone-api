import { getXlsxSheetRows, safeFinalRows } from './reporting.js';
import { cleanMainBills, isExcludedBill } from './storage.js';

export function buildConsistencyReport(state = {}) {
  const warnings = [];
  const errors = [];
  const info = [];
  const sheets = getXlsxSheetRows(state);
  const finalRows = safeFinalRows(state);
  const podSet = new Set(cleanMainBills(state.podLocks || []));

  const abnormalCount = sheets.abnormalOpen.length;
  const pageAbnormalCount = (state.detailTabs?.abnormalOpen?.total ?? abnormalCount);
  if (pageAbnormalCount !== abnormalCount) {
    warnings.push(`页面异常未闭环数量 ${pageAbnormalCount} 与导出数量 ${abnormalCount} 不一致`);
  }

  const nextCarryBills = new Set(sheets.nextCarry.map(row => billOf(row)).filter(Boolean));
  for (const wb of nextCarryBills) {
    if (podSet.has(wb)) errors.push(`POD锁单号进入明日继续：${wb}`);
    if (isExcludedBill(wb)) errors.push(`SPE/WHPP单号进入明日继续：${wb}`);
  }

  for (const row of finalRows) {
    const wb = billOf(row);
    if (!wb) {
      errors.push('最终结果存在空shipmentCode');
      continue;
    }
    if (row?.是否POD !== '是' && podSet.has(wb)) errors.push(`POD锁单号进入异常结果：${wb}`);
    if (isExcludedBill(wb)) errors.push(`SPE/WHPP单号进入最终结果：${wb}`);
    if (isInboundNoScan(row) && isShopRow(row)) errors.push(`门店链路误入入库无扫描：${wb}`);
    if (isInboundNoScan(row) && hasRecognizedAction(row)) errors.push(`已有有效动作的单号误入入库无扫描：${wb}`);
  }

  const abnormalBills = new Set(sheets.abnormalOpen.map(row => billOf(row)).filter(Boolean));
  for (const row of finalRows.filter(isNormalFinalHub)) {
    const wb = billOf(row);
    if (abnormalBills.has(wb)) errors.push(`正常分流单号进入异常：${wb}`);
    if (nextCarryBills.has(wb)) errors.push(`正常分流单号进入明日续查：${wb}`);
  }

  if (state.reportDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(state.reportDate))) {
    errors.push(`reportDate格式无效：${state.reportDate}`);
  }

  checkDuplicate(state.scanResults || [], '扫描结果', warnings);
  checkDuplicate(state.finalRows || [], '最终结果', errors);

  info.push(`日报PNH：${(state.pnhBills || []).length}`);
  info.push(`扫描结果：${(state.scanResults || []).length}`);
  info.push(`轨迹节点：${(state.trackEvents || []).length}`);
  info.push(`最终结果过滤后：${finalRows.length}`);
  info.push(`XLSX异常未闭环：${abnormalCount}`);
  info.push(`明日继续跨日：${sheets.nextCarry.length}`);

  return {
    status: errors.length ? 'error' : (warnings.length ? 'warning' : 'ok'),
    errors,
    warnings,
    info,
    counts: {
      pnh: (state.pnhBills || []).length,
      scanResults: (state.scanResults || []).length,
      trackEvents: (state.trackEvents || []).length,
      finalRowsRaw: (state.finalRows || []).length,
      finalRowsFiltered: finalRows.length,
      abnormalOpen: abnormalCount,
      nextCarry: sheets.nextCarry.length,
      podLocks: (state.podLocks || []).length
    }
  };
}

function checkDuplicate(rows, label, warnings) {
  const seen = new Set();
  for (const row of rows || []) {
    const wb = billOf(row);
    if (!wb) continue;
    if (seen.has(wb)) warnings.push(`${label}存在重复运单号：${wb}`);
    seen.add(wb);
  }
}

function billOf(row) {
  return String(row?.运单号 || row?.shipmentCode || row?.waybill || row?.billNo || '').trim().toUpperCase();
}

function isInboundNoScan(row = {}) {
  return row?.异常分类 === '入库无扫描'
    || row?.primaryCategory === '入库无扫描'
    || row?.matchedRule === 'INBOUND_WITHOUT_DELIVERY_SCAN';
}

function isShopRow(row = {}) {
  return row?.是否门店 === '是'
    || row?.是否门店链路 === '是'
    || Boolean(row?.门店编码 || row?.matchedShopCode || row?.门店状态);
}

function hasRecognizedAction(row = {}) {
  const latestAction = String(row?.lastEventActionType || row?.最后节点动作类型 || '').toUpperCase();
  const category = String(row?.primaryCategory || row?.异常分类 || '');
  const special = String(row?.specialState || '');
  // Any recognized action after the first CCSL inbound invalidates inbound-no-scan,
  // even if a later duplicate inbound becomes the latest raw event.
  return latestAction === 'OUTBOUND'
    || Boolean(special)
    || isShopRow(row)
    || /POD|退回|Pending|OC|盘点|派件|派送|转运|门店|自提|CECN|CEZT|580/.test(category);
}

function isNormalFinalHub(row = {}) {
  return row?.异常分类 === '正常分流节点'
    || row?.primaryCategory === '正常分流节点'
    || row?.matchedRule === 'NORMAL_FINAL_HUB';
}
