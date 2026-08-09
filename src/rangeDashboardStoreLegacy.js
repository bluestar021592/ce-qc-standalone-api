import { getDb } from './db.js';

const CCSL_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688']);
const SHOPEE_TYPES = Object.freeze(['SHOPEECN', 'SHOPEEVN']);
const ALL_TYPES = Object.freeze([...CCSL_TYPES, ...SHOPEE_TYPES]);

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('缓存刷新日期无效。');
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

export function warmDashboardCacheRange(options = {}) {
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

/**
 * Fast date-range dashboard reader.
 *
 * This path never returns shipment-level rows and never parses unified/export
 * snapshot payload JSON. SQLite calculates range counters in-place; the browser
 * receives only counters + daily history/trend points.
 */
export function loadRangeDashboard(fromDate, toDate) {
  const range = validateRange(fromDate, toDate, 180);
  const ccslDaily = queryCcslDaily(range.from, range.to);
  const shopeeDaily = queryShopeeDaily(range.from, range.to);
  const dates = listCompletedDates(range.from, range.to);

  const states = {
    CE: buildCcslState('CE', ccslDaily.filter(row => row.businessType === 'CE'), range, dates),
    TBKH: buildCcslState('TBKH', ccslDaily.filter(row => row.businessType === 'TBKH'), range, dates),
    ALI1688: buildCcslState('ALI1688', ccslDaily.filter(row => row.businessType === 'ALI1688'), range, dates),
    SHOPEECN: buildShopeeState('SHOPEECN', shopeeDaily.filter(row => row.businessType === 'SHOPEECN'), range, dates),
    SHOPEEVN: buildShopeeState('SHOPEEVN', shopeeDaily.filter(row => row.businessType === 'SHOPEEVN'), range, dates)
  };

  const aggregates = {
    CCSL: buildCcslState('CCSL', ccslDaily, range, dates),
    SHOPEE: buildShopeeState('SHOPEE', shopeeDaily, range, dates)
  };

  return {
    fromDate: range.from,
    toDate: range.to,
    dates,
    states,
    aggregates,
    queryMode: 'SQL_AGGREGATE_ONLY',
    shipmentRowsTransferred: 0
  };
}

function queryCcslDaily(fromDate, toDate) {
  const cached = cachedRowsForRange('CCSL', fromDate, toDate);
  return cached || queryCcslDailyRaw(fromDate, toDate);
}

function queryShopeeDaily(fromDate, toDate) {
  const cached = cachedRowsForRange('SHOPEE', fromDate, toDate);
  return cached || queryShopeeDailyRaw(fromDate, toDate);
}

function queryCcslDailyRaw(fromDate, toDate) {
  const db = getDb();
  return db.prepare(`
    WITH valid AS (
      SELECT u.reportDate,u.businessType,u.shipmentCode,u.regionCode
      FROM unified_import_rows u
      INNER JOIN unified_import_batches b
        ON b.snapshotId=u.snapshotId AND b.status='VALID'
      INNER JOIN unified_snapshots s
        ON s.snapshotId=u.snapshotId AND s.status='COMPLETED'
      WHERE u.reportDate BETWEEN ? AND ?
        AND u.businessType IN ('CE','TBKH','ALI1688')
    )
    SELECT
      v.reportDate,
      v.businessType,
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN COALESCE(f.pendingDays,0)>=1 THEN 1 ELSE 0 END) AS pending1,
      SUM(CASE WHEN COALESCE(f.pendingDays,0)>=2 THEN 1 ELSE 0 END) AS pending2,
      SUM(CASE WHEN COALESCE(f.pendingDays,0)>=3 THEN 1 ELSE 0 END) AS pending3,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,
      SUM(CASE WHEN COALESCE(f.ocDays,0)>=1 THEN 1 ELSE 0 END) AS oc1,
      SUM(CASE WHEN COALESCE(f.ocDays,0)>=2 THEN 1 ELSE 0 END) AS oc2,
      SUM(CASE WHEN COALESCE(f.ocDays,0)>=3 THEN 1 ELSE 0 END) AS oc3,
      SUM(CASE WHEN COALESCE(f.cycleCountDays,0)>=2 THEN 1 ELSE 0 END) AS cycle2,
      SUM(CASE WHEN COALESCE(f.deliveringDays,0)>=1 THEN 1 ELSE 0 END) AS delivery1,
      SUM(CASE WHEN COALESCE(f.primaryCategory,f.category,'') LIKE '%入库无扫描%' THEN 1 ELSE 0 END) AS inboundNoScan,
      SUM(CASE WHEN COALESCE(f.primaryCategory,f.category,'') LIKE '%工单%' THEN 1 ELSE 0 END) AS workOrder,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=2 THEN 1 ELSE 0 END) AS shopRetention2,
      SUM(CASE WHEN UPPER(COALESCE(v.regionCode,''))='PV' AND COALESCE(f.isPod,0)=0 THEN 1 ELSE 0 END) AS provinceOpen,
      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,''))='SELF_PICKUP' THEN 1 ELSE 0 END) AS selfPickup,
      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,''))='CECN_RETENTION' THEN 1 ELSE 0 END) AS cecnRetention,
      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,''))='CEZT_RETENTION' THEN 1 ELSE 0 END) AS ceztRetention,
      SUM(CASE WHEN UPPER(COALESCE(f.primaryCategory,''))='CCSL580_RETENTION' THEN 1 ELSE 0 END) AS retention580
    FROM valid v
    LEFT JOIN final_rows f
      ON f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
    GROUP BY v.reportDate,v.businessType
    ORDER BY v.reportDate,v.businessType
  `).all(fromDate, toDate).map(normalizeCountRow);
}

function queryShopeeDailyRaw(fromDate, toDate) {
  const db = getDb();
  return db.prepare(`
    WITH valid AS (
      SELECT u.reportDate,u.businessType,u.shipmentCode,
             CASE
               WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
               WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
               ELSE 'UNKNOWN'
             END AS regionCode
      FROM unified_import_rows u
      INNER JOIN unified_import_batches b
        ON b.snapshotId=u.snapshotId AND b.status='VALID'
      INNER JOIN unified_snapshots s
        ON s.snapshotId=u.snapshotId AND s.status='COMPLETED'
      WHERE u.reportDate BETWEEN ? AND ?
        AND u.businessType IN ('SHOPEECN','SHOPEEVN')
    )
    SELECT
      v.reportDate,
      v.businessType,
      v.regionCode,
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0)>=1 THEN 1 ELSE 0 END) AS pending1,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS pending2,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) AS pending3,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0)>=1 THEN 1 ELSE 0 END) AS oc1,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS oc2,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) AS oc3,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."盘点天数"') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS cycle2,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."入库无扫描节点"'),'')='是' OR COALESCE(f.primaryCategory,'')='入库无扫描节点' THEN 1 ELSE 0 END) AS inboundNoScan,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."退回状态"'),'')='已退回' OR COALESCE(f.primaryCategory,'')='退回' THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."退回状态"'),'')='退回处理中' OR COALESCE(json_extract(f.rawJson,'$.currentState'),'')='RETURN_IN_PROGRESS' THEN 1 ELSE 0 END) AS returnInProgress,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."退回待处理"'),'')='是' OR COALESCE(f.primaryCategory,'') IN ('三次Pending后未退回','三次Pending后继续派送') THEN 1 ELSE 0 END) AS returnRequired,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."派送中停留天数"') AS INTEGER),0)>0 OR COALESCE(f.primaryCategory,'')='派送中停留' THEN 1 ELSE 0 END) AS deliveryStay,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."中转节点停留"'),'')='是' OR COALESCE(f.primaryCategory,'')='中转节点停留' THEN 1 ELSE 0 END) AS transitHubStay,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."严重超时"'),'')='是' OR COALESCE(f.primaryCategory,'')='严重超时未更新' THEN 1 ELSE 0 END) AS severeOverdue,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 AND COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)=1 THEN 1 ELSE 0 END) AS attempt1,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 AND COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)=2 THEN 1 ELSE 0 END) AS attempt2,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 AND COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) AS attempt3,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_TRANSFER_IN_PROGRESS' THEN 1 ELSE 0 END) AS shopTransit,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' THEN 1 ELSE 0 END) AS shopArrived,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND instr(COALESCE(f.rawJson,''),'SHOP_PENDING')>0 THEN 1 ELSE 0 END) AS shopPending,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=1 THEN 1 ELSE 0 END) AS shopRetention1,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=2 THEN 1 ELSE 0 END) AS shopRetention2,
      SUM(CASE WHEN COALESCE(f.shopState,'')='SHOP_ARRIVED_CURRENT' AND COALESCE(f.shopRetentionNaturalDays,0)>=3 THEN 1 ELSE 0 END) AS shopRetention3,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$.pvOpenDisposition'),'')='PV_DELIVERY_IN_PROGRESS' THEN 1 ELSE 0 END) AS pvDelivery,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$.pvOpenDisposition'),'')='PV_STORE_RETENTION' THEN 1 ELSE 0 END) AS pvStoreRetention,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$.pvOpenDisposition'),'')='PV_STORE_INBOUND_NO_SCAN' THEN 1 ELSE 0 END) AS pvStoreInboundNoScan,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$.pvOpenDisposition'),'')='PV_OTHER_UNRESOLVED' THEN 1 ELSE 0 END) AS pvOtherUnresolved
    FROM valid v
    LEFT JOIN business_final_rows f
      ON f.businessType='SHOPEE' AND f.shipmentCode=v.shipmentCode AND f.reportDate=v.reportDate
    GROUP BY v.reportDate,v.businessType,v.regionCode
    ORDER BY v.reportDate,v.businessType,v.regionCode
  `).all(fromDate, toDate).map(normalizeCountRow);
}

function buildCcslState(label, rows, range, completedDates) {
  const daily = mergeDailyRows(rows);
  const total = sum(rows, 'total');
  const pod = sum(rows, 'pod');
  const metrics = sumMetrics(rows, [
    'pending1','pending2','pending3','pendingNonContinuous','oc1','oc2','oc3','cycle2','delivery1',
    'inboundNoScan','workOrder','shopRetention2','provinceOpen','selfPickup','cecnRetention','ceztRetention','retention580'
  ]);
  const dashboardRows = ccslDashboardRows(range.to, total, pod, metrics);
  const historySummary = daily.map(row => ({ reportDate: row.reportDate, summary: ccslHistorySummary(row) }));
  const state = {
    businessType: label === 'CCSL' ? 'CCSL' : label,
    viewBusinessType: label,
    reportDate: range.to,
    periodStart: range.from,
    periodEnd: range.to,
    periodDates: completedDates,
    snapshotId: `PERIOD:${label}:${range.from}:${range.to}`,
    snapshotStatus: completedDates.length ? 'COMPLETED' : 'EMPTY',
    dailyReportReady: completedDates.length > 0,
    dailyParseSummary: { totalRecognized: total, pnh: total },
    pnhBills: [],
    dailyParseRows: [],
    finalRows: [],
    scanResults: [],
    trackResults: [],
    trackEvents: [],
    carryBills: [],
    nextCarryBills: [],
    podLocks: [],
    historySummary,
    dashboard: {
      pnh: total,
      totalMonitored: total,
      todayPod: pod,
      podRate: rate(pod, total),
      abnormalCount: Math.max(0, total - pod),
      categories: { pendingTotal: metrics.pending1, ocTotal: metrics.oc1 }
    },
    detailTabs: {
      dashboard: { label: `${label}范围看板`, rows: dashboardRows, total: dashboardRows.length },
      allData: { label: '范围明细请按需读取或导出', rows: [], total },
      coreAbnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod) },
      abnormal: { label: '范围异常汇总', rows: [], total: Math.max(0, total - pod) }
    },
    _rangeSummaryOnly: true,
    _normalizedSqliteRead: true
  };
  return state;
}

