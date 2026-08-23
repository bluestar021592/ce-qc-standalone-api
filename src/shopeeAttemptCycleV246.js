export const V246_SHOPEE_ATTEMPT_CYCLE_ID = '2026-08-23-v246-shopee-strict-start-failure-cycle-v1';

const FAILURE_RE = /\bpending\b|派送失败|投递失败|无法联系|联系不上|无人接听|地址错误|地址异常|改派|拒收|delivery\s*failed|failed\s*delivery|delivery\s*problem|recipient\s*unavailable/i;
const NEGATIVE_POD_RE = /未签收|未妥投|签收失败|妥投失败|未\s*POD|NOT[\s_-]*DELIVERED|UNDELIVERED|DELIVERY[\s_-]*FAILED/i;

function text(value = '') { return String(value ?? '').trim(); }
function dateKey(value = '') {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
function eventCode(event = {}) {
  const raw = event?.rawJson && typeof event.rawJson === 'object' ? event.rawJson : {};
  return text(event.eventCode ?? event.trackingEventCode ?? event.statusCode ?? raw.eventCode ?? raw.trackingEventCode ?? raw.statusCode);
}
function eventTime(event = {}) {
  const raw = event?.rawJson && typeof event.rawJson === 'object' ? event.rawJson : {};
  return text(event.eventTime ?? event.creationDate ?? event.lastUpdateDate ?? raw.eventTime ?? raw.creationDate ?? raw.lastUpdateDate);
}
function eventText(event = {}) {
  const raw = event?.rawJson && typeof event.rawJson === 'object' ? event.rawJson : {};
  return [
    event.eventCode,event.trackingEventCode,event.statusCode,event.trackingEventDescZh,event.trackingEventDesc,event.trackingEventDescKm,
    event.statusText,event.remark,event.place,event.eventShop,event.locationCode,
    raw.eventCode,raw.trackingEventCode,raw.statusCode,raw.trackingEventDescZh,raw.trackingEventDesc,raw.trackingEventDescKm,
    raw.statusText,raw.remark,raw.place,raw.eventShop,raw.locationCode
  ].map(text).filter(Boolean).join(' ');
}
function sortEvents(events = []) {
  return (Array.isArray(events) ? events : []).map((event,index) => ({ event, index, time:eventTime(event) }))
    .sort((a,b) => a.time.localeCompare(b.time) || a.index-b.index).map(row => row.event);
}
function isDeliveryStart(event = {}) { return eventCode(event) === '70'; }
function isAssignStart(event = {}) { return eventCode(event) === '60'; }
function isFailure(event = {}) { return eventCode(event) === '150' || FAILURE_RE.test(eventText(event)); }
function isPod(event = {}) {
  if (eventCode(event) === '80') return true;
  const value = eventText(event);
  if (NEGATIVE_POD_RE.test(value)) return false;
  return /\bPOD\b|Successfully delivered|已签收|签收成功|已妥投|妥投成功/i.test(value);
}

export function v246PositivePodText(value = '') {
  const s = text(value);
  if (!s || NEGATIVE_POD_RE.test(s)) return false;
  return /\bPOD\b|Successfully delivered|已签收|签收成功|已妥投|妥投成功/i.test(s);
}

export function findV246PodDate(events = []) {
  const podEvents = sortEvents(events).filter(isPod);
  return dateKey(podEvents.at(-1) ? eventTime(podEvents.at(-1)) : '');
}

/**
 * Strict Shopee dispatch-attempt rule:
 * - the first real delivery START (trajectory code 70) starts attempt 1;
 * - duplicate/repeated START nodes do not create another attempt;
 * - a later START increments only after a Pending/delivery-failure event;
 * - if no code 70 exists at all, code 60 courier-assignment is used as fallback;
 * - the result is capped at 3, where 3 means 3+.
 */
export function analyzeV246ShopeeAttemptCycle(events = [], { podDate = '' } = {}) {
  const sorted = sortEvents(events).filter(event => {
    const d = dateKey(eventTime(event));
    return !podDate || !d || d <= dateKey(podDate);
  });
  const hasDelivery70 = sorted.some(isDeliveryStart);
  const isStart = hasDelivery70 ? isDeliveryStart : isAssignStart;
  let attemptNo = 0;
  let failedSinceStart = false;
  const starts = [];
  const failures = [];
  for (const event of sorted) {
    if (isStart(event)) {
      if (attemptNo === 0) {
        attemptNo = 1;
        starts.push({ time:eventTime(event), code:eventCode(event), text:eventText(event).slice(0,240) });
        failedSinceStart = false;
      } else if (failedSinceStart) {
        attemptNo = Math.min(3, attemptNo + 1);
        starts.push({ time:eventTime(event), code:eventCode(event), text:eventText(event).slice(0,240) });
        failedSinceStart = false;
      }
      continue;
    }
    if (attemptNo > 0 && isFailure(event)) {
      failedSinceStart = true;
      failures.push({ time:eventTime(event), code:eventCode(event), text:eventText(event).slice(0,240) });
    }
  }
  return {
    attemptNo,
    source: attemptNo ? (hasDelivery70 ? '轨迹70严格START/失败循环' : '轨迹60分配严格兜底循环') : '无真实派次START证据',
    startMode: hasDelivery70 ? 'TRACK_70' : 'TRACK_60_FALLBACK',
    startCount: starts.length,
    failureCount: failures.length,
    starts,
    failures,
    podDate: dateKey(podDate) || findV246PodDate(sorted),
    version: V246_SHOPEE_ATTEMPT_CYCLE_ID
  };
}
