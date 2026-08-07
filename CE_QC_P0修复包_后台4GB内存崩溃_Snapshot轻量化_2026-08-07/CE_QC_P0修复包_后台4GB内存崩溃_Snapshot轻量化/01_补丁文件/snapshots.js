import { createHash, randomUUID } from 'crypto';

import { buildConsistencyReport } from './consistency.js';
import { getDb, nowIso } from './db.js';
import { buildCoreKpis, buildCriticalDashboard, buildDashboardData, buildDashboardRows, buildDetailTabs, getXlsxSheetRows } from './reporting.js';
import { buildSnapshotHashes } from './snapshotHash.js';
import { SHOP_WHITELIST_SOURCE_SHA256, SHOP_WHITELIST_VERSION } from './shopWhitelist.js';
import { analyzeShipment } from './analyzer.js';
import { getShopCodeMap } from './shopCodes.js';

export function createDashboardSnapshot(state = {}, context = {}) {
  const reportDate = String(context.reportDate || state.reportDate || '').trim();
  const runId = String(context.runId || resolveRunId(state, reportDate)).trim();
  if (!reportDate) throw snapshotError('REPORT_DATE_MISSING', '请先导入当日日报Excel。');
  if (!runId) throw snapshotError('RUN_CREATE_FAILED', '处理任务未正确创建，无法生成处理快照。');

  const existing = getSnapshot(reportDate, runId);
  if (existing) return existing;

  const snapshotId = `${reportDate}_${runId}_${randomUUID().slice(0, 8)}`;
  const generatedAt = nowIso();
  // Persist a compact, export-compatible snapshot state. The live state can contain
  // raw scan/track evidence and nested API payloads; cloning/stringifying that entire
  // object previously pushed Node beyond the V8 heap limit.
  const snapshotState = compactSnapshotState(state, snapshotId);
  const dashboardRows = buildDashboardRows(snapshotState);
  const coreKpis = buildCoreKpis(snapshotState);
  const criticalDashboard = buildCriticalDashboard(snapshotState);
  const detailTabs = buildDetailTabs(snapshotState);
  const dashboard = buildDashboardData(snapshotState);
  const xlsxRows = getXlsxSheetRows(snapshotState);
  const hashDetailTabs = Object.fromEntries(Object.entries(xlsxRows)
    .filter(([, rows]) => Array.isArray(rows))
    .map(([key, rows]) => [key, { rows }]));
  const snapshotHashes = buildSnapshotHashes({ dashboardRows, detailTabs: hashDetailTabs });
  const metrics = Object.fromEntries([
    ...dashboardRows.map(row => [row.metricKey || row.项目, row.数值]),
    ...criticalDashboard.rows.map(row => [row.metricKey || row.异常类型, row.数量])
  ]);
  const detailCounts = Object.fromEntries(Object.entries(detailTabs).map(([key, value]) => [key, Number(value?.total || 0)]));
  const dataHashes = {
    dailyParseRows: hash(state.dailyParseRows || []),
    scanResults: hash(state.scanResults || []),
    trackEvents: hash(state.trackEvents || []),
    finalRows: hash(state.finalRows || []),
    carryBills: hash(state.nextCarryBills || state.carryBills || []),
    podLocks: hash(state.podLocks || [])
  };
  const consistency = buildConsistencyReport(state);
  const payload = {
    snapshotId,
    reportDate,
    runId,
    generatedAt,
    metrics,
    detailCounts,
    dataHashes,
    consistency,
    coreKpis,
    dashboard,
    dashboardRows,
    criticalDashboard,
    // detailTabs/xlsxRows are derived from snapshotState and are intentionally not
    // duplicated inside payloadJson. Existing callers already rebuild them when absent.
    ...snapshotHashes,
    state: snapshotState,
    snapshotSchemaVersion: 2,
    snapshotStorageMode: 'COMPACT_DERIVED'
  };
  const reconciliationFailed = consistency?.status === 'error' || (consistency?.errors || []).length > 0;
  payload.status = reconciliationFailed ? 'INVALID_FAILED_RECONCILIATION' : 'VALID';
  payload.reconciliationStatus = reconciliationFailed ? 'FAILED' : 'COMPLETED';
  payload.whitelistVersion = SHOP_WHITELIST_VERSION;

  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO export_snapshots(
        snapshotId, reportDate, runId, snapshotType, payloadJson, metricsJson,
        detailCountsJson, dataHashesJson, consistencyJson, generatedAt, createdAt
      ) VALUES(?, ?, ?, 'dashboard', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      reportDate,
      runId,
      stringifySnapshotPayload(payload),
      JSON.stringify(metrics),
      JSON.stringify(detailCounts),
      JSON.stringify(dataHashes),
      JSON.stringify(consistency),
      generatedAt,
      generatedAt
    );
    db.prepare(`UPDATE export_snapshots SET status=?,reconciliationStatus=?,invalidReason=?,whitelistVersion=?,whitelistSha256=? WHERE snapshotId=?`)
      .run(payload.status, payload.reconciliationStatus, reconciliationFailed ? JSON.stringify(consistency) : '', SHOP_WHITELIST_VERSION, SHOP_WHITELIST_SOURCE_SHA256, snapshotId);
    db.prepare(`
      UPDATE run_locks SET status='finished', currentStage='完成', batchIndex=1, totalBatches=1,
        errorMessage='', completedAt=?, updatedAt=? WHERE reportDate=? AND runId=?
    `).run(generatedAt, generatedAt, reportDate, runId);
    db.prepare(`
      INSERT INTO app_meta(key, value, updatedAt) VALUES('current_snapshot_id', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt
    `).run(snapshotId, generatedAt);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return payload;
}

