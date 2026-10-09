import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { CEClient, normalizeLoginToken } from './src/ceClient.js';
import { parseDailyExcel } from './src/excelParser.js';
import { parseLongBackupModules } from './src/backupParser.js';
import { parseShopeeDailyExcel } from './src/shopeeExcelParser.js';
import { parseUnifiedDailyExcel } from './src/unifiedExcelParser.js';
import { completeUnifiedSnapshot, getLatestUnifiedImport, getUnifiedProcessingQueue, listUnifiedImportHistory, loadUnifiedBusinessState, loadUnifiedPeriodBusinessState, saveUnifiedImport, updateCarryoverResults } from './src/unifiedImportStore.js';
import { loadLightweightAggregateState, loadLightweightPeriodBusinessState, loadLightweightUnifiedBusinessState } from './src/lightweightDashboardStore.js';
import { getDashboardCacheStatus, loadRangeDashboard, markDashboardCacheDirty } from './src/rangeDashboardStore.js';
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
import { loadWhppState, saveWhppDailyImport } from './src/whppStore.js';
import { buildWhppDashboard } from './src/whppReporting.js';
import { loadWhppCanonicalTruth } from './src/whppCanonicalTruth.js';
import { ensureHistoricalEvidenceJob } from './src/historicalEvidenceWorkerManager.js';
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
import { queueDirectDataPurge, getDirectDataPurgeStatus, DIRECT_PURGE_ID } from './src/directDataPurge.js';
import { buildHomeQualitySummary, buildHomeQualitySummaryWithArchive, diagnoseSelectedDateTiming } from './src/homeQualitySummary.js';
import { diagnoseV736Timing } from './src/v736TimingDiagnostics.js';
import { diagnoseWhppDailyTimingSources } from './src/v745WhppTimingSourceDiagnostics.js';
import { requestSelectedDateTimingRepair, inspectSelectedDateTimingRepair } from './src/selectedDateTimingEvidenceRepair.js';
import { persistentSelectedDatePodTruth, persistentWhppCompletionTruth } from './src/selectedDatePersistentTruth.js';
import { buildCanonicalBusinessAccounting } from './src/businessAccounting.js';
import { buildDataIntegrityReport } from './src/dataIntegrity.js';
import { v766ReadJob, v766ClearReadCache } from './src/v766ReadJobCoordinator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientInteractionLogFile = path.join(__dirname, 'logs', 'client_interaction_latest.log');
const clientInteractionLogReady = fs.mkdir(path.dirname(clientInteractionLogFile), { recursive: true })
  .then(() => fs.writeFile(clientInteractionLogFile, `[CE-QC][V598] client interaction forensic log started ${new Date().toISOString()}\n`, 'utf8'))
  .catch(() => {});

const app = express();
const v652ExportJobs=new Map();
function updateExportJob(jobId,patch={}){const current=v652ExportJobs.get(jobId)||{};const next={...current,...patch,jobId,updatedAt:new Date().toISOString()};v652ExportJobs.set(jobId,next);return next;}
function publicExportJob(job={}){return{jobId:job.jobId,status:job.status,progress:job.progress||0,phase:job.phase||'',message:job.message||'',error:job.error||'',files:job.files||[],range:job.range||null,createdAt:job.createdAt||'',updatedAt:job.updatedAt||'',completedAt:job.completedAt||''};}
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

// Recovery-only first paint: the purge console is static and contains no business
// facts. Serve only the two recovery assets directly to a loopback browser before
// accessIdentity so a stale/blocked auth or large-DB session read can never blank
// the emergency purge page. All purge APIs remain behind accessIdentity + ADMIN.
function isLoopbackRecoveryRequest(req) {
  const host = String(req.hostname || req.get('host') || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split(':')[0];
  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return ['127.0.0.1', 'localhost', '::1'].includes(host) && ['127.0.0.1', '::1'].includes(remote);
}
function sendLoopbackRecoveryFile(fileName, type) {
  return (req, res, next) => {
    if (!isLoopbackRecoveryRequest(req)) return next();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (type) res.type(type);
    return res.sendFile(path.join(__dirname, 'public', fileName));
  };
}
app.get(['/purge-console.html', '/purge-console'], sendLoopbackRecoveryFile('purge-console.html', 'html'));
app.get('/v505-data-purge-recovery.js', sendLoopbackRecoveryFile('v505-data-purge-recovery.js', 'application/javascript'));
app.get('/v560-direct-data-purge.js', sendLoopbackRecoveryFile('v560-direct-data-purge.js', 'application/javascript'));
app.get(['/local-login.html','/local-login'], sendLoopbackRecoveryFile('local-login.html', 'html'));

// V602: retired interaction-owner assets must never execute again.
// Older compatibility code may still request these filenames dynamically. Returning a
// deterministic no-op here prevents stale window-capture listeners from cancelling
// native anchor/button behavior even when an old loader survives in browser cache.
const retiredInteractionAssets = new Set([
  '/v569-final-interaction-owner.js',
  '/v573-head-interaction-bridge.js',
  '/v580-visible-shell-recovery.js'
]);
app.get([...retiredInteractionAssets], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.type('application/javascript');
  res.send("'use strict';console.info('[CE-QC][V602_RETIRED_INTERACTION_ASSET]','"+String(req.path||'')+"','no-op');");
});

// V574: static browser assets contain no business/user data and must never wait on
// auth/session/database readiness. The authenticated HTML/API surface stays protected.
const v575PublicAssetStatic = express.static(path.join(__dirname, 'public'), {
  index: false,
  fallthrough: true,
  etag: true,
  maxAge: 0
});
app.use((req, res, next) => {
  if (!/\.(?:js|mjs|css|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|map)$/i.test(String(req.path || ''))) return next();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return v575PublicAssetStatic(req, res, next);
});

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

const V625_UI_PAGES = new Map([
  ['/', { key:'home', title:'首页总看板', business:'' }],
  ['/ce', { key:'ce', title:'CE看板', business:'CE' }],
  ['/ceaf', { key:'ceaf', title:'CEAF空运看板', business:'CEAF' }],
  ['/tbkh', { key:'tbkh', title:'TBKH看板', business:'TBKH' }],
  ['/ali1688', { key:'ali1688', title:'ALI1688看板', business:'ALI1688' }],
  ['/whpp', { key:'whpp', title:'WHPP本土看板', business:'WHPP' }],
  ['/shopeecn', { key:'shopeecn', title:'SHOPEE CN看板', business:'SHOPEECN' }],
  ['/shopeevn', { key:'shopeevn', title:'SHOPEE VN看板', business:'SHOPEEVN' }],
  ['/import', { key:'import', title:'数据导入', business:'' }],
  ['/tracking', { key:'tracking', title:'轨迹查询', business:'' }],
  ['/exceptions', { key:'exceptions', title:'异常明细', business:'' }],
  ['/reports', { key:'reports', title:'报表导出', business:'' }],
  ['/settings', { key:'settings', title:'系统设置', business:'' }],
  ['/logs', { key:'logs', title:'操作日志', business:'' }],
  ['/data-management', { key:'data-management', title:'数据管理', business:'' }],
  ['/users', { key:'users', title:'用户管理', business:'' }],
  ['/roles', { key:'roles', title:'角色权限', business:'' }],
  ['/profile', { key:'profile', title:'个人中心', business:'' }],
  ['/404', { key:'not-found', title:'页面不存在', business:'' }]
]);

app.get([...V625_UI_PAGES.keys()], async (req, res, next) => {
  try {
    const page = V625_UI_PAGES.get(req.path) || V625_UI_PAGES.get('/');
    const template = await fs.readFile(path.join(__dirname, 'public', 'v625-shell.html'), 'utf8');
    let html = template
      .replaceAll('__V625_PAGE_TITLE__', page.title)
      .replaceAll('__V625_PAGE_KEY__', page.key)
      .replaceAll('__V625_BUSINESS_TYPE__', page.business);
    if(page.business!=='WHPP'){
      html=html.replace(/<button id="v641WhppScanPending"[^>]*>.*?<\/button>/s,'');
    }
    res.type('html').send(html);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const client = new CEClient();
const activeRunIds = new Set();
const eventClients = new Set();
const DASHBOARD_CACHE_REFRESH_MS = Math.max(60_000, Number(process.env.DASHBOARD_CACHE_REFRESH_MS || 600_000));
let dashboardCacheWorker = null;
let dashboardCachePendingDate = '';
let dashboardCacheTimer = null;

function launchDashboardCacheWorker({ reportDate = '', reason = 'SCHEDULED_REFRESH' } = {}) {
  const date = String(reportDate || '').trim();
  if (date) {
    markDashboardCacheDirty(date, reason);
    dashboardCachePendingDate = date;
  }
  if (dashboardCacheWorker) return { started: false, queued: Boolean(date) };
  const workerFile = path.join(__dirname, 'src', 'dashboardCacheWorker.js');
  const args = [workerFile, '--reason', String(reason || 'SCHEDULED_REFRESH')];
  if (date) args.push('--date', date);
  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
  dashboardCacheWorker = child;
  child.once('exit', () => {
    dashboardCacheWorker = null;
    fastSqlDashboardCache.clear();
    periodDashboardCache.clear();
    const queuedDate = dashboardCachePendingDate;
    dashboardCachePendingDate = '';
    if (queuedDate && queuedDate !== date) {
      setTimeout(() => launchDashboardCacheWorker({ reportDate: queuedDate, reason: 'QUEUED_REFRESH' }), 100).unref?.();
    }
  });
  child.once('error', () => { dashboardCacheWorker = null; });
  return { started: true, queued: false };
}

function startDashboardCacheScheduler() {
  if (dashboardCacheTimer) return { started: true, alreadyRunning: true };
  if (String(process.env.CE_QC_ENABLE_DASHBOARD_CACHE_SCHEDULER || '') !== '1') {
    console.log('[CE-QC][DASHBOARD_CACHE_SCHEDULER_DISABLED] normal startup does not launch STARTUP_WARM or periodic dashboard-cache workers; imports and completed business runs still materialize cache event-by-event.');
    return { started: false, reason: 'EVENT_DRIVEN_ONLY' };
  }
  const startupTimer = setTimeout(() => launchDashboardCacheWorker({ reason: 'STARTUP_WARM' }), 1500);
  startupTimer.unref?.();
  dashboardCacheTimer = setInterval(() => launchDashboardCacheWorker({ reason: 'PERIODIC_REFRESH' }), DASHBOARD_CACHE_REFRESH_MS);
  dashboardCacheTimer.unref?.();
  return { started: true, reason: 'EXPLICIT_OPT_IN' };
}

app.get('/detail', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'detail.html'));
});

