import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

import { getDb, getRuntimeConfig, nowIso } from './db.js';
import { BUSINESS_DATA_TABLES, resetAppState } from './store.js';
import { recordBackup } from './backup.js';

export const PURGE_PHRASE = '永久清除全部业务数据';
const challenges = new Map();

export async function createPurgeChallenge(user = {}, options = {}) {
  const db = getDb();
  reconcileRunLocks(db, options.activeRunIds);
  assertIntegrity(db);
  const counts = tableCounts(db);
  const backup = await createVerifiedPreClearBackup(user.email || '');
  const challengeId = crypto.randomUUID();
  const createdAt = Date.now();
  challenges.set(challengeId, { email: user.email || '', backup, createdAt, expiresAt: createdAt + 10 * 60_000, counts });
  return {
    challengeId,
    notBefore: new Date(createdAt + 5000).toISOString(),
    expiresAt: new Date(createdAt + 10 * 60_000).toISOString(),
    databasePath: getRuntimeConfig().dbFile,
    counts,
    backup: { path: backup.filePath, sha256: backup.sha256, size: backup.size, integrity: backup.integrity },
    deleteScope: ['日报及解析行', '运单、扫描和轨迹', 'run/checkpoint/snapshot', 'carry和POD锁', '趋势、缓存、通知及导出文件'],
    retainedScope: ['数据库结构和迁移', '用户、角色与系统设置', '最新门店白名单', '审计日志', '清除前备份']
  };
}

export async function executePurge({ challengeId, phrase, backupConfirmed, user = {}, activeRunIds = null }) {
  const challenge = challenges.get(String(challengeId || ''));
  if (!challenge || challenge.expiresAt < Date.now() || challenge.email !== (user.email || '')) throw new Error('清除验证已失效，请重新开始。');
  if (Date.now() - challenge.createdAt < 5000) throw new Error('请等待5秒倒计时完成。');
  if (!backupConfirmed) throw new Error('请勾选“我已确认自动备份成功”。');
  if (String(phrase || '') !== PURGE_PHRASE) throw new Error(`请输入完整确认短语：${PURGE_PHRASE}`);

  const db = getDb();
  reconcileRunLocks(db, activeRunIds);
  await verifyBackup(challenge.backup);
  const before = tableCounts(db);
  resetAppState({ logs: [] });
  const after = tableCounts(db);
  clearRegenerableFiles();
  assertIntegrity(db);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  if (String(process.env.VACUUM_AFTER_PURGE || '').toLowerCase() === 'true') db.exec('VACUUM');
  challenges.delete(String(challengeId || ''));
  return { backup: challenge.backup, before, after, completedAt: nowIso(), event: 'DATA_RESET', integrity: 'ok', walCheckpoint: 'TRUNCATE' };
}

export function getPurgeCounts() { return tableCounts(getDb()); }