export function getMatchingSnapshot(state = {}) {
  const reportDate = String(state.reportDate || '').trim();
  const runId = String(resolveRunId(state, reportDate)).trim();
  if (!reportDate || !runId) return null;
  return getSnapshot(reportDate, runId);
}

export function repairSnapshotFromStoredData(snapshot = {}) {
  const source = clone(snapshot?.state || {});
  if (!source.reportDate || !Array.isArray(source.finalRows)) throw new Error('Stored snapshot data is incomplete and cannot be repaired locally.');
  // Compact snapshots deliberately omit raw scan/track collections. They already live
  // in normalized SQLite tables, so hydrate evidence only for this explicit repair path.
  if (!Array.isArray(source.trackEvents) || !source.trackEvents.length) source.trackEvents = loadSnapshotRawRows('track_events', source.reportDate);
  if (!Array.isArray(source.scanResults) || !source.scanResults.length) source.scanResults = loadSnapshotRawRows('scan_results', source.reportDate);
  const eventsByBill = new Map();
  for (const event of source.trackEvents || []) {
    const bill = String(event?.shipmentCode || event?.运单号 || '').trim().toUpperCase();
    if (!bill) continue;
    if (!eventsByBill.has(bill)) eventsByBill.set(bill, []);
    eventsByBill.get(bill).push(event);
  }
  const scansByBill = new Map((source.scanResults || []).map(row => [String(row?.运单号 || row?.shipmentCode || '').trim().toUpperCase(), row]));
  const shopCodeMap = getShopCodeMap();
  source.finalRows = source.finalRows.map(row => {
    const bill = String(row?.运单号 || row?.shipmentCode || '').trim().toUpperCase();
    if (!bill || row?.是否POD === '是') return row;
    return analyzeShipment({ waybill: bill, scanRow: scansByBill.get(bill) || row, events: eventsByBill.get(bill) || [], shopCodeMap, reportDate: source.reportDate });
  });
  source.trackResults = source.finalRows.filter(row => row?.是否POD !== '是');
  const repairRunId = `${snapshot.runId || source.lastRunSummary?.runId || 'stored'}_repair_${Date.now()}`;
  source.currentRun = { ...(source.currentRun || {}), runId: repairRunId };
  source.lastRunSummary = { ...(source.lastRunSummary || {}), runId: repairRunId, repairSource: 'STORED_SQLITE_DATA', ceApiCallsDuringRepair: 0 };
  getDb().prepare("UPDATE export_snapshots SET status='INVALID_FAILED_RECONCILIATION',reconciliationStatus='FAILED',invalidReason=? WHERE snapshotId=?")
    .run(JSON.stringify({ reason: 'CLASSIFICATION_CONFLICT', repairedFromStoredData: true }), snapshot.snapshotId);
  const repaired = createDashboardSnapshot(source, { reportDate: source.reportDate, runId: repairRunId });
  const completedAt = nowIso();
  getDb().prepare(`INSERT OR REPLACE INTO run_locks(reportDate,runId,status,lockedBy,lockedAt,updatedAt,currentStage,batchIndex,totalBatches,errorMessage,completedAt)
    VALUES(?,?,'finished','LOCAL_RECONCILIATION',?,?,'完成',1,1,'',?)`)
    .run(source.reportDate, repairRunId, completedAt, completedAt, completedAt);
  repaired.state.currentRun = { ...repaired.state.currentRun, runId: repairRunId, reportDate: source.reportDate, status: 'finished', currentStage: '完成', completedAt };
  repaired.state.snapshotId = repaired.snapshotId;
  return repaired;
}