app.get(['/ccsl', '/shopee'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/client-diag', (req, res) => {
  const event = String(req.query?.event || '').replace(/[^A-Z0-9_:-]/gi, '').slice(0, 48);
  const page = String(req.query?.page || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
  const extra = String(req.query?.extra || '').replace(/[\r\n\t]/g, ' ').slice(0, 220);
  const version = String(req.query?.v || '').replace(/[^0-9.]/g, '').slice(0, 16);
  const line = `[CE-QC][V575_CLIENT] event=${event || '-'} page=${page || '-'} v=${version || '-'}${extra ? ` extra=${extra}` : ''}`;
  console.log(line);
  void clientInteractionLogReady
    .then(() => fs.appendFile(clientInteractionLogFile, `${new Date().toISOString()} ${line}\n`, 'utf8'))
    .catch(() => {});
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.get('/api/health', async (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    ok: true,
    version: '0.1.0-shopee-track-user-delete-v2',
    patchId: '2026-08-08-v26-stability-bootstrap',
    time: new Date().toISOString(),
    db: getDbStatus(),
    memory: {
      rssMB: Math.round(memory.rss / 1024 / 1024),
      heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
    },
    dashboardCache: getDashboardCacheStatus()
  });
});

app.get('/api/session', (req, res) => {
  res.json({ ok: true, user: publicUser(req.user), unreadNotifications: 0 });
});

app.post('/api/export-sidecar/start', (req, res) => {
  try {
    const starter = globalThis.__CE_QC_START_EXPORT_SIDECAR__;
    if (typeof starter !== 'function') return res.status(503).json({ ok:false, code:'EXPORT_SIDECAR_STARTER_UNAVAILABLE', error:'独立导出服务启动器尚未就绪。' });
    const result = starter() || {};
    return res.json({ ok:result.reason!=='SPAWN_FAILED', ...result, port:Number(process.env.CE_QC_EXPORT_SIDECAR_PORT || 5178), onDemand:true });
  } catch (error) {
    return res.status(500).json({ ok:false, code:'EXPORT_SIDECAR_START_FAILED', error:error?.message || String(error) });
  }
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

const fastSqlDashboardCache = new Map();

function fastDashboardBatch(snapshotId = '', reportDate = '') {
  const db = getDb();
  if (String(snapshotId || '').trim()) {
    return db.prepare(`
      SELECT b.snapshotId,b.reportDate,s.status AS snapshotStatus
      FROM unified_import_batches b
      LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.snapshotId=? AND b.status='VALID'
      LIMIT 1
    `).get(String(snapshotId).trim()) || null;
  }
  const requestedDate=String(reportDate||'').trim().slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)){
    return db.prepare(`
      SELECT b.snapshotId,b.reportDate,s.status AS snapshotStatus
      FROM unified_import_batches b
      LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.reportDate=? AND b.status='VALID'
      ORDER BY b.createdAt DESC
      LIMIT 1
    `).get(requestedDate) || null;
  }
  return db.prepare(`
    SELECT b.snapshotId,b.reportDate,s.status AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID'
    ORDER BY b.createdAt DESC
    LIMIT 1
  `).get() || null;
}

function cachedFastRange(batch) {
  if (!batch || !batch.reportDate) return null;
  const key = `${batch.snapshotId}:${batch.reportDate}`;
  const cached = fastSqlDashboardCache.get(key);
  if (cached && Date.now() - cached.at < 3000) return cached.value;
  const value = loadRangeDashboard(batch.reportDate, batch.reportDate);
  if (fastSqlDashboardCache.size > 12) fastSqlDashboardCache.clear();
  fastSqlDashboardCache.set(key, { at: Date.now(), value });
  return value;
}

function loadFastSqlAggregateState(scope) {
  const batch = fastDashboardBatch();
  const range = cachedFastRange(batch);
  if (!range) return null;
  const state = String(scope || '').toUpperCase() === 'SHOPEE' ? range.aggregates.SHOPEE : range.aggregates.CCSL;
  return {
    ...state,
    reportDate: batch.reportDate,
    snapshotId: batch.snapshotId,
    snapshotStatus: batch.snapshotStatus || state.snapshotStatus || 'IMPORTED',
    processing: { running: false, paused: false, phase: '' },
    logs: [],
    _fastSqlSummary: true
  };
}

function loadFastSqlBusinessState(businessType, snapshotId = '', reportDate = '') {
  const type = String(businessType || '').toUpperCase();
  if (!['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].includes(type)) return null;
  const batch = fastDashboardBatch(snapshotId, reportDate);
  const range = cachedFastRange(batch);
  if (!range) return null;
  const source = range.states[type];
  if (!source) return null;
  return {
    ...source,
    businessType: type.startsWith('SHOPEE') ? 'SHOPEE' : type,
    viewBusinessType: type,
    reportDate: batch.reportDate,
    snapshotId: batch.snapshotId,
    snapshotStatus: batch.snapshotStatus || source.snapshotStatus || 'IMPORTED',
    processing: { running: false, paused: false, phase: '' },
    logs: [],
    _fastSqlSummary: true
  };
}

app.get('/api/state', async (req, res) => {
  if (req.query.compact === '1') {
    const fast = loadFastSqlAggregateState('CCSL');
    if (fast) {
      fast.dbStatus = getDbStatus();
      fast.network = buildNetworkInfo(getRuntimeConfig());
      fast.shopCodes = getShopCodeSummary();
      return res.json({ ok: true, state: fast });
    }
  }
  const state = loadLightweightAggregateState('CCSL');
  const summary = summarizeLightweightCcslState(state, {
    dbStatus: getDbStatus(),
    network: buildNetworkInfo(getRuntimeConfig()),
    shopCodes: getShopCodeSummary()
  });
  res.json({ ok: true, state: req.query.compact === '1' ? compactDashboardState(summary) : summary });
});

app.get('/api/dashboard-cache/status', (req, res) => {
  res.json({
    ok: true,
    refreshIntervalMs: DASHBOARD_CACHE_REFRESH_MS,
    workerRunning: Boolean(dashboardCacheWorker),
    cache: getDashboardCacheStatus()
  });
});

app.get('/api/unified-history', (req, res) => {
  res.json({ ok: true, rows: listUnifiedImportHistory(req.query.limit) });
});

// V766: the first home paint is one exact selected-date classification read.
// Average signing days, POD/return and 30-day trends are computed later in a
// READ-ONLY worker, never on the main HTTP event loop. Do not fake zero POD.
function v766QuickHomeSummary({reportDate='',snapshotId=''}={}){
  const batch=fastDashboardBatch(snapshotId,reportDate);
  const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
  const counts=Object.fromEntries(types.map(type=>[type,0]));
  if(!batch)return{
    ok:true,quickOnly:true,selectionMatched:false,requestedReportDate:String(reportDate||''),
    reportDate:'',snapshotId:'',generatedAt:new Date().toISOString(),
    classification:{total:0,classified:0,balanced:false,counts,businesses:[]},
    returns:{},timing:{},timingTrend:{},timingEvidenceRepair:{active:false,types:{}}
  };
  const db=getDb();
  const batchMeta=db.prepare('SELECT batchId,summaryJson FROM unified_import_batches WHERE snapshotId=? AND reportDate=? AND status=\'VALID\' LIMIT 1').get(batch.snapshotId,batch.reportDate);
  const rows=db.prepare('SELECT businessType, COUNT(*) AS count FROM unified_import_rows WHERE batchId=? GROUP BY businessType').all(batchMeta.batchId);
  for(const row of rows)if(Object.prototype.hasOwnProperty.call(counts,row.businessType))counts[row.businessType]=Number(row.count||0);
  // Legacy WHPP may be in the separately persisted daily source, while newer
  // days already include it in unified_import_rows. Never add it twice.
  try{
    const whpp=Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) AS count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(batch.reportDate)?.count||0);
    counts.WHPP=Math.max(counts.WHPP,whpp);
  }catch{}
  const total=types.reduce((sum,type)=>sum+counts[type],0);
  const summary=JSON.parse(batchMeta.summaryJson||'{}');
  const conflicts=Math.max(0,Number(summary.classificationConflicts||0));
  return{ok:true,quickOnly:true,selectionMatched:true,reportDate:batch.reportDate,
    snapshotId:batch.snapshotId,generatedAt:new Date().toISOString(),
    classification:{total,classified:total,balanced:total>0,counts,autoRecognized:Math.max(0,total-conflicts),
      unrecognized:0,conflicts,accuracyRate:total?Number(((total-conflicts)*100/total).toFixed(2)):0,
      businesses:types.map(type=>({businessType:type,count:counts[type],
        share:total?Number((counts[type]*100/total).toFixed(2)):0,status:'已分类'}))},
    returns:{},timing:{},timingTrend:{},timingEvidenceRepair:{active:false,types:{}}
  };
}
app.get('/api/home-quality-summary', async (req, res) => {
  try {
    const reportDate=String(req.query.reportDate||'');
    const snapshotId=String(req.query.snapshotId||'');
    if(String(req.query.fast||'')==='1'){
      if(String(req.query.quick||'')==='1'){
        const payload=v766QuickHomeSummary({reportDate,snapshotId});
        res.setHeader('Cache-Control','no-store');
        res.setHeader('X-CE-QC-Home-Summary','V766_QUICK_COUNTS');
        return res.json(payload);
      }
      // The former "fast" route invoked the 30-day SQLite signing loop on
      // the Express event loop. Heavy work now runs in a read-only worker.
      const pinned=fastDashboardBatch(snapshotId,reportDate);
      const read=await v766ReadJob('HOME_FULL',{reportDate:reportDate||pinned?.reportDate||'',
        snapshotId:snapshotId||pinned?.snapshotId||''});
      res.setHeader('X-CE-QC-Home-Summary','V766_ASYNC_FULL');
      res.setHeader('X-CE-QC-Read-Cache',read.cache);
      return res.json(read.result);
    }
    const payload=await buildHomeQualitySummaryWithArchive({reportDate,snapshotId});
    try{
      const diag=diagnoseSelectedDateTiming(payload?.reportDate||reportDate,snapshotId);
      console.log('[CE-QC][V663_TIMING_DIAG]',JSON.stringify(diag));
    }catch{}
    res.json(payload);
  } catch (error) {
    console.warn('[CE-QC][HOME_SUMMARY_ARCHIVE_FALLBACK]',error?.message||String(error));
    // A failed worker is NOT permission to run 30-day SQLite timing scans
    // on the HTTP event loop: respond and keep all menu clicks responsive.
    if(String(req.query.fast||'')==='1')return res.status(503).json({
      ok:false,code:'V766_ASYNC_HOME_UNAVAILABLE',
      error:'源票概览仍可查询；签收时效后台统计暂时不可用，请稍后刷新。'
    });
    try{
      res.json(buildHomeQualitySummary({
        reportDate:String(req.query.reportDate||''),
        snapshotId:String(req.query.snapshotId||'')
      }));
    }catch(inner){
      res.status(500).json({ ok:false, error:inner?.message || String(inner) });
    }
  }
});
app.get('/api/data-integrity', (req,res)=>{
  try{
    res.json(buildDataIntegrityReport({
      reportDate:String(req.query.reportDate||''),
      snapshotId:String(req.query.snapshotId||''),
      businessType:String(req.query.businessType||'')
    }));
  }catch(error){
    res.status(500).json({ok:false,error:error?.message||String(error)});
  }
});

// V26: one lightweight startup payload. The browser used to wait for nine API
// requests serially before first paint. All dashboard data below is served from
// the fast SQL/range cache when possible, so normal navigation behaves like a
// website rather than a batch-processing console.
app.route('/api/bootstrap').get(async (req, res) => {
  const bootstrapStartedAt = Date.now();
  const bootstrapLog = stage => console.log(`[CE-QC][V616_BOOTSTRAP] stage=${stage} elapsedMs=${Date.now()-bootstrapStartedAt}`);
  bootstrapLog('ENTER');
  try {
    const fastCcsl = loadFastSqlAggregateState('CCSL');
    bootstrapLog('FAST_SQL_READ_DONE');
    const ccsl = fastCcsl
      ? compactDashboardState(fastCcsl)
      : compactDashboardState(summarizeLightweightCcslState(loadLightweightAggregateState('CCSL'), { dbStatus: getDbStatus(), network: buildNetworkInfo(getRuntimeConfig()), shopCodes: getShopCodeSummary() }));
    bootstrapLog('CCSL_READY');
    // V621: SHOPEE state is intentionally excluded from first-paint bootstrap.
    // It is loaded after the shell is interactive so a large SHOPEE summary can
    // never delay navigation/clickability.
    const shopee = null;
    bootstrapLog('SHOPEE_DEFERRED');
    const unifiedHistory = listUnifiedImportHistory(120);
    bootstrapLog('UNIFIED_HISTORY_READY');
    const latestUnified = getLatestUnifiedImport();
    bootstrapLog('LATEST_UNIFIED_READY');
    // V599: the HOME first paint must never hydrate six business state objects.
    // Individual boards fetch their own compact state only after the user navigates.
    // Home totals already come from the aggregate cache + unified classification summary.
    const tokenSummary = summarizeToken(await loadToken());
    bootstrapLog('TOKEN_READY');
    const payload = {
      ok: true,
      state: ccsl,
      shopeeState: shopee,
      authStatus: tokenSummary,
      session: { ok: true, user: publicUser(req.user), unreadNotifications: 0 },
      history: {
        CCSL: listSnapshotHistory(45),
        SHOPEE: listBusinessHistoryDates(SHOPEE, 45),
        UNIFIED: unifiedHistory.slice(0, 60)
      },
      unifiedImport: latestUnified,
      businessStates: {},
      bootstrapMode: 'V621_INTERACTION_FIRST',
      generatedAt: new Date().toISOString()
    };
    res.setHeader('Cache-Control', 'private, max-age=5');
    res.setHeader('X-CE-QC-Bootstrap-Mode', 'V621_INTERACTION_FIRST');
    res.setHeader('X-CE-QC-Bootstrap-Owner', 'server.js');
    res.setHeader('X-CE-QC-Bootstrap-Ms', String(Date.now() - bootstrapStartedAt));
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    res.setHeader('X-CE-QC-Bootstrap-Bytes', String(payloadBytes));
    bootstrapLog('PAYLOAD_READY bytes='+payloadBytes);
    res.json(payload);
    bootstrapLog('RESPONSE_SENT');
  } catch (error) {
    bootstrapLog('ERROR '+String(error?.message||error).slice(0,120));
    res.status(500).json({ ok: false, code: 'BOOTSTRAP_FAILED', error: error.message || String(error) });
  }
});

const periodDashboardCache = new Map();

app.get('/api/period-dashboard', (req, res) => {
  try {
    const rawFrom = String(req.query.from || '').trim();
    const rawTo = String(req.query.to || '').trim();
    const mode = String(req.query.mode || '').toLowerCase();
    const anchor = String(req.query.date || '').trim();
    let fromDate = rawFrom;
    let toDate = rawTo;
    let resolvedMode = 'custom';
    if (!fromDate || !toDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !['weekly', 'monthly'].includes(mode)) {
        return res.status(400).json({ ok: false, error: '请选择有效的开始日期和结束日期。' });
      }
      const date = new Date(`${anchor}T12:00:00+07:00`);
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
      resolvedMode = mode;
    }
    const result = loadRangeDashboard(fromDate, toDate);
    res.json({ ok: true, mode: resolvedMode, anchor: anchor || toDate, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/shopee/state', async (req, res) => {
  if (req.query.compact === '1') {
    const fast = loadFastSqlAggregateState('SHOPEE');
    if (fast) { fast.dbStatus = getDbStatus(); return res.json({ ok: true, state: fast }); }
  }
  const state = loadLightweightAggregateState('SHOPEE');
  const summary = summarizeLightweightShopeeState(state, { dbStatus: getDbStatus() });
  res.json({ ok: true, state: req.query.compact === '1' ? compactDashboardState(summary) : summary });
});

app.get('/api/business-state/:businessType', async (req, res) => {
  try {
    const requestedSnapshotId = String(req.query.snapshotId || '');
    const requestedReportDate = String(req.query.reportDate || '').slice(0,10);
    const requestedType = String(req.params.businessType || '').toUpperCase();
    if (requestedType === 'WHPP' && req.query.compact === '1') {
      const source = loadWhppState();
      const sourceDate = String(source.reportDate || '').slice(0,10);
      if (!requestedReportDate || requestedReportDate === sourceDate) {
        const dashboard = buildWhppDashboard(source);
        const accounting = buildCanonicalBusinessAccounting(source,'WHPP');
        const state = compactDashboardState({
          ...source,
          viewBusinessType:'WHPP',
          total:Number(dashboard.metrics?.total || source.pnhBills?.length || 0),
          dashboard,
          detailTabs:dashboard.detailTabs || {},
          accounting,
          historicalEvidenceRecovery:{state:'DEFERRED_FOR_FAST_NAVIGATION',readOnly:true}
        });
        res.setHeader('X-CE-QC-Business-State','FAST_WHPP_CURRENT');
        return res.json({ok:true,businessType:'WHPP',reportDate:sourceDate,snapshotId:source.snapshotId||source.sourceSnapshotId||'',snapshotStatus:source.snapshotStatus||'',state});
      }
    }
    if (requestedType === 'WHPP') {
      const source = loadWhppState();
      const reportDate = String(source.reportDate || req.query.reportDate || '').trim();
      const truth = loadWhppCanonicalTruth(reportDate, requestedSnapshotId || source.sourceSnapshotId || source.snapshotId || '');
      const recoveryJob = truth.total>0
        ? ensureHistoricalEvidenceJob({reportDate:truth.reportDate||reportDate,groups:{WHPP:(truth.rows||[]).map(row=>row.shipmentCode)}})
        : {state:'NOT_REQUIRED',result:null,readOnly:true};
      const archiveEvidence = recoveryJob.state==='COMPLETED' ? (recoveryJob.result?.WHPP||null) : null;
      const enrichedRows=(truth.rows||[]).map(row=>{
        const code=String(row.shipmentCode||row.运单号||'').trim().toUpperCase();
        const archivePod=Boolean(archiveEvidence?.podBills?.has?.(code));
        if(!archivePod)return row;
        return{
          ...row,isPod:1,是否POD:'是',POD状态:'POD',currentState:'POD',
          primaryCategory:row.primaryCategory||'POD',
          truthEvidence:{...(row.truthEvidence||{}),pod:true,archivePod:true,archivePodSource:archiveEvidence?.podEvidenceByBill?.get?.(code)?.source||'historical_archive'}
        };
      });
      const truthSource = {
        ...source,
        reportDate: truth.reportDate || reportDate,
        pnhBills: enrichedRows.map(row=>row.shipmentCode),
        dailyParseRows: enrichedRows,
        finalRows: enrichedRows
      };
      const dashboard = buildWhppDashboard(truthSource);
      const accounting=buildCanonicalBusinessAccounting(truthSource,'WHPP');
      const state = {
        ...truthSource,
        viewBusinessType:'WHPP',
        total:truth.total || dashboard.metrics?.total || 0,
        dashboard,
        detailTabs:dashboard.detailTabs || {},
        accounting,
        canonicalTruthEvidence:{...(truth.evidence||{}),archiveRecovery:archiveEvidence?.stats||null},
        historicalEvidenceRecovery:{state:recoveryJob.state,error:recoveryJob.error||'',readOnly:true}
      };
      return res.json({
        ok:true,businessType:'WHPP',reportDate:truth.reportDate||reportDate,snapshotId:truth.snapshotId||source.snapshotId||'',
        snapshotStatus:source.snapshotStatus||'',state:req.query.compact==='1'?compactDashboardState(state):state
      });
    }
    if (req.query.compact === '1') {
      const fast = loadFastSqlBusinessState(req.params.businessType, requestedSnapshotId, requestedReportDate);
      if (fast) return res.json({ ok: true, businessType: fast.viewBusinessType || fast.businessType, reportDate: fast.reportDate, snapshotId: fast.snapshotId, snapshotStatus: fast.snapshotStatus, state: fast });
    }
    const source = loadLightweightUnifiedBusinessState(req.params.businessType, requestedSnapshotId);
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
    state.accounting=buildCanonicalBusinessAccounting(source,source.businessType);
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

const directPurgeTerminalAudits = new Set();

app.post('/api/admin/data-purge/direct', requireRole('ADMIN'), async (req, res) => {
  try {
    const queued = queueDirectDataPurge({ phrase: req.body?.phrase, user: req.user });
    try { auditAction(req, 'DATA_PURGE_DIRECT_QUEUED', { direct: true, jobId: queued.jobId, reused: queued.reused === true, patchId: DIRECT_PURGE_ID }); } catch {}
    return res.status(202).json(queued);
  } catch (e) {
    try { getDb().exec('PRAGMA query_only=OFF'); } catch {}
    try { auditAction(req, 'DATA_PURGE_DIRECT_FAILED', { direct: true, stage: 'queue', error: e.message, patchId: DIRECT_PURGE_ID }); } catch {}
    return res.status(409).json({ ok: false, code: e.code || 'DIRECT_PURGE_FAILED', error: e.message, patchId: DIRECT_PURGE_ID });
  }
});

app.get('/api/admin/data-purge/direct/status', requireRole('ADMIN'), async (req, res) => {
  try {
    const status = getDirectDataPurgeStatus({ jobId: req.query?.jobId, user: req.user });
    const terminal = String(status.status || '').toUpperCase();
    if ((terminal === 'SUCCEEDED' || terminal === 'FAILED') && !directPurgeTerminalAudits.has(status.jobId)) {
      directPurgeTerminalAudits.add(status.jobId);
      try {
        auditAction(req, terminal === 'SUCCEEDED' ? 'DATA_PURGE_DIRECT_COMPLETED' : 'DATA_PURGE_DIRECT_FAILED', {
          direct: true, jobId: status.jobId, deletedRows: status.deletedRows, error: status.error || '', patchId: DIRECT_PURGE_ID
        });
      } catch {}
      if (terminal === 'SUCCEEDED') broadcastEvent('DATA_RESET', { at: status.completedAt || new Date().toISOString(), direct: true });
    }
    return res.json(status);
  } catch (e) {
    return res.status(404).json({ ok: false, code: e.code || 'DIRECT_PURGE_STATUS_FAILED', error: e.message, patchId: DIRECT_PURGE_ID });
  }
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
    launchDashboardCacheWorker({ reportDate: parsed.reportDate, reason: 'DAILY_IMPORT' });
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

    // Capture the already-verified runtime truth before the unified batch row is
    // updated. Same-day re-import must never erase scan/POD/track/final evidence.
    const priorCcsl = await loadState();
    const priorShopee = loadBusinessState(SHOPEE);

    const saved = saveUnifiedImport(parsed, req.file.originalname, { reuseExactDuplicate: true });
    const processingQueue = getUnifiedProcessingQueue(saved.batchId);
    const ccslRows = parsed.rows.filter(row => ['CE', 'CEAF', 'TBKH', 'ALI1688'].includes(row.businessType));
    const shopeeRows = parsed.rows.filter(row => ['SHOPEECN', 'SHOPEEVN'].includes(row.businessType));
    const whppRows = parsed.rows.filter(row => row.businessType === 'WHPP');
    const historicalCcsl = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['CE', 'CEAF', 'TBKH', 'ALI1688'].includes(row.businessType));
    const historicalShopee = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['SHOPEECN', 'SHOPEEVN'].includes(row.businessType));

    const ccslBills=ccslRows.map(row=>row.shipmentCode);
    const shopeeBills=shopeeRows.map(row=>row.shipmentCode);
    const ccslSameDate=String(priorCcsl.reportDate||'')===String(parsed.reportDate||'');
    const shopeeSameDate=String(priorShopee.reportDate||'')===String(parsed.reportDate||'');
    const ccslExact=ccslSameDate&&sameMembership(priorCcsl.pnhBills,ccslBills);
    const shopeeExact=shopeeSameDate&&sameMembership(priorShopee.pnhBills,shopeeBills);

    const ccslState = priorCcsl;
    ccslState.reportDate = parsed.reportDate;
    ccslState.sourceName = req.file.originalname;
    ccslState.dailyReportReady = true;
    ccslState.dailyParseRows = ccslRows.map(row => ({ ...row, result: 'PNH', reason: row.classificationReason }));
    ccslState.dailyParseSummary = { totalRecognized: ccslRows.length, pnh: ccslRows.length, nonPnh: 0, excluded: 0, duplicate: parsed.summary.duplicateRows };
    ccslState.pnhBills = ccslBills;
    ccslState.nonPnhBills = [];
    ccslState.excludedBills = [];
    ccslState.duplicateBills = [];
    if(ccslSameDate) retainSameDayEvidence(ccslState,[...ccslBills,...historicalCcsl.map(row=>row.shipmentCode)]);
    else clearRunResults(ccslState);
    ccslState.carryBills = historicalCcsl.map(row => row.shipmentCode);
    ccslState.priorCarryRows = [
      ...(ccslState.priorCarryRows||[]),
      ...historicalCcsl.map(row => safeJsonRow(row))
    ].filter((row,index,all)=>all.findIndex(item=>evidenceBill(item)===evidenceBill(row))===index);
    if(!ccslExact) resetRunForReport(parsed.reportDate);
    await saveState(ccslState);

    const shopeeState = priorShopee;
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
    shopeeState.pnhBills = shopeeBills;
    if(shopeeSameDate) retainSameDayEvidence(shopeeState,[...shopeeBills,...historicalShopee.map(row=>row.shipmentCode)]);
    else clearRunResults(shopeeState);
    shopeeState.carryBills = historicalShopee.map(row => row.shipmentCode);
    shopeeState.priorCarryRows = [
      ...(shopeeState.priorCarryRows||[]),
      ...historicalShopee.map(row => safeJsonRow(row))
    ].filter((row,index,all)=>all.findIndex(item=>evidenceBill(item)===evidenceBill(row))===index);
    if(!shopeeExact) resetBusinessRunForReport(SHOPEE, parsed.reportDate);
    saveBusinessState(shopeeState, SHOPEE);

    // WHPP is a first-class branch of the unified daily import. Its own store has
    // finalized-snapshot protection and now receives the exact unified membership.
    const whppState = saveWhppDailyImport({
      reportDate: parsed.reportDate,
      sourceName: req.file.originalname,
      rows: whppRows,
      batchId: saved.batchId,
      snapshotId: saved.snapshotId,
      preserveFinalizedLifecycle: true
    });

    launchDashboardCacheWorker({ reportDate: parsed.reportDate, reason: 'UNIFIED_IMPORT' });
    await fs.unlink(req.file.path).catch(() => {});
    res.json({
      ok: true, ...saved, carryover: processingQueue.summary,
      sameDayEvidencePreserved:{CCSL:ccslSameDate,SHOPEE:shopeeSameDate,WHPP:Boolean(whppState?.finalizedLifecyclePreserved||String(whppState?.reportDate||'')===String(parsed.reportDate||''))},
      state: summarizeState(ccslState), shopeeState: summarizeShopeeState(shopeeState)
    });
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
    launchDashboardCacheWorker({ reportDate: parsed.reportDate, reason: 'SHOPEE_IMPORT' });
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
    launchDashboardCacheWorker({ reportDate, reason: 'CCSL_RUN_COMPLETED' });
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
    // Fresh starts keep a small connectivity/schema probe. A RESUME must not sit
    // behind a second blocking probe: the bounded batch pipeline already owns retry
    // and exact error reporting for unfinished work. Skipping the duplicate probe
    // makes progress visible immediately after restart/recovery.
    if (!options.resume) {
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
    launchDashboardCacheWorker({ reportDate, reason: 'SHOPEE_RUN_COMPLETED' });
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

function localTrackEvidence(shipmentCodes=[], requestedBusinessType='', reportDate=''){
  const db=getDb();const codes=mergeUnique(shipmentCodes,[]).map(x=>String(x).trim().toUpperCase()).filter(Boolean);
  const events=[];const ledger=[];const scanRows=[];const shipmentRows=[];if(!codes.length)return{events,ledger,scanRows,shipmentRows};
  const storageType=/^SHOPEE/.test(String(requestedBusinessType||'').toUpperCase())?'SHOPEE':String(requestedBusinessType||'').toUpperCase();
  for(let i=0;i<codes.length;i+=300){
    const chunk=codes.slice(i,i+300),marks=chunk.map(()=>'?').join(',');
    try{
      const rows=db.prepare(`SELECT shipmentCode,eventCode,trackingEventCode,trackingEventDesc,trackingEventDescZh,trackingEventDescKm,eventTime,place,rawJson,reportDate
        FROM track_events WHERE shipmentCode IN (${marks}) ORDER BY eventTime,id`).all(...chunk);
      events.push(...rows.map(row=>({...row,evidenceSource:'track_events'})));
    }catch{}
    try{
      const params=storageType?[storageType,...chunk]:[...chunk];
      const rows=storageType
        ? db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,reportDate FROM business_track_events WHERE businessType=? AND shipmentCode IN (${marks}) ORDER BY eventTime,id`).all(...params)
        : db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,reportDate FROM business_track_events WHERE shipmentCode IN (${marks}) ORDER BY eventTime,id`).all(...params);
      events.push(...rows.map(row=>({...row,evidenceSource:'business_track_events'})));
    }catch{}
    if(storageType){
      try{
        const params=reportDate?[storageType,reportDate,...chunk]:[storageType,...chunk];
        const rows=reportDate
          ? db.prepare(`SELECT shipmentCode,reportDate,isPod,orderStatus,rawJson,createdAt,updatedAt FROM business_scan_results WHERE businessType=? AND reportDate=? AND shipmentCode IN (${marks})`).all(...params)
          : db.prepare(`SELECT shipmentCode,reportDate,isPod,orderStatus,rawJson,createdAt,updatedAt FROM business_scan_results WHERE businessType=? AND shipmentCode IN (${marks}) ORDER BY reportDate DESC`).all(...params);
        scanRows.push(...rows.map(row=>({...row,evidenceSource:'business_scan_results'})));
      }catch{}
      try{
        const params=reportDate?[storageType,reportDate,...chunk]:[storageType,...chunk];
        const rows=reportDate
          ? db.prepare(`SELECT shipmentCode,reportDate,shipmentStatus,statusText,apiStatus,rawJson,createdAt,updatedAt FROM business_shipment_tracks WHERE businessType=? AND reportDate=? AND shipmentCode IN (${marks}) ORDER BY id DESC`).all(...params)
          : db.prepare(`SELECT shipmentCode,reportDate,shipmentStatus,statusText,apiStatus,rawJson,createdAt,updatedAt FROM business_shipment_tracks WHERE businessType=? AND shipmentCode IN (${marks}) ORDER BY reportDate DESC,id DESC`).all(...params);
        shipmentRows.push(...rows.map(row=>({...row,evidenceSource:'business_shipment_tracks'})));
      }catch{}
    }
    try{
      ledger.push(...db.prepare(`SELECT shipmentCode,businessType,trackingStatus,terminalReason,terminalAt,currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt
        FROM qc_tracking_ledger WHERE shipmentCode IN (${marks})`).all(...chunk));
    }catch{}
  }
  const seen=new Set();
  const unique=events.filter(row=>{
    const raw=(()=>{try{return typeof row.rawJson==='string'?JSON.parse(row.rawJson):row.rawJson||{}}catch{return{}}})();
    const key=[String(row.shipmentCode||'').toUpperCase(),row.eventTime||raw.eventTime||raw.creationDate||'',row.eventCode||row.trackingEventCode||raw.eventCode||'',row.trackingEventDesc||row.trackingEventDescZh||raw.trackingEventDesc||raw.statusText||''].join('|');
    if(seen.has(key))return false;seen.add(key);return true;
  });
  return{events:unique,ledger,scanRows,shipmentRows};
}
function ledgerAsTrackEvents(rows=[]){
  return rows.flatMap(row=>{
    let evidence={};let current={};try{evidence=JSON.parse(row.evidenceJson||'{}')}catch{}try{current=JSON.parse(row.currentStateJson||'{}')}catch{}
    const list=[];
    for(const start of evidence.starts||[])list.push({shipmentCode:row.shipmentCode,eventTime:start.time||start.eventTime||'',eventCode:start.eventCode||start.code||'70',trackingEventDesc:start.description||start.text||'严格派送起点',evidenceSource:'qc_tracking_ledger'});
    if(row.terminalReason==='POD'&&row.podDate)list.push({shipmentCode:row.shipmentCode,eventTime:row.podDate,eventCode:'80',trackingEventDesc:'POD（本地严格轨迹账本）',evidenceSource:'qc_tracking_ledger'});
    else if(row.lastEventTime)list.push({shipmentCode:row.shipmentCode,eventTime:row.lastEventTime,eventCode:current.lastEventCode||'',trackingEventDesc:current.latestEventDesc||current.最后节点||row.currentCategory||row.currentState||'本地最后有效状态',evidenceSource:'qc_tracking_ledger'});
    return list;
  });
}

app.post('/api/track-query', async (req, res) => {
  const requestedBusinessType=String(req.body?.businessType||'CE').toUpperCase();
  const businessType=/^SHOPEE/.test(requestedBusinessType)?SHOPEE:'CCSL';
  const shipmentCodes=mergeUnique(req.body?.shipmentCodes||[],[]).slice(0,200);
  if(!shipmentCodes.length)return res.status(400).json({ok:false,error:'请至少输入一个运单号。'});
  const reportDate=String(req.body?.reportDate||new Date().toISOString().slice(0,10));
  const local=localTrackEvidence(shipmentCodes,requestedBusinessType,reportDate);
  const localEvents=[...local.events,...ledgerAsTrackEvents(local.ledger)];
  const auth=summarizeToken(await loadToken());
  if(!auth.hasAccessToken){
    if(localEvents.length||local.scanRows.length||local.shipmentRows.length||local.ledger.length)return res.json({ok:true,businessType:requestedBusinessType,reportDate,shipmentCodes,trackEvents:localEvents,scanRows:local.scanRows,shipmentRows:local.shipmentRows,localEvidence:true,remoteSkipped:'CE_AUTH_REQUIRED',ledger:local.ledger});
    return res.status(400).json({ok:false,error:'本地暂无轨迹证据，且CE系统尚未登录。'});
  }
  try{
    if(businessType===SHOPEE){
      const shipment=await manualBatchQuery(shipmentCodes,codes=>client.shipmentTrack(codes),'tms-shipment/track');
      const events=await manualBatchQuery(shipmentCodes,codes=>client.trackQuery(codes),'tms-shipment-event/query');
      const exceptions=await manualBatchQuery(shipmentCodes,codes=>client.exceptionQuery(codes),'exception-item/query');
      const shipmentByBill=groupManualRows(shipment.rows),eventByBill=groupManualRows(events.rows),exceptionByBill=groupManualRows(exceptions.rows);
      const rows=shipmentCodes.map(shipmentCode=>analyzeShopeeShipment({
        waybill:shipmentCode,reportDate,scanRow:{shipmentCode,运单号:shipmentCode,来源类型:'手工查询'},
        shipmentTrackRow:shipmentByBill.get(shipmentCode)?.[0]||{},events:eventByBill.get(shipmentCode)||[],exceptions:exceptionByBill.get(shipmentCode)||[],
        apiStatus:{shipment:shipment.failedBills.includes(shipmentCode)?'failed':'success',event:events.failedBills.includes(shipmentCode)?'failed':'success',exception:exceptions.failedBills.includes(shipmentCode)?'failed':'success'}
      }));
      const merged=[...events.rows,...localEvents];const seen=new Set();
      const trackEvents=merged.filter(row=>{const key=JSON.stringify([row.shipmentCode||row.waybill||'',row.eventTime||row.time||'',row.eventCode||row.trackingEventCode||'',row.trackingEventDesc||row.description||row.rawJson||'']);if(seen.has(key))return false;seen.add(key);return true});
      return res.json({ok:true,businessType:requestedBusinessType,reportDate,shipmentCodes,rows,scanRows:local.scanRows,shipmentRows:[...shipment.rows,...local.shipmentRows],trackEvents,localEvidence:localEvents.length>0||local.scanRows.length>0||local.shipmentRows.length>0,ledger:local.ledger,exceptionItems:exceptions.rows,batches:[...shipment.batches,...events.batches,...exceptions.batches]});
    }
    const scans=await manualBatchQuery(shipmentCodes,codes=>client.confirmQuery(codes),'confirm-query');
    const events=await manualBatchQuery(shipmentCodes,codes=>client.trackQuery(codes),'tms-shipment-event/query');
    const merged=[...events.rows,...localEvents];const seen=new Set();
    const trackEvents=merged.filter(row=>{const key=JSON.stringify([row.shipmentCode||row.waybill||'',row.eventTime||row.time||'',row.eventCode||row.trackingEventCode||'',row.trackingEventDesc||row.description||row.rawJson||'']);if(seen.has(key))return false;seen.add(key);return true});
    return res.json({ok:true,businessType:requestedBusinessType,reportDate,shipmentCodes,scanRows:[...scans.rows,...local.scanRows],shipmentRows:local.shipmentRows,trackEvents,localEvidence:localEvents.length>0||local.scanRows.length>0||local.shipmentRows.length>0,ledger:local.ledger,batches:[...scans.batches,...events.batches]});
  }catch(error){
    if(localEvents.length||local.scanRows.length||local.shipmentRows.length||local.ledger.length)return res.json({ok:true,businessType:requestedBusinessType,reportDate,shipmentCodes,trackEvents:localEvents,scanRows:local.scanRows,shipmentRows:local.shipmentRows,localEvidence:true,remoteError:error.message||'远程轨迹查询失败',ledger:local.ledger});
    res.status(500).json({ok:false,error:error.message||'轨迹查询失败。'});
  }
});

// V765: short-lived read-only memoization for identical selected-date,
 // same-user business workspaces. No SQLite writes; explicit refresh bypasses.
const v765WorkspaceReadCache=new Map();
const V765_WORKSPACE_TTL_MS=20000;
app.get('/api/tracking-workspace', async (req, res) => {
  // Resolve an authenticated, explicit date/snapshot cache hit BEFORE reading
  // the latest import. Incomplete URL contexts never enter the cache.
  const explicitSnapshotId=String(req.query.snapshotId||'');
  const explicitReportDate=String(req.query.reportDate||'');
  const scope = ['all', 'pod'].includes(String(req.query.scope || '')) ? String(req.query.scope) : 'actionable';
  const requestedBusinessType=String(req.query.businessType||'').trim().toUpperCase();
  const qcActionMode=String(req.query.qcAction||'')==='1';
  // QC must never substitute a newer day's final status for selected history.
  const qcPinned=qcActionMode?fastDashboardBatch(explicitSnapshotId,explicitReportDate):null;
  if(qcActionMode&&!qcPinned)return res.status(404).json({
    ok:false,code:'QC_SOURCE_SNAPSHOT_MISSING',error:'该日期没有可核验的有效日报快照，请先选择已导入日期。'
  });
  if(qcActionMode&&explicitReportDate&&String(qcPinned.reportDate)!==explicitReportDate)return res.status(409).json({
    ok:false,code:'QC_SOURCE_DATE_MISMATCH',error:'指定日期与快照不一致，已停止显示其他日期的运单。'
  });
  const identity=String(req.user?.id||req.user?.email||req.user?.username||'').trim();
  const cacheEligible=Boolean(identity&&explicitSnapshotId&&explicitReportDate&&requestedBusinessType&&scope==='all');
  const cacheKey=cacheEligible?[identity,requestedBusinessType,explicitReportDate,explicitSnapshotId,scope].join('|'):'';
  const previous=cacheEligible&&String(req.query.fresh||'')!=='1'?v765WorkspaceReadCache.get(cacheKey):null;
  if(previous&&Date.now()-previous.at<V765_WORKSPACE_TTL_MS){
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-CE-QC-Workspace-Cache','HIT');
    return res.json(previous.payload);
  }
  const unified=qcActionMode?null:getLatestUnifiedImport();
  const snapshotId=qcActionMode?String(qcPinned.snapshotId):explicitSnapshotId||String(unified?.snapshotId||'');
  const reportDate=qcActionMode?String(qcPinned.reportDate):explicitReportDate||String(unified?.reportDate||'');
  const unifiedTypes=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);
  let states = [];
  if (snapshotId) {
    if(unifiedTypes.has(requestedBusinessType)){
      states=[loadLightweightUnifiedBusinessState(requestedBusinessType,snapshotId)];
    }else if(requestedBusinessType==='WHPP'){
      const whppState=loadWhppState();
      if(!reportDate||String(whppState.reportDate||'')===reportDate)states=[whppState];
    }else{
      states = ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].map(type => loadLightweightUnifiedBusinessState(type, snapshotId));
      const whppState = loadWhppState();
      if (!reportDate || String(whppState.reportDate || '') === reportDate) states.push(whppState);
    }
  }
  if (!qcActionMode&&!states.some(state => state?.finalRows?.length)) {
    if(requestedBusinessType==='WHPP')states=[loadWhppState()];
    else if(requestedBusinessType.startsWith('SHOPEE'))states=[loadBusinessState(SHOPEE)];
    else if(['CE','CEAF','TBKH','ALI1688'].includes(requestedBusinessType))states=[loadLightweightUnifiedBusinessState(requestedBusinessType,snapshotId)];
    else states = [await loadState(), loadBusinessState(SHOPEE), loadWhppState()];
  }
  const allRows = states.flatMap(state => workspaceRows(state, state.businessType || 'CCSL'));
  const priority = row => row.queryStatus === '待重试' ? 0 : row.isActionable ? 1 : 2;
  allRows.sort((a, b) => priority(a) - priority(b) || String(a.businessType).localeCompare(String(b.businessType)) || String(a.shipmentCode).localeCompare(String(b.shipmentCode)));
  const rows = scope === 'all' ? allRows : scope === 'pod' ? allRows.filter(row => row.isClosed) : allRows.filter(row => row.isActionable);
  const qualityBuckets={
    shopArrived:allRows.filter(row=>row.shopArrivedCurrent),
    pendingGap:allRows.filter(row=>row.pendingNonContinuous),
    oc2Plus:allRows.filter(row=>row.oc2Plus)
  };
  const qualitySignals={
    shopArrived:qualityBuckets.shopArrived.length,
    pendingGap:qualityBuckets.pendingGap.length,
    oc2Plus:qualityBuckets.oc2Plus.length,
    evidenceMode:'TRACK_FACTS_CURRENT_OPEN_ONLY',
    shopRule:'CURRENT_STORE_ARRIVAL_FROM_ACTIVE_CP_WHITELIST',
    pendingRule:'DISTINCT_PENDING_DATES_NON_CONTINUOUS',
    ocRule:'CURRENT_OC_INCLUSIVE_DAYS_GTE_2'
  };
  const qualityRows=Object.fromEntries(Object.entries(qualityBuckets).map(([key,list])=>[key,list.slice(0,1000)]));
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
    actionable: allRows.filter(row => row.isActionable).length,
    completed: allRows.filter(row => ['成功', 'POD跳过', '退回跳过', '特殊节点跳过', '正常分流跳过'].includes(row.queryStatus)).length
  };
  // A source batch with no finalized evidence is NOT a genuine zero-anomaly day.
  let qcCoverage=null;
  if(qcActionMode){
    const db=getDb();
    const source=db.prepare('SELECT COUNT(DISTINCT shipmentCode) AS count FROM unified_import_rows WHERE snapshotId=?').get(snapshotId);
    qcCoverage={sourceMembers:Number(source?.count||0),evidenceRows:allRows.length,
      hasFinalEvidence:allRows.length>0};
  }
  const payload={ok:true,reportDate,batchId:unified?.batchId||'',snapshotId,scope,
    allRowCount: allRows.length,summary,qualitySignals,qualityRows,qcCoverage,rows: rows.slice(0, 5000)};
  if(cacheEligible){
    v765WorkspaceReadCache.delete(cacheKey);
    v765WorkspaceReadCache.set(cacheKey,{at:Date.now(),payload});
    while(v765WorkspaceReadCache.size>2)v765WorkspaceReadCache.delete(v765WorkspaceReadCache.keys().next().value);
  }
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-CE-QC-Workspace-Cache','MISS');
  res.json(payload);
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
    const result = await exportPeriodReports({ periodType: req.query.periodType || 'daily', date: req.query.date || '', fromDate: req.query.fromDate || '', toDate: req.query.toDate || '', businessType: req.query.businessType || 'ALL' });
    res.download(result.file, path.basename(result.file));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

function selectUnifiedImportForDiagnostics(reportDate=''){
  const latest=getLatestUnifiedImport();
  if(String(latest?.reportDate||'')===reportDate)return latest;
  return listUnifiedImportHistory(1000).find(item=>String(item?.reportDate||'')===reportDate)||null;
}
app.get('/api/timing-diagnostics', (req,res)=>{
  const reportDate=String(req.query?.reportDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate))return res.status(400).json({ok:false,error:'缺少有效日报日期。'});
  const batch=selectUnifiedImportForDiagnostics(reportDate);
  if(!batch)return res.status(404).json({ok:false,error:'未找到该日报快照。'});
  const base=diagnoseSelectedDateTiming(reportDate,batch.snapshotId);
  const v736=diagnoseV736Timing(reportDate,batch.snapshotId);
  res.json({ok:true,...base,v736});
});
app.get('/api/selected-date-truth', (req,res)=>{
  const reportDate=String(req.query?.reportDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate))return res.status(400).json({ok:false,error:'缺少有效日报日期。'});
  const batch=selectUnifiedImportForDiagnostics(reportDate);
  if(!batch)return res.status(404).json({ok:false,error:'未找到该日报快照。'});
  let unifiedSnapshot=null;
  try{unifiedSnapshot=getDb().prepare("SELECT status,payloadJson,createdAt FROM unified_snapshots WHERE snapshotId=? LIMIT 1").get(batch.snapshotId)||null}catch{}
  const whppCompletion=persistentWhppCompletionTruth(getDb(),reportDate);
  const whppPod=persistentSelectedDatePodTruth(getDb(),'WHPP',reportDate);
  const cnPod=persistentSelectedDatePodTruth(getDb(),'SHOPEECN',reportDate);
  const vnPod=persistentSelectedDatePodTruth(getDb(),'SHOPEEVN',reportDate);
  const timing=diagnoseSelectedDateTiming(reportDate,batch.snapshotId);
  res.setHeader('Cache-Control','no-store');
  res.json({
    ok:true,build:'V681_SELECTED_DATE_TRUTH',reportDate,snapshotId:batch.snapshotId,
    unified:{status:String(unifiedSnapshot?.status||''),createdAt:String(unifiedSnapshot?.createdAt||'')},
    whppCompletion,
    podTruth:{
      WHPP:{source:whppPod.source,sourceCount:whppPod.sourceCount,resolvedCount:whppPod.resolvedCount,podCount:whppPod.bills.length,authoritative:whppPod.authoritative},
      SHOPEECN:{source:cnPod.source,sourceCount:cnPod.sourceCount,resolvedCount:cnPod.resolvedCount,podCount:cnPod.bills.length,authoritative:cnPod.authoritative},
      SHOPEEVN:{source:vnPod.source,sourceCount:vnPod.sourceCount,resolvedCount:vnPod.resolvedCount,podCount:vnPod.bills.length,authoritative:vnPod.authoritative}
    },
    timing
  });
});
// V759: scoped read-only WHPP completion proof. Do not run timing diagnostics or
// start a business job just to determine whether a persisted selected date is done.
app.get('/api/whpp/completion-proof', (req,res)=>{
  const reportDate=String(req.query?.reportDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate))return res.status(400).json({ok:false,code:'REPORT_DATE_INVALID',error:'缺少有效日报日期。'});
  const batch=selectUnifiedImportForDiagnostics(reportDate);
  if(!batch?.snapshotId)return res.status(404).json({ok:false,code:'UNIFIED_BATCH_MISSING',error:'未找到该日期的日报快照。'});
  res.setHeader('Cache-Control','no-store');
  return res.json({ok:true,reportDate,snapshotId:String(batch.snapshotId),whppCompletion:persistentWhppCompletionTruth(getDb(),reportDate)});
});
// V761: read-only selected-date CCSL/SHOPEE recovery disposition.
// No remote CE calls, run mutations, date switching, or inferred completion.
app.get('/api/family-recovery-proof', async (req,res)=>{
  const date=String(req.query?.reportDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ok:false,code:'REPORT_DATE_INVALID',error:'缺少有效日报日期'});
  // V766: normal reads stay in a separate worker, leaving this HTTP thread
  // responsive to menu navigation and quick dashboard metadata.
  if(process.env.CE_QC_FORCE_INLINE_READ!=='1'){
    try{
      const batch=fastDashboardBatch('',date);
      if(!batch)return res.status(404).json({ok:false,code:'VALID_BATCH_MISSING',error:'该日期缺少有效的综合日报'});
      const read=await v766ReadJob('FAMILY_PROOF',{reportDate:date,snapshotId:String(batch.snapshotId)});
      if(String(read.result?.snapshotId||'')!==String(batch.snapshotId))throw new Error('V766_SNAPSHOT_MISMATCH');
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-CE-QC-Read-Cache',read.cache);
      return res.json(read.result);
    }catch(error){
      return res.status(503).json({ok:false,code:'V766_READ_ONLY_WORKER_UNAVAILABLE',error:'历史核验仍在后台读取，请稍后重试；原始数据未发生修改。'});
    }
  }
  const db=getDb();
  const batch=db.prepare("SELECT snapshotId, batchId FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(date);
  if(!batch)return res.status(404).json({ok:false,code:'VALID_BATCH_MISSING',error:'该日期缺少有效的综合日报'});
  const snapshotId=String(batch.snapshotId||'');
  const currentCcsl=String(getCurrentReportDate()||'').slice(0,10);
  const currentShopee=String(getBusinessCurrentReportDate(SHOPEE)||'').slice(0,10);
  const groups=[
    {name:'CCSL',types:['CE','CEAF','TBKH','ALI1688'],lockTable:'run_locks',scanTable:'scan_results',finalTable:'final_rows',currentDate:currentCcsl},
    {name:'SHOPEE',types:['SHOPEECN','SHOPEEVN'],lockTable:'business_run_locks',scanTable:'business_scan_results',finalTable:'business_final_rows',currentDate:currentShopee}
  ];
  const result={};
  for(const group of groups){
    const markers=group.types.map(()=>'?').join(',');
    const sourceCount=Number(db.prepare(`SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) AS count FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND businessType IN (${markers})`).get(snapshotId,date,...group.types)?.count||0);
    const where=group.name==='SHOPEE'?'businessType=? AND reportDate=?':'reportDate=?';
    const args=group.name==='SHOPEE'?['SHOPEE',date]:[date];
    const lock=db.prepare(`SELECT runId,status,currentStage,errorMessage,completedAt,updatedAt FROM ${group.lockTable} WHERE ${where} LIMIT 1`).get(...args)||null;
    const scanCount=Number(db.prepare(`SELECT COUNT(DISTINCT shipmentCode) AS count FROM ${group.scanTable} WHERE ${where}`).get(...args)?.count||0);
    const finalCount=Number(db.prepare(`SELECT COUNT(DISTINCT shipmentCode) AS count FROM ${group.finalTable} WHERE ${where}`).get(...args)?.count||0);
    const trajectoryTables=group.name==='SHOPEE'?['business_shipment_tracks','business_track_events']:['track_events'];
    let trackCount=0,evidenceReadable=true;
    try{
      for(const table of trajectoryTables){
        const row=db.prepare(`SELECT COUNT(DISTINCT shipmentCode) AS count FROM ${table} WHERE ${where}`).get(...args);
        trackCount+=Number(row?.count||0);
      }
    }catch{evidenceReadable=false}
    const status=String(lock?.status||'').toLowerCase();
    // V762: matching quantities alone cannot prove matching shipment identity.
    // Validate exact July-04 source membership against both independently saved
    // ledgers before allowing a historical completed run to repair UI progress.
    let exactMemberVerified=false,scanMissing=-1,finalMissing=-1;
    if(sourceCount>0&&scanCount===sourceCount&&finalCount===sourceCount&&['finished','completed'].includes(status)){
      try{
        const source=`SELECT DISTINCT UPPER(TRIM(shipmentCode)) AS code FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND businessType IN (${markers})`;
        const scanWhere=group.name==='SHOPEE'?"businessType='SHOPEE' AND reportDate=?":"reportDate=?";
        const scanSet=`SELECT DISTINCT UPPER(TRIM(shipmentCode)) AS code FROM ${group.scanTable} WHERE ${scanWhere}`;
        const finalSet=`SELECT DISTINCT UPPER(TRIM(shipmentCode)) AS code FROM ${group.finalTable} WHERE ${scanWhere}`;
        const missingQuery=part=>`SELECT COUNT(*) AS count FROM (${source} EXCEPT ${part})`;
        scanMissing=Number(db.prepare(missingQuery(scanSet)).get(snapshotId,date,...group.types,date)?.count??-1);
        finalMissing=Number(db.prepare(missingQuery(finalSet)).get(snapshotId,date,...group.types,date)?.count??-1);
        exactMemberVerified=scanMissing===0&&finalMissing===0;
      }catch(error){console.warn('[CE-QC][V762] read-only exact completion membership unavailable',date,group.name,error?.message||error)}
    }
    let action='BLOCKED',reason='';
    if(sourceCount===0){action='ZERO_TICKET';reason='该日期该业务确实0票'}
    else if(status==='finished'||status==='completed'){action='DONE';reason='存在业务完成锁；不重复扫描'}
    else if(status==='running'){action='WAIT';reason='已有运行任务；不重复启动'}
    else if(group.currentDate!==date){action='BLOCKED';reason='后台当前业务日期与诊断日期不一致'}
    else if(['paused','failed'].includes(status)&&lock?.runId){action='RESUME';reason='存在中断任务，允许从断点恢复'}
    else if(evidenceReadable&&!lock?.runId&&scanCount===0&&finalCount===0&&trackCount===0){action='START';reason='没有运行锁且无已保存扫描/最终记录，可首次启动'}
    else {action='BLOCKED';reason='存在扫描、轨迹、最终记录、读取失败或不可辨识运行锁，需要保留历史证据并人工排查'}
    result[group.name]={sourceCount,scanCount,finalCount,scanMissing,finalMissing,exactMemberVerified,trackCount,evidenceReadable,runId:String(lock?.runId||''),runStatus:status||'NOT_STARTED',phase:String(lock?.currentStage||''),error:String(lock?.errorMessage||''),currentDate:group.currentDate,action,reason};
  }
  res.setHeader('Cache-Control','no-store');
  return res.json({ok:true,reportDate:date,snapshotId,businesses:result});
});
app.post('/api/timing-repair/start', (req,res)=>{
  const reportDate=String(req.body?.reportDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate))return res.status(400).json({ok:false,error:'缺少有效日报日期。'});
  const latest=getLatestUnifiedImport();
  const history=listUnifiedImportHistory(1000);
  const batch=(latest?.reportDate===reportDate?latest:history.find(item=>String(item.reportDate||'')===reportDate))||null;
  if(!batch?.snapshotId)return res.status(404).json({ok:false,error:'未找到该日报的有效快照。'});
  const types=['TBKH','WHPP','SHOPEECN','SHOPEEVN'];
  const states=Object.fromEntries(types.map(type=>[type,requestSelectedDateTimingRepair(type,reportDate,batch.snapshotId)]));
  res.json({ok:true,reportDate,snapshotId:batch.snapshotId,states});
});

app.get('/api/timing-repair/status', (req,res)=>{
  const reportDate=String(req.query?.reportDate||'').slice(0,10);
  const snapshotId=String(req.query?.snapshotId||'');
  const types=['TBKH','WHPP','SHOPEECN','SHOPEEVN'];
  res.json({ok:true,reportDate,states:Object.fromEntries(types.map(type=>[type,inspectSelectedDateTimingRepair(type,reportDate,snapshotId)]))});
});

app.post('/api/export-period/job', (req, res) => {
  const jobId=randomUUID();
  const createdAt=new Date().toISOString();
  updateExportJob(jobId,{status:'QUEUED',progress:1,phase:'QUEUED',message:'导出任务已创建，等待生成',createdAt,files:[]});
  const payload={periodType:req.body?.periodType||'daily',date:req.body?.date||'',fromDate:req.body?.fromDate||'',toDate:req.body?.toDate||'',businessType:req.body?.businessType||'ALL'};
  setImmediate(async()=>{
    try{
      updateExportJob(jobId,{status:'RUNNING',progress:3,phase:'PREPARING',message:'正在准备报表数据'});
      const result=await exportPeriodReports({...payload,onProgress:info=>updateExportJob(jobId,{status:'RUNNING',progress:Number(info.progress||0),phase:info.phase||'GENERATING',message:info.message||'正在生成报表'})});
      const files=[...result.files,result.file].filter((value,index,list)=>list.indexOf(value)===index).map(file=>({name:path.basename(file),url:`/api/export-file?name=${encodeURIComponent(path.basename(file))}`}));
      updateExportJob(jobId,{status:'COMPLETED',progress:100,phase:'COMPLETED',message:'报表生成完成，可下载',files,range:result.range,completedAt:new Date().toISOString()});
    }catch(error){
      updateExportJob(jobId,{status:'FAILED',phase:'FAILED',message:'报表生成失败',error:error?.message||String(error),completedAt:new Date().toISOString()});
    }
  });
  res.json({ok:true,job:publicExportJob(v652ExportJobs.get(jobId))});
});

app.get('/api/export-period/job/:jobId', (req,res)=>{
  const job=v652ExportJobs.get(String(req.params.jobId||''));
  if(!job)return res.status(404).json({ok:false,error:'未找到该报表任务，可能已重启系统。'});
  res.json({ok:true,job:publicExportJob(job)});
});

app.post('/api/export-period/prepare', async (req, res) => {
  try {
    const result = await exportPeriodReports({ periodType: req.body?.periodType || 'daily', date: req.body?.date || '', fromDate: req.body?.fromDate || '', toDate: req.body?.toDate || '', businessType: req.body?.businessType || 'ALL' });
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

app.get('/api/whpp-timing-source-diagnostics', (req,res)=>{
  try{
    const reportDate=String(req.query.reportDate||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate))return res.status(400).json({ok:false,error:'reportDate格式必须为YYYY-MM-DD'});
    res.json(diagnoseWhppDailyTimingSources(reportDate,Number(req.query.limit||8)));
  }catch(error){res.status(500).json({ok:false,error:String(error?.message||error)})}
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

function evidenceBill(value={}) {
  return String(typeof value==='string'?value:(value.shipmentCode||value.运单号||value.waybill||'')).trim().toUpperCase();
}
function sameMembership(left=[],right=[]) {
  const a=[...new Set((left||[]).map(evidenceBill).filter(Boolean))].sort();
  const b=[...new Set((right||[]).map(evidenceBill).filter(Boolean))].sort();
  return a.length===b.length&&a.every((value,index)=>value===b[index]);
}
function retainSameDayEvidence(state={},allowedBills=[]) {
  const allowed=new Set((allowedBills||[]).map(evidenceBill).filter(Boolean));
  const filterRows=key=>{if(Array.isArray(state[key]))state[key]=state[key].filter(row=>allowed.has(evidenceBill(row)));};
  const filterBills=key=>{if(Array.isArray(state[key]))state[key]=state[key].map(evidenceBill).filter(code=>allowed.has(code));};
  for(const key of ['scanResults','shipmentTrackResults','trackResults','trackEvents','exceptionItems','finalRows','finalDiversionRows','priorCarryRows'])filterRows(key);
  for(const key of ['scanPool','scanRetryBills','needTrackBills','carryBills','nextCarryBills'])filterBills(key);
  // Batch/query checkpoints can refer to removed members. Rebuild them on the next run
  // while preserving the actual per-shipment scan/track/final evidence above.
  for(const key of ['scanQueryStatus','shipmentQueryStatus','eventQueryStatus','exceptionQueryStatus','apiBatchStatus'])state[key]=[];
  return state;
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

function workspacePendingNonContinuous(row = {}) {
  const explicit=String(row.pendingNonContinuous ?? row.Pending不连续 ?? '').trim().toUpperCase();
  if(['TRUE','1','YES','Y','是'].includes(explicit))return true;
  const days=Number(row.pendingDistinctDayCount ?? row.Pending次数 ?? row.Pending天数 ?? 0);
  const continuity=String(row.pendingFactDateContinuity || row.Pending事实连续性 || row.pendingContinuity || row.Pending连续性 || '').trim();
  return days>=2 && /不连续|NON[_ -]?CONTINUOUS|GAP/i.test(continuity);
}
function workspaceStoreArrived(row = {}) {
  const shopState=String(row.shopState || row.shopStatus || row.门店状态 || row.storeFlowState || '').trim().toUpperCase();
  const current=String(row.currentState || row.scanNormalizedState || '').trim().toUpperCase();
  const category=String(row.primaryCategory || row.主分类 || row.异常分类 || '').trim();
  return ['SHOP_ARRIVED_CURRENT','SHOP_PENDING','SHOP_OC','SHOP_RETENTION'].includes(shopState)
    || ['SHOP_ARRIVED_CURRENT','SHOP_PENDING','SHOP_OC','SHOP_RETENTION'].includes(current)
    || /门店入库|门店PENDING|门店OC|门店滞留/.test(category);
}
function workspaceOcDays(row = {}, reportDate = '') {
  const ordinary=Math.max(0,Number(row.OC天数 ?? row.ocDays ?? 0));
  const current=String(row.currentState || row.scanNormalizedState || '').trim().toUpperCase();
  const category=String(row.primaryCategory || row.主分类 || row.异常分类 || '').trim();
  const storeOc=current==='SHOP_OC'||/门店OC/i.test(category);
  if(!storeOc)return ordinary;
  const retained=Math.max(0,Number(row.shopRetentionNaturalDays || row.门店滞留天数 || 0));
  if(retained)return Math.max(ordinary,retained);
  const start=String(row.shopOcAt || row.OC开始时间 || '').trim();
  const dayKey=value=>String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/)?.slice(1,4).join('-')||'';
  const a=dayKey(start),b=dayKey(reportDate || row.reportDate);
  if(a&&b){
    const ms=Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z');
    if(Number.isFinite(ms)&&ms>=0)return Math.max(ordinary,Math.floor(ms/86400000)+1);
  }
  return Math.max(ordinary,start?1:0);
}
function workspaceRows(state = {}, businessType = 'CCSL') {
  const scans = new Map((state.scanResults || state.shipmentTrackResults || []).map(row => [billOfWorkspace(row), row]));
  const queryStatus = new Map([...(state.eventQueryStatus || []), ...(state.apiBatchStatus || [])].flatMap(row => (row.shipmentCodes || []).map(code => [String(code).toUpperCase(), row])));
  return (state.finalRows || []).map(row => {
    const shipmentCode = billOfWorkspace(row);
    const scan = scans.get(shipmentCode) || {};
    const batch = queryStatus.get(shipmentCode) || {};
    // TMS terminal facts: 60=POD, 81=returned; 80 remains RETURNING.
    // 85 is historical POD evidence. Prefer the saved shipment terminal code.
    const terminalCode=String(row.shipmentStatus ?? scan.shipmentStatus ?? row.orderStatus ?? scan.orderStatus ?? '').trim();
    const isPod = row.是否POD === '是' || terminalCode==='60' || terminalCode==='85';
    const returnText = `${row.退回状态 || ''} ${row.primaryCategory || ''}`.trim().toUpperCase();
    const isReturn = terminalCode==='81' || (
      /(^|\s)(已退回|退回完成|RETURNED|RETURN_COMPLETED|RETURN)(\s|$)/.test(returnText)
      && !/(未退回|非退回|待退回|NOT_RETURNED|NO_RETURN|PENDING_RETURN)/.test(returnText));
    const failed = /fail|失败|refresh_failed/i.test(`${row.查询状态 || ''} ${row.API状态 || ''} ${batch.status || ''}`);
    const specialState = row.specialState || row.primaryCategory || row.主分类 || '';
    const shopState = row.shopState || row.shopStatus || row.门店状态 || row.storeFlowState || '';
    const category = row.primaryCategory || row.主分类 || row.异常分类 || '';
    const specialClosed = ['SELF_PICKUP', 'CECN_RETENTION', 'CEZT_RETENTION', 'CCSL580_RETENTION'].includes(String(specialState || '').trim().toUpperCase());
    const normalFinal = category === '正常分流节点' || row.matchedRule === 'NORMAL_FINAL_HUB';
    const isClosed = isPod || isReturn || specialClosed || normalFinal;
    const isActionable = !isClosed;
    const reportDate=String(row.reportDate || state.reportDate || '').slice(0,10);
    const pendingNonContinuous=!isClosed&&workspacePendingNonContinuous(row);
    const shopArrivedCurrent=!isClosed&&workspaceStoreArrived(row);
    const ocDays=workspaceOcDays(row,reportDate);
    const oc2Plus=!isClosed&&ocDays>=2;
    return {
      shipmentCode, businessType: row.businessType || businessType, region: row.regionCode || row.区域 || '',
      scanStatus: isPod ? 'POD' : (isReturn ? 'RETURN' : (scan.orderStatus || row.扫描状态 || '已扫描')),
      latestNode: row.最后节点 || row.latestEventDesc || '', latestTime: row.最后节点时间 || row.latestEventTime || '',
      pendingRawEventCount: Number(row.pendingRawEventCount || 0), pendingDistinctDayCount: Number(row.pendingDistinctDayCount ?? row.Pending次数 ?? 0),
      pendingDates: Array.isArray(row.pendingDates) ? row.pendingDates : String(row.Pending日期 || '').split(/[,、]/).map(value => value.trim()).filter(Boolean),
      pendingContinuity: row.pendingFactDateContinuity || row.Pending事实连续性 || row.pendingContinuity || row.Pending连续性 || '',
      pendingNonContinuous, ocDays, oc2Plus,
      specialState, shopState, shopArrivedCurrent,
      shopCode: row.currentShopCode || row.门店编码 || row.targetShopCode || row.matchedShopCode || '',
      shopName: row.shopName || row.门店名称 || row.matchedShopName || '',
      shopArrivedAt: row.shopArrivedAt || row.门店入库时间 || '',
      shopRetentionDays:Number(row.shopRetentionNaturalDays || row.门店滞留天数 || 0),
      storeTags:Array.isArray(row.storeTags)?row.storeTags:[],
      category, isClosed, isActionable,
      queryStatus: isPod ? 'POD跳过' : (isReturn ? '退回跳过' : (specialClosed ? '特殊节点跳过' : (normalFinal ? '正常分流跳过' : (failed ? '待重试' : ((row.轨迹节点数 || row.轨迹节点数量 || 0) > 0 ? '成功' : '需查轨迹'))))),
      retryCount: Number(batch.attemptCount || row.retryCount || 0), reportDate, snapshotId: state.snapshotId || ''
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
  const dashboardScheduler = startDashboardCacheScheduler();
  console.log(`Dashboard cache: ${dashboardScheduler.started ? `background refresh every ${Math.round(DASHBOARD_CACHE_REFRESH_MS / 60000)} minutes (explicit opt-in)` : 'event-driven only; no startup/periodic worker'}`);
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
