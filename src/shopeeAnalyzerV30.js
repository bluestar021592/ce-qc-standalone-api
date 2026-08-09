import { normalizeEvent } from './analyzer.js';
import { analyzeStoreFlow } from './storeFlow.js';
import { classifyLatestSpecialNode } from './specialNode.js';
import {
  analyzeShopeeShipment as analyzeShopeeShipmentV29,
  classifyShopeeRegion
} from './shopeeAnalyzerV29.js';
import { classifyScanTerminal } from './scanTerminal.js';

export const SHOPEE_ANALYSIS_RULE_VERSION = '2026-08-09-scan-track-code-separation-v30';

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
const BUSINESS_PROGRESS_CODES = new Set([
  TRACK.INBOUND_NO_SCAN,
  TRACK.CYCLE_A,
  TRACK.CYCLE_B,
  TRACK.WORK_ORDER,
  TRACK.PENDING,
  TRACK.POD,
  TRACK.RETURN_START,
  TRACK.RETURN_COMPLETE
]);

/**
 * SHOPEE V30 deliberately keeps scan orderStatus and trajectory eventCode in
 * separate layers. V29 remains the evidence/enrichment engine; this wrapper
 * corrects the authoritative current-state fields from the locked numeric codes.
 */
export function analyzeShopeeShipment(args = {}) {
  const {
    waybill = '', scanRow = {}, shipmentTrackRow = {}, events = [], exceptions = [],
    reportDate = '', analysisDate = currentCambodiaDate(), dailyRow = {}, apiStatus = {}
  } = args;

  const base = analyzeShopeeShipmentV29(args);
  const effectiveDate = dateKey(analysisDate) || currentCambodiaDate();
  const sorted = sortEvents(events, effectiveDate);
  const latest = sorted.at(-1) || null;
  const latestCode = trackCode(latest);
  const scanRequestStatus = ['failed', 'scan_retry'].includes(String(apiStatus.shipment || '').toLowerCase()) ? 'failed' : 'success';
  const scanGate = classifyScanTerminal({ shipmentCode: waybill || scanRow.shipmentCode || scanRow.运单号, orderStatus: scanRow.orderStatus }, scanRequestStatus);

  const exactTerminal = latestExactTerminal(sorted);
  const isPod = scanGate.currentState === 'POD' || exactTerminal?.type === 'POD';
  const isReturned = !isPod && (scanGate.currentState === 'RETURN_COMPLETED' || exactTerminal?.type === 'RETURN_COMPLETED');
  const returnInProgress = !isPod && !isReturned && latestCode === TRACK.RETURN_START;

  const storeFlow = analyzeStoreFlow({
    shipmentCode: waybill,
    events: sorted,
    reportDate: effectiveDate,
    isPod,
    isReturned
  });
  const special = !isPod && !isReturned ? classifyLatestSpecialNode(sorted) : null;
  const region = classifyShopeeRegion({ dailyRow, shipmentTrackRow, scanRow, events: sorted });
  const pending = exactPendingState(sorted);
  const cycle = exactCycleState(sorted, effectiveDate);
  const oc = exactOcState(exceptions, sorted, effectiveDate, isPod || isReturned);

  // A new numeric 150 at a currently arrived shop is a shop-side Pending node.
  // It is valid progress and therefore resets the shop no-update retention clock.
  const storePending = !isPod && !isReturned && storeFlow.shopState === 'SHOP_ARRIVED_CURRENT' && latestCode === TRACK.PENDING;
  const correctedStoreFlow = storePending
    ? {
        ...storeFlow,
        shopLastEventAt: latest?.eventTime || storeFlow.shopLastEventAt || '',
        shopPendingAt: latest?.eventTime || storeFlow.shopPendingAt || '',
        shopRetentionNaturalDays: 1,
        storeTags: unique([...(storeFlow.storeTags || []), 'SHOP_PENDING'])
      }
    : storeFlow;

  let category = sanitizeLegacyCategory(base.primaryCategory || base.主分类 || base.异常分类 || '其他已识别节点');
  let currentState = base.currentState || scanGate.currentState;
  let qc = base.QC判断 || category;

  if (isPod) {
    category = 'POD';
    currentState = 'POD';
    qc = 'SHOPEE包裹已POD，正常闭环';
  } else if (isReturned) {
    category = '退回';
    currentState = 'RETURN_COMPLETED';
    qc = 'SHOPEE包裹已退回，正常闭环';
  } else if (returnInProgress) {
    category = '退回处理中';
    currentState = 'RETURN_IN_PROGRESS';
    qc = 'SHOPEE包裹正在退回，继续追踪至86退回闭环；不计普通遗留异常';
  } else if (special) {
    category = special.category;
    currentState = special.specialState || 'SPECIAL_NORMAL';
    qc = `${category}，按特殊正常去向监管`;
  } else if (correctedStoreFlow.shopState === 'SHOP_ARRIVED_CURRENT') {
    if (oc.active) {
      category = '门店OC';
      currentState = 'SHOP_OC';
      qc = '包裹当前位于门店，最新OC按门店状态监管，不并入普通Pending/入库无扫描';
    } else if (storePending) {
      category = '门店Pending';
      currentState = 'SHOP_PENDING';
      qc = '包裹当前位于门店且最新节点为150 Pending，按门店Pending监管';
    } else {
      category = Number(correctedStoreFlow.shopRetentionNaturalDays || 0) >= 2 ? '门店滞留' : '门店入库';
      currentState = Number(correctedStoreFlow.shopRetentionNaturalDays || 0) >= 2 ? 'SHOP_RETENTION' : 'SHOP_ARRIVED_CURRENT';
      qc = category === '门店滞留' ? '包裹当前停留在门店，按门店无新节点时长监管' : '包裹已到门店，当前正常门店流转';
    }
  } else if (correctedStoreFlow.shopState === 'SHOP_TRANSFER_IN_PROGRESS') {
    category = Number(correctedStoreFlow.shopRetentionNaturalDays || 0) >= 2 ? '门店途中2天+' : '门店途中';
    currentState = 'SHOP_TRANSFER_IN_PROGRESS';
  } else if (oc.active) {
    category = oc.days >= 3 ? 'OC3天及以上' : `OC${Math.max(1, oc.days)}天`;
    currentState = 'OC';
  } else if (latestCode === TRACK.PENDING) {
    const days = Math.max(1, pending.activeDays);
    category = days >= 3 ? 'Pending3次及以上' : `Pending${days}次`;
    currentState = 'PENDING';
  } else if (CYCLE_CODES.has(latestCode)) {
    category = cycle.days >= 3 ? '盘点3天及以上' : `盘点${Math.max(1, cycle.days)}天`;
    currentState = 'CYCLE_COUNT';
  } else if (latestCode === TRACK.WORK_ORDER) {
    category = '工单状态';
    currentState = 'WORK_ORDER';
  } else if (latestCode === TRACK.INBOUND_NO_SCAN) {
    category = '入库无扫描节点';
    currentState = 'INBOUND_NO_SCAN';
  } else if (latest && BUSINESS_PROGRESS_CODES.has(latestCode)) {
    currentState = `TRACK_${latestCode}`;
  }

  const terminal = isPod || isReturned;
  const currentPending = !terminal && !returnInProgress && !special && !correctedStoreFlow.shopState && latestCode === TRACK.PENDING
    ? pending.activeDays : 0;
  const allPendingDates = exactPendingAllDates(sorted);
  const pendingContinuity = currentPending >= 2 ? (pending.continuous ? '连续' : '不连续') : (currentPending ? '单次' : '无');
  const cycleDays = !terminal && !returnInProgress && CYCLE_CODES.has(latestCode) ? cycle.days : 0;
  const inboundNoScan = !terminal && !returnInProgress && !special && !correctedStoreFlow.shopState && latestCode === TRACK.INBOUND_NO_SCAN;

  const tags = terminal
    ? unique([isPod ? 'POD' : 'RETURNED', `REGION_${region.regionCode}`])
    : rebuildTags(base.tags, {
        pendingDays: currentPending,
        pendingContinuous: pending.continuous,
        oc,
        cycleDays,
        inboundNoScan,
        returnInProgress,
        storePending,
        regionCode: region.regionCode
      });

  return {
    ...base,
    ...correctedStoreFlow,
    businessType: 'SHOPEE',
    analysisRuleVersion: SHOPEE_ANALYSIS_RULE_VERSION,
    scanNormalizedState: scanGate.currentState,
    scanTerminalType: scanGate.scanTerminalType,
    scanTerminalReason: scanGate.scanTerminalReason,
    trackRequired: terminal ? false : true,
    trackSkippedReason: terminal ? (isPod ? 'POD_COMPLETED' : 'RETURN_COMPLETED') : '',
    扫描状态: classifyShopeeScanStatus(shipmentTrackRow, scanRow),
    是否POD: isPod ? '是' : '否',
    POD状态: isPod ? 'POD' : '未POD',
    POD时间: isPod ? (exactTerminal?.event?.eventTime || base.POD时间 || '') : '',
    currentState,
    退回状态: isReturned ? '已退回' : (returnInProgress ? '退回处理中' : '未退回'),
    退回开始时间: returnInProgress ? (latest?.eventTime || '') : (base.退回开始时间 || ''),
    退回完成时间: isReturned ? (exactTerminal?.event?.eventTime || base.退回完成时间 || '') : '',
    退回时间: isReturned ? (exactTerminal?.event?.eventTime || base.退回时间 || '') : '',
    Pending状态: currentPending ? '是' : (storePending ? '门店Pending' : '否'),
    Pending次数: currentPending,
    Pending当前次数: currentPending,
    Pending日期: currentPending ? pending.activeDates.join('、') : '',
    Pending全部日期: allPendingDates.join('、'),
    pendingRawEventCount: sorted.filter(event => trackCode(event) === TRACK.PENDING).length,
    pendingDistinctDayCount: allPendingDates.length,
    pendingDates: allPendingDates,
    Pending连续性: pendingContinuity,
    pendingContinuity,
    Pending连续: currentPending >= 2 && pending.continuous ? '是' : '否',
    Pending不连续: currentPending >= 2 && !pending.continuous ? '是' : '否',
    returnRequired: currentPending >= 3,
    退回待处理: currentPending >= 3 ? '是' : '否',
    OC状态: oc.active && !terminal && !returnInProgress ? '是' : '否',
    OC天数: oc.active && !terminal && !returnInProgress ? oc.days : 0,
    OC开始时间: oc.active ? oc.startTime : '',
    OC结束原因: oc.closeReason,
    盘点状态: cycleDays ? '是' : '否',
    盘点天数: cycleDays,
    盘点日期: cycleDays ? cycle.dates.join('、') : '',
    入库无扫描节点: inboundNoScan ? '是' : '否',
    regionType: region.regionType,
    regionCode: region.regionCode,
    regionSource: region.regionSource,
    区域: region.regionCode,
    pvOpenDisposition: correctedPvDisposition({ base, region, storeFlow: correctedStoreFlow, currentState, terminal }),
    primaryCategory: category,
    主分类: category,
    异常分类: category,
    tags,
    latestEventTime: latest?.eventTime || base.latestEventTime || '',
    latestEventDesc: latest ? eventText(latest) : (base.latestEventDesc || ''),
    latestTrackStatusCode: latestCode,
    最后节点时间: latest?.eventTime || base.最后节点时间 || '',
    最后节点: latest ? eventText(latest) : (base.最后节点 || ''),
    carry状态: isPod ? 'closed_pod' : (isReturned ? 'closed_return' : (returnInProgress ? 'active_return' : base.carry状态 || 'active')),
    跨日状态: terminal ? '已闭环' : base.跨日状态,
    QC判断: qc
  };
}

