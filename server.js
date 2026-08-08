import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';

import { CEClient, normalizeLoginToken } from './src/ceClient.js';
import { parseDailyExcel } from './src/excelParser.js';
import { parseLongBackupModules } from './src/backupParser.js';
import { parseShopeeDailyExcel } from './src/shopeeExcelParser.js';
import { parseUnifiedDailyExcel } from './src/unifiedExcelParser.js';
import { completeUnifiedSnapshot, getLatestUnifiedImport, getUnifiedProcessingQueue, listUnifiedImportHistory, loadUnifiedBusinessState, loadUnifiedPeriodBusinessState, saveUnifiedImport, updateCarryoverResults } from './src/unifiedImportStore.js';
import { loadLightweightAggregateState, loadLightweightUnifiedBusinessState } from './src/lightweightDashboardStore.js';
import { summarizeLightweightCcslState, summarizeLightweightShopeeState } from './src/lightweightDashboardSummary.js';
import { runQcPipeline } from './src/pipeline.js';
import { exportDailyParseXlsx, exportXlsx } from './src/exporter.js';
import { exportShopeeXlsx } from './src/shopeeExporter.js';
import { exportPeriodReports } from './src/periodExporter.js';
import { cleanMainBills, loadState, saveState, resetState } from './src/storage.js';
import { clearToken, loadToken, saveToken, summarizeToken } from './src/authStore.js';
import { buildCoreKpis, buildCriticalDashboard, buildDashboardData, buildDashboardRows, buildDetailTabs, safeFinalRows } from './src/reporting.js';
import { createDatabaseBackup, deleteAllBackups, deleteBackup, fileHash, getBackupStorageSummary, listBackups, recordBackup, recordExport } from './src/backup.js';
import { closeDb, ensureRuntimeDirs, getDb, getRuntimeConfig } from './src/db.js';
import { createOrRecoverRun, getCurrentReportDate, getDbStatus, getRunStatus, listExportRecords, loadDetail, resetRunForReport, updateRunLock } from './src/store.js';
import { buildConsistencyReport } from './src/consistency.js';
import { getShopCodeSummary, importShopCodesFromWorkbook } from './src/shopCodes.js';
import { appendRuntimeLog } from './src/runtimeLog.js';
import { createDashboardSnapshot, getMatchingSnapshot, getSnapshotById, listSnapshotHistory, repairSnapshotFromStoredData } from './src/snapshots.js';
import { appendHistorySummary, buildLongBackupV2 } from './src/longBackup.js';
import { mergeBackupModule } from './src/backupRecovery.js';
import { buildShopeeDashboard } from './src/shopeeReporting.js';
import { analyzeShopeeShipment, SHOPEE_ANALYSIS_RULE_VERSION } from './src/shopeeAnalyzer.js';
import { queryBatchWithFallback, splitTrackBatches } from './src/trackBatching.js';
import {
  accessIdentity, auditAction, publicUser, requireBusinessScope, requireRole, sameOriginWriteGuard, validateAccessConfiguration
} from './src/accessControl.js';
import {
  SHOPEE, createOrRecoverBusinessRun, getBusinessCurrentReportDate, getBusinessRunStatus,
  getBusinessSnapshotById, getMatchingBusinessSnapshot, invalidateBusinessSnapshots, listBusinessHistoryDates, loadBusinessDetail, loadBusinessState, recordBusinessExport,
  resetBusinessRunForReport, saveBusinessSnapshot, saveBusinessState, updateBusinessRunLock
} from './src/businessStore.js';
import { createPurgeChallenge, executePurge } from './src/dataPurge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
validateAccessConfiguration();
const initialRuntimeConfig = getRuntimeConfig();
ensureRuntimeDirs(initialRuntimeConfig);
const upload = multer({
  dest: initialRuntimeConfig.importsDir,
  limits: { fileSize: 80 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    callback(ext && ['.xls', '.xlsx', '.json'].includes(ext) ? null : new Error('仅支持 .xls、.xlsx 或 .json 文件'), Boolean(ext && ['.xls', '.xlsx', '.json'].includes(ext)));
  }
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(accessIdentity);
app.use(sameOriginWriteGuard);
app.use('/api/shopee', requireBusinessScope('SHOPEE'));
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const adminOnly = /(?:ce-login|ce-logout|clear|reset|backup|settings|users)/i.test(req.path);
  return requireRole(adminOnly ? 'ADMIN' : 'OPERATOR')(req, res, next);
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use((req, res, next) => {
  if (/\.(?:html|js|css)$/i.test(req.path) || req.path === '/' || !path.extname(req.path)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const client = new CEClient();
const activeRunIds = new Set();
const eventClients = new Set();

app.get('/detail', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'detail.html'));
});

app.get(['/ce', '/tbkh', '/ali1688', '/shopeecn', '/shopeevn', '/ccsl', '/shopee', '/tracking', '/exceptions', '/reports', '/import', '/settings', '/logs', '/data-management'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', async (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    ok: true,
    version: '0.1.0-shopee-track-user-delete-v2',
    patchId: '2026-08-08-v22-memory-safe-dashboard',
    time: new Date().toISOString(),
    db: getDbStatus(),
    memory: {
      rssMB: Math.round(memory.rss / 1024 / 1024),
      heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
    }
  });
});

app.get('/api/session', (req, res) => {
  res.json({ ok: true, user: publicUser(req.user), unreadNotifications: 0 });
});

app.get('/api/admin/users', requireRole('ADMIN'), (req, res) => {
  const includeDeleted = String(req.query?.includeDeleted || '') === '1';
  const rows = getDb().prepare(`SELECT id,username,displayName,departmentCompany,email,role,businessScope,enabled,status,expiresAt,mustChangePassword,failedLoginCount,lockedUntil,lastLoginAt,createdAt,updatedAt,deletedAt,deletedBy FROM users ${includeDeleted ? '' : "WHERE status='ACTIVE'"} ORDER BY CASE WHEN status='ACTIVE' THEN 0 ELSE 1 END, enabled DESC, username`).all();
  res.json({ ok: true, rows });
});

app.post('/api/admin/users', requireRole('ADMIN'), async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const displayName = String(req.body?.displayName || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = ['VIEWER', 'OPERATOR', 'ADMIN'].includes(String(req.body?.role || '').toUpperCase()) ? String(req.body.role).toUpperCase() : 'VIEWER';
  const businessScope = ['CCSL', 'SHOPEE', 'ALL'].includes(String(req.body?.businessScope || '').toUpperCase()) ? String(req.body.businessScope).toUpperCase() : 'ALL';
  const temporaryPassword = String(req.body?.temporaryPassword || '');
  if (!/^[a-z0-9_.-]{1,60}$/.test(username) || !displayName || temporaryPassword.length < 10) return res.status(400).json({ ok: false, error: '用户名、姓名和至少10位临时密码为必填项。' });
  try {
    const bcrypt = await import('bcryptjs');
    const hash = bcrypt.default.hashSync(temporaryPassword, 12);
    const now = new Date().toISOString();
    const row = getDb().prepare(`INSERT INTO users(username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,expiresAt,mustChangePassword,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,1,?,?) RETURNING id,username,displayName,departmentCompany,email,role,businessScope,enabled,expiresAt,mustChangePassword,createdAt`)
      .get(username, displayName, String(req.body?.departmentCompany || '').trim().slice(0, 120), email || null, hash, role, businessScope, req.body?.enabled === false ? 0 : 1, String(req.body?.expiresAt || '').trim() || null, now, now);
    auditAction(req, 'USER_CREATED', { username, role, businessScope });
    res.json({ ok: true, user: row, temporaryPasswordShownOnce: true });
  } catch { res.status(409).json({ ok: false, error: '用户名或邮箱已存在。' }); }
});

app.patch('/api/admin/users/:id', requireRole('ADMIN'), (req, res) => {
  const id = Number(req.params.id || 0);
  const existing = getDb().prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: '用户不存在。' });
  const role = ['VIEWER', 'OPERATOR', 'ADMIN'].includes(String(req.body?.role || existing.role).toUpperCase()) ? String(req.body?.role || existing.role).toUpperCase() : existing.role;
  const businessScope = ['CCSL', 'SHOPEE', 'ALL'].includes(String(req.body?.businessScope || existing.businessScope).toUpperCase()) ? String(req.body?.businessScope || existing.businessScope).toUpperCase() : existing.businessScope;
  getDb().prepare('UPDATE users SET displayName=?,departmentCompany=?,email=?,role=?,businessScope=?,enabled=?,expiresAt=?,updatedAt=? WHERE id=?').run(
    String(req.body?.displayName ?? existing.displayName).trim().slice(0, 80), String(req.body?.departmentCompany ?? existing.departmentCompany).trim().slice(0, 120), String(req.body?.email ?? existing.email).trim().toLowerCase() || null, role, businessScope, req.body?.enabled === undefined ? existing.enabled : (req.body.enabled ? 1 : 0), String((req.body?.expiresAt ?? existing.expiresAt) || '').trim() || null, new Date().toISOString(), id
  );
  if (req.body?.enabled === false) getDb().prepare('UPDATE user_sessions SET revokedAt=? WHERE userId=? AND revokedAt IS NULL').run(new Date().toISOString(), id);
  auditAction(req, req.body?.enabled === false ? 'USER_DISABLED' : 'USER_UPDATED', { username: existing.username, role, businessScope });
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/reset-password', requireRole('ADMIN'), async (req, res) => {
  const id = Number(req.params.id || 0); const password = String(req.body?.temporaryPassword || '');
  if (password.length < 10) return res.status(400).json({ ok: false, error: '临时密码至少10位。' });
  const user = getDb().prepare('SELECT username FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ ok: false, error: '用户不存在。' });
  const bcrypt = await import('bcryptjs'); const now = new Date().toISOString();
  getDb().prepare('UPDATE users SET passwordHash=?,mustChangePassword=1,failedLoginCount=0,lockedUntil=NULL,updatedAt=? WHERE id=?').run(bcrypt.default.hashSync(password, 12), now, id);
  getDb().prepare('UPDATE user_sessions SET revokedAt=? WHERE userId=? AND revokedAt IS NULL').run(now, id);
  auditAction(req, 'PASSWORD_RESET', { username: user.username });
  res.json({ ok: true, temporaryPasswordShownOnce: true });
});

