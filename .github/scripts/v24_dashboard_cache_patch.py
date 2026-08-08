from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str):
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    if text.count(old) != 1:
        raise SystemExit(f'anchor count != 1: {label} count={text.count(old)}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


range_file = Path('src/rangeDashboardStore.js')
server_file = Path('server.js')
store_file = Path('src/store.js')

# -------------------------
# rangeDashboardStore cache engine
# -------------------------
replace_once(
    range_file,
    "const ALL_TYPES = Object.freeze([...CCSL_TYPES, ...SHOPEE_TYPES]);\n",
    """const ALL_TYPES = Object.freeze([...CCSL_TYPES, ...SHOPEE_TYPES]);

const DASHBOARD_CACHE_SCHEMA_VERSION = '2026-08-08-v24';
let dashboardCacheSchemaReady = false;

function ensureDashboardCacheSchema() {
  if (dashboardCacheSchemaReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_daily_cache (
      reportDate TEXT NOT NULL,
      businessType TEXT NOT NULL,
      regionCode TEXT NOT NULL DEFAULT '',
      metricsJson TEXT NOT NULL,
      snapshotId TEXT NOT NULL DEFAULT '',
      snapshotStatus TEXT NOT NULL DEFAULT '',
      sourceFingerprint TEXT NOT NULL DEFAULT '',
      refreshedAt TEXT NOT NULL,
      PRIMARY KEY(reportDate,businessType,regionCode)
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_daily_cache_date
      ON dashboard_daily_cache(reportDate,businessType);
    CREATE TABLE IF NOT EXISTS dashboard_cache_dates (
      reportDate TEXT PRIMARY KEY,
      snapshotId TEXT NOT NULL DEFAULT '',
      snapshotStatus TEXT NOT NULL DEFAULT '',
      sourceFingerprint TEXT NOT NULL DEFAULT '',
      refreshedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dashboard_cache_dirty (
      reportDate TEXT PRIMARY KEY,
      reason TEXT NOT NULL DEFAULT '',
      dirtyAt TEXT NOT NULL
    );
  `);
  dashboardCacheSchemaReady = true;
}

function cacheIsoNow() {
  return new Date().toISOString();
}

function dashboardSourceInfo(reportDate) {
  const db = getDb();
  const batch = db.prepare(`
    SELECT b.snapshotId,b.reportDate,b.createdAt,COALESCE(s.status,'') AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.reportDate=? AND b.status='VALID'
    ORDER BY b.createdAt DESC
    LIMIT 1
  `).get(reportDate) || null;
  if (!batch) return null;
  const ccsl = db.prepare(`SELECT COUNT(*) AS count,COALESCE(MAX(updatedAt),'') AS updatedAt FROM final_rows WHERE reportDate=?`).get(reportDate) || {};
  const shopee = db.prepare(`SELECT COUNT(*) AS count,COALESCE(MAX(updatedAt),'') AS updatedAt FROM business_final_rows WHERE reportDate=?`).get(reportDate) || {};
  const imported = db.prepare(`SELECT COUNT(*) AS count FROM unified_import_rows WHERE reportDate=? AND snapshotId=?`).get(reportDate, batch.snapshotId) || {};
  const fingerprint = JSON.stringify([
    DASHBOARD_CACHE_SCHEMA_VERSION,
    batch.snapshotId || '',
    batch.snapshotStatus || '',
    batch.createdAt || '',
    Number(imported.count || 0),
    Number(ccsl.count || 0), ccsl.updatedAt || '',
    Number(shopee.count || 0), shopee.updatedAt || ''
  ]);
  return { ...batch, fingerprint };
}

export function markDashboardCacheDirty(reportDate, reason = 'DATA_CHANGED') {
  const date = String(reportDate || '').trim();
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return false;
  ensureDashboardCacheSchema();
  getDb().prepare(`
    INSERT INTO dashboard_cache_dirty(reportDate,reason,dirtyAt)
    VALUES(?,?,?)
    ON CONFLICT(reportDate) DO UPDATE SET reason=excluded.reason,dirtyAt=excluded.dirtyAt
  `).run(date, String(reason || 'DATA_CHANGED').slice(0,120), cacheIsoNow());
  return true;
}

export function refreshDashboardCacheDate(reportDate, options = {}) {
  const date = String(reportDate || '').trim();
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error('缓存刷新日期无效。');
  ensureDashboardCacheSchema();
  const db = getDb();
  const source = dashboardSourceInfo(date);
  if (!source) return { reportDate: date, skipped: true, reason: 'NO_VALID_IMPORT' };
  if (source.snapshotStatus !== 'COMPLETED') {
    return { reportDate: date, skipped: true, reason: 'SNAPSHOT_NOT_COMPLETED', snapshotStatus: source.snapshotStatus || '' };
  }
  const existing = db.prepare('SELECT sourceFingerprint FROM dashboard_cache_dates WHERE reportDate=?').get(date);
  if (!options.force && existing?.sourceFingerprint === source.fingerprint) {
    db.prepare('DELETE FROM dashboard_cache_dirty WHERE reportDate=?').run(date);
    return { reportDate: date, skipped: true, reason: 'UNCHANGED', snapshotId: source.snapshotId };
  }

  const ccslRows = queryCcslDailyRaw(date, date);
  const shopeeRows = queryShopeeDailyRaw(date, date);
  const rows = [...ccslRows, ...shopeeRows];
  const refreshedAt = cacheIsoNow();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM dashboard_daily_cache WHERE reportDate=?').run(date);
    const insert = db.prepare(`
      INSERT INTO dashboard_daily_cache(
        reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt
      ) VALUES(?,?,?,?,?,?,?,?)
    `);
    for (const row of rows) {
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
    db.prepare(`
      INSERT INTO dashboard_cache_dates(reportDate,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt)
      VALUES(?,?,?,?,?)
      ON CONFLICT(reportDate) DO UPDATE SET
        snapshotId=excluded.snapshotId,
        snapshotStatus=excluded.snapshotStatus,
        sourceFingerprint=excluded.sourceFingerprint,
        refreshedAt=excluded.refreshedAt
    `).run(date, source.snapshotId || '', source.snapshotStatus || '', source.fingerprint, refreshedAt);
    db.prepare('DELETE FROM dashboard_cache_dirty WHERE reportDate=?').run(date);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return { reportDate: date, refreshed: true, rowCount: rows.length, snapshotId: source.snapshotId, refreshedAt };
}

export function refreshDashboardCacheDirty(options = {}) {
  ensureDashboardCacheSchema();
  const db = getDb();
  const limit = Math.max(1, Math.min(60, Number(options.limit || 16)));
  const recentDays = Math.max(1, Math.min(30, Number(options.recentDays || 14)));
  const dirty = db.prepare('SELECT reportDate FROM dashboard_cache_dirty ORDER BY dirtyAt LIMIT ?').all(limit).map(row => row.reportDate);
  const recent = db.prepare(`
    SELECT DISTINCT b.reportDate
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status='COMPLETED'
    ORDER BY b.reportDate DESC
    LIMIT ?
  `).all(recentDays).map(row => row.reportDate);
  const dates = [...new Set([...dirty, ...recent])].slice(0, limit);
  const results = [];
  for (const date of dates) {
    const source = dashboardSourceInfo(date);
    const marker = db.prepare('SELECT sourceFingerprint FROM dashboard_cache_dates WHERE reportDate=?').get(date);
    const force = dirty.includes(date);
    if (!source || source.snapshotStatus !== 'COMPLETED') {
      results.push({ reportDate: date, skipped: true, reason: 'NOT_COMPLETED' });
      continue;
    }
    if (!force && marker?.sourceFingerprint === source.fingerprint) {
      results.push({ reportDate: date, skipped: true, reason: 'UNCHANGED' });
      continue;
    }
    results.push(refreshDashboardCacheDate(date, { force: true }));
  }
  return { checked: dates.length, refreshed: results.filter(item => item.refreshed).length, results };
}

export function getDashboardCacheStatus() {
  ensureDashboardCacheSchema();
  const db = getDb();
  const totals = db.prepare(`
    SELECT COUNT(*) AS cachedDates,COALESCE(MIN(reportDate),'') AS oldestDate,COALESCE(MAX(reportDate),'') AS newestDate,COALESCE(MAX(refreshedAt),'') AS lastRefreshedAt
    FROM dashboard_cache_dates
  `).get() || {};
  const dirty = db.prepare('SELECT COUNT(*) AS count FROM dashboard_cache_dirty').get() || {};
  return {
    schemaVersion: DASHBOARD_CACHE_SCHEMA_VERSION,
    cachedDates: Number(totals.cachedDates || 0),
    oldestDate: totals.oldestDate || '',
    newestDate: totals.newestDate || '',
    lastRefreshedAt: totals.lastRefreshedAt || '',
    dirtyDates: Number(dirty.count || 0)
  };
}

function cachedRowsForRange(scope, fromDate, toDate) {
  ensureDashboardCacheSchema();
  const expectedDates = listCompletedDates(fromDate, toDate);
  if (!expectedDates.length) return null;
  const db = getDb();
  const markers = db.prepare(`
    SELECT reportDate FROM dashboard_cache_dates
    WHERE reportDate BETWEEN ? AND ? AND snapshotStatus='COMPLETED'
  `).all(fromDate, toDate).map(row => row.reportDate);
  const markerSet = new Set(markers);
  if (!expectedDates.every(date => markerSet.has(date))) return null;
  const businessTypes = scope === 'SHOPEE' ? SHOPEE_TYPES : CCSL_TYPES;
  const placeholders = businessTypes.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT metricsJson FROM dashboard_daily_cache
    WHERE reportDate BETWEEN ? AND ? AND businessType IN (${placeholders})
    ORDER BY reportDate,businessType,regionCode
  `).all(fromDate, toDate, ...businessTypes);
  return rows.map(row => {
    try { return normalizeCountRow(JSON.parse(row.metricsJson || '{}')); }
    catch { return null; }
  }).filter(Boolean);
}
""",
    'insert dashboard cache engine'
)

replace_once(range_file, 'function queryCcslDaily(fromDate, toDate) {', 'function queryCcslDailyRaw(fromDate, toDate) {', 'rename ccsl raw query')
replace_once(range_file, 'function queryShopeeDaily(fromDate, toDate) {', 'function queryShopeeDailyRaw(fromDate, toDate) {', 'rename shopee raw query')

anchor = "function queryCcslDailyRaw(fromDate, toDate) {"
wrapper = """function queryCcslDaily(fromDate, toDate) {
  const cached = cachedRowsForRange('CCSL', fromDate, toDate);
  return cached || queryCcslDailyRaw(fromDate, toDate);
}

function queryShopeeDaily(fromDate, toDate) {
  const cached = cachedRowsForRange('SHOPEE', fromDate, toDate);
  return cached || queryShopeeDailyRaw(fromDate, toDate);
}

function queryCcslDailyRaw(fromDate, toDate) {"""
replace_once(range_file, anchor, wrapper, 'insert cached query wrappers')

# -------------------------
# server: isolated child worker + event hooks + health/status
# -------------------------
replace_once(
    server_file,
    "import { networkInterfaces } from 'os';\n",
    "import { networkInterfaces } from 'os';\nimport { spawn } from 'node:child_process';\n",
    'child process import'
)
replace_once(
    server_file,
    "import { loadRangeDashboard } from './src/rangeDashboardStore.js';\n",
    "import { getDashboardCacheStatus, loadRangeDashboard, markDashboardCacheDirty } from './src/rangeDashboardStore.js';\n",
    'range store cache imports'
)
replace_once(
    server_file,
    "const eventClients = new Set();\n",
    """const eventClients = new Set();
const DASHBOARD_CACHE_REFRESH_MS = Math.max(60_000, Number(process.env.DASHBOARD_CACHE_REFRESH_MS || 600_000));
let dashboardCacheWorker = null;
let dashboardCachePendingDate = '';
let dashboardCacheTimer = null;

function launchDashboardCacheWorker({ reportDate = '', reason = 'SCHEDULED_REFRESH' } = {}) {
  const date = String(reportDate || '').trim();
  if (date) {
    markDashboardCacheDirty(date, reason);
    dashboardCachePendingDate = date;
  }
  if (dashboardCacheWorker) return { started: false, queued: Boolean(date) };
  const workerFile = path.join(__dirname, 'src', 'dashboardCacheWorker.js');
  const args = [workerFile, '--reason', String(reason || 'SCHEDULED_REFRESH')];
  if (date) args.push('--date', date);
  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
  dashboardCacheWorker = child;
  child.once('exit', () => {
    dashboardCacheWorker = null;
    fastSqlDashboardCache.clear();
    periodDashboardCache.clear();
    const queuedDate = dashboardCachePendingDate;
    dashboardCachePendingDate = '';
    if (queuedDate && queuedDate !== date) {
      setTimeout(() => launchDashboardCacheWorker({ reportDate: queuedDate, reason: 'QUEUED_REFRESH' }), 100).unref?.();
    }
  });
  child.once('error', () => { dashboardCacheWorker = null; });
  return { started: true, queued: false };
}

function startDashboardCacheScheduler() {
  if (dashboardCacheTimer) return;
  setTimeout(() => launchDashboardCacheWorker({ reason: 'STARTUP_WARM' }), 1500).unref?.();
  dashboardCacheTimer = setInterval(() => launchDashboardCacheWorker({ reason: 'TEN_MINUTE_REFRESH' }), DASHBOARD_CACHE_REFRESH_MS);
  dashboardCacheTimer.unref?.();
}
""",
    'dashboard cache worker controller'
)

replace_once(
    server_file,
    "    memory: {\n      rssMB: Math.round(memory.rss / 1024 / 1024),\n      heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),\n      heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)\n    }\n",
    """    memory: {
      rssMB: Math.round(memory.rss / 1024 / 1024),
      heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
    },
    dashboardCache: getDashboardCacheStatus()
""",
    'health cache status'
)

# import hooks
replace_once(
    server_file,
    "    await saveState(state);\n    await fs.unlink(req.file.path).catch(() => {});\n    res.json({\n      ok: true,\n      parsed:",
    "    await saveState(state);\n    launchDashboardCacheWorker({ reportDate: parsed.reportDate, reason: 'DAILY_IMPORT' });\n    await fs.unlink(req.file.path).catch(() => {});\n    res.json({\n      ok: true,\n      parsed:",
    'daily import cache hook'
)
replace_once(
    server_file,
    "    saveBusinessState(shopeeState, SHOPEE);\n    await fs.unlink(req.file.path).catch(() => {});\n    res.json({ ok: true, ...saved, carryover:",
    "    saveBusinessState(shopeeState, SHOPEE);\n    launchDashboardCacheWorker({ reportDate: parsed.reportDate, reason: 'UNIFIED_IMPORT' });\n    await fs.unlink(req.file.path).catch(() => {});\n    res.json({ ok: true, ...saved, carryover:",
    'unified import cache hook'
)
replace_once(
    server_file,
    "    saveBusinessState(state, SHOPEE);\n    await fs.unlink(req.file.path).catch(() => {});\n    res.json({ ok: true, parsed: { ...parsed.summary, reportDate:",
    "    saveBusinessState(state, SHOPEE);\n    launchDashboardCacheWorker({ reportDate: parsed.reportDate, reason: 'SHOPEE_IMPORT' });\n    await fs.unlink(req.file.path).catch(() => {});\n    res.json({ ok: true, parsed: { ...parsed.summary, reportDate:",
    'shopee import cache hook'
)

# completion hooks
replace_once(
    server_file,
    "    await appendRuntimeLog(`处理快照已保存：${snapshot.snapshotId}`);\n    res.json({ ok: true, summary: result.summary, run:",
    "    await appendRuntimeLog(`处理快照已保存：${snapshot.snapshotId}`);\n    launchDashboardCacheWorker({ reportDate, reason: 'CCSL_RUN_COMPLETED' });\n    res.json({ ok: true, summary: result.summary, run:",
    'ccsl completion cache hook'
)
replace_once(
    server_file,
    "    completeUnifiedSnapshot({ reportDate, ccslSnapshot, shopeeSnapshot: snapshot });\n    saveBusinessState(result.state, SHOPEE);\n    res.json({ ok: true, summary, run:",
    "    completeUnifiedSnapshot({ reportDate, ccslSnapshot, shopeeSnapshot: snapshot });\n    saveBusinessState(result.state, SHOPEE);\n    launchDashboardCacheWorker({ reportDate, reason: 'SHOPEE_RUN_COMPLETED' });\n    res.json({ ok: true, summary, run:",
    'shopee completion cache hook'
)

# cache status endpoint
replace_once(
    server_file,
    "app.get('/api/unified-history', (req, res) => {\n",
    """app.get('/api/dashboard-cache/status', (req, res) => {
  res.json({
    ok: true,
    refreshIntervalMs: DASHBOARD_CACHE_REFRESH_MS,
    workerRunning: Boolean(dashboardCacheWorker),
    cache: getDashboardCacheStatus()
  });
});

app.get('/api/unified-history', (req, res) => {
""",
    'cache status endpoint'
)

replace_once(
    server_file,
    "  console.log(`Public URL: ${network.publicUrl}`);\n});\n",
    "  console.log(`Public URL: ${network.publicUrl}`);\n  console.log(`Dashboard cache: background refresh every ${Math.round(DASHBOARD_CACHE_REFRESH_MS / 60000)} minutes`);\n  startDashboardCacheScheduler();\n});\n",
    'start cache scheduler'
)

# -------------------------
# ensure purge clears derived cache tables too
# -------------------------
replace_once(
    store_file,
    "  'weekly_metric_snapshots'\n];\n",
    "  'weekly_metric_snapshots',\n  'dashboard_daily_cache',\n  'dashboard_cache_dates',\n  'dashboard_cache_dirty'\n];\n",
    'purge cache tables'
)

print('V24 dashboard cache patch applied')