export function classifyShopeeScanStatus(_shipmentTrackRow = {}, scanRow = {}) {
  const row = {
    shipmentCode: scanRow.shipmentCode || scanRow.运单号 || scanRow.waybill || 'SCAN_STATUS_ONLY',
    orderStatus: scanRow.orderStatus
  };
  const terminal = classifyScanTerminal(row, 'success');
  if (terminal.currentState === 'POD') return 'POD';
  if (terminal.currentState === 'RETURN_COMPLETED') return 'RETURN';
  const status = String(scanRow.orderStatus ?? '').trim();
  if (status === '50') return 'INBOUND';
  if (status === '60') return 'DELIVERY_ASSIGN';
  if (status === '70') return 'DELIVERY';
  return 'UNKNOWN';
}

export { classifyShopeeRegion };

function sortEvents(events, analysisDate) {
  return (events || [])
    .map((event, index) => ({ ...normalizeEvent(event), __index: index }))
    .filter(event => !analysisDate || !dateKey(event.eventTime) || dateKey(event.eventTime) <= analysisDate)
    .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)) || a.__index - b.__index)
    .map(({ __index, ...event }) => event);
}

function eventSortKey(event = {}) {
  return [event.eventTime, event.creationDate, event.lastUpdateDate, numericId(event.id)]
    .map(value => String(value || '').padStart(20, '0')).join('|');
}

