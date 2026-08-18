import { getDb, nowIso } from './db.js';

export const SHOPEE_DELIVERY_TRACKER_VERSION = '2026-08-18-v201-shopee-cn-vn-persistent-dispatch-tracker-v1';
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const POD_RE = /\bPOD\b|DELIVERED|签收|妥投|已妥投|Successfully delivered/i;
const DELIVERY_RE = /Parcel start to deliver|out\s*for\s*delivery|派送中|派件中|正在为您派送|正在派送/i;
const ASSIGN_RE = /Assigning courier|courier\s*assign|delivery\s*assign|派件分配|分配快递员|分配派送|即将为您派送/i;
const CYCLE_RE = /盘点|cycle\s*count/i;

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; }
}
function billOf(value = '') { return String(value || '').trim().toUpperCase(); }
function keyOf(value = '') { return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, ''); }
function dateKey(value = '') {
  const m = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function inclusiveDays(from, to) {
  const a = dateKey(from), b = dateKey(to);
  if (!a || !b || b < a) return 0;
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}
function positiveAttempt(...values) {
  for (const value of values) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return Math.min(3, Math.floor(n));
  }
  return 0;
}
function chunks(values = [], size = 300) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
function firstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}
function parseRawRow(rowJson = {}) {
  const parsed = safeJson(rowJson, {});
  const raw = parsed?.raw && typeof parsed.raw === 'object' ? parsed.raw : parsed;
  const map = new Map(Object.entries(raw || {}).map(([key, value]) => [keyOf(key), value]));
  const get = aliases => {
    for (const alias of aliases) {
      const value = map.get(keyOf(alias));
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  return { parsed, get };
}
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
    .map(v => String(v || '').trim()).filter(Boolean).join(' ');
}
function isDeliveryEvent(row = {}) { return eventCode(row) === '70' || DELIVERY_RE.test(eventText(row)); }
function isAssignEvent(row = {}) { return eventCode(row) === '60' || ASSIGN_RE.test(eventText(row)); }
function isPodEvent(row = {}) { return eventCode(row) === '80' || POD_RE.test(eventText(row)); }
function regionArea(regionCode = '', province = '') {
  const code = String(regionCode || '').trim().toUpperCase();
  const p = String(province || '').trim();
  if (code.includes('PP') || code.includes('PNH') || code === 'PHNOM_PENH' || /金边|PHNOM\s*PENH/i.test(`${code} ${p}`)) return '金边';
  if (code.includes('PV') || code === 'PROVINCE' || p) return '外省';
  return '未识别';
}
function mergeDates(...groups) {
  return [...new Set(groups.flatMap(group => Array.isArray(group) ? group : []).map(dateKey).filter(Boolean))].sort();
}
function listFromJson(value) {
  const parsed = safeJson(value, []);
  return Array.isArray(parsed) ? parsed.map(dateKey).filter(Boolean) : [];
}
function listFromText(value = '') {
  return String(value || '').split(/[、,|;\s]+/).map(dateKey).filter(Boolean);
}
function bestPod(current = {}, incoming = {}) {
  const candidates = [current, incoming].filter(item => dateKey(item?.podTime || item?.podDate));
  if (!candidates.length) return { podStatus: 0, podTime: '', podDate: '', podSource: '' };
  candidates.sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99) || String(a.podTime || a.podDate).localeCompare(String(b.podTime || b.podDate)));
  const best = candidates[0];
  const time = String(best.podTime || best.podDate || '');
  return { podStatus: 1, podTime: time, podDate: dateKey(time), podSource: String(best.podSource || '') };
}

export function ensureShopeeDeliveryTrackingSchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopee_delivery_tracking (
      businessType TEXT NOT NULL,
      shipmentCode TEXT NOT NULL,
      firstReportDate TEXT NOT NULL,
      lastReportDate TEXT NOT NULL,
      regionCode TEXT,
      recipientProvince TEXT,
      area TEXT,
      dispatchDatesJson TEXT NOT NULL DEFAULT '[]',
      assignDatesJson TEXT NOT NULL DEFAULT '[]',
      firstDispatchDate TEXT,
      attemptNo INTEGER NOT NULL DEFAULT 0,
      attemptSource TEXT,
      podStatus INTEGER NOT NULL DEFAULT 0,
      podTime TEXT,
      podDate TEXT,
      podSource TEXT,
      signNaturalDays INTEGER NOT NULL DEFAULT 0,
      dispatchToPodDays INTEGER NOT NULL DEFAULT 0,
      lastState TEXT,
      sourceSnapshotId TEXT,
      evidenceJson TEXT NOT NULL DEFAULT '{}',
      trackerVersion TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (businessType, shipmentCode)
    );
    CREATE TABLE IF NOT EXISTS shopee_delivery_tracking_daily (
      businessType TEXT NOT NULL,
      reportDate TEXT NOT NULL,
      shipmentCode TEXT NOT NULL,
      attemptNo INTEGER NOT NULL DEFAULT 0,
      firstDispatchDate TEXT,
      dispatchDatesJson TEXT NOT NULL DEFAULT '[]',
      podStatus INTEGER NOT NULL DEFAULT 0,
      podTime TEXT,
      podDate TEXT,
      signNaturalDays INTEGER NOT NULL DEFAULT 0,
      regionCode TEXT,
      area TEXT,
      sourceSnapshotId TEXT,
      evidenceJson TEXT NOT NULL DEFAULT '{}',
      trackerVersion TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (businessType, reportDate, shipmentCode)
    );
    CREATE INDEX IF NOT EXISTS idx_shopee_delivery_tracking_report ON shopee_delivery_tracking(businessType, firstReportDate, podStatus, attemptNo);
    CREATE INDEX IF NOT EXISTS idx_shopee_delivery_tracking_daily_report ON shopee_delivery_tracking_daily(reportDate, businessType, attemptNo, podStatus);
  `);
  return true;
}

function latestValidBatches(db, fromDate, toDate) {
  const rows = db.prepare(`SELECT b.snapshotId,b.reportDate,b.createdAt,b.batchId
    FROM unified_import_batches b
    INNER JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID' AND s.status='COMPLETED' AND b.reportDate BETWEEN ? AND ?
    ORDER BY b.reportDate ASC,b.createdAt DESC,b.batchId DESC`).all(fromDate, toDate);
  const byDate = new Map();
  for (const row of rows) if (row.reportDate && !byDate.has(row.reportDate)) byDate.set(row.reportDate, row);
  return [...byDate.values()].sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)));
}

function seedMembership(db, fromDate, toDate, businessTypes) {
  const batches = latestValidBatches(db, fromDate, toDate);
  const map = new Map();
  if (!batches.length) return { map, batches };
  const types = [...businessTypes].filter(type => SHOPEE_TYPES.has(type));
  if (!types.length) return { map, batches };
  const marks = types.map(() => '?').join(',');
  const stmt = db.prepare(`SELECT shipmentCode,businessType,regionCode,rowJson FROM unified_import_rows WHERE snapshotId=? AND businessType IN (${marks}) ORDER BY rowNumber,shipmentCode`);
  for (const batch of batches) {
    for (const row of stmt.iterate(batch.snapshotId, ...types)) {
      const shipmentCode = billOf(row.shipmentCode);
      const businessType = String(row.businessType || '').toUpperCase();
      if (!shipmentCode || !SHOPEE_TYPES.has(businessType)) continue;
      const key = `${businessType}|${shipmentCode}`;
      let entry = map.get(key);
      if (!entry) {
        const { get } = parseRawRow(row.rowJson);
        entry = {
          businessType, shipmentCode, firstReportDate: batch.reportDate, lastReportDate: batch.reportDate,
          regionCode: String(row.regionCode || ''), recipientProvince: get(['收件省份','目的省份','目的地省份','收货省份','receiverprovince','destinationprovince']),
          dailyDispatchDates: new Set(), assignDates: new Set(), trackDispatchDates: new Set(),
          pod: { podStatus: 0, podTime: '', podDate: '', podSource: '', priority: 99 },
          fallbackAttempt: 0, lastState: '', sourceSnapshotId: batch.snapshotId, evidence: new Set(['统一日报'])
        };
        map.set(key, entry);
      }
      if (batch.reportDate < entry.firstReportDate) entry.firstReportDate = batch.reportDate;
      if (batch.reportDate >= entry.lastReportDate) { entry.lastReportDate = batch.reportDate; entry.sourceSnapshotId = batch.snapshotId; }
      const { get } = parseRawRow(row.rowJson);
      entry.regionCode = entry.regionCode || String(row.regionCode || '');
      entry.recipientProvince = entry.recipientProvince || get(['收件省份','目的省份','目的地省份','收货省份','receiverprovince','destinationprovince']);
      const status = get(['状态标识','状态代码','status','statuscode']).toUpperCase();
      const desc = get(['状态说明','状态描述','statusdesc','statusdescription','statusname']);
      const deliveryTime = get(['派件时间','签收时间','POD时间','deliverytime','podtime','deliveredat']);
      // W/Y are both JT dispatch-state evidence in the daily report. They are persisted
      // as real observed dispatch dates; they are not treated as POD by themselves.
      if (status === 'W' || status === 'Y' || DELIVERY_RE.test(desc) || ASSIGN_RE.test(desc)) entry.dailyDispatchDates.add(batch.reportDate);
      if (POD_RE.test(desc) && dateKey(deliveryTime)) entry.pod = { podStatus: 1, podTime: deliveryTime, podDate: dateKey(deliveryTime), podSource: '日报POD/签收时间', priority: 4 };
    }
  }
  return { map, batches };
}

function overlayExisting(db, map) {
  ensureShopeeDeliveryTrackingSchema(db);
  const stmt = db.prepare(`SELECT * FROM shopee_delivery_tracking WHERE businessType=? AND shipmentCode=?`);
  for (const entry of map.values()) {
    const row = stmt.get(entry.businessType, entry.shipmentCode);
    if (!row) continue;
    entry.firstReportDate = row.firstReportDate && row.firstReportDate < entry.firstReportDate ? row.firstReportDate : entry.firstReportDate;
    entry.lastReportDate = row.lastReportDate && row.lastReportDate > entry.lastReportDate ? row.lastReportDate : entry.lastReportDate;
    entry.regionCode = entry.regionCode || row.regionCode || '';
    entry.recipientProvince = entry.recipientProvince || row.recipientProvince || '';
    entry.dailyDispatchDates = new Set(mergeDates([...entry.dailyDispatchDates], listFromJson(row.dispatchDatesJson)));
    entry.assignDates = new Set(mergeDates([...entry.assignDates], listFromJson(row.assignDatesJson)));
    entry.pod = bestPod(entry.pod, { podStatus: row.podStatus, podTime: row.podTime, podDate: row.podDate, podSource: row.podSource, priority: row.podStatus ? 3 : 99 });
    entry.fallbackAttempt = Math.max(entry.fallbackAttempt, positiveAttempt(row.attemptNo));
    entry.lastState = entry.lastState || row.lastState || '';
  }
}

function enrichTrackEvidence(db, map, passedEvents = []) {
  const byBillPassed = new Map();
  for (const row of passedEvents || []) {
    const code = billOf(row.shipmentCode || row.运单号);
    if (!code) continue;
    if (!byBillPassed.has(code)) byBillPassed.set(code, []);
    byBillPassed.get(code).push(row);
  }
  const bills = [...new Set([...map.values()].map(entry => entry.shipmentCode))];
  const byBillDb = new Map();
  for (const chunk of chunks(bills, 220)) {
    const marks = chunk.map(() => '?').join(',');
    if (!marks) continue;
    let rows = [];
    try { rows = db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,createdAt FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,createdAt,id`).all(...chunk); } catch {}
    for (const row of rows) {
      const code = billOf(row.shipmentCode);
      if (!byBillDb.has(code)) byBillDb.set(code, []);
      byBillDb.get(code).push(row);
    }
  }
  for (const entry of map.values()) {
    const events = [...(byBillDb.get(entry.shipmentCode) || []), ...(byBillPassed.get(entry.shipmentCode) || [])];
    for (const row of events) {
      const time = eventTime(row), d = dateKey(time), text = eventText(row);
      if (d && isDeliveryEvent(row) && !CYCLE_RE.test(text)) entry.trackDispatchDates.add(d);
      if (d && isAssignEvent(row) && !CYCLE_RE.test(text)) entry.assignDates.add(d);
      if (isPodEvent(row) && d) entry.pod = bestPod(entry.pod, { podStatus: 1, podTime: time, podDate: d, podSource: '轨迹80/POD节点', priority: 1 });
    }
    if (events.length) entry.evidence.add('轨迹60/70/80');
  }
}

