import { parseEventNodeAction } from './shopCodes.js';

export const SHOPEE_WHPP_RETENTION_TRUTH_VERSION = '2026-08-13-v94-whpp-terminal-location-v1';

function safeJson(value, fallback = {}) {
  try {
    if (value && typeof value === 'object') return value;
    return JSON.parse(String(value || '')) || fallback;
  } catch {
    return fallback;
  }
}

function text(value = '') { return String(value ?? '').trim(); }

export function normalizeWhppNode(value = '') {
  return text(value)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/^CEL?\s*:\s*/, '')
    .replace(/[^A-Z0-9]/g, '');
}

function eventCodeOf(event = {}) {
  return text(event.eventCode ?? event.trackingEventCode ?? event.statusCode);
}

function eventText(event = {}) {
  return [
    event.trackingEventDescZh,
    event.trackingEventDesc,
    event.trackingEventDescKm,
    event.remark,
    event.eventShop,
    event.locationCode,
    event.place
  ].map(text).filter(Boolean).join(' ');
}

function finalShowsReturn(finalRow = {}) {
  const state = text(finalRow.currentState || finalRow.state).toUpperCase();
  if (['POD','RETURN','RETURNED','RETURN_COMPLETED','RETURN_IN_PROGRESS'].includes(state)) return true;
  const category = text(finalRow.primaryCategory || finalRow.主分类 || finalRow.异常分类).toUpperCase();
  if (['POD','POD闭环','退回','退回处理中'].includes(category)) return true;
  const returned = text(finalRow.退回状态 || finalRow.returnState).toUpperCase();
  return Boolean(returned && !['未退回','否','NONE','NO'].includes(returned));
}

function explicitWhppArrivalText(value = '') {
  const source = text(value);
  if (!source) return false;
  if (/退回|RETURN/i.test(source)) return false;
  return /(?:到达网点|货物到达|到达门店|门店入库|抵达|\bINBOUND\b|\bARRIV(?:E|ED|AL)?\b|\bRECEIVED\b)[^\r\n]{0,80}(?:CE|CEL)\s*:\s*WHPP\b/i.test(source);
}

/**
 * SHOPEE CN/VN "WHPP滞留包裹" means one thing only:
 * the latest effective trajectory still locates the parcel at WHPP, with no
 * later POD/return/return-start/outbound node. Merely mentioning WHPP anywhere
 * in a trajectory sentence is not location evidence.
 */
export function isStrictShopeeWhppRetention({ event = {}, scanOrderStatus = '', finalRow = {} } = {}) {
  const scanStatus = text(scanOrderStatus || finalRow.orderStatus);
  if (['85', '100'].includes(scanStatus)) return false;

  const code = eventCodeOf(event);
  if (['80', '84', '86'].includes(code)) return false;
  if (finalShowsReturn(finalRow)) return false;

  const description = eventText(event);
  if (/退回|RETURN/i.test(description)) return false;

  const action = parseEventNodeAction(event);
  if (String(action.actionType || '').toUpperCase() === 'OUTBOUND') return false;

  const target = normalizeWhppNode(action.targetNodeCode || action.targetNode);
  if (target === 'WHPP') return true;

  for (const candidate of [event.locationCode, event.eventShop, event.place]) {
    if (normalizeWhppNode(candidate) === 'WHPP') return true;
  }

  return explicitWhppArrivalText(description);
}

function latestEventRows(db, reportDate) {
  return db.prepare(`
    WITH ranked AS (
      SELECT shipmentCode,eventTime,eventCode,rawJson,id,
             ROW_NUMBER() OVER (
               PARTITION BY shipmentCode
               ORDER BY COALESCE(eventTime,'') DESC,id DESC
             ) AS rn
      FROM business_track_events
      WHERE businessType='SHOPEE' AND reportDate=?
    )
    SELECT shipmentCode,eventTime,eventCode,rawJson
    FROM ranked WHERE rn=1
  `).all(reportDate);
}

export function loadStrictShopeeWhppRetentionRows({ db, snapshotId, reportDate, businessType } = {}) {
  const type = text(businessType).toUpperCase();
  const date = text(reportDate).slice(0, 10);
  if (!db || !snapshotId || !date || !['SHOPEECN','SHOPEEVN'].includes(type)) return [];

  const events = new Map(latestEventRows(db, date).map(row => [text(row.shipmentCode).toUpperCase(), row]));
  const scans = new Map(db.prepare(`
    SELECT shipmentCode,orderStatus,rawJson
    FROM business_scan_results
    WHERE businessType='SHOPEE' AND reportDate=?
  `).all(date).map(row => [text(row.shipmentCode).toUpperCase(), row]));
  const finals = new Map(db.prepare(`
    SELECT shipmentCode,primaryCategory,latestEventTime,latestEventDesc,latestNode,rawJson
    FROM business_final_rows
    WHERE businessType='SHOPEE' AND reportDate=?
  `).all(date).map(row => [text(row.shipmentCode).toUpperCase(), row]));

  const imported = db.prepare(`
    SELECT shipmentCode,regionCode
    FROM unified_import_rows
    WHERE snapshotId=? AND reportDate=? AND businessType=?
    ORDER BY shipmentCode
  `).all(snapshotId, date, type);

  const rows = [];
  for (const source of imported) {
    const shipmentCode = text(source.shipmentCode).toUpperCase();
    const eventRecord = events.get(shipmentCode);
    if (!eventRecord) continue;
    const event = { ...safeJson(eventRecord.rawJson, {}), shipmentCode, eventTime: eventRecord.eventTime || '', eventCode: eventRecord.eventCode || '' };
    const scanRecord = scans.get(shipmentCode) || {};
    const scan = safeJson(scanRecord.rawJson, {});
    const finalRecord = finals.get(shipmentCode) || {};
    const finalRow = { ...safeJson(finalRecord.rawJson, {}), ...finalRecord };
    const scanOrderStatus = text(scanRecord.orderStatus || scan.orderStatus || finalRow.orderStatus);
    if (!isStrictShopeeWhppRetention({ event, scanOrderStatus, finalRow })) continue;

    const lastNode = text(event.trackingEventDescZh || event.trackingEventDesc || event.remark || event.eventShop || event.locationCode || event.place || finalRecord.latestEventDesc || finalRecord.latestNode || 'CE:WHPP');
    rows.push({
      reportDate: date,
      shipmentCode,
      运单号: shipmentCode,
      businessType: type,
      regionCode: source.regionCode || '',
      responsibilityHub: 'WHPP',
      currentState: 'SHOPEE_WHPP_RETENTION',
      primaryCategory: 'WHPP滞留包裹',
      specialState: 'SHOPEE_WHPP_RETENTION',
      WHPP滞留: '是',
      latestEventTime: text(event.eventTime || finalRecord.latestEventTime),
      最后节点时间: text(event.eventTime || finalRecord.latestEventTime),
      latestEventDesc: lastNode,
      最后节点: lastNode,
      latestEventCode: eventCodeOf(event),
      sourceTruthVersion: SHOPEE_WHPP_RETENTION_TRUTH_VERSION
    });
  }
  return rows;
}