app.post('/api/admin/users/:id/revoke-sessions', requireRole('ADMIN'), (req, res) => {
  const id = Number(req.params.id || 0); const now = new Date().toISOString();
  getDb().prepare('UPDATE user_sessions SET revokedAt=? WHERE userId=? AND revokedAt IS NULL').run(now, id);
  auditAction(req, 'SESSION_REVOKED', { userId: id }); res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireRole('ADMIN'), (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, code: 'INVALID_USER_ID', error: '用户编号无效。' });
    }

    const db = getDb();
    const target = db.prepare("SELECT * FROM users WHERE id=? AND COALESCE(status,'ACTIVE')='ACTIVE'").get(id);
    if (!target) {
      return res.status(404).json({ ok: false, code: 'USER_NOT_FOUND', error: '用户不存在或已经删除。' });
    }

    const currentUserId = Number(req.user?.id || 0);
    if (currentUserId === id) {
      return res.status(400).json({ ok: false, code: 'CANNOT_DELETE_SELF', error: '不能删除当前正在登录的管理员账号。' });
    }

    if (String(target.role || '').toUpperCase() === 'ADMIN') {
      const adminRow = db.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE COALESCE(status,'ACTIVE')='ACTIVE' AND enabled=1 AND UPPER(role)='ADMIN'"
      ).get();
      if (Number(adminRow?.count || 0) <= 1) {
        return res.status(400).json({ ok: false, code: 'LAST_ADMIN_PROTECTED', error: '不能删除最后一个启用的管理员。' });
      }
    }

    const confirmation = String(req.body?.username || '').trim().toLowerCase();
    const expectedUsername = String(target.username || '').trim().toLowerCase();
    if (!confirmation || confirmation !== expectedUsername) {
      return res.status(400).json({
        ok: false,
        code: 'USERNAME_CONFIRMATION_MISMATCH',
        error: `请输入完整用户名 ${target.username} 进行确认。`
      });
    }

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const update = db.prepare(
        "UPDATE users SET status='DELETED',enabled=0,deletedAt=?,deletedBy=?,updatedAt=? WHERE id=? AND COALESCE(status,'ACTIVE')='ACTIVE'"
      ).run(now, currentUserId || null, now, id);

      if (Number(update?.changes || 0) !== 1) {
        throw new Error('用户状态已发生变化，请刷新页面后重试。');
      }

      db.prepare(
        'UPDATE user_sessions SET revokedAt=? WHERE userId=? AND revokedAt IS NULL'
      ).run(now, id);

      auditAction(req, 'USER_SOFT_DELETED', {
        userId: id,
        username: target.username
      });

      db.exec('COMMIT');
    } catch (transactionError) {
      try { db.exec('ROLLBACK'); } catch {}
      throw transactionError;
    }

    return res.json({
      ok: true,
      deletedUser: {
        id,
        username: target.username,
        status: 'DELETED'
      }
    });
  } catch (error) {
    const message = error?.message || '未知错误';
    void appendRuntimeLog(`[USER_DELETE_FAILED] userId=${req.params.id || ''} operator=${req.user?.username || ''} error=${message}`);
    return res.status(500).json({
      ok: false,
      code: 'USER_DELETE_FAILED',
      error: `删除用户失败：${message}`
    });
  }
});

app.post('/api/admin/users/:id/restore', requireRole('ADMIN'), (req, res) => {
  const id = Number(req.params.id || 0);
  const user = getDb().prepare("SELECT * FROM users WHERE id=? AND status='DELETED'").get(id);
  if (!user) return res.status(404).json({ ok: false, error: '未找到已删除用户。' });
  getDb().prepare("UPDATE users SET status='ACTIVE',enabled=1,deletedAt=NULL,deletedBy=NULL,mustChangePassword=1,updatedAt=? WHERE id=?").run(new Date().toISOString(), id);
  auditAction(req, 'USER_RESTORED', { userId: id, username: user.username });
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id/permanent', requireRole('ADMIN'), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: '用户编号无效。' });
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id=? AND status='DELETED'").get(id);
  if (!user) return res.status(404).json({ ok: false, error: '仅已删除用户可以永久删除。' });
  const confirmation = String(req.body?.username || '').trim().toLowerCase();
  if (confirmation !== String(user.username || '').trim().toLowerCase()) {
    return res.status(400).json({ ok: false, error: `请输入完整用户名 ${user.username} 进行确认。` });
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM user_sessions WHERE userId=?').run(id);
    const removed = db.prepare("DELETE FROM users WHERE id=? AND status='DELETED'").run(id);
    if (Number(removed.changes || 0) !== 1) throw new Error('用户状态已变化，请刷新后重试。');
    auditAction(req, 'USER_PERMANENTLY_DELETED', { userId: id, username: user.username });
    db.exec('COMMIT');
    res.json({ ok: true, deletedUser: { id, username: user.username } });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    res.status(500).json({ ok: false, error: `永久删除用户失败：${error.message}` });
  }
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const connection = { res };
  eventClients.add(connection);
  res.write('event: READY\ndata: {}\n\n');
  req.on('close', () => eventClients.delete(connection));
});

app.get('/api/ce-auth-status', async (req, res) => {
  const token = await loadToken();
  res.json({ ok: true, authStatus: summarizeToken(token) });
});

app.post('/api/ce-login', requireRole('ADMIN'), async (req, res) => {
  const authStatus = summarizeToken(await loadToken());
  try {
    const tenantId = String(req.body?.tenantId || '000000').trim() || '000000';
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const grant_type = String(req.body?.grant_type || 'password').trim() || 'password';
    const scope = String(req.body?.scope || 'all').trim() || 'all';
    const type = String(req.body?.type || 'account').trim() || 'account';

    if (!username || !password) {
      res.status(400).json({ ok: false, error: '请输入CE账号和密码', authStatus });
      return;
    }
    if (!hasEnv('CE_AUTHORIZATION')) {
      res.status(400).json({ ok: false, error: '请先在 .env 配置 CE_AUTHORIZATION 基础认证', authStatus });
      return;
    }

    const raw = await client.login({ tenantId, username, password, grant_type, scope, type });
    throwIfCeAuthFailed(raw);
    const token = normalizeLoginToken(raw, { tenantId, username });
    await saveToken(token);
    auditAction(req, 'CE_LOGIN', { result: 'success' });

    res.json({ ok: true, authStatus: summarizeToken(token) });
  } catch (e) {
    const ce = normalizeApiError(e);
    res.status(500).json({
      ok: false,
      error: ce.ceMsg ? `CE登录失败：${ce.ceMsg}` : (ce.message || 'CE登录失败'),
      ceStatus: ce.ceStatus,
      ceCode: ce.ceCode,
      ceMsg: ce.ceMsg,
      authStatus
    });
  }
});

app.post('/api/ce-logout', requireRole('ADMIN'), async (req, res) => {
  await clearToken();
  auditAction(req, 'CE_LOGOUT', { result: 'success' });
  res.json({ ok: true, authStatus: summarizeToken(null) });
});

app.post('/api/auth/login', (req, res) => res.redirect(307, '/api/ce-login'));
app.post('/api/auth/logout', (req, res) => res.redirect(307, '/api/ce-logout'));

app.get('/api/state', async (req, res) => {
  const state = loadLightweightAggregateState('CCSL');
  const summary = summarizeLightweightCcslState(state, {
    dbStatus: getDbStatus(),
    network: buildNetworkInfo(getRuntimeConfig()),
    shopCodes: getShopCodeSummary()
  });
  res.json({ ok: true, state: req.query.compact === '1' ? compactDashboardState(summary) : summary });
});

app.get('/api/unified-history', (req, res) => {
  res.json({ ok: true, rows: listUnifiedImportHistory(req.query.limit) });
});

const periodDashboardCache = new Map();

app.get('/api/period-dashboard', (req, res) => {
  const mode = String(req.query.mode || '').toLowerCase();
  const anchor = String(req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !['weekly', 'monthly'].includes(mode)) {
    return res.status(400).json({ ok: false, error: '请选择有效日期和周/月周期' });
  }
  const date = new Date(`${anchor}T12:00:00+07:00`);
  let fromDate;
  let toDate;
  if (mode === 'weekly') {
    const mondayOffset = (date.getDay() + 6) % 7;
    const start = new Date(date); start.setDate(start.getDate() - mondayOffset);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    fromDate = localIsoDate(start); toDate = localIsoDate(end);
  } else {
    fromDate = `${anchor.slice(0, 7)}-01`;
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
    toDate = localIsoDate(end);
  }
  const cacheKey = `${mode}:${fromDate}:${toDate}`;
  const cached = periodDashboardCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 5 * 60 * 1000) return res.json(cached.payload);
  const types = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];
  const states = Object.fromEntries(types.map(type => [type, loadUnifiedPeriodBusinessState(type, fromDate, toDate)]));
  const payload = { ok: true, mode, anchor, fromDate, toDate, states };
  periodDashboardCache.set(cacheKey, { createdAt: Date.now(), payload });
  res.json(payload);
});

app.get('/api/shopee/state', async (req, res) => {
  const state = loadLightweightAggregateState('SHOPEE');
  const summary = summarizeLightweightShopeeState(state, { dbStatus: getDbStatus() });
  res.json({ ok: true, state: req.query.compact === '1' ? compactDashboardState(summary) : summary });
});

app.get('/api/business-state/:businessType', (req, res) => {
  try {
    const source = loadLightweightUnifiedBusinessState(req.params.businessType, String(req.query.snapshotId || ''));
    const shopee = /^SHOPEE/.test(source.businessType);
    const shopeeDashboard = shopee ? buildShopeeDashboard({ ...source, businessType: 'SHOPEE' }) : null;
    const state = shopee
      ? {
          ...source,
          businessType: 'SHOPEE',
          viewBusinessType: source.businessType,
          total: source.pnhBills?.length || 0,
          dailySummary: source.dailyParseSummary || {},
          dashboard: shopeeDashboard,
          detailTabs: shopeeDashboard.detailTabs
        }
      : { ...source, viewBusinessType: source.businessType, dashboard: buildDashboardData(source), detailTabs: buildDetailTabs(source) };
    if (!shopee) state.detailTabs.dashboard = { label: `${source.businessType}总看板`, rows: buildDashboardRows(source), total: buildDashboardRows(source).length };
    res.json({ ok: true, businessType: source.businessType, reportDate: source.reportDate, snapshotId: source.snapshotId, snapshotStatus: source.snapshotStatus, state: req.query.compact === '1' ? compactDashboardState(state) : state });
  } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
});

app.get('/api/history', async (req, res) => {
  const businessType = String(req.query.businessType || 'CCSL').toUpperCase() === SHOPEE ? SHOPEE : 'CCSL';
  const rows = businessType === SHOPEE ? listBusinessHistoryDates(SHOPEE, 90) : listSnapshotHistory(90);
  res.json({ ok: true, businessType, rows });
});

app.get('/api/snapshot/:businessType/:snapshotId', async (req, res) => {
  const businessType = String(req.params.businessType || '').toUpperCase() === SHOPEE ? SHOPEE : 'CCSL';
  const snapshot = businessType === SHOPEE
    ? getBusinessSnapshotById(SHOPEE, req.params.snapshotId)
    : getSnapshotById(req.params.snapshotId);
  if (!snapshot) return res.status(404).json({ ok: false, error: '未找到该历史快照。' });
  const state = snapshot.state || {};
  res.json({ ok: true, businessType, reportDate: snapshot.reportDate || state.reportDate || '', snapshotId: snapshot.snapshotId, state: businessType === SHOPEE ? summarizeShopeeSnapshot(snapshot) : summarizeCcslSnapshot(snapshot) });
});

app.get('/api/state/startup', async (req, res) => {
  const state = await loadState();
  res.json({
    ok: true,
    restored: true,
    db: getDbStatus(),
    state: summarizeState(state)
  });
});

app.get('/api/state/last-report', async (req, res) => {
  const state = await loadState();
  const summary = summarizeState(state);
  res.json({
    ok: true,
    reportDate: summary.reportDate,
    sourceName: summary.sourceName,
    processing: summary.processing,
    canResume: Boolean(summary.processing?.paused || summary.processing?.running || summary.scanResults || summary.trackResults),
    canExport: Boolean(summary.finalRows || summary.scanResults || summary.dailySummary),
    state: summary
  });
});