function enrichPodLocks(db, map) {
  const bills = [...new Set([...map.values()].map(entry => entry.shipmentCode))];
  for (const chunk of chunks(bills, 400)) {
    const marks = chunk.map(() => '?').join(','); if (!marks) continue;
    let rows = [];
    try { rows = db.prepare(`SELECT businessType,shipmentCode,podTime,source FROM business_pod_locks WHERE shipmentCode IN (${marks})`).all(...chunk); } catch {}
    for (const row of rows) {
      const code = billOf(row.shipmentCode), bt = String(row.businessType || '').toUpperCase();
      for (const entry of map.values()) {
        if (entry.shipmentCode !== code) continue;
        if (bt && ![entry.businessType, 'SHOPEE'].includes(bt)) continue;
        if (dateKey(row.podTime)) entry.pod = bestPod(entry.pod, { podStatus: 1, podTime: row.podTime, podDate: dateKey(row.podTime), podSource: `POD锁:${row.source || ''}`, priority: 1 });
      }
    }
  }
}

function enrichAnalysisRows(map, rows = []) {
  const byBill = new Map([...map.values()].map(entry => [entry.shipmentCode, entry]));
  for (const row of rows || []) {
    const entry = byBill.get(billOf(row.shipmentCode || row.运单号));
    if (!entry) continue;
    entry.regionCode = entry.regionCode || String(firstValue(row, ['regionCode','区域','区域分类']) || '');
    entry.recipientProvince = entry.recipientProvince || String(firstValue(row, ['recipientProvince','收件省份','province']) || '');
    entry.lastState = String(firstValue(row, ['currentState','scanNormalizedState','primaryCategory','主分类','异常分类']) || entry.lastState || '');
    entry.fallbackAttempt = Math.max(entry.fallbackAttempt, positiveAttempt(row.podAttemptNo, Number(row.currentAttemptNo) >= 2 ? row.currentAttemptNo : 0, Number(row.派次) >= 2 ? row.派次 : 0));
    for (const d of listFromText(firstValue(row, ['派件中日期','deliveryDates']))) entry.trackDispatchDates.add(d);
    for (const d of listFromText(firstValue(row, ['派件分配日期','assignDates']))) entry.assignDates.add(d);
    const podLike = Number(row.isPod || 0) === 1 || row.是否POD === '是' || String(row.orderStatus || '') === '85' || String(row.currentState || '').toUpperCase() === 'POD';
    const podTime = String(firstValue(row, ['POD时间','podTime','podClosedAt','deliveredAt','latestEventTime','最后节点时间']) || '');
    const latestDesc = String(firstValue(row, ['latestEventDesc','最后节点','QC判断']) || '');
    if (podLike && dateKey(podTime) && (firstValue(row, ['POD时间','podTime','podClosedAt','deliveredAt']) || POD_RE.test(latestDesc))) {
      entry.pod = bestPod(entry.pod, { podStatus: 1, podTime, podDate: dateKey(podTime), podSource: '分析结果POD时间', priority: 2 });
    }
    entry.evidence.add('分析结果');
  }
}