function buildShopeeState(label, rows, range, completedDates) {
  const daily = mergeShopeeDailyRows(rows);
  const all = summarizeShopeeRows(rows);
  const cnRows = rows.filter(row => row.businessType === 'SHOPEECN');
  const vnRows = rows.filter(row => row.businessType === 'SHOPEEVN');
  const cn = summarizeShopeeRows(cnRows);
  const vn = summarizeShopeeRows(vnRows);
  const regions = {
    PP: summarizeShopeeRows(rows.filter(row => row.regionCode === 'PP')),
    PV: summarizeShopeeRows(rows.filter(row => row.regionCode === 'PV')),
    UNKNOWN: summarizeShopeeRows(rows.filter(row => row.regionCode === 'UNKNOWN'))
  };
  const recipientGroups = {
    ALL: groupSummary('ALL', all, regions),
    CN: groupSummary('CN', cn, {
      PP: summarizeShopeeRows(cnRows.filter(row => row.regionCode === 'PP')),
      PV: summarizeShopeeRows(cnRows.filter(row => row.regionCode === 'PV')),
      UNKNOWN: summarizeShopeeRows(cnRows.filter(row => row.regionCode === 'UNKNOWN'))
    }),
    VN: groupSummary('VN', vn, {
      PP: summarizeShopeeRows(vnRows.filter(row => row.regionCode === 'PP')),
      PV: summarizeShopeeRows(vnRows.filter(row => row.regionCode === 'PV')),
      UNKNOWN: summarizeShopeeRows(vnRows.filter(row => row.regionCode === 'UNKNOWN'))
    })
  };
  const historySummary = daily.map(row => ({
    reportDate: row.reportDate,
    businessType: 'SHOPEE',
    summary: shopeeHistorySummary(row)
  }));
  const dashboardRows = shopeeDashboardRows(range.to, recipientGroups);
  const recipientTrends = {
    CN: buildRecipientTrend(historySummary, 'CN'),
    VN: buildRecipientTrend(historySummary, 'VN')
  };
  const regionTrends = {
    PP: buildRegionTrend(historySummary, 'PP'),
    PV: buildRegionTrend(historySummary, 'PV')
  };
  return {
    businessType: label === 'SHOPEE' ? 'SHOPEE' : label,
    viewBusinessType: label,
    reportDate: range.to,
    periodStart: range.from,
    periodEnd: range.to,
    periodDates: completedDates,
    snapshotId: `PERIOD:${label}:${range.from}:${range.to}`,
    snapshotStatus: completedDates.length ? 'COMPLETED' : 'EMPTY',
    dailyReportReady: completedDates.length > 0,
    pnhBills: [],
    dailyParseRows: [],
    dailyParseSummary: {
      totalRecognized: all.total,
      groupCounts: { CN: cn.total, VN: vn.total }
    },
    finalRows: [],
    scanResults: [],
    trackResults: [],
    trackEvents: [],
    carryBills: [],
    nextCarryBills: [],
    podLocks: [],
    historySummary,
    dashboard: {
      businessType: 'SHOPEE',
      reportDate: range.to,
      metrics: all,
      recipientGroups,
      recipientReconciliation: {
        status: all.total === cn.total + vn.total ? 'PASSED' : 'FAILED_RECONCILIATION',
        checks: [{ key: 'total', all: all.total, parts: cn.total + vn.total, difference: all.total - cn.total - vn.total, passed: all.total === cn.total + vn.total }]
      },
      regions,
      recipientTrends,
      regionTrends,
      dashboardRows,
      detailTabs: rangeShopeeTabs(recipientGroups, all)
    },
    detailTabs: rangeShopeeTabs(recipientGroups, all),
    _rangeSummaryOnly: true,
    _normalizedSqliteRead: true
  };
}

