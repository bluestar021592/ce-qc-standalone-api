import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

import { migrateDatabase } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = 'D:\\CE CCSL金边数据库';
const EXPORT_WORKER_MODE = String(process.env.CE_QC_EXPORT_WORKER_MODE || '').toUpperCase();
const IS_EXPORT_WORKER = EXPORT_WORKER_MODE === 'SINGLE_BUSINESS_DIRECT' || EXPORT_WORKER_MODE === 'ALL_BUSINESS_ORCHESTRATOR';
const IS_PURGE_EXECUTE_WORKER = String(process.env.CE_QC_PURGE_EXECUTE_CHILD || '') === '1';
const SQLITE_CACHE_KIB = Math.max(8 * 1024, Math.min(256 * 1024, Number(process.env.SQLITE_CACHE_KIB || (IS_EXPORT_WORKER ? 8 * 1024 : 64 * 1024))));
const SQLITE_MMAP_BYTES = Math.max(0, Math.min(1024 * 1024 * 1024, Number(process.env.SQLITE_MMAP_BYTES ?? (IS_EXPORT_WORKER ? 0 : 256 * 1024 * 1024))));
const SQLITE_WAL_AUTOCHECKPOINT_PAGES = Math.max(1000, Math.min(16000, Number(process.env.SQLITE_WAL_AUTOCHECKPOINT_PAGES || 4000)));
const SQLITE_JOURNAL_SIZE_LIMIT = Math.max(16 * 1024 * 1024, Math.min(256 * 1024 * 1024, Number(process.env.SQLITE_JOURNAL_SIZE_LIMIT || 64 * 1024 * 1024)));
const SQLITE_TEMP_STORE = String(process.env.SQLITE_TEMP_STORE || (IS_EXPORT_WORKER ? 'FILE' : 'MEMORY')).toUpperCase() === 'FILE' ? 'FILE' : 'MEMORY';

let db = null;
let initialized = false;
let expectedSchemaVersion = null;

