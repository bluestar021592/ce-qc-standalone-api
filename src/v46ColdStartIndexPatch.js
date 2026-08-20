import { getDb } from './db.js';
import './v226LatestReportDateQueryPatch.js';
import './v221BootstrapRecoveryPatch.js';
import './v225AuthBootstrapGuardPatch.js';
import './v227LocalHealthProbePatch.js';
import './v228LocalLauncherRootProbePatch.js';
import './v232LiveDataHealthGatePatch.js';

const PATCH_ID = '2026-08-20-v232-live-data-health-gate-v1';

// Cold start must never open or scan the SQLite database merely to inspect
// optional performance indexes. The definitions stay available for explicit
// maintenance/diagnostics, while normal server startup remains database-lazy.
// V226 fixes latest-date truth. V221 owns persisted-data recovery. V225 prevents
// stale/unauthenticated zero dashboards. V227 exposes loopback /api/health,
// V228 makes the managed launcher's non-browser root probe report HTTP 200, and
// V232 upgrades health readiness so a persisted installation cannot open the
// browser until all seven business boards are backed by live persisted data.
const REQUIRED_INDEXES = Object.freeze([
  {
    name: 'idx_unified_rows_bootstrap_cover',
    columns: 'snapshotId, businessType, regionCode'
  },
  {
    name: 'idx_unified_batches_latest_valid',
    columns: 'status, reportDate DESC, createdAt DESC'
  }
]);

export function inspectV46Indexes() {
  const db = getDb();
  const present = [];
  const missing = [];
  for (const index of REQUIRED_INDEXES) {
    let exists = false;
    try {
      exists = Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name=? LIMIT 1`).get(index.name));
    } catch {}
    (exists ? present : missing).push(index.name);
  }
  return { present, missing };
}

console.log('[CE-QC][V46] V226 date truth + V221 persisted recovery + V225 auth guard + V227 health + V228 launcher readiness + V232 live board gate armed after V43.');

export const V46_COLD_START_INDEX_PATCH_ID = PATCH_ID;
export const V46_REQUIRED_INDEXES = REQUIRED_INDEXES;
