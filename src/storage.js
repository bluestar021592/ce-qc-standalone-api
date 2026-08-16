import { createDatabaseBackup } from './backup.js';
import { loadAppState, resetAppState, saveAppState } from './store.js';

// Do not initialize or materialize persisted app_state during module import.
// Large historical installations can contain a very large legacy valueJson;
// reading it before Express starts listening can make the launcher believe the
// backend is dead. loadAppState() already initializes the store lazily when a
// request actually needs the full mutable state.

const runtimeCheckpointSignatures = new Map();

export async function loadState() {
  return normalizeState(loadAppState());
}

export async function saveState(state, options = {}) {
  // V149 makes persistence intent explicit at the storage boundary even when an
  // older caller still invokes saveState() without options. Import, in-flight
  // checkpoint and final reconciliation no longer perform the same I/O.
  const normalized = normalizeState(state);
  if (state && typeof state === 'object') {
    state.finalRows = normalized.finalRows;
    state.finalDiversionRows = normalized.finalDiversionRows;
  }
  const mode = String(options.mode || inferPersistenceMode(normalized)).toLowerCase();
  const checkpointKey = checkpointIdentity(normalized);
  if (mode === 'checkpoint' && checkpointKey) {
    const signature = checkpointSignature(normalized);
    if (runtimeCheckpointSignatures.get(checkpointKey) === signature) return normalized;
    runtimeCheckpointSignatures.set(checkpointKey, signature);
  }
  if (mode === 'full' || mode === 'import') {
    for (const key of [...runtimeCheckpointSignatures.keys()]) {
      if (key.startsWith(`${normalized.reportDate || ''}|`)) runtimeCheckpointSignatures.delete(key);
    }
  }
  const mirror = options.mirror === false || mode === 'state-only' ? false : true;
  saveAppState(compactStateForPersistence(normalized), { mirror, mirrorMode: mode });
  return normalized;
}

function inferPersistenceMode(state = {}) {
  const processing = state.processing || {};
  const runStatus = String(state.lastRunSummary?.runStatus || state.currentRun?.status || '').toUpperCase();
  const phase = String(processing.phase || '').trim();
  if (/^(完成|COMPLETED)$/.test(phase) || runStatus === 'COMPLETED') return 'full';
  if (state.currentRun?.runId || state.lastRunSummary?.runId) {
    if (processing.running || processing.paused || processing.error || /RETRY|FAILED|RUNNING|PAUSED/.test(runStatus)) return 'checkpoint';
    if ((state.finalRows || []).length) return 'full';
  }
  if (state.dailyReportReady && (state.dailyParseRows || []).length && !(state.finalRows || []).length) return 'import';
  return 'full';
}

function checkpointIdentity(state = {}) {
  const runId = String(state.currentRun?.runId || state.lastRunSummary?.runId || state.lastRun?.runId || '').trim();
  return state.reportDate && runId ? `${state.reportDate}|${runId}` : '';
}

function checkpointSignature(state = {}) {
  const processing = state.processing || {};
  const scanStatus = statusCounts(state.scanQueryStatus, state.scanResults);
  const trackStatus = statusCounts(state.trackQueryStatus, state.trackResults);
  return JSON.stringify({
    phase: processing.phase || '',
    paused: Boolean(processing.paused),
    error: processing.error || '',
    scanDone: scanStatus.done,
    scanRetry: scanStatus.retry,
    scanObserved: scanStatus.observed,
    scanTotal: cleanMainBills(state.scanPool || []).length,
    trackDone: trackStatus.done,
    trackRetry: trackStatus.retry,
    trackObserved: trackStatus.observed,
    trackTotal: cleanMainBills(state.needTrackBills || []).length,
    finalRows: (state.finalRows || []).length,
    nextCarry: cleanMainBills(state.nextCarryBills || []).length,
    runStatus: state.lastRunSummary?.runStatus || ''
  });
}

function statusCounts(statusRows = [], fallbackRows = []) {
  const byBill = new Map();
  for (const row of statusRows || []) {
    const bill = rowBill(row);
    if (!bill) continue;
    byBill.set(bill, String(row.status || row.查询状态 || row.API状态 || '').toLowerCase());
  }
  if (!byBill.size) {
    for (const row of fallbackRows || []) {
      const bill = rowBill(row);
      if (!bill) continue;
      const text = String(row.查询状态 || row.API状态 || row.status || '').toLowerCase();
      byBill.set(bill, /failed|retry|失败|待重试/.test(text) ? 'failed' : 'success');
    }
  }
  let done = 0;
  let retry = 0;
  for (const status of byBill.values()) {
    if (/failed|retry|失败|待重试/.test(status)) retry += 1;
    else done += 1;
  }
  return { done, retry, observed: done + retry };
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
  runtimeCheckpointSignatures.clear();
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