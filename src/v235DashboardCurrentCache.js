import { getDb } from './db.js';

export const V235_DASHBOARD_CURRENT_CACHE_ID = '2026-09-02-v235-exact-seven-business-persisted-cache-v1';
const CCSL_TYPES = ['CE','CEAF','TBKH','ALI1688'];
const SHOPEE_TYPES = ['SHOPEECN','SHOPEEVN'];
const REQUIRED_TYPES = [...CCSL_TYPES,...SHOPEE_TYPES,'WHPP'];

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
    CREATE INDEX IF NOT EXISTS idx_dashboard_daily_cache_date ON dashboard_daily_cache(reportDate,businessType);
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

function latestValidBatch(reportDate = '') {
  const db = getDb();
  const date = String(reportDate || '').trim();
  return date
    ? db.prepare(`SELECT b.rowid AS batchRowId,b.batchId,b.snapshotId,b.reportDate,b.createdAt,COALESCE(s.status,'') AS snapshotStatus
                  FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
                  WHERE b.status='VALID' AND b.reportDate=? ORDER BY b.createdAt DESC,b.rowid DESC LIMIT 1`).get(date) || null
    : db.prepare(`SELECT b.rowid AS batchRowId,b.batchId,b.snapshotId,b.reportDate,b.createdAt,COALESCE(s.status,'') AS snapshotStatus
                  FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
                  WHERE b.status='VALID' ORDER BY b.reportDate DESC,b.createdAt DESC,b.rowid DESC LIMIT 1`).get() || null;
}

export function normalizedDashboardCoverageReady(batch) {
  if (!batch?.snapshotId || !batch?.reportDate) return false;
  const db = getDb();
  const ccsl = db.prepare(`
    SELECT COUNT(DISTINCT u.shipmentCode) AS total,
           COUNT(DISTINCT CASE WHEN f.shipmentCode IS NOT NULL THEN u.shipmentCode END) AS matched
    FROM unified_import_rows u
    LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')
  `).get(batch.snapshotId,batch.reportDate) || {};
  const shopee = db.prepare(`
    SELECT COUNT(DISTINCT u.shipmentCode) AS total,
           COUNT(DISTINCT CASE WHEN f.shipmentCode IS NOT NULL THEN u.shipmentCode END) AS matched
    FROM unified_import_rows u
    LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN ('SHOPEECN','SHOPEEVN')
  `).get(batch.snapshotId,batch.reportDate) || {};
  const whpp = db.prepare(`
    SELECT COUNT(DISTINCT u.shipmentCode) AS total,
           COUNT(DISTINCT CASE WHEN f.shipmentCode IS NOT NULL THEN u.shipmentCode END) AS matched
    FROM unified_import_rows u
    LEFT JOIN business_final_rows f ON f.businessType='WHPP' AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
    WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType='WHPP'
  `).get(batch.snapshotId,batch.reportDate) || {};
  return n(ccsl.total) === n(ccsl.matched)
    && n(shopee.total) === n(shopee.matched)
    && n(whpp.total) === n(whpp.matched);
}

export function latestCompletedDashboardBatch(reportDate = '') {
  const row = latestValidBatch(reportDate);
  return row && normalizedDashboardCoverageReady(row) ? row : null;
}

export function latestCompletedDashboardDate() { return recentCompletedDashboardDates(1)[0] || ''; }
export function recentCompletedDashboardDates(limit = 7) {
  const max = Math.max(1,Math.min(30,Number(limit)||7));
  const candidates = getDb().prepare(`
    WITH ranked AS (
      SELECT b.rowid AS batchRowId,b.reportDate,b.snapshotId,b.createdAt,b.batchId,COALESCE(s.status,'') AS snapshotStatus,
             ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.rowid DESC) AS rn
      FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID'
    )
    SELECT reportDate,snapshotId,snapshotStatus,createdAt,batchId,batchRowId FROM ranked WHERE rn=1 ORDER BY reportDate DESC LIMIT ?
  `).all(Math.max(max*2, max));
  return candidates.filter(row => normalizedDashboardCoverageReady(row)).slice(0,max).map(row=>String(row.reportDate||'')).filter(Boolean);
}

