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

let db = null;
let initialized = false;

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
  const accessMode = String(process.env.ACCESS_MODE || 'DUAL').toUpperCase();
  const host = accessMode === 'DUAL' ? (process.env.HOST || '0.0.0.0') : '127.0.0.1';
  const port = Number(process.env.PORT || 5177);
  return {
    projectRoot,
    host,
    port,
    dataDir,
    dbFile,
    backupsDir: path.join(dataDir, 'backups'),
    exportsDir: process.env.EXPORTS_DIR ? resolveProjectPath(process.env.EXPORTS_DIR) : path.join(dataDir, 'exports'),
    longJsonExportsDir: path.join(process.env.EXPORTS_DIR ? resolveProjectPath(process.env.EXPORTS_DIR) : path.join(dataDir, 'exports'), 'long_json'),
    importsDir: path.join(dataDir, 'imports'),
    logsDir: path.join(dataDir, 'logs'),
    tokenDir: path.join(dataDir, 'token'),
    tokenFile: path.join(dataDir, 'token', 'token.json'),
    usingFallbackDataDir: !dataRootAvailable,
    dataPathWarning: fallbackWarning
  };
}

export function getDb() {
  if (!db) {
    const cfg = getRuntimeConfig();
    ensureRuntimeDirs(cfg);
    maybeCopyLegacyDatabase(cfg);
    db = new DatabaseSync(cfg.dbFile);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
  }
  if (!initialized) {
    migrateDatabase(db, getRuntimeConfig());
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
  for (const dir of [cfg.dataDir, cfg.backupsDir, cfg.exportsDir, cfg.longJsonExportsDir, cfg.importsDir, cfg.logsDir, cfg.tokenDir]) {
    fs.mkdirSync(dir, { recursive: true });
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