function resolveRunId(state, reportDate) {
  const stateRunId = state?.currentRun?.runId || state?.lastRunSummary?.runId || state?.lastRun?.runId || '';
  if (stateRunId) return stateRunId;
  if (!reportDate) return '';
  return getDb().prepare('SELECT runId FROM run_locks WHERE reportDate=? ORDER BY updatedAt DESC LIMIT 1').get(reportDate)?.runId || '';
}

function snapshotError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function getSnapshot(reportDate, runId = '') {
  const db = getDb();
  const row = runId
    ? db.prepare(`
        SELECT payloadJson FROM export_snapshots
        WHERE reportDate=? AND runId=? AND snapshotType='dashboard'
        ORDER BY id DESC LIMIT 1
      `).get(reportDate, runId)
    : db.prepare(`
        SELECT payloadJson FROM export_snapshots
        WHERE reportDate=? AND snapshotType='dashboard'
        ORDER BY id DESC LIMIT 1
      `).get(reportDate);
  if (!row?.payloadJson) return null;
  try {
    return JSON.parse(row.payloadJson);
  } catch {
    return null;
  }
}

export function getSnapshotById(snapshotId) {
  const row = getDb().prepare("SELECT payloadJson FROM export_snapshots WHERE snapshotId=? AND snapshotType='dashboard'").get(String(snapshotId || '').trim());
  if (!row?.payloadJson) return null;
  try { return JSON.parse(row.payloadJson); } catch { return null; }
}

export function listSnapshotHistory(limit = 60) {
  return getDb().prepare(`SELECT reportDate,snapshotId,runId,generatedAt
    FROM export_snapshots WHERE snapshotType='dashboard' ORDER BY reportDate DESC,createdAt DESC LIMIT ?`)
    .all(Math.max(1, Math.min(365, Number(limit || 60))));
}

function hash(value) {
  // Stream the value into the hash instead of allocating one giant JSON string.
  const digest = createHash('sha256');
  updateHash(digest, value, new WeakSet());
  return digest.digest('hex');
}

function updateHash(digest, value, seen) {
  if (value === null) { digest.update('null'); return; }
  if (value === undefined) { digest.update('undefined'); return; }
  const type = typeof value;
  if (type === 'string') { digest.update('s:'); digest.update(value); return; }
  if (type === 'number' || type === 'boolean' || type === 'bigint') { digest.update(`${type}:${String(value)}`); return; }
  if (type !== 'object') { digest.update(`${type}:${String(value)}`); return; }
  if (seen.has(value)) { digest.update('[Circular]'); return; }
  seen.add(value);
  if (Array.isArray(value)) {
    digest.update('[');
    for (const item of value) { updateHash(digest, item, seen); digest.update(','); }
    digest.update(']');
  } else {
    digest.update('{');
    for (const key of Object.keys(value).sort()) {
      digest.update(key); digest.update(':'); updateHash(digest, value[key], seen); digest.update(',');
    }
    digest.update('}');
  }
  seen.delete(value);
}

