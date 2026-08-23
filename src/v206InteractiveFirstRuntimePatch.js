import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './v234DashboardLiveTruthPatch.js';
import './v236DashboardCurrentRoutePatch.js';
import './v231MetricTruthUiInjectionPatch.js';

const PATCH_ID = '2026-08-23-v242-force-rebuild-retry-v1';
const LEGACY_OBSERVABLE_PATCH_ID = '2026-08-23-v239-interactive-first-cache-prime-observable-v1';

// Keep all expensive maintenance outside the synchronous web process. The
// visible current dashboard can read exact normalized truth directly; the child
// prepares seven-day trend caches shortly after first paint.
process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS = String(24 * 60 * 60 * 1000);
process.env.DASHBOARD_CACHE_REFRESH_MS = String(4 * 60 * 60 * 1000);
process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED = '0';
process.env.CE_QC_SKIP_STARTUP_POD_REPAIR = '1';

let primeAttempts = 0;
const MAX_PRIME_ATTEMPTS = 4;
const RETRYABLE_RESULT = /FOREGROUND_PROCESSING_ACTIVE|CACHE_OR_PURGE_WORKER_ALREADY_ACTIVE/;

function primeDashboardCacheInChild(delayMs = 3_000) {
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
      child.once('error', error => console.warn('[CE-QC][V242] dashboard cache prime child failed:', error?.message || error));
      child.once('exit', (code, signal) => {
        const cleanOut = stdout.trim().replace(/\s+/g, ' ').slice(0, 12000);
        const cleanErr = stderr.trim().replace(/\s+/g, ' ').slice(0, 12000);
        console.log(`[CE-QC][V239] dashboard cache prime child exit code=${code ?? '-'} signal=${signal || '-'}${cleanOut ? ` result=${cleanOut}` : ''}${cleanErr ? ` stderr=${cleanErr}` : ''}`);
        if (code === 0 && RETRYABLE_RESULT.test(cleanOut) && primeAttempts < MAX_PRIME_ATTEMPTS) {
          console.log(`[CE-QC][V242] dashboard cache prime transiently skipped; retry ${primeAttempts + 1}/${MAX_PRIME_ATTEMPTS} in 30s.`);
          primeDashboardCacheInChild(30_000);
        }
      });
      console.log(`[CE-QC][V239] dashboard cache prime child started pid=${child.pid || '-'} after ${Math.round(delayMs/1000)}s first-paint grace period; attempt=${primeAttempts}/${MAX_PRIME_ATTEMPTS}.`);
    } catch (error) {
      console.warn('[CE-QC][V242] dashboard cache prime spawn failed:', error?.message || error);
      if (primeAttempts < MAX_PRIME_ATTEMPTS) primeDashboardCacheInChild(30_000);
    }
  }, delayMs);
  timer.unref?.();
}
primeDashboardCacheInChild();

console.log(`[CE-QC][V242] ${PATCH_ID} preserves ${LEGACY_OBSERVABLE_PATCH_ID}; current truth is direct/cache; recent seven-day trend cache is force-rebuilt in child after 3s and transient startup skips retry automatically.`);

export const V206_INTERACTIVE_FIRST_RUNTIME_PATCH_ID = PATCH_ID;
