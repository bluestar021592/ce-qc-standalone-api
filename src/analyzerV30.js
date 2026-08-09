import {
  analyzeShipment as analyzeShipmentLegacy,
  normalizeEvent
} from './analyzerLegacy.js';
import { analyzeStoreFlow } from './storeFlow.js';
import { classifyLatestSpecialNode } from './specialNode.js';
import { lastEffectiveEvent } from './shopCodes.js';

export { normalizeEvent };

const TRACK = Object.freeze({
  INBOUND_NO_SCAN: '26',
  CYCLE_A: '30',
  CYCLE_B: '32',
  WORK_ORDER: '99',
  PENDING: '150',
  POD: '80',
  RETURN_START: '84',
  RETURN_COMPLETE: '86'
});
const CYCLE_CODES = new Set([TRACK.CYCLE_A, TRACK.CYCLE_B]);

/**
 * Development-3/4 trajectory status correction layer for CE/TBKH/ALI1688.
 *
 * The legacy analyzer still provides evidence fields and old report-compatible
 * columns. This wrapper makes CURRENT business state authoritative from the
 * locked tracking codes and prevents historical nodes from remaining abnormal.
 */
export function analyzeShipment(args = {}) {
  const { waybill = '', scanRow = {}, events = [], reportDate = '' } = args;
  const legacy = analyzeShipmentLegacy(args);
  const sorted = sortEvents(events);
  const last = lastEffectiveEvent(sorted) || sorted.at(-1) || null;
  const lastCode = codeOf(last);
  const exactTerminal = latestTerminal(sorted);
  const scanStatus = String(scanRow.orderStatus ?? '').trim();
  const isPod = scanStatus === '85' || exactTerminal?.type === 'POD';
  const isReturned = !isPod && (scanStatus === '100' || exactTerminal?.type === 'RETURN_COMPLETED');
  const returnInProgress = !isPod && !isReturned && lastCode === TRACK.RETURN_START;
  const special = !isPod && !isReturned && !returnInProgress ? classifyLatestSpecialNode(sorted) : null;
  const storeFlow = analyzeStoreFlow({ shipmentCode: waybill, events: sorted, reportDate, isPod, isReturned });
  const pending = pendingTail(sorted, last);
  const cycle = cycleTail(sorted, last, reportDate);
  const oc = ocCurrent(sorted, last, reportDate);
  const storePending = storeFlow.shopState === 'SHOP_ARRIVED_CURRENT' && lastCode === TRACK.PENDING;
  const storeOc = storeFlow.shopState === 'SHOP_ARRIVED_CURRENT' && oc.active;

  let category = sanitizeLegacyCategory(legacy.primaryCategory || legacy.主分类 || legacy.异常分类 || '需人工复核');
  let state = String(legacy.currentState || '');
  let judgment = legacy.QC判断 || legacy.qcConclusion || category;

  if (isPod) {
    category = 'POD闭环';
    state = 'POD';
    judgment = '轨迹状态码80/扫描85确认签收，正常POD闭环';
  } else if (isReturned) {
    category = '退回';
    state = 'RETURN_COMPLETED';
    judgment = '轨迹状态码86/扫描100确认退回，正常退回闭环';
  } else if (returnInProgress) {
    category = '退回处理中';
    state = 'RETURN_IN_PROGRESS';
    judgment = '轨迹状态码84，退回处理中；继续追踪至86，不计普通遗留异常';
  } else if (special) {
    category = special.category;
    state = special.specialState || 'SPECIAL_NORMAL';
    judgment = `${special.label || category}，按特殊正常去向监管并排除普通异常`;
  } else if (storeFlow.shopState === 'SHOP_ARRIVED_CURRENT') {
    if (storeOc) {
      category = '门店OC';
      state = 'SHOP_OC';
      judgment = '当前位于门店且最新有效状态为OC，按门店状态监管，不叠加普通OC/Pending异常';
    } else if (storePending) {
      category = '门店Pending';
      state = 'SHOP_PENDING';
      judgment = '当前位于门店且最新轨迹状态码150，按门店Pending监管，不叠加普通Pending异常';
    } else {
      category = Number(storeFlow.shopRetentionNaturalDays || 0) >= 2 ? '门店滞留' : '门店入库';
      state = Number(storeFlow.shopRetentionNaturalDays || 0) >= 2 ? 'SHOP_RETENTION' : 'SHOP_ARRIVED_CURRENT';
      judgment = category === '门店滞留'
        ? `包裹当前停留门店，最后门店有效节点已${storeFlow.shopRetentionNaturalDays || 0}个自然日未更新`
        : '包裹已到门店，当前为正常门店流转';
    }
  } else if (storeFlow.shopState === 'SHOP_TRANSFER_IN_PROGRESS') {
    category = Number(storeFlow.shopRetentionNaturalDays || 0) >= 2 ? '门店途中2天+' : '门店途中';
    state = 'SHOP_TRANSFER_IN_PROGRESS';
  } else if (lastCode === TRACK.PENDING) {
    const days = Math.max(1, pending.days);
    category = days >= 3 ? 'Pending3次以上' : `Pending${days}次`;
    state = 'PENDING';
    judgment = `当前最后有效轨迹为150；实际Pending发生${days}个自然日${pending.continuous ? '，连续' : days >= 2 ? '，不连续' : ''}`;
  } else if (oc.active) {
    category = oc.days >= 3 ? 'OC3天以上' : `OC${Math.max(1, oc.days)}天`;
    state = 'OC';
    judgment = `当前最后有效节点仍为OC，已停留${oc.days}个自然日`;
  } else if (CYCLE_CODES.has(lastCode)) {
    category = cycle.days >= 3 ? '盘点3天以上' : cycle.days >= 2 ? '盘点2天' : '盘点1天';
    state = 'CYCLE_COUNT';
    judgment = `当前最后有效轨迹状态码${lastCode}为盘点，已停留${cycle.days}个自然日`;
  } else if (lastCode === TRACK.WORK_ORDER) {
    category = '工单未处理';
    state = 'WORK_ORDER';
    judgment = '当前最后有效轨迹状态码99为工单，等待后续有效动作';
  } else if (lastCode === TRACK.INBOUND_NO_SCAN) {
    category = '入库无扫描';
    state = 'INBOUND_NO_SCAN';
    judgment = '当前最后有效轨迹状态码26，入库后没有后续有效动作';
  }

  const terminal = isPod || isReturned;
  const currentPendingDays = !terminal && !returnInProgress && !special && !storeFlow.shopState && lastCode === TRACK.PENDING ? pending.days : 0;
  const currentCycleDays = !terminal && !returnInProgress && !special && !storeFlow.shopState && CYCLE_CODES.has(lastCode) ? cycle.days : 0;
  const currentOcDays = !terminal && !returnInProgress && !special && !storeFlow.shopState && oc.active ? oc.days : 0;
  const inboundNoScan = !terminal && !returnInProgress && !special && !storeFlow.shopState && lastCode === TRACK.INBOUND_NO_SCAN;
  const allPendingDates = distinctDates(sorted.filter(event => codeOf(event) === TRACK.PENDING));

  return {
    ...legacy,
    ...storeFlow,
    ...(special || {}),
    analysisRuleVersion: '2026-08-09-ccsl-scan-track-code-separation-v30',
    是否POD: isPod ? '是' : '否',
    POD状态: isPod ? 'POD' : '未POD',
    POD来源: isPod ? (scanStatus === '85' ? '订单扫描orderStatus=85' : '轨迹状态码80') : '',
    POD时间: isPod ? (exactTerminal?.event?.eventTime || legacy.POD时间 || '') : '',
    退回状态: isReturned ? '已退回' : (returnInProgress ? '退回处理中' : '未退回'),
    退回开始时间: returnInProgress ? (last?.eventTime || '') : (legacy.退回开始时间 || ''),
    退回完成时间: isReturned ? (exactTerminal?.event?.eventTime || '') : '',
    currentState: state,
    primaryCategory: category,
    主分类: category,
    异常分类: category,
    QC判断: judgment,
    qcConclusion: judgment,
    Pending天数: currentPendingDays,
    Pending次数: currentPendingDays,
    Pending日期: currentPendingDays ? pending.dates.join(', ') : '',
    Pending连续性: currentPendingDays >= 2 ? (pending.continuous ? '连续' : '不连续') : (currentPendingDays ? '单次' : ''),
    pendingDistinctDayCount: allPendingDates.length,
    pendingDates: allPendingDates,
    pendingContinuity: currentPendingDays >= 2 ? (pending.continuous ? '连续' : '不连续') : (currentPendingDays ? '单次' : ''),
    pendingRawEventCount: sorted.filter(event => codeOf(event) === TRACK.PENDING).length,
    OC天数: currentOcDays,
    OC次数: currentOcDays ? Number(legacy.OC次数 || 1) : 0,
    盘点天数: currentCycleDays,
    盘点次数: currentCycleDays ? Number(legacy.盘点次数 || 1) : 0,
    入库无扫描节点: inboundNoScan ? '是' : '否',
    lastEventCode: lastCode,
    latestTrackStatusCode: lastCode,
    最后节点: last ? eventText(last) : (legacy.最后节点 || ''),
    最后节点时间: last?.eventTime || legacy.最后节点时间 || '',
    lastEventDesc: last ? eventText(last) : (legacy.lastEventDesc || ''),
    carry状态: isPod ? 'closed_pod' : (isReturned ? 'closed_return' : (returnInProgress ? 'active_return' : legacy.carry状态 || 'active')),
    跨日状态: terminal ? '已闭环' : legacy.跨日状态,
    tags: rebuildTags(legacy.tags, {
      isPod, isReturned, returnInProgress, pendingDays: currentPendingDays,
      pendingContinuous: pending.continuous, ocDays: currentOcDays, cycleDays: currentCycleDays,
      inboundNoScan, storePending, storeOc
    })
  };
}

function sortEvents(events = []) {
  return (events || []).map((event, index) => ({ event: normalizeEvent(event), index }))
    .sort((a, b) => compareEvent(a.event, b.event) || a.index - b.index)
    .map(item => item.event);
}

function compareEvent(a = {}, b = {}) {
  for (const key of ['eventTime', 'creationDate', 'lastUpdateDate']) {
    const diff = String(a[key] || '').localeCompare(String(b[key] || ''));
    if (diff) return diff;
  }
  return numericId(a.id) - numericId(b.id);
}

function numericId(value) {
  const match = String(value ?? '').match(/\d+/g);
  return match ? Number(match.join('')) : 0;
}

function codeOf(event = {}) {
  return String(event?.eventCode ?? event?.trackingEventCode ?? '').trim();
}

function latestTerminal(events = []) {
  let found = null;
  for (const event of events) {
    const code = codeOf(event);
    if (code === TRACK.POD) found = { type: 'POD', event };
    if (code === TRACK.RETURN_COMPLETE) found = { type: 'RETURN_COMPLETED', event };
  }
  return found;
}

function pendingTail(events, last) {
  if (!last || codeOf(last) !== TRACK.PENDING) return { days: 0, dates: [], continuous: false };
  const tail = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (codeOf(events[index]) !== TRACK.PENDING) break;
    tail.push(events[index]);
  }
  const dates = distinctDates(tail);
  return { days: Math.max(1, dates.length), dates, continuous: consecutive(dates) };
}

