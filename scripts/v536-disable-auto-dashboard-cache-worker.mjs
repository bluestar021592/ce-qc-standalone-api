import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/dashboardCacheWorker.js','utf8');
assert.match(source,/2026-09-14-v536-manual-only-dashboard-cache-v1/);
assert.match(source,/function automaticCacheSkip\(\)\{return !reportDate&&AUTOMATIC_REASONS\.has\(reason\);\}/);
assert.match(source,/AUTOMATIC_DASHBOARD_CACHE_DISABLED/);
assert.match(source,/if\(reportDate\)\{markDashboardCacheDirty/,'explicit date refresh must remain available');
assert.match(source,/reason==='FINALIZED_HISTORY_BACKFILL'/,'explicit historical backfill path must remain available');
console.log('[V536] automatic startup/periodic dashboard-cache work is disabled; explicit date refresh/backfill remains available');
