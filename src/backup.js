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
  return db.prepare("SELECT * FROM backup_records WHERE COALESCE(status,'ACTIVE')='ACTIVE' ORDER BY id DESC LIMIT ?").all(Number(limit || 50));
}

export function deleteBackup(backupId, deletedBy = '') {
  const db = getDb();
  const item = db.prepare("SELECT * FROM backup_records WHERE id=? AND COALESCE(status,'ACTIVE')='ACTIVE'").get(Number(backupId || 0));
  if (!item) throw new Error('未找到可删除的备份。');
  const cfg = getRuntimeConfig();
  const resolved = path.resolve(item.filePath || '');
  ensureBackupFileTarget(resolved, cfg);
  if (!fs.existsSync(resolved) || fileHash(resolved) !== item.fileHash) throw new Error('备份文件校验失败，请刷新备份状态后重试。');
  try {
    fs.rmSync(resolved, { force: false });
  } catch (error) {
    db.prepare("UPDATE backup_records SET status='DELETE_FAILED' WHERE id=?").run(item.id);
    throw new Error(`备份文件删除失败：${error.message}`);
  }
  db.prepare("UPDATE backup_records SET status='DELETED',deletedAt=?,deletedBy=? WHERE id=?").run(nowIso(), String(deletedBy || ''), item.id);
  return { id: item.id, fileName: item.fileName, deletedAt: nowIso() };
}

export function deleteAllBackups(deletedBy = '') {
  const db = getDb();
  const cfg = getRuntimeConfig();
  const rows = db.prepare("SELECT * FROM backup_records WHERE COALESCE(status,'ACTIVE')='ACTIVE' ORDER BY id").all();
  const deleted = [];
  const failed = [];
  const now = nowIso();
  for (const row of rows) {
    const resolved = path.resolve(row.filePath || '');
    try {
      ensureBackupFileTarget(resolved, cfg);
      if (fs.existsSync(resolved)) fs.rmSync(resolved, { force: false });
      db.prepare("UPDATE backup_records SET status='DELETED',deletedAt=?,deletedBy=? WHERE id=?").run(now, String(deletedBy || ''), row.id);
      deleted.push({ id: row.id, fileName: row.fileName });
    } catch (error) {
      db.prepare("UPDATE backup_records SET status='DELETE_FAILED' WHERE id=?").run(row.id);
      failed.push({ id: row.id, fileName: row.fileName, error: error.message });
    }
  }
  return { deletedCount: deleted.length, failedCount: failed.length, deleted, failed };
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

function ensureBackupFileTarget(resolved, cfg) {
  const backupRoot = path.resolve(cfg.backupsDir) + path.sep;
  if (!resolved.startsWith(backupRoot)) throw new Error('备份文件不在受控目录。');
  if (resolved === path.resolve(cfg.dbFile)) throw new Error('禁止删除正式SQLite数据库。');
}

function safeName(value) {
  return String(value || 'backup').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
}
