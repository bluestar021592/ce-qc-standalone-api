import { getDb } from './db.js';
import './v227LocalHealthProbePatch.js';

const PATCH_ID = '2026-08-21-qc11-final-golden-health-v1';

// Keep the Aug-17 product shell and its direct 5177 internal login. Only the
// loopback health probe is mounted for the desktop supervisor; no V209/V213
// sidecar auth, no V221/V225 bootstrap guard and no V232 data-blocking gate.
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

console.log('[CE-QC][QC11_FINAL] golden direct-login shell + loopback health probe armed; business data is never a startup blocker.');

export const V46_COLD_START_INDEX_PATCH_ID = PATCH_ID;
export const V46_REQUIRED_INDEXES = REQUIRED_INDEXES;
