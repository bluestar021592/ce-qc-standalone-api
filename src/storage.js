import { createDatabaseBackup } from './backup.js';
import { loadAppState, resetAppState, saveAppState } from './store.js';

// Do not initialize or materialize persisted app_state during module import.
// Large historical installations can contain a very large legacy valueJson;
// reading it before Express starts listening can make the launcher believe the
// backend is dead. loadAppState() already initializes the store lazily when a
// request actually needs the full mutable state.

export async function loadState() {
  return normalizeState(loadAppState());
}

export async function saveState(state, options = {}) {
  // Runtime CE API rows can contain photos, attachments, nested raw responses or
  // other very large values. The business rules only need the normalized fields
  // already copied onto each scan/event/final row. Persist a bounded checkpoint
  // representation so a completed scan batch cannot fail with V8
  // "Invalid string length" while JSON.stringify-ing the whole app state.
  //
  // V149 separates persistence responsibilities:
  // - full (default): immutable/final business data + current state
  // - import: current daily membership only; historical carry is not rewritten
  // - state-only: crash-resume JSON only; normalized tables are left untouched
  // This prevents every progress/checkpoint message from re-writing the whole day.
  const normalized = normalizeState(state);
  if (state && typeof state === 'object') {
    state.finalRows = normalized.finalRows;
    state.finalDiversionRows = normalized.finalDiversionRows;
  }
  const mode = String(options.mode || 'full').toLowerCase();
  const mirror = options.mirror === false || mode === 'state-only' ? false : true;
  saveAppState(compactStateForPersistence(normalized), { mirror, mirrorMode: mode });
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
  const finalRows = dedupeRowsByBill(Array.isArray(s.finalRows) ? s.finalRows : []);
  const nextCarryBills = cleanMainBills(s.nextCarryBills || s.carryBills || []);

  return {
    reportDate: s.reportDate || '',
    sourceName: s.sourceName || '',
    dailyReportReady: Boolean(s.dailyReportReady || (s.reportDate && (s.pnhBills || []).length)),
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
    scanQueryStatus: normalizeRows(s.scanQueryStatus),
    scanRetryBills: cleanMainBills(s.scanRetryBills || []),
    needTrackBills: cleanMainBills(s.needTrackBills || []),
    trackEvents: normalizeRows(s.trackEvents),
    trackResults: normalizeRows(s.trackResults),
    trackQueryStatus: normalizeRows(s.trackQueryStatus),
    finalRows,
    nextCarryBills,
    finalDiversionRows: dedupeRowsByBill(normalizeRows(s.finalDiversionRows)),
    priorCarryRows: normalizeRows(s.priorCarryRows),
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

function dedupeRowsByBill(rows = []) {
  const output = [];
  const positionByBill = new Map();
  for (const row of rows || []) {
    const bill = rowBill(row);
    if (!bill) {
      output.push(row);
      continue;
    }
    if (positionByBill.has(bill)) {
      output[positionByBill.get(bill)] = row;
      continue;
    }
    positionByBill.set(bill, output.length);
    output.push(row);
  }
  return output;
}

function rowBill(row = {}) {
  return String(row?.运单号 || row?.shipmentCode || row?.waybill || row?.billNo || '').trim().toUpperCase();
}

function compactStateForPersistence(state = {}) {
  const summary = state.dailyParseSummary || state.daily?.summary || null;
  const compactDaily = state.daily ? {
    reportDate: state.reportDate || state.daily?.reportDate || '',
    sourceName: state.sourceName || state.daily?.sourceName || '',
    importedAt: state.daily?.importedAt || summary?.importedAt || '',
    summary: sanitizeValue(summary)
  } : null;
  return {
    ...state,
    daily: compactDaily,
    dailyParseSummary: sanitizeValue(state.dailyParseSummary),
    dailyParseRows: sanitizeRows(state.dailyParseRows),
    scanResults: sanitizeRows(state.scanResults),
    scanQueryStatus: sanitizeRows(state.scanQueryStatus),
    trackEvents: sanitizeRows(state.trackEvents),
    trackResults: sanitizeRows(state.trackResults),
    trackQueryStatus: sanitizeRows(state.trackQueryStatus),
    finalRows: sanitizeRows(state.finalRows),
    priorCarryRows: sanitizeRows(state.priorCarryRows),
    finalDiversionRows: sanitizeRows(state.finalDiversionRows),
    historySummary: sanitizeRows(state.historySummary),
    logs: (state.logs || []).map(value => truncateString(value, 4000)).slice(-300),
    backupSummary: sanitizeValue(state.backupSummary),
    lastRunSummary: sanitizeValue(state.lastRunSummary),
    lastRun: sanitizeValue(state.lastRun)
  };
}

function sanitizeRows(rows) {
  return Array.isArray(rows) ? rows.map(row => sanitizeValue(row)) : [];
}

function sanitizeValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return truncateString(value, 16000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 6) return Array.isArray(value) ? `[ARRAY:${value.length}]` : '[OBJECT]';
  if (Array.isArray(value)) return value.slice(0, 5000).map(item => sanitizeValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:raw|rawJson|rawData|response|request|payload|events|trackEvents|exceptionItems|scanRaw|fileData|base64|image|images|photo|photos|attachment|attachments|signature|signatures)$/i.test(key)) continue;
    result[key] = sanitizeValue(item, depth + 1);
  }
  return result;
}

function truncateString(value, limit) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}...[TRUNCATED ${text.length - limit}]` : text;
}