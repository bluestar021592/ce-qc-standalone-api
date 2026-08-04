import { normalizeEvent } from './analyzer.js';
import { analyzeStoreFlow } from './storeFlow.js';

const PENDING_RE = /pending|派送失败|无法联系|无人接听|地址错误|改派/i;
const POD_RE = /\bPOD\b|delivered|签收|已妥投/i;
const RETURN_RE = /\breturn(?:ed)?\b|退回|返仓|退件/i;
const DELIVERY_ASSIGN_RE = /delivery\s*assign|派件分配|分配快递员|courier\s*assign/i;
const DELIVERY_RE = /(^|\s)delivery(\s|$)|派送中|out\s*for\s*delivery/i;
const OUTBOUND_RE = /(^|\s)outbound(\s|$)|出库|离开网点/i;
const INBOUND_RE = /pickup\s*inbound|(^|\s)inbound(\s|$)|入库|到仓|货物到达网点/i;
const CYCLE_COUNT_RE = /cycle\s*count|盘点/i;

export function analyzeShopeeShipment({
  waybill,
  scanRow = {},
  shipmentTrackRow = {},
  events = [],
  exceptions = [],
  reportDate = '',
  dailyRow = {},
  priorRow = {},
  apiStatus = {}
}) {
  const sorted = eventsThroughDate(events, reportDate);
  const exceptionRows = exceptionsThroughDate(exceptions, reportDate);
  const last = sorted.at(-1) || null;
  const lastText = eventText(last || {});
  const scanState = classifyShopeeScanStatus(shipmentTrackRow, scanRow);
  const podEvent = findLatest(sorted, isPodEvent);
  const returnEvent = findLatest(sorted, isReturnEvent);
  const isPod = scanState === 'POD' || Boolean(podEvent);
  const isReturned = !isPod && (scanState === 'RETURN' || Boolean(returnEvent));
  const apiFailed = ['shipment', 'event', 'exception'].some(key => apiStatus[key] === 'failed');

  const pending = analyzePendingCycles(sorted, reportDate, isPod, isReturned);
  const oc = analyzeOc(exceptionRows, sorted, reportDate, isPod, isReturned);
  const cycleCount = analyzeCycleCount(sorted);
  const deliveryEvent = findLatest(sorted, event => isDeliveryAssignEvent(event) || isDeliveryEvent(event));
  const deliveryDays = deliveryEvent && !isPod && !isReturned && (isDeliveryAssignEvent(last || {}) || isDeliveryEvent(last || {}))
    ? elapsedInclusiveDays(deliveryEvent.eventTime, reportDate)
    : 0;
  const staleDays = last ? elapsedDays(last.eventTime, reportDate) : 0;
  const completeForNegativeJudgment = !apiFailed && apiStatus.event !== 'failed' && apiStatus.exception !== 'failed';
  const inboundNoScan = Boolean(completeForNegativeJudgment && last && isInboundEvent(last)
    && !pending.activeDays && !oc.active && !deliveryDays && !isPod && !isReturned);
  const noTrack = Boolean(completeForNegativeJudgment && apiStatus.event === 'success' && !sorted.length);
  const region = classifyShopeeRegion({ dailyRow, shipmentTrackRow, scanRow, events: sorted });
  const returnPhoto = classifyReturnPhoto(returnEvent, apiFailed);
  const storeFlow = apiFailed
    ? priorStoreFlow(priorRow)
    : analyzeStoreFlow({ shipmentCode: waybill, events: sorted, reportDate, isPod, isReturned });

  let category = '其他已识别节点';
  if (isPod) category = 'POD';
  else if (isReturned) category = '退回';
  else if (apiFailed) category = priorRow.primaryCategory || priorRow.主分类 || priorRow.异常分类 || 'API失败待重试';
  else if (pending.returnRequired) category = pending.latestActionAfterThreshold === 'delivery' ? '三次Pending后继续派送' : '三次Pending后未退回';
  else if (oc.active) category = oc.days >= 3 ? 'OC3天及以上' : `OC${Math.max(1, oc.days)}天`;
  else if (pending.activeDays) category = pending.activeDays >= 3 ? 'Pending3次及以上' : `Pending${pending.activeDays}次`;
  else if (cycleCount.days) category = cycleCount.days >= 3 ? '盘点3天及以上' : `盘点${cycleCount.days}天`;
  else if (inboundNoScan) category = '入库无扫描节点';
  else if (deliveryDays) category = '派送中停留';
  else if (noTrack) category = '无轨迹';
  else if (staleDays > 0) category = '节点未更新';

  const tags = [...new Set([
    ...buildTags({ pending, oc, cycleCount, inboundNoScan: inboundNoScan && !storeFlow.shopState, deliveryDays, staleDays, noTrack, isReturned, returnPhoto, apiFailed, region }),
    ...(storeFlow.storeTags || [])
  ])];
  const currentPendingDays = pending.activeDays || (pending.returnRequired ? pending.maxDays : 0);
  const apiState = apiFailed ? '失败' : '成功';
  const queryState = apiFailed ? 'refresh_failed' : 'success';
  const closed = isPod || isReturned;
  const recipientSource = Object.keys(dailyRow || {}).length ? dailyRow : priorRow;

  return {
    ...priorRow,
    ...scanRow,
    businessType: 'SHOPEE',
    ...storeFlow,
    reportDate,
    shipmentCode: waybill,
    运单号: waybill,
    recipient_raw: recipientSource?.recipient_raw || '',
    recipient_normalized: recipientSource?.recipient_normalized || '',
    recipient_group: ['CN', 'VN', 'OTHER'].includes(String(recipientSource?.recipient_group || '').toUpperCase()) ? String(recipientSource.recipient_group).toUpperCase() : 'OTHER',
    recipient_group_reason: recipientSource?.recipient_group_reason || 'LEGACY_OR_UNRESOLVED',
    source_row_number: Number(recipientSource?.source_row_number || recipientSource?.rowNumber || 0),
    shipmentStatus: shipmentTrackRow?.shipmentStatus ?? shipmentTrackRow?.statusCode ?? scanRow?.shipmentStatus ?? '',
    扫描状态: scanState,
    是否POD: isPod ? '是' : '否',
    POD状态: isPod ? 'POD' : '未POD',
    POD时间: podEvent?.eventTime || (isPod ? shipmentTrackRow?.podTime || '' : ''),
    退回状态: isReturned ? '已退回' : '未退回',
    退回时间: returnEvent?.eventTime || '',
    退回照片状态: returnPhoto.status,
    退回照片数量: returnPhoto.count,
    Pending状态: currentPendingDays ? '是' : '否',
    Pending次数: currentPendingDays,
    Pending当前次数: pending.activeDays,
    Pending最大次数: pending.maxDays,
    Pending日期: pending.activeDates.join('、'),
    Pending全部日期: pending.allDates.join('、'),
    Pending连续性: pending.activeDays >= 2 ? (pending.activeContinuous ? '连续' : '不连续') : (currentPendingDays ? '单次' : '无'),
    Pending连续: pending.activeDays >= 2 && pending.activeContinuous ? '是' : '否',
    Pending不连续: pending.activeDays >= 2 && !pending.activeContinuous ? '是' : '否',
    returnRequired: pending.returnRequired,
    退回待处理: pending.returnRequired ? '是' : '否',
    退回待处理时间: pending.returnRequiredAt,
    OC状态: oc.active ? '是' : '否',
    OC次数: oc.items.length,
    OC天数: oc.active ? oc.days : 0,
    OC最大天数: Math.max(Number(priorRow.OC最大天数 || 0), oc.days),
    OC开始时间: oc.startTime,
    OC结束原因: oc.closeReason,
    盘点状态: cycleCount.days ? '是' : '否',
    盘点次数: cycleCount.eventCount,
    盘点天数: cycleCount.days,
    盘点日期: cycleCount.dates.join('、'),
    派送中停留天数: deliveryDays,
    节点未更新天数: staleDays,
    入库无扫描节点: inboundNoScan ? '是' : '否',
    无轨迹: noTrack ? '是' : '否',
    regionType: region.regionType,
    regionCode: region.regionCode,
    regionSource: region.regionSource,
    区域: region.regionCode,
    primaryCategory: category,
    主分类: category,
    异常分类: category,
    tags,
    API状态: apiState,
    查询状态: queryState,
    apiStatus: { shipment: apiStatus.shipment || '', event: apiStatus.event || '', exception: apiStatus.exception || '' },
    carry状态: closed ? (isPod ? 'closed_pod' : 'closed_return') : 'active',
    跨日状态: closed ? '已闭环' : (scanRow?.来源类型 === '旧跨日' ? '跨日续查' : '当日'),
    latestEventTime: last?.eventTime || priorRow.latestEventTime || '',
    latestEventDesc: last ? eventText(last) : (priorRow.latestEventDesc || ''),
    latestNode: last?.place || last?.eventShop || last?.locationCode || last?.trackingEventDescZh || priorRow.latestNode || '',
    最后节点时间: last?.eventTime || priorRow.最后节点时间 || '',
    最后节点: last ? eventText(last) : (priorRow.最后节点 || ''),
    lastCheckedAt: new Date().toISOString(),
    轨迹节点数: sorted.length,
    问题件数量: exceptionRows.length,
    QC判断: isPod ? 'SHOPEE包裹已POD' : (isReturned ? `SHOPEE包裹已退回，${returnPhoto.label}` : (apiFailed ? `${category}；API失败待重试，保留跨日续查` : category))
  };
}