function sourceFingerprint(db,batch){
  const imported=n(db.prepare('SELECT COUNT(*) AS c FROM unified_import_rows WHERE snapshotId=?').get(batch.snapshotId)?.c);
  const ccsl=db.prepare("SELECT COUNT(*) AS c,COALESCE(MAX(updatedAt),'') AS u FROM final_rows WHERE reportDate=?").get(batch.reportDate)||{};
  const shopee=db.prepare("SELECT COUNT(*) AS c,COALESCE(MAX(updatedAt),'') AS u FROM business_final_rows WHERE businessType='SHOPEE' AND reportDate=?").get(batch.reportDate)||{};
  const whpp=db.prepare("SELECT COUNT(*) AS c,COALESCE(MAX(updatedAt),'') AS u FROM business_final_rows WHERE businessType='WHPP' AND reportDate=?").get(batch.reportDate)||{};
  const tracks=db.prepare("SELECT COUNT(*) AS c,COALESCE(MAX(createdAt),'') AS u FROM business_track_events WHERE businessType IN ('SHOPEE','WHPP') AND reportDate=?").get(batch.reportDate)||{};
  return JSON.stringify([V235_DASHBOARD_CURRENT_CACHE_ID,batch.snapshotId,batch.reportDate,imported,n(ccsl.c),ccsl.u||'',n(shopee.c),shopee.u||'',n(whpp.c),whpp.u||'',n(tracks.c),tracks.u||'']);
}

function ccslRows(db,batch){
  return db.prepare(`
    WITH valid AS (
      SELECT u.businessType,u.shipmentCode,u.regionCode FROM unified_import_rows u
      WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN ('CE','CEAF','TBKH','ALI1688')
    ), facts AS (
      SELECT v.*,
        COALESCE(f.isPod,0) AS isPod,
        CASE WHEN COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$."退回状态"'),'')='已退回' OR COALESCE(f.primaryCategory,f.category,'') LIKE '%退回%') THEN 1 ELSE 0 END AS isReturned,
        COALESCE(f.pendingDays,0) AS pendingDays, COALESCE(f.ocDays,0) AS ocDays,
        COALESCE(f.cycleCountDays,0) AS cycleCountDays, COALESCE(f.deliveringDays,0) AS deliveringDays,
        COALESCE(f.primaryCategory,f.category,'') AS category, COALESCE(f.rawJson,'{}') AS rawJson,
        REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(f.lastEventTime,''),''),1,10),'/','-') AS podDate
      FROM valid v LEFT JOIN final_rows f ON f.shipmentCode=v.shipmentCode AND f.reportDate=?
    )
    SELECT businessType,'' AS regionCode,COUNT(*) AS total,
      SUM(isPod) AS pod,SUM(isReturned) AS returned,0 AS cancelled,
      SUM(CASE WHEN isPod=1 AND podDate=? THEN 1 ELSE 0 END) AS sameDayPod,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND (
        ocDays>=1 OR UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%'
        OR UPPER(COALESCE(json_extract(rawJson,'$."当前状态"'),''))='OC'
        OR UPPER(COALESCE(json_extract(rawJson,'$."状态标识"'),''))='OC'
      ) THEN 1 ELSE 0 END) AS ocCurrent,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND pendingDays>=1 THEN 1 ELSE 0 END) AS pending1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND pendingDays>=2 THEN 1 ELSE 0 END) AS pending2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND pendingDays>=3 THEN 1 ELSE 0 END) AS pending3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND COALESCE(json_extract(rawJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND ocDays>=1 THEN 1 ELSE 0 END) AS oc1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND ocDays>=2 THEN 1 ELSE 0 END) AS oc2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND ocDays>=3 THEN 1 ELSE 0 END) AS oc3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND cycleCountDays>=2 THEN 1 ELSE 0 END) AS cycle2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND deliveringDays>=1 THEN 1 ELSE 0 END) AS delivery1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND category LIKE '%入库无扫描%' THEN 1 ELSE 0 END) AS inboundNoScan,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND category LIKE '%工单%' THEN 1 ELSE 0 END) AS workOrder,
      SUM(CASE WHEN UPPER(COALESCE(regionCode,''))='PV' AND isPod=0 AND isReturned=0 THEN 1 ELSE 0 END) AS provinceOpen,
      0 AS attempt1,0 AS attempt2,0 AS attempt3
    FROM facts GROUP BY businessType ORDER BY businessType
  `).all(batch.snapshotId,batch.reportDate,batch.reportDate,batch.reportDate);
}

