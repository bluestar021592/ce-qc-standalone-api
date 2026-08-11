import { getDb } from './db.js';

const PATCH_ID = '2026-08-10-v46-cold-start-covering-index-v1';

// The first browser visit used to spend many seconds inside V43's bootstrap
// aggregate because SQLite had to visit table rows to read regionCode while
// grouping the newest unified snapshot. Keep the startup query fully covered
// by an index so a cold process is fast too, not only the second refresh after
// the in-memory bootstrap cache has been populated.
const db = getDb();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_unified_rows_bootstrap_cover
    ON unified_import_rows(snapshotId, businessType, regionCode);

  CREATE INDEX IF NOT EXISTS idx_unified_batches_latest_valid
    ON unified_import_batches(status, reportDate DESC, createdAt DESC);
`);

// SQLite's optimize pragma is intentionally lightweight. It may update planner
// statistics when useful without rewriting or compacting business data.
try { db.pragma('optimize'); } catch {}

export const V46_COLD_START_INDEX_PATCH_ID = PATCH_ID;