function finalizeEntry(entry) {
  const deliveryDates = mergeDates([...entry.dailyDispatchDates], [...entry.trackDispatchDates]);
  const assignDates = mergeDates([...entry.assignDates]);
  const cutoff = entry.pod.podDate || '9999-12-31';
  const beforePodDelivery = deliveryDates.filter(d => d <= cutoff);
  const beforePodAssign = assignDates.filter(d => d <= cutoff);
  let attemptNo = 0, attemptSource = '';
  if (beforePodDelivery.length) { attemptNo = Math.min(3, beforePodDelivery.length); attemptSource = '日报W/Y+轨迹70真实派送日期'; }
  else if (beforePodAssign.length) { attemptNo = Math.min(3, beforePodAssign.length); attemptSource = '轨迹60派件分配日期'; }
  else if (entry.fallbackAttempt >= 2) { attemptNo = Math.min(3, entry.fallbackAttempt); attemptSource = '历史明确派次>=2兜底'; }
  const firstDispatchDate = beforePodDelivery[0] || beforePodAssign[0] || '';
  const podDate = entry.pod.podDate || '';
  return {
    ...entry,
    area: regionArea(entry.regionCode, entry.recipientProvince),
    dispatchDates: deliveryDates,
    assignDates,
    firstDispatchDate,
    attemptNo,
    attemptSource: entry.pod.podStatus ? attemptSource : attemptSource,
    podStatus: entry.pod.podStatus ? 1 : 0,
    podTime: entry.pod.podTime || '',
    podDate,
    podSource: entry.pod.podSource || '',
    signNaturalDays: podDate ? inclusiveDays(entry.firstReportDate, podDate) : 0,
    dispatchToPodDays: podDate && firstDispatchDate ? inclusiveDays(firstDispatchDate, podDate) : 0
  };
}

