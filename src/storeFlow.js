import crypto from 'crypto';
import { getShopCodeMap, isNormalFinalHubCode } from './shopCodes.js';
import { SHOP_WHITELIST_VERSION } from './shopWhitelist.js';

const PENDING_RE = /pending|派送失败|无法联系|无人接听|地址错误|改派/i;
const OC_RE = /(?:^|[^A-Z])OC(?:[^A-Z]|$)|overdue|逾期|超时/i;
const POD_RE = /\bpod\b|delivered|签收|妥投/i;
const RETURN_RE = /\breturn(?:ed)?\b|退回|返仓|退件/i;
const OUTBOUND_RE = /\boutbound\b|离开网点|货物离开|发往|转往|下一个网点/i;
const INBOUND_RE = /\binbound\b|到达网点|货物到达|到达门店|入库/i;
const STRUCTURED_SHOP_CODE_RE = /(?:^|[^A-Z0-9])((?:CP|FS)\s*\d{6}|(?:PV|PNH)\s*\d{3})(?![A-Z0-9])/gi;

export function analyzeStoreFlow({ shipmentCode = '', events = [], reportDate = '', isPod = false, isReturned = false } = {}) {
  const whitelist = getShopCodeMap();
  const sorted = [...(events || [])]
    .map((event, index) => ({ event, index }))
    .sort((a, b) => eventKey(a.event).localeCompare(eventKey(b.event)) || a.index - b.index)
    .map(item => item.event);

  let cycle = null;
  for (const event of sorted) {
    const action = eventAction(event);
    const codes = structuredCodes(event).filter(code => whitelist.has(code));
    const target = codes.at(-1) || '';
    const current = codes[0] || '';

    if (action === 'OUTBOUND' && target) {
      if (cycle?.state && cycle.state !== 'CLOSED') cycle.state = 'CLOSED';
      cycle = newCycle(shipmentCode, target, whitelist.get(target), event);
      continue;
    }
    if (action === 'INBOUND' && target && cycle?.targetShopCode === target) {
      cycle.currentShopCode = target;
      cycle.shopArrivedAt = event.eventTime || '';
      cycle.shopLastEventAt = event.eventTime || '';
      cycle.pending = false;
      cycle.oc = false;
      cycle.state = 'SHOP_ARRIVED_CURRENT';
      cycle.reason = 'STRUCTURED_WHITELIST_INBOUND';
      continue;
    }
    if (cycle?.state === 'SHOP_ARRIVED_CURRENT' && PENDING_RE.test(eventText(event))) {
      cycle.shopPendingAt ||= event.eventTime || '';
      cycle.shopLastEventAt = event.eventTime || cycle.shopLastEventAt;
      cycle.pending = true;
      cycle.oc = false;
      cycle.reason = 'PENDING_AFTER_SHOP_ARRIVAL';
      continue;
    }
    if (cycle?.state === 'SHOP_ARRIVED_CURRENT' && OC_RE.test(eventText(event))) {
      cycle.shopOcAt ||= event.eventTime || '';
      cycle.shopLastEventAt = event.eventTime || cycle.shopLastEventAt;
      cycle.oc = true;
      cycle.pending = false;
      cycle.reason = 'OC_AFTER_SHOP_ARRIVAL';
      continue;
    }
    if (cycle?.state === 'SHOP_ARRIVED_CURRENT' && closesStoreCycle(event, action, current, cycle.currentShopCode)) {
      cycle.state = 'CLOSED';
      cycle.shopLastEventAt = event.eventTime || cycle.shopLastEventAt;
      cycle.reason = 'LATER_DEPARTURE_OR_FINAL_ACTION';
    }
  }

  if (!cycle) return emptyStoreFlow();
  if (isPod || isReturned) {
    cycle.state = 'CLOSED';
    cycle.reason = isPod ? 'POD_CLOSED' : 'RETURN_CLOSED';
  }

  const transfer = cycle.state === 'SHOP_TRANSFER_IN_PROGRESS'
    ? elapsedInclusiveDays(cycle.shopTransferStartedAt, reportDate)
    : 0;
  const shopAge = cycle.state === 'SHOP_ARRIVED_CURRENT'
    ? elapsedInclusiveDays(cycle.shopArrivedAt, reportDate)
    : 0;
  const retentionAnchor = cycle.shopLastEventAt || cycle.shopArrivedAt;
  const retention = cycle.state === 'SHOP_ARRIVED_CURRENT'
    ? elapsedInclusiveDays(retentionAnchor, reportDate)
    : 0;
  const tags = [];
  if (cycle.state === 'SHOP_TRANSFER_IN_PROGRESS') tags.push('SHOP_TRANSFER_IN_PROGRESS');
  if (transfer >= 1) tags.push('SHOP_TRANSFER_1_PLUS');
  if (transfer >= 2) tags.push('SHOP_TRANSFER_2_PLUS');
  if (transfer >= 3) tags.push('SHOP_TRANSFER_3_PLUS');
  if (cycle.state === 'SHOP_ARRIVED_CURRENT') tags.push('SHOP_ARRIVED_CURRENT');
  if (cycle.pending && cycle.state === 'SHOP_ARRIVED_CURRENT') tags.push('SHOP_PENDING');
  if (cycle.oc && cycle.state === 'SHOP_ARRIVED_CURRENT') tags.push('SHOP_OC');
  if (retention >= 1) tags.push('SHOP_RETENTION_1_PLUS');
  if (retention >= 2) tags.push('SHOP_RETENTION_2_PLUS');
  if (retention >= 3) tags.push('SHOP_RETENTION_3_PLUS');

  return {
    targetShopCode: cycle.targetShopCode,
    currentShopCode: cycle.currentShopCode,
    shopName: cycle.shopName,
    shopCycleId: cycle.shopCycleId,
    shopTransferStartedAt: cycle.shopTransferStartedAt,
    shopArrivedAt: cycle.shopArrivedAt,
    shopLastEventAt: cycle.shopLastEventAt,
    shopPendingAt: cycle.shopPendingAt,
    shopOcAt: cycle.shopOcAt,
    shopTransferNaturalDays: transfer,
    shopAgeNaturalDays: shopAge,
    shopRetentionNaturalDays: retention,
    shopState: cycle.state,
    shopStateReason: cycle.reason,
    whitelistVersion: SHOP_WHITELIST_VERSION,
    storeTags: tags
  };
}

