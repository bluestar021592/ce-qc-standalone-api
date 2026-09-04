import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

import { migrateDatabase } from './migrations.js';
import { applyStoragePolicy, ensureStorageLayout, resolveStorageLayout } from './storagePolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const EXPORT_WORKER_MODE = String(process.env.CE_QC_EXPORT_WORKER_MODE || '').toUpperCase();
const IS_EXPORT_WORKER = EXPORT_WORKER_MODE === 'SINGLE_BUSINESS_DIRECT' || EXPORT_WORKER_MODE === 'ALL_BUSINESS_ORCHESTRATOR';
const SQLITE_CACHE_KIB = Math.max(8 * 1024, Math.min(256 * 1024, Number(process.env.SQLITE_CACHE_KIB || (IS_EXPORT_WORKER ? 8 * 1024 : 64 * 1024))));
const SQLITE_MMAP_BYTES = Math.max(0, Math.min(1024 * 1024 * 1024, Number(process.env.SQLITE_MMAP_BYTES ?? (IS_EXPORT_WORKER ? 0 : 256 * 1024 * 1024))));
const SQLITE_WAL_AUTOCHECKPOINT_PAGES = Math.max(1000, Math.min(16000, Number(process.env.SQLITE_WAL_AUTOCHECKPOINT_PAGES || 4000)));
const SQLITE_JOURNAL_SIZE_LIMIT = Math.max(16 * 1024 * 1024, Math.min(256 * 1024 * 1024, Number(process.env.SQLITE_JOURNAL_SIZE_LIMIT || 64 * 1024 * 1024)));
const SQLITE_TEMP_STORE = String(process.env.SQLITE_TEMP_STORE || (IS_EXPORT_WORKER ? 'FILE' : 'MEMORY')).toUpperCase() === 'FILE' ? 'FILE' : 'MEMORY';

let db = null;
let initialized = false;
let expectedSchemaVersion = null;

export function getRuntimeConfig() {
  applyStoragePolicy({ baseDir: projectRoot });
  const layout = resolveStorageLayout({ baseDir: projectRoot });
  const accessMode = String(process.env.ACCESS_MODE || 'DUAL').toUpperCase();
  const host = accessMode === 'DUAL' ? (process.env.HOST || '0.0.0.0') : '127.0.0.1';
  const port = Number(process.env.PORT || 5177);
  return {
    projectRoot,
    host,
    port,
    dataDir: layout.dataRoot,
    runtimeDir: layout.runtimeRoot,
    dbFile: layout.dbFile,
    backupsDir: layout.backupsDir,
    exportsDir: layout.exportsDir,
    longJsonExportsDir: path.join(layout.exportsDir, 'long_json'),
    importsDir: layout.importsDir,
    logsDir: layout.logsDir,
    evidenceArchiveDir: layout.evidenceArchiveDir,
    legacyEvidenceArchiveDir: layout.legacyEvidenceArchiveDir,
    tempDir: layout.tempDir,
    tokenDir: layout.tokenDir,
    tokenFile: path.join(layout.tokenDir, 'token.json'),
    storagePolicyId: layout.id,
    dataDisk: layout.dataDisk,
    runtimeDisk: layout.runtimeDisk,
    usingFallbackDataDir: layout.usingDataFallback,
    dataPathWarning: layout.usingDataFallback
      ? `首选数据盘不可用，数据库已安全回退到 ${layout.dataRoot}。`
      : ''
  };
}

export function getDb() {
  if (!db) {
    const cfg = getRuntimeConfig();
    ensureRuntimeDirs(cfg);
    maybeCopyLegacyDatabase(cfg);
    db = new DatabaseSync(cfg.dbFile);

    db.exec('PRAGMA busy_timeout = 3000');
    let journalMode = '';
    try { journalMode = String(db.prepare('PRAGMA journal_mode').get()?.journal_mode || '').toLowerCase(); } catch {}
    if (journalMode !== 'wal') {
      try { db.exec('PRAGMA journal_mode = WAL'); }
      catch (error) { console.warn('[CE-QC][DB] WAL mode switch deferred:', error?.message || error); }
    }
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    configurePerformancePragmas(db);
  }
  if (!initialized) {
    const expected = getExpectedSchemaVersion();
    const current = readCurrentSchemaVersion(db);
    if (!expected || current !== expected) migrateDatabase(db, getRuntimeConfig());
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
  ensureStorageLayout({
    id: cfg.storagePolicyId,
    dataRoot: cfg.dataDir,
    runtimeRoot: cfg.runtimeDir,
    dbFile: cfg.dbFile,
    backupsDir: cfg.backupsDir,
    exportsDir: cfg.exportsDir,
    importsDir: cfg.importsDir,
    logsDir: cfg.logsDir,
    evidenceArchiveDir: cfg.evidenceArchiveDir,
    tempDir: cfg.tempDir,
    tokenDir: cfg.tokenDir
  });
  fs.mkdirSync(cfg.longJsonExportsDir, { recursive: true });
}

function configurePerformancePragmas(database) {
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
