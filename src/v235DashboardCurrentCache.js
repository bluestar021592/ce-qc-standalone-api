import { getDb } from './db.js';

export const V235_DASHBOARD_CURRENT_CACHE_ID = '2026-08-22-v235-exact-current-dashboard-cache-v1';
const CCSL_TYPES = ['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES = ['SHOPEECN','SHOPEEVN'];
const REQUIRED_TYPES = [...CCSL_TYPES,...SHOPEE_TYPES];

const nowIso = () => new Date().toISOString();
const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function ensureCacheSchema(db = getDb()) {
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
}

export function latestCompletedDashboardBatch(reportDate = '') {
  const db = getDb();
  const date = String(reportDate || '').trim();
  if (date) {
    return db.prepare(`
      SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,s.status AS snapshotStatus
      FROM unified_import_batches b
      INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate=?
      ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1
    `).get(date) || null;
  }
  return db.prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.createdAt,s.status AS snapshotStatus
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status='COMPLETED'
    ORDER BY b.reportDate DESC,b.createdAt DESC,b.batchId DESC LIMIT 1
  `).get() || null;
}

export function latestCompletedDashboardDate() {
  return latestCompletedDashboardBatch()?.reportDate || '';
}

export function recentCompletedDashboardDates(limit = 7) {
  const max = Math.max(1,Math.min(30,Number(limit)||7));
  return getDb().prepare(`
    SELECT b.reportDate,MAX(b.createdAt) AS createdAt
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status='COMPLETED'
    GROUP BY b.reportDate
    ORDER BY b.reportDate DESC
    LIMIT ?
  `).all(max).map(row=>String(row.reportDate||'')).filter(Boolean);
}

function sourceFingerprint(db, batch) {
  const imported = n(db.prepare('SELECT COUNT(*) AS c FROM unified_import_rows WHERE snapshotId=?').get(batch.snapshotId)?.c);
  const ccsl = db.prepare('SELECT COUNT(*) AS c,COALESCE(MAX(updatedAt),\'\') AS u FROM final_rows WHERE reportDate=?').get(batch.reportDate) || {};
  const shopee = db.prepare("SELECT COUNT(*) AS c,COALESCE(MAX(updatedAt),'') AS u FROM business_final_rows WHERE businessType='SHOPEE' AND reportDate=?").get(batch.reportDate) || {};
  return JSON.stringify([V235_DASHBOARD_CURRENT_CACHE_ID,batch.snapshotId,batch.reportDate,imported,n(ccsl.c),ccsl.u||'',n(shopee.c),shopee.u||'']);
}

function ccslRows(db, batch) {
  return db.prepare(`
    WITH valid AS (
      SELECT u.businessType,u.shipmentCode,u.regionCode
      FROM unified_import_rows u
      WHERE u.snapshotId=? AND u.reportDate=?
        AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')
    )
    SELECT
      v.businessType,
      '' AS regionCode,
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN COALESCE(f.isPod,0)=0 AND (
        COALESCE(json_extract(f.rawJson,'$."退回状态"'),'')='已退回'
        OR COALESCE(f.primaryCategory,f.category,'') LIKE '%退回%'
      ) THEN 1 ELSE 0 END) AS returned,
      0 AS cancelled,
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
      SUM(CASE WHEN UPPER(COALESCE(v.regionCode,''))='PV' AND COALESCE(f.isPod,0)=0 THEN 1 ELSE 0 END) AS provinceOpen
    FROM valid v
    LEFT JOIN final_rows f ON f.shipmentCode=v.shipmentCode AND f.reportDate=?
    GROUP BY v.businessType
    ORDER BY v.businessType
  `).all(batch.snapshotId,batch.reportDate,batch.reportDate);
}

function shopeeRows(db, batch) {
  return db.prepare(`
    WITH valid AS (
      SELECT u.businessType,u.shipmentCode,
        CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP'
             WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV'
             ELSE 'UNKNOWN' END AS regionCode
      FROM unified_import_rows u
      WHERE u.snapshotId=? AND u.reportDate=?
        AND u.businessType IN ('SHOPEECN','SHOPEEVN')
    )
    SELECT
      v.businessType,v.regionCode,COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 THEN 1 ELSE 0 END) AS pod,
      SUM(CASE WHEN COALESCE(f.isPod,0)=0 AND (
        COALESCE(json_extract(f.rawJson,'$."退回状态"'),'')='已退回'
        OR COALESCE(f.primaryCategory,'') LIKE '%退回%'
        OR COALESCE(json_extract(f.rawJson,'$.trackingEventDescZh'),'') LIKE '%1203--派送异常%'
      ) THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."订单取消"'),'')='是' OR COALESCE(f.primaryCategory,'') LIKE '%取消%' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0)>=1 THEN 1 ELSE 0 END) AS pending1,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS pending2,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) AS pending3,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0)>=1 THEN 1 ELSE 0 END) AS oc1,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS oc2,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) AS oc3,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."盘点天数"') AS INTEGER),0)>=2 THEN 1 ELSE 0 END) AS cycle2,
      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."入库无扫描节点"'),'')='是' OR COALESCE(f.primaryCategory,'') LIKE '%入库无扫描%' THEN 1 ELSE 0 END) AS inboundNoScan,
      SUM(CASE WHEN COALESCE(CAST(json_extract(f.rawJson,'$."派送中停留天数"') AS INTEGER),0)>0 OR COALESCE(f.primaryCategory,'')='派送中停留' THEN 1 ELSE 0 END) AS deliveryStay,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 AND COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)=1 THEN 1 ELSE 0 END) AS attempt1,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 AND COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)=2 THEN 1 ELSE 0 END) AS attempt2,
      SUM(CASE WHEN COALESCE(f.isPod,0)=1 AND COALESCE(f.podAttemptNo,CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)>=3 THEN 1 ELSE 0 END) AS attempt3
    FROM valid v
    LEFT JOIN business_final_rows f
      ON f.businessType='SHOPEE' AND f.shipmentCode=v.shipmentCode AND f.reportDate=?
    GROUP BY v.businessType,v.regionCode
    ORDER BY v.businessType,v.regionCode
  `).all(batch.snapshotId,batch.reportDate,batch.reportDate);
}

function normalizeMetric(row = {}) {
  const out = {};
  for (const [key,value] of Object.entries(row)) {
    if (key === 'businessType' || key === 'regionCode') continue;
    out[key] = Number.isFinite(Number(value)) ? Number(value) : value;
  }
  return out;
}

export function refreshV235CurrentDashboardCacheDate(reportDate = '', options = {}) {
  const db = getDb();
  ensureCacheSchema(db);
  const batch = latestCompletedDashboardBatch(reportDate);
  if (!batch) return { ok:true,skipped:true,reason:'NO_COMPLETED_SNAPSHOT',reportDate:String(reportDate||'') };
  const fingerprint = sourceFingerprint(db,batch);
  const marker = db.prepare('SELECT snapshotId,sourceFingerprint FROM dashboard_cache_dates WHERE reportDate=?').get(batch.reportDate);
  if (!options.force && marker?.snapshotId === batch.snapshotId && marker?.sourceFingerprint === fingerprint) {
    const readyTypes = n(db.prepare(`
      SELECT COUNT(DISTINCT businessType) AS c
      FROM dashboard_daily_cache
      WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED'
        AND businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN')
    `).get(batch.reportDate,batch.snapshotId)?.c);
    if (readyTypes === REQUIRED_TYPES.length) {
      const count = n(db.prepare("SELECT COUNT(*) AS c FROM dashboard_daily_cache WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED'").get(batch.reportDate,batch.snapshotId)?.c);
      return { ok:true,skipped:true,reason:'CURRENT_CACHE_READY',reportDate:batch.reportDate,snapshotId:batch.snapshotId,rowCount:count,readyTypes };
    }
  }

  const rows = [...ccslRows(db,batch),...shopeeRows(db,batch)];
  const present = new Set(rows.map(row => String(row.businessType || '').toUpperCase()));
  for (const type of REQUIRED_TYPES) {
    if (!present.has(type)) rows.push({ businessType:type, regionCode:'', total:0, pod:0, returned:0, cancelled:0, pending1:0, pending2:0, pending3:0, pendingNonContinuous:0, oc1:0, oc2:0, oc3:0, cycle2:0, inboundNoScan:0, delivery1:0, deliveryStay:0, provinceOpen:0, attempt1:0, attempt2:0, attempt3:0 });
  }
  const refreshedAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM dashboard_daily_cache WHERE reportDate=?').run(batch.reportDate);
    const insert = db.prepare(`
      INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt)
      VALUES(?,?,?,?,?,?,?,?)
    `);
    for (const row of rows) {
      insert.run(batch.reportDate,String(row.businessType||''),String(row.regionCode||''),JSON.stringify(normalizeMetric(row)),batch.snapshotId,'COMPLETED',fingerprint,refreshedAt);
    }
    db.prepare(`
      INSERT INTO dashboard_cache_dates(reportDate,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt)
      VALUES(?,?,?,?,?)
      ON CONFLICT(reportDate) DO UPDATE SET snapshotId=excluded.snapshotId,snapshotStatus=excluded.snapshotStatus,sourceFingerprint=excluded.sourceFingerprint,refreshedAt=excluded.refreshedAt
    `).run(batch.reportDate,batch.snapshotId,'COMPLETED',fingerprint,refreshedAt);
    db.prepare('DELETE FROM dashboard_cache_dirty WHERE reportDate=?').run(batch.reportDate);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return { ok:true,refreshed:true,reportDate:batch.reportDate,snapshotId:batch.snapshotId,rowCount:rows.length,readyTypes:REQUIRED_TYPES.length,refreshedAt,cacheId:V235_DASHBOARD_CURRENT_CACHE_ID };
}