function persistFacts(db, facts, { reportDate = '', snapshotId = '', reason = '' } = {}) {
  ensureShopeeDeliveryTrackingSchema(db);
  const now = nowIso();
  const upsert = db.prepare(`INSERT INTO shopee_delivery_tracking(
      businessType,shipmentCode,firstReportDate,lastReportDate,regionCode,recipientProvince,area,
      dispatchDatesJson,assignDatesJson,firstDispatchDate,attemptNo,attemptSource,podStatus,podTime,podDate,podSource,
      signNaturalDays,dispatchToPodDays,lastState,sourceSnapshotId,evidenceJson,trackerVersion,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(businessType,shipmentCode) DO UPDATE SET
      firstReportDate=CASE WHEN excluded.firstReportDate<tracking.firstReportDate THEN excluded.firstReportDate ELSE tracking.firstReportDate END,
      lastReportDate=CASE WHEN excluded.lastReportDate>tracking.lastReportDate THEN excluded.lastReportDate ELSE tracking.lastReportDate END,
      regionCode=COALESCE(NULLIF(excluded.regionCode,''),tracking.regionCode),recipientProvince=COALESCE(NULLIF(excluded.recipientProvince,''),tracking.recipientProvince),area=COALESCE(NULLIF(excluded.area,''),tracking.area),
      dispatchDatesJson=excluded.dispatchDatesJson,assignDatesJson=excluded.assignDatesJson,firstDispatchDate=excluded.firstDispatchDate,
      attemptNo=excluded.attemptNo,attemptSource=excluded.attemptSource,podStatus=excluded.podStatus,podTime=excluded.podTime,podDate=excluded.podDate,podSource=excluded.podSource,
      signNaturalDays=excluded.signNaturalDays,dispatchToPodDays=excluded.dispatchToPodDays,lastState=excluded.lastState,sourceSnapshotId=excluded.sourceSnapshotId,evidenceJson=excluded.evidenceJson,trackerVersion=excluded.trackerVersion,updatedAt=excluded.updatedAt`);
  // SQLite table aliases are not accepted in the ON CONFLICT target on older builds;
  // use a second prepared statement if the fast upsert syntax is unavailable.
  const fallback = db.prepare(`INSERT OR REPLACE INTO shopee_delivery_tracking(
      businessType,shipmentCode,firstReportDate,lastReportDate,regionCode,recipientProvince,area,dispatchDatesJson,assignDatesJson,firstDispatchDate,attemptNo,attemptSource,podStatus,podTime,podDate,podSource,signNaturalDays,dispatchToPodDays,lastState,sourceSnapshotId,evidenceJson,trackerVersion,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const daily = db.prepare(`INSERT INTO shopee_delivery_tracking_daily(businessType,reportDate,shipmentCode,attemptNo,firstDispatchDate,dispatchDatesJson,podStatus,podTime,podDate,signNaturalDays,regionCode,area,sourceSnapshotId,evidenceJson,trackerVersion,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(businessType,reportDate,shipmentCode) DO UPDATE SET attemptNo=excluded.attemptNo,firstDispatchDate=excluded.firstDispatchDate,dispatchDatesJson=excluded.dispatchDatesJson,podStatus=excluded.podStatus,podTime=excluded.podTime,podDate=excluded.podDate,signNaturalDays=excluded.signNaturalDays,regionCode=excluded.regionCode,area=excluded.area,sourceSnapshotId=excluded.sourceSnapshotId,evidenceJson=excluded.evidenceJson,trackerVersion=excluded.trackerVersion,updatedAt=excluded.updatedAt`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const fact of facts) {
      const evidenceJson = JSON.stringify({ sources: [...fact.evidence], reason, dispatchDates: fact.dispatchDates, assignDates: fact.assignDates, podSource: fact.podSource });
      const values = [fact.businessType,fact.shipmentCode,fact.firstReportDate,fact.lastReportDate,fact.regionCode||'',fact.recipientProvince||'',fact.area||'',JSON.stringify(fact.dispatchDates),JSON.stringify(fact.assignDates),fact.firstDispatchDate||'',fact.attemptNo||0,fact.attemptSource||'',fact.podStatus||0,fact.podTime||'',fact.podDate||'',fact.podSource||'',fact.signNaturalDays||0,fact.dispatchToPodDays||0,fact.lastState||'',snapshotId||fact.sourceSnapshotId||'',evidenceJson,SHOPEE_DELIVERY_TRACKER_VERSION,now,now];
      try { upsert.run(...values); } catch { fallback.run(...values); }
      const observedDate = dateKey(reportDate || fact.lastReportDate || fact.firstReportDate);
      if (observedDate) daily.run(fact.businessType,observedDate,fact.shipmentCode,fact.attemptNo||0,fact.firstDispatchDate||'',JSON.stringify(fact.dispatchDates),fact.podStatus||0,fact.podTime||'',fact.podDate||'',fact.signNaturalDays||0,fact.regionCode||'',fact.area||'',snapshotId||fact.sourceSnapshotId||'',evidenceJson,SHOPEE_DELIVERY_TRACKER_VERSION,now,now);
    }
    const meta = db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
    meta.run('shopee_delivery_tracker_last_sync_at', now, now);
    meta.run('shopee_delivery_tracker_last_sync_count', String(facts.length), now);
    meta.run('shopee_delivery_tracker_version', SHOPEE_DELIVERY_TRACKER_VERSION, now);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  return facts.length;
}

export function syncShopeeDeliveryTrackingForRange({ db = getDb(), fromDate, toDate, businessTypes = ['SHOPEECN','SHOPEEVN'], snapshotId = '', reason = 'RANGE_BACKFILL', analysisRows = [], events = [] } = {}) {
  ensureShopeeDeliveryTrackingSchema(db);
  const from = dateKey(fromDate), to = dateKey(toDate || fromDate);
  if (!from || !to || from > to) throw new Error('SHOPEE派次追踪日期范围无效。');
  const types = new Set((businessTypes || []).map(v => String(v || '').toUpperCase()).filter(v => SHOPEE_TYPES.has(v)));
  const { map, batches } = seedMembership(db, from, to, types);
  if (!map.size) return { ok: true, tracked: 0, fromDate: from, toDate: to, types: [...types], reason, noData: true };
  overlayExisting(db, map);
  enrichAnalysisRows(map, analysisRows);
  enrichTrackEvidence(db, map, events);
  enrichPodLocks(db, map);
  const facts = [...map.values()].map(finalizeEntry);
  persistFacts(db, facts, { reportDate: to, snapshotId: snapshotId || batches.at(-1)?.snapshotId || '', reason });
  return {
    ok: true, tracked: facts.length, fromDate: from, toDate: to, types: [...types], reason,
    pod: facts.filter(f => f.podStatus).length,
    a1: facts.filter(f => f.podStatus && f.attemptNo === 1).length,
    a2: facts.filter(f => f.podStatus && f.attemptNo === 2).length,
    a3: facts.filter(f => f.podStatus && f.attemptNo >= 3).length,
    attemptUnknown: facts.filter(f => f.podStatus && !f.attemptNo).length,
    validSignDays: facts.filter(f => f.podStatus && f.signNaturalDays > 0).length
  };
}

export function syncShopeeDeliveryTrackingForReport({ db = getDb(), reportDate, snapshotId = '', analysisRows = [], events = [], reason = 'SHOPEE_RUN_COMPLETED' } = {}) {
  return syncShopeeDeliveryTrackingForRange({ db, fromDate: reportDate, toDate: reportDate, businessTypes: ['SHOPEECN','SHOPEEVN'], snapshotId, reason, analysisRows, events });
}

export function observeShopeeCarryRefreshRows(rows = [], { db = getDb(), reportDate, snapshotId = '', events = [] } = {}) {
  ensureShopeeDeliveryTrackingSchema(db);
  const bills = [...new Set((rows || []).map(row => billOf(row.shipmentCode || row.运单号)).filter(Boolean))];
  if (!bills.length) return { ok: true, tracked: 0 };
  const existing = new Map();
  for (const chunk of chunks(bills, 300)) {
    const marks = chunk.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT * FROM shopee_delivery_tracking WHERE shipmentCode IN (${marks})`).all(...chunk)) existing.set(`${row.businessType}|${row.shipmentCode}`, row);
  }
  const map = new Map();
  for (const row of rows) {
    const code = billOf(row.shipmentCode || row.运单号); if (!code) continue;
    const known = [...existing.entries()].find(([key]) => key.endsWith(`|${code}`));
    const businessType = SHOPEE_TYPES.has(String(row.businessType || '').toUpperCase()) ? String(row.businessType).toUpperCase() : known?.[1]?.businessType;
    if (!businessType) continue;
    const old = known?.[1] || {};
    const entry = {
      businessType, shipmentCode: code, firstReportDate: old.firstReportDate || dateKey(row.sourceReportDate || row.reportDate || reportDate), lastReportDate: dateKey(reportDate || row.reportDate) || old.lastReportDate || '',
      regionCode: row.regionCode || old.regionCode || '', recipientProvince: row.recipientProvince || old.recipientProvince || '',
      dailyDispatchDates: new Set(listFromJson(old.dispatchDatesJson)), trackDispatchDates: new Set(), assignDates: new Set(listFromJson(old.assignDatesJson)),
      pod: { podStatus: Number(old.podStatus || 0), podTime: old.podTime || '', podDate: old.podDate || '', podSource: old.podSource || '', priority: old.podStatus ? 3 : 99 },
      fallbackAttempt: positiveAttempt(old.attemptNo), lastState: old.lastState || '', sourceSnapshotId: snapshotId || old.sourceSnapshotId || '', evidence: new Set(['两小时遗留刷新'])
    };
    map.set(`${businessType}|${code}`, entry);
  }
  enrichAnalysisRows(map, rows);
  enrichTrackEvidence(db, map, events);
  enrichPodLocks(db, map);
  const facts = [...map.values()].map(finalizeEntry);
  persistFacts(db, facts, { reportDate, snapshotId, reason: 'TWO_HOUR_CARRY_REFRESH' });
  return { ok: true, tracked: facts.length };
}

