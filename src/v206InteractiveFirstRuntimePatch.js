import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './v266EvergreenEvidenceArchive.js';
import './v234DashboardLiveTruthPatch.js';
import './v236DashboardCurrentRoutePatch.js';
import './v231MetricTruthUiInjectionPatch.js';
import './v244ShopeeTrendRuntimePatch.js';
import './v246QcTrackingRuntimePatch.js';
import './v252LifecycleCoordinator.js';
// V287 keeps the historical V286 module in the startup chain only as a no-op
// compatibility marker. It no longer wraps express.application.get.
import './v286V253TrendTruthBridge.js';
// V288 arms a one-shot express.use hook that inserts static CSS/JS/image serving
// immediately before accessIdentity, then restores express.use. This prevents
// render-blocking browser assets from waiting on SQLite-backed session reads.
import './v288StaticAssetPreAuthPatch.js';
// The historical V253 backend remains available for instant-summary/region and
// compatibility reads, but visible browser trends are routed to /api/v273/trends
// by the fetch-only frontend bridge.
import './v253DashboardFastPath.js';
import './v254StorageHealthPatch.js';
// V255 retention guard is intentionally disabled from startup until its standalone
// module is rewritten and directly syntax-gated. Storage health remains read-only.
import './v256R2ZeroCostGuard.js';
import './v262ShopeeStrictEvidenceBackfill.js';
import './v263DeliveryKpiTrendPatch.js';

const PATCH_ID = '2026-08-24-v288-static-preauth-safe-visible-trend-runtime-v1';
const LEGACY_OBSERVABLE_PATCH_ID = '2026-08-23-v239-interactive-first-cache-prime-observable-v1';

// V253 first paint no longer depends on dashboard_daily_cache. Keep the old cache
// builder only as delayed maintenance so it cannot compete with normal page reads.
// Visible browser trends now request /api/v273/trends directly through the frontend
// fetch bridge. V273 delegates to V284 proven seven-business truth. V288 separately
// removes CSS/JS/image requests from the DB-backed accessIdentity critical path while
// keeping HTML navigation and every API authenticated.
// V246/V252 persistent tracking still owns import admission, two-hour OPEN refresh
// synchronization and Cambodia 02:00 deep reconciliation. V263 adds attempt/signing
// evidence only for TBKH + SHOPEECN + SHOPEEVN.
process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS = String(24 * 60 * 60 * 1000);
process.env.DASHBOARD_CACHE_REFRESH_MS = String(4 * 60 * 60 * 1000);
process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED = '0';
process.env.CE_QC_SKIP_STARTUP_POD_REPAIR = '1';

let primeAttempts = 0;
const MAX_PRIME_ATTEMPTS = 4;
const RETRYABLE_RESULT = /FOREGROUND_PROCESSING_ACTIVE|CACHE_OR_PURGE_WORKER_ALREADY_ACTIVE/;

function primeDashboardCacheInChild(delayMs = 60_000) {
  if (String(process.env.CE_QC_DASHBOARD_CACHE_CHILD || '') === '1') return;
  if (primeAttempts >= MAX_PRIME_ATTEMPTS) return;
  const workerFile = fileURLToPath(new URL('./dashboardCacheWorker.js', import.meta.url));
  const timer = setTimeout(() => {
    primeAttempts += 1;
    try {
      const child = spawn(process.execPath, [workerFile, '--reason', 'V235_INTERACTIVE_STARTUP'], {
        cwd: process.cwd(),
        windowsHide: true,
        detached: false,
        env: {
          ...process.env,
          CE_QC_DASHBOARD_CACHE_CHILD: '1',
          SQLITE_CACHE_KIB: '8192',
          SQLITE_MMAP_BYTES: '0',
          SQLITE_TEMP_STORE: 'FILE'
        },
        stdio: ['ignore','pipe','pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.setEncoding?.('utf8');
      child.stderr?.setEncoding?.('utf8');
      child.stdout?.on('data', chunk => { if (stdout.length < 65536) stdout += String(chunk || ''); });
      child.stderr?.on('data', chunk => { if (stderr.length < 65536) stderr += String(chunk || ''); });
      child.once('error', error => console.warn('[CE-QC][V253] dashboard cache maintenance child failed:', error?.message || error));
      child.once('exit', (code, signal) => {
        const cleanOut = stdout.trim().replace(/\s+/g, ' ').slice(0, 12000);
        const cleanErr = stderr.trim().replace(/\s+/g, ' ').slice(0, 12000);
        console.log(`[CE-QC][V239] dashboard cache prime child exit code=${code ?? '-'} signal=${signal || '-'}${cleanOut ? ` result=${cleanOut}` : ''}${cleanErr ? ` stderr=${cleanErr}` : ''}`);
        if (code === 0 && RETRYABLE_RESULT.test(cleanOut) && primeAttempts < MAX_PRIME_ATTEMPTS) {
          console.log(`[CE-QC][V253] delayed cache maintenance skipped; retry ${primeAttempts + 1}/${MAX_PRIME_ATTEMPTS} in 60s.`);
          primeDashboardCacheInChild(60_000);
        }
      });
      console.log(`[CE-QC][V239] dashboard cache maintenance child started pid=${child.pid || '-'} after ${Math.round(delayMs/1000)}s; visible browser trends use V273 -> V284 proven truth; cache child is maintenance/audit only.`);
    } catch (error) {
      console.warn('[CE-QC][V253] delayed cache maintenance spawn failed:', error?.message || error);
      if (primeAttempts < MAX_PRIME_ATTEMPTS) primeDashboardCacheInChild(60_000);
    }
  }, delayMs);
  timer.unref?.();
}
primeDashboardCacheInChild();

console.log(`[CE-QC][V288] ${PATCH_ID} preserves ${LEGACY_OBSERVABLE_PATCH_ID}; static CSS/JS/image assets no longer wait on SQLite session reads; HTML/API remain authenticated; visible browser trends use V273 -> V284/V286 proven seven-business truth.`);

export const V206_INTERACTIVE_FIRST_RUNTIME_PATCH_ID = PATCH_ID;
