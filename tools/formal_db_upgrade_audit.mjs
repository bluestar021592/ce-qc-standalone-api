import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

import { closeDb, getDb, getRuntimeConfig } from '../src/db.js';

const cfg = getRuntimeConfig();
const evidenceDir = path.join(cfg.projectRoot, 'data', 'unique_20260802_acceptance', 'formal_db');
fs.mkdirSync(evidenceDir, { recursive: true });
const reportFile = path.join(evidenceDir, 'formal_db_upgrade_audit.json');
const previousReport = readJson(reportFile);

const before = inspectDatabase(cfg.dbFile);
const backupsBefore = listBackups(cfg.backupsDir);

getDb();
closeDb();

const after = inspectDatabase(cfg.dbFile);
const backupsAfter = listBackups(cfg.backupsDir);
const newBackups = backupsAfter.filter(file => !backupsBefore.includes(file));
const countChanges = compareCounts(before.counts, after.counts);
const requiredColumns = inspectColumns(cfg.dbFile, {
  business_daily_parse_rows: ['recipient_raw', 'recipient_normalized', 'recipient_group', 'recipient_group_reason', 'source_row_number'],
  business_carry_bills: ['recipient_raw', 'recipient_normalized', 'recipient_group', 'recipient_group_reason', 'source_row_number'],
  business_scan_results: ['recipient_raw', 'recipient_normalized', 'recipient_group', 'recipient_group_reason', 'source_row_number'],
  business_final_rows: ['recipient_raw', 'recipient_normalized', 'recipient_group', 'recipient_group_reason', 'source_row_number']
});

const result = {
  ok: after.integrity === 'ok'
    && after.userVersion === 10
    && after.tables.includes('business_recipient_conflicts')
    && Object.values(requiredColumns).every(value => value.ok)
    && preservedCountsOk(countChanges),
  databaseFile: cfg.dbFile,
  before,
  after,
  newBackups,
  countChanges,
  requiredColumns,
  checkedAt: new Date().toISOString()
};

if (previousReport?.before?.userVersion < previousReport?.after?.userVersion) {
  const historical = {
    ...previousReport,
    ok: previousReport.after.integrity === 'ok'
      && previousReport.after.userVersion === 10
      && previousReport.after.tables.includes('business_recipient_conflicts')
      && Object.values(previousReport.requiredColumns || {}).every(value => value.ok)
      && preservedCountsOk(previousReport.countChanges || []),
    countPolicy: '业务数据表必须保持相等；app_meta、backup_records、migration_log仅允许追加迁移元数据。'
  };
  fs.writeFileSync(path.join(evidenceDir, 'formal_db_upgrade_v9_to_v10.json'), JSON.stringify(historical, null, 2), 'utf8');
}
fs.writeFileSync(reportFile, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ ...result, reportFile }, null, 2));
if (!result.ok) process.exitCode = 1;

function inspectDatabase(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const counts = {};
    for (const table of tables) counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get()?.count || 0);
    return {
      exists: fs.existsSync(dbFile),
      size: fs.statSync(dbFile).size,
      userVersion: Number(db.prepare('PRAGMA user_version').get()?.user_version || 0),
      integrity: String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || ''),
      tables,
      counts
    };
  } finally {
    db.close();
  }
}

function inspectColumns(dbFile, expected) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return Object.fromEntries(Object.entries(expected).map(([table, columns]) => {
      const actual = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(row => row.name);
      const missing = columns.filter(column => !actual.includes(column));
      return [table, { ok: !missing.length, missing, actual: columns.filter(column => actual.includes(column)) }];
    }));
  } finally {
    db.close();
  }
}

function compareCounts(before, after) {
  return Object.keys(before).sort().map(table => ({ table, before: before[table], after: Number(after[table] || 0) }));
}

function preservedCountsOk(changes) {
  const appendOnlyMetadata = new Set(['app_meta', 'backup_records', 'migration_log']);
  return changes.every(change => appendOnlyMetadata.has(change.table)
    ? change.after >= change.before
    : change.after === change.before);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.db')).sort();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
