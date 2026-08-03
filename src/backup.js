import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { getDb, getRuntimeConfig, nowIso } from './db.js';

export function createDatabaseBackup(reason = 'manual') {
  const cfg = getRuntimeConfig();
  if (!fs.existsSync(cfg.dbFile)) return null;
  fs.mkdirSync(cfg.backupsDir, { recursive: true });
  getDb().exec('PRAGMA wal_checkpoint(FULL)');
  const stamp = nowIso().replace(/[:.]/g, '-');
  const fileName = reason === 'before-full-clear'
    ? `backup_before_full_clear_${stamp}.db`
    : reason === 'before-clear-state'
      ? `backup_before_clear_${stamp}.db`
    : `ce_qc_monitor_${safeName(reason)}_${stamp}.db`;
  const filePath = path.join(cfg.backupsDir, fileName);
  fs.copyFileSync(cfg.dbFile, filePath);

  recordBackup({
    backupType: 'database',
    fileName,
    filePath,
    fileHash: fileHash(filePath),
    reason
  });
  return filePath;
}

export function recordBackup(row = {}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO backup_records(backupType, fileName, filePath, fileHash, reason, createdAt)
    VALUES(?, ?, ?, ?, ?, ?)
  `).run(
    row.backupType || '',
    row.fileName || '',
    row.filePath || '',
    row.fileHash || '',
    row.reason || '',
    nowIso()
  );
}

export function listBackups(limit = 50) {
  const db = getDb();
  return db.prepare('SELECT * FROM backup_records ORDER BY id DESC LIMIT ?').all(Number(limit || 50));
}

export function recordExport(row = {}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO export_records(reportDate, exportType, fileName, fileHash, rowCount, summaryJson, consistencyJson, createdAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.reportDate || '',
    row.exportType || '',
    row.fileName || '',
    row.fileHash || '',
    Number(row.rowCount || 0),
    JSON.stringify(row.summary || {}),
    JSON.stringify(row.consistency || {}),
    nowIso()
  );
}

export function fileHash(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function safeName(value) {
  return String(value || 'backup').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
}