function priorStoreFlow(row = {}) {
  return {
    targetShopCode: row.targetShopCode || '', currentShopCode: row.currentShopCode || '',
    shopName: row.shopName || '', shopCycleId: row.shopCycleId || '',
    shopTransferStartedAt: row.shopTransferStartedAt || '', shopArrivedAt: row.shopArrivedAt || '',
    shopLastEventAt: row.shopLastEventAt || '', shopPendingAt: row.shopPendingAt || '',
    shopRetentionNaturalDays: Number(row.shopRetentionNaturalDays || 0), shopState: row.shopState || '',
    shopStateReason: row.shopStateReason || 'API_FAILED_PRESERVED', whitelistVersion: row.whitelistVersion || '',
    storeTags: Array.isArray(row.storeTags) ? row.storeTags : []
  };
}

export function classifyShopeeScanStatus(shipmentTrackRow = {}, scanRow = {}) {
  const status = String(shipmentTrackRow?.shipmentStatus ?? shipmentTrackRow?.statusCode ?? scanRow?.shipmentStatus ?? scanRow?.orderStatus ?? '').trim();
  const text = [
    shipmentTrackRow?.shipmentStatusDesc, shipmentTrackRow?.statusDesc, shipmentTrackRow?.statusName,
    shipmentTrackRow?.trackingStatus, scanRow?.扫描分类, scanRow?.statusText
  ].map(value => String(value || '')).join(' ');
  if (String(scanRow?.orderStatus ?? '') === '85' || POD_RE.test(text)) return 'POD';
  if (status === '81' || RETURN_RE.test(text)) return 'RETURN';
  if (status === '30' || DELIVERY_ASSIGN_RE.test(text)) return 'DELIVERY_ASSIGN';
  if (DELIVERY_RE.test(text)) return 'DELIVERY';
  return 'UNKNOWN';
}

