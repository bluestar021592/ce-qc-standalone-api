import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// V290 MUST be the first CE-QC runtime dependency. It protects the web process
// before V281/V283/V284/V246/V252/V262/V264 register automatic maintenance timers.
import './v290StartupMaintenanceGuard.js';
import './v266EvergreenEvidenceArchive.js';
import './v234DashboardLiveTruthPatch.js';
import './v236DashboardCurrentRoutePatch.js';
import './v231MetricTruthUiInjectionPatch.js';
import './v244ShopeeTrendRuntimePatch.js';
import './v246QcTrackingRuntimePatch.js';
import './v252LifecycleCoordinator.js';
// V289 restored the last-known-good first-paint module structure from 88439846.
// V286/V288 remain retired diagnostic modules and are deliberately NOT imported.
// V290 now protects that known-good structure from automatic large-SQLite startup
// maintenance without changing any seven-business business truth.
import './v253DashboardFastPath.js';
import './v254StorageHealthPatch.js';
// V255 retention guard is intentionally disabled from startup until its standalone
// module is rewritten and directly syntax-gated. Storage health remains read-only.
import './v256R2ZeroCostGuard.js';
import './v262ShopeeStrictEvidenceBackfill.js';
import './v263DeliveryKpiTrendPatch.js';

const PATCH_ID = '2026-08-24-v290-first-paint-main-thread-protection-v1';
const LEGACY_OBSERVABLE_PATCH_ID = '2026-08-23-v239-interactive-first-cache-prime-observable-v1';

// Interactive first paint is authoritative. Automatic heavy database maintenance
// is staggered by V290; dashboard cache remains child-process maintenance only.
// V246/V252 lifecycle logic, V284/V286 daily-membership truth and all historical
// import evidence remain intact.
process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS = String(24 * 60 * 60 * 1000);
process.env.DASHBOARD_CACHE_REFRESH_MS = String(4 * 60 * 60 * 1000);
process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED = '0';
process.env.CE_QC_SKIP_STARTUP_POD_REPAIR = '1';

let primeAttempts = 0;
const MAX_PRIME_ATTEMPTS = 4;
const RETRYABLE_RESULT = /FOREGROUND_PROCESSING_ACTIVE|CACHE_OR_PURGE_WORKER_ALREADY_ACTIVE/;

function primeDashboardCacheInChild(delayMs = 5 * 60_000) {
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
      console.log(`[CE-QC][V239] dashboard cache prime child exit observable; maintenance child started pid=${child.pid || '-'} after ${Math.round(delayMs/1000)}s; V290 keeps first paint free of automatic DB maintenance.`);
    } catch (error) {
      console.warn('[CE-QC][V253] delayed cache maintenance spawn failed:', error?.message || error);
      if (primeAttempts < MAX_PRIME_ATTEMPTS) primeDashboardCacheInChild(60_000);
    }
  }, delayMs);
  timer.unref?.();
}
primeDashboardCacheInChild();

console.log(`[CE-QC][V290] ${PATCH_ID} preserves ${LEGACY_OBSERVABLE_PATCH_ID}; first five minutes prioritize HTTP/UI while automatic large SQLite maintenance is deferred or moved to child processes; V284/V286 truth is unchanged.`);

export const V206_INTERACTIVE_FIRST_RUNTIME_PATCH_ID = PATCH_ID;
