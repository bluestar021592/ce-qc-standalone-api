import { createDatabaseBackup } from './backup.js';
import { initializeStore, loadAppState, resetAppState, saveAppState } from './store.js';

initializeStore();

export async function loadState() {
  return normalizeState(loadAppState());
}

export async function saveState(state) {
  saveAppState(normalizeState(state));
}

export async function resetState(confirmText = '') {
  if (String(confirmText || '').trim() !== '彻底清空') {
    throw new Error('请输入“彻底清空”完成二次确认。');
  }
  const backupFile = createDatabaseBackup('before-full-clear');
  if (!backupFile) throw new Error('清空前数据库备份失败，已停止清空。');
  const cleared = resetAppState(normalizeState({
    logs: [`已彻底清空全部业务数据；登录token和门店CP码保留。备份：${backupFile}`]
  }));
  return { backupFile, cleared, tokenPreserved: true, shopCodesPreserved: true };
}

export function normalizeState(s = {}) {
  const dailySummary = s.dailyParseSummary || s.daily?.summary || null;
  const dailyRows = Array.isArray(s.dailyParseRows) ? s.dailyParseRows : (Array.isArray(s.daily?.details) ? s.daily.details : []);
  const finalRows = Array.isArray(s.finalRows) ? s.finalRows : [];
  const nextCarryBills = cleanMainBills(s.nextCarryBills || s.carryBills || []);

  return {
    reportDate: s.reportDate || '',
    sourceName: s.sourceName || '',
    daily: s.daily || null,
    dailyParseSummary: dailySummary,
    dailyParseRows: dailyRows,
    pnhBills: cleanMainBills(s.pnhBills || []),
    nonPnhBills: cleanMainBills(s.nonPnhBills || []),
    excludedBills: cleanAnyBills(s.excludedBills || s.daily?.excludedBills || []),
    duplicateBills: cleanAnyBills(s.duplicateBills || s.daily?.duplicateBills || []),
    carryBills: cleanMainBills(s.carryBills || []),
    podLocks: cleanMainBills(s.podLocks || []),
    scanPool: cleanMainBills(s.scanPool || []),
    scanResults: normalizeRows(s.scanResults),
    needTrackBills: cleanMainBills(s.needTrackBills || []),
    trackEvents: normalizeRows(s.trackEvents),
    trackResults: normalizeRows(s.trackResults),
    finalRows,
    nextCarryBills,
    finalDiversionRows: normalizeRows(s.finalDiversionRows),
    backupImportedAt: s.backupImportedAt || '',
    backupSummary: s.backupSummary || null,
    historySummary: Array.isArray(s.historySummary) ? s.historySummary.slice(-30) : [],
    processing: s.processing || { running: false, paused: false, phase: '' },
    currentRun: s.currentRun || null,
    logs: Array.isArray(s.logs) ? s.logs.slice(-300) : [],
    lastRunSummary: s.lastRunSummary || s.lastRun || null,
    lastRun: s.lastRun || s.lastRunSummary || null
  };
}

export function cleanMainBills(list) {
  return cleanAnyBills(list).filter(wb => !isExcludedBill(wb));
}

export function cleanAnyBills(list) {
  return [...new Set((list || [])
    .map(x => String(x || '').trim().toUpperCase())
    .filter(Boolean))];
}

export function isExcludedBill(value) {
  const wb = String(value || '').trim().toUpperCase();
  return /^SPE/.test(wb) || /^WHPP/.test(wb) || /WHPP/.test(wb);
}

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}
