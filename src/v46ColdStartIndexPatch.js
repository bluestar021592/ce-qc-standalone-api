import { getDb } from './db.js';
import './v226LatestReportDateQueryPatch.js';
import './v221BootstrapRecoveryPatch.js';
import './v225AuthBootstrapGuardPatch.js';

const PATCH_ID = '2026-08-19-v226-runtime-acceptance-bootstrap-v2';

// Cold start must never open or scan the SQLite database merely to inspect
// optional performance indexes. The definitions stay available for explicit
// maintenance/diagnostics, while normal server startup remains database-lazy.
// V226 first fixes the meaning of "latest" to reportDate DESC, createdAt DESC.
// V221 then owns persisted-data bootstrap recovery. V225 keeps stale/unauthenticated
// browser shells from rendering a misleading all-zero dashboard.
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

console.log('[CE-QC][V46] optional index inspection deferred; V226 date truth + V221 persisted recovery + V225 auth guard armed after V43.');

export const V46_COLD_START_INDEX_PATCH_ID = PATCH_ID;
export const V46_REQUIRED_INDEXES = REQUIRED_INDEXES;