export function classifyShopeeRegion({ dailyRow = {}, shipmentTrackRow = {}, scanRow = {}, events = [] } = {}) {
  const sources = [
    ['daily', dailyRow?.raw || dailyRow],
    ['shipmentTrack', shipmentTrackRow],
    ['scan', scanRow],
    ['event', events]
  ];
  for (const [source, value] of sources) {
    const code = findRegionCode(value);
    if (code) return { regionType: code.startsWith('PP') ? 'PHNOM_PENH' : 'PROVINCE', regionCode: code, regionSource: source };
  }
  const province = findNamedValue([dailyRow?.raw || dailyRow, shipmentTrackRow, scanRow], /dest.*province|province|省|区域/i);
  if (/\bPNH\b|phnom\s*penh|金边/i.test(province)) return { regionType: 'PHNOM_PENH', regionCode: 'PP', regionSource: 'destProvince' };
  return { regionType: 'UNKNOWN', regionCode: 'UNKNOWN', regionSource: 'unresolved' };
}

function analyzePendingCycles(events, reportDate, isPod, isReturned) {
  const cycles = [];
  let activeDates = [];
  let thresholdAt = '';
  let latestActionAfterThreshold = '';
  for (const event of events) {
    const date = dateKey(event.eventTime);
    if (isPendingEvent(event)) {
      if (date && !activeDates.includes(date)) activeDates.push(date);
      if (!thresholdAt && longestConsecutive(activeDates) >= 3) thresholdAt = date;
      continue;
    }
    if (isPodEvent(event) || isReturnEvent(event)) {
      if (activeDates.length) cycles.push(activeDates);
      activeDates = [];
      latestActionAfterThreshold = isPodEvent(event) ? 'pod' : 'return';
      continue;
    }
    if (isDeliveryAssignEvent(event) || isDeliveryEvent(event) || isOutboundEvent(event)) {
      if (activeDates.length) cycles.push(activeDates);
      if (thresholdAt) latestActionAfterThreshold = 'delivery';
      activeDates = [];
    }
  }
  if (activeDates.length) cycles.push(activeDates);
  const allDates = [...new Set(cycles.flat())].sort();
  const maxDays = Math.max(0, ...cycles.map(dates => longestConsecutive(dates)));
  const finalActiveDates = activeDates.slice().sort();
  const returnRequired = maxDays >= 3 && !isPod && !isReturned;
  if (returnRequired && !thresholdAt) thresholdAt = dateForConsecutiveThreshold(cycles);
  return {
    cycles,
    allDates,
    activeDates: finalActiveDates,
    activeDays: finalActiveDates.length,
    activeContinuous: finalActiveDates.length <= 1 || longestConsecutive(finalActiveDates) === finalActiveDates.length,
    maxDays,
    returnRequired,
    returnRequiredAt: returnRequired ? thresholdAt : '',
    latestActionAfterThreshold: returnRequired ? latestActionAfterThreshold : ''
  };
}

