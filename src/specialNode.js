import { lastEffectiveEvent, parseEventNodeAction } from './shopCodes.js';

const SELF_PICKUP_RE = /仓库自提|warehouse\s*self[ -]?pickup|self[ -]?pickup|យកទំនិញនៅឃ្លាំង/i;
const SPECIAL_CODES = new Map([
  // Final destination is authoritative. A parcel appears in exactly one of
  // these business destinations according to its latest effective trajectory.
  ['CCSLCN', { state: 'CCSLCN_DIVERSION', label: 'CCSLCN分流' }],
  ['CCSLZT', { state: 'CCSLZT_DIVERSION', label: 'CCSLZT分流' }],
  // CEL:CCSL580 / CE:580 / CEL:580 / legacy CE580 are the same dedicated
  // "580滞留包裹" destination. It remains normal/special and is excluded from
  // ordinary Pending/OC/etc.
  ['CCSL580', { state: 'CCSL580_RETENTION', label: '580滞留包裹' }],
  ['CE580', { state: 'CCSL580_RETENTION', label: '580滞留包裹' }],
  ['580', { state: 'CCSL580_RETENTION', label: '580滞留包裹' }],
  // Historical aliases normalize to the same current business meaning.
  ['CECN', { state: 'CCSLCN_DIVERSION', label: 'CCSLCN分流' }],
  ['CEZT', { state: 'CCSLZT_DIVERSION', label: 'CCSLZT分流' }]
]);

export function classifyLatestSpecialNode(events = []) {
  const latest = lastEffectiveEvent(events);
  if (!latest) return null;
  const description = eventDescription(latest);
  if (SELF_PICKUP_RE.test(description)) return specialResult('SELF_PICKUP', '仓库自提件', latest, '', 'LATEST_EVENT_SELF_PICKUP');
  const evidence = parseEventNodeAction(latest);
  const code = normalizeNodeCode(evidence.targetNodeCode || evidence.targetNode || latest.locationCode || latest.eventShop || latest.place);
  const matched = SPECIAL_CODES.get(code);
  return matched ? specialResult(matched.state, matched.label, latest, code, `LATEST_NODE_${code}`) : null;
}

export function isSpecialCategory(row = {}) {
  return [
    'SELF_PICKUP',
    'CCSLCN_DIVERSION',
    'CCSLZT_DIVERSION',
    'CCSL580_RETENTION',
    // Legacy values remain recognized so old stored rows do not become generic
    // abnormalities during historical review.
    'CCSL580_DIVERSION',
    'CE580_RETENTION',
    '580_RETENTION',
    'CECN_RETENTION',
    'CEZT_RETENTION'
  ].includes(String(row.specialState || row.primaryCategory || row.主分类 || ''));
}

function specialResult(state, label, event, code, matchedRule) {
  return {
    specialState: state,
    category: state,
    label,
    latestNodeCode: code,
    latestEventTime: event.eventTime || event.creationDate || event.lastUpdateDate || '',
    latestTrackingDescription: eventDescription(event),
    matchedRule,
    event
  };
}

function normalizeNodeCode(value) {
  return String(value || '').normalize('NFKC').trim().toUpperCase().replace(/^[【\[]|[】\]]$/g, '').replace(/^CEL?\s*:\s*/, '').replace(/\s+/g, '');
}

function eventDescription(event = {}) {
  return [event.trackingEventDescZh, event.trackingEventDesc, event.trackingEventDescKm, event.remark, event.place, event.locationCode, event.eventShop]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}