app.post('/api/admin/data-purge/prepare', requireRole('ADMIN'), async (req, res) => {
  try {
    auditAction(req, 'DATA_PURGE_REQUESTED', {});
    const challenge = await createPurgeChallenge(req.user, { activeRunIds });
    auditAction(req, 'DATA_PURGE_BACKUP_VERIFIED', { backupPath: challenge.backup.path, sha256: challenge.backup.sha256 });
    res.json({ ok: true, ...challenge, administrator: req.user.email });
  } catch (e) {
    auditAction(req, 'DATA_PURGE_FAILED', { stage: 'prepare', error: e.message });
    res.status(409).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/data-purge/execute', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await executePurge({ ...req.body, user: req.user, activeRunIds });
    auditAction(req, 'DATA_PURGE_COMPLETED', { backupPath: result.backup.filePath, before: result.before, after: result.after });
    broadcastEvent('DATA_RESET', { at: result.completedAt });
    res.json({ ok: true, ...result, state: summarizeState(await loadState()), shopeeState: summarizeShopeeState(loadBusinessState(SHOPEE)) });
  } catch (e) {
    auditAction(req, 'DATA_PURGE_FAILED', { stage: 'execute', error: e.message });
    res.status(409).json({ ok: false, error: e.message });
  }
});

app.post('/api/reset', async (req, res) => {
  return res.status(410).json({ ok: false, error: '请使用管理员“清除全部业务数据”双重确认入口。' });
  /* legacy implementation retained below but unreachable */
  try {
    const result = await resetState(req.body?.confirmText || '');
    res.json({
      ok: true,
      ...result,
      state: summarizeState(await loadState()),
      shopeeState: summarizeShopeeState(loadBusinessState(SHOPEE))
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: `清空失败：${e.message}` });
  }
});

app.post('/api/clear-logs', async (req, res) => {
  const state = await loadState();
  state.logs = [];
  await saveState(state);
  res.json({ ok: true, state: summarizeState(state) });
});

app.post('/api/pause', async (req, res) => {
  const state = await loadState();
  const reportDate = getCurrentReportDate();
  const run = reportDate ? getRunStatus(reportDate).lock : null;
  if (!run || !['running', 'paused'].includes(run.status)) {
    res.status(409).json({ ok: false, code: 'RUN_NOT_ACTIVE', error: '当前没有可暂停的处理任务。' });
    return;
  }
  state.currentRun = run;
  state.lastRunSummary = { ...(state.lastRunSummary || {}), runId: run.runId, reportDate };
  state.processing = { ...(state.processing || {}), running: false, paused: true, phase: run.currentStage || state.processing?.phase || '' };
  await saveState(state);
  updateRunLock(reportDate, 'paused');
  res.json({ ok: true, state: summarizeState(state) });
});

app.post('/api/resume', handleResumeRequest);

app.post('/api/run/pause', (req, res) => res.redirect(307, '/api/pause'));
app.post('/api/run/resume', (req, res) => res.redirect(307, '/api/resume'));

async function handleResumeRequest(req, res) {
  const reportDate = getCurrentReportDate();
  const run = reportDate ? getRunStatus(reportDate).lock : null;
  if (run?.runId && activeRunIds.has(run.runId)) {
    const state = await loadState();
    state.currentRun = run;
    state.lastRunSummary = { ...(state.lastRunSummary || {}), runId: run.runId, reportDate };
    state.processing = { ...(state.processing || {}), running: true, paused: false, error: '' };
    updateRunLock(reportDate, 'running');
    await saveState(state);
    res.json({ ok: true, resumedInProcess: true, run: { runId: run.runId, reportDate }, state: summarizeState(state) });
    return;
  }
  return executeRunRequest(req, res, { resume: true });
}

app.post('/api/import-excel', upload.single('file'), handleDailyReportImport);
app.post('/api/import/daily-report', upload.single('file'), handleDailyReportImport);
app.post('/api/import/unified-daily-report', upload.single('file'), handleUnifiedDailyImport);
app.get('/api/import/unified-latest', (req, res) => res.json({ ok: true, import: getLatestUnifiedImport() }));
app.post('/api/shopee/import-excel', upload.single('file'), handleShopeeDailyImport);
app.post('/api/import-shop-codes', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('没有收到门店CP码文件');
    const imported = importShopCodesFromWorkbook(req.file.path, req.file.originalname);
    await fs.unlink(req.file.path).catch(() => {});
    res.json({ ok: true, imported });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

async function handleDailyReportImport(req, res) {
  try {
    if (!req.file) throw new Error('没有收到Excel文件');
    const state = await loadState();
    const parsed = await parseDailyExcel(req.file.path, {
      reportDate: req.body.reportDate || '',
      originalName: req.file.originalname,
      lastReportDate: state.reportDate || state.lastRunSummary?.reportDate || ''
    });
    if (!parsed.summary?.totalRecognized) throw new Error('文件格式错误或未识别到运单号');
    if (!parsed.reportDate) throw new Error('未能自动识别日报日期，请手动选择日报归属日期。');
    state.reportDate = parsed.reportDate;
    state.daily = parsed;
    state.dailyParseSummary = parsed.summary;
    state.dailyParseRows = parsed.details;
    state.pnhBills = parsed.pnhBills;
    state.nonPnhBills = parsed.nonPnhBills;
    state.excludedBills = parsed.excludedBills;
    state.duplicateBills = parsed.duplicateBills;
    state.sourceName = req.file.originalname;
    state.scanPool = [];
    state.scanResults = [];
    state.needTrackBills = [];
    state.trackResults = [];
    state.trackEvents = [];
    state.finalRows = [];
    state.finalDiversionRows = [];
    state.nextCarryBills = [];
    state.lastRunSummary = null;
    state.lastRun = null;
    state.currentRun = null;
    state.processing = { running: false, paused: false, phase: '' };
    resetRunForReport(parsed.reportDate);
    await saveState(state);
    await fs.unlink(req.file.path).catch(() => {});
    res.json({
      ok: true,
      parsed: {
        ...parsed.summary,
        reportDate: parsed.reportDate,
        reportDateSource: parsed.reportDateSource,
        reportDateAutoDetected: parsed.reportDateAutoDetected,
        preview: parsed.preview,
        notes: parsed.notes
      },
      state: summarizeState(state)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

async function handleUnifiedDailyImport(req, res) {
  try {
    if (!req.file) throw new Error('没有收到综合日报Excel文件');
    const parsed = parseUnifiedDailyExcel(req.file.path, { reportDate: req.body.reportDate || '', originalName: req.file.originalname });
    const saved = saveUnifiedImport(parsed, req.file.originalname);
    const processingQueue = getUnifiedProcessingQueue(saved.batchId);
    const ccslRows = parsed.rows.filter(row => ['CE', 'TBKH', 'ALI1688'].includes(row.businessType));
    const shopeeRows = parsed.rows.filter(row => ['SHOPEECN', 'SHOPEEVN'].includes(row.businessType));
    const historicalCcsl = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['CE', 'TBKH', 'ALI1688'].includes(row.businessType));
    const historicalShopee = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['SHOPEECN', 'SHOPEEVN'].includes(row.businessType));
    const ccslState = await loadState();
    ccslState.reportDate = parsed.reportDate;
    ccslState.sourceName = req.file.originalname;
    ccslState.dailyReportReady = true;
    ccslState.dailyParseRows = ccslRows.map(row => ({ ...row, result: 'PNH', reason: row.classificationReason }));
    ccslState.dailyParseSummary = { totalRecognized: ccslRows.length, pnh: ccslRows.length, nonPnh: 0, excluded: 0, duplicate: parsed.summary.duplicateRows };
    ccslState.pnhBills = ccslRows.map(row => row.shipmentCode);
    ccslState.nonPnhBills = [];
    ccslState.excludedBills = [];
    ccslState.duplicateBills = [];
    clearRunResults(ccslState);
    ccslState.carryBills = historicalCcsl.map(row => row.shipmentCode);
    ccslState.priorCarryRows = historicalCcsl.map(row => safeJsonRow(row));
    resetRunForReport(parsed.reportDate);
    await saveState(ccslState);

    const shopeeState = loadBusinessState(SHOPEE);
    shopeeState.businessType = SHOPEE;
    shopeeState.reportDate = parsed.reportDate;
    shopeeState.sourceName = req.file.originalname;
    shopeeState.dailyReportReady = true;
    shopeeState.dailyParseRows = shopeeRows.map(row => ({
      ...row,
      recipient_raw: row.recipientRaw,
      recipient_normalized: row.recipientNormalized,
      recipient_group: row.businessType === 'SHOPEEVN' ? 'VN' : 'CN',
      region_code: row.regionCode,
      import_disposition: 'ACCEPTED'
    }));
    shopeeState.dailyParseSummary = {
      totalRecognized: shopeeRows.length,
      groupCounts: { CN: saved.classificationCounts.SHOPEECN, VN: saved.classificationCounts.SHOPEEVN },
      conflictCount: parsed.summary.classificationConflicts
    };
    shopeeState.pnhBills = shopeeRows.map(row => row.shipmentCode);
    clearRunResults(shopeeState);
    shopeeState.carryBills = historicalShopee.map(row => row.shipmentCode);
    shopeeState.priorCarryRows = historicalShopee.map(row => safeJsonRow(row));
    resetBusinessRunForReport(SHOPEE, parsed.reportDate);
    saveBusinessState(shopeeState, SHOPEE);
    await fs.unlink(req.file.path).catch(() => {});
    res.json({ ok: true, ...saved, carryover: processingQueue.summary, state: summarizeState(ccslState), shopeeState: summarizeShopeeState(shopeeState) });
  } catch (error) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({ ok: false, error: error.message, sheetDiagnostics: error.sheetDiagnostics || [] });
  }
}

async function handleShopeeDailyImport(req, res) {
  try {
    if (!req.file) throw new Error('没有收到SHOPEE日报Excel文件');
    const parsed = await parseShopeeDailyExcel(req.file.path, { reportDate: req.body.reportDate || '', originalName: req.file.originalname });
    const state = loadBusinessState(SHOPEE);
    state.businessType = SHOPEE;
    state.reportDate = parsed.reportDate;
    state.sourceName = req.file.originalname;
    state.dailyReportReady = true;
    state.daily = parsed;
    state.dailyParseSummary = parsed.summary;
    state.dailyParseRows = parsed.importRows;
    state.recipientConflicts = parsed.conflicts;
    state.recipientReconciliation = parsed.summary.reconciliation;
    state.pnhBills = parsed.bills;
    clearRunResults(state);
    resetBusinessRunForReport(SHOPEE, parsed.reportDate);
    saveBusinessState(state, SHOPEE);
    await fs.unlink(req.file.path).catch(() => {});
    res.json({ ok: true, parsed: { ...parsed.summary, reportDate: parsed.reportDate, preview: parsed.preview, conflicts: parsed.conflicts }, state: summarizeShopeeState(state) });
  } catch (error) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ ok: false, error: error.message });
  }
}

app.post('/api/import-backup', upload.single('file'), handleLongJsonImport);
app.post('/api/import/long-json', upload.single('file'), handleLongJsonImport);

