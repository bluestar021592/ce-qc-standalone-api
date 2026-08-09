import { normalizeEvent } from './analyzerLegacy.js';
import { detectShopInfo, lastEffectiveEvent, parseEventNodeAction } from './shopCodes.js';
import { classifyLatestSpecialNode } from './specialNode.js';
import { analyzeStoreFlow } from './storeFlow.js';
import { phnomPenhDate, summarizePendingEvents } from './pendingDays.js';

export const TRAJECTORY_FACT_VERSION = '2026-08-09-latest-effective-event-v2';

export const TRACK_FACT_CODES = Object.freeze({
  INBOUND_NO_SCAN: '26',
  CYCLE_A: '30',
  CYCLE_B: '32',
  POD: '80',
  RETURN_START: '84',
  RETURN_COMPLETE: '86',
  WORK_ORDER: '99',
  PENDING: '150'
});

/**
 * Build facts from scan + trajectory evidence before QC business rules are
 * applied. All natural-day facts use Asia/Phnom_Penh through pendingDays.js.
 *
 * Core invariant: trajectory CURRENT state is determined by the LAST effective
 * trajectory event only. Historical POD/return/special/store nodes remain
 * evidence, but must never silently override a later valid event.
 *
 * Scan terminal states are intentionally separate and still authoritative:
 * orderStatus=85 is POD lock; orderStatus=100 is completed return.
 */
export function buildTrajectoryFacts({
  shipmentCode = '',
  scanRow = {},
  events = [],
  reportDate = '',
  analysisDate = '',
  shopCodeMap = null
} = {}) {
  const cutoffDate = phnomPenhDate(analysisDate);
  const sortedEvents = sortTrajectoryEvents(events).filter(event => {
    if (!cutoffDate) return true;
    const date = phnomPenhDate(eventTimeOf(event));
    return !date || date <= cutoffDate;
  });
  const lastEvent = lastEffectiveEvent(sortedEvents) || sortedEvents.at(-1) || null;
  const lastCode = trackingCodeOf(lastEvent);
  const latestTrackTerminal = terminalFromLatestEvent(lastEvent);
  const scanStatus = String(scanRow?.orderStatus ?? '').trim();
  const isPod = scanStatus === '85' || latestTrackTerminal?.type === 'POD';
  const isReturned = !isPod && (scanStatus === '100' || latestTrackTerminal?.type === 'RETURN_COMPLETED');
  const returnInProgress = !isPod && !isReturned && lastCode === TRACK_FACT_CODES.RETURN_START;
  const special = !isPod && !isReturned && !returnInProgress
    ? classifyLatestSpecialNode(sortedEvents)
    : null;
  const latestNodeAction = lastEvent ? parseEventNodeAction(lastEvent) : emptyNodeAction();
  const latestShop = lastEvent
    ? detectShopInfo({ events: sortedEvents, shopCodeMap, lastEvent })
    : { isShop: false, matchedRule: 'NO_EFFECTIVE_EVENT' };
  const storeFlow = analyzeStoreFlow({
    shipmentCode,
    events: sortedEvents,
    reportDate,
    isPod,
    isReturned
  });

  const pendingSummary = summarizePendingEvents(
    sortedEvents,
    event => trackingCodeOf(event) === TRACK_FACT_CODES.PENDING
  );
  const pendingTailEvents = currentPendingTail(sortedEvents);
  const pendingTailSummary = summarizePendingEvents(
    pendingTailEvents,
    event => trackingCodeOf(event) === TRACK_FACT_CODES.PENDING
  );

  return {
    factVersion: TRAJECTORY_FACT_VERSION,
    analysisCutoffDate: cutoffDate,
    sortedEvents,
    effectiveEventCount: sortedEvents.filter(isEffectiveFactEvent).length,
    lastEvent,
    lastCode,
    lastEventTime: eventTimeOf(lastEvent),
    lastEventText: trajectoryEventText(lastEvent),
    latestTrackTerminal,
    scanStatus,
    isPod,
    isReturned,
    returnInProgress,
    terminalSource: isPod
      ? (scanStatus === '85' ? 'SCAN_ORDER_STATUS_85' : 'LATEST_TRACK_CODE_80')
      : isReturned
        ? (scanStatus === '100' ? 'SCAN_ORDER_STATUS_100' : 'LATEST_TRACK_CODE_86')
        : '',
    special,
    latestNodeAction,
    latestShop,
    storeFlow,
    pendingRawEventCount: pendingSummary.rawEventCount,
    pendingDates: pendingSummary.dates,
    pendingDistinctDayCount: pendingSummary.distinctDayCount,
    pendingDateContinuity: pendingSummary.continuous,
    pendingContinuityLabel: pendingSummary.continuity,
    currentPendingRawEventCount: pendingTailSummary.rawEventCount,
    currentPendingDates: pendingTailSummary.dates,
    currentPendingDistinctDayCount: pendingTailSummary.distinctDayCount,
    currentPendingDateContinuity: pendingTailSummary.continuous,
    currentPendingContinuityLabel: pendingTailSummary.continuity
  };
}