function shopeeRows(db,batch){
  return db.prepare(`
    WITH valid AS (
      SELECT u.businessType,u.shipmentCode,
        CASE WHEN UPPER(COALESCE(u.regionCode,''))='PP' THEN 'PP' WHEN UPPER(COALESCE(u.regionCode,''))='PV' THEN 'PV' ELSE 'UNKNOWN' END AS regionCode
      FROM unified_import_rows u WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType IN ('SHOPEECN','SHOPEEVN')
    ), track_attempts AS (
      SELECT shipmentCode,
        COUNT(DISTINCT CASE WHEN (
          eventCode='70' OR COALESCE(json_extract(rawJson,'$.eventCode'),'')='70' OR COALESCE(json_extract(rawJson,'$.trackingEventCode'),'')='70'
        ) THEN REPLACE(SUBSTR(COALESCE(NULLIF(eventTime,''),NULLIF(json_extract(rawJson,'$.eventTime'),''),NULLIF(json_extract(rawJson,'$.creationDate'),''),''),1,10),'/','-') END) AS deliveryAttemptDays,
        COUNT(DISTINCT CASE WHEN (
          eventCode='60' OR COALESCE(json_extract(rawJson,'$.eventCode'),'')='60' OR COALESCE(json_extract(rawJson,'$.trackingEventCode'),'')='60'
        ) THEN REPLACE(SUBSTR(COALESCE(NULLIF(eventTime,''),NULLIF(json_extract(rawJson,'$.eventTime'),''),NULLIF(json_extract(rawJson,'$.creationDate'),''),''),1,10),'/','-') END) AS assignAttemptDays
      FROM business_track_events WHERE businessType='SHOPEE' AND reportDate=? GROUP BY shipmentCode
    ), facts AS (
      SELECT v.*,
        COALESCE(f.isPod,0) AS isPod,
        CASE WHEN COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$."退回状态"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%' OR COALESCE(f.rawJson,'') LIKE '%1203--派送异常%') THEN 1 ELSE 0 END AS isReturned,
        CASE WHEN COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$."订单取消"'),'')='是' OR COALESCE(f.primaryCategory,'') LIKE '%取消%') THEN 1 ELSE 0 END AS isCancelled,
        COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0) AS pendingCount,
        COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0) AS ocDays,
        COALESCE(CAST(json_extract(f.rawJson,'$."盘点天数"') AS INTEGER),0) AS cycleDays,
        COALESCE(CAST(json_extract(f.rawJson,'$."派送中停留天数"') AS INTEGER),0) AS deliveryDays,
        COALESCE(f.primaryCategory,'') AS category, COALESCE(f.rawJson,'{}') AS rawJson,
        REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(f.latestEventTime,''),''),1,10),'/','-') AS podDate,
        CASE
          WHEN COALESCE(f.podAttemptNo,0)>0 THEN MIN(3,COALESCE(f.podAttemptNo,0))
          WHEN COALESCE(CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0)>0 THEN MIN(3,COALESCE(CAST(json_extract(f.rawJson,'$.podAttemptNo') AS INTEGER),0))
          WHEN COALESCE(ta.deliveryAttemptDays,0)>0 THEN MIN(3,ta.deliveryAttemptDays)
          WHEN COALESCE(ta.assignAttemptDays,0)>0 THEN MIN(3,ta.assignAttemptDays)
          ELSE 0 END AS podAttemptNo
      FROM valid v
      LEFT JOIN business_final_rows f ON f.businessType='SHOPEE' AND f.shipmentCode=v.shipmentCode AND f.reportDate=?
      LEFT JOIN track_attempts ta ON ta.shipmentCode=v.shipmentCode
    )
    SELECT businessType,regionCode,COUNT(*) AS total,
      SUM(isPod) AS pod,SUM(isReturned) AS returned,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=1 THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN isPod=1 AND podDate=? THEN 1 ELSE 0 END) AS sameDayPod,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND (
        ocDays>=1 OR UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%'
        OR UPPER(COALESCE(json_extract(rawJson,'$."当前状态"'),''))='OC'
        OR UPPER(COALESCE(json_extract(rawJson,'$."状态标识"'),''))='OC'
      ) THEN 1 ELSE 0 END) AS ocCurrent,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND pendingCount>=1 THEN 1 ELSE 0 END) AS pending1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND pendingCount>=2 THEN 1 ELSE 0 END) AS pending2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND pendingCount>=3 THEN 1 ELSE 0 END) AS pending3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND COALESCE(json_extract(rawJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND ocDays>=1 THEN 1 ELSE 0 END) AS oc1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND ocDays>=2 THEN 1 ELSE 0 END) AS oc2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND ocDays>=3 THEN 1 ELSE 0 END) AS oc3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND cycleDays>=2 THEN 1 ELSE 0 END) AS cycle2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND (COALESCE(json_extract(rawJson,'$."入库无扫描节点"'),'')='是' OR category LIKE '%入库无扫描%') THEN 1 ELSE 0 END) AS inboundNoScan,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND (deliveryDays>0 OR category='派送中停留') THEN 1 ELSE 0 END) AS deliveryStay,
      SUM(CASE WHEN regionCode='PV' AND isPod=0 AND isReturned=0 AND isCancelled=0 THEN 1 ELSE 0 END) AS provinceOpen,
      SUM(CASE WHEN isPod=1 AND podAttemptNo=1 THEN 1 ELSE 0 END) AS attempt1,
      SUM(CASE WHEN isPod=1 AND podAttemptNo=2 THEN 1 ELSE 0 END) AS attempt2,
      SUM(CASE WHEN isPod=1 AND podAttemptNo>=3 THEN 1 ELSE 0 END) AS attempt3
    FROM facts GROUP BY businessType,regionCode ORDER BY businessType,regionCode
  `).all(batch.snapshotId,batch.reportDate,batch.reportDate,batch.reportDate,batch.reportDate);
}

