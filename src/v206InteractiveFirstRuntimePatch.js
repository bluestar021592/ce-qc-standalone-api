import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './v266EvergreenEvidenceArchive.js';
import './v234DashboardLiveTruthPatch.js';
import './v236DashboardCurrentRoutePatch.js';
import './v231MetricTruthUiInjectionPatch.js';
import './v244ShopeeTrendRuntimePatch.js';
import './v246QcTrackingRuntimePatch.js';
import './v252LifecycleCoordinator.js';
// V289 restores the exact last-known-good first-paint module structure from
// commit 88439846. V286/V288 remain available as retired diagnostic modules but
// are deliberately NOT imported into the interactive startup chain. Seven-business
// V284/V286 truth stays in the read/data layer and is not rolled back here.
import './v253DashboardFastPath.js';
import './v254StorageHealthPatch.js';
// V255 retention guard is intentionally disabled from startup until its standalone
// module is rewritten and directly syntax-gated. Storage health remains read-only.
import './v256R2ZeroCostGuard.js';
import './v262ShopeeStrictEvidenceBackfill.js';
import './v263DeliveryKpiTrendPatch.js';

const PATCH_ID = '2026-08-24-v289-known-good-first-paint-runtime-v1';
const LEGACY_OBSERVABLE_PATCH_ID = '2026-08-23-v239-interactive-first-cache-prime-observable-v1';

// Keep first paint on the same proven runtime structure that was working before
// the V286/V288 startup-hook experiments. Dashboard cache remains delayed
// maintenance only; V246/V252 persistent tracking still owns import admission,
// two-hour OPEN refresh synchronization and Cambodia 02:00 deep reconciliation.
// V284/V286 daily-membership/proven evidence truth remains active through its
// existing read models/audits and is intentionally not changed by this rollback.
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
      console.log(`[CE-QC][V239] dashboard cache prime child exit observable; maintenance child started pid=${child.pid || '-'} after ${Math.round(delayMs/1000)}s; first paint uses the restored known-good V253 runtime structure.`);
    } catch (error) {
      console.warn('[CE-QC][V253] delayed cache maintenance spawn failed:', error?.message || error);
      if (primeAttempts < MAX_PRIME_ATTEMPTS) primeDashboardCacheInChild(60_000);
    }
  }, delayMs);
  timer.unref?.();
}
primeDashboardCacheInChild();

console.log(`[CE-QC][V289] ${PATCH_ID} restores the 88439846 first-paint startup structure; V286/V288 Express startup hooks are retired from normal runtime; V284/V286 seven-business data truth remains preserved.`);

export const V206_INTERACTIVE_FIRST_RUNTIME_PATCH_ID = PATCH_ID;
