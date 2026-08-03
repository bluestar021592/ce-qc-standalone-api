const BILL_RE = /\b(?:TBKH[0-9A-Z]{6,}|CC[0-9A-Z]{6,}|KH[0-9A-Z]{8,}|SPE[0-9A-Z]{3,}|WHPP[0-9A-Z]{3,})\b/gi;

export function parseLongBackupLight(pack, options = {}) {
  const businessType = String(options.businessType || 'CCSL').toUpperCase();
  const carryCandidates = new Set();
  const podLocks = new Set();
  const excluded = new Set();

  const addCarry = (wb, context = '') => addCandidate(carryCandidates, excluded, wb, context, businessType);
  const addPod = (wb, context = '') => addCandidate(podLocks, excluded, wb, context, businessType);

  const state = pack?.state || pack?.currentState || pack || {};

  readBillList(pack?.carryBills, businessType).forEach(addCarry);
  readBillList(pack?.nextCarryBills, businessType).forEach(addCarry);
  readBillList(pack?.podLocks, businessType).forEach(addPod);
  readBillList(state.carryBills, businessType).forEach(addCarry);
  readBillList(state.nextCarryBills, businessType).forEach(addCarry);
  readBillList(state.oldCarryBills, businessType).forEach(addCarry);
  readBillList(state.podLocks, businessType).forEach(addPod);
  readBillList(state.podLockBills, businessType).forEach(addPod);

  scanLocalData(pack?.localData, addCarry, addPod);
  const scannedHistoryRows =
    scanRowsLight(state.restoredDetailRows, addCarry, addPod)
    + scanRowsLight(state.finalRows, addCarry, addPod)
    + scanRowsLight(state.trackResults, addCarry, addPod)
    + scanRowsLight(state.scanResults, addCarry, addPod);

  const filteredPod = [...carryCandidates].filter(wb => podLocks.has(wb));
  const carryBills = [...carryCandidates].filter(wb => !podLocks.has(wb)).sort();
  const podLockBills = [...podLocks].sort();
  const carrySet = new Set(carryBills);
  const carryRows = readCarryRows(pack?.carryRows, carrySet, businessType);

  return {
    carryBills,
    carryRows,
    podLocks: podLockBills,
    historySummary: readHistorySummary(pack),
    summary: {
      carry: carryBills.length,
      podLocks: podLockBills.length,
      filteredPod: filteredPod.length,
      excluded: excluded.size,
      carryCandidates: carryCandidates.size,
      scannedHistoryRows,
      mode: 'light'
    }
  };
}

function readCarryRows(rows, carrySet, businessType) {
  if (businessType !== 'SHOPEE' || !Array.isArray(rows)) return [];
  const output = new Map();
  for (const row of rows) {
    const shipmentCode = normalizeBill(row?.shipmentCode || row?.运单号);
    if (!shipmentCode || !carrySet.has(shipmentCode)) continue;
    const rawGroup = String(row?.recipient_group || row?.recipientGroup || '').trim().toUpperCase();
    output.set(shipmentCode, {
      shipmentCode,
      recipient_raw: String(row?.recipient_raw || ''),
      recipient_normalized: String(row?.recipient_normalized || ''),
      recipient_group: ['CN', 'VN'].includes(rawGroup) ? rawGroup : 'OTHER',
      recipient_group_reason: String(row?.recipient_group_reason || 'RECOVERED_CARRY_METADATA'),
      source_row_number: Number(row?.source_row_number || row?.rowNumber || 0),
      sourceDate: String(row?.sourceDate || row?.reportDate || ''),
      primaryCategory: String(row?.primaryCategory || row?.异常分类 || ''),
      latestEventTime: String(row?.latestEventTime || row?.最后节点时间 || ''),
      latestEventDesc: String(row?.latestEventDesc || row?.最后节点 || ''),
      查询状态: String(row?.查询状态 || ''),
      API状态: String(row?.API状态 || '')
    });
  }
  return [...output.values()];
}