function numericId(value) {
  const match = String(value ?? '').match(/\d+/g);
  return match ? Number(match.join('')) : 0;
}

function trackCode(event = {}) {
  return String(event.eventCode ?? event.trackingEventCode ?? event.statusCode ?? '').trim();
}

function latestExactTerminal(events = []) {
  const event = events.at(-1) || null;
  const code = trackCode(event || {});
  if (code === TRACK.POD) return { type: 'POD', event };
  if (code === TRACK.RETURN_COMPLETE) return { type: 'RETURN_COMPLETED', event };
  return null;
}

function exactPendingState(events) {
  if (!events.length || trackCode(events.at(-1)) !== TRACK.PENDING) {
    return { activeDays: 0, activeDates: [], continuous: false };
  }
  const active = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (trackCode(events[index]) !== TRACK.PENDING) break;
    active.push(events[index]);
  }
  const dates = unique(active.map(event => dateKey(event.eventTime)).filter(Boolean)).sort();
  return { activeDays: dates.length || 1, activeDates: dates, continuous: areConsecutive(dates) };
}

function exactPendingAllDates(events) {
  return unique(events.filter(event => trackCode(event) === TRACK.PENDING).map(event => dateKey(event.eventTime)).filter(Boolean)).sort();
}

function exactCycleState(events, analysisDate) {
  if (!events.length || !CYCLE_CODES.has(trackCode(events.at(-1)))) return { days: 0, dates: [] };
  const tail = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (!CYCLE_CODES.has(trackCode(events[index]))) break;
    tail.push(events[index]);
  }
  const dates = unique(tail.map(event => dateKey(event.eventTime)).filter(Boolean)).sort();
  const start = dates[0] || dateKey(events.at(-1)?.eventTime);
  return { days: start ? elapsedInclusiveDays(start, analysisDate) : 1, dates };
}

