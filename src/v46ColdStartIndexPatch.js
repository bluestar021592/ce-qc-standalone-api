import { getDb } from './db.js';

const PATCH_ID = '2026-08-12-v46-cold-start-deferred-index-check-v4';

// Cold start must never open or scan the SQLite database merely to inspect
// optional performance indexes. The definitions stay available for explicit
// maintenance/diagnostics, while normal server startup remains database-lazy.
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

console.log('[CE-QC][V46] optional index inspection deferred; cold start performs no database access.');

export const V46_COLD_START_INDEX_PATCH_ID = PATCH_ID;
export const V46_REQUIRED_INDEXES = REQUIRED_INDEXES;