function whppRows(db,batch){
  return db.prepare(`
    WITH valid AS (
      SELECT u.shipmentCode FROM unified_import_rows u
      WHERE u.snapshotId=? AND u.reportDate=? AND u.businessType='WHPP'
    ), facts AS (
      SELECT COALESCE(f.isPod,0) AS isPod,
        CASE WHEN COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$."退回状态"'),'')='已退回' OR COALESCE(f.primaryCategory,'') LIKE '%退回%' OR COALESCE(f.rawJson,'') LIKE '%1203--派送异常%') THEN 1 ELSE 0 END AS isReturned,
        CASE WHEN COALESCE(f.isPod,0)=0 AND (COALESCE(json_extract(f.rawJson,'$."订单取消"'),'')='是' OR COALESCE(f.primaryCategory,'') LIKE '%取消%') THEN 1 ELSE 0 END AS isCancelled,
        COALESCE(CAST(json_extract(f.rawJson,'$."Pending次数"') AS INTEGER),CAST(json_extract(f.rawJson,'$."Pending当前次数"') AS INTEGER),0) AS pendingCount,
        COALESCE(CAST(json_extract(f.rawJson,'$."OC天数"') AS INTEGER),0) AS ocDays,
        COALESCE(CAST(json_extract(f.rawJson,'$."盘点天数"') AS INTEGER),0) AS cycleDays,
        COALESCE(CAST(json_extract(f.rawJson,'$."派送中停留天数"') AS INTEGER),0) AS deliveryDays,
        COALESCE(f.primaryCategory,'') AS category,COALESCE(f.rawJson,'{}') AS rawJson,
        REPLACE(SUBSTR(COALESCE(NULLIF(json_extract(f.rawJson,'$."POD时间"'),''),NULLIF(json_extract(f.rawJson,'$.podTime'),''),NULLIF(json_extract(f.rawJson,'$."签收时间"'),''),NULLIF(f.latestEventTime,''),''),1,10),'/','-') AS podDate
      FROM valid v LEFT JOIN business_final_rows f
        ON f.businessType='WHPP' AND f.shipmentCode=v.shipmentCode AND f.reportDate=?
    )
    SELECT 'WHPP' AS businessType,'' AS regionCode,COUNT(*) AS total,
      SUM(isPod) AS pod,SUM(isReturned) AS returned,SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=1 THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN isPod=1 AND podDate=? THEN 1 ELSE 0 END) AS sameDayPod,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND (
        ocDays>=1 OR UPPER(TRIM(category))='OC' OR UPPER(TRIM(category)) LIKE 'OC%' OR category LIKE '%OC滞留%'
        OR UPPER(COALESCE(json_extract(rawJson,'$."当前状态"'),''))='OC'
        OR UPPER(COALESCE(json_extract(rawJson,'$."状态标识"'),''))='OC'
      ) THEN 1 ELSE 0 END) AS ocCurrent,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND pendingCount>=1 THEN 1 ELSE 0 END) AS pending1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND pendingCount>=2 THEN 1 ELSE 0 END) AS pending2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND pendingCount>=3 THEN 1 ELSE 0 END) AS pending3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND COALESCE(json_extract(rawJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND ocDays>=1 THEN 1 ELSE 0 END) AS oc1,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND ocDays>=2 THEN 1 ELSE 0 END) AS oc2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND ocDays>=3 THEN 1 ELSE 0 END) AS oc3,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND cycleDays>=2 THEN 1 ELSE 0 END) AS cycle2,
      SUM(CASE WHEN isPod=0 AND isReturned=0 AND isCancelled=0 AND (deliveryDays>0 OR category='派送中停留') THEN 1 ELSE 0 END) AS deliveryStay,
      0 AS provinceOpen,0 AS attempt1,0 AS attempt2,0 AS attempt3
    FROM facts
  `).all(batch.snapshotId,batch.reportDate,batch.reportDate,batch.reportDate);
}

