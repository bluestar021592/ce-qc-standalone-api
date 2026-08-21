import { getDb } from './db.js';
import './v226LatestReportDateQueryPatch.js';
import './v221BootstrapRecoveryPatch.js';
import './v225AuthBootstrapGuardPatch.js';
import './v227LocalHealthProbePatch.js';
import './v228LocalLauncherRootProbePatch.js';
import './v232LiveDataHealthGatePatch.js';
import './v246CoreAvailabilityPatch.js';
import './v248WhppAuthorityPatch.js';
import './v249LoginReliabilityPatch.js';
import './v251CookieFirstLoginPatch.js';

const PATCH_ID = '2026-08-21-v251-cookie-first-login-v1';

// Cold start must never open or scan the SQLite database merely to inspect
// optional performance indexes. The definitions stay available for explicit
// maintenance/diagnostics, while normal server startup remains database-lazy.
// V226 fixes latest-date truth. V221 owns persisted-data recovery. V225 prevents
// stale/unauthenticated zero dashboards. V227 exposes loopback /api/health,
// V228 keeps launcher probes local, V245 keeps persisted-data diagnostics,
// V246 makes core startup service-first, V248 owns authenticated WHPP routing,
// V249 moved credential verification onto isolated 5179, and V251 makes the
// host-scoped signed cookie the normal browser session path so a busy 5177
// cannot hold the login page at "waiting for session handoff".
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

console.log('[CE-QC][V46] V251 system-first core armed: 5179 direct credential verification + signed host-cookie navigation + fallback-only 5177 handoff + V248 authenticated WHPP authority.');

export const V46_COLD_START_INDEX_PATCH_ID = PATCH_ID;
export const V46_REQUIRED_INDEXES = REQUIRED_INDEXES;