async function handleLongJsonImport(req, res) {
  try {
    if (!req.file) throw new Error('没有收到JSON文件');
    const started = Date.now();
    const pack = JSON.parse(await fs.readFile(req.file.path, 'utf8'));
    const modules = parseLongBackupModules(pack);
    const ccslState = await loadState();
    const shopeeState = loadBusinessState(SHOPEE);
    mergeBackupModule(ccslState, modules.CCSL, { businessType: 'CCSL', importedAt: started });
    mergeBackupModule(shopeeState, modules.SHOPEE, { businessType: SHOPEE, importedAt: started });
    await saveState(ccslState);
    saveBusinessState(shopeeState, SHOPEE);
    await fs.unlink(req.file.path).catch(() => {});
    res.json({
      ok: true,
      message: '长期备份恢复完成。历史数据已写入SQLite，可直接查看；开始新的当日处理时再导入对应日报。',
      schemaVersion: modules.schemaVersion,
      imported: ccslState.backupSummary,
      modules: { CCSL: ccslState.backupSummary, SHOPEE: shopeeState.backupSummary },
      state: summarizeState(ccslState),
      shopeeState: summarizeShopeeState(shopeeState)
    });
  } catch (error) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ ok: false, error: error.message });
  }
}

app.post('/api/run', (req, res) => executeRunRequest(req, res, { resume: false }));

async function executeRunRequest(req, res, options = {}) {
  let lockedReportDate = '';
  let activeRunId = '';
  try {
    const reportDate = getCurrentReportDate();
    if (!reportDate) {
      res.status(400).json({ ok: false, code: 'REPORT_DATE_MISSING', error: '请先导入当日日报Excel。' });
      return;
    }
    const state = await loadState();
    state.reportDate = reportDate;
    const authStatus = summarizeToken(await loadToken());
    if (!authStatus.hasAccessToken) {
      res.status(400).json({ ok: false, error: '请先登录CE系统。' });
      return;
    }
    if (!(state.pnhBills || []).length) {
      const restoredLongData = Boolean((state.carryBills || []).length || (state.podLocks || []).length || state.backupImportedAt);
      res.status(400).json({
        ok: false,
        error: restoredLongData
          ? '已恢复长期数据，但还未导入当日日报Excel。请先导入当日日报后再开始处理。'
          : '请先导入当日日报Excel。'
      });
      return;
    }
    const beforeRun = getRunStatus(reportDate).lock;
    const retryableFinishedRun = beforeRun?.status === 'finished'
      && Number(state.lastRunSummary?.refreshFailed || 0) > 0;
    if (options.resume && (!beforeRun || (beforeRun.status === 'finished' && !retryableFinishedRun))) {
      res.status(409).json({
        ok: false,
        code: beforeRun?.status === 'finished' ? 'RUN_ALREADY_COMPLETED' : 'RUN_NOT_RECOVERABLE',
        error: beforeRun?.status === 'finished' ? '当前任务已经完成，不能继续处理。' : '当前没有可恢复的处理任务。'
      });
      return;
    }
    const outcome = createOrRecoverRun(reportDate, {
      lockedBy: req.ip || '',
      rejectRunning: Boolean(beforeRun?.runId && activeRunIds.has(beforeRun.runId)),
      recoverFinished: Boolean(options.resume && retryableFinishedRun)
    });
    if (!outcome.ok) {
      res.status(outcome.code === 'RUN_ALREADY_ACTIVE' ? 409 : 500).json({ ok: false, code: outcome.code, error: outcome.error, run: outcome.run || null });
      return;
    }
    const run = outcome.run;
    lockedReportDate = reportDate;
    activeRunId = run.runId;
    activeRunIds.add(activeRunId);
    if (outcome.created && beforeRun?.status === 'finished') clearRunResults(state);
    state.currentRun = run;
    state.processing = {
      ...(state.processing || {}),
      running: true,
      paused: false,
      phase: run.currentStage || '准备处理',
      batchIndex: Number(run.batchIndex || 0),
      totalBatches: Number(run.totalBatches || 0),
      runId: run.runId
    };
    state.lastRunSummary = { ...(state.lastRunSummary || {}), runId: run.runId, reportDate, runStatus: 'running' };
    await saveState(state);
    const onProgress = async (msg) => {
      state.logs = [...(state.logs || []), `[${new Date().toLocaleTimeString()}] ${msg}`].slice(-300);
      await appendRuntimeLog(msg);
      await saveState(state);
    };
    const result = await runQcPipeline({
      state,
      client,
      onProgress,
      onCheckpoint: async checkpointState => {
        checkpointState.currentRun = { ...(checkpointState.currentRun || run), runId: run.runId, reportDate };
        checkpointState.lastRunSummary = { ...(checkpointState.lastRunSummary || {}), runId: run.runId, reportDate };
        await saveState(checkpointState);
      },
      isPaused: async () => {
        const latest = await loadState();
        return Boolean(latest.processing?.paused);
      }
    });
    const dashboardSnapshotRows = buildDashboardRows(result.state);
    const criticalSnapshotRows = buildCriticalDashboard(result.state).rows;
    const coreSnapshot = buildCoreKpis(result.state);
    const metricSnapshot = {
      ...result.summary,
      totalMonitored: coreSnapshot.totalCount,
      podRate: coreSnapshot.firstPodRate,
      abnormalRate: coreSnapshot.anomalyRate,
      severeCount: coreSnapshot.severeCount,
      metrics: Object.fromEntries([
        ['总件数', coreSnapshot.totalCount],
        ['首投POD率', coreSnapshot.firstPodRate],
        ['异常率', coreSnapshot.anomalyRate],
        ['严重异常总件数', coreSnapshot.severeCount],
        ...dashboardSnapshotRows.map(row => [row.项目, row.数值]),
        ...criticalSnapshotRows.flatMap(row => [
          [row.metricKey || row.异常类型, row.数量],
          [row.异常类型, row.数量]
        ])
      ]),
      metricStatuses: Object.fromEntries([
        ['总件数', '正常'],
        ['首投POD率', coreSnapshot.firstPodRate >= 90 ? '正常' : '需跟进'],
        ['异常率', coreSnapshot.anomalyCount ? '重点关注' : '正常'],
        ['严重异常总件数', coreSnapshot.severeCount ? '严重异常' : '正常'],
        ...dashboardSnapshotRows.map(row => [row.项目, row.状态]),
        ...criticalSnapshotRows.flatMap(row => [
          [row.metricKey || row.异常类型, row.严重等级],
          [row.异常类型, row.严重等级]
        ])
      ])
    };
    result.state.historySummary = appendHistorySummary(result.state.historySummary || [], metricSnapshot);
    await saveState(result.state);
    const snapshot = createDashboardSnapshot(result.state, { reportDate, runId: run.runId });
    updateCarryoverResults({ snapshotId: snapshot.snapshotId, reportDate, rows: result.state.finalRows || [] });
    await appendRuntimeLog(`处理快照已保存：${snapshot.snapshotId}`);
    res.json({ ok: true, summary: result.summary, run: { runId: run.runId, reportDate, recovered: outcome.recovered }, snapshotId: snapshot.snapshotId, state: summarizeState(await loadState()) });
  } catch (e) {
    console.error(e);
    if (lockedReportDate) {
      const run = getRunStatus(lockedReportDate).lock;
      if (run?.status !== 'finished') updateRunLock(lockedReportDate, 'failed', e.message || String(e));
      const failedState = await loadState();
      failedState.processing = { ...(failedState.processing || {}), running: false, paused: false, error: e.message || String(e) };
      await saveState(failedState);
    }
    res.status(500).json({ ok: false, code: e.code || 'RUN_FAILED', error: e.message || '处理失败，请查看日志' });
  } finally {
    if (activeRunId) activeRunIds.delete(activeRunId);
  }
}

app.post('/api/run/start', (req, res) => executeRunRequest(req, res, { resume: false }));

app.post('/api/shopee/run/start', (req, res) => executeShopeeRunRequest(req, res, { resume: false }));
app.post('/api/shopee/run/resume', (req, res) => executeShopeeRunRequest(req, res, { resume: true }));
app.post('/api/shopee/run/pause', async (req, res) => {
  const state = loadBusinessState(SHOPEE);
  const run = state.reportDate ? getBusinessRunStatus(SHOPEE, state.reportDate).lock : null;
  if (!run || !['running', 'paused'].includes(run.status)) return res.status(409).json({ ok: false, error: 'SHOPEE当前没有可暂停任务。' });
  state.processing = { ...(state.processing || {}), running: false, paused: true, phase: run.currentStage || state.processing?.phase || '' };
  state.currentRun = run;
  updateBusinessRunLock(SHOPEE, state.reportDate, 'paused');
  saveBusinessState(state, SHOPEE);
  res.json({ ok: true, state: summarizeShopeeState(state) });
});

