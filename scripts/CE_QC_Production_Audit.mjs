import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = 'D:\\CE CCSL金边数据库';
const BUSINESS_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP']);

function resolveProjectPath(value) {
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(projectRoot, value);
}

function isPathRootAvailable(targetPath) {
  const parsed = path.parse(path.resolve(targetPath));
  return !parsed.root || fs.existsSync(parsed.root);
}

function getReadOnlyRuntimeConfig() {
  const preferredDataDir = resolveProjectPath(process.env.DATA_DIR || DEFAULT_DATA_DIR);
  const fallbackDataDir = resolveProjectPath('./data');
  const dataRootAvailable = isPathRootAvailable(preferredDataDir);
  const dataDir = dataRootAvailable ? preferredDataDir : fallbackDataDir;
  const preferredDbFile = resolveProjectPath(process.env.DB_FILE || path.join(dataDir, 'ce_qc_monitor.db'));
  const dbFile = isPathRootAvailable(preferredDbFile) ? preferredDbFile : path.join(fallbackDataDir, 'ce_qc_monitor.db');
  const exportsDir = process.env.EXPORTS_DIR ? resolveProjectPath(process.env.EXPORTS_DIR) : path.join(dataDir, 'exports');
  return {
    dataDir,
    dbFile,
    exportsDir,
    usingFallbackDataDir: !dataRootAvailable,
    dataPathWarning: dataRootAvailable ? '' : '未检测到首选数据盘，审计仅尝试读取项目 data 目录；不会创建或复制数据库。'
  };
}

function openReadOnlyDb(dbFile) {
  if (!fs.existsSync(dbFile)) throw new Error(`Production database not found: ${dbFile}`);
  return new DatabaseSync(dbFile, { readOnly: true });
}