function ccslDashboardRows(reportDate, total, pod, m) {
  const defs = [
    ['今日PNH', total, 'allData'],
    ['今日POD', pod, 'podClosed'],
    ['首投POD率', `${rate(pod, total)}%`, 'podClosed'],
    ['Pending1+', m.pending1, 'pendingAll'],
    ['Pending2+', m.pending2, 'pending2plus'],
    ['Pending3+', m.pending3, 'pending3'],
    ['Pending不连续', m.pendingNonContinuous, 'pendingNonContinuous'],
    ['OC1+', m.oc1, 'ocAll'],
    ['OC2+', m.oc2, 'oc2plus'],
    ['OC3+', m.oc3, 'oc3'],
    ['盘点2天+', m.cycle2, 'cycle2plus'],
    ['派送停留1天+', m.delivery1, 'deliveryAll'],
    ['入库无扫描节点', m.inboundNoScan, 'inboundNoScan'],
    ['工单未处理', m.workOrder, 'workOrderAbnormal'],
    ['门店滞留2天+', m.shopRetention2, 'shopStuck'],
    ['外省未完结POD件', m.provinceOpen, 'provinceOpen'],
    ['仓库自提件', m.selfPickup, 'selfPickup'],
    ['CECN滞留包裹', m.cecnRetention, 'cecnRetention'],
    ['CEZT滞留包裹', m.ceztRetention, 'ceztRetention'],
    ['580滞留包裹', m.retention580, 'ccsl580Retention']
  ];
  return defs.map(([label, value, tab]) => ({
    日期: reportDate,
    项目: label,
    metricKey: label,
    数值: value,
    数值原值: typeof value === 'string' ? Number(String(value).replace('%','')) : Number(value || 0),
    状态: Number(String(value).replace('%','')) > 0 ? '需跟进' : '正常',
    明细Tab: tab
  }));
}