function exactOcState(items = [], events = [], analysisDate = '', terminal = false) {
  const ocItems = (items || []).filter(isOcItem).sort((a, b) => itemTime(a).localeCompare(itemTime(b)));
  if (!ocItems.length) return { active: false, days: 0, startTime: '', closeReason: '' };
  if (terminal) return { active: false, days: 0, startTime: '', closeReason: 'TERMINAL_CLOSED' };
  const latestEventTime = String(events.at(-1)?.eventTime || '');
  const activeItems = latestEventTime ? ocItems.filter(item => itemTime(item) > latestEventTime) : ocItems;
  if (!activeItems.length) return { active: false, days: 0, startTime: '', closeReason: 'STATE_CHANGED_BY_NEW_NODE' };
  const startTime = itemTime(activeItems[0]);
  return { active: true, days: elapsedInclusiveDays(startTime, analysisDate), startTime, closeReason: '' };
}

function isOcItem(item = {}) {
  const type = String(item.exceptionType || '').trim();
  if (['20', '30', '40'].includes(type)) return true;
  const text = [item.exceptionDesc, item.excepitonDesc, item.exceptionReason, item.exceptionChildReason, item.reasonCode, item.reasonText]
    .map(value => String(value || '')).join(' ');
  return /(^|\s)oc($|\s)|overdue/i.test(text);
}