export function loadShopeeDeliveryTrackingMap({ db = getDb(), businessType, bills = [] } = {}) {
  ensureShopeeDeliveryTrackingSchema(db);
  const type = String(businessType || '').toUpperCase();
  if (!SHOPEE_TYPES.has(type)) return new Map();
  const normalized = [...new Set((bills || []).map(billOf).filter(Boolean))];
  const out = new Map();
  for (const chunk of chunks(normalized, 400)) {
    const marks = chunk.map(() => '?').join(','); if (!marks) continue;
    for (const row of db.prepare(`SELECT * FROM shopee_delivery_tracking WHERE businessType=? AND shipmentCode IN (${marks})`).all(type, ...chunk)) out.set(row.shipmentCode, row);
  }
  return out;
}

export function getShopeeDeliveryTrackingSummary({ db = getDb(), businessType = '', fromDate = '', toDate = '' } = {}) {
  ensureShopeeDeliveryTrackingSchema(db);
  const type = String(businessType || '').toUpperCase();
  const where = [], args = [];
  if (SHOPEE_TYPES.has(type)) { where.push('businessType=?'); args.push(type); }
  if (dateKey(fromDate)) { where.push('firstReportDate>=?'); args.push(dateKey(fromDate)); }
  if (dateKey(toDate)) { where.push('firstReportDate<=?'); args.push(dateKey(toDate)); }
  const sql = `SELECT businessType,COUNT(*) total,SUM(podStatus) pod,SUM(CASE WHEN podStatus=1 AND attemptNo=1 THEN 1 ELSE 0 END) a1,SUM(CASE WHEN podStatus=1 AND attemptNo=2 THEN 1 ELSE 0 END) a2,SUM(CASE WHEN podStatus=1 AND attemptNo>=3 THEN 1 ELSE 0 END) a3,SUM(CASE WHEN podStatus=1 AND attemptNo=0 THEN 1 ELSE 0 END) attemptUnknown,ROUND(AVG(CASE WHEN podStatus=1 AND signNaturalDays>0 THEN signNaturalDays END),2) avgSignDays,ROUND(AVG(CASE WHEN podStatus=1 AND area='金边' AND signNaturalDays>0 THEN signNaturalDays END),2) ppAvgSignDays,ROUND(AVG(CASE WHEN podStatus=1 AND area='外省' AND signNaturalDays>0 THEN signNaturalDays END),2) pvAvgSignDays FROM shopee_delivery_tracking ${where.length ? `WHERE ${where.join(' AND ')}` : ''} GROUP BY businessType ORDER BY businessType`;
  return db.prepare(sql).all(...args);
}
