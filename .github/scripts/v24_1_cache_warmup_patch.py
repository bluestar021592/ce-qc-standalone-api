from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str):
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    if text.count(old) != 1:
        raise SystemExit(f'anchor count != 1: {label} count={text.count(old)}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

range_file = Path('src/rangeDashboardStore.js')
worker_file = Path('src/dashboardCacheWorker.js')

anchor = "export function getDashboardCacheStatus() {\n"
warm_fn = """export function warmDashboardCacheRange(options = {}) {
  ensureDashboardCacheSchema();
  const db = getDb();
  const maxDays = Math.max(1, Math.min(180, Number(options.days || 180)));
  const dates = db.prepare(`
    SELECT DISTINCT b.reportDate
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status='COMPLETED'
    ORDER BY b.reportDate DESC
    LIMIT ?
  `).all(maxDays).map(row => row.reportDate).sort();
  if (!dates.length) return { warmed: 0, fromDate: '', toDate: '', rowCount: 0 };

  const fromDate = dates[0];
  const toDate = dates[dates.length - 1];
  const dateSet = new Set(dates);
  const ccslRows = queryCcslDailyRaw(fromDate, toDate).filter(row => dateSet.has(row.reportDate));
  const shopeeRows = queryShopeeDailyRaw(fromDate, toDate).filter(row => dateSet.has(row.reportDate));
  const rows = [...ccslRows, ...shopeeRows];
  const byDate = new Map(dates.map(date => [date, []]));
  for (const row of rows) {
    if (!byDate.has(row.reportDate)) byDate.set(row.reportDate, []);
    byDate.get(row.reportDate).push(row);
  }
  const refreshedAt = cacheIsoNow();
  db.exec('BEGIN IMMEDIATE');
  try {
    const deleteRows = db.prepare('DELETE FROM dashboard_daily_cache WHERE reportDate=?');
    const insert = db.prepare(`
      INSERT INTO dashboard_daily_cache(
        reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt
      ) VALUES(?,?,?,?,?,?,?,?)
    `);
    const upsertDate = db.prepare(`
      INSERT INTO dashboard_cache_dates(reportDate,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt)
      VALUES(?,?,?,?,?)
      ON CONFLICT(reportDate) DO UPDATE SET
        snapshotId=excluded.snapshotId,
        snapshotStatus=excluded.snapshotStatus,
        sourceFingerprint=excluded.sourceFingerprint,
        refreshedAt=excluded.refreshedAt
    `);
    const clearDirty = db.prepare('DELETE FROM dashboard_cache_dirty WHERE reportDate=?');
    let warmed = 0;
    for (const date of dates) {
      const source = dashboardSourceInfo(date);
      if (!source || source.snapshotStatus !== 'COMPLETED') continue;
      deleteRows.run(date);
      for (const row of byDate.get(date) || []) {
        insert.run(
          date,
          String(row.businessType || ''),
          String(row.regionCode || ''),
          JSON.stringify(normalizeCountRow(row)),
          String(source.snapshotId || ''),
          String(source.snapshotStatus || ''),
          source.fingerprint,
          refreshedAt
        );
      }
      upsertDate.run(date, source.snapshotId || '', source.snapshotStatus || '', source.fingerprint, refreshedAt);
      clearDirty.run(date);
      warmed += 1;
    }
    db.exec('COMMIT');
    return { warmed, fromDate, toDate, rowCount: rows.length, refreshedAt };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function getDashboardCacheStatus() {
"""
replace_once(range_file, anchor, warm_fn, 'insert warm cache range')

replace_once(
    worker_file,
    "  refreshDashboardCacheDate,\n  refreshDashboardCacheDirty\n",
    "  refreshDashboardCacheDate,\n  refreshDashboardCacheDirty,\n  warmDashboardCacheRange\n",
    'worker warm import'
)
replace_once(
    worker_file,
    "  } else {\n    result = refreshDashboardCacheDirty({ limit: 16, recentDays: 14 });\n  }\n",
    """  } else {
    const status = getDashboardCacheStatus();
    if (Number(status.cachedDates || 0) === 0 || reason === 'STARTUP_WARM') {
      result = warmDashboardCacheRange({ days: 180 });
    } else {
      result = refreshDashboardCacheDirty({ limit: 24, recentDays: 30 });
    }
  }
""",
    'worker startup warm logic'
)

print('V24.1 cache warmup patch applied')
