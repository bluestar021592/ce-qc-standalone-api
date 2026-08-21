const PATCH_ID = '2026-08-21-v206-interactive-first-runtime-v1';

// The local database is very large. Dashboard cache warming competes with normal
// reads through the same SQLite file and can make tiny CEAF/home requests wait for
// minutes. Keep normal startup fully interactive and move maintenance far away
// from first use. Periodic maintenance remains enabled on a 4-hour cadence.
process.env.DASHBOARD_CACHE_STARTUP_DELAY_MS = String(24 * 60 * 60 * 1000);
process.env.DASHBOARD_CACHE_REFRESH_MS = String(4 * 60 * 60 * 1000);
process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED = '0';

console.log(`[CE-QC][V206] ${PATCH_ID} startup cache warm deferred 24h; periodic cache refresh 4h; background maintenance disabled.`);

export const V206_INTERACTIVE_FIRST_RUNTIME_PATCH_ID = PATCH_ID;