function analyzeOc(items, events, reportDate, isPod, isReturned) {
  const ocItems = items.filter(isOcItem).sort((a, b) => String(a.reportTime || '').localeCompare(String(b.reportTime || '')));
  if (!ocItems.length) return { active: false, days: 0, items: [], startTime: '', closeReason: '' };
  const startTime = ocItems[0].reportTime || '';
  const laterEvents = events.filter(event => String(event.eventTime || '') > String(startTime));
  if (isPod || laterEvents.some(isPodEvent)) return { active: false, days: 0, items: ocItems, startTime, closeReason: 'POD_CLOSED' };
  if (isReturned || laterEvents.some(isReturnEvent)) return { active: false, days: 0, items: ocItems, startTime, closeReason: 'RETURN_CLOSED' };
  if (laterEvents.some(isPendingEvent)) return { active: false, days: 0, items: ocItems, startTime, closeReason: 'STATE_CHANGED_TO_PENDING' };
  return { active: true, days: elapsedInclusiveDays(startTime, reportDate), items: ocItems, startTime, closeReason: '' };
}

function analyzeCycleCount(events) {
  const matchingEvents = events.filter(isCycleCountEvent);
  const dates = [...new Set(matchingEvents.map(event => dateKey(event.eventTime)).filter(Boolean))].sort();
  return { eventCount: matchingEvents.length, days: dates.length, dates };
}

function classifyReturnPhoto(event, apiFailed) {
  if (apiFailed) return { status: '待核验', count: 0, label: '照片待核验' };
  if (!event) return { status: '不适用', count: 0, label: '非退回件' };
  const pictures = Array.isArray(event.pictureUrls) ? event.pictureUrls.filter(Boolean) : String(event.pictureUrls || '').split(',').map(value => value.trim()).filter(Boolean);
  return pictures.length
    ? { status: '有照片', count: pictures.length, label: '退回有照片' }
    : { status: '无照片', count: 0, label: '退回无照片' };
}

function buildTags({ pending, oc, cycleCount, inboundNoScan, deliveryDays, staleDays, noTrack, isReturned, returnPhoto, apiFailed, region }) {
  const tags = [];
  const pendingDays = pending.activeDays || (pending.returnRequired ? pending.maxDays : 0);
  if (pendingDays === 1) tags.push('PENDING_1');
  if (pendingDays === 2) tags.push('PENDING_2');
  if (pendingDays >= 3) tags.push('PENDING_3_PLUS');
  if (pending.activeDays >= 2 && pending.activeContinuous) tags.push('PENDING_CONTINUOUS');
  if (pending.activeDays >= 2 && !pending.activeContinuous) tags.push('PENDING_NON_CONTINUOUS');
  if (pending.returnRequired) tags.push('RETURN_REQUIRED');
  if (oc.active && oc.days === 1) tags.push('OC_1_DAY');
  if (oc.active && oc.days === 2) tags.push('OC_2_DAY');
  if (oc.active && oc.days >= 3) tags.push('OC_3_PLUS');
  if (oc.closeReason) tags.push(oc.closeReason);
  if (cycleCount.days === 1) tags.push('CYCLE_1_DAY');
  if (cycleCount.days === 2) tags.push('CYCLE_2_DAY');
  if (cycleCount.days >= 3) tags.push('CYCLE_3_PLUS');
  if (inboundNoScan) tags.push('INBOUND_NO_SCAN');
  if (deliveryDays) tags.push('DELIVERY_STAY');
  if (staleDays > 0) tags.push('NODE_STALE');
  if (noTrack) tags.push('NO_TRACK');
  if (isReturned) tags.push('RETURNED', returnPhoto.status === '有照片' ? 'RETURN_PHOTO_OK' : 'RETURN_PHOTO_MISSING');
  if (apiFailed) tags.push('REFRESH_FAILED');
  tags.push(`REGION_${region.regionCode}`);
  return [...new Set(tags)];
}