function normalizedExactDbPath(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const resolved = path.resolve(text);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertPurgeExecuteDbPathBinding(cfg) {
  if (!IS_PURGE_EXECUTE_WORKER) return;
  const sealed = String(process.env.CE_QC_PURGE_SEALED_DB_FILE || '').trim();
  if (!sealed) throw new Error('V505_PURGE_EXECUTE_SEALED_DB_PATH_REQUIRED: destructive worker has no validated sealed database path; SQLite will not be opened.');
  if (normalizedExactDbPath(cfg.dbFile) !== normalizedExactDbPath(sealed)) {
    throw new Error(`V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED: destructive worker runtime database path differs from the validated sealed path; SQLite will not be opened. sealed=${sealed} current=${cfg.dbFile}`);
  }
}

export function getRuntimeConfig() {
  const preferredDataDir = resolveProjectPath(process.env.DATA_DIR || DEFAULT_DATA_DIR);
  const fallbackDataDir = resolveProjectPath('./data');
  const dataRootAvailable = isPathRootAvailable(preferredDataDir);
  const dataDir = dataRootAvailable ? preferredDataDir : fallbackDataDir;
  const fallbackWarning = dataRootAvailable
    ? ''
    : '未检测到D盘，当前数据临时保存到项目data目录。建议检查数据保存路径。';
  const preferredDbFile = resolveProjectPath(process.env.DB_FILE || path.join(dataDir, 'ce_qc_monitor.db'));
  const dbFile = isPathRootAvailable(preferredDbFile) ? preferredDbFile : path.join(fallbackDataDir, 'ce_qc_monitor.db');
  const exportsDir = process.env.EXPORTS_DIR ? resolveProjectPath(process.env.EXPORTS_DIR) : path.join(dataDir, 'exports');
  const backupsDir = process.env.BACKUPS_DIR ? resolveProjectPath(process.env.BACKUPS_DIR) : path.join(dataDir, 'backups');
  const importsDir = process.env.IMPORTS_DIR ? resolveProjectPath(process.env.IMPORTS_DIR) : path.join(dataDir, 'imports');
  const logsDir = process.env.LOGS_DIR ? resolveProjectPath(process.env.LOGS_DIR) : path.join(dataDir, 'logs');
  const evidenceArchiveDir = process.env.EVIDENCE_ARCHIVE_DIR ? resolveProjectPath(process.env.EVIDENCE_ARCHIVE_DIR) : path.join(dataDir, 'evidence_archive');
  const accessMode = String(process.env.ACCESS_MODE || 'DUAL').toUpperCase();
  const host = accessMode === 'DUAL' ? (process.env.HOST || '0.0.0.0') : '127.0.0.1';
  const port = Number(process.env.PORT || 5177);
  return {
    projectRoot,
    host,
    port,
    dataDir,
    dbFile,
    backupsDir,
    exportsDir,
    longJsonExportsDir: path.join(exportsDir, 'long_json'),
    importsDir,
    logsDir,
    evidenceArchiveDir,
    tokenDir: path.join(dataDir, 'token'),
    tokenFile: path.join(dataDir, 'token', 'token.json'),
    usingFallbackDataDir: !dataRootAvailable,
    dataPathWarning: fallbackWarning
  };
}

export function getDb() {
  if (!db) {
    const cfg = getRuntimeConfig();
    // The destructive worker receives this environment binding only after its
    // PREPARE/challenge/manifest path evidence has been verified. Re-check it
    // here, inside the DB layer and before runtime directories or SQLite are
    // opened, so even a last-moment drive/fallback change cannot redirect the
    // destructive process to a different database.
    assertPurgeExecuteDbPathBinding(cfg);
    ensureRuntimeDirs(cfg);
    if (IS_PURGE_EXECUTE_WORKER) {
      // A destructive worker must operate only on the exact source DB that was
      // previously backed up/sealed. Never copy a legacy DB and never let
      // DatabaseSync create a replacement file when the source disappeared.
      if (!fs.existsSync(cfg.dbFile)) throw new Error('V505_PURGE_EXECUTE_SOURCE_MISSING: sealed source database is missing; destructive worker will not create or restore a replacement database.');
      const sourceStat = fs.statSync(cfg.dbFile);
      if (!sourceStat.isFile() || Number(sourceStat.size || 0) <= 0) throw new Error('V505_PURGE_EXECUTE_SOURCE_INVALID: sealed source database is not a valid non-empty file.');
    } else {
      maybeCopyLegacyDatabase(cfg);
    }
    db = new DatabaseSync(cfg.dbFile);

    // Configure lock handling before any pragma that might need a write lock.
    // Re-applying journal_mode=WAL on every process open can block for tens of
    // seconds when a stale reader/supervisor still exists. Read first and only
    // switch modes when the database is genuinely not already WAL.
    db.exec('PRAGMA busy_timeout = 3000');
    let journalMode = '';
    try { journalMode = String(db.prepare('PRAGMA journal_mode').get()?.journal_mode || '').toLowerCase(); } catch {}
    if (journalMode !== 'wal') {
      if (IS_PURGE_EXECUTE_WORKER) {
        try { db.close(); } catch {}
        db = null;
        throw new Error(`V505_PURGE_EXECUTE_DB_MODE_UNSAFE: destructive worker requires existing WAL mode; current mode=${journalMode || 'unknown'}. No journal-mode change was attempted.`);
      }
      try { db.exec('PRAGMA journal_mode = WAL'); }
      catch (error) { console.warn('[CE-QC][DB] WAL mode switch deferred:', error?.message || error); }
    }
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    // The destructive purge worker must not run tuning pragmas before verifying
    // the sealed source fingerprint. Its connection inherits the existing DB
    // mode and performs no startup optimization that could change source files.
    if (!IS_PURGE_EXECUTE_WORKER) configurePerformancePragmas(db);
  }
  if (!initialized) {
    const expected = getExpectedSchemaVersion();
    const current = readCurrentSchemaVersion(db);
    if (!expected || current !== expected) {
      if (IS_PURGE_EXECUTE_WORKER) {
        const currentText = Number.isFinite(current) ? String(current) : 'unknown';
        try { db.close(); } catch {}
        db = null;
        throw new Error(`V505_PURGE_EXECUTE_SCHEMA_MISMATCH: destructive worker will not migrate the sealed source database (current=${currentText}, expected=${expected || 'unknown'}).`);
      }
      migrateDatabase(db, getRuntimeConfig());
    }
    initialized = true;
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    initialized = false;
  }
}

export function resolveProjectPath(value) {
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(projectRoot, value);
}

export function nowIso() {
  return new Date().toISOString();
}

export function ensureRuntimeDirs(cfg = getRuntimeConfig()) {
  for (const dir of [cfg.dataDir, cfg.backupsDir, cfg.exportsDir, cfg.longJsonExportsDir, cfg.importsDir, cfg.logsDir, cfg.evidenceArchiveDir, cfg.tokenDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function configurePerformancePragmas(database) {
  // Export workers deliberately use a much smaller SQLite footprint so a large
  // historical Excel export cannot starve the web/API process. The main process
  // keeps the original performance settings when CE_QC_EXPORT_WORKER_MODE is unset.
  const statements = [
    `PRAGMA cache_size = -${Math.round(SQLITE_CACHE_KIB)}`,
    `PRAGMA temp_store = ${SQLITE_TEMP_STORE}`,
    `PRAGMA mmap_size = ${Math.round(SQLITE_MMAP_BYTES)}`,
    `PRAGMA wal_autocheckpoint = ${Math.round(SQLITE_WAL_AUTOCHECKPOINT_PAGES)}`,
    `PRAGMA journal_size_limit = ${Math.round(SQLITE_JOURNAL_SIZE_LIMIT)}`
  ];
  for (const statement of statements) {
    try { database.exec(statement); }
    catch (error) { console.warn('[CE-QC][DB] optional performance pragma skipped:', statement, error?.message || error); }
  }
}

function getExpectedSchemaVersion() {
  if (Number.isInteger(expectedSchemaVersion) && expectedSchemaVersion > 0) return expectedSchemaVersion;
  try {
    const source = fs.readFileSync(path.join(__dirname, 'migrations.js'), 'utf8');
    const match = source.match(/\bSCHEMA_VERSION\s*=\s*(\d+)/);
    expectedSchemaVersion = match ? Number(match[1]) : 0;
  } catch {
    expectedSchemaVersion = 0;
  }
  return expectedSchemaVersion;
}

function readCurrentSchemaVersion(database) {
  try {
    const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_meta' LIMIT 1").get();
    if (exists) {
      const row = database.prepare("SELECT value FROM app_meta WHERE key='db_schema_version' LIMIT 1").get();
      if (row?.value !== undefined && row?.value !== null && String(row.value).trim() !== '') return Number(row.value || 0);
    }
    return Number(database.prepare('PRAGMA user_version').get()?.user_version || 0);
  } catch {
    return -1;
  }
}

function maybeCopyLegacyDatabase(cfg) {
  const legacyDb = path.join(projectRoot, 'data', 'ce_qc_monitor.db');
  if (path.normalize(cfg.dbFile) === path.normalize(legacyDb)) return;
  if (fs.existsSync(cfg.dbFile) || !fs.existsSync(legacyDb)) return;
  fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true });
  fs.copyFileSync(legacyDb, cfg.dbFile);
  for (const suffix of ['-wal', '-shm']) {
    const src = `${legacyDb}${suffix}`;
    if (fs.existsSync(src)) fs.copyFileSync(src, `${cfg.dbFile}${suffix}`);
  }
}

function isPathRootAvailable(targetPath) {
  const parsed = path.parse(path.resolve(targetPath));
  if (!parsed.root) return true;
  return fs.existsSync(parsed.root);
}