async function executeShopeeRunRequest(req, res, options = {}) {
  let reportDate = '';
  let runId = '';
  try {
    const state = loadBusinessState(SHOPEE);
    reportDate = getBusinessCurrentReportDate(SHOPEE);
    if (!reportDate || !state.dailyReportReady) {
      return res.status(400).json({ ok: false, code: 'REPORT_DATE_MISSING', error: '当前未导入SHOPEE当日日报Excel，请先导入后再开始处理。' });
    }
    if (!(state.pnhBills || []).length) return res.status(400).json({ ok: false, code: 'EMPTY_DAILY_REPORT', error: 'SHOPEE日报有效运单数为0，请核对日报解析结果。' });
    if (!summarizeToken(await loadToken()).hasAccessToken) return res.status(400).json({ ok: false, error: '请先登录CE系统。' });
    try {
      const probeBills = state.pnhBills.slice(0, Math.min(5, state.pnhBills.length));
      await client.confirmQuery(probeBills);
      state.apiDiagnostic = { apiName: 'otwms-order-confirm-query', method: 'POST', endpoint: '/api/otwms/order/confirm-query', bodyShape: '{shipmentCodes:[...]}', shipmentCount: probeBills.length, preflight: 'passed', checkedAt: new Date().toISOString() };
      saveBusinessState(state, SHOPEE);
    } catch (error) {
      const diagnostic = normalizeApiError(error);
      const status = Number(diagnostic.ceStatus || 0);
      const code = [401, 403].includes(status) ? 'AUTH_REQUIRED' : ([400, 422].includes(status) ? 'REQUEST_SCHEMA_INVALID' : (status === 404 ? 'ENDPOINT_INVALID' : 'CE_PREFLIGHT_FAILED'));
      const message = code === 'AUTH_REQUIRED' ? 'CE系统登录已失效，请在系统设置重新登录后点击继续处理。' : (diagnostic.ceMsg || diagnostic.message || 'CE扫描预检失败');
      state.apiDiagnostic = { apiName: 'otwms-order-confirm-query', method: 'POST', endpoint: '/api/otwms/order/confirm-query', bodyShape: '{shipmentCodes:[...]}', shipmentCount: Math.min(5, state.pnhBills.length), httpStatus: diagnostic.ceStatus || '', ceCode: diagnostic.ceCode || '', ceMsg: diagnostic.ceMsg || '', preflight: 'failed', checkedAt: new Date().toISOString() };
      state.processing = { ...(state.processing || {}), running: false, paused: code === 'AUTH_REQUIRED', error: message };
      saveBusinessState(state, SHOPEE);
      return res.status(409).json({ ok: false, code, error: message, diagnostic: state.apiDiagnostic });
    }
    const before = getBusinessRunStatus(SHOPEE, reportDate).lock;
    if (options.resume && (!before || before.status === 'finished')) return res.status(409).json({ ok: false, code: 'RUN_NOT_RECOVERABLE', error: 'SHOPEE当前没有可恢复任务。' });
    if (before?.runId && activeRunIds.has(before.runId)) {
      return res.json({ ok: true, alreadyRunning: true, attachedRunId: before.runId, run: { reportDate, runId: before.runId }, state: summarizeShopeeState(state) });
    }
    const latestSnapshot = getMatchingBusinessSnapshot(SHOPEE, state);
    const invalidCompleted = Boolean(
      !options.resume
      && before?.status === 'finished'
      && latestSnapshot
      && (
        Number(latestSnapshot.state?.lastRunSummary?.scanRetry || 0) > 0
        || Number(latestSnapshot.state?.scanRetryBills?.length || 0) > 0
        || Number(latestSnapshot.state?.finalRows?.length || 0) !== Number(state.pnhBills?.length || 0)
        || latestSnapshot.state?.analysisRuleVersion !== SHOPEE_ANALYSIS_RULE_VERSION
      )
    );
    if (invalidCompleted) {
      invalidateBusinessSnapshots(SHOPEE, reportDate, {
        reason: 'SHOPEE_SCAN_RETRY_OR_COUNT_MISMATCH',
        previousRunId: before.runId,
        snapshotId: latestSnapshot.snapshotId,
        scanRetry: latestSnapshot.state?.lastRunSummary?.scanRetry || latestSnapshot.state?.scanRetryBills?.length || 0,
        expected: state.pnhBills?.length || 0,
        actual: latestSnapshot.state?.finalRows?.length || 0
      });
      updateBusinessRunLock(SHOPEE, reportDate, 'failed', '旧快照扫描待重试或数量不一致，已标记INVALID并创建REPAIR。');
      state.snapshotId = '';
      saveBusinessState(state, SHOPEE);
    }
    const repair = !options.resume && (before?.status === 'failed' || invalidCompleted);
    const outcome = createOrRecoverBusinessRun(SHOPEE, reportDate, { lockedBy: req.ip || '', repair, rejectRunning: Boolean(before?.runId && activeRunIds.has(before.runId)) });
    if (!outcome.ok) return res.status(outcome.code === 'RUN_ALREADY_ACTIVE' || outcome.code === 'RUN_ALREADY_COMPLETED' ? 409 : 400).json(outcome);
    const run = outcome.run;
    runId = run.runId;
    activeRunIds.add(runId);
    if (repair && outcome.created) clearRunResults(state);
    state.businessType = SHOPEE;
    state.currentRun = run;
    state.processing = { ...(state.processing || {}), running: true, paused: false, phase: run.currentStage || '准备处理', runId };
    state.lastRunSummary = { ...(state.lastRunSummary || {}), businessType: SHOPEE, reportDate, runId, runStatus: 'running' };
    saveBusinessState(state, SHOPEE);
    const result = await runQcPipeline({
      state,
      client,
      onProgress: async message => {
        state.logs = [...(state.logs || []), `[${new Date().toLocaleTimeString()}] ${message}`].slice(-300);
        await appendRuntimeLog(`[SHOPEE] ${message}`);
      },
      onCheckpoint: async checkpointState => saveBusinessState(checkpointState, SHOPEE),
      isPaused: async () => Boolean(loadBusinessState(SHOPEE).processing?.paused)
    });
    const view = buildShopeeDashboard(result.state);
    if (view.recipientReconciliation?.status !== 'PASSED') {
      const error = new Error('SHOPEE收件人分组对账失败，已阻止生成正式快照。');
      error.code = 'FAILED_RECONCILIATION';
      throw error;
    }
    const summary = {
      businessType: SHOPEE, reportDate, runId,
      ...view.metrics,
      metrics: Object.fromEntries(view.dashboardRows.map(row => [row.metricKey, row.数值])),
      metricStatuses: Object.fromEntries(view.dashboardRows.map(row => [row.metricKey, row.状态])),
      recipientReconciliation: view.recipientReconciliation
    };
    result.state.historySummary = appendHistorySummary(result.state.historySummary || [], summary).map(item => ({ ...item, businessType: SHOPEE }));
    result.state.lastRunSummary = { ...(result.state.lastRunSummary || {}), ...summary };
    saveBusinessState(result.state, SHOPEE);
    const snapshot = saveBusinessSnapshot(SHOPEE, result.state, buildShopeeDashboard(result.state));
    result.state.snapshotId = snapshot.snapshotId;
    updateCarryoverResults({ snapshotId: snapshot.snapshotId, reportDate, rows: result.state.finalRows || [] });
    const ccslState = await loadState();
    const ccslSnapshot = getMatchingSnapshot(ccslState);
    completeUnifiedSnapshot({ reportDate, ccslSnapshot, shopeeSnapshot: snapshot });
    saveBusinessState(result.state, SHOPEE);
    res.json({ ok: true, summary, run: { reportDate, runId, recovered: outcome.recovered, repair }, snapshotId: snapshot.snapshotId, state: summarizeShopeeState(result.state) });
  } catch (error) {
    if (reportDate) updateBusinessRunLock(SHOPEE, reportDate, error.runStatus || 'failed', error.message || String(error));
    const state = loadBusinessState(SHOPEE);
    state.processing = { ...(state.processing || {}), running: false, paused: false, error: error.message || String(error) };
    state.snapshotId = '';
    saveBusinessState(state, SHOPEE);
    res.status(error.code === 'AUTH_REQUIRED' ? 409 : 500).json({ ok: false, code: error.code || 'SHOPEE_RUN_FAILED', error: error.message, diagnostic: error.apiDiagnostic || state.apiDiagnostic || null });
  } finally {
    if (runId) activeRunIds.delete(runId);
  }
}

app.post('/api/track-query', async (req, res) => {
  const businessType = String(req.body?.businessType || 'SHOPEE').toUpperCase() === SHOPEE ? SHOPEE : 'CCSL';
  const shipmentCodes = mergeUnique(req.body?.shipmentCodes || [], []).slice(0, 200);
  if (!shipmentCodes.length) return res.status(400).json({ ok: false, error: '请至少输入一个运单号。' });
  if (!summarizeToken(await loadToken()).hasAccessToken) return res.status(400).json({ ok: false, error: '请先登录CE系统。' });
  try {
    const reportDate = String(req.body?.reportDate || new Date().toISOString().slice(0, 10));
    if (businessType === SHOPEE) {
      const shipment = await manualBatchQuery(shipmentCodes, codes => client.shipmentTrack(codes), 'tms-shipment/track');
      const events = await manualBatchQuery(shipmentCodes, codes => client.trackQuery(codes), 'tms-shipment-event/query');
      const exceptions = await manualBatchQuery(shipmentCodes, codes => client.exceptionQuery(codes), 'exception-item/query');
      const shipmentByBill = groupManualRows(shipment.rows);
      const eventByBill = groupManualRows(events.rows);
      const exceptionByBill = groupManualRows(exceptions.rows);
      const rows = shipmentCodes.map(shipmentCode => analyzeShopeeShipment({
        waybill: shipmentCode, reportDate,
        scanRow: { shipmentCode, 运单号: shipmentCode, 来源类型: '手工查询' },
        shipmentTrackRow: shipmentByBill.get(shipmentCode)?.[0] || {},
        events: eventByBill.get(shipmentCode) || [],
        exceptions: exceptionByBill.get(shipmentCode) || [],
        apiStatus: {
          shipment: shipment.failedBills.includes(shipmentCode) ? 'failed' : 'success',
          event: events.failedBills.includes(shipmentCode) ? 'failed' : 'success',
          exception: exceptions.failedBills.includes(shipmentCode) ? 'failed' : 'success'
        }
      }));
      return res.json({ ok: true, businessType, reportDate, shipmentCodes, rows, shipmentRows: shipment.rows, trackEvents: events.rows, exceptionItems: exceptions.rows, batches: [...shipment.batches, ...events.batches, ...exceptions.batches] });
    }
    const scans = await manualBatchQuery(shipmentCodes, codes => client.confirmQuery(codes), 'confirm-query');
    const events = await manualBatchQuery(shipmentCodes, codes => client.trackQuery(codes), 'tms-shipment-event/query');
    return res.json({ ok: true, businessType, reportDate, shipmentCodes, scanRows: scans.rows, trackEvents: events.rows, batches: [...scans.batches, ...events.batches] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || '轨迹查询失败。' });
  }
});

app.get('/api/tracking-workspace', async (req, res) => {
  const unified = getLatestUnifiedImport();
  const snapshotId = String(req.query.snapshotId || unified?.snapshotId || '');
  const reportDate = String(req.query.reportDate || unified?.reportDate || '');
  const scope = ['all', 'pod'].includes(String(req.query.scope || '')) ? String(req.query.scope) : 'actionable';
  let states = [];
  if (snapshotId) states = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].map(type => loadLightweightUnifiedBusinessState(type, snapshotId));
  if (!states.some(state => state?.finalRows?.length)) states = [await loadState(), loadBusinessState(SHOPEE)];
  const allRows = states.flatMap(state => workspaceRows(state, state.businessType || 'CCSL'));
  const priority = row => row.queryStatus === '待重试' ? 0 : row.isActionable ? 1 : 2;
  allRows.sort((a, b) => priority(a) - priority(b) || String(a.businessType).localeCompare(String(b.businessType)) || String(a.shipmentCode).localeCompare(String(b.shipmentCode)));
  const rows = scope === 'all' ? allRows : scope === 'pod' ? allRows.filter(row => row.isClosed) : allRows.filter(row => row.isActionable);
  const summary = {
    dailyNew: Number(unified?.summary?.validUniqueWaybills || unified?.summary?.totalUnique || 0),
    historicalCarry: Number(unified?.carryover?.historicalOpen || 0),
    scanCompleted: allRows.filter(row => row.scanStatus && row.scanStatus !== '待扫描').length,
    podSkipped: allRows.filter(row => row.scanStatus === 'POD').length,
    returnSkipped: allRows.filter(row => row.scanStatus === 'RETURN').length,
    needTrack: allRows.filter(row => row.queryStatus === '需查轨迹').length,
    trackSuccess: allRows.filter(row => row.queryStatus === '成功').length,
    trackFailed: allRows.filter(row => row.queryStatus === '失败').length,
    retryPending: allRows.filter(row => row.queryStatus === '待重试').length,
    completed: allRows.filter(row => ['成功', 'POD跳过', '退回跳过', '特殊节点跳过', '正常分流跳过'].includes(row.queryStatus)).length
  };
  res.json({ ok: true, reportDate, batchId: unified?.batchId || '', snapshotId, scope, allRowCount: allRows.length, summary, rows: rows.slice(0, 5000) });
});

