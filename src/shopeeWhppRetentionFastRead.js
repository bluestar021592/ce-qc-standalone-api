import { isStrictShopeeWhppRetention, SHOPEE_WHPP_RETENTION_TRUTH_VERSION } from './shopeeWhppRetentionTruth.js';

export const SHOPEE_WHPP_FAST_READ_VERSION = '2026-08-13-v95-whpp-shared-read-v1';
const CACHE_MS = Math.max(500, Number(process.env.SHOPEE_WHPP_FAST_READ_CACHE_MS || 5000));
const cache = new Map();

function text(value = '') { return String(value ?? '').trim(); }
function safeJson(value, fallback = {}) {
  try {
    if (value && typeof value === 'object') return value;
    return JSON.parse(String(value || '')) || fallback;
  } catch { return fallback; }
}

function keyOf(snapshotId, reportDate) {
  return `${text(snapshotId)}|${text(reportDate).slice(0, 10)}`;
}

function latestTrackRows(db, snapshotId, reportDate) {
  return db.prepare(`
    WITH wanted AS (
      SELECT DISTINCT shipmentCode
      FROM unified_import_rows
      WHERE snapshotId=? AND reportDate=? AND businessType IN ('SHOPEECN','SHOPEEVN')
    ), ranked AS (
      SELECT e.shipmentCode,e.eventTime,e.eventCode,e.rawJson,e.id,
             ROW_NUMBER() OVER (
               PARTITION BY e.shipmentCode
               ORDER BY COALESCE(e.eventTime,'') DESC,e.id DESC
             ) AS rn
      FROM business_track_events e
      JOIN wanted w ON w.shipmentCode=e.shipmentCode
      WHERE e.businessType='SHOPEE' AND e.reportDate=?
    )
    SELECT shipmentCode,eventTime,eventCode,rawJson
    FROM ranked WHERE rn=1
  `).all(snapshotId, reportDate, reportDate);
}

function loadSource(db, snapshotId, reportDate) {
  const imported = db.prepare(`
    SELECT shipmentCode,businessType,regionCode
    FROM unified_import_rows
    WHERE snapshotId=? AND reportDate=? AND businessType IN ('SHOPEECN','SHOPEEVN')
    ORDER BY businessType,shipmentCode
  `).all(snapshotId, reportDate);

  const events = new Map(latestTrackRows(db, snapshotId, reportDate)
    .map(row => [text(row.shipmentCode).toUpperCase(), row]));

  const scans = new Map(db.prepare(`
    SELECT sr.shipmentCode,sr.orderStatus,sr.rawJson
    FROM business_scan_results sr
    JOIN unified_import_rows u ON u.snapshotId=? AND u.reportDate=?
      AND u.businessType IN ('SHOPEECN','SHOPEEVN') AND u.shipmentCode=sr.shipmentCode
    WHERE sr.businessType='SHOPEE' AND sr.reportDate=?
  `).all(snapshotId, reportDate, reportDate)
    .map(row => [text(row.shipmentCode).toUpperCase(), row]));

  const finals = new Map(db.prepare(`
    SELECT f.shipmentCode,f.primaryCategory,f.latestEventTime,f.latestEventDesc,f.latestNode,f.rawJson
    FROM business_final_rows f
    JOIN unified_import_rows u ON u.snapshotId=? AND u.reportDate=?
      AND u.businessType IN ('SHOPEECN','SHOPEEVN') AND u.shipmentCode=f.shipmentCode
    WHERE f.businessType='SHOPEE' AND f.reportDate=?
  `).all(snapshotId, reportDate, reportDate)
    .map(row => [text(row.shipmentCode).toUpperCase(), row]));

  return { imported, events, scans, finals };
}

function buildRows(source, reportDate) {
  const byType = { SHOPEECN: [], SHOPEEVN: [] };
  for (const item of source.imported) {
    const type = text(item.businessType).toUpperCase();
    if (!byType[type]) continue;
    const shipmentCode = text(item.shipmentCode).toUpperCase();
    if (!shipmentCode) continue;

    const eventRecord = source.events.get(shipmentCode);
    if (!eventRecord) continue;
    const event = {
      ...safeJson(eventRecord.rawJson, {}),
      shipmentCode,
      eventTime: eventRecord.eventTime || '',
      eventCode: eventRecord.eventCode || ''
    };
    const scanRecord = source.scans.get(shipmentCode) || {};
    const scan = safeJson(scanRecord.rawJson, {});
    const finalRecord = source.finals.get(shipmentCode) || {};
    const finalRow = { ...safeJson(finalRecord.rawJson, {}), ...finalRecord };
    const scanOrderStatus = text(scanRecord.orderStatus || scan.orderStatus || finalRow.orderStatus);
    if (!isStrictShopeeWhppRetention({ event, scanOrderStatus, finalRow })) continue;

    const lastNode = text(
      event.trackingEventDescZh || event.trackingEventDesc || event.remark ||
      event.eventShop || event.locationCode || event.place ||
      finalRecord.latestEventDesc || finalRecord.latestNode || 'CE:WHPP'
    );
    const latestEventCode = text(event.eventCode ?? event.trackingEventCode ?? event.statusCode);
    byType[type].push({
      reportDate,
      shipmentCode,
      运单号: shipmentCode,
      businessType: type,
      regionCode: item.regionCode || '',
      responsibilityHub: 'WHPP',
      currentState: 'SHOPEE_WHPP_RETENTION',
      primaryCategory: 'WHPP滞留包裹',
      specialState: 'SHOPEE_WHPP_RETENTION',
      WHPP滞留: '是',
      latestEventTime: text(event.eventTime || finalRecord.latestEventTime),
      最后节点时间: text(event.eventTime || finalRecord.latestEventTime),
      latestEventDesc: lastNode,
      最后节点: lastNode,
      latestEventCode,
      sourceTruthVersion: SHOPEE_WHPP_RETENTION_TRUTH_VERSION,
      fastReadVersion: SHOPEE_WHPP_FAST_READ_VERSION
    });
  }
  return byType;
}

export function loadStrictShopeeWhppRetentionBoth({ db, snapshotId, reportDate, force = false } = {}) {
  const date = text(reportDate).slice(0, 10);
  const snapshot = text(snapshotId);
  if (!db || !snapshot || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { SHOPEECN: [], SHOPEEVN: [] };

  const cacheKey = keyOf(snapshot, date);
  const hit = cache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at <= CACHE_MS) return hit.rows;

  const source = loadSource(db, snapshot, date);
  const rows = buildRows(source, date);
  cache.set(cacheKey, { at: Date.now(), rows });
  if (cache.size > 12) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, cache.size - 12);
    for (const [key] of oldest) cache.delete(key);
  }
  return rows;
}

export function invalidateShopeeWhppRetentionFastRead() {
  cache.clear();
}
