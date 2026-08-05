import {
  detectShopInfo,
  isNormalFinalHubArrival,
  lastEffectiveEvent,
  parseEventNodeAction
} from './shopCodes.js';
import { analyzeStoreFlow } from './storeFlow.js';
import { classifyLatestSpecialNode } from './specialNode.js';

const PENDING_RE = /Pending|PENDING|客户无人接听|客户电话错误|地址错误|改地址|客户要求改派|无人接听|无法联系|客户不在|电话错误|空号|联系不上|改派/i;
const IMAGE_ABNORMAL_STATUSES = new Set(['NO_IMAGE', 'IMAGE_FIELD_EMPTY', 'IMAGE_FIELD_INVALID']);

export function analyzeShipment({ waybill, scanRow = {}, events = [], shopCodeMap = null, reportDate = '' }) {
  const sorted = sortEventsStable(events);
  const last = lastEffectiveEvent(sorted);
  let podEvent = null;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (isPodEvent(sorted[index])) {
      podEvent = sorted[index];
      break;
    }
  }
  const isPod = String(scanRow?.orderStatus || '') === '85' || Boolean(podEvent);
  const storeFlow = analyzeStoreFlow({ shipmentCode: waybill, events: sorted, reportDate, isPod });
  const lastText = last ? eventText(last) : '';
  const pendingEvents = sorted.filter(isPendingEvent);
  const ocEvents = sorted.filter(isOcEvent);
  const cycleEvents = sorted.filter(e => isCycleEvent(e) && !isStoreCycleEvent(e));
  const assignEvents = sorted.filter(isAssignEvent);
  const deliveryEvents = sorted.filter(isDeliveryEvent);
  const pendingDates = uniqueDates(pendingEvents);
  const ocDates = uniqueDates(ocEvents);
  const cycleDates = uniqueDates(cycleEvents);
  const assignDates = uniqueDates(assignEvents);
  const deliveryDates = uniqueDates(deliveryEvents);
  const workOrder = analyzeWorkOrder(sorted);
  const stats = buildActionStats({
    events: sorted,
    pendingEvents,
    pendingDates,
    ocEvents,
    ocDates,
    cycleEvents,
    cycleDates,
    assignEvents,
    assignDates,
    deliveryEvents,
    deliveryDates,
    last,
    podEvent,
    reportDate
  });
  if (isPod && !stats.POD来源) stats.POD来源 = String(scanRow?.orderStatus || '') === '85' ? '订单扫描orderStatus=85' : 'POD识别';

  if (isPod) {
    return { ...baseResult({
      waybill,
      scanRow,
      events: sorted,
      category: 'POD闭环',
      judgment: stats.延迟POD === '是'
        ? '轨迹出现POD/签收节点，但POD日期早于日报归属日期，计入延迟POD/历史POD补锁'
        : (String(scanRow?.orderStatus || '') === '85' ? '订单扫描orderStatus=85，POD闭环' : '轨迹出现POD/签收节点，POD闭环'),
      isPod: true,
      lastNode: last ? eventText(last) : (podEvent ? eventText(podEvent) : '订单扫描orderStatus=85'),
      lastEvent: last || podEvent,
      counts: stats,
      evidence: {
        ...parseEventNodeAction(last || podEvent || {}),
        matchedRule: 'POD_PRIORITY'
      }
    }), ...storeFlow };
  }

  const special = classifyLatestSpecialNode(sorted);
  if (special) {
    const specialRow = baseResult({
      waybill, scanRow, events: sorted, category: special.category,
      judgment: `${special.label}，按最后有效轨迹判定并排除普通异常`, isPod: false,
      lastNode: special.latestTrackingDescription, lastEvent: special.event,
      evidence: { matchedRule: special.matchedRule, targetNode: special.latestNodeCode, actionType: special.specialState }
    });
    return { ...specialRow, ...special, primaryCategory: special.category, 主分类: special.category, 异常分类: special.category, 是否特殊节点: '是' };
  }

  const lastEvidence = parseEventNodeAction(last || {});
  const normalFinalHub = Boolean(last && isNormalFinalHubArrival(last));
  const shopInfo = normalFinalHub
    ? { isShop: false, ...lastEvidence, matchedRule: 'NORMAL_FINAL_HUB' }
    : enrichShopInfo(detectShopInfo({ events: sorted, lastEvent: last, shopCodeMap }), reportDate, last);

  let category = '需人工复核';
  let judgment = '未发现POD，需人工复核';

  if (normalFinalHub) {
    category = '正常分流节点';
    judgment = `最后有效节点为到达${lastEvidence.targetNode || '正常分流网点'}，排除门店和异常并停止明日续查`;
  } else if (shopInfo.isShop) {
    category = shopInfo.shopStatus;
    if (shopInfo.shopStatus === '门店入库') {
      judgment = `命中门店${shopInfo.shopCode || shopInfo.shopName}，已出现到达门店/门店入库节点`;
    } else if (shopInfo.shopStatus === '门店滞留') {
      judgment = `命中门店${shopInfo.shopCode || shopInfo.shopName}，到达门店后累计${shopInfo.shopStayDays || 0}天未POD`;
    } else {
      judgment = `命中门店${shopInfo.shopCode || shopInfo.shopName}，发现发往门店节点但未见到达门店/入库节点`;
    }
  } else if (pendingEvents.length >= 3) {
    category = 'Pending3次以上';
      judgment = `Pending累计${pendingEvents.length}次，${stats.Pending连续性 || '需复核原因真实性'}，图片状态：${stats.Pending图片状态 || '未识别'}`;
  } else if (pendingEvents.length === 2) {
    category = 'Pending2次';
      judgment = `Pending累计2次，图片状态：${stats.Pending图片状态 || '未识别'}`;
  } else if (pendingEvents.length === 1) {
    category = 'Pending1次';
      judgment = `Pending累计1次，图片状态：${stats.Pending图片状态 || '未识别'}`;
  } else if (ocDates.length >= 3) {
    category = 'OC3天以上';
    judgment = `OC累计${ocDates.length}天，需组长跟进`;
  } else if (ocDates.length === 2) {
    category = 'OC2天';
    judgment = 'OC累计2天，需组长跟进';
  } else if (ocDates.length === 1) {
    category = 'OC1天';
    judgment = 'OC累计1天，需关注';
  } else if (cycleDates.length >= 3) {
    category = '盘点3天以上';
    judgment = `CCSL相关盘点累计${cycleDates.length}天，需确认仓内状态`;
  } else if (cycleDates.length >= 2) {
    category = '盘点2天';
    judgment = 'CCSL相关盘点累计2天，需确认仓内状态';
  } else if (cycleDates.length === 1) {
    category = '盘点1天';
    judgment = 'CCSL相关盘点累计1天，需关注';
  } else if (deliveryDates.length >= 3) {
    category = '派送停留3天以上';
    judgment = `派送中累计${deliveryDates.length}天未POD`;
  } else if (deliveryDates.length === 2) {
    category = '派送停留2天';
    judgment = '派送中累计2天未POD';
  } else if (deliveryDates.length === 1) {
    category = '派送停留1天';
    judgment = '派送中累计1天未POD';
  } else if (assignDates.length >= 2) {
    category = '派件分配2天+';
    judgment = `派件分配累计${assignDates.length}天未POD`;
  } else if (!sorted.length) {
    category = '包裹无动作';
    judgment = '轨迹接口无返回，需人工复核';
  } else if (isInboundWithoutSubsequentAction(sorted)) {
    category = '入库无扫描';
    judgment = '已出现CCSL入库/到仓节点，且入库后没有Outbound、Pending、OC、盘点、派送、门店或POD等有效动作';
  } else if (stats.节点日期未更新 === '是') {
    category = '节点日期未更新';
    judgment = `最后节点日期早于日报日期${stats.节点未更新天数 || 0}天，需确认包裹是否无动作`;
  }

  if (category === 'éœ€äººå·¥å¤æ ¸' && workOrder.unprocessed) {
    category = '工单未处理';
    judgment = '存在明确工单事件，且工单后没有更晚的有效业务处理节点';
  }

  const result = baseResult({
    waybill,
    scanRow,
    events: sorted,
    category,
    judgment,
    isPod: false,
    lastNode: lastText,
    lastEvent: last,
    shopInfo,
    evidence: {
      ...lastEvidence,
      matchedRule: shopInfo.matchedRule || matchedRuleForCategory(category)
    },
    counts: {
      ...stats,
      pending: pendingDates.length,
      oc: ocDates.length,
      cycle: cycleDates.length,
      assign: assignDates.length,
      delivery: deliveryDates.length
    }
  });
  return { ...result, ...storeFlow, tags: [...new Set([...(result.tags || []), ...(storeFlow.storeTags || [])])] };
}