export function emptyStoreFlow() {
  return {
    targetShopCode: '', currentShopCode: '', shopName: '', shopCycleId: '',
    shopTransferStartedAt: '', shopArrivedAt: '', shopLastEventAt: '', shopPendingAt: '', shopOcAt: '',
    shopTransferNaturalDays: 0, shopAgeNaturalDays: 0, shopRetentionNaturalDays: 0, shopState: '', shopStateReason: 'NO_STORE_CYCLE',
    whitelistVersion: SHOP_WHITELIST_VERSION, storeTags: []
  };
}

function newCycle(shipmentCode, code, name, event) {
  const startedAt = event.eventTime || '';
  return {
    targetShopCode: code,
    currentShopCode: '',
    shopName: name || code,
    shopCycleId: crypto.createHash('sha256').update(`${shipmentCode}|${code}|${startedAt}`).digest('hex').slice(0, 20),
    shopTransferStartedAt: startedAt,
    shopArrivedAt: '',
    shopLastEventAt: startedAt,
    shopPendingAt: '',
    shopOcAt: '',
    pending: false,
    oc: false,
    state: 'SHOP_TRANSFER_IN_PROGRESS',
    reason: 'STRUCTURED_WHITELIST_OUTBOUND'
  };
}

function structuredCodes(event) {
  const fields = [
    event?.locationCode, event?.eventShop, event?.shopCode, event?.currentShop,
    event?.deliveryShop, event?.trackingEventDescZh, event?.trackingEventDesc,
    event?.place, event?.remark
  ];
  const out = [];
  for (const field of fields) {
    const src = String(field || '').normalize('NFKC').toUpperCase();
    for (const match of src.matchAll(STRUCTURED_SHOP_CODE_RE)) {
      const code = String(match[1] || '').replace(/\s+/g, '').toUpperCase();
      if (code && !out.includes(code)) out.push(code);
    }
  }
  return out;
}

function eventAction(event) {
  const code = `${event?.eventCode || ''} ${event?.trackingEventCode || ''}`.toUpperCase();
  const text = eventText(event);
  if (/\bOUTBOUND\b/.test(code) || OUTBOUND_RE.test(text)) return 'OUTBOUND';
  if (/\bINBOUND\b/.test(code) || INBOUND_RE.test(text)) return 'INBOUND';
  return 'OTHER';
}

function closesStoreCycle(event, action, currentCode, arrivedCode) {
  const text = eventText(event);
  // Store is a customer self-pickup point. A generic "delivery" phrase must not
  // close the store cycle because stores do not dispatch parcels for delivery.
  if (POD_RE.test(text) || RETURN_RE.test(text)) return true;
  if (action === 'OUTBOUND' && (!currentCode || currentCode === arrivedCode)) return true;
  return action === 'INBOUND' && structuredHubCodes(event).some(isNormalFinalHubCode);
}

function structuredHubCodes(event) {
  return [event?.locationCode, event?.eventShop, event?.shopCode, event?.currentShop, event?.place]
    .map(value => String(value || '').toUpperCase().replace(/^CEL\s*:\s*/i, '').replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);
}

function eventText(event = {}) {
  return [event.eventCode, event.trackingEventCode, event.trackingEventDesc, event.trackingEventDescZh,
    event.trackingEventDescKm, event.place, event.locationCode, event.eventShop, event.remark]
    .map(value => String(value || '')).join(' ');
}

function eventKey(event) {
  const stamp = Date.parse(String(event?.eventTime || ''));
  return Number.isFinite(stamp) ? String(stamp).padStart(16, '0') : String(event?.eventTime || '');
}

function elapsedInclusiveDays(start, end) {
  const a = dayValue(start);
  const b = dayValue(end);
  if (a === null || b === null) return start ? 1 : 0;
  return Math.max(1, Math.floor((b - a) / 86400000) + 1);
}

function dayValue(value) {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}