function shopeeDashboardRows(reportDate, groups) {
  const rows = [];
  for (const [group, summary] of Object.entries(groups)) {
    const m = summary.metrics;
    const defs = [
      ['今日总单', m.total], ['今日POD', m.pod], ['POD率', m.podRate], ['首派成功率', m.firstAttemptRate],
      ['Pending1+', m.pending1], ['Pending2+', m.pending2], ['Pending3+', m.pending3plus],
      ['OC1+', m.oc1], ['OC2+', m.oc2], ['OC3+', m.oc3plus], ['入库无扫描', m.inboundNoScan],
      ['退回件', m.returned], ['退回率', m.returnRate], ['退回处理中', m.returnInProgress],
      ['派送中', m.deliveryStay], ['派送中率', m.deliveryStayRate], ['中转节点停留', m.transitHubStay],
      ['严重超时未更新', m.severeOverdue]
    ];
    for (const [label, value] of defs) rows.push({
      日期: reportDate,
      收件人来源: group,
      项目: label,
      metricKey: `${group}_${label}`,
      数值: /率$/.test(label) || label.includes('成功率') ? `${Number(value || 0).toFixed(2)}%` : Number(value || 0),
      数值原值: Number(value || 0),
      状态: Number(value || 0) > 0 && !/率$/.test(label) ? '需跟进' : '正常',
      明细Tab: `${group}_${tabKey(label)}`
    });
  }
  return rows;
}

