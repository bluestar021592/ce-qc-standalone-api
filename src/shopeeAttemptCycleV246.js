export const V246_SHOPEE_ATTEMPT_CYCLE_ID = '2026-08-23-v265-strict-start-failure-cycle-normalized-v2';
export const V486_STRICT_TRACK_SEMANTIC_ID = '2026-09-09-v486-canonical-delivery-text-start-pod-alias-v1';

const FAILURE_RE = /\bpending\b|派送失败|投递失败|无法联系|联系不上|无人接听|地址错误|地址异常|改派|拒收|delivery\s*failed|failed\s*delivery|delivery\s*problem|recipient\s*unavailable/i;
const NEGATIVE_POD_RE = /未签收|未妥投|签收失败|妥投失败|未\s*POD|NOT[\s_-]*DELIVERED|UNDELIVERED|DELIVERY[\s_-]*FAILED/i;
const DELIVERY_START_RE = /Parcel\s+start\s+to\s+deliver|派送中|正在为您派送/i;
const ASSIGN_START_RE = /Assigning\s+courier|派件分配|即将为您派送/i;
const POSITIVE_POD_RE = /\bPOD\b|signed[-\s]*off|Successfully\s+delivered|\bdelivered\b|已签收|签收成功|包裹已经被签收|已妥投|妥投成功|签收|妥投/i;
const CODE_KEY_RE = /^(?:eventCode|trackingEventCode|statusCode|eventStatusCode|nodeCode|scanCode|trackCode|trackingCode|shipmentEventCode|operationCode|operateCode|eventTypeCode|statusTypeCode)$/i;
const TIME_KEY_RE = /^(?:eventTime|creationDate|lastUpdateDate|createdAt|eventDate|occurTime|occurrenceTime|trackingTime|scanTime|operateTime|operationTime)$/i;
const TEXT_KEY_RE = /(?:desc|description|statusText|statusName|eventName|remark|memo|message|place|shop|location)/i;

