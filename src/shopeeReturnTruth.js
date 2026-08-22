export const SHOPEE_PENDING_1203_RETURN_RULE_VERSION = '2026-08-22-shopee-pending-1203-return-v1';

/**
 * SHOPEE CN/VN business truth:
 * A trajectory event whose Pending description contains the 1203 delivery-problem
 * marker is treated as a return signal even when that event is not the last event.
 *
 * Canonical examples:
 *   trackingEventDescZh: "Pending\t异常滞留:1203--派送异常:"
 *   trackingEventDesc:   "Pending:1203--Delivery problem:"
 */
export function isShopeePending1203ReturnEvent(event = {}) {
  const raw = safeObject(event?.rawJson);
  const code = String(event?.eventCode ?? event?.trackingEventCode ?? event?.statusCode ?? raw?.eventCode ?? raw?.trackingEventCode ?? raw?.statusCode ?? '').trim();
  const text = [
    event?.trackingEventDescZh,
    event?.trackingEventDesc,
    event?.trackingEventDescKm,
    event?.statusText,
    event?.statusDesc,
    event?.statusDescription,
    event?.remark,
    raw?.trackingEventDescZh,
    raw?.trackingEventDesc,
    raw?.trackingEventDescKm,
    raw?.statusText,
    raw?.statusDesc,
    raw?.statusDescription,
    raw?.remark
  ].map(value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');

  const pendingContext = code === '150' || /\bPENDING\b/i.test(text);
  const zhMarker = /(?:异常滞留\s*[:：]?\s*)?1203\s*[-—–]{1,2}\s*派送异常/i.test(text);
  const enMarker = /1203\s*[-—–]{1,2}\s*DELIVERY\s*PROBLEM/i.test(text);
  return pendingContext && (zhMarker || enMarker);
}

export function findShopeePending1203ReturnEvent(events = []) {
  const matched = (Array.isArray(events) ? events : []).filter(isShopeePending1203ReturnEvent);
  if (!matched.length) return null;
  return matched.sort((left, right) => eventTimeValue(left) - eventTimeValue(right)).at(-1) || matched.at(-1) || null;
}

export function shopeePending1203ReturnTime(event = {}) {
  return String(event?.eventTime || event?.creationDate || event?.lastUpdateDate || safeObject(event?.rawJson)?.eventTime || '').trim();
}

function safeObject(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || {}; }
  catch { return {}; }
}

function eventTimeValue(event = {}) {
  const value = shopeePending1203ReturnTime(event);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