function groupSummary(group, metrics, regions) {
  return {
    group,
    metrics,
    monitorCount: metrics.total,
    regions,
    detailCounts: {
      all: metrics.total,
      pod: metrics.pod,
      pending1: metrics.pending1,
      pending2: metrics.pending2,
      pending3: metrics.pending3plus,
      oc1: metrics.oc1,
      oc2: metrics.oc2,
      oc3: metrics.oc3plus,
      inboundNoScan: metrics.inboundNoScan,
      returned: metrics.returned,
      returnInProgress: metrics.returnInProgress,
      deliveryStay: metrics.deliveryStay
    }
  };
}

function summarizeShopeeRows(rows) {
  const total = sum(rows, 'total');
  const pod = sum(rows, 'pod');
  const returned = sum(rows, 'returned');
  const attempt1 = sum(rows, 'attempt1');
  const attempt2 = sum(rows, 'attempt2');
  const attempt3 = sum(rows, 'attempt3');
  const result = {
    total,
    pod,
    podRate: rate(pod, total),
    firstAttemptCount: attempt1,
    firstAttemptEligible: total,
    firstAttemptRate: rate(attempt1, total),
    pending1: sum(rows, 'pending1'),
    pending2: sum(rows, 'pending2'),
    pending3plus: sum(rows, 'pending3'),
    oc1: sum(rows, 'oc1'),
    oc2: sum(rows, 'oc2'),
    oc3plus: sum(rows, 'oc3'),
    cycle2plus: sum(rows, 'cycle2'),
    inboundNoScan: sum(rows, 'inboundNoScan'),
    returned,
    returnRate: rate(returned, total),
    unresolved: Math.max(0, total - pod - returned),
    accounted: total,
    accountingDifference: 0,
    returnInProgress: sum(rows, 'returnInProgress'),
    returnRequired: sum(rows, 'returnRequired'),
    deliveryStay: sum(rows, 'deliveryStay'),
    deliveryStayRate: rate(sum(rows, 'deliveryStay'), total),
    dispatchAttempt1: attempt1,
    dispatchAttempt2: attempt2,
    dispatchAttempt3: attempt3,
    dispatchAttemptDenominator: total,
    dispatchAttempt1Rate: rate(attempt1, total),
    dispatchAttempt2Rate: rate(attempt2, total),
    dispatchAttempt3Rate: rate(attempt3, total),
    transitHubStay: sum(rows, 'transitHubStay'),
    severeOverdue: sum(rows, 'severeOverdue'),
    shopTransit: sum(rows, 'shopTransit'),
    shopArrived: sum(rows, 'shopArrived'),
    shopPending: sum(rows, 'shopPending'),
    shopRetention1: sum(rows, 'shopRetention1'),
    shopRetention2: sum(rows, 'shopRetention2'),
    shopRetention3: sum(rows, 'shopRetention3'),
    pvDelivery: sum(rows, 'pvDelivery'),
    pvStoreRetention: sum(rows, 'pvStoreRetention'),
    pvStoreInboundNoScan: sum(rows, 'pvStoreInboundNoScan'),
    pvOtherUnresolved: sum(rows, 'pvOtherUnresolved')
  };
  return result;
}