export function normalizeEvent(e) {
  return {
    ...e,
    shipmentCode: String(e?.shipmentCode || e?.运单号 || '').toUpperCase(),
    eventCode: String(e?.eventCode || ''),
    trackingEventCode: String(e?.trackingEventCode || ''),
    trackingEventDesc: e?.trackingEventDesc || '',
    trackingEventDescZh: e?.trackingEventDescZh || '',
    trackingEventDescKm: e?.trackingEventDescKm || '',
    eventTime: e?.eventTime || e?.creationDate || e?.lastUpdateDate || '',
    operator: e?.operator || '',
    eventCourier: e?.eventCourier || '',
    eventShop: e?.eventShop || e?.eventShopName || e?.shopName || '',
    locationCode: e?.locationCode || '',
    place: e?.place || '',
    rawJson: e?.rawJson || JSON.stringify(e || {})
  };
}

export function isPodEvent(e) {
  const code = String(e?.eventCode || e?.trackingEventCode || '');
  const t = eventText(e);
  return code === '80'
    || /POD|signed-off|signed off|delivered|Successfully delivered/i.test(t)
    || /签收|已签收|包裹已经被签收|签收成功/i.test(t);
}

function baseResult({ waybill, scanRow, events, category, judgment, isPod, lastNode, lastEvent, counts = {}, shopInfo = {}, evidence = {} }) {
  const summary = events.map(eventText).join(' || ');
  const targetNode = evidence.targetNode || evidence.lastEventTargetNode || shopInfo.targetNode || '';
  const actionType = evidence.actionType || evidence.lastEventActionType || shopInfo.actionType || '';
  const matchedRule = evidence.matchedRule || shopInfo.matchedRule || matchedRuleForCategory(category);
  const tags = [
    isPod ? 'POD' : '',
    shopInfo.isShop ? 'SHOP' : '',
    category === '正常分流节点' ? 'NORMAL_FINAL_HUB' : '',
    Number(counts.Pending次数 || counts.pendingEvents || counts.pending || 0) > 0 ? 'PENDING' : '',
    Number(counts.OC次数 || counts.ocEvents || counts.oc || 0) > 0 ? 'OC' : '',
    Number(counts.盘点次数 || counts.cycleEvents || counts.cycle || 0) > 0 ? 'CYCLE_COUNT' : '',
    Number(counts.assign || 0) > 0 ? 'ASSIGN' : '',
    Number(counts.delivery || 0) > 0 ? 'DELIVERING' : '',
    counts.节点日期未更新 === '是' ? 'STALE_NODE' : ''
  ].filter(Boolean);
  return {
    运单号: waybill,
    来源类型: scanRow?.来源类型 || '',
    是否POD: isPod ? '是' : '否',
    异常分类: category,
    primaryCategory: category,
    主分类: category,
    QC判断: judgment,
    qcConclusion: judgment,
    扫描分类: scanRow?.扫描分类 || '',
    orderStatus: scanRow?.orderStatus || '',
    最后节点: lastNode || '',
    最后节点时间: lastEvent?.eventTime || '',
    最后节点目标网点: targetNode,
    最后节点动作类型: actionType,
    lastEventTargetNode: targetNode,
    lastEventActionType: actionType,
    lastEventCode: String(lastEvent?.eventCode || lastEvent?.trackingEventCode || ''),
    lastEventDesc: lastEvent ? eventText(lastEvent) : '',
    matchedRule,
    命中规则: matchedRule,
    matchedShopCode: shopInfo.shopCode || '',
    matchedShopName: shopInfo.shopName || '',
    tags,
    Pending天数: counts.pending || 0,
    Pending次数: counts.Pending次数 || counts.pendingEvents || counts.pending || 0,
    Pending日期: counts.Pending日期 || '',
    Pending连续性: counts.Pending连续性 || '',
    Pending连续3天以上: counts.Pending连续3天以上 || '',
    Pending图片完整: counts.Pending图片完整 || '',
    Pending图片状态: counts.Pending图片状态 || '',
    Pending图片证据: counts.Pending图片证据 || '',
    Pending有图片次数: counts.Pending有图片次数 || 0,
    Pending无图片次数: counts.Pending无图片次数 || 0,
    需图片Pending次数: counts.需图片Pending次数 || 0,
    需图片Pending日期: counts.需图片Pending日期 || '',
    需图片Pending图片完整: counts.需图片Pending图片完整 || '',
    无需图片Pending次数: counts.无需图片Pending次数 || 0,
    最新Pending类型: counts.最新Pending类型 || '',
    最新Pending时间: counts.最新Pending时间 || '',
    最新Pending有图片: counts.最新Pending有图片 || '',
    最新Pending图片状态: counts.最新Pending图片状态 || '',
    OC天数: counts.oc || 0,
    OC次数: counts.OC次数 || counts.ocEvents || counts.oc || 0,
    OC日期: counts.OC日期 || '',
    OC连续性: counts.OC连续性 || '',
    盘点天数: counts.cycle || 0,
    盘点次数: counts.盘点次数 || counts.cycleEvents || counts.cycle || 0,
    盘点日期: counts.盘点日期 || '',
    盘点连续性: counts.盘点连续性 || '',
    派件分配天数: counts.assign || 0,
    派件分配日期: counts.派件分配日期 || '',
    派送中天数: counts.delivery || 0,
    派件中天数: counts.delivery || 0,
    派件中日期: counts.派件中日期 || '',
    图片数量: counts.图片数量 || 0,
    图片链接: counts.图片链接 || '',
    图片异常标记: counts.图片异常标记 || '',
    图片异常原因: counts.图片异常原因 || '',
    节点日期未更新: counts.节点日期未更新 || '',
    节点未更新天数: counts.节点未更新天数 || 0,
    包裹无动作: counts.包裹无动作 || '',
    延迟POD: counts.延迟POD || '',
    延迟POD天数: counts.延迟POD天数 || 0,
    POD来源: counts.POD来源 || '',
    POD时间: counts.POD时间 || '',
    轨迹节点数: events.length,
    快递员: lastEvent?.eventCourier || '',
    eventCourier: lastEvent?.eventCourier || '',
    pickupShop: scanRow?.pickupShop || '',
    deliveryShop: scanRow?.deliveryShop || '',
    eventShop: lastEvent?.eventShop || '',
    locationCode: lastEvent?.locationCode || '',
    productCode: scanRow?.productCode || '',
    customerName: scanRow?.customerName || '',
    门店编码: shopInfo.shopCode || '',
    门店名称: shopInfo.shopName || '',
    门店状态: shopInfo.shopStatus || '',
    门店动作类型: shopInfo.shopActionType || '',
    门店发往时间: shopInfo.outboundTime || '',
    门店入库时间: shopInfo.inboundTime || '',
    门店滞留天数: shopInfo.shopStayDays || 0,
    门店未更新天数: shopInfo.shopStayDays || 0,
    是否门店链路: shopInfo.isShop ? '是' : '',
    是否门店: shopInfo.isShop ? '是' : '否',
    TBKH门店包裹: String(waybill || '').toUpperCase().startsWith('TBKH') && shopInfo.isShop ? '是' : '',
    TBKH识别来源: String(waybill || '').toUpperCase().startsWith('TBKH') && shopInfo.isShop ? 'shipmentCode' : '',
    原始轨迹摘要: summary.slice(0, 1200)
  };
}

