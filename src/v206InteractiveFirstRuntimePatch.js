import './v234DashboardLiveTruthPatch.js';

const PATCH_ID = '2026-08-22-v235-interactive-first-runtime-v2';

// The local database is very large. Dashboard cache warming and legacy repair
// loops must never compete with first paint through the same synchronous SQLite
// connection. Normal startup therefore reads existing dashboard/result caches
// only; explicit refresh/export flows remain available when the user requests them.
process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS = String(24 * 60 * 60 * 1000);
process.env.DASHBOARD_CACHE_REFRESH_MS = String(4 * 60 * 60 * 1000);
process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED = '0';
process.env.CE_QC_SKIP_STARTUP_POD_REPAIR = '1';

console.log(`[CE-QC][V235] ${PATCH_ID} dashboard cache warm deferred 24h; startup POD repair skipped; background maintenance disabled.`);

export const V206_INTERACTIVE_FIRST_RUNTIME_PATCH_ID = PATCH_ID;