function mergeDailyRows(rows) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.reportDate)) byDate.set(row.reportDate, { reportDate: row.reportDate });
    const target = byDate.get(row.reportDate);
    for (const key of ['total','pod','pending1','pending2','pending3','pendingNonContinuous','oc1','oc2','oc3','cycle2','delivery1','inboundNoScan','workOrder','shopRetention2','provinceOpen','selfPickup','cecnRetention','ceztRetention','retention580']) {
      target[key] = Number(target[key] || 0) + Number(row[key] || 0);
    }
  }
  return [...byDate.values()].sort((a,b) => a.reportDate.localeCompare(b.reportDate));
}

function mergeShopeeDailyRows(rows) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.reportDate)) byDate.set(row.reportDate, []);
    byDate.get(row.reportDate).push(row);
  }
  return [...byDate.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([reportDate, dayRows]) => ({
    reportDate,
    all: summarizeShopeeRows(dayRows),
    cn: summarizeShopeeRows(dayRows.filter(row => row.businessType === 'SHOPEECN')),
    vn: summarizeShopeeRows(dayRows.filter(row => row.businessType === 'SHOPEEVN')),
    pp: summarizeShopeeRows(dayRows.filter(row => row.regionCode === 'PP')),
    pv: summarizeShopeeRows(dayRows.filter(row => row.regionCode === 'PV'))
  }));
}