function buildActionStats({
  events,
  pendingEvents,
  pendingDates,
  ocEvents,
  ocDates,
  cycleEvents,
  cycleDates,
  assignEvents,
  assignDates,
  deliveryEvents,
  deliveryDates,
  last,
  podEvent,
  reportDate
}) {
  const latestPending = pendingEvents[pendingEvents.length - 1] || null;
  const pendingEvidence = pendingEvents.map(inspectImageEvidence);
  const pendingWithImage = pendingEvidence.filter(item => item.status === 'HAS_IMAGE').length;
  const pendingWithoutImage = Math.max(0, pendingEvents.length - pendingWithImage);
  const imageLinks = collectImageEvidence(events).slice(0, 30);
  const lastDate = dateOnly(last?.eventTime);
  const report = dateOnly(reportDate);
  const staleDays = report && lastDate && lastDate < report ? daysBetween(lastDate, report) : 0;
  const podDate = dateOnly(podEvent?.eventTime);
  const needImagePending = pendingEvents.filter(eventNeedsImage);
  const needImageWithImage = needImagePending.filter(hasEvidenceImage).length;
  const latestPendingEvidence = latestPending ? inspectImageEvidence(latestPending) : null;
  const pendingImageStatus = summarizePendingImageStatus(pendingEvidence);
  const pendingImageEvidence = pendingEvidence
    .flatMap(item => item.values || [])
    .slice(0, 20)
    .join(' | ');
  const hasImageAbnormal = pendingEvidence.some(item => IMAGE_ABNORMAL_STATUSES.has(item.status));

  return {
    pending: pendingDates.length,
    oc: ocDates.length,
    cycle: cycleDates.length,
    assign: assignDates.length,
    delivery: deliveryDates.length,
    pendingEvents: pendingEvents.length,
    Pending次数: pendingEvents.length,
    Pending日期: pendingDates.join(', '),
    Pending连续性: pendingDates.length ? (isConsecutive(pendingDates) ? '连续' : '不连续') : '',
    Pending连续3天以上: isConsecutive(pendingDates) ? '是' : '否',
    Pending图片完整: pendingEvents.length
      ? (pendingImageStatus === 'UNKNOWN_API_NO_FIELD' ? '无法判断' : (pendingWithImage === pendingEvents.length ? '是' : '否'))
      : '',
    Pending图片状态: pendingImageStatus,
    Pending图片证据: pendingImageStatus === 'UNKNOWN_API_NO_FIELD'
      ? 'API无图片字段，无法判断真实性'
      : pendingImageEvidence,
    Pending有图片次数: pendingWithImage,
    Pending无图片次数: pendingWithoutImage,
    需图片Pending次数: needImagePending.length,
    需图片Pending日期: uniqueDates(needImagePending).join(', '),
    需图片Pending图片完整: needImagePending.length ? (needImageWithImage === needImagePending.length ? '是' : '否') : '',
    无需图片Pending次数: Math.max(0, pendingEvents.length - needImagePending.length),
    最新Pending类型: latestPending ? pendingType(latestPending) : '',
    最新Pending时间: latestPending?.eventTime || '',
    最新Pending有图片: latestPending ? (latestPendingEvidence?.status === 'HAS_IMAGE' ? '是' : '否') : '',
    最新Pending图片状态: latestPendingEvidence?.status || '',
    OC次数: ocEvents.length,
    OC日期: ocDates.join(', '),
    OC连续性: ocDates.length ? (isConsecutiveLoose(ocDates) ? '连续' : '不连续') : '',
    盘点次数: cycleEvents.length,
    盘点日期: cycleDates.join(', '),
    盘点连续性: cycleDates.length ? (isConsecutiveLoose(cycleDates) ? '连续' : '不连续') : '',
    派件分配日期: assignDates.join(', '),
    派件中日期: deliveryDates.join(', '),
    图片数量: imageLinks.length,
    图片链接: imageLinks.join(' | '),
    图片异常标记: hasImageAbnormal ? '是' : '',
    图片异常原因: pendingEvents.length && pendingWithImage < pendingEvents.length
      ? pendingImageStatus === 'UNKNOWN_API_NO_FIELD'
        ? 'API无图片字段，无法判断真实性'
        : `Pending节点${pendingEvents.length}次，缺少有效图片证据${pendingEvents.length - pendingWithImage}次，状态${pendingImageStatus}`
      : '',
    节点日期未更新: staleDays > 0 ? '是' : '否',
    节点未更新天数: staleDays,
    包裹无动作: events.length ? '否' : '是',
    延迟POD: report && podDate && podDate < report ? '是' : '否',
    延迟POD天数: report && podDate && podDate < report ? daysBetween(podDate, report) : 0,
    POD来源: podEvent ? '轨迹POD' : '',
    POD时间: podEvent?.eventTime || ''
  };
}

