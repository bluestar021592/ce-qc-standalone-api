import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './v234DashboardLiveTruthPatch.js';
import './v236DashboardCurrentRoutePatch.js';
import './v231MetricTruthUiInjectionPatch.js';

const PATCH_ID = '2026-08-22-v238-interactive-first-cache-prime-v1';

// Keep all expensive maintenance outside the synchronous web process. The
// visible current dashboard can read exact normalized truth directly; the child
// prepares seven-day trend caches shortly after first paint.
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
      child.once('error', error => console.warn('[CE-QC][V238] dashboard cache prime child failed:', error?.message || error));
      child.unref?.();
      console.log(`[CE-QC][V238] dashboard cache prime child started pid=${child.pid || '-'} after 3s first-paint grace period.`);
    } catch (error) {
      console.warn('[CE-QC][V238] dashboard cache prime spawn failed:', error?.message || error);
    }
  }, 3_000);
  timer.unref?.();
}
primeDashboardCacheInChild();

console.log(`[CE-QC][V238] ${PATCH_ID} current truth is direct/cache; seven-day trend cache primes in child after 3s; startup POD repair skipped.`);

export const V206_INTERACTIVE_FIRST_RUNTIME_PATCH_ID = PATCH_ID;