function ccslHistorySummary(row) {
  const total = Number(row.total || 0);
  const pod = Number(row.pod || 0);
  return {
    reportDate: row.reportDate,
    today: total,
    pnh: total,
    todayPnh: total,
    scanPod: pod,
    todayPod: pod,
    podRate: rate(pod, total),
    firstPodRate: rate(pod, total),
    ocRate: rate(row.oc1, total),
    inboundNoScan: Number(row.inboundNoScan || 0),
    metrics: {
      '今日PNH': total,
      '今日POD': pod,
      '首投POD率': rate(pod, total),
      'Pending1+': Number(row.pending1 || 0),
      'Pending2+': Number(row.pending2 || 0),
      'Pending3+': Number(row.pending3 || 0),
      'Pending不连续': Number(row.pendingNonContinuous || 0),
      'OC1+': Number(row.oc1 || 0),
      'OC2+': Number(row.oc2 || 0),
      'OC3+': Number(row.oc3 || 0),
      '入库无扫描节点': Number(row.inboundNoScan || 0),
      '工单未处理': Number(row.workOrder || 0)
    }
  };
}

function shopeeHistorySummary(row) {
  const summary = { reportDate: row.reportDate, metrics: {} };
  for (const [prefix, metrics] of [['ALL',row.all],['CN',row.cn],['VN',row.vn]]) {
    Object.assign(summary.metrics, {
      [`${prefix}_今日总单`]: metrics.total,
      [`${prefix}_今日POD`]: metrics.pod,
      [`${prefix}_POD率`]: metrics.podRate,
      [`${prefix}_首派成功率`]: metrics.firstAttemptRate,
      [`${prefix}_Pending1+`]: metrics.pending1,
      [`${prefix}_Pending2+`]: metrics.pending2,
      [`${prefix}_Pending3+`]: metrics.pending3plus,
      [`${prefix}_OC1+`]: metrics.oc1,
      [`${prefix}_OC2+`]: metrics.oc2,
      [`${prefix}_OC3+`]: metrics.oc3plus,
      [`${prefix}_入库无扫描`]: metrics.inboundNoScan,
      [`${prefix}_退回件`]: metrics.returned,
      [`${prefix}_退回率`]: metrics.returnRate
    });
  }
  Object.assign(summary.metrics, {
    'PP签收率': row.pp.podRate,
    'PPPending率': rate(row.pp.pending1,row.pp.total),
    'PPOC率': rate(row.pp.oc1,row.pp.total),
    'PV签收率': row.pv.podRate,
    'PVPending率': rate(row.pv.pending1,row.pv.total),
    'PVOC率': rate(row.pv.oc1,row.pv.total)
  });
  summary.today = row.all.total;
  summary.podRate = row.all.podRate;
  summary.firstPodRate = row.all.firstAttemptRate;
  summary.ocRate = rate(row.all.oc1,row.all.total);
  return summary;
}

function buildRecipientTrend(historySummary, group) {
  const points = historySummary.map(item => ({ date: item.reportDate, summary: item.summary }));
  return {
    firstAttemptRate: trend(points, `${group}_首派成功率`),
    ocRate: trendRatio(points, `${group}_OC1+`, `${group}_今日总单`),
    podRate: trend(points, `${group}_POD率`),
    returnCount: trend(points, `${group}_退回件`),
    returnRate: trend(points, `${group}_退回率`)
  };
}

function buildRegionTrend(historySummary, region) {
  const points = historySummary.map(item => ({ date: item.reportDate, summary: item.summary }));
  return {
    podRate: trend(points, `${region}签收率`),
    pendingRate: trend(points, `${region}Pending率`),
    ocRate: trend(points, `${region}OC率`)
  };
}

function trend(points, key) {
  return lastSeven(points.map(item => ({
    date: item.date,
    value: item.summary?.metrics?.[key],
    hasData: item.summary?.metrics?.[key] !== undefined,
    status: 'normal'
  })));
}

