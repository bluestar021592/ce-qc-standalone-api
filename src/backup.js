import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { getDb, getRuntimeConfig, nowIso } from './db.js';

export const V502_MULTI_DRIVE_BACKUP_CLEANUP_ID='2026-09-10-v502-cd-ce-backup-cleanup-v1';

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
  const roots = managedBackupRoots(cfg);
  const safety = newestVerifiedSafetyBackup(roots, cfg);
  const retainedDir = safety?.directory ? path.resolve(safety.directory) : '';
  const rows = db.prepare("SELECT * FROM backup_records WHERE COALESCE(status,'ACTIVE')='ACTIVE' ORDER BY id").all();
  const deleted = [];
  const failed = [];
  const retained = [];
  const deletedByDrive = new Map();
  let trackedDeletedBytes = 0;
  const now = nowIso();

  for (const row of rows) {
    const resolved = path.resolve(row.filePath || '');
    try {
      ensureBackupFileTarget(resolved, cfg);
      if (retainedDir && isInsideOrSame(resolved, retainedDir)) {
        retained.push({ id: row.id, fileName: row.fileName, reason: 'LATEST_VERIFIED_SAFETY_BACKUP' });
        continue;
      }
      if (fs.existsSync(resolved)) {
        const bytes = Number(fs.statSync(resolved).size || 0);
        fs.rmSync(resolved, { force: false });
        trackedDeletedBytes += bytes;
        addDriveBytes(deletedByDrive, resolved, bytes);
      }
      db.prepare("UPDATE backup_records SET status='DELETED',deletedAt=?,deletedBy=? WHERE id=?").run(now, String(deletedBy || ''), row.id);
      deleted.push({ id: row.id, fileName: row.fileName });
    } catch (error) {
      db.prepare("UPDATE backup_records SET status='DELETE_FAILED' WHERE id=?").run(row.id);
      failed.push({ id: row.id, fileName: row.fileName, error: error.message });
    }
  }

  const trackedPaths = new Set(rows.map((row) => path.resolve(row.filePath || '')).filter(Boolean));
  const orphanResult = deleteManagedBackupFiles({ cfg, roots, trackedPaths, retainedDir, deletedByDrive });
  const deletedBytes = trackedDeletedBytes + orphanResult.deletedBytes;
  return {
    patchId: V502_MULTI_DRIVE_BACKUP_CLEANUP_ID,
    deletedCount: deleted.length + orphanResult.deleted.length,
    trackedDeletedCount: deleted.length,
    orphanDeletedCount: orphanResult.deleted.length,
    deletedBytes,
    failedCount: failed.length + orphanResult.failed.length,
    retainedCount: safety ? 1 : 0,
    retainedSafetyBackup: safety ? {
      directory: safety.directory,
      filePath: safety.filePath,
      createdAt: safety.createdAt,
      size: safety.size,
      reason: safety.reason,
      drive: driveLabel(safety.filePath)
    } : null,
    driveBreakdown: [...deletedByDrive.entries()].map(([drive, bytes]) => ({ drive, deletedBytes: bytes })).sort((a,b)=>a.drive.localeCompare(b.drive)),
    deleted: [...deleted, ...orphanResult.deleted],
    retained,
    failed: [...failed, ...orphanResult.failed]
  };
}