function enrichShopInfo(shopInfo = {}, reportDate = '', lastEvent = null) {
  if (!shopInfo.isShop) return shopInfo;
  const report = dateOnly(reportDate);
  const inboundDate = dateOnly(shopInfo.inboundTime);
  const outboundDate = dateOnly(shopInfo.outboundTime);
  const lastDate = dateOnly(lastEvent?.eventTime) || report;
  let shopStatus = shopInfo.shopStatus || '门店途中';
  let shopStayDays = 0;

  if (inboundDate) {
    const compareDate = report || lastDate || inboundDate;
    shopStayDays = Math.max(1, daysBetween(inboundDate, compareDate) + 1);
    shopStatus = shopStayDays >= 2 ? '门店滞留' : '门店入库';
  } else if (outboundDate) {
    const compareDate = report || lastDate || outboundDate;
    shopStayDays = Math.max(1, daysBetween(outboundDate, compareDate) + 1);
    shopStatus = '门店途中';
  }

  return {
    ...shopInfo,
    shopStatus,
    shopActionType: inboundDate ? '门店入库' : '门店途中',
    shopStayDays
  };
}

function analyzeWorkOrder(events = []) {
  const evidence = events.filter(isExplicitWorkOrderEvent);
  if (!evidence.length) return { hasHistory: false, unprocessed: false, firstAt: '', lastAt: '', resolvedAt: '', evidence: '' };
  const lastOrder = evidence[evidence.length - 1];
  const laterAction = events.find(event => String(event.eventTime || '') > String(lastOrder.eventTime || '') && isEffectiveBusinessAction(event));
  return {
    hasHistory: true,
    unprocessed: !laterAction,
    firstAt: evidence[0]?.eventTime || '',
    lastAt: lastOrder?.eventTime || '',
    resolvedAt: laterAction?.eventTime || '',
    evidence: evidence.map(event => `${event.eventTime || ''} ${event.trackingEventDescZh || event.trackingEventDesc || event.eventCode || ''}`.trim()).join(' | ').slice(0, 1000)
  };
}