function text(value = '') { return String(value ?? '').trim(); }
function dateKey(value = '') {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
function rawObject(event={}) {
  if (event?.rawJson && typeof event.rawJson === 'object') return event.rawJson;
  try { return event?.rawJson ? JSON.parse(String(event.rawJson)) : {}; } catch { return {}; }
}
function deepValues(root,keyRe,{depth=0,maxDepth=5,out=[]}={}) {
  if (!root || typeof root !== 'object' || depth>maxDepth) return out;
  if (Array.isArray(root)) { for (const child of root) deepValues(child,keyRe,{depth:depth+1,maxDepth,out}); return out; }
  for (const [key,value] of Object.entries(root)) {
    if (keyRe.test(key) && value !== null && value !== undefined && typeof value !== 'object') out.push(value);
    if (value && typeof value === 'object') deepValues(value,keyRe,{depth:depth+1,maxDepth,out});
  }
  return out;
}
function normalizedCode(value='') {
  const s=text(value).toUpperCase();
  if (!s) return '';
  const exact=s.match(/^0*(\d{2,4})$/);if(exact)return String(Number(exact[1]));
  const tagged=s.match(/(?:CODE|STATUS|EVENT|NODE|SCAN|TRACK)[\s:_-]*0*(\d{2,4})/i);return tagged?String(Number(tagged[1])):s;
}
function eventCode(event = {}) {
  const raw = rawObject(event);
  const direct=[event.eventCode,event.trackingEventCode,event.statusCode,event.eventStatusCode,event.nodeCode,event.scanCode,event.trackCode,event.trackingCode,event.shipmentEventCode,event.operationCode,event.operateCode,event.eventTypeCode];
  for (const value of direct) { const code=normalizedCode(value); if(code) return code; }
  for (const value of deepValues(raw,CODE_KEY_RE)) { const code=normalizedCode(value); if(code) return code; }
  return '';
}
function eventTime(event = {}) {
  const raw = rawObject(event);
  for (const value of [event.eventTime,event.creationDate,event.lastUpdateDate,event.createdAt,event.eventDate,event.occurTime,event.trackingTime,event.scanTime]) if(text(value)) return text(value);
  return text(deepValues(raw,TIME_KEY_RE)[0]||'');
}
function eventText(event = {}) {
  const raw = rawObject(event);
  const direct=[
    event.eventCode,event.trackingEventCode,event.statusCode,event.trackingEventDescZh,event.trackingEventDesc,event.trackingEventDescKm,
    event.statusText,event.statusName,event.eventName,event.remark,event.memo,event.message,event.place,event.eventShop,event.locationCode,
    event.nodeCode,event.scanCode,event.trackCode,event.operationCode
  ];
  const nested=deepValues(raw,TEXT_KEY_RE,{maxDepth:5}).slice(0,40);
  return [...direct,...nested].map(text).filter(Boolean).join(' ');
}
function sortEvents(events = []) {
  return (Array.isArray(events) ? events : []).map((event,index) => ({ event, index, time:eventTime(event) }))
    .sort((a,b) => a.time.localeCompare(b.time) || a.index-b.index).map(row => row.event);
}
function isFailure(event = {}) { return eventCode(event) === '150' || FAILURE_RE.test(eventText(event)); }
function isDeliveryStart(event = {}) {
  if (eventCode(event) === '70') return true;
  const value=eventText(event);
  return DELIVERY_START_RE.test(value) && !FAILURE_RE.test(value) && !NEGATIVE_POD_RE.test(value);
}
function isAssignStart(event = {}) {
  if (eventCode(event) === '60') return true;
  const value=eventText(event);
  return ASSIGN_START_RE.test(value) && !FAILURE_RE.test(value) && !NEGATIVE_POD_RE.test(value);
}
function isPod(event = {}) {
  if (eventCode(event) === '80') return true;
  const value = eventText(event);
  if (NEGATIVE_POD_RE.test(value)) return false;
  return POSITIVE_POD_RE.test(value);
}

export function v246PositivePodText(value = '') {
  const s = text(value);
  if (!s || NEGATIVE_POD_RE.test(s)) return false;
  return POSITIVE_POD_RE.test(s);
}

export function findV246PodDate(events = []) {
  const podEvents = sortEvents(events).filter(isPod);
  return dateKey(podEvents.at(-1) ? eventTime(podEvents.at(-1)) : '');
}

/**
 * Strict dispatch-attempt rule used only by TBKH + SHOPEECN + SHOPEEVN:
 * - first real delivery START code 70 starts attempt 1;
 * - V486 accepts the same canonical CE delivery text already used by the main
 *   trajectory owner when the numeric code is absent, but never accepts a
 *   Pending/delivery-failure sentence as START;
 * - repeated START without failure does not increment;
 * - a later START increments only after Pending/delivery-failure evidence;
 * - only when the whole trajectory has no delivery START may code 60 / the same
 *   canonical assigning-courier text be used as fallback;
 * - result is capped at 3, where 3 means 3+.
 */
export function analyzeV246ShopeeAttemptCycle(events = [], { podDate = '' } = {}) {
  const sorted = sortEvents(events).filter(event => {
    const d = dateKey(eventTime(event));
    return !podDate || !d || d <= dateKey(podDate);
  });
  const hasDeliveryStart = sorted.some(isDeliveryStart);
  const hasDelivery70 = sorted.some(event => eventCode(event) === '70');
  const hasAssignStart = sorted.some(isAssignStart);
  const hasAssign60 = sorted.some(event => eventCode(event) === '60');
  const isStart = hasDeliveryStart ? isDeliveryStart : isAssignStart;
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
  const source = !attemptNo
    ? '无真实派次START证据'
    : hasDeliveryStart
      ? (hasDelivery70 ? '轨迹70严格START/失败循环' : '轨迹派送语义严格START/失败循环')
      : (hasAssign60 ? '轨迹60分配严格兜底循环' : '轨迹派件分配语义严格兜底循环');
  const startMode = hasDeliveryStart
    ? (hasDelivery70 ? 'TRACK_70' : 'TRACK_DELIVERY_TEXT')
    : hasAssignStart
      ? (hasAssign60 ? 'TRACK_60_FALLBACK' : 'TRACK_ASSIGN_TEXT_FALLBACK')
      : 'TRACK_60_FALLBACK';
  return {
    attemptNo,
    source,
    startMode,
    startCount: starts.length,
    failureCount: failures.length,
    starts,
    failures,
    podDate: dateKey(podDate) || findV246PodDate(sorted),
    version: V246_SHOPEE_ATTEMPT_CYCLE_ID,
    startSemanticVersion: V486_STRICT_TRACK_SEMANTIC_ID
  };
}

console.info('[CE-QC][V486_STRICT_TRACK_SEMANTIC]',V486_STRICT_TRACK_SEMANTIC_ID,'strict TBKH/CN/VN attempt truth accepts canonical CE delivery/assign text when numeric 70/60 is absent; failure text cannot become START; positive POD aliases stay negative-safe.');