export function parseLongBackupModules(pack = {}) {
  if (pack?.modules && typeof pack.modules === 'object') {
    return {
      schemaVersion: Number(pack.schemaVersion || 2),
      CCSL: parseLongBackupLight(pack.modules.CCSL || {}, { businessType: 'CCSL' }),
      SHOPEE: parseLongBackupLight(pack.modules.SHOPEE || {}, { businessType: 'SHOPEE' })
    };
  }
  return {
    schemaVersion: 1,
    CCSL: parseLongBackupLight(pack, { businessType: 'CCSL' }),
    SHOPEE: parseLongBackupLight({}, { businessType: 'SHOPEE' })
  };
}

function addCandidate(target, excluded, value, context = '', businessType = 'CCSL') {
  const bill = normalizeBill(value);
  if (!bill) return;
  if (businessType === 'CCSL' && shouldExclude(bill, context)) {
    excluded.add(bill);
    target.delete(bill);
    return;
  }
  if (!excluded.has(bill)) target.add(bill);
}

function readBillList(value, businessType = 'CCSL') {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(item => readBillList(item, businessType));
  if (typeof value === 'object') {
    const direct = value.shipmentCode || value.waybill || value.billNo || value.运单号 || '';
    if (direct) return [direct];
    return [];
  }
  const text = String(value);
  if (businessType === 'SHOPEE') {
    const candidates = text.split(/[\s,;]+/).map(normalizeBill).filter(value => /^(?=.*\d)[A-Z0-9_-]{6,}$/.test(value));
    return candidates.length ? candidates : [];
  }
  return extractWaybills(text);
}

function scanLocalData(localData, addCarry, addPod) {
  if (!localData || typeof localData !== 'object') return;
  for (const [key, value] of Object.entries(localData)) {
    const text = stringifySmall(value);
    if (/POD.*LOCK|POD_CLOSED|PODLOCK/i.test(key)) extractWaybills(text).forEach(wb => addPod(wb, key));
    if (/CARRY|CARRYOVER|NEXT|跨日|遗留/i.test(key)) extractWaybills(text).forEach(wb => addCarry(wb, key));
  }
}

function scanRowsLight(rows, addCarry, addPod) {
  if (!Array.isArray(rows)) return 0;
  let scanned = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    scanned += 1;
    const bill = row.运单号 || row.shipmentCode || row.waybill || row.billNo || '';
    if (!bill) continue;
    const text = [
      row.来源类型,
      row.扫描来源,
      row.扫描分类,
      row.是否POD,
      row.异常分类,
      row.QC判断,
      row.扫描摘要,
      row.最后节点,
      row.orderStatus,
      row.status
    ].map(x => String(x || '')).join(' ');
    if (String(row.orderStatus ?? '').trim() === '85') addPod(bill, text);
    else if (/已签收|POD闭环|POD|签收成功|已POD|DELIVERED|orderStatus.?85/i.test(text)) addPod(bill, text);
    else if (/跨日|明日继续|carry|遗留|继续跟进|未闭环/i.test(text)) addCarry(bill, text);
  }
  return scanned;
}

function extractWaybills(text) {
  return [...String(text || '').matchAll(BILL_RE)].map(match => normalizeBill(match[0])).filter(Boolean);
}

function normalizeBill(value) {
  return String(value || '').trim().toUpperCase();
}

function shouldExclude(bill, context = '') {
  return /^SPE/i.test(bill) || /^WHPP/i.test(bill) || /WHPP/i.test(String(context || ''));
}

function stringifySmall(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value || '');
  } catch {
    return '';
  }
}

function readHistorySummary(pack = {}) {
  const candidates = [
    pack.historySummary,
    pack.state?.historySummary,
    pack.currentState?.historySummary
  ];
  const list = candidates.find(Array.isArray) || [];
  return list.slice(-30).map(item => ({
    reportDate: item?.reportDate || item?.date || '',
    summary: item?.summary || item?.finalSummary || item || {}
  }));
}