function isExplicitWorkOrderEvent(event = {}) {
  const code = String(event.eventCode || event.trackingEventCode || '').toUpperCase();
  const text = [event.trackingEventDescZh, event.trackingEventDesc, event.trackingEventDescKm, event.remark, event.exceptionType, event.exceptionDesc].map(value => String(value || '')).join(' ');
  return /WORK[_ -]?ORDER|WORKORDER|工单|催派送工单|工单编号|工单创建|工单关闭|工单处理/i.test(`${code} ${text}`);
}

function isEffectiveBusinessAction(event = {}) {
  return isPodEvent(event) || isPendingEvent(event) || isOcEvent(event) || isCycleEvent(event) || isAssignEvent(event) || isDeliveryEvent(event) || isCcslInboundEvent(event) || /\bOutbound\b|货物离开网点|退回|Return/i.test(eventText(event));
}

function eventText(e) {
  return [
    e?.eventTime,
    e?.eventCode,
    e?.trackingEventCode,
    e?.trackingEventDescZh,
    e?.trackingEventDesc,
    e?.trackingEventDescKm,
    e?.remark,
    e?.eventShop,
    e?.locationCode,
    e?.place,
    e?.operator,
    e?.eventCourier,
    e?.rawJson
  ].map(x => String(x || '').trim()).filter(Boolean).join(' ');
}

