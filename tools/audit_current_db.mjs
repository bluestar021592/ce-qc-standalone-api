import { DatabaseSync } from 'node:sqlite';

const dbFile = process.argv[2] || process.env.DB_FILE;
if (!dbFile) throw new Error('Usage: node tools/audit_current_db.mjs <database-file>');

const db = new DatabaseSync(dbFile, { readOnly: true });
try {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const userVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  const counts = {};
  for (const table of tables) {
    if (/^(business_|daily_reports|daily_parse_rows|pod_locks|carry_bills|scan_results|track_events|final_rows|run_checkpoints|export_snapshots|history_summary|shop_cp_codes)/.test(table)) {
      counts[table] = Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count || 0);
    }
  }

  const report = {
    dbFile,
    integrity,
    userVersion,
    counts,
    businessStates: queryOptional(db, 'SELECT businessType, count(*) AS count FROM business_states GROUP BY businessType'),
    businessReports: queryOptional(db, 'SELECT businessType, reportDate, totalCount, sourceFile FROM business_daily_reports ORDER BY reportDate DESC LIMIT 10'),
    businessCarries: queryOptional(db, 'SELECT businessType, status, count(*) AS count FROM business_carry_bills GROUP BY businessType, status'),
    businessPodLocks: queryOptional(db, 'SELECT businessType, count(*) AS count FROM business_pod_locks GROUP BY businessType'),
    businessSnapshots: queryOptional(db, 'SELECT businessType, reportDate, count(*) AS count FROM business_export_snapshots GROUP BY businessType, reportDate ORDER BY reportDate DESC LIMIT 10')
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}

function queryOptional(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch {
    return [];
  }
}
