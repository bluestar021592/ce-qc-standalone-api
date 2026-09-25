import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WRAPPED = Symbol.for('ce-qc.async-route-wrapped');
const V548_BOOTSTRAP_ID = '2026-09-15-v548-main-service-first-v1';
const V553_PERFORMANCE_BASELINE_ID = '2026-09-17-v553-aug22-main-sqlite-profile-v1';

// RECOVERY SAFE MODE (temporary): production data is preserved, but automatic
// large-database maintenance is not allowed to compete with the local web UI.
// Manual reads/imports remain available once the page is reachable. These flags
// are consumed by V147/V246/V252/V254/V262/V264 startup schedulers only.
process.env.CE_QC_RECOVERY_SAFE_MODE = '1';
process.env.CE_QC_DISABLE_V246_TRACKING = '1';
process.env.CE_QC_DISABLE_V262_STRICT_BACKFILL = '1';
process.env.CE_QC_DISABLE_STARTUP_STORAGE_SCAN = '1';

// V553 performance recovery: bootstrap must not globally downgrade SQLite.
// src/db.js already owns the process-specific policy that matched the healthy
// Aug-22 baseline: main web/API process defaults to 64 MiB cache + 256 MiB mmap
// + MEMORY temp storage, while dedicated export workers default to a smaller
// 8 MiB cache + mmap=0 + FILE temp storage. Leaving SQLITE_* untouched here
// preserves explicit operator overrides and prevents main-process recovery
// settings from leaking into export workers.
const runtimeRoot = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'CE_QC_RUNTIME')
  : path.resolve(process.cwd(), 'runtime');
if (!process.env.EXPORTS_DIR) process.env.EXPORTS_DIR = path.join(runtimeRoot, 'exports');
try { fs.mkdirSync(process.env.EXPORTS_DIR, { recursive: true }); } catch {}

function cleanupOrphanPreUpdateBackups() {
  const defaultDataDir = 'D:\\CE CCSL金边数据库';
  const configured = String(process.env.DATA_DIR || defaultDataDir).trim();
  const dataDir = path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(process.cwd(), configured);
  const root = path.join(dataDir, 'backups', 'pre_update');
  const graceMs = 30 * 60 * 1000;
  if (!fs.existsSync(root)) return { removed: 0, freedBytes: 0, root };
  let removed = 0;
  let freedBytes = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const manifest = path.join(dir, 'manifest.json');
    const dbCopy = path.join(dir, 'ce_qc_monitor.db');
    if (fs.existsSync(manifest) || !fs.existsSync(dbCopy)) continue;
    let stat;
    try { stat = fs.statSync(dbCopy); } catch { continue; }
    if (Date.now() - Number(stat.mtimeMs || 0) < graceMs) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
      freedBytes += Number(stat.size || 0);
      console.log(`[CE-QC][STORAGE_RECOVERY] removed orphan pre-update backup ${dir} (${(Number(stat.size || 0) / 1024 / 1024 / 1024).toFixed(2)} GiB)`);
    } catch (error) {
      console.warn('[CE-QC][STORAGE_RECOVERY] orphan backup cleanup failed:', dir, error?.message || error);
    }
  }
  return { removed, freedBytes, root };
}

const storageRecovery = cleanupOrphanPreUpdateBackups();
const sqliteMainPolicy = {
  sqliteCacheKiB: Number(process.env.SQLITE_CACHE_KIB || 64 * 1024),
  sqliteMmapBytes: Number(process.env.SQLITE_MMAP_BYTES ?? 256 * 1024 * 1024),
  sqliteTempStore: String(process.env.SQLITE_TEMP_STORE || 'MEMORY').toUpperCase(),
  sqlitePolicySource: process.env.SQLITE_CACHE_KIB || process.env.SQLITE_MMAP_BYTES || process.env.SQLITE_TEMP_STORE ? 'environment' : 'db.js-main-default'
};
console.log('[CE-QC][RESOURCE_POLICY]', JSON.stringify({
  revision: V553_PERFORMANCE_BASELINE_ID,
  ...sqliteMainPolicy,
  exportsDir: process.env.EXPORTS_DIR,
  orphanBackupDirsRemoved: storageRecovery.removed,
  orphanBackupGiBFreed: Number((storageRecovery.freedBytes / 1024 / 1024 / 1024).toFixed(2))
}));

