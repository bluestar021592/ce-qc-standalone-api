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
  let trackedDeletedBytes = 0;
  const now = nowIso();
  for (const row of rows) {
    const resolved = path.resolve(row.filePath || '');
    try {
      ensureBackupFileTarget(resolved, cfg);
      if (fs.existsSync(resolved)) {
        trackedDeletedBytes += fs.statSync(resolved).size;
        fs.rmSync(resolved, { force: false });
      }
      db.prepare("UPDATE backup_records SET status='DELETED',deletedAt=?,deletedBy=? WHERE id=?").run(now, String(deletedBy || ''), row.id);
      deleted.push({ id: row.id, fileName: row.fileName });
    } catch (error) {
      db.prepare("UPDATE backup_records SET status='DELETE_FAILED' WHERE id=?").run(row.id);
      failed.push({ id: row.id, fileName: row.fileName, error: error.message });
    }
  }
  const trackedPaths = new Set(rows.map((row) => path.resolve(row.filePath || '')).filter(Boolean));
  const orphanResult = deleteUntrackedBackupFiles(cfg, trackedPaths);
  return {
    deletedCount: deleted.length + orphanResult.deleted.length,
    trackedDeletedCount: deleted.length,
    orphanDeletedCount: orphanResult.deleted.length,
    deletedBytes: trackedDeletedBytes + orphanResult.deletedBytes,
    failedCount: failed.length + orphanResult.failed.length,
    deleted: [...deleted, ...orphanResult.deleted],
    failed: [...failed, ...orphanResult.failed]
  };
}

export function getBackupStorageSummary() {
  const cfg = getRuntimeConfig();
  const files = listBackupFiles(cfg.backupsDir);
  return {
    directory: cfg.backupsDir,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0)
  };
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

function deleteUntrackedBackupFiles(cfg, trackedPaths) {
  const deleted = [];
  const failed = [];
  let deletedBytes = 0;
  for (const file of listBackupFiles(cfg.backupsDir)) {
    if (trackedPaths.has(file.path) && !fs.existsSync(file.path)) continue;
    try {
      ensureBackupFileTarget(file.path, cfg);
      fs.rmSync(file.path, { force: true });
      deletedBytes += file.size;
      deleted.push({ fileName: path.relative(cfg.backupsDir, file.path), orphan: !trackedPaths.has(file.path) });
    } catch (error) {
      failed.push({ fileName: path.relative(cfg.backupsDir, file.path), error: error.message });
    }
  }
  removeEmptyBackupDirectories(cfg.backupsDir, cfg.backupsDir);
  return { deleted, failed, deletedBytes };
}

function listBackupFiles(root) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push({ path: path.resolve(target), size: fs.statSync(target).size });
    }
  };
  visit(root);
  return files;
}

function removeEmptyBackupDirectories(directory, root) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) removeEmptyBackupDirectories(path.join(directory, entry.name), root);
  }
  if (path.resolve(directory) !== path.resolve(root) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}

function safeName(value) {
  return String(value || 'backup').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
}
