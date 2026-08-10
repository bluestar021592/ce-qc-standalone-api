import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = 'D:\\CE CCSL金边数据库';
const EXPECTED_SCHEMA_VERSION = 18;
const DEFAULT_START_DATE = '2026-08-01';
const DEFAULT_FOCUS_START_DATE = '2026-08-02';
const TARGET_TABLES = Object.freeze([
  'unified_import_batches',
  'unified_import_rows',
  'unified_snapshots',
  'shipment_daily_snapshots',
  'shipment_current_state',
  'carryover_open_items',
  'metric_snapshots',
  'daily_reports',
  'final_rows',
  'business_daily_reports',
  'business_final_rows',
  'business_history_summary'
]);
const DATE_COLUMN_PRIORITY = Object.freeze(['reportDate', 'snapshotDate', 'lastReportDate', 'sourceDate', 'date']);

function resolveProjectPath(value) {
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(projectRoot, value);
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function dateRange(start, end) {
  const values = [];
  for (let current = start; current <= end; current = addDays(current, 1)) values.push(current);
  return values;
}

function getConfig() {
  const dataDir = resolveProjectPath(process.env.DATA_DIR || DEFAULT_DATA_DIR);
  const dbFile = resolveProjectPath(process.env.DB_FILE || path.join(dataDir, 'ce_qc_monitor.db'));
  const exportsDir = process.env.EXPORTS_DIR ? resolveProjectPath(process.env.EXPORTS_DIR) : path.join(dataDir, 'exports');
  const startDate = String(process.env.DIAGNOSTIC_START_DATE || DEFAULT_START_DATE).slice(0, 10);
  const endDate = String(process.env.DIAGNOSTIC_END_DATE || localDateString()).slice(0, 10);
  const focusStartDate = String(process.env.DIAGNOSTIC_FOCUS_START_DATE || DEFAULT_FOCUS_START_DATE).slice(0, 10);
  return { dataDir, dbFile, exportsDir, startDate, endDate, focusStartDate };
}

function statInfo(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  const stat = fs.statSync(filePath);
  return {
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    modifiedAt: stat.mtime.toISOString()
  };
}

function openReadOnlyDb(dbFile) {
  if (!fs.existsSync(dbFile)) throw new Error(`Production database not found: ${dbFile}`);
  return new DatabaseSync(dbFile, { readOnly: true });
}

function ident(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function tableColumns(db, tableName) {
  if (!tableExists(db, tableName)) return [];
  return db.prepare(`PRAGMA table_info(${ident(tableName)})`).all().map((row) => String(row.name || ''));
}

function pickDateColumn(columns) {
  return DATE_COLUMN_PRIORITY.find((name) => columns.includes(name)) || null;
}

function safeCount(db, sql, ...params) {
  try { return Number(db.prepare(sql).get(...params)?.count || 0); } catch { return null; }
}

function summarizeTable(db, tableName) {
  if (!tableExists(db, tableName)) return { table: tableName, exists: false };
  const columns = tableColumns(db, tableName);
  const dateColumn = pickDateColumn(columns);
  const rowCount = safeCount(db, `SELECT COUNT(*) AS count FROM ${ident(tableName)}`);
  let minDate = null;
  let maxDate = null;
  if (dateColumn) {
    const row = db.prepare(`SELECT MIN(substr(${ident(dateColumn)},1,10)) AS minDate, MAX(substr(${ident(dateColumn)},1,10)) AS maxDate FROM ${ident(tableName)} WHERE ${ident(dateColumn)} IS NOT NULL AND ${ident(dateColumn)}<>''`).get();
    minDate = row?.minDate || null;
    maxDate = row?.maxDate || null;
  }
  return { table: tableName, exists: true, rowCount, dateColumn, minDate, maxDate, columns };
}

function countTableForDate(db, summary, reportDate) {
  if (!summary.exists || !summary.dateColumn) return null;
  return safeCount(db, `SELECT COUNT(*) AS count FROM ${ident(summary.table)} WHERE substr(${ident(summary.dateColumn)},1,10)=?`, reportDate);
}

function readAppMeta(db) {
  const exists = tableExists(db, 'app_meta');
  if (!exists) {
    const userVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
    return {
      tableExists: false,
      rows: [],
      dbSchemaVersionRaw: null,
      legacySchemaVersionRaw: null,
      userVersion,
      effectiveSchemaVersion: userVersion,
      conclusion: 'META_SCHEMA_VERSION_MISSING'
    };
  }
  const rows = db.prepare('SELECT key,value,updatedAt FROM app_meta ORDER BY key').all();
  const map = new Map(rows.map((row) => [String(row.key || ''), row.value]));
  const raw = map.has('db_schema_version') ? map.get('db_schema_version') : null;
  const legacyRaw = map.has('schema_version') ? map.get('schema_version') : null;
  const userVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
  let conclusion = 'META_SCHEMA_VERSION_MISSING';
  let parsed = null;
  if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
    parsed = Number(raw);
    conclusion = Number.isInteger(parsed) && parsed === EXPECTED_SCHEMA_VERSION ? 'META_SCHEMA_VERSION_OK' : 'META_SCHEMA_VERSION_INVALID';
  }
  return {
    tableExists: true,
    rows,
    dbSchemaVersionRaw: raw,
    legacySchemaVersionRaw: legacyRaw,
    userVersion,
    effectiveSchemaVersion: Number.isInteger(parsed) && parsed > 0 ? parsed : userVersion,
    expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    conclusion
  };
}

function readBatches(db, startDate, endDate) {
  if (!tableExists(db, 'unified_import_batches')) return [];
  return db.prepare(`
    SELECT batchId,snapshotId,reportDate,sourceName,fileHash,status,createdAt
    FROM unified_import_batches
    WHERE reportDate BETWEEN ? AND ?
    ORDER BY reportDate ASC, createdAt ASC
  `).all(startDate, endDate);
}

function groupBatchSummary(batches) {
  const groups = new Map();
  for (const batch of batches) {
    const key = `${batch.reportDate}|||${String(batch.status || '').toUpperCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(batch);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [reportDate, status] = key.split('|||');
    const latest = [...rows].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    return {
      reportDate,
      status,
      batchCount: rows.length,
      latestCreatedAt: latest?.createdAt || '',
      batchId: latest?.batchId || '',
      snapshotId: latest?.snapshotId || '',
      sourceName: latest?.sourceName || ''
    };
  }).sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.status.localeCompare(b.status));
}

function sourceCountForBatch(db, batchId) {
  if (!tableExists(db, 'unified_import_rows')) return null;
  return safeCount(db, 'SELECT COUNT(*) AS count FROM unified_import_rows WHERE batchId=?', batchId);
}

function snapshotForBatch(db, batch) {
  if (!tableExists(db, 'unified_snapshots')) return null;
  return db.prepare('SELECT snapshotId,batchId,reportDate,status,payloadJson,createdAt FROM unified_snapshots WHERE snapshotId=? LIMIT 1').get(batch.snapshotId)
    || db.prepare('SELECT snapshotId,batchId,reportDate,status,payloadJson,createdAt FROM unified_snapshots WHERE batchId=? ORDER BY createdAt DESC LIMIT 1').get(batch.batchId)
    || null;
}

function analyzeSnapshot(snapshot) {
  if (!snapshot) return { exists: false, status: 'MISSING', finalRowsCount: null, payloadParseError: false };
  try {
    const payload = JSON.parse(snapshot.payloadJson || '{}');
    return {
      exists: true,
      snapshotId: snapshot.snapshotId,
      batchId: snapshot.batchId,
      reportDate: snapshot.reportDate,
      status: String(snapshot.status || '').toUpperCase(),
      finalRowsCount: Array.isArray(payload.finalRows) ? payload.finalRows.length : 0,
      payloadParseError: false,
      createdAt: snapshot.createdAt || ''
    };
  } catch {
    return {
      exists: true,
      snapshotId: snapshot.snapshotId,
      batchId: snapshot.batchId,
      reportDate: snapshot.reportDate,
      status: String(snapshot.status || '').toUpperCase(),
      finalRowsCount: null,
      payloadParseError: true,
      createdAt: snapshot.createdAt || ''
    };
  }
}

function analyzeDate(db, reportDate, batches, tableCounts) {
  const dateBatches = batches.filter((row) => row.reportDate === reportDate);
  const externalEvidence = Object.entries(tableCounts)
    .filter(([table]) => !['unified_import_batches', 'unified_import_rows', 'unified_snapshots'].includes(table))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);

  if (!dateBatches.length) {
    return {
      reportDate,
      conclusion: externalEvidence > 0 ? 'DATA_EXISTS_OUTSIDE_UNIFIED' : 'IMPORT_NOT_PRESENT',
      batchCount: 0,
      validBatchCount: 0,
      externalEvidenceCount: externalEvidence,
      tableCounts
    };
  }

  const validBatches = dateBatches.filter((row) => String(row.status || '').toUpperCase() === 'VALID');
  if (!validBatches.length) {
    return {
      reportDate,
      conclusion: 'IMPORT_PRESENT_NOT_VALID',
      batchCount: dateBatches.length,
      validBatchCount: 0,
      statuses: [...new Set(dateBatches.map((row) => String(row.status || '').toUpperCase()))],
      externalEvidenceCount: externalEvidence,
      tableCounts
    };
  }

  const latestValid = [...validBatches].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  const sourceCount = sourceCountForBatch(db, latestValid.batchId);
  const snapshot = analyzeSnapshot(snapshotForBatch(db, latestValid));
  const snapshotComplete = snapshot.exists
    && snapshot.status === 'COMPLETED'
    && !snapshot.payloadParseError
    && sourceCount !== null
    && snapshot.finalRowsCount === sourceCount;

  return {
    reportDate,
    conclusion: snapshotComplete ? 'COMPLETE' : 'SNAPSHOT_INCOMPLETE',
    batchCount: dateBatches.length,
    validBatchCount: validBatches.length,
    latestValidBatch: {
      batchId: latestValid.batchId,
      snapshotId: latestValid.snapshotId,
      sourceName: latestValid.sourceName || '',
      createdAt: latestValid.createdAt || ''
    },
    sourceCount,
    snapshot,
    externalEvidenceCount: externalEvidence,
    tableCounts
  };
}

function overallConclusion(dateAnalyses) {
  if (!dateAnalyses.length) return 'COMPLETE';
  const conclusions = [...new Set(dateAnalyses.map((item) => item.conclusion))];
  if (conclusions.length === 1) return conclusions[0];
  return 'MIXED';
}

function renderText(report) {
  const lines = [];
  lines.push('CE QC PRODUCTION READ-ONLY DIAGNOSTIC');
  lines.push('======================================');
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Database: ${report.database.path}`);
  lines.push(`Database exists: ${report.database.before.exists ? 'YES' : 'NO'}`);
  lines.push(`Database size: ${report.database.before.size ?? 0}`);
  lines.push(`Database modified at: ${report.database.before.modifiedAt || ''}`);
  lines.push(`SQLite integrity: ${report.database.integrity}`);
  lines.push('SQLite connection: READ-ONLY');
  lines.push('');
  lines.push('SCHEMA');
  lines.push(`db_schema_version: ${report.schema.dbSchemaVersionRaw ?? 'MISSING'}`);
  lines.push(`legacy schema_version: ${report.schema.legacySchemaVersionRaw ?? 'MISSING'}`);
  lines.push(`PRAGMA user_version: ${report.schema.userVersion}`);
  lines.push(`Expected schema version: ${report.schema.expectedSchemaVersion}`);
  lines.push(`Schema conclusion: ${report.schema.conclusion}`);
  lines.push('');
  lines.push('TABLE DATE RANGES');
  for (const table of report.tables) {
    if (!table.exists) lines.push(`${table.table}: MISSING`);
    else lines.push(`${table.table}: rows=${table.rowCount} dateColumn=${table.dateColumn || 'NONE'} min=${table.minDate || '-'} max=${table.maxDate || '-'}`);
  }
  lines.push('');
  lines.push('DATE DIAGNOSTIC');
  lines.push('DATE        CONCLUSION                   BATCH VALID SOURCE FINAL SNAPSHOT');
  for (const item of report.dates) {
    lines.push([
      item.reportDate.padEnd(10),
      item.conclusion.padEnd(28),
      String(item.batchCount ?? 0).padEnd(5),
      String(item.validBatchCount ?? 0).padEnd(5),
      String(item.sourceCount ?? '-').padEnd(6),
      String(item.snapshot?.finalRowsCount ?? '-').padEnd(5),
      String(item.snapshot?.status || '-').padEnd(9)
    ].join(' '));
  }
  lines.push('');
  lines.push(`OVERALL: ${report.overallConclusion}`);
  lines.push(`Schema: ${report.schema.conclusion}`);
  lines.push(`DB file changed during diagnostic window: ${report.database.fileChangedDuringRun ? 'YES' : 'NO'}`);
  lines.push('READ-ONLY CONFIRMED');
  lines.push('DATABASE MODIFIED: NO');
  return lines.join('\n');
}

function main() {
  const cfg = getConfig();
  const before = statInfo(cfg.dbFile);
  if (!before.exists) throw new Error(`Production database not found: ${cfg.dbFile}`);
  if (cfg.startDate > cfg.endDate) throw new Error(`Invalid diagnostic date range: ${cfg.startDate} > ${cfg.endDate}`);

  const db = openReadOnlyDb(cfg.dbFile);
  let report;
  try {
    const integrity = String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown');
    const schema = readAppMeta(db);
    const tables = TARGET_TABLES.map((table) => summarizeTable(db, table));
    const tableSummaryMap = new Map(tables.map((item) => [item.table, item]));
    const dates = dateRange(cfg.startDate, cfg.endDate);
    const batches = readBatches(db, cfg.startDate, cfg.endDate);
    const batchSummary = groupBatchSummary(batches);
    const dateAnalyses = dates.map((reportDate) => {
      const tableCounts = Object.fromEntries(TARGET_TABLES.map((table) => [
        table,
        countTableForDate(db, tableSummaryMap.get(table), reportDate)
      ]));
      return analyzeDate(db, reportDate, batches, tableCounts);
    });

    report = {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      diagnosticRange: { startDate: cfg.startDate, endDate: cfg.endDate, focusStartDate: cfg.focusStartDate },
      database: {
        path: cfg.dbFile,
        before,
        integrity
      },
      schema,
      appMeta: schema.rows,
      tables,
      batchSummary,
      dates: dateAnalyses,
      overallConclusion: overallConclusion(dateAnalyses.filter((item) => item.reportDate >= cfg.focusStartDate))
    };
  } finally {
    db.close();
  }

  const after = statInfo(cfg.dbFile);
  report.database.after = after;
  report.database.fileChangedDuringRun = Boolean(
    before.exists && after.exists && (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
  );

  const auditDir = path.join(cfg.exportsDir, 'audit');
  fs.mkdirSync(auditDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(auditDir, `production_diagnostic_readonly_${stamp}.json`);
  const txtPath = path.join(auditDir, `production_diagnostic_readonly_${stamp}.txt`);
  const text = renderText(report);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(txtPath, `${text}\n`, 'utf8');

  console.log(`\n${text}`);
  console.log(`Diagnostic JSON: ${jsonPath}`);
  console.log(`Diagnostic TXT: ${txtPath}`);
  process.exitCode = report.database.integrity === 'ok' ? 0 : 20;
}

try {
  main();
} catch (error) {
  console.error(`\nDIAGNOSTIC ERROR: ${error?.stack || error?.message || error}`);
  console.log('DATABASE MODIFIED: NO');
  process.exitCode = 20;
}
