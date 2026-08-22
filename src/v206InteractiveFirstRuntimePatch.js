import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './v234DashboardLiveTruthPatch.js';

const PATCH_ID = '2026-08-22-v235-interactive-first-runtime-v3';

// Normal dashboard/cache maintenance remains deferred so it cannot block the
// synchronous SQLite web process. A tiny isolated child primes only the latest
// completed day (+ recent seven-day trend cache) shortly after startup.
process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS = String(24 * 60 * 60 * 1000);
process.env.DASHBOARD_CACHE_REFRESH_MS = String(4 * 60 * 60 * 1000);
process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED = '0';
process.env.CE_QC_SKIP_STARTUP_POD_REPAIR = '1';

let primed = false;
function primeDashboardCacheInChild() {
  if (primed || String(process.env.CE_QC_DASHBOARD_CACHE_CHILD || '') === '1') return;
  primed = true;
  const workerFile = fileURLToPath(new URL('./dashboardCacheWorker.js', import.meta.url));
  const timer = setTimeout(() => {
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
        stdio: ['ignore','ignore','ignore']
      });
      child.once('error', error => console.warn('[CE-QC][V235] dashboard cache prime child failed:', error?.message || error));
      child.unref?.();
      console.log(`[CE-QC][V235] dashboard cache prime child started pid=${child.pid || '-'}; main dashboard process stays interactive.`);
    } catch (error) {
      console.warn('[CE-QC][V235] dashboard cache prime spawn failed:', error?.message || error);
    }
  }, 2500);
  timer.unref?.();
}
primeDashboardCacheInChild();

console.log(`[CE-QC][V235] ${PATCH_ID} live web process cache-only; isolated latest-day cache prime scheduled; startup POD repair skipped.`);

export const V206_INTERACTIVE_FIRST_RUNTIME_PATCH_ID = PATCH_ID;