function normalizeMetric(row={}){const out={};for(const [key,value] of Object.entries(row)){if(key==='businessType'||key==='regionCode')continue;out[key]=Number.isFinite(Number(value))?Number(value):value;}return out;}

export function refreshV235CurrentDashboardCacheDate(reportDate='',options={}){
  const db=getDb();ensureCacheSchema(db);const batch=latestCompletedDashboardBatch(reportDate);
  if(!batch)return{ok:true,skipped:true,reason:'LATEST_VALID_SEVEN_BUSINESS_FACTS_NOT_READY',reportDate:String(reportDate||'')};
  const fingerprint=sourceFingerprint(db,batch);const marker=db.prepare('SELECT snapshotId,sourceFingerprint FROM dashboard_cache_dates WHERE reportDate=?').get(batch.reportDate);
  if(!options.force&&marker?.snapshotId===batch.snapshotId&&marker?.sourceFingerprint===fingerprint){
    const readyTypes=n(db.prepare("SELECT COUNT(DISTINCT businessType) AS c FROM dashboard_daily_cache WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED' AND businessType IN ('CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP')").get(batch.reportDate,batch.snapshotId)?.c);
    if(readyTypes===REQUIRED_TYPES.length){const count=n(db.prepare("SELECT COUNT(*) AS c FROM dashboard_daily_cache WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED'").get(batch.reportDate,batch.snapshotId)?.c);return{ok:true,skipped:true,reason:'CURRENT_SEVEN_BUSINESS_CACHE_READY',reportDate:batch.reportDate,snapshotId:batch.snapshotId,rowCount:count,readyTypes};}
  }
  const rows=[...ccslRows(db,batch),...shopeeRows(db,batch),...whppRows(db,batch)];const present=new Set(rows.map(row=>String(row.businessType||'').toUpperCase()));
  for(const type of REQUIRED_TYPES)if(!present.has(type))rows.push({businessType:type,regionCode:'',total:0,pod:0,returned:0,cancelled:0,sameDayPod:0,ocCurrent:0,pending1:0,pending2:0,pending3:0,pendingNonContinuous:0,oc1:0,oc2:0,oc3:0,cycle2:0,inboundNoScan:0,delivery1:0,deliveryStay:0,provinceOpen:0,attempt1:0,attempt2:0,attempt3:0});
  const refreshedAt=nowIso();db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('DELETE FROM dashboard_daily_cache WHERE reportDate=?').run(batch.reportDate);
    const insert=db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)');
    for(const row of rows)insert.run(batch.reportDate,String(row.businessType||''),String(row.regionCode||''),JSON.stringify(normalizeMetric(row)),batch.snapshotId,'COMPLETED',fingerprint,refreshedAt);
    db.prepare(`INSERT INTO dashboard_cache_dates(reportDate,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?) ON CONFLICT(reportDate) DO UPDATE SET snapshotId=excluded.snapshotId,snapshotStatus=excluded.snapshotStatus,sourceFingerprint=excluded.sourceFingerprint,refreshedAt=excluded.refreshedAt`).run(batch.reportDate,batch.snapshotId,'COMPLETED',fingerprint,refreshedAt);
    db.prepare('DELETE FROM dashboard_cache_dirty WHERE reportDate=?').run(batch.reportDate);db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return{ok:true,refreshed:true,reportDate:batch.reportDate,snapshotId:batch.snapshotId,rowCount:rows.length,readyTypes:REQUIRED_TYPES.length,refreshedAt,cacheId:V235_DASHBOARD_CURRENT_CACHE_ID};
}