function isPendingEvent(e) {
  const code = String(e?.eventCode || e?.trackingEventCode || '');
  return code === '150' || PENDING_RE.test(eventText(e));
}

function isOcEvent(e) {
  return /(?:^|[^A-Z])OC(?:[^A-Z]|$)|Overdue|逾期|超时/i.test(eventText(e));
}

function isCycleEvent(e) {
  const code = String(e?.eventCode || e?.trackingEventCode || '');
  return code === '32' || /Cycle Count|盘点/i.test(eventText(e));
}

function isStoreCycleEvent(e) {
  const t = eventText(e);
  return /CP\s*Cycle Count/i.test(t) && /门店|PT\s*Shop|CE\s*Shop|\bShop\b/i.test(t) && !/\bCCSL\b/i.test(t);
}

function isAssignEvent(e) {
  const code = String(e?.eventCode || e?.trackingEventCode || '');
  return code === '60' || /Assigning courier|派件分配|即将为您派送/i.test(eventText(e));
}

function isDeliveryEvent(e) {
  const code = String(e?.eventCode || e?.trackingEventCode || '');
  return code === '70' || /Parcel start to deliver|派送中|正在为您派送/i.test(eventText(e));
}

function isInboundWithoutSubsequentAction(events = []) {
  let inboundIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    if (isCcslInboundEvent(events[index])) inboundIndex = index;
  }
  if (inboundIndex < 0) return false;
  return !events.slice(inboundIndex + 1).some(isRecognizedPostInboundAction);
}