export function getBackupStorageSummary() {
  const cfg = getRuntimeConfig();
  const roots = managedBackupRoots(cfg);
  const rootSummaries = roots.map((root) => {
    const files = listBackupFiles(root.path);
    return {
      kind: root.kind,
      directory: root.path,
      drive: driveLabel(root.path),
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0)
    };
  });
  const byDrive = new Map();
  for (const root of rootSummaries) {
    const current = byDrive.get(root.drive) || { drive: root.drive, fileCount: 0, totalBytes: 0 };
    current.fileCount += Number(root.fileCount || 0);
    current.totalBytes += Number(root.totalBytes || 0);
    byDrive.set(root.drive, current);
  }
  const safety = newestVerifiedSafetyBackup(roots, cfg);
  return {
    patchId: V502_MULTI_DRIVE_BACKUP_CLEANUP_ID,
    directory: cfg.backupsDir,
    fileCount: rootSummaries.reduce((sum, row) => sum + Number(row.fileCount || 0), 0),
    totalBytes: rootSummaries.reduce((sum, row) => sum + Number(row.totalBytes || 0), 0),
    roots: rootSummaries,
    driveBreakdown: [...byDrive.values()].sort((a,b)=>a.drive.localeCompare(b.drive)),
    retainedSafetyBackup: safety ? { directory: safety.directory, filePath: safety.filePath, createdAt: safety.createdAt, size: safety.size, reason: safety.reason, drive: driveLabel(safety.filePath) } : null
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

function managedBackupRoots(cfg) {
  const values = [
    { kind: 'DATA_BACKUPS', path: path.resolve(cfg.backupsDir) },
    { kind: 'LAUNCHER_PRE_UPDATE', path: managedLauncherBackupRoot(cfg) }
  ];
  const seen = new Set();
  return values.filter((item) => {
    const key = pathKey(item.path);
    if (!item.path || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function managedLauncherBackupRoot(cfg) {
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  if (localAppData) return path.resolve(localAppData, 'CE_QC_LAUNCHER', 'backups', 'pre_update');
  return path.resolve(cfg.projectRoot || '.', '.ce-qc-launcher', 'backups', 'pre_update');
}

function newestVerifiedSafetyBackup(roots, cfg) {
  const candidates = [];
  for (const root of roots) {
    if (!fs.existsSync(root.path)) continue;
    for (const manifestPath of listManifestFiles(root.path)) {
      const candidate = verifiedManifestCandidate(manifestPath, roots, cfg);
      if (candidate) candidates.push(candidate);
    }
  }
  candidates.sort((a,b)=>Number(b.createdAtMs || 0)-Number(a.createdAtMs || 0));
  return candidates[0] || null;
}

function verifiedManifestCandidate(manifestPath, roots, cfg) {
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return null; }
  const integrity = String(manifest?.integrity || '');
  const sha256 = String(manifest?.sha256 || '');
  if (!['ok','quick-ok'].includes(integrity) || !/^[a-f0-9]{64}$/i.test(sha256)) return null;
  const manifestDir = path.dirname(path.resolve(manifestPath));
  const filePath = path.resolve(String(manifest?.backupPath || path.join(manifestDir, 'ce_qc_monitor.db')));
  if (!isInsideAnyRoot(filePath, roots) || samePath(filePath, cfg.dbFile)) return null;
  if (!isInsideOrSame(filePath, manifestDir)) return null;
  let stat = null;
  try { stat = fs.statSync(filePath); } catch { return null; }
  if (!stat.isFile() || stat.size <= 0) return null;
  if (Number(manifest?.size || 0) > 0 && Number(manifest.size) !== Number(stat.size)) return null;
  const createdAtMs = Date.parse(String(manifest?.createdAt || '')) || Number(stat.mtimeMs || 0);
  return {
    directory: manifestDir,
    filePath,
    createdAt: String(manifest?.createdAt || ''),
    createdAtMs,
    size: Number(stat.size || 0),
    reason: String(manifest?.reason || '')
  };
}

function deleteManagedBackupFiles({ cfg, roots, trackedPaths, retainedDir, deletedByDrive }) {
  const deleted = [];
  const failed = [];
  let deletedBytes = 0;
  for (const root of roots) {
    if (!fs.existsSync(root.path)) continue;
    for (const file of listBackupFiles(root.path)) {
      if (retainedDir && isInsideOrSame(file.path, retainedDir)) continue;
      if (trackedPaths.has(file.path) && !fs.existsSync(file.path)) continue;
      try {
        ensureManagedDeletionTarget(file.path, roots, cfg);
        fs.rmSync(file.path, { force: true });
        deletedBytes += Number(file.size || 0);
        addDriveBytes(deletedByDrive, file.path, Number(file.size || 0));
        deleted.push({ fileName: path.relative(root.path, file.path), root: root.kind, drive: driveLabel(file.path), orphan: !trackedPaths.has(file.path) });
      } catch (error) {
        failed.push({ fileName: path.relative(root.path, file.path), root: root.kind, error: error.message });
      }
    }
    removeEmptyBackupDirectories(root.path, root.path, retainedDir);
  }
  return { deleted, failed, deletedBytes };
}

function ensureBackupFileTarget(resolved, cfg) {
  const backupRoot = path.resolve(cfg.backupsDir);
  if (!isInsideOrSame(resolved, backupRoot) || samePath(resolved, backupRoot)) throw new Error('备份文件不在受控目录。');
  protectFormalDatabase(resolved, cfg);
}

function ensureManagedDeletionTarget(resolved, roots, cfg) {
  if (!isInsideAnyRoot(resolved, roots)) throw new Error('文件不在CE受控备份目录。');
  protectFormalDatabase(resolved, cfg);
}

function protectFormalDatabase(resolved, cfg) {
  const protectedPaths = [cfg.dbFile, `${cfg.dbFile}-wal`, `${cfg.dbFile}-shm`].map(path.resolve);
  if (protectedPaths.some((value)=>samePath(resolved, value))) throw new Error('禁止删除正式SQLite数据库及其WAL/SHM。');
}

function listManifestFiles(root) {
  if (!root || !fs.existsSync(root)) return [];
  const result = [];
  const visit = (directory) => {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.toLowerCase() === 'manifest.json') result.push(path.resolve(target));
    }
  };
  visit(root);
  return result;
}

function listBackupFiles(root) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        try { files.push({ path: path.resolve(target), size: Number(fs.statSync(target).size || 0) }); } catch {}
      }
    }
  };
  visit(root);
  return files;
}

function removeEmptyBackupDirectories(directory, root, retainedDir='') {
  if (!fs.existsSync(directory)) return;
  if (retainedDir && samePath(directory, retainedDir)) return;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) removeEmptyBackupDirectories(path.join(directory, entry.name), root, retainedDir);
  }
  try {
    if (!samePath(directory, root) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  } catch {}
}

function isInsideAnyRoot(value, roots) {
  return roots.some((root)=>isInsideOrSame(value, root.path));
}

function isInsideOrSame(value, root) {
  const targetKey = pathKey(path.resolve(value));
  const rootResolved = path.resolve(root);
  const rootKey = pathKey(rootResolved);
  return targetKey === rootKey || targetKey.startsWith(pathKey(rootResolved + path.sep));
}

function samePath(a,b) { return pathKey(path.resolve(a)) === pathKey(path.resolve(b)); }
function pathKey(value) { return process.platform === 'win32' ? String(value).toLowerCase() : String(value); }
function driveLabel(value) { return path.parse(path.resolve(value)).root || path.resolve(value); }
function addDriveBytes(map, filePath, bytes) {
  const drive = driveLabel(filePath);
  map.set(drive, Number(map.get(drive) || 0) + Number(bytes || 0));
}

function safeName(value) {
  return String(value || 'backup').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
}