async function createVerifiedPreClearBackup(adminEmail) {
  const cfg = getRuntimeConfig();
  const db = getDb();
  assertIntegrity(db);
  db.exec('PRAGMA wal_checkpoint(FULL)');
  const stamp = localStamp();
  const dir = path.join(cfg.backupsDir, 'pre_clear', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'ce_qc_monitor.db');
  const sourceSize = fs.statSync(cfg.dbFile).size;
  assertFreeSpace(dir, sourceSize);
  await fs.promises.copyFile(cfg.dbFile, filePath);
  const backupSize = fs.statSync(filePath).size;
  if (backupSize <= 0 || backupSize !== sourceSize) throw new Error('备份文件大小校验失败，已停止清除。');
  const sha256 = await hashFileStream(filePath);
  const manifest = {
    createdAt: nowIso(), reason: 'clear-all-business-data', databasePath: cfg.dbFile,
    backupPath: filePath, sha256, size: backupSize, sourceSize, systemVersion: process.env.npm_package_version || '0.1.0',
    migrationVersion: Number(db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get()?.value || 0),
    whitelistVersion: db.prepare("SELECT version FROM shop_whitelist_versions WHERE active=1 ORDER BY createdAt DESC LIMIT 1").get()?.version || '',
    administrator: adminEmail, counts: tableCounts(db)
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  const verified = await verifyBackup({ filePath, sha256, size: backupSize });
  recordBackup({ backupType: 'database', fileName: path.basename(filePath), filePath, fileHash: sha256, reason: 'before-full-clear' });
  return { directory: dir, filePath, sha256, size: backupSize, integrity: verified.integrity, manifestPath: path.join(dir, 'manifest.json') };
}

async function verifyBackup(backup) {
  if (!backup?.filePath || !fs.existsSync(backup.filePath)) throw new Error('自动备份不存在，已停止清除。');
  const size = fs.statSync(backup.filePath).size;
  if (size <= 0 || (backup.size && size !== backup.size)) throw new Error('自动备份大小校验失败，已停止清除。');
  if (await hashFileStream(backup.filePath) !== backup.sha256) throw new Error('自动备份SHA-256校验失败，已停止清除。');
  const copy = new DatabaseSync(backup.filePath, { readOnly: true });
  let integrity = '';
  try { integrity = copy.prepare('PRAGMA integrity_check').get()?.integrity_check || ''; if (integrity !== 'ok') throw new Error('备份数据库完整性校验失败，已停止清除。'); }
  finally { copy.close(); }
  return { integrity, size };
}

function tableCounts(db) {
  const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  return Object.fromEntries(BUSINESS_DATA_TABLES.filter(name => existing.has(name)).map(name => [name, Number(db.prepare(`SELECT COUNT(*) count FROM ${name}`).get()?.count || 0)]));
}

function reconcileRunLocks(db, activeRunIds) {
  const active = activeRunIds instanceof Set ? activeRunIds : new Set(activeRunIds || []);
  const main = db.prepare("SELECT reportDate,runId FROM run_locks WHERE status IN ('running','paused','paused_write')").all();
  const business = db.prepare("SELECT businessType,reportDate,runId FROM business_run_locks WHERE status IN ('running','paused','paused_write')").all();
  const genuinelyActive = [...main, ...business].find(row => active.has(row.runId));
  if (genuinelyActive) throw new Error(`当前存在活动任务，不能清除。runId：${genuinelyActive.runId}`);

  if (!main.length && !business.length) return;
  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE run_locks SET status='interrupted',currentStage='服务重启后由管理员终止',errorMessage='stale process lock cleared before full data purge',updatedAt=? WHERE status IN ('running','paused','paused_write')").run(now);
    db.prepare("UPDATE business_run_locks SET status='interrupted',currentStage='服务重启后由管理员终止',errorMessage='stale process lock cleared before full data purge',updatedAt=? WHERE status IN ('running','paused','paused_write')").run(now);
    db.prepare("UPDATE run_checkpoints SET status='INTERRUPTED',updatedAt=? WHERE status IN ('RUNNING','PROCESSING')").run(now);
    db.prepare("UPDATE business_run_checkpoints SET status='interrupted',errorMessage='stale process lock cleared before full data purge',updatedAt=? WHERE status='running'").run(now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function assertIntegrity(db) { if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('SQLite完整性检查未通过。'); }
export function hashFileStream(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file, { highWaterMark: 8 * 1024 * 1024 });
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}
function assertFreeSpace(targetDir, sourceSize) {
  const disk = fs.statfsSync(targetDir);
  const available = Number(disk.bavail) * Number(disk.bsize);
  const required = Math.ceil(sourceSize * 1.1) + 256 * 1024 * 1024;
  if (available < required) throw new Error(`备份磁盘空间不足：至少需要 ${required} 字节，当前可用 ${available} 字节。`);
}
function localStamp() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
function clearRegenerableFiles() { const cfg = getRuntimeConfig(); for (const dir of [cfg.exportsDir, cfg.importsDir]) { if (!fs.existsSync(dir)) continue; for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true }); } fs.mkdirSync(cfg.longJsonExportsDir, { recursive: true }); }