function isCcslInboundEvent(event = {}) {
  const evidence = parseEventNodeAction(event);
  const code = String(evidence.targetNodeCode || '').toUpperCase();
  if (evidence.actionType !== 'INBOUND') return false;
  if (code === 'CCSL') return true;
  const text = eventText(event);
  return /(?:PICKUP\s+INBOUND|ARRIV(?:E|ED|AL)?|INBOUND|到达网点|货物到达)[\s\S]{0,80}(?:CEL\s*:\s*)?CCSL(?!CN|580)/i.test(text);
}

function isRecognizedPostInboundAction(event = {}) {
  const evidence = parseEventNodeAction(event);
  return ['INBOUND', 'OUTBOUND'].includes(evidence.actionType)
    || isPodEvent(event)
    || isPendingEvent(event)
    || isOcEvent(event)
    || isCycleEvent(event)
    || isAssignEvent(event)
    || isDeliveryEvent(event);
}

function sortEventsStable(events = []) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => String(a.event?.eventTime || '').localeCompare(String(b.event?.eventTime || '')) || a.index - b.index)
    .map(item => item.event);
}

function matchedRuleForCategory(category) {
  const rules = {
    'POD闭环': 'POD_PRIORITY',
    '正常分流节点': 'NORMAL_FINAL_HUB',
    'Pending1次': 'PENDING_COUNT_1',
    'Pending2次': 'PENDING_COUNT_2',
    'Pending3次以上': 'PENDING_COUNT_3_PLUS',
    'OC1天': 'OC_DAYS_1',
    'OC2天': 'OC_DAYS_2',
    'OC3天以上': 'OC_DAYS_3_PLUS',
    '盘点1天': 'CYCLE_DAYS_1',
    '盘点2天': 'CYCLE_DAYS_2',
    '盘点3天以上': 'CYCLE_DAYS_3_PLUS',
    '派送停留1天': 'DELIVERY_DAYS_1',
    '派送停留2天': 'DELIVERY_DAYS_2',
    '派送停留3天以上': 'DELIVERY_DAYS_3_PLUS',
    '派件分配2天+': 'ASSIGN_DAYS_2_PLUS',
    '包裹无动作': 'NO_TRACK_EVENT',
    '节点日期未更新': 'STALE_LAST_EVENT',
    '入库无扫描': 'INBOUND_WITHOUT_DELIVERY_SCAN'
  };
  return rules[category] || 'MANUAL_REVIEW';
}

function uniqueDates(events) {
  return [...new Set(events.map(e => String(e.eventTime || '').slice(0, 10)).filter(Boolean))].sort();
}

function isConsecutive(dates) {
  if (dates.length < 3) return false;
  let best = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const a = new Date(`${dates[i - 1]}T00:00:00`);
    const b = new Date(`${dates[i]}T00:00:00`);
    if ((b - a) / 86400000 === 1) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return best >= 3;
}

function isConsecutiveLoose(dates) {
  if (dates.length <= 1) return true;
  return dates.every((date, index) => {
    if (index === 0) return true;
    const a = new Date(`${dates[index - 1]}T00:00:00`);
    const b = new Date(`${date}T00:00:00`);
    return (b - a) / 86400000 === 1;
  });
}

function pendingType(e) {
  const t = eventText(e);
  if (/phone|电话|空号|无法接通|unreachable/i.test(t)) return '电话Pending';
  if (/address|地址|改址/i.test(t)) return '地址Pending';
  if (/photo|picture|image|图片|照片/i.test(t)) return '图片Pending';
  return 'Pending';
}