function cycleTail(events, last, reportDate) {
  if (!last || !CYCLE_CODES.has(codeOf(last))) return { days: 0, dates: [] };
  const tail = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (!CYCLE_CODES.has(codeOf(events[index]))) break;
    tail.push(events[index]);
  }
  const dates = distinctDates(tail);
  const start = dates[0] || dateKey(last.eventTime);
  return { days: start ? elapsedInclusiveDays(start, reportDate || dateKey(last.eventTime)) : 1, dates };
}

function ocCurrent(events, last, reportDate) {
  if (!last || !isOcEvent(last)) return { active: false, days: 0, startTime: '' };
  const tail = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (!isOcEvent(events[index])) break;
    tail.push(events[index]);
  }
  const startTime = tail.at(-1)?.eventTime || last.eventTime || '';
  return { active: true, days: elapsedInclusiveDays(startTime, reportDate || dateKey(last.eventTime)), startTime };
}

function isOcEvent(event = {}) {
  return /(?:^|[^A-Z])OC(?:[^A-Z]|$)|Overdue|逾期|超时/i.test(eventText(event));
}

function distinctDates(events = []) {
  return [...new Set(events.map(event => dateKey(event.eventTime)).filter(Boolean))].sort();
}

function consecutive(dates = []) {
  if (dates.length <= 1) return true;
  return dates.every((date, index) => index === 0 || elapsedDays(dates[index - 1], date) === 1);
}

function rebuildTags(existing = [], s = {}) {
  const tags = (Array.isArray(existing) ? existing : []).filter(tag => !/^(POD|RETURN|PENDING|OC|CYCLE_COUNT|INBOUND_NO_SCAN|SHOP_PENDING|SHOP_OC)$/.test(String(tag || '')));
  if (s.isPod) tags.push('POD');
  if (s.isReturned) tags.push('RETURNED');
  if (s.returnInProgress) tags.push('RETURN_IN_PROGRESS');
  if (s.pendingDays) tags.push('PENDING', s.pendingDays >= 3 ? 'PENDING_3_PLUS' : `PENDING_${s.pendingDays}`);
  if (s.pendingDays >= 2) tags.push(s.pendingContinuous ? 'PENDING_CONTINUOUS' : 'PENDING_NON_CONTINUOUS');
  if (s.ocDays) tags.push('OC', s.ocDays >= 3 ? 'OC_3_PLUS' : `OC_${s.ocDays}_DAY`);
  if (s.cycleDays) tags.push('CYCLE_COUNT', s.cycleDays >= 3 ? 'CYCLE_3_PLUS' : `CYCLE_${s.cycleDays}_DAY`);
  if (s.inboundNoScan) tags.push('INBOUND_NO_SCAN');
  if (s.storePending) tags.push('SHOP_PENDING');
  if (s.storeOc) tags.push('SHOP_OC');
  return [...new Set(tags)];
}

function sanitizeLegacyCategory(category) {
  if (/^Pending|^OC|^盘点|^入库无扫描|^工单/.test(String(category || ''))) return '需人工复核';
  if (/POD|签收|退回/.test(String(category || ''))) return '需人工复核';
  return category || '需人工复核';
}

function eventText(event = {}) {
  return [event.eventCode, event.trackingEventCode, event.trackingEventDescZh, event.trackingEventDesc,
    event.trackingEventDescKm, event.remark, event.eventShop, event.locationCode, event.place]
    .map(value => String(value || '').trim()).filter(Boolean).join(' ');
}

function elapsedInclusiveDays(start, end) { return Math.max(1, elapsedDays(start, end) + 1); }
function elapsedDays(start, end) {
  const a = dayValue(start), b = dayValue(end);
  if (a === null || b === null) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000));
}
function dayValue(value) {
  const key = dateKey(value);
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function dateKey(value) {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
