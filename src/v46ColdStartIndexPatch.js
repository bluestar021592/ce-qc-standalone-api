import { getDb } from './db.js';

const PATCH_ID = '2026-08-12-v46-cold-start-readonly-index-check-v2';

// IMPORTANT: startup must stay read-only.
//
// This patch originally created covering indexes synchronously during bootstrap.
// On a large SQLite database, or while another CE QC process still held a write
// lock, CREATE INDEX / PRAGMA optimize could block bootstrap before server.js
// started listening on port 5177. That made the desktop launcher look dead even
// though the business data itself was intact.
//
// Keep the expected index definitions documented here, but only inspect
// sqlite_master during startup. Missing indexes are reported and can be created
// later during an explicit maintenance window with the backend stopped.
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

const db = getDb();

function hasIndex(name) {
  try {
    return Boolean(db.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'index' AND name = ?
      LIMIT 1
    `).get(name));
  } catch {
    return false;
  }
}

const missing = REQUIRED_INDEXES.filter(index => !hasIndex(index.name));

if (missing.length) {
  console.warn(
    `[CE-QC][V46] startup index creation skipped to protect cold start; missing: ${missing.map(index => index.name).join(', ')}`
  );
} else {
  console.log('[CE-QC][V46] covering indexes already present; startup remained read-only.');
}

export const V46_COLD_START_INDEX_PATCH_ID = PATCH_ID;
export const V46_REQUIRED_INDEXES = REQUIRED_INDEXES;
