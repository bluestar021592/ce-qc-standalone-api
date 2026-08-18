import { getDb } from './db.js';
import { listCompletedWhppSnapshots } from './v87WhppExportStore.js';

export const V200_EXPORT_VERSION = '2026-08-18-v200-reference-template-track-attempt-v1';

const TYPES = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const POD_RE = /\bPOD\b|DELIVERED|签收|妥投|已妥投|Successfully delivered/i;
const RETURN_RE = /RETURN(?:ED|_COMPLETED)?|退回完成|已退回|退件完成|R退回/i;
const PENDING_RE = /PENDING|Pending/i;
const DELIVERY_RE = /Parcel start to deliver|out\s*for\s*delivery|派送中|派件中|正在为您派送|正在派送/i;
const ASSIGN_RE = /Assigning courier|courier\s*assign|delivery\s*assign|派件分配|分配快递员|分配派送|即将为您派送/i;
const CYCLE_RE = /盘点|cycle\s*count/i;

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; }
}
function normalizeBill(value = '') { return String(value || '').trim().toUpperCase(); }
function normalizeKey(value = '') { return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, ''); }
function dateKey(value = '') {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
function dayNumber(value = '') {
  const key = dateKey(value);
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function inclusiveDays(from, to) {
  const a = dayNumber(from), b = dayNumber(to);
  if (a === null || b === null || b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}
function firstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}
function positiveAttempt(...values) {
  for (const value of values) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return Math.min(3, Math.floor(n));
  }
  return 0;
}
function chunks(values = [], size = 350) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
function areaOf(regionCode = '', province = '') {
  const code = String(regionCode || '').trim().toUpperCase();
  const p = String(province || '').trim();
  if (code.includes('PP') || code.includes('PNH') || code === 'PHNOM_PENH' || /金边|PHNOM\s*PENH/i.test(`${code} ${p}`)) return '金边';
  if (code.includes('PV') || code === 'PROVINCE' || p) return '外省';
  return '未识别';
}
function isStoreText(value = '') { return /(?:^|\b)(?:CP|FS)\d*[A-Z0-9_-]*\b|\bSHOP\b|CO[-\s]?SHOP|PT[-\s]?SHOP/i.test(String(value || '')); }
function eventRaw(row = {}) { return safeJson(row.rawJson, {}); }
function eventCode(row = {}) {
  const raw = eventRaw(row);
  return String(row.eventCode || raw.eventCode || raw.trackingEventCode || raw.statusCode || '').trim();
}
function eventTime(row = {}) {
  const raw = eventRaw(row);
  return String(row.eventTime || raw.eventTime || raw.creationDate || raw.lastUpdateDate || '').trim();
}
function eventText(row = {}) {
  const raw = eventRaw(row);
  return [row.eventCode, raw.eventCode, raw.trackingEventCode, raw.statusCode, raw.trackingEventDescZh, raw.trackingEventDesc, raw.trackingEventDescKm, raw.statusText, raw.remark, raw.place, raw.eventShop, raw.locationCode]
    .map(value => String(value || '').trim()).filter(Boolean).join(' ');
}
function isPodEvent(row = {}) { const code = eventCode(row); return code === '80' || POD_RE.test(eventText(row)); }
function isReturnEvent(row = {}) { const code = eventCode(row); return code === '86' || RETURN_RE.test(eventText(row)); }
function isAssignEvent(row = {}) { const code = eventCode(row); return code === '60' || ASSIGN_RE.test(eventText(row)); }
function isDeliveryEvent(row = {}) { const code = eventCode(row); return code === '70' || DELIVERY_RE.test(eventText(row)); }
function explicitPodTime(row = {}) { return String(firstValue(row, ['POD时间', 'podTime', 'podClosedAt', 'podAt', 'deliveredAt', 'deliveryCompletedAt']) || '').trim(); }

function parseRawRow(rowJson = {}) {
  const parsed = safeJson(rowJson, {});
  const raw = parsed?.raw && typeof parsed.raw === 'object' ? parsed.raw : parsed;
  const map = new Map(Object.entries(raw || {}).map(([key, value]) => [normalizeKey(key), value]));
  const get = aliases => {
    for (const alias of aliases) {
      const value = map.get(normalizeKey(alias));
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  return { parsed, get };
}

function newEntry(code, reportDate, type) {
  return {
    shipmentCode: code, businessType: type, firstReportDate: reportDate, lastReportDate: reportDate,
    orderTime: '', rawDeliveryTime: '', statusCode: '', statusDesc: '', regionCode: '', recipientProvince: '', area: '未识别',
    currentShop: '', currentProvince: '', recipient: '', recipientPhone: '', recipientAddress: '', deliveryShop: '', deliveryProvince: '', courier: '', exceptionCode: '', exceptionDesc: '', remark: '',
    pod: false, returned: false, pending: false, delivering: false, store: false,
    podTime: '', podDate: '', podSource: '', podPriority: 99,
    podAttemptNo: 0, currentAttemptNo: 0, historyAttemptNo: 0, trackAttemptNo: 0,
    assignDates: new Set(), deliveryDates: new Set(), firstDispatchDate: '', deliveryDays: 0, attemptNo: 0, attemptSource: '', evidence: new Set()
  };
}
function setPodEvidence(entry, time, source, priority) {
  const raw = String(time || '').trim();
  const date = dateKey(raw);
  if (!date) return;
  if (!entry.podDate || priority < entry.podPriority || (priority === entry.podPriority && raw < entry.podTime)) {
    entry.pod = true; entry.podTime = raw; entry.podDate = date; entry.podSource = source; entry.podPriority = priority;
  }
}
function applyAttemptHistory(entry, value) {
  const parsed = safeJson(value, null);
  if (!parsed) return;
  const visit = node => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== 'object') return;
    entry.historyAttemptNo = Math.max(entry.historyAttemptNo, positiveAttempt(node.podAttemptNo, node.currentAttemptNo, node.attemptNo, node.派次));
    Object.values(node).forEach(child => { if (child && typeof child === 'object') visit(child); });
  };
  visit(parsed);
}
function applyAnalysisRow(entry, row = {}, reportDate = '', source = '分析结果') {
  entry.lastReportDate = reportDate && reportDate > entry.lastReportDate ? reportDate : entry.lastReportDate;
  entry.regionCode = String(firstValue(row, ['regionCode', 'region_code', '区域', '区域分类']) || entry.regionCode || '');
  entry.recipientProvince = String(firstValue(row, ['recipientProvince', '收件省份', 'province', '省份']) || entry.recipientProvince || '');
  entry.currentShop = String(firstValue(row, ['currentShop', 'currentStore', 'currentShopCode', 'targetShopCode', 'shopName', 'matchedShopName', '当前门店', 'latestNode', '最新节点']) || entry.currentShop || '');
  entry.currentProvince = String(firstValue(row, ['currentProvince', '当前省份', 'deliveryProvince', '派件省份']) || entry.currentProvince || '');
  entry.deliveryShop = String(firstValue(row, ['deliveryShop', '派件门店', 'matchedShopName', 'shopName']) || entry.deliveryShop || '');
  entry.deliveryProvince = String(firstValue(row, ['deliveryProvince', '派件省份']) || entry.deliveryProvince || '');
  entry.courier = String(firstValue(row, ['courier', '派件快递员', 'eventCourier']) || entry.courier || '');
  entry.exceptionCode = String(firstValue(row, ['exceptionCode', '异常编码']) || entry.exceptionCode || '');
  entry.exceptionDesc = String(firstValue(row, ['exceptionDesc', '异常描述', 'primaryCategory', 'currentMainCategory', '主分类', '异常分类', 'QC判断']) || entry.exceptionDesc || '');
  entry.remark = String(firstValue(row, ['remark', '备注']) || entry.remark || '');
  entry.statusDesc = String(firstValue(row, ['currentState', 'scanNormalizedState', '状态说明', 'primaryCategory', 'currentMainCategory', '主分类', '异常分类']) || entry.statusDesc || '');
  entry.store = entry.store || isStoreText([entry.currentShop, entry.deliveryShop].join(' '));
  entry.podAttemptNo = Math.max(entry.podAttemptNo, positiveAttempt(row.podAttemptNo));
  entry.currentAttemptNo = Math.max(entry.currentAttemptNo, positiveAttempt(row.currentAttemptNo, row.派次, row.attemptNo));
  applyAttemptHistory(entry, row.attemptHistoryJson);
  const podLike = Number(row.isPod || 0) === 1 || row.是否POD === '是' || String(row.orderStatus || '') === '85' || String(row.currentState || row.scanNormalizedState || '').toUpperCase() === 'POD' || POD_RE.test(entry.statusDesc);
  if (podLike) {
    entry.pod = true;
    const explicit = explicitPodTime(row);
    if (explicit) setPodEvidence(entry, explicit, `${source}:显式POD时间`, 2);
    const lastDesc = String(firstValue(row, ['latestEventDesc', '最后节点']) || '');
    const lastTime = String(firstValue(row, ['latestEventTime', '最后节点时间']) || '');
    if (lastTime && POD_RE.test(lastDesc)) setPodEvidence(entry, lastTime, `${source}:POD终态节点`, 3);
  } else {
    entry.returned = entry.returned || RETURN_RE.test([row.currentState, row.退回状态, row.primaryCategory, row.currentMainCategory, row.主分类, row.异常分类, row.latestEventDesc].join(' '));
    entry.pending = entry.pending || Number(row.Pending次数 || row.Pending当前次数 || row.pendingDistinctDayCount || 0) > 0 || PENDING_RE.test(entry.statusDesc);
    entry.delivering = entry.delivering || Number(row.派送中停留天数 || 0) > 0 || DELIVERY_RE.test(entry.statusDesc) || ASSIGN_RE.test(entry.statusDesc);
  }
  entry.evidence.add(source);
}

function latestValidBatches(db, from, to) {
  const rows = db.prepare(`SELECT b.snapshotId,b.reportDate,b.createdAt,b.batchId FROM unified_import_batches b INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ? ORDER BY b.reportDate ASC,b.createdAt DESC,b.batchId DESC`).all(from, to);
  const byDate = new Map();
  for (const row of rows) if (row.reportDate && !byDate.has(row.reportDate)) byDate.set(row.reportDate, row);
  return [...byDate.values()].sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)));
}
function seedUnified(db, type, range, onProgress) {
  const batches = latestValidBatches(db, range.from, range.to);
  if (!batches.length) throw new Error(`${range.from} 至 ${range.to} 没有 VALID + COMPLETED 日快照。`);
  const stmt = db.prepare(`SELECT shipmentCode,regionCode,recipientRaw,recipientNormalized,rowNumber,rowJson FROM unified_import_rows WHERE snapshotId=? AND businessType=? ORDER BY rowNumber,shipmentCode`);
  const map = new Map();
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    for (const row of stmt.iterate(batch.snapshotId, type)) {
      const code = normalizeBill(row.shipmentCode);
      if (!code) continue;
      let entry = map.get(code);
      if (!entry) { entry = newEntry(code, batch.reportDate, type); map.set(code, entry); }
      if (batch.reportDate < entry.firstReportDate) entry.firstReportDate = batch.reportDate;
      if (batch.reportDate > entry.lastReportDate) entry.lastReportDate = batch.reportDate;
      const { parsed, get } = parseRawRow(row.rowJson);
      if (!entry.regionCode) entry.regionCode = String(row.regionCode || parsed.regionCode || '');
      if (!entry.recipientProvince) entry.recipientProvince = get(['收件省份', '目的省份', '目的地省份', '收货省份', 'receiverprovince', 'destinationprovince']);
      if (!entry.orderTime) entry.orderTime = get(['下单时间', '下单日期', '订单时间', '订单日期', 'ordertime', 'orderdate']);
      if (!entry.recipient) entry.recipient = String(row.recipientNormalized || row.recipientRaw || get(['收件人', '收货人', 'recipient', 'receiver', 'consignee']) || '');
      if (!entry.recipientPhone) entry.recipientPhone = get(['收件人手机', '收件人电话', '收货人手机', '收货人电话', '手机号', 'receiverphone']);
      if (!entry.recipientAddress) entry.recipientAddress = get(['收件地址', '收货地址', '详细地址', '地址', 'receiveraddress']);
      const rawStatus = get(['状态标识', '状态代码', 'status', 'statuscode']).toUpperCase();
      const rawDesc = get(['状态说明', '状态描述', 'statusdesc', 'statusdescription', 'statusname']);
      const rawDeliveryTime = get(['派件时间', '签收时间', 'POD时间', 'deliverytime', 'podtime', 'deliveredat']);
      const currentShop = get(['当前门店', '当前网点', '当前站点', 'currentshop', 'currentsite']);
      const currentProvince = get(['当前省份', '所在省份', 'currentprovince']);
      const deliveryShop = get(['派件门店', '派送门店', 'deliveryshop']);
      const deliveryProvince = get(['派件省份', '派送省份', 'deliveryprovince']);
      const courier = get(['派件快递员', '派送快递员', '快递员', 'deliverycourier', 'courier']);
      const exceptionCode = get(['异常编码', '异常代码', 'exceptioncode']);
      const exceptionDesc = get(['异常描述', '异常说明', 'exceptiondesc', 'exceptiondescription']);
      const remark = get(['备注', 'remark', 'remarks', 'note']);
      if (batch.reportDate >= entry.lastReportDate) {
        entry.statusCode = rawStatus || entry.statusCode; entry.statusDesc = rawDesc || entry.statusDesc;
        entry.currentShop = currentShop || entry.currentShop; entry.currentProvince = currentProvince || entry.currentProvince;
        entry.deliveryShop = deliveryShop || entry.deliveryShop; entry.deliveryProvince = deliveryProvince || entry.deliveryProvince;
        entry.courier = courier || entry.courier; entry.exceptionCode = exceptionCode || entry.exceptionCode; entry.exceptionDesc = exceptionDesc || entry.exceptionDesc; entry.remark = remark || entry.remark;
      }
      if (rawDeliveryTime) entry.rawDeliveryTime = rawDeliveryTime;
      const podByDaily = POD_RE.test(rawDesc);
      if (podByDaily) { entry.pod = true; if (rawDeliveryTime) setPodEvidence(entry, rawDeliveryTime, '日报派件/签收时间', 4); }
      if (rawStatus === 'R' || RETURN_RE.test(rawDesc)) entry.returned = true;
      if (rawStatus === 'P' || PENDING_RE.test(rawDesc)) entry.pending = true;
      const deliveryByDaily = rawStatus === 'W' || (rawStatus === 'Y' && !podByDaily) || DELIVERY_RE.test(rawDesc) || ASSIGN_RE.test(rawDesc);
      if (deliveryByDaily) {
        entry.delivering = true;
        const d = dateKey(rawDeliveryTime) || dateKey(batch.reportDate);
        if (d) entry.deliveryDates.add(d);
      }
      entry.store = entry.store || isStoreText([currentShop, deliveryShop].join(' '));
      entry.area = areaOf(entry.regionCode, entry.recipientProvince);
    }
    onProgress({ phase: 'sourceRows', completed: index + 1, total: batches.length, entries: map.size });
  }
  return map;
}
function seedWhpp(range, onProgress) {
  const snapshots = listCompletedWhppSnapshots(range.from, range.to);
  if (!snapshots.length) throw new Error(`${range.from} 至 ${range.to} 没有 WHPP 已完成数据。`);
  const map = new Map();
  for (let index = 0; index < snapshots.length; index++) {
    const snapshot = snapshots[index];
    for (const row of snapshot.payload?.finalRows || []) {
      const code = normalizeBill(firstValue(row, ['shipmentCode', '运单号', '运单编号']));
      if (!code) continue;
      let entry = map.get(code);
      if (!entry) { entry = newEntry(code, snapshot.reportDate, 'WHPP'); map.set(code, entry); }
      applyAnalysisRow(entry, row, snapshot.reportDate, 'WHPP快照');
    }
    onProgress({ phase: 'sourceRows', completed: index + 1, total: snapshots.length, entries: map.size });
  }
  return map;
}
function enrichFinalRows(db, type, map) {
  const codes = [...map.keys()]; const queryType = SHOPEE_TYPES.has(type) ? 'SHOPEE' : type;
  for (const chunk of chunks(codes, 300)) {
    const marks = chunk.map(() => '?').join(','); if (!marks) continue; let rows = [];
    try { rows = db.prepare(`SELECT shipmentCode,reportDate,isPod,primaryCategory,currentMainCategory,apiStatus,latestEventTime,latestEventDesc,latestNode,currentAttemptNo,podAttemptNo,firstAttemptAt,attemptHistoryJson,rawJson FROM business_final_rows WHERE businessType=? AND shipmentCode IN (${marks}) ORDER BY shipmentCode,reportDate`).all(queryType, ...chunk); } catch {}
    for (const row of rows) { const entry = map.get(normalizeBill(row.shipmentCode)); if (!entry) continue; const raw = safeJson(row.rawJson, {}); applyAnalysisRow(entry, { ...raw, ...row }, row.reportDate || entry.lastReportDate, '历史分析'); const t = explicitPodTime(raw); if (t) setPodEvidence(entry, t, '历史分析显式POD时间', 2); }
  }
}
function enrichCurrentState(db, type, map) {
  const codes = [...map.keys()];
  for (const chunk of chunks(codes, 350)) {
    const marks = chunk.map(() => '?').join(','); if (!marks) continue; let rows = [];
    try { rows = db.prepare(`SELECT shipmentCode,businessType,reportDate,state,lastEventTime,stateJson,apiStatus FROM shipment_current_state WHERE shipmentCode IN (${marks})`).all(...chunk); } catch {}
    for (const row of rows) {
      const entry = map.get(normalizeBill(row.shipmentCode)); if (!entry) continue;
      const bt = String(row.businessType || '').toUpperCase();
      if (SHOPEE_TYPES.has(type)) { if (bt && ![type, 'SHOPEE'].includes(bt)) continue; } else if (bt && bt !== type) continue;
      const raw = safeJson(row.stateJson, {}); applyAnalysisRow(entry, { ...raw, currentState: row.state, latestEventTime: row.lastEventTime }, row.reportDate || entry.lastReportDate, '当前状态');
      const t = explicitPodTime(raw); if (t) setPodEvidence(entry, t, '当前状态显式POD时间', 2);
    }
  }
}
function enrichPodLocks(db, type, map) {
  const codes = [...map.keys()];
  for (const chunk of chunks(codes, 500)) {
    const marks = chunk.map(() => '?').join(','); if (!marks) continue; let rows = [];
    try { if (type === 'CE') rows = db.prepare(`SELECT shipmentCode,podTime,source FROM pod_locks WHERE shipmentCode IN (${marks})`).all(...chunk); else rows = db.prepare(`SELECT shipmentCode,businessType,podTime,source FROM business_pod_locks WHERE shipmentCode IN (${marks})`).all(...chunk); } catch {}
    for (const row of rows) {
      const entry = map.get(normalizeBill(row.shipmentCode)); if (!entry || !row.podTime) continue;
      const bt = String(row.businessType || '').toUpperCase();
      if (type !== 'CE') { if (SHOPEE_TYPES.has(type)) { if (bt && ![type, 'SHOPEE'].includes(bt)) continue; } else if (bt && bt !== type) continue; }
      setPodEvidence(entry, row.podTime, `POD锁:${row.source || ''}`, 1); entry.evidence.add('POD锁');
    }
  }
}
function enrichTrackRows(db, type, map) {
  const codes = [...map.keys()];
  for (const chunk of chunks(codes, 220)) {
    const marks = chunk.map(() => '?').join(','); if (!marks) continue; let rows = [];
    try { if (SHOPEE_TYPES.has(type)) rows = db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,createdAt FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,createdAt,id`).all(...chunk); else rows = db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,createdAt FROM business_track_events WHERE businessType=? AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,createdAt,id`).all(type, ...chunk); } catch {}
    if (type === 'CE' && !rows.length) { try { rows = db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,createdAt FROM track_events WHERE shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,createdAt,id`).all(...chunk); } catch {} }
    for (const row of rows) {
      const entry = map.get(normalizeBill(row.shipmentCode)); if (!entry) continue;
      const time = eventTime(row), d = dateKey(time);
      if (d && isAssignEvent(row) && !CYCLE_RE.test(eventText(row))) entry.assignDates.add(d);
      if (d && isDeliveryEvent(row) && !CYCLE_RE.test(eventText(row))) entry.deliveryDates.add(d);
      if (isPodEvent(row)) setPodEvidence(entry, time, '轨迹POD状态码80/签收节点', 1);
      if (isReturnEvent(row) && !entry.pod) entry.returned = true;
      entry.evidence.add('轨迹');
    }
  }
}

export function resolveV200Attempt({ pod = false, deliveryDates = [], assignDates = [], podAttemptNo = 0, historyAttemptNo = 0, currentAttemptNo = 0, podDate = '' } = {}) {
  if (!pod) return { attemptNo: 0, source: '' };
  const beforePod = values => [...new Set((values || []).map(dateKey).filter(Boolean))].filter(date => !podDate || date <= podDate).sort();
  const delivery = beforePod(deliveryDates), assign = beforePod(assignDates);
  if (delivery.length) return { attemptNo: Math.min(3, delivery.length), source: '轨迹/日报派送日期' };
  if (assign.length) return { attemptNo: Math.min(3, assign.length), source: '轨迹60派件分配日期' };
  const podAttempt = positiveAttempt(podAttemptNo); if (podAttempt) return { attemptNo: podAttempt, source: 'POD锁定派次' };
  const history = positiveAttempt(historyAttemptNo); if (history) return { attemptNo: history, source: '历史派次记录' };
  const current = positiveAttempt(currentAttemptNo); if (current >= 2) return { attemptNo: current, source: '当前派次记录' };
  return { attemptNo: 0, source: '无真实派次证据' };
}
export function resolveV200AverageDays({ firstDispatchDate = '', firstReportDate = '', podDate = '' } = {}) {
  if (!dateKey(podDate)) return 0;
  const start = dateKey(firstReportDate) || dateKey(firstDispatchDate);
  return start ? inclusiveDays(start, podDate) : 0;
}
function finalize(map) {
  for (const entry of map.values()) {
    entry.area = areaOf(entry.regionCode, entry.recipientProvince); entry.store = entry.store || isStoreText([entry.currentShop, entry.deliveryShop].join(' '));
    const deliveryDates = [...entry.deliveryDates].sort(), assignDates = [...entry.assignDates].sort();
    entry.firstDispatchDate = deliveryDates[0] || assignDates[0] || dateKey(entry.firstReportDate);
    entry.trackAttemptNo = deliveryDates.length ? Math.min(3, deliveryDates.filter(d => !entry.podDate || d <= entry.podDate).length) : (assignDates.length ? Math.min(3, assignDates.filter(d => !entry.podDate || d <= entry.podDate).length) : 0);
    const attempt = resolveV200Attempt({ pod: entry.pod, deliveryDates, assignDates, podAttemptNo: entry.podAttemptNo, historyAttemptNo: entry.historyAttemptNo, currentAttemptNo: entry.currentAttemptNo, podDate: entry.podDate });
    entry.attemptNo = attempt.attemptNo; entry.attemptSource = attempt.source;
    entry.deliveryDays = entry.pod ? resolveV200AverageDays({ firstDispatchDate: entry.firstDispatchDate, firstReportDate: entry.firstReportDate, podDate: entry.podDate }) : 0;
    if (entry.pod) { entry.statusCode = entry.statusCode || 'Y'; entry.statusDesc = 'POD'; entry.returned = false; entry.pending = false; entry.delivering = false; }
    else if (entry.returned) { entry.statusCode = entry.statusCode || 'R'; entry.statusDesc = entry.statusDesc || 'R退回'; entry.pending = false; entry.delivering = false; }
    else if (entry.pending) { entry.statusCode = entry.statusCode || 'P'; entry.statusDesc = entry.statusDesc || 'Pending'; entry.delivering = false; }
    else if (entry.delivering) { entry.statusCode = entry.statusCode || 'W'; entry.statusDesc = entry.statusDesc || '分配派送中'; }
  }
}
export async function collectV200Rows(type, range, onProgress = () => {}) {
  const businessType = String(type || '').trim().toUpperCase();
  if (!TYPES.has(businessType)) throw new Error(`V200不支持业务：${businessType}`);
  const db = getDb(); const map = businessType === 'WHPP' ? seedWhpp(range, onProgress) : seedUnified(db, businessType, range, onProgress);
  enrichFinalRows(db, businessType, map); enrichCurrentState(db, businessType, map); enrichPodLocks(db, businessType, map); enrichTrackRows(db, businessType, map); finalize(map);
  const rows = [...map.values()].sort((a, b) => a.firstReportDate.localeCompare(b.firstReportDate) || a.shipmentCode.localeCompare(b.shipmentCode));
  onProgress({ phase: 'truth', completed: rows.length, total: rows.length, entries: rows.filter(row => row.evidence.size).length, validPodTimes: rows.filter(row => row.pod && row.podDate).length, trackAttempts: rows.filter(row => row.pod && /轨迹|日报派送/.test(row.attemptSource)).length });
  return rows;
}