function compactSnapshotState(state = {}, snapshotId = '') {
  const result = {
    snapshotId,
    reportDate: state.reportDate || '',
    sourceName: state.sourceName || '',
    businessType: state.businessType || 'CCSL',
    dailyParseSummary: cloneSmall(state.dailyParseSummary || state.daily?.summary || null),
    pnhBills: compactCodeList(state.pnhBills),
    nonPnhBills: compactCodeList(state.nonPnhBills),
    excludedBills: compactCodeList(state.excludedBills),
    duplicateBills: compactCodeList(state.duplicateBills),
    carryBills: compactCodeList(state.carryBills),
    nextCarryBills: compactCodeList(state.nextCarryBills || state.carryBills),
    podLocks: compactCodeList(state.podLocks),
    needTrackBills: compactCodeList(state.needTrackBills),
    finalRows: compactRows(state.finalRows),
    finalDiversionRows: compactRows(state.finalDiversionRows),
    historySummary: cloneSmall(Array.isArray(state.historySummary) ? state.historySummary.slice(-90) : []),
    currentRun: cloneSmall(state.currentRun || null),
    lastRunSummary: cloneSmall(state.lastRunSummary || state.lastRun || null),
    lastRun: cloneSmall(state.lastRun || state.lastRunSummary || null),
    processing: cloneSmall(state.processing || { running: false, paused: false, phase: '' }),
    backupSummary: cloneSmall(state.backupSummary || null),
    analysisRuleVersion: state.analysisRuleVersion || '',
    logs: Array.isArray(state.logs) ? state.logs.slice(-100).map(value => String(value || '').slice(0, 2000)) : [],
    _snapshotStateCompacted: true
  };
  return result;
}

function compactRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(compactRow).filter(Boolean);
}

function compactRow(row) {
  if (!row || typeof row !== 'object') return row ?? null;
  const out = {};
  const heavyKey = /(?:raw|json|payload|response|request|events?|picture|images?|photos?|attachments?|trace|history)/i;
  for (const [key, value] of Object.entries(row)) {
    // Normalized SQLite already owns raw evidence. Never duplicate it inside a
    // dashboard snapshot, even when an API happened to expose it as a string.
    if (heavyKey.test(key)) continue;
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      // Excel cells cannot usefully carry arbitrarily large raw text either. Keep
      // ordinary business text, but cap pathological strings defensively.
      out[key] = value.length > 32767 ? value.slice(0, 32767) : value;
      continue;
    }
    // Keep only genuinely small primitive arrays. Large/nested collections are
    // evidence tables and are queried from SQLite on demand.
    if (Array.isArray(value) && value.length <= 40 && value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      const totalChars = value.reduce((sum, item) => sum + String(item ?? '').length, 0);
      if (totalChars <= 8192) out[key] = value.slice();
    }
  }
  return out;
}

function compactCodeList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
}

function cloneSmall(value) {
  if (value === undefined) return null;
  try { return structuredClone(value); } catch {}
  try { return JSON.parse(JSON.stringify(value ?? null)); } catch { return null; }
}

function clone(value) {
  return cloneSmall(value);
}

function stringifySnapshotPayload(payload) {
  const text = JSON.stringify(payload);
  const maxBytes = Math.max(8, Number(process.env.SNAPSHOT_MAX_MB || 256)) * 1024 * 1024;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const error = snapshotError('SNAPSHOT_TOO_LARGE', `处理快照仍超过安全上限 ${Math.round(maxBytes / 1024 / 1024)}MB，已停止保存以保护后台服务。`);
    error.snapshotBytes = Buffer.byteLength(text, 'utf8');
    throw error;
  }
  return text;
}

function loadSnapshotRawRows(table, reportDate) {
  const allowed = new Set(['track_events', 'scan_results']);
  if (!allowed.has(table)) return [];
  const rows = getDb().prepare(`SELECT rawJson FROM ${table} WHERE reportDate=? ORDER BY rowid`).all(String(reportDate || ''));
  return rows.map(row => {
    try { return JSON.parse(row.rawJson || '{}'); } catch { return {}; }
  });
}