// Normal operation is interactive-first. Dashboard cache maintenance must never
// compete with users every ten minutes on the same local SQLite file. Two hours
// matches the QC refresh requirement; an empty cache warms only the recent week.
if (!process.env.DASHBOARD_CACHE_REFRESH_MS) process.env.DASHBOARD_CACHE_REFRESH_MS = String(2 * 60 * 60 * 1000);
if (!process.env.DASHBOARD_CACHE_WARM_DAYS) process.env.DASHBOARD_CACHE_WARM_DAYS = '7';
if (!process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS) process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS = '120000';
if (!process.env.CE_QC_EXPORT_SIDECAR_PORT) process.env.CE_QC_EXPORT_SIDECAR_PORT = '5178';
if (!process.env.CE_QC_EXPORT_SIDECAR_START_DELAY_MS) process.env.CE_QC_EXPORT_SIDECAR_START_DELAY_MS = '3000';
if (!process.env.CE_QC_POST_SERVER_REPAIR_DELAY_MS) process.env.CE_QC_POST_SERVER_REPAIR_DELAY_MS = '15000';

function boundedDelayMs(rawValue, fallback, minValue, maxValue) {
  const parsed = Number(rawValue);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(minValue, Math.min(maxValue, Math.trunc(value)));
}

let exportSidecarChild = null;
function startExportSidecar() {
  if (String(process.env.CE_QC_EXPORT_SIDECAR_CHILD || '') === '1') return { started:false, reason:'SIDECAR_CHILD' };
  if (exportSidecarChild && exportSidecarChild.exitCode == null && !exportSidecarChild.killed) return { started:false, reason:'ALREADY_RUNNING', pid:exportSidecarChild.pid || 0 };
  const file = fileURLToPath(new URL('./src/v193ExportSidecar.js', import.meta.url));
  try {
    exportSidecarChild = spawn(process.execPath, [file], {
      cwd: process.cwd(),
      env: { ...process.env, CE_QC_EXPORT_SIDECAR_CHILD: '1' },
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    console.log(`[CE-QC][BOOT] V193 isolated export sidecar starting on demand pid=${exportSidecarChild.pid || '-'} port=${process.env.CE_QC_EXPORT_SIDECAR_PORT}`);
    exportSidecarChild.once('error', error => console.error('[CE-QC][BOOT] V193 export sidecar spawn failed:', error?.stack || error));
    exportSidecarChild.once('exit', (code, signal) => {
      console.log(`[CE-QC][BOOT] V193 export sidecar exited code=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}`);
      exportSidecarChild = null;
    });
    return { started:true, reason:'EXPLICIT_DEMAND', pid:exportSidecarChild.pid || 0 };
  } catch (error) {
    console.error('[CE-QC][BOOT] V193 export sidecar start failed:', error?.stack || error);
    return { started:false, reason:'SPAWN_FAILED', error:error?.message || String(error) };
  }
}

function scheduleExportSidecar() {
  if (String(process.env.CE_QC_EXPORT_SIDECAR_CHILD || '') === '1') return { scheduled:false, reason:'SIDECAR_CHILD' };
  if (String(process.env.CE_QC_ENABLE_EXPORT_SIDECAR_AT_STARTUP || '') !== '1') {
    console.log(`[CE-QC][BOOT] ${V548_BOOTSTRAP_ID} export sidecar startup disabled; 5178 starts only when the user explicitly launches an export.`);
    return { scheduled:false, reason:'ON_DEMAND_ONLY' };
  }
  const delayMs = boundedDelayMs(process.env.CE_QC_EXPORT_SIDECAR_START_DELAY_MS, 3000, 1000, 30000);
  const timer = setTimeout(() => startExportSidecar(), delayMs);
  timer.unref?.();
  console.log(`[CE-QC][BOOT] ${V548_BOOTSTRAP_ID} export sidecar explicit startup opt-in deferred ${delayMs}ms until after main server listen.`);
  return { scheduled:true, delayMs };
}

globalThis.__CE_QC_START_EXPORT_SIDECAR__ = () => startExportSidecar();
process.once('exit', () => { try { exportSidecarChild?.kill(); } catch {} });

function wrapHandler(handler) {
  if (typeof handler !== 'function') return handler;
  if (handler[WRAPPED]) return handler;
  const wrapped = function ceQcSafeAsyncHandler(req, res, next) {
    try {
      const result = handler.call(this, req, res, next);
      if (result && typeof result.then === 'function') result.catch(error => handleRouteError(error, req, res, next));
      return result;
    } catch (error) { return handleRouteError(error, req, res, next); }
  };
  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped;
}
function wrapArgument(value) { if (Array.isArray(value)) return value.map(wrapArgument); return wrapHandler(value); }
function handleRouteError(error, req, res, next) {
  const message = error?.message || String(error || 'Unknown server error');
  console.error(`[CE-QC][API_ERROR] ${req?.method || ''} ${req?.originalUrl || req?.url || ''}:`, error);
  if (res?.headersSent) { if (typeof next === 'function') return next(error); return; }
  if (String(req?.originalUrl || req?.url || '').startsWith('/api/')) { res.status(500).json({ ok: false, error: message, code: 'SERVER_ROUTE_ERROR' }); return; }
  if (typeof next === 'function') return next(error);
  res.status(500).send('CE QC server error');
}
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = express.application[method];
  if (typeof original !== 'function') continue;
  express.application[method] = function ceQcSafeRouteRegistration(...args) {
    if (method === 'get' && args.length === 1) return original.apply(this, args);
    if (args.length < 2) return original.apply(this, args);
    return original.apply(this, [args[0], ...args.slice(1).map(wrapArgument)]);
  };
}
process.on('unhandledRejection', reason => console.error('[CE-QC][UNHANDLED_REJECTION]', reason));
process.on('uncaughtExceptionMonitor', (error, origin) => console.error('[CE-QC][UNCAUGHT_EXCEPTION_FATAL]', origin || '', error?.stack || error));
process.on('warning', warning => console.warn('[CE-QC][NODE_WARNING]', warning?.stack || warning));

async function importPhase(label, modulePath) {
  const startedAt = Date.now();
  console.log(`[CE-QC][BOOT] START ${label}`);
  const loaded = await import(modulePath);
  console.log(`[CE-QC][BOOT] DONE ${label} ${Date.now() - startedAt}ms`);
  return loaded;
}

async function importServerInteractiveFirst() {
  const nativeSetTimeout = globalThis.setTimeout;
  const startupDelayMs = Math.max(30_000, Number(process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS || 120_000));
  globalThis.setTimeout = function ceQcInteractiveFirstTimeout(callback, delay, ...args) {
    let effectiveDelay = delay;
    if (Number(delay) === 1500 && typeof callback === 'function') {
      let source = '';
      try { source = Function.prototype.toString.call(callback); } catch {}
      if (/launchDashboardCacheWorker/.test(source) && /STARTUP_WARM/.test(source)) {
        effectiveDelay = startupDelayMs;
        console.log(`[CE-QC][BOOT] dashboard STARTUP_WARM deferred from 1500ms to ${startupDelayMs}ms so first paint stays responsive.`);
      }
    }
    return nativeSetTimeout(callback, effectiveDelay, ...args);
  };
  try {
    return await importPhase('server', './server.js');
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
  }
}

function schedulePostServerRepair(v167Repair) {
  if (String(process.env.CE_QC_SKIP_STARTUP_POD_REPAIR || '') === '1' || String(process.env.CE_QC_RECOVERY_SAFE_MODE || '') === '1') {
    console.log(`[CE-QC][BOOT] ${V548_BOOTSTRAP_ID} V167 startup POD-lock repair not scheduled; current write paths own POD-lock facts and explicit maintenance remains available.`);
    return { scheduled:false, reason:'STARTUP_REPAIR_DISABLED' };
  }
  const delayMs = boundedDelayMs(process.env.CE_QC_POST_SERVER_REPAIR_DELAY_MS, 15000, 5000, 120000);
  const timer = setTimeout(() => {
    try {
      const startedAt = Date.now();
      const result = v167Repair.repairLatestCcslPodLockFacts();
      console.log(`[CE-QC][BACKGROUND] V167 CCSL POD-lock fact repair ${Date.now()-startedAt}ms ${JSON.stringify(result)}`);
    } catch (error) {
      console.error('[CE-QC][BACKGROUND] V167 CCSL POD-lock fact repair failed:', error?.stack || error);
    }
  }, delayMs);
  timer.unref?.();
  console.log(`[CE-QC][BOOT] ${V548_BOOTSTRAP_ID} V167 repair explicit opt-in/deferred ${delayMs}ms.`);
  return { scheduled:true, delayMs };
}

function scheduleDeferredMaintenance({ v92, v76Repair }) {
  if (String(process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED || '').trim() !== '1') {
    console.log('[CE-QC][BOOT] background maintenance disabled on normal startup; first paint is not blocked.');
    return;
  }
  const delayMs = Math.max(5_000, Number(process.env.CE_QC_BACKGROUND_MAINTENANCE_DELAY_MS || 300_000));
  const timer = setTimeout(() => {
    try {
      const startedAt = Date.now();
      const result = v92.repairWhppTerminalAuthorityOnce();
      console.log(`[CE-QC][BACKGROUND] V92 WHPP terminal authority ${Date.now()-startedAt}ms ${JSON.stringify({skipped:Boolean(result.skipped),scanned:result.scanned,repaired:result.repaired,affectedDates:result.affectedDates})}`);
    } catch (error) {
      console.error('[CE-QC][BACKGROUND] V92 maintenance failed:', error?.stack || error);
    }
    try {
      const startedAt = Date.now();
      const result = v76Repair.repairLatestCeafSplit();
      console.log(`[CE-QC][BACKGROUND] V76 CEAF repair ${Date.now()-startedAt}ms ${JSON.stringify(result)}`);
    } catch (error) {
      console.error('[CE-QC][BACKGROUND] V76 maintenance failed:', error?.stack || error);
    }
  }, delayMs);
  timer.unref?.();
  console.log(`[CE-QC][BOOT] background maintenance explicitly enabled and deferred ${delayMs}ms; first paint is not blocked.`);
}

try {
  console.log(`[CE-QC][BOOT] bootstrap pid=${process.pid} node=${process.version}`);
  console.log(`[CE-QC][BOOT] ${V548_BOOTSTRAP_ID} main service has startup priority; non-interactive work starts only after listen.`);
  console.log('[CE-QC][RECOVERY_SAFE_MODE] automatic tracking/evidence/history/storage startup maintenance disabled; UI/API availability has priority.');
  await importPhase('v157CeNetworkDnsPatch', './src/v157CeNetworkDnsPatch.js');
  await importPhase('v147TrackTimeoutConfig', './src/v147TrackTimeoutConfig.js');
  await importPhase('v27ServerPatch', './src/v27ServerPatch.js');
  await importPhase('v27TrendPatch', './src/v27TrendPatch.js');
  await importPhase('v27CarryBusinessPatch', './src/v27CarryBusinessPatch.js');
  await importPhase('v28ResumeGuardPatch', './src/v28ResumeGuardPatch.js');
  await importPhase('v28RuntimePatch', './src/v28RuntimePatch.js');
  await importPhase('v29DataConsistencyPatch', './src/v29DataConsistencyPatch.js');
  await importPhase('v29BusinessRulesPatch', './src/v29BusinessRulesPatch.js');
  await importPhase('v29EndpointAliasPatch', './src/v29EndpointAliasPatch.js');
  await importPhase('v30CarryRulesPatch', './src/v30CarryRulesPatch.js');
  await importPhase('v162ShopeeLiveProgressPatch', './src/v162ShopeeLiveProgressPatch.js');
  await importPhase('v163ShopeeDailyIsolationPatch', './src/v163ShopeeDailyIsolationPatch.js');
  await importPhase('v33RunProgressPatch', './src/v33RunProgressPatch.js');
  await importPhase('v39UnifiedSnapshotRecoveryPatch', './src/v39UnifiedSnapshotRecoveryPatch.js');
  await importPhase('v41AuthPausePatch', './src/v41AuthPausePatch.js');
  await importPhase('v53WhppRefreshGatePatch', './src/v53WhppRefreshGatePatch.js');
  await importPhase('v75CeafUploadNormalizerPatch', './src/v75CeafUploadNormalizerPatch.js');
  await importPhase('v102UnifiedImportSafetyGatePatch', './src/v102UnifiedImportSafetyGatePatch.js');
  await importPhase('v146UnifiedImportDateBridgePatch', './src/v146UnifiedImportDateBridgePatch.js');
  await importPhase('v42WhppPatch', './src/v42WhppPatch.js');
  await importPhase('v44WhppUiPatch', './src/v44WhppUiPatch.js');
  await importPhase('v89StaticAssetCachePatch', './src/v89StaticAssetCachePatch.js');
  await importPhase('v43BootstrapPerfPatch', './src/v43BootstrapPerfPatch.js');
  await importPhase('v46ColdStartIndexPatch', './src/v46ColdStartIndexPatch.js');
  await importPhase('v48RoutingPatch', './src/v48RoutingPatch.js');
  await importPhase('v49DashboardCorrectnessPatch', './src/v49DashboardCorrectnessPatch.js');
  await importPhase('v50DashboardSourceTruthPatch', './src/v50DashboardSourceTruthPatch.js');
  await importPhase('v51WhppLegacyEvidencePatch', './src/v51WhppLegacyEvidencePatch.js');
  await importPhase('v55DashboardReconciliationPatch', './src/v55DashboardReconciliationPatch.js');
  await importPhase('v70ConfirmQueryResiliencePatch', './src/v70ConfirmQueryResiliencePatch.js');
  await importPhase('v141WhppDailyRetryIsolationPatch', './src/v141WhppDailyRetryIsolationPatch.js');
  await importPhase('v165WhppRunStateRecoveryPatch', './src/v165WhppRunStateRecoveryPatch.js');
  await importPhase('v142SevenBusinessExportPatch', './src/v142SevenBusinessExportPatch.js');
  await importPhase('v71WhppSummaryPatch', './src/v71WhppSummaryPatch.js');
  await importPhase('v84AsyncExportPatch', './src/v84AsyncExportPatch.js');
  await importPhase('v176AsyncExportRecoveryPatch', './src/v176AsyncExportRecoveryPatch.js');
  await importPhase('v142AsyncExportPreflightPatch', './src/v142AsyncExportPreflightPatch.js');
  await importPhase('v85ShopeeWhppMetricPatch', './src/v85ShopeeWhppMetricPatch.js');
  await importPhase('v86StrictTrackStatusGate', './src/v86StrictTrackStatusGate.js');
  await importPhase('v89InstantDashboardPatch', './src/v89InstantDashboardPatch.js');
  await importPhase('v90FastDashboardReadPatch', './src/v90FastDashboardReadPatch.js');
  await importPhase('v94ShopeeWhppSourceTruthPatch', './src/v94ShopeeWhppSourceTruthPatch.js');
  await importPhase('v94UnifiedImportDisplayTruthPatch', './src/v94UnifiedImportDisplayTruthPatch.js');
  await importPhase('v161UnifiedImportRuntimeTruthPatch', './src/v161UnifiedImportRuntimeTruthPatch.js');
  const v167Repair = await importPhase('v167CcslPodLockFactRepair', './src/v167CcslPodLockFactRepair.js');

  await importPhase('v581StableShellResponsePatch', './src/v581StableShellResponsePatch.js');

  const v92 = await importPhase('v92WhppTerminalAuthority', './src/v92WhppTerminalAuthorityOnce.js');
  await importPhase('v93ShopeeResumeResiliencePatch', './src/v93ShopeeResumeResiliencePatch.js');
  await importPhase('v73CeafSourceMarkerPatch', './src/v73CeafSourceMarkerPatch.js');
  await importPhase('v74CeafDuplicateReimportPatch', './src/v74CeafDuplicateReimportPatch.js');
  const v76Repair = await importPhase('v76CurrentCeafSplitRepair', './src/v76CurrentCeafSplitRepair.js');

  await importServerInteractiveFirst();
  scheduleExportSidecar();
  schedulePostServerRepair(v167Repair);
  scheduleDeferredMaintenance({ v92, v76Repair });
} catch (error) {
  console.error('[CE-QC][STARTUP_FATAL]', error?.stack || error);
  process.exitCode = 1;
}