function eventsThroughDate(events, reportDate) {
  return (events || [])
    .map(normalizeEvent)
    .filter(event => !reportDate || !dateKey(event.eventTime) || dateKey(event.eventTime) <= reportDate)
    .sort((a, b) => String(a.eventTime || '').localeCompare(String(b.eventTime || '')));
}

function exceptionsThroughDate(items, reportDate) {
  return (items || [])
    .filter(item => !reportDate || !dateKey(item?.reportTime || item?.lastUpdateDate) || dateKey(item?.reportTime || item?.lastUpdateDate) <= reportDate)
    .sort((a, b) => String(a?.reportTime || '').localeCompare(String(b?.reportTime || '')));
}

function isOcItem(item = {}) {
  return /(^|\s)oc($|\s)|overdue/i.test([item.exceptionDesc, item.exceptionType, item.reasonCode, item.reasonText].map(value => String(value || '')).join(' '));
}

function isPendingEvent(event = {}) { return PENDING_RE.test(eventText(event)) && !isReturnEvent(event); }
function isPodEvent(event = {}) { return POD_RE.test(eventText(event)); }
function isReturnEvent(event = {}) { return String(event.eventCode || event.statusCode || '') === '81' || RETURN_RE.test(eventText(event)); }
function isDeliveryAssignEvent(event = {}) { return String(event.eventCode || event.statusCode || '') === '30' || DELIVERY_ASSIGN_RE.test(eventText(event)); }
function isDeliveryEvent(event = {}) { return DELIVERY_RE.test(eventText(event)) && !isDeliveryAssignEvent(event); }
function isOutboundEvent(event = {}) { return OUTBOUND_RE.test(eventText(event)); }
function isInboundEvent(event = {}) { return INBOUND_RE.test(eventText(event)); }
function isCycleCountEvent(event = {}) { return CYCLE_COUNT_RE.test(eventText(event)); }

function eventText(event = {}) {
  return [event.eventCode, event.trackingEventCode, event.trackingEventDesc, event.trackingEventDescZh, event.trackingEventDescKm, event.place, event.locationCode, event.eventShop]
    .map(value => String(value || '')).join(' ');
}

function findLatest(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index])) return items[index];
  return null;
}

function longestConsecutive(dates = []) {
  const sorted = [...new Set(dates)].sort();
  let longest = sorted.length ? 1 : 0;
  let current = longest;
  for (let index = 1; index < sorted.length; index += 1) {
    current = elapsedDays(sorted[index - 1], sorted[index]) === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function dateForConsecutiveThreshold(cycles = []) {
  for (const dates of cycles) {
    const sorted = [...new Set(dates)].sort();
    let current = 1;
    for (let index = 1; index < sorted.length; index += 1) {
      current = elapsedDays(sorted[index - 1], sorted[index]) === 1 ? current + 1 : 1;
      if (current >= 3) return sorted[index];
    }
  }
  return '';
}

function elapsedInclusiveDays(start, end) {
  if (!dateKey(start) || !dateKey(end)) return 1;
  return Math.max(1, elapsedDays(start, end) + 1);
}

function elapsedDays(start, end) {
  const a = dateValue(start);
  const b = dateValue(end);
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

function findRegionCode(value) {
  const text = flattenText(value);
  const match = text.match(/(?:^|[^A-Z0-9])((?:PP|PV)\d*)(?=$|[^A-Z0-9])/i);
  return match ? match[1].toUpperCase() : '';
}

function findNamedValue(objects, keyPattern) {
  for (const object of objects) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) continue;
    for (const [key, value] of Object.entries(object)) if (keyPattern.test(key)) return String(value || '');
  }
  return '';
}

function flattenText(value) {
  if (Array.isArray(value)) return value.map(flattenText).join(' ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key} ${flattenText(item)}`).join(' ');
  return String(value || '');
}