export function sortTrajectoryEvents(events = []) {
  return (events || [])
    .map((event, index) => ({ event: normalizeEvent(event), index }))
    .sort((left, right) => compareTrajectoryEvents(left.event, right.event) || left.index - right.index)
    .map(item => item.event);
}

export function trackingCodeOf(event = {}) {
  return String(event?.eventCode ?? event?.trackingEventCode ?? '').trim();
}

export function terminalFromLatestEvent(event = null) {
  const code = trackingCodeOf(event || {});
  if (code === TRACK_FACT_CODES.POD) return { type: 'POD', event };
  if (code === TRACK_FACT_CODES.RETURN_COMPLETE) return { type: 'RETURN_COMPLETED', event };
  return null;
}

export function trajectoryEventText(event = {}) {
  if (!event) return '';
  return [
    event.eventCode,
    event.trackingEventCode,
    event.trackingEventDescZh,
    event.trackingEventDesc,
    event.trackingEventDescKm,
    event.remark,
    event.eventShop,
    event.locationCode,
    event.place
  ].map(value => String(value || '').trim()).filter(Boolean).join(' ');
}

function currentPendingTail(events = []) {
  if (!events.length || trackingCodeOf(events.at(-1)) !== TRACK_FACT_CODES.PENDING) return [];
  const tail = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (trackingCodeOf(events[index]) !== TRACK_FACT_CODES.PENDING) break;
    tail.push(events[index]);
  }
  return tail.reverse();
}

function compareTrajectoryEvents(a = {}, b = {}) {
  for (const key of ['eventTime', 'creationDate', 'lastUpdateDate']) {
    const diff = sortableTime(a[key]).localeCompare(sortableTime(b[key]));
    if (diff) return diff;
  }
  return numericId(a.id) - numericId(b.id);
}

function sortableTime(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)
    ? `${text.replace(' ', 'T').replace(/Z|[+-]\d{2}:?\d{2}$/, '')}+07:00`
    : text;
  const stamp = Date.parse(iso);
  return Number.isFinite(stamp) ? String(stamp).padStart(16, '0') : text;
}

function numericId(value) {
  const match = String(value ?? '').match(/\d+/g);
  return match ? Number(match.join('')) : 0;
}

function eventTimeOf(event = null) {
  return String(event?.eventTime || event?.creationDate || event?.lastUpdateDate || '').trim();
}

function isEffectiveFactEvent(event = {}) {
  return Boolean(event && (
    event.eventTime
    || event.creationDate
    || event.lastUpdateDate
    || trackingCodeOf(event)
    || trajectoryEventText(event)
  ));
}

function emptyNodeAction() {
  return {
    lastEventActionType: 'OTHER',
    actionType: 'OTHER',
    lastEventTargetNode: '',
    targetNode: '',
    targetNodeCode: ''
  };
}