function itemTime(item = {}) {
  return String(item.reportTime || item.lastUpdateDate || item.creationDate || '');
}

function correctedPvDisposition({ base, region, storeFlow, currentState, terminal }) {
  if (terminal || region.regionCode !== 'PV') return '';
  if (storeFlow.shopState === 'SHOP_ARRIVED_CURRENT') {
    return Number(storeFlow.shopRetentionNaturalDays || 0) >= 2 ? 'PV_STORE_RETENTION' : 'PV_STORE_NORMAL';
  }
  if (storeFlow.shopState === 'SHOP_TRANSFER_IN_PROGRESS') return 'PV_DELIVERY_IN_PROGRESS';
  if (currentState === 'PENDING' || currentState === 'OC' || currentState === 'WORK_ORDER' || currentState === 'CYCLE_COUNT') return 'PV_OTHER_PROGRESS';
  return base.pvOpenDisposition || 'PV_OTHER_PROGRESS';
}

function rebuildTags(existing = [], state = {}) {
  const remove = /^(PENDING_|OC_|CYCLE_|INBOUND_NO_SCAN|RETURNED|RETURN_PHOTO_|SEVERE_OVERDUE|NODE_STALE|REGION_)/;
  const tags = (Array.isArray(existing) ? existing : []).filter(tag => !remove.test(String(tag || '')));
  if (state.pendingDays === 1) tags.push('PENDING_1');
  if (state.pendingDays === 2) tags.push('PENDING_2');
  if (state.pendingDays >= 3) tags.push('PENDING_3_PLUS');
  if (state.pendingDays >= 2) tags.push(state.pendingContinuous ? 'PENDING_CONTINUOUS' : 'PENDING_NON_CONTINUOUS');
  if (state.oc?.active) tags.push(state.oc.days >= 3 ? 'OC_3_PLUS' : state.oc.days === 2 ? 'OC_2_DAY' : 'OC_1_DAY');
  if (state.cycleDays) tags.push(state.cycleDays >= 3 ? 'CYCLE_3_PLUS' : state.cycleDays === 2 ? 'CYCLE_2_DAY' : 'CYCLE_1_DAY');
  if (state.inboundNoScan) tags.push('INBOUND_NO_SCAN');
  if (state.returnInProgress) tags.push('RETURN_IN_PROGRESS');
  if (state.storePending) tags.push('SHOP_PENDING');
  if (state.regionCode) tags.push(`REGION_${state.regionCode}`);
  return unique(tags);
}

function sanitizeLegacyCategory(category) {
  if (/^Pending/i.test(category)) return '其他已识别节点';
  if (/^退回$|RETURN/i.test(category)) return '其他已识别节点';
  if (/入库无扫描|盘点|工单/.test(category)) return '其他已识别节点';
  return category || '其他已识别节点';
}

function eventText(event = {}) {
  return [event.eventCode, event.trackingEventCode, event.trackingEventDescZh, event.trackingEventDesc, event.trackingEventDescKm, event.place, event.locationCode, event.eventShop, event.remark]
    .map(value => String(value || '').trim()).filter(Boolean).join(' ');
}

function unique(values) { return [...new Set(values)]; }

function areConsecutive(dates) {
  if (dates.length <= 1) return true;
  for (let index = 1; index < dates.length; index += 1) {
    if (elapsedDays(dates[index - 1], dates[index]) !== 1) return false;
  }
  return true;
}

function elapsedInclusiveDays(start, end) {
  return Math.max(1, elapsedDays(start, end) + 1);
}

function elapsedDays(start, end) {
  const a = dateValue(start), b = dateValue(end);
  if (a === null || b === null) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

function dateValue(value) {
  const key = dateKey(value);
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateKey(value) {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function currentCambodiaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