function readSchemaVersion(db) {
  try {
    const metaExists = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='app_meta'").get();
    if (metaExists) {
      const row = db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get();
      if (row?.value !== undefined && row?.value !== null && String(row.value).trim() !== '') {
        return { value: Number(row.value || 0), source: 'app_meta.db_schema_version' };
      }
    }
    return { value: Number(db.prepare('PRAGMA user_version').get()?.user_version || 0), source: 'PRAGMA user_version' };
  } catch {
    return { value: 0, source: 'unavailable' };
  }
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function latestValidBatches(db) {
  const rows = db.prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate ASC, createdAt DESC").all();
  const seen = new Set();
  return rows.filter((row) => {
    if (!row.reportDate || seen.has(row.reportDate)) return false;
    seen.add(row.reportDate);
    return true;
  });
}

function sourceRowsForBatch(db, batchId) {
  return db.prepare('SELECT businessType,shipmentCode FROM unified_import_rows WHERE batchId=? ORDER BY shipmentCode').all(batchId);
}

function whppSourceRowsForDate(db, reportDate) {
  return db.prepare("SELECT 'WHPP' businessType,shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode").all(reportDate);
}

function snapshotForBatch(db, batch) {
  return db.prepare('SELECT * FROM unified_snapshots WHERE snapshotId=? LIMIT 1').get(batch.snapshotId)
    || db.prepare('SELECT * FROM unified_snapshots WHERE batchId=? ORDER BY createdAt DESC LIMIT 1').get(batch.batchId)
    || null;
}

function whppSnapshotForDate(db, reportDate) {
  return db.prepare("SELECT * FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC LIMIT 1").get(reportDate) || null;
}

function retryBillsForDate(db, reportDate) {
  const rows = db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE lastReportDate=? AND UPPER(COALESCE(apiStatus,'')) LIKE '%RETRY%' ORDER BY shipmentCode").all(reportDate);
  return unique(rows.map((row) => String(row.shipmentCode || '').trim().toUpperCase()));
}

function auditDay(db, batch) {
  const coreSourceRows = sourceRowsForBatch(db, batch.batchId);
  const whppSourceRows = whppSourceRowsForDate(db, batch.reportDate);
  const sourceRows = [...coreSourceRows, ...whppSourceRows];
  const sourceBills = unique(sourceRows.map((row) => String(row.shipmentCode || '').trim().toUpperCase()));
  const sourceSet = new Set(sourceBills);
  const classificationCounts = Object.fromEntries(BUSINESS_TYPES.map((type) => [type, 0]));
  for (const row of sourceRows) {
    const type = String(row.businessType || '').toUpperCase();
    if (Object.hasOwn(classificationCounts, type)) classificationCounts[type] += 1;
  }
  const classifiedTotal = Object.values(classificationCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const sourceBalanced = sourceRows.length === sourceBills.length && classifiedTotal === sourceBills.length;

  const snapshot = snapshotForBatch(db, batch);
  const payload = safeJson(snapshot?.payloadJson, {});
  const coreFinalRows = Array.isArray(payload.finalRows) ? payload.finalRows : [];
  const whppSnapshot = whppSnapshotForDate(db, batch.reportDate);
  const whppPayload = safeJson(whppSnapshot?.payloadJson, {});
  const whppFinalRows = Array.isArray(whppPayload?.state?.finalRows) ? whppPayload.state.finalRows : [];
  const finalRows = [...coreFinalRows, ...whppFinalRows];
  const analyzedBills = unique(finalRows.map(billOf));
  const analyzedSet = new Set(analyzedBills);
  const missingBills = sourceBills.filter((bill) => !analyzedSet.has(bill));
  const extraBills = analyzedBills.filter((bill) => !sourceSet.has(bill));
  const duplicateFinalCount = Math.max(0, finalRows.map(billOf).filter(Boolean).length - analyzedBills.length);
  const retryBills = retryBillsForDate(db, batch.reportDate);
  const coreSnapshotStatus = String(snapshot?.status || 'MISSING').toUpperCase();
  const whppRequired = classificationCounts.WHPP > 0;
  const whppSnapshotStatus = whppRequired ? (whppSnapshot ? 'COMPLETED' : 'MISSING') : 'NOT_REQUIRED';
  const snapshotStatus = coreSnapshotStatus === 'COMPLETED' && (!whppRequired || whppSnapshot) ? 'COMPLETED' : `CORE:${coreSnapshotStatus}/WHPP:${whppSnapshotStatus}`;
  const complete = sourceBalanced
    && coreSnapshotStatus === 'COMPLETED'
    && (!whppRequired || Boolean(whppSnapshot))
    && missingBills.length === 0
    && extraBills.length === 0
    && duplicateFinalCount === 0
    && analyzedBills.length === sourceBills.length
    && retryBills.length === 0;

  return {
    reportDate: batch.reportDate,
    batchId: batch.batchId,
    snapshotId: batch.snapshotId,
    whppSnapshotId: whppSnapshot?.snapshotId || '',
    sourceName: batch.sourceName || '',
    fileHash: batch.fileHash || '',
    snapshotStatus,
    coreSnapshotStatus,
    whppSnapshotStatus,
    sourceTotal: sourceBills.length,
    classifiedTotal,
    analyzedTotal: analyzedBills.length,
    pendingAnalysis: Math.max(0, sourceBills.length - analyzedBills.length),
    sourceBalanced,
    classificationCounts,
    missingCount: missingBills.length,
    missingBills,
    extraCount: extraBills.length,
    extraBills,
    duplicateFinalCount,
    retryCount: retryBills.length,
    retryBills,
    result: complete ? 'PASS' : 'NEEDS_REBUILD'
  };
}

function buildMonthly(days) {
  const map = new Map();
  for (const day of days) {
    const month = String(day.reportDate || '').slice(0, 7) || 'UNKNOWN';
    if (!map.has(month)) map.set(month, { month, days: 0, passedDays: 0, sourceTotal: 0, analyzedTotal: 0, pendingAnalysis: 0, missingCount: 0, retryCount: 0 });
    const item = map.get(month);
    item.days += 1;
    if (day.result === 'PASS') item.passedDays += 1;
    item.sourceTotal += day.sourceTotal;
    item.analyzedTotal += day.analyzedTotal;
    item.pendingAnalysis += day.pendingAnalysis;
    item.missingCount += day.missingCount;
    item.retryCount += day.retryCount;
  }
  return [...map.values()];
}

function printTable(days) {
  const header = ['DATE', 'SOURCE', 'ANALYZED', 'WAIT', 'MISS', 'RETRY', 'SNAPSHOT', 'RESULT'];
  const rows = days.map((d) => [d.reportDate, d.sourceTotal, d.analyzedTotal, d.pendingAnalysis, d.missingCount, d.retryCount, d.snapshotStatus, d.result]);
  const widths = header.map((value, index) => Math.max(String(value).length, ...rows.map((row) => String(row[index]).length)));
  const line = (row) => row.map((value, index) => String(value).padEnd(widths[index])).join('  ');
  console.log(line(header));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(line(row));
}

function main() {
  const cfg = getReadOnlyRuntimeConfig();
  const db = openReadOnlyDb(cfg.dbFile);
  let report;
  let resultCode = 20;
  try {
    const integrity = String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown');
    const schemaVersion = readSchemaVersion(db);
    const batches = latestValidBatches(db);
    const days = batches.map((batch) => auditDay(db, batch));
    const monthly = buildMonthly(days);
    const failedDays = days.filter((day) => day.result !== 'PASS');
    const sourceErrors = days.filter((day) => !day.sourceBalanced);
    const totalSource = days.reduce((sum, day) => sum + day.sourceTotal, 0);
    const totalAnalyzed = days.reduce((sum, day) => sum + day.analyzedTotal, 0);
    const totalMissing = days.reduce((sum, day) => sum + day.missingCount, 0);
    const totalRetry = days.reduce((sum, day) => sum + day.retryCount, 0);

    report = {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      database: {
        path: cfg.dbFile,
        usingFallbackDataDir: Boolean(cfg.usingFallbackDataDir),
        dataPathWarning: cfg.dataPathWarning || '',
        integrity,
        schemaVersion: schemaVersion.value,
        schemaVersionSource: schemaVersion.source
      },
      summary: {
        reportDays: days.length,
        passedDays: days.length - failedDays.length,
        needsRebuildDays: failedDays.length,
        sourceErrorDays: sourceErrors.length,
        sourceTotal: totalSource,
        analyzedTotal: totalAnalyzed,
        missingTotal: totalMissing,
        retryTotal: totalRetry
      },
      monthly,
      days
    };

    console.log('\nCE QC PRODUCTION AUDIT');
    console.log('SQLite connection: READ-ONLY');
    console.log(`Database: ${cfg.dbFile}`);
    console.log(`SQLite integrity: ${integrity}`);
    console.log(`Schema version: ${schemaVersion.value} (${schemaVersion.source})`);
    if (cfg.usingFallbackDataDir) console.log(`WARNING: ${cfg.dataPathWarning}`);
    console.log('');
    if (days.length) printTable(days);
    else console.log('No VALID unified daily imports were found.');

    console.log('\nSUMMARY');
    console.log(`Report days: ${days.length}`);
    console.log(`Passed days: ${days.length - failedDays.length}`);
    console.log(`Needs rebuild: ${failedDays.length}`);
    console.log(`Source total: ${totalSource}`);
    console.log(`Analyzed total: ${totalAnalyzed}`);
    console.log(`Missing waybills: ${totalMissing}`);
    console.log(`API retry: ${totalRetry}`);

    if (integrity !== 'ok' || sourceErrors.length > 0) {
      console.error('\nRESULT: BLOCKED - database/source reconciliation error. Do not purge or rebuild history.');
      resultCode = 20;
    } else if (failedDays.length > 0) {
      console.log('\nRESULT: REBUILD_REQUIRED - source data is intact, but one or more dates are incomplete.');
      resultCode = 10;
    } else {
      console.log('\nRESULT: PASS - all imported dates, including WHPP when present, are complete and reconciled.');
      resultCode = 0;
    }
  } finally {
    db.close();
  }

  const auditDir = path.join(cfg.exportsDir, 'audit');
  fs.mkdirSync(auditDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(auditDir, `production_audit_${stamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Audit JSON: ${outputPath}`);
  console.log('READ-ONLY CONFIRMED');
  console.log('DATABASE MODIFIED: NO');
  process.exitCode = resultCode;
}

try {
  main();
} catch (error) {
  console.error(`\nAUDIT ERROR: ${error?.stack || error?.message || error}`);
  console.log('DATABASE MODIFIED: NO');
  process.exitCode = 20;
}