function trendRatio(points, numeratorKey, denominatorKey) {
  return lastSeven(points.map(item => {
    const n = Number(item.summary?.metrics?.[numeratorKey] || 0);
    const d = Number(item.summary?.metrics?.[denominatorKey] || 0);
    return { date: item.date, value: rate(n,d), hasData: d > 0, status: n > 0 ? 'warning' : 'normal' };
  }));
}

function lastSeven(items) {
  return items.slice(-7);
}

function rangeShopeeTabs(groups, all) {
  const tabs = {
    dashboard: { label: 'SHOPEE范围看板', rows: [], total: 0 },
    all: { label: '范围明细请按需读取或导出', rows: [], total: all.total },
    abnormal: { label: '范围异常汇总', rows: [], total: all.unresolved }
  };
  for (const group of ['ALL','CN','VN']) {
    const m = groups[group].metrics;
    tabs[`${group}_all`] = { label: `${group}范围全部`, rows: [], total: m.total };
    tabs[`${group}_pod`] = { label: `${group}已签收`, rows: [], total: m.pod };
    tabs[`${group}_pending1`] = { label: `${group}Pending1+`, rows: [], total: m.pending1 };
    tabs[`${group}_pending2`] = { label: `${group}Pending2+`, rows: [], total: m.pending2 };
    tabs[`${group}_pending3`] = { label: `${group}Pending3+`, rows: [], total: m.pending3plus };
    tabs[`${group}_oc1`] = { label: `${group}OC1+`, rows: [], total: m.oc1 };
    tabs[`${group}_oc2`] = { label: `${group}OC2+`, rows: [], total: m.oc2 };
    tabs[`${group}_oc3`] = { label: `${group}OC3+`, rows: [], total: m.oc3plus };
    tabs[`${group}_inboundNoScan`] = { label: `${group}入库无扫描`, rows: [], total: m.inboundNoScan };
    tabs[`${group}_returned`] = { label: `${group}退回件`, rows: [], total: m.returned };
  }
  return tabs;
}

function tabKey(label) {
  return ({
    '今日总单':'all','今日POD':'pod','POD率':'pod','首派成功率':'firstAttempt',
    'Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3',
    'OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','入库无扫描':'inboundNoScan',
    '退回件':'returned','退回率':'returned','退回处理中':'returnInProgress',
    '派送中':'deliveryStay','派送中率':'deliveryStay','中转节点停留':'transitHubStay','严重超时未更新':'severeOverdue'
  })[label] || 'all';
}

function listCompletedDates(fromDate, toDate) {
  const rows = getDb().prepare(`
    SELECT DISTINCT b.reportDate
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ?
    ORDER BY b.reportDate
  `).all(fromDate,toDate);
  return rows.map(row => row.reportDate);
}

function normalizeCountRow(row) {
  const result = { ...row };
  for (const [key,value] of Object.entries(result)) {
    if (key === 'reportDate' || key === 'businessType' || key === 'regionCode') continue;
    result[key] = Number(value || 0);
  }
  return result;
}

function sum(rows,key) {
  return (rows || []).reduce((total,row) => total + Number(row?.[key] || 0),0);
}

function sumMetrics(rows,keys) {
  return Object.fromEntries(keys.map(key => [key,sum(rows,key)]));
}

function rate(a,b) {
  const numerator = Number(a || 0);
  const denominator = Number(b || 0);
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function validateRange(fromDate,toDate,maxDays) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  if (!valid(fromDate) || !valid(toDate)) throw new Error('请选择有效的开始日期和结束日期。');
  if (fromDate > toDate) throw new Error('开始日期不能晚于结束日期。');
  const days = Math.floor((new Date(`${toDate}T00:00:00Z`) - new Date(`${fromDate}T00:00:00Z`)) / 86400000) + 1;
  if (days > maxDays) throw new Error(`为保证系统流畅，单次日期范围最多${maxDays}天。`);
  return { from: fromDate, to: toDate, days };
}

export const RANGE_DASHBOARD_BUSINESS_TYPES = ALL_TYPES;
