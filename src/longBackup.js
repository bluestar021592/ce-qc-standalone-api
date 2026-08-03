import { cleanAnyBills, cleanMainBills } from './storage.js';

export function buildLongBackup(state = {}) {
  const historySummary = appendHistorySummary(state.historySummary || [], state.lastRunSummary || state.lastRun || null);
  return {
    type: 'CE_QC_STANDALONE_BACKUP',
    version: '1.0.0',
    exportTime: new Date().toISOString(),
    reportDate: state.reportDate || '',
    podLocks: cleanMainBills(state.podLocks || []),
    nextCarryBills: cleanMainBills(state.nextCarryBills || state.carryBills || []),
    finalSummary: state.lastRunSummary || state.lastRun || null,
    dailyParseSummary: state.dailyParseSummary || state.daily?.summary || null,
    lastRunSummary: state.lastRunSummary || state.lastRun || null,
    historySummary
  };
}

export function buildLongBackupV2(ccslState = {}, shopeeState = {}) {
  return {
    type: 'CE_QC_STANDALONE_BACKUP',
    schemaVersion: 2,
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    modules: {
      CCSL: moduleBackup(ccslState, 'CCSL'),
      SHOPEE: moduleBackup(shopeeState, 'SHOPEE')
    }
  };
}

export function appendHistorySummary(history = [], summary = null) {
  const list = Array.isArray(history) ? history : [];
  if (!summary) return list.slice(-30);
  const item = {
    reportDate: summary.reportDate || new Date().toISOString().slice(0, 10),
    summary,
    savedAt: new Date().toISOString()
  };
  const withoutSameDate = list.filter(row => row?.reportDate !== item.reportDate);
  return [...withoutSameDate, item].slice(-30);
}

export function mergeHistorySummary(current = [], imported = []) {
  const merged = [...(Array.isArray(current) ? current : []), ...(Array.isArray(imported) ? imported : [])];
  const byDate = new Map();
  for (const item of merged) {
    const key = item?.reportDate || item?.summary?.reportDate || item?.savedAt || String(byDate.size);
    byDate.set(key, item);
  }
  return [...byDate.values()]
    .sort((a, b) => String(a?.reportDate || '').localeCompare(String(b?.reportDate || '')))
    .slice(-30);
}

function moduleBackup(state, businessType) {
  const cleanBills = businessType === 'SHOPEE' ? cleanAnyBills : cleanMainBills;
  const historySummary = appendHistorySummary(state.historySummary || [], state.lastRunSummary || state.lastRun || null);
  const carryBills = cleanBills(state.nextCarryBills?.length ? state.nextCarryBills : (state.carryBills || []));
  const carrySet = new Set(carryBills);
  const carryRows = businessType === 'SHOPEE'
    ? lightweightCarryRows([...(state.priorCarryRows || []), ...(state.finalRows || [])], carrySet)
    : [];
  return {
    businessType,
    podLocks: cleanBills(state.podLocks || []),
    carryBills,
    carryRows,
    finalSummary: state.lastRunSummary || state.lastRun || null,
    dailyParseSummary: state.dailyParseSummary || state.daily?.summary || null,
    lastRunSummary: state.lastRunSummary || state.lastRun || null,
    historySummary
  };
}

function lightweightCarryRows(rows, carrySet) {
  const byBill = new Map();
  for (const row of rows || []) {
    const shipmentCode = String(row?.shipmentCode || row?.运单号 || '').trim().toUpperCase();
    if (!shipmentCode || !carrySet.has(shipmentCode)) continue;
    byBill.set(shipmentCode, {
      shipmentCode,
      recipient_raw: row.recipient_raw || '',
      recipient_normalized: row.recipient_normalized || '',
      recipient_group: ['CN', 'VN'].includes(String(row.recipient_group || '').toUpperCase()) ? String(row.recipient_group).toUpperCase() : 'OTHER',
      recipient_group_reason: row.recipient_group_reason || 'RECOVERED_CARRY_METADATA',
      source_row_number: Number(row.source_row_number || row.rowNumber || 0),
      sourceDate: row.sourceDate || row.reportDate || '',
      primaryCategory: row.primaryCategory || row.异常分类 || '',
      latestEventTime: row.latestEventTime || row.最后节点时间 || '',
      latestEventDesc: row.latestEventDesc || row.最后节点 || '',
      查询状态: row.查询状态 || '',
      API状态: row.API状态 || ''
    });
  }
  return [...byBill.values()];
}
