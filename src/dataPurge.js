import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

import { getDb, getRuntimeConfig, nowIso } from './db.js';
import { BUSINESS_DATA_TABLES, resetAppState } from './store.js';
import { recordBackup } from './backup.js';
import { schedulerStateForTests } from './carryoverRefreshScheduler.js';

export const PURGE_PHRASE = '永久清除全部业务数据';
const PURGE_BLOCK_KEY = 'data_purge_block_until';
const challenges = new Map();

export async function createPurgeChallenge(user = {}, options = {}) {
  const db = getDb();
  // Block any NEW automatic carry refresh immediately, then wait for a refresh
  // that may already have been in-flight before the administrator clicked clear.
  // JavaScript execution is single-threaded up to the first await, so this closes
  // the start-race without introducing another database writer.
  setPurgeBlock(db, Date.now() + 20 * 60_000);
  try {
    await waitForCarryRefreshIdle();
    const createdAt = Date.now();
    const expiresAt = createdAt + 10 * 60_000;
    setPurgeBlock(db, expiresAt);
    reconcileRunLocks(db, options.activeRunIds);
    assertIntegrity(db);
    const counts = tableCounts(db);
    const backup = await createVerifiedPreClearBackup(user.email || '');
    const challengeId = crypto.randomUUID();
    challenges.set(challengeId, { email: user.email || '', backup, createdAt, expiresAt, counts });
    return {
      challengeId,
      notBefore: new Date(createdAt + 5000).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      databasePath: getRuntimeConfig().dbFile,
      counts,
      backup: { path: backup.filePath, sha256: backup.sha256, size: backup.size, integrity: backup.integrity },
      deleteScope: ['日报及解析行', '运单、扫描和轨迹', 'run/checkpoint/snapshot', 'carry和POD锁', '趋势、缓存、通知及导出文件', '遗留动态刷新运行时间戳'],
      retainedScope: ['数据库结构和迁移', '用户、角色与系统设置', '最新门店白名单', '审计日志', '清除前备份']
    };
  } catch (error) {
    clearPurgeBlock(db);
    throw error;
  }
}

export async function executePurge({ challengeId, phrase, backupConfirmed, user = {}, activeRunIds = null }) {
  const challenge = challenges.get(String(challengeId || ''));
  if (!challenge || challenge.expiresAt < Date.now() || challenge.email !== (user.email || '')) throw new Error('清除验证已失效，请重新开始。');
  if (Date.now() - challenge.createdAt < 5000) throw new Error('请等待5秒倒计时完成。');
  if (!backupConfirmed) throw new Error('请勾选“我已确认自动备份成功”。');
  if (String(phrase || '') !== PURGE_PHRASE) throw new Error(`请输入完整确认短语：${PURGE_PHRASE}`);

  const db = getDb();
  // Challenge creation already waited for the carry scheduler and holds the
  // purge block. Recheck before the destructive transaction for defense in depth.
  await waitForCarryRefreshIdle();
  reconcileRunLocks(db, activeRunIds);
  await verifyBackup(challenge.backup);
  const before = tableCounts(db);
  resetAppState({ logs: [] });
  clearBusinessRuntimeMeta(db);
  const after = tableCounts(db);
  const fileCleanupWarnings = clearRegenerableFiles();
  assertIntegrity(db);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  if (String(process.env.VACUUM_AFTER_PURGE || '').toLowerCase() === 'true') db.exec('VACUUM');
  challenges.delete(String(challengeId || ''));
  return { backup: challenge.backup, before, after, completedAt: nowIso(), event: 'DATA_RESET', integrity: 'ok', walCheckpoint: 'TRUNCATE', fileCleanupWarnings };
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
  const schemaMeta = Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value || 0);
  const pragmaSchema = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
  const manifest = {
    createdAt: nowIso(), reason: 'clear-all-business-data', databasePath: cfg.dbFile,
    backupPath: filePath, sha256, size: backupSize, sourceSize, systemVersion: process.env.npm_package_version || '0.1.0',
    migrationVersion: schemaMeta || pragmaSchema,
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

function setPurgeBlock(db, expiresAt) {
  db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`)
    .run(PURGE_BLOCK_KEY, String(expiresAt), nowIso());
}
function clearPurgeBlock(db) { db.prepare('DELETE FROM app_meta WHERE key=?').run(PURGE_BLOCK_KEY); }

async function waitForCarryRefreshIdle(timeoutMs = 15 * 60_000) {
  const started = Date.now();
  while (schedulerStateForTests().inFlight) {
    if (Date.now() - started >= timeoutMs) {
      throw new Error('遗留异常自动刷新长时间未结束，系统已安全停止本次清除，没有修改业务数据。');
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

function clearBusinessRuntimeMeta(db) {
  // Fresh-start must not inherit a prior data set's dynamic carry-refresh clock,
  // and the transient purge block must disappear immediately after completion.
  // Schema/app/user/system/whitelist/backup metadata is intentionally retained.
  db.prepare("DELETE FROM app_meta WHERE key LIKE 'carry_refresh_%' OR key=?").run(PURGE_BLOCK_KEY);
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
function clearRegenerableFiles() {
  const cfg = getRuntimeConfig();
  const warnings = [];
  for (const dir of [cfg.exportsDir, cfg.importsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      try { fs.rmSync(path.join(dir, entry), { recursive: true, force: true }); }
      catch (error) { warnings.push(`${entry}: ${error?.message || String(error)}`); }
    }
  }
  fs.mkdirSync(cfg.longJsonExportsDir, { recursive: true });
  return warnings;
}