function eventNeedsImage(e) {
  return /photo|picture|image|proof|图片|照片|签收图|证据/i.test(eventText(e));
}

function hasEvidenceImage(e) {
  return inspectImageEvidence(e).status === 'HAS_IMAGE';
}

function summarizePendingImageStatus(items = []) {
  if (!items.length) return '';
  if (items.every(item => item.status === 'HAS_IMAGE')) return 'HAS_IMAGE';
  if (items.some(item => item.status === 'IMAGE_FIELD_INVALID')) return 'IMAGE_FIELD_INVALID';
  if (items.some(item => item.status === 'IMAGE_FIELD_EMPTY')) return 'IMAGE_FIELD_EMPTY';
  if (items.some(item => item.status === 'NO_IMAGE')) return 'NO_IMAGE';
  if (items.every(item => item.status === 'UNKNOWN_API_NO_FIELD')) return 'UNKNOWN_API_NO_FIELD';
  return 'NO_IMAGE';
}

function inspectImageEvidence(event) {
  const out = {
    hasImageField: false,
    hasInvalidField: false,
    hasEmptyField: false,
    values: []
  };
  collectImageInspection(event, '', out);
  const values = [...new Set(out.values.map(value => String(value || '').trim()).filter(Boolean))];
  if (values.length) return { status: 'HAS_IMAGE', values };
  if (!out.hasImageField) return { status: 'UNKNOWN_API_NO_FIELD', values: [] };
  if (out.hasInvalidField) return { status: 'IMAGE_FIELD_INVALID', values: [] };
  if (out.hasEmptyField) return { status: 'IMAGE_FIELD_EMPTY', values: [] };
  return { status: 'NO_IMAGE', values: [] };
}

function collectImageEvidence(events) {
  const out = [];
  for (const event of events || []) collectImageValue(event, '', out);
  return [...new Set(out.map(value => String(value || '').trim()).filter(Boolean))];
}

function collectImageInspection(value, key, out) {
  if (value == null) {
    if (isImageFieldKey(key)) {
      out.hasImageField = true;
      out.hasEmptyField = true;
    }
    return;
  }
  const imageField = isImageFieldKey(key);
  if (imageField) out.hasImageField = true;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || ['null', 'undefined', '[]', '{}'].includes(trimmed.toLowerCase())) {
      if (imageField) out.hasEmptyField = true;
      return;
    }
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        collectImageInspection(JSON.parse(trimmed), key, out);
        return;
      } catch {
        if (imageField) out.hasInvalidField = true;
        return;
      }
    }
    if (imageField || /^https?:\/\/.+/i.test(trimmed)) {
      if (looksLikeImageEvidence(trimmed)) out.values.push(trimmed);
      else out.hasInvalidField = true;
    }
    return;
  }

  if (Array.isArray(value)) {
    if (imageField && !value.length) out.hasEmptyField = true;
    for (const item of value) collectImageInspection(item, key, out);
    return;
  }

  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectImageInspection(childValue, childKey, out);
    }
  }
}

function isImageFieldKey(key) {
  return /^(fileId|fileIds|image|images|imageUrl|imageUrls|photo|photos|attachment|attachments|picture|pictures|podImage|pendingImage|url|urls)$/i.test(String(key || '').trim());
}

function looksLikeImageEvidence(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^https?:\/\/\S+/i.test(text)) return true;
  if (/\.(?:jpg|jpeg|png|gif|webp|bmp)(?:\?|$)/i.test(text)) return true;
  return /^[A-Za-z0-9._:/+=-]{4,}$/.test(text);
}

function collectImageValue(value, key, out) {
  if (value == null) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return;
    if ((/file|image|picture|photo|attach|oss|url|proof/i.test(key) && trimmed.length >= 4)
      || /^https?:\/\/.+/i.test(trimmed)) {
      out.push(trimmed);
      return;
    }
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        collectImageValue(JSON.parse(trimmed), key, out);
      } catch {
        // rawJson can be a non-JSON summary; ignore parse failure.
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageValue(item, key, out);
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectImageValue(childValue, childKey, out);
    }
  }
}

function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function daysBetween(fromDate, toDate) {
  const a = new Date(`${fromDate}T00:00:00`);
  const b = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}