app.post('/api/test-ce-api', async (req, res) => {
  const requestHeadersDebug = client.headerDebug();
  const headersConfigured = ceHeaderStatus(requestHeadersDebug);
  const authStatus = summarizeToken(await loadToken());
  if (!headersConfigured.authorization) {
    res.status(400).json({ ok: false, error: '请先在 .env 配置 CE_AUTHORIZATION 基础认证', headersConfigured, requestHeadersDebug, authStatus });
    return;
  }
  if (!authStatus.hasAccessToken && !headersConfigured.bladeAuth && !headersConfigured.cookie) {
    res.status(400).json({ ok: false, error: '请先登录CE系统', headersConfigured, requestHeadersDebug, authStatus });
    return;
  }

  const shipmentCodes = mergeUnique(req.body?.shipmentCodes || [], []);
  if (!shipmentCodes.length) {
    res.status(400).json({ ok: false, error: '请提供有效运单号', headersConfigured, requestHeadersDebug, authStatus });
    return;
  }

  let stage = 'confirm-query';
  try {
    const confirmRows = await client.confirmQuery(shipmentCodes);
    const orderStatusByBill = buildOrderStatusByBill(shipmentCodes, confirmRows);
    stage = 'tms-shipment-event/query';
    const trackRows = await client.trackQuery(shipmentCodes);
    const trackCountByBill = buildTrackCountByBill(shipmentCodes, trackRows);
    const latestAuthStatus = summarizeToken(await loadToken());

    res.json({
      ok: true,
      headersConfigured,
      requestHeadersDebug,
      shipmentCodes,
      confirmCount: confirmRows.length,
      orderStatusByBill,
      trackEventCount: trackRows.length,
      trackCountByBill,
      authStatus: latestAuthStatus
    });
  } catch (e) {
    const latestAuthStatus = summarizeToken(await loadToken());
    res.status(500).json({
      ok: false,
      stage,
      error: `CE API连通测试失败（${stage}）：${e.message}`,
      ceStatus: e.ceStatus || '',
      ceCode: e.ceCode || '',
      ceMsg: e.ceMsg || '',
      requestHeadersDebug,
      headersConfigured,
      authStatus: latestAuthStatus
    });
  }
});

