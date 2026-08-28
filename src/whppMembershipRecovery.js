import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb, getRuntimeConfig } from './db.js';

const RECOVERY_ID = 'WHPP_VERIFIED_BACKUP_MEMBERSHIP_RECOVERY';
const MAX_RECENT_DATES = 14;
const MAX_BACKUPS = 24;

function dateOnly(value = '') {
  const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}
function uniqueRows(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const bill = billOf(row);
    if (!bill) continue;
    const raw = safeJson(row.rowJson, {});
    map.set(bill, {
      ...raw,
      shipmentCode: bill,
      运单号: bill,
      businessType: 'WHPP',
      reportDate: String(row.reportDate || raw.reportDate || ''),
      sheetName: row.sheetName || raw.sheetName || '',
      rowNumber: Number(row.rowNumber || raw.rowNumber || 0),
      source_row_number: Number(row.source_row_number || raw.source_row_number || row.rowNumber || raw.rowNumber || 0),
      recipient_raw: row.recipient_raw || raw.recipient_raw || raw.recipientRaw || '',
      recipient_normalized: row.recipient_normalized || raw.recipient_normalized || raw.recipientNormalized || '',
      recipient_group_reason: row.recipient_group_reason || raw.recipient_group_reason || raw.classificationReason || '',
      rawText: row.rawText || raw.rawText || '',
      rowJson: row.rowJson || JSON.stringify(raw),
      createdAt: row.createdAt || ''
    });
  }
  return [...map.values()];
}
function tableExists(db, name) {
  try { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)); }
  catch { return false; }
}
function currentHistoryTotal(db, reportDate) {
  try {
    const row = db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate);
    const summary = safeJson(row?.summaryJson, {});
    for (const key of ['total', 'today', 'todayTotal', 'pnh', 'todayPnh']) {
      const value = Number(summary?.[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  } catch {}
  return 0;
}
function currentStandardCount(db, reportDate) {
  try {
    return Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''").get(reportDate)?.count || 0);
  } catch { return 0; }
}
function latestUnifiedWhppCount(db, reportDate) {
  try {
    const batch = db.prepare("SELECT batchId FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(reportDate);
    if (!batch?.batchId) return { batchPresent: false, count: 0 };
    const count = Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM unified_import_rows WHERE batchId=? AND businessType='WHPP' AND TRIM(COALESCE(shipmentCode,''))<>''").get(batch.batchId)?.count || 0);
    return { batchPresent: true, count, batchId: batch.batchId };
  } catch { return { batchPresent: false, count: 0 }; }
}
function currentFactBills(db, reportDate) {
  try {
    return db.prepare("SELECT DISTINCT UPPER(TRIM(shipmentCode)) shipmentCode FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY shipmentCode")
      .all(reportDate).map(row => String(row.shipmentCode || '')).filter(Boolean);
  } catch { return []; }
}

export function listVerifiedWhppBackupCandidates(backupsDir = getRuntimeConfig().backupsDir) {
  const root = path.join(backupsDir, 'pre_update');
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse(); }
  catch { return []; }
  const candidates = [];
  for (const name of names.slice(0, MAX_BACKUPS)) {
    const manifestPath = path.join(root, name, 'manifest.json');
    let manifest = {};
    try { manifest = safeJson(fs.readFileSync(manifestPath, 'utf8'), {}); } catch { continue; }
    const quickOk = String(manifest.backupQuickCheck || '').toLowerCase() === 'ok' || String(manifest.integrity || '').toLowerCase().includes('quick-ok');
    const stable = manifest.sourceStableDuringBackup !== false;
    const backupPath = String(manifest.backupPath || path.join(root, name, 'ce_qc_monitor.db')).trim();
    if (!quickOk || !stable || !backupPath || !fs.existsSync(backupPath)) continue;
    try {
      const stat = fs.statSync(backupPath);
      if (!stat.isFile() || stat.size <= 0) continue;
      candidates.push({ backupPath, manifestPath, name, manifest, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  return candidates;
}

export function inspectVerifiedWhppBackup(backupPath, reportDate, options = {}) {
  const date = dateOnly(reportDate);
  if (!date || !backupPath || !fs.existsSync(backupPath)) return { ok: false, reason: 'INVALID_BACKUP_OR_DATE' };
  let backup = null;
  try {
    backup = new DatabaseSync(backupPath, { readOnly: true });
    backup.exec('PRAGMA query_only=ON');
    backup.exec('PRAGMA busy_timeout=1000');
    if (!tableExists(backup, 'business_daily_reports') || !tableExists(backup, 'business_daily_parse_rows')) return { ok: false, reason: 'WHPP_TABLES_MISSING' };
    const daily = backup.prepare("SELECT reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);
    if (!daily) return { ok: false, reason: 'WHPP_DAILY_HEADER_MISSING' };
    const rawRows = backup.prepare("SELECT * FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY shipmentCode").all(date);
    const rows = uniqueRows(rawRows);
    const headerTotal = Number(daily.totalCount || 0);
    if (headerTotal <= 0 || rows.length <= 0) return { ok: false, reason: 'WHPP_BACKUP_ZERO', headerTotal, rowCount: rows.length };
    if (rows.length !== headerTotal || rawRows.length !== rows.length) return { ok: false, reason: 'WHPP_BACKUP_HEADER_ROW_MISMATCH', headerTotal, rawCount: rawRows.length, rowCount: rows.length };

    const currentDb = options.currentDb;
    const expected = currentDb ? currentHistoryTotal(currentDb, date) : 0;
    if (expected > 0 && expected !== rows.length) return { ok: false, reason: 'WHPP_BACKUP_HISTORY_TOTAL_MISMATCH', expected, rowCount: rows.length };
    const residualBills = currentDb ? currentFactBills(currentDb, date) : [];
    const memberSet = new Set(rows.map(billOf));
    const residualOutside = residualBills.filter(bill => !memberSet.has(bill));
    if (residualOutside.length) return { ok: false, reason: 'WHPP_BACKUP_CONFLICTS_CURRENT_FACTS', residualOutsideCount: residualOutside.length, residualOutside: residualOutside.slice(0, 20), rowCount: rows.length };

    const regionCounts = rows.reduce((acc, row) => {
      const region = String(row.regionCode || row.区域 || safeJson(row.rowJson, {}).regionCode || '').trim().toUpperCase();
      const key = region === 'PP' ? 'PP' : region === 'PV' ? 'PV' : 'UNKNOWN';
      acc[key] += 1;
      return acc;
    }, { PP: 0, PV: 0, UNKNOWN: 0 });
    return { ok: true, reportDate: date, daily, rows, rowCount: rows.length, expectedHistoryTotal: expected, residualFactCount: residualBills.length, regionCounts, source: 'VERIFIED_PRE_UPDATE_SQLITE' };
  } catch (error) {
    return { ok: false, reason: 'WHPP_BACKUP_READ_FAILED', error: error?.message || String(error) };
  } finally {
    try { backup?.close(); } catch {}
  }
}

function writeRecoveredWhppMembership(db, candidate, backupInfo) {
  const date = backupInfo.reportDate;
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const recoverySummary = {
      ...safeJson(backupInfo.daily?.summaryJson, {}),
      membershipRecovery: {
        id: RECOVERY_ID,
        source: 'VERIFIED_PRE_UPDATE_SQLITE',
        backupName: candidate.name,
        total: backupInfo.rowCount,
        regionCounts: backupInfo.regionCounts,
        recoveredAt: now
      }
    };
    db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt)
      VALUES('WHPP',?,?,?,?,?,?)
      ON CONFLICT(businessType,reportDate) DO UPDATE SET sourceFile=excluded.sourceFile,totalCount=excluded.totalCount,summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`)
      .run(date, backupInfo.daily?.sourceFile || `RECOVERED_${date}`, backupInfo.rowCount, JSON.stringify(recoverySummary), backupInfo.daily?.createdAt || now, now);
    db.prepare("DELETE FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").run(date);
    const insert = db.prepare(`INSERT INTO business_daily_parse_rows(
      businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt
    ) VALUES('WHPP',?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of backupInfo.rows) {
      const raw = safeJson(row.rowJson, {});
      insert.run(
        date,
        billOf(row),
        row.sheetName || raw.sheetName || '',
        Number(row.rowNumber || raw.rowNumber || 0),
        Number(row.source_row_number || raw.source_row_number || row.rowNumber || raw.rowNumber || 0),
        row.recipient_raw || raw.recipient_raw || raw.recipientRaw || '',
        row.recipient_normalized || raw.recipient_normalized || raw.recipientNormalized || '',
        'WHPP',
        row.recipient_group_reason || raw.recipient_group_reason || raw.classificationReason || 'VERIFIED_PRE_UPDATE_SQLITE',
        row.rawText || raw.rawText || '',
        JSON.stringify({ ...raw, shipmentCode: billOf(row), 运单号: billOf(row), businessType: 'WHPP', reportDate: date }),
        row.createdAt || now
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  const verified = currentStandardCount(db, date);
  if (verified !== backupInfo.rowCount) throw new Error(`WHPP membership recovery post-check failed ${verified}/${backupInfo.rowCount}`);
  return verified;
}

export function recoverWhppMembershipFromVerifiedBackups(reportDate, options = {}) {
  const date = dateOnly(reportDate);
  const db = options.db || getDb();
  if (!date) return { ok: false, repaired: false, reason: 'INVALID_REPORT_DATE' };
  const standardCount = currentStandardCount(db, date);
  if (standardCount > 0) return { ok: true, repaired: false, reason: 'STANDARD_WHPP_MEMBERSHIP_PRESENT', reportDate: date, total: standardCount };
  const unified = latestUnifiedWhppCount(db, date);
  if (!unified.batchPresent) return { ok: false, repaired: false, reason: 'NO_VALID_UNIFIED_BATCH', reportDate: date };
  if (unified.count > 0) return { ok: true, repaired: false, reason: 'NONZERO_UNIFIED_WHPP_PRESENT', reportDate: date, total: unified.count };

  const candidates = options.candidates || listVerifiedWhppBackupCandidates(options.backupsDir || getRuntimeConfig().backupsDir);
  for (const candidate of candidates) {
    const inspected = inspectVerifiedWhppBackup(candidate.backupPath, date, { currentDb: db });
    if (!inspected.ok) continue;
    const verified = writeRecoveredWhppMembership(db, candidate, inspected);
    const result = {
      ok: true,
      repaired: true,
      reason: 'RESTORED_FROM_VERIFIED_PRE_UPDATE_SQLITE',
      reportDate: date,
      total: verified,
      regionCounts: inspected.regionCounts,
      residualFactCount: inspected.residualFactCount,
      backupName: candidate.name,
      backupPath: candidate.backupPath
    };
    console.log('[CE-QC][WHPP_MEMBERSHIP_RECOVERY_REPAIRED]', JSON.stringify(result));
    return result;
  }
  const result = { ok: false, repaired: false, reason: 'NO_SAFE_NONZERO_WHPP_BACKUP_FOUND', reportDate: date, backupsChecked: candidates.length };
  console.warn('[CE-QC][WHPP_MEMBERSHIP_RECOVERY_SKIPPED]', JSON.stringify(result));
  return result;
}

function recentZeroWhppDates(db) {
  let rows = [];
  try {
    rows = db.prepare("SELECT DISTINCT reportDate FROM unified_import_batches WHERE status='VALID' AND TRIM(COALESCE(reportDate,''))<>'' ORDER BY reportDate DESC LIMIT ?").all(MAX_RECENT_DATES);
  } catch { return []; }
  return rows.map(row => dateOnly(row.reportDate)).filter(Boolean).filter(date => {
    if (currentStandardCount(db, date) > 0) return false;
    const unified = latestUnifiedWhppCount(db, date);
    return unified.batchPresent && unified.count === 0;
  });
}

export function runStartupWhppMembershipRecovery(options = {}) {
  const db = options.db || getDb();
  const dates = options.reportDates || recentZeroWhppDates(db);
  if (!dates.length) return [];
  const candidates = options.candidates || listVerifiedWhppBackupCandidates(options.backupsDir || getRuntimeConfig().backupsDir);
  const results = [];
  for (const date of dates) {
    try { results.push(recoverWhppMembershipFromVerifiedBackups(date, { db, candidates })); }
    catch (error) { results.push({ ok: false, repaired: false, reportDate: date, reason: 'RECOVERY_EXCEPTION', error: error?.message || String(error) }); }
  }
  return results;
}

if (process.env.NODE_ENV !== 'test' && !process.env.CI) {
  const timer = setTimeout(() => {
    try {
      const results = runStartupWhppMembershipRecovery();
      if (results.length) console.log('[CE-QC][WHPP_MEMBERSHIP_RECOVERY_STARTUP]', JSON.stringify(results));
    } catch (error) {
      console.error('[CE-QC][WHPP_MEMBERSHIP_RECOVERY_FATAL]', error?.stack || error);
    }
  }, 500);
  timer.unref?.();
}

console.log('[CE-QC][WHPP_MEMBERSHIP_RECOVERY]', JSON.stringify({
  id: RECOVERY_ID,
  source: 'VERIFIED_PRE_UPDATE_SQLITE_ONLY',
  scope: 'BUSINESS_DAILY_REPORTS+BUSINESS_DAILY_PARSE_ROWS_ONLY',
  rejects: 'ZERO_BACKUP|HEADER_ROW_MISMATCH|HISTORY_TOTAL_MISMATCH|CURRENT_FACT_CONFLICT',
  currentFactsMutation: false,
  currentStateMutation: false,
  carryoverMutation: false,
  runLockMutation: false,
  snapshotMutation: false
}));