app.get('/api/export-xlsx', async (req, res) => {
  try {
    const state = await loadState();
    const snapshot = req.query.snapshotId ? getSnapshotById(req.query.snapshotId) : getMatchingSnapshot(state);
    if (!snapshot) throw new Error('处理尚未完成，暂无可导出的处理快照。');
    const exportState = snapshot ? { ...snapshot.state, snapshotId: snapshot.snapshotId } : state;
    const file = await exportXlsx(exportState, snapshot);
    setSnapshotHeaders(res, snapshot);
    recordExport({
      reportDate: exportState.reportDate || '',
      exportType: 'xlsx',
      fileName: path.basename(file),
      fileHash: fileHash(file),
      rowCount: (exportState.finalRows || []).length,
      summary: exportState.lastRunSummary || exportState.dailyParseSummary || {},
      consistency: snapshot?.consistency || buildConsistencyReport(exportState)
    });
    res.download(file);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/export/xlsx', async (req, res) => {
  try {
    const state = await loadState();
    const snapshotId = req.body?.snapshotId || '';
    const snapshot = snapshotId ? getSnapshotById(snapshotId) : getMatchingSnapshot(state);
    if (!snapshot) throw new Error('处理尚未完成，暂无可导出的处理快照。');
    const exportState = snapshot ? { ...snapshot.state, snapshotId: snapshot.snapshotId } : state;
    const file = await exportXlsx(exportState, snapshot);
    setSnapshotHeaders(res, snapshot);
    recordExport({
      reportDate: exportState.reportDate || '',
      exportType: 'xlsx',
      fileName: path.basename(file),
      fileHash: fileHash(file),
      rowCount: (exportState.finalRows || []).length,
      summary: exportState.lastRunSummary || exportState.dailyParseSummary || {},
      consistency: snapshot?.consistency || buildConsistencyReport(exportState)
    });
    res.download(file);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/export-daily-parse', async (req, res) => {
  try {
    const state = await loadState();
    const file = await exportDailyParseXlsx(state);
    res.download(file);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/shopee/export-xlsx', async (req, res) => {
  try {
    const state = loadBusinessState(SHOPEE);
    const snapshot = req.query.snapshotId ? getBusinessSnapshotById(SHOPEE, req.query.snapshotId) : getMatchingBusinessSnapshot(SHOPEE, state);
    if (!snapshot) throw new Error('SHOPEE处理尚未完成，暂无可导出的处理快照。');
    const exportState = { ...snapshot.state, snapshotId: snapshot.snapshotId, businessType: SHOPEE };
    const file = await exportShopeeXlsx(exportState, snapshot);
    setSnapshotHeaders(res, snapshot);
    recordBusinessExport({ businessType: SHOPEE, reportDate: exportState.reportDate, snapshotId: snapshot.snapshotId, exportType: 'xlsx', fileName: path.basename(file), rowCount: (exportState.finalRows || []).length });
    res.download(file);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/export-period', async (req, res) => {
  try {
    const result = await exportPeriodReports({ periodType: req.query.periodType || 'daily', date: req.query.date || '', businessType: req.query.businessType || 'ALL' });
    res.download(result.file, path.basename(result.file));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/export-period/prepare', async (req, res) => {
  try {
    const result = await exportPeriodReports({ periodType: req.body?.periodType || 'daily', date: req.body?.date || '', businessType: req.body?.businessType || 'ALL' });
    const files = [...result.files, result.file].filter((value, index, list) => list.indexOf(value) === index).map(file => ({ name: path.basename(file), url: `/api/export-file?name=${encodeURIComponent(path.basename(file))}` }));
    res.json({ ok: true, range: result.range, snapshotIds: result.snapshots, files });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/export-file', async (req, res) => {
  const name = path.basename(String(req.query.name || ''));
  const file = path.join(getRuntimeConfig().exportsDir, name);
  try { await fs.access(file); res.download(file, name); } catch { res.status(404).json({ ok: false, error: '导出文件不存在或已被清理。' }); }
});

app.get('/api/export-backup', async (req, res) => {
  try {
    const state = await loadState();
    const shopeeState = loadBusinessState(SHOPEE);
    const file = path.join(getRuntimeConfig().longJsonExportsDir, `CE_QC_BACKUP_${dateStamp()}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(buildLongBackupV2(state, shopeeState), null, 2), 'utf8');
    recordBackup({
      backupType: 'long-json',
      fileName: path.basename(file),
      filePath: file,
      fileHash: fileHash(file),
      reason: 'manual-export'
    });
    res.download(file);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/export/long-json', async (req, res) => {
  try {
    const state = await loadState();
    const shopeeState = loadBusinessState(SHOPEE);
    const file = path.join(getRuntimeConfig().longJsonExportsDir, `CE_QC_BACKUP_${dateStamp()}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(buildLongBackupV2(state, shopeeState), null, 2), 'utf8');
    recordBackup({
      backupType: 'long-json',
      fileName: path.basename(file),
      filePath: file,
      fileHash: fileHash(file),
      reason: 'manual-export'
    });
    res.download(file);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/run/status/:reportDate', async (req, res) => {
  res.json({ ok: true, status: getRunStatus(req.params.reportDate) });
});

app.get('/api/compare/:reportDate', async (req, res) => {
  const state = await loadState();
  res.json({ ok: true, reportDate: req.params.reportDate, consistency: buildConsistencyReport(state) });
});

app.post('/api/snapshot/reconcile', async (req, res) => {
  try {
    const state = await loadState();
    const snapshot = req.body?.snapshotId ? getSnapshotById(req.body.snapshotId) : getMatchingSnapshot(state);
    if (!snapshot) return res.status(404).json({ ok: false, error: '没有可从SQLite原始数据重算的CCSL快照。' });
    const repaired = repairSnapshotFromStoredData(snapshot);
    await saveState(repaired.state);
    const conflicts = (repaired.consistency?.errors || []).map(message => ({ shipmentCode: String(message).match(/[A-Z0-9]{8,}/)?.[0] || '', reason: message, snapshotId: repaired.snapshotId }));
    persistReconciliationDiagnostics(repaired, conflicts);
    res.json({ ok: repaired.status === 'VALID', oldSnapshotId: snapshot.snapshotId, newSnapshotId: repaired.snapshotId, status: repaired.status, consistency: repaired.consistency, conflicts });
  } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
});

app.get('/api/reconciliation-diagnostics', (req, res) => {
  const rows = getDb().prepare('SELECT businessType,reportDate,snapshotId,shipmentCode,conflictMetrics,latestEvent,reason,payloadJson,createdAt FROM reconciliation_diagnostics ORDER BY id DESC LIMIT 1000').all();
  if (String(req.query.download || '') === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="reconciliation_${Date.now()}.json"`);
    res.type('application/json').send(JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
    return;
  }
  res.json({ ok: true, rows });
});

app.get('/api/results/:reportDate', async (req, res) => {
  const state = await loadState();
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize || 200)));
  const rows = safeFinalRows(state).filter(row => row?.是否POD !== '是' && row?.异常分类 !== '最终分流排除');
  const start = (page - 1) * pageSize;
  res.json({ ok: true, reportDate: req.params.reportDate, page, pageSize, total: rows.length, rows: rows.slice(start, start + pageSize) });
});

app.get('/api/detail', async (req, res) => {
  const requestedBusinessType = String(req.query.businessType || '').toUpperCase();
  const detail = /^SHOPEE(?:CN|VN)?$/.test(requestedBusinessType)
    ? loadBusinessDetail(SHOPEE, req.query.reportDate || '', req.query.shipmentCode || req.query.waybill || '')
    : loadDetail({ reportDate: req.query.reportDate || '', shipmentCode: req.query.shipmentCode || req.query.waybill || '' });
  if (!detail) {
    res.status(404).json({ ok: false, error: '未找到该运单详情' });
    return;
  }
  res.json({ ok: true, detail });
});

app.get('/api/backups', async (req, res) => {
  res.json({ ok: true, backups: listBackups(50), backupStorage: getBackupStorageSummary(), exports: listExportRecords(50) });
});

app.get('/api/backups/:id/download', requireRole('ADMIN'), (req, res) => {
  const backup = getDb().prepare("SELECT * FROM backup_records WHERE id=? AND COALESCE(status,'ACTIVE')='ACTIVE'").get(Number(req.params.id || 0));
  if (!backup?.filePath || !fileHash(backup.filePath) || fileHash(backup.filePath) !== backup.fileHash) return res.status(404).json({ ok: false, error: '备份文件不存在或校验失败。' });
  res.download(backup.filePath, backup.fileName);
});

app.post('/api/admin/backup-now', requireRole('ADMIN'), (req, res) => {
  const filePath = createDatabaseBackup('manual-admin');
  if (!filePath) return res.status(500).json({ ok: false, error: '数据库备份失败。' });
  auditAction(req, 'DATABASE_BACKUP_CREATED', { backupPath: filePath });
  res.json({ ok: true, filePath, sha256: fileHash(filePath) });
});

app.post('/api/admin/delete-backup', requireRole('ADMIN'), (req, res) => {
  const backupId = Number(req.body?.backupId || 0);
  if (req.body?.confirmText !== '删除备份') return res.status(400).json({ ok: false, error: '请准确输入“删除备份”确认。' });
  try {
    const result = deleteBackup(backupId, req.user?.username || req.user?.email || '');
    auditAction(req, 'BACKUP_DELETED', { backupId, fileName: result.fileName });
    res.json({ ok: true, ...result });
  } catch (error) { res.status(409).json({ ok: false, error: error.message }); }
});

app.post('/api/admin/delete-all-backups', requireRole('ADMIN'), (req, res) => {
  if (req.body?.confirmText !== '永久删除全部备份') return res.status(400).json({ ok: false, error: '请准确输入“永久删除全部备份”确认。' });
  try {
    const result = deleteAllBackups(req.user?.username || req.user?.email || '');
    auditAction(req, 'BACKUP_DELETE_ALL', { deletedCount: result.deletedCount, failedCount: result.failedCount });
    res.json({ ok: result.failedCount === 0, ...result, error: result.failedCount ? '部分备份删除失败，请刷新后查看。' : '' });
  } catch (error) { res.status(409).json({ ok: false, error: error.message }); }
});

app.get('/api/admin/audit-logs', requireRole('ADMIN'), (req, res) => {
  const rows = getDb().prepare('SELECT userEmail,userRole,action,businessType,reportDate,runId,ipAddress,createdAt FROM audit_logs ORDER BY id DESC LIMIT 300').all();
  res.json({ ok: true, rows });
});

app.post('/api/admin/restore-backup', requireRole('ADMIN'), async (req, res) => {
  const backupId = Number(req.body?.backupId || 0);
  if (req.body?.confirmText !== '恢复此数据库备份') return res.status(400).json({ ok: false, error: '确认文字不正确。' });
  const backup = getDb().prepare('SELECT * FROM backup_records WHERE id = ?').get(backupId);
  if (!backup?.filePath) return res.status(404).json({ ok: false, error: '未找到该备份记录。' });
  const resolved = path.resolve(backup.filePath);
  const runtime = getRuntimeConfig();
  if (!resolved.startsWith(path.resolve(runtime.backupsDir) + path.sep)) return res.status(400).json({ ok: false, error: '备份文件不在受控目录。' });
  if (!fileHash(resolved) || fileHash(resolved) !== backup.fileHash) return res.status(409).json({ ok: false, error: '备份校验失败，未恢复数据库。' });
  const activeRun = getDb().prepare("SELECT COUNT(*) AS count FROM run_checkpoints WHERE status IN ('RUNNING','PROCESSING')").get();
  if (Number(activeRun?.count || 0) > 0) return res.status(409).json({ ok: false, error: '当前有处理任务运行，暂不能恢复数据库。' });
  const rollbackFile = createDatabaseBackup('before-admin-restore');
  try {
    closeDb();
    await fs.rm(`${runtime.dbFile}-wal`, { force: true });
    await fs.rm(`${runtime.dbFile}-shm`, { force: true });
    await fs.copyFile(resolved, runtime.dbFile);
    getDb().prepare('PRAGMA integrity_check').get();
    auditAction(req, 'DATABASE_BACKUP_RESTORED', { backupId, backupPath: resolved, rollbackFile });
    res.json({ ok: true, restoredFrom: backup.fileName, rollbackFile });
  } catch (error) {
    closeDb();
    if (rollbackFile) await fs.copyFile(rollbackFile, runtime.dbFile);
    getDb();
    res.status(500).json({ ok: false, error: `恢复失败，已回滚：${error.message}` });
  }
});

app.post('/api/clear-state', (req, res) => res.redirect(307, '/api/reset'));

app.get('/api/logs/recent', async (req, res) => {
  const state = await loadState();
  res.json({ ok: true, logs: (state.logs || []).slice(-300) });
});

function summarizeState(state) {
  const snapshot = getMatchingSnapshot(state);
  const viewState = snapshot?.state || state;
  const runStatus = viewState.reportDate ? getRunStatus(viewState.reportDate).lock : null;
  const runtime = getRuntimeConfig();
  return {
    businessType: 'CCSL',
    snapshotId: snapshot?.snapshotId || '',
    reportDate: viewState.reportDate || '',
    sourceName: viewState.sourceName || '',
    dailyReportReady: Boolean(viewState.reportDate && (viewState.pnhBills || []).length),
    pnh: (viewState.pnhBills || []).length,
    nonPnh: (viewState.nonPnhBills || []).length,
    carry: (viewState.carryBills || []).length,
    podLocks: (viewState.podLocks || []).length,
    scanResults: (viewState.scanResults || []).length,
    scanPool: (viewState.scanPool || []).length,
    needTrackBills: (viewState.needTrackBills || []).length,
    trackResults: (viewState.trackResults || []).length,
    trackEvents: (viewState.trackEvents || []).length,
    finalRows: (viewState.finalRows || []).length,
    nextCarry: (viewState.nextCarryBills || viewState.carryBills || []).length,
    finalDiversion: (viewState.finalDiversionRows || []).length,
    lastRun: viewState.lastRun || null,
    lastRunSummary: viewState.lastRunSummary || viewState.lastRun || null,
    runId: runStatus?.runId || viewState.currentRun?.runId || viewState.lastRunSummary?.runId || '',
    runStatus: runStatus?.status || '',
    currentRun: runStatus || null,
    dailySummary: viewState.dailyParseSummary || viewState.daily?.summary || null,
    dailyPreview: viewState.daily?.preview || (viewState.dailyParseRows || []).slice(0, 50),
    backupSummary: viewState.backupSummary || null,
    shopCodes: getShopCodeSummary(),
    historySummary: viewState.historySummary || [],
    processing: runStatus ? {
      ...(viewState.processing || {}),
      running: runStatus.status === 'running',
      paused: runStatus.status === 'paused',
      phase: runStatus.currentStage || viewState.processing?.phase || '',
      batchIndex: Number(runStatus.batchIndex || 0),
      totalBatches: Number(runStatus.totalBatches || 0),
      error: runStatus.errorMessage || ''
    } : (viewState.processing || { running: false, paused: false, phase: '' }),
    dbStatus: getDbStatus(),
    network: buildNetworkInfo(runtime),
    consistency: snapshot?.consistency || buildConsistencyReport(viewState),
    dashboardMetricHash: snapshot?.dashboardMetricHash || '',
    detailRowHash: snapshot?.detailRowHash || '',
    dashboard: snapshot?.dashboard || buildDashboardData(viewState),
    coreKpis: snapshot?.coreKpis || buildCoreKpis(viewState),
    criticalDashboard: (() => {
      const critical = snapshot?.criticalDashboard || buildCriticalDashboard(viewState);
      return { summary: critical.summary, rows: critical.rows };
    })(),
    detailTabs: snapshot?.detailTabs || buildDetailTabs(viewState),
    logs: viewState.logs || []
  };
}

function compactDashboardState(summary = {}) {
  const keepTabs = ['dashboard', 'coreAbnormal', 'nextCarry', 'abnormal'];
  const detailTabs = Object.fromEntries(keepTabs
    .filter(key => summary.detailTabs?.[key])
    .map(key => {
      const tab = summary.detailTabs[key];
      const limit = key === 'dashboard' ? 100 : 200;
      return [key, { ...tab, rows: Array.isArray(tab.rows) ? tab.rows.slice(0, limit) : [] }];
    }));
  const compact = {
    ...summary,
    _compact: true,
    dailyPreview: (summary.dailyPreview || []).slice(0, 20),
    logs: (summary.logs || []).slice(-30),
    detailTabs,
    criticalDashboard: summary.criticalDashboard
      ? { ...summary.criticalDashboard, rows: (summary.criticalDashboard.rows || []).slice(0, 100) }
      : summary.criticalDashboard
  };
  // These collections can contain thousands of rows/events. Compact dashboard
  // requests use counters and short previews only; detail pages fetch rows on demand.
  for (const key of ['finalRows', 'trackResults', 'trackEvents', 'scanResults', 'scanPool', 'needTrackBills', 'dailyRows', 'dailyParseRows', 'rawRows', 'exceptionItems']) {
    delete compact[key];
  }
  return compact;
}

function summarizeCcslSnapshot(snapshot) {
  const state = { ...(snapshot.state || {}), snapshotId: snapshot.snapshotId || '' };
  return { ...summarizeState(state), snapshotId: snapshot.snapshotId || '', reportDate: snapshot.reportDate || state.reportDate || '' };
}

function summarizeShopeeState(state) {
  const snapshot = getMatchingBusinessSnapshot(SHOPEE, state);
  const viewState = snapshot?.state || state;
  const runStatus = viewState.reportDate ? getBusinessRunStatus(SHOPEE, viewState.reportDate).lock : null;
  const dashboard = snapshot?.view || buildShopeeDashboard(viewState);
  return {
    businessType: SHOPEE,
    snapshotId: snapshot?.snapshotId || viewState.snapshotId || '',
    reportDate: viewState.reportDate || '',
    sourceName: viewState.sourceName || '',
    dailyReportReady: Boolean(viewState.dailyReportReady),
    total: (viewState.pnhBills || []).length,
    carry: (viewState.carryBills || []).length,
    podLocks: (viewState.podLocks || []).length,
    scanResults: (viewState.scanResults || []).length,
    trackResults: (viewState.trackResults || []).length,
    trackEvents: (viewState.trackEvents || []).length,
    finalRows: (viewState.finalRows || []).length,
    nextCarry: (viewState.nextCarryBills || viewState.carryBills || []).length,
    dailySummary: viewState.dailyParseSummary || viewState.daily?.summary || null,
    dailyPreview: viewState.daily?.preview || (viewState.dailyParseRows || []).slice(0, 50),
    backupSummary: viewState.backupSummary || null,
    apiDiagnostic: viewState.apiDiagnostic || null,
    historySummary: viewState.historySummary || [],
    runId: runStatus?.runId || viewState.currentRun?.runId || viewState.lastRunSummary?.runId || '',
    runStatus: runStatus?.status || '',
    currentRun: runStatus || viewState.currentRun || null,
    processing: runStatus ? {
      ...(viewState.processing || {}),
      running: runStatus.status === 'running',
      paused: runStatus.status === 'paused',
      phase: runStatus.currentStage || viewState.processing?.phase || '',
      batchIndex: Number(runStatus.batchIndex || 0),
      totalBatches: Number(runStatus.totalBatches || 0),
      error: runStatus.errorMessage || ''
    } : (viewState.processing || { running: false, paused: false, phase: '' }),
    dashboard,
    dashboardMetricHash: snapshot?.dashboardMetricHash || '',
    detailRowHash: snapshot?.detailRowHash || '',
    detailTabs: dashboard.detailTabs,
    logs: viewState.logs || [],
    dbStatus: getDbStatus()
  };
}

function summarizeShopeeSnapshot(snapshot) {
  const state = { ...(snapshot.state || {}), snapshotId: snapshot.snapshotId || '', businessType: SHOPEE };
  const dashboard = snapshot.view || buildShopeeDashboard(state);
  return { ...summarizeShopeeState(state), snapshotId: snapshot.snapshotId || '', reportDate: snapshot.reportDate || state.reportDate || '', dashboard, detailTabs: dashboard.detailTabs };
}

function setSnapshotHeaders(res, snapshot = {}) {
  res.setHeader('X-Snapshot-Id', String(snapshot.snapshotId || ''));
  res.setHeader('X-Dashboard-Metric-Hash', String(snapshot.dashboardMetricHash || ''));
  res.setHeader('X-Detail-Row-Hash', String(snapshot.detailRowHash || ''));
  res.setHeader('X-CE-API-Calls-During-Export', '0');
}

function clearRunResults(state) {
  const activeCarry = new Set(state.nextCarryBills?.length ? state.nextCarryBills : (state.carryBills || []));
  const carryMetadata = new Map([...(state.priorCarryRows || []), ...(state.finalRows || [])]
    .map(row => [String(row.shipmentCode || row.运单号 || '').trim().toUpperCase(), row])
    .filter(([bill]) => bill && activeCarry.has(bill)));
  state.priorCarryRows = [...carryMetadata.values()];
  state.scanPool = [];
  state.scanResults = [];
  state.scanQueryStatus = [];
  state.scanRetryBills = [];
  state.shipmentTrackResults = [];
  state.shipmentQueryStatus = [];
  state.needTrackBills = [];
  state.trackResults = [];
  state.trackEvents = [];
  state.eventQueryStatus = [];
  state.exceptionItems = [];
  state.exceptionQueryStatus = [];
  state.apiBatchStatus = [];
  state.finalRows = [];
  state.finalDiversionRows = [];
  state.nextCarryBills = [];
  state.lastRunSummary = null;
  state.lastRun = null;
  state.apiDiagnostic = null;
}

function safeJsonRow(row = {}) {
  try {
    const parsed = JSON.parse(row.stateJson || '{}');
    return { ...parsed, shipmentCode: row.shipmentCode, 运单号: row.shipmentCode, businessType: row.businessType, sourceReportDate: row.sourceReportDate };
  } catch {
    return { shipmentCode: row.shipmentCode, 运单号: row.shipmentCode, businessType: row.businessType, sourceReportDate: row.sourceReportDate };
  }
}

async function manualBatchQuery(shipmentCodes, query, apiName) {
  const rows = [];
  const failedBills = [];
  const batches = [];
  for (const batch of splitTrackBatches(shipmentCodes)) {
    const outcome = await queryBatchWithFallback({ batch, query, apiName, onLog: async () => {} });
    for (const success of outcome.successes) {
      rows.push(...(success.events || []));
      batches.push({ apiName, size: success.batch.length, status: 'success', resultCount: (success.events || []).length });
    }
    for (const failure of outcome.failures) {
      failedBills.push(...failure.batch);
      batches.push({ apiName, size: failure.batch.length, status: 'failed', error: failure.error?.message || String(failure.error || '') });
    }
  }
  return { rows, failedBills: mergeUnique(failedBills, []), batches };
}

function groupManualRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const bill = String(row?.shipmentCode || row?.运单号 || '').trim().toUpperCase();
    if (!bill) continue;
    if (!map.has(bill)) map.set(bill, []);
    map.get(bill).push(row);
  }
  return map;
}

function mergeUnique(a, b) {
  return [...new Set([...(a || []), ...(b || [])].map(x => String(x || '').trim().toUpperCase()).filter(Boolean))];
}

function filterBackupBills(list) {
  return mergeUnique(list || [], []).filter(wb => !/^SPE/i.test(wb) && !/^WHPP/i.test(wb) && !/WHPP/i.test(wb));
}

function filterActiveCarryBills(list, podLocks) {
  const podSet = new Set(filterBackupBills(podLocks || []));
  return filterBackupBills(list || []).filter(wb => !podSet.has(wb));
}

function ceHeaderStatus(debug = {}) {
  return {
    authorization: Boolean(debug.Authorization?.configured),
    bladeAuth: Boolean(debug['Blade-Auth']?.configured),
    cookie: hasEnv('CE_COOKIE')
  };
}

function hasEnv(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function buildOrderStatusByBill(bills, rows) {
  const byBill = new Map((rows || []).map(row => [String(row?.shipmentCode || '').trim().toUpperCase(), row]));
  return bills.map(wb => ({
    shipmentCode: wb,
    orderStatus: byBill.get(wb)?.orderStatus ?? ''
  }));
}

function buildTrackCountByBill(bills, rows) {
  const counts = new Map(bills.map(wb => [wb, 0]));
  for (const row of rows || []) {
    const wb = String(row?.shipmentCode || '').trim().toUpperCase();
    if (!counts.has(wb)) counts.set(wb, 0);
    counts.set(wb, counts.get(wb) + 1);
  }
  return bills.map(wb => ({
    shipmentCode: wb,
    trackEventCount: counts.get(wb) || 0
  }));
}

function throwIfCeAuthFailed(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const data = src.data && typeof src.data === 'object' ? src.data : {};
  const ceCode = src.code ?? data.code ?? src.errorCode ?? data.errorCode ?? '';
  const ceMsg = src.msg ?? data.msg ?? src.message ?? data.message ?? src.error ?? data.error ?? '';
  const success = src.success ?? data.success;
  const oauth = data.oauth && typeof data.oauth === 'object' ? data.oauth : {};
  const hasToken = Boolean(src.access_token || src.accessToken || data.access_token || data.accessToken || oauth.access_token || oauth.accessToken);
  const codeLooksFailed = ceCode && !['0', '200'].includes(String(ceCode));
  if (hasToken) return;
  if (success === false || codeLooksFailed) {
    const err = new Error(ceMsg || 'CE登录失败');
    err.ceCode = ceCode;
    err.ceMsg = ceMsg;
    throw err;
  }
}

function normalizeApiError(e) {
  const data = e?.response?.data || {};
  return {
    message: e?.message || '',
    ceStatus: e?.response?.status || e?.ceStatus || '',
    ceCode: e?.ceCode ?? data.code ?? data.errorCode ?? data.status ?? '',
    ceMsg: e?.ceMsg ?? data.msg ?? data.message ?? data.error ?? ''
  };
}

function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function broadcastEvent(event, payload = {}) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const connection of eventClients) {
    try { connection.res.write(message); } catch { eventClients.delete(connection); }
  }
}

function workspaceRows(state = {}, businessType = 'CCSL') {
  const scans = new Map((state.scanResults || state.shipmentTrackResults || []).map(row => [billOfWorkspace(row), row]));
  const queryStatus = new Map([...(state.eventQueryStatus || []), ...(state.apiBatchStatus || [])].flatMap(row => (row.shipmentCodes || []).map(code => [String(code).toUpperCase(), row])));
  return (state.finalRows || []).map(row => {
    const shipmentCode = billOfWorkspace(row);
    const scan = scans.get(shipmentCode) || {};
    const batch = queryStatus.get(shipmentCode) || {};
    const isPod = row.是否POD === '是' || String(row.orderStatus || scan.orderStatus || '') === '85';
    const isReturn = /RETURN|退回/.test(`${row.退回状态 || ''} ${row.primaryCategory || ''}`);
    const failed = /fail|失败|refresh_failed/i.test(`${row.查询状态 || ''} ${row.API状态 || ''} ${batch.status || ''}`);
    const specialState = row.specialState || row.primaryCategory || row.主分类 || '';
    const shopState = row.shopState || row.shopStatus || row.门店状态 || row.storeFlowState || '';
    const category = row.primaryCategory || row.主分类 || row.异常分类 || '';
    const specialClosed = ['SELF_PICKUP', 'CECN_RETENTION', 'CEZT_RETENTION', 'CCSL580_RETENTION'].includes(String(specialState || '').trim().toUpperCase());
    const normalFinal = category === '正常分流节点' || row.matchedRule === 'NORMAL_FINAL_HUB';
    const isClosed = isPod || isReturn || specialClosed || normalFinal;
    const isActionable = !isClosed;
    return {
      shipmentCode, businessType: row.businessType || businessType, region: row.regionCode || row.区域 || '',
      scanStatus: isPod ? 'POD' : (isReturn ? 'RETURN' : (scan.orderStatus || row.扫描状态 || '已扫描')),
      latestNode: row.最后节点 || row.latestEventDesc || '', latestTime: row.最后节点时间 || row.latestEventTime || '',
      pendingRawEventCount: Number(row.pendingRawEventCount || 0), pendingDistinctDayCount: Number(row.pendingDistinctDayCount ?? row.Pending次数 ?? 0),
      pendingDates: Array.isArray(row.pendingDates) ? row.pendingDates : String(row.Pending日期 || '').split(/[,、]/).map(value => value.trim()).filter(Boolean),
      pendingContinuity: row.pendingContinuity || row.Pending连续性 || '', ocDays: Number(row.OC天数 || 0),
      specialState, shopState, category, isClosed, isActionable,
      queryStatus: isPod ? 'POD跳过' : (isReturn ? '退回跳过' : (specialClosed ? '特殊节点跳过' : (normalFinal ? '正常分流跳过' : (failed ? '待重试' : ((row.轨迹节点数 || row.轨迹节点数量 || 0) > 0 ? '成功' : '需查轨迹'))))),
      retryCount: Number(batch.attemptCount || row.retryCount || 0), reportDate: row.reportDate || state.reportDate || '', snapshotId: state.snapshotId || ''
    };
  }).filter(row => row.shipmentCode);
}

function persistReconciliationDiagnostics(snapshot, conflicts) {
  const db = getDb();
  const insert = db.prepare('INSERT INTO reconciliation_diagnostics(businessType,reportDate,snapshotId,shipmentCode,conflictMetrics,latestEvent,reason,payloadJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');
  for (const conflict of conflicts) insert.run('CCSL', snapshot.reportDate || '', snapshot.snapshotId || '', conflict.shipmentCode || '', 'classification', '', conflict.reason || '', JSON.stringify(conflict), new Date().toISOString());
}

function billOfWorkspace(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}

const runtimeConfig = getRuntimeConfig();
const port = runtimeConfig.port;
const host = runtimeConfig.host;
app.listen(port, host, () => {
  const network = buildNetworkInfo(runtimeConfig);
  console.log(`本机访问: ${network.localUrl}`);
  console.log(`局域网访问: ${network.lanUrl || '未检测到局域网IPv4，请查看电脑IP地址'}`);
  console.log(`SQLite DB: ${runtimeConfig.dbFile}`);
  console.log(`Public URL: ${network.publicUrl}`);
});

function buildNetworkInfo(runtime = getRuntimeConfig()) {
  const portValue = runtime.port || 5177;
  const lanIps = getLanIpv4s();
  const lanIp = lanIps[0] || '';
  return {
    host: runtime.host || '0.0.0.0',
    port: portValue,
    localUrl: `http://127.0.0.1:${portValue}`,
    lanIp,
    lanIps,
    lanUrl: String(process.env.ACCESS_MODE || 'DUAL').toUpperCase() === 'DUAL' && lanIp ? `http://${lanIp}:${portValue}` : '',
    lanUrls: String(process.env.ACCESS_MODE || 'DUAL').toUpperCase() === 'DUAL' ? lanIps.map(ip => `http://${ip}:${portValue}`) : [],
    publicUrl: `https://${process.env.PUBLIC_HOSTNAME || 'ce-qc.cambodian.com'}`,
    publicConfigured: Boolean(process.env.PUBLIC_HOSTNAME && process.env.CF_ACCESS_TEAM_DOMAIN && process.env.CF_ACCESS_AUD)
  };
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLanIpv4s() {
  const candidates = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (/^169\.254\./.test(item.address)) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) candidates.push(item.address);
    }
  }
  return [...new Set(candidates)].sort((a, b) => Number(/^192\.168\./.test(b)) - Number(/^192\.168\./.test(a)));
}
