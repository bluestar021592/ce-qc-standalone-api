import { getDb, nowIso } from './db.js';

export const V203_MANUAL_EVIDENCE_VERSION = '2026-08-18-v203-manual-query-evidence-universe-v1';
export const V203_BUSINESS_TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const BUSINESS_SET = new Set(V203_BUSINESS_TYPES);
const POD_RE = /\bPOD\b|DELIVERED|签收|妥投|已妥投|4004/i;
const RETURN_RE = /RETURN(?:ED|_COMPLETED)?|退回完成|已退回|退件完成|P4008/i;
const CANCEL_RE = /ORDER_CANCELLED|CANCELLED|CANCELED|订单取消|已取消|取消订单/i;
const PENDING_RE = /\bPENDING\b|Pending|派送失败|无法联系|无人接听|地址错误|150/i;
const DELIVERY_RE = /Parcel start to deliver|out\s*for\s*delivery|派送中|派件中|正在为您派送|正在派送|Deliver to Buyer|4003/i;

export function normalizeV203BusinessType(value = '') {
  const type = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (BUSINESS_SET.has(type)) return type;
  if (type === 'SHOPEE') return 'SHOPEECN';
  if (type === 'CCSL') return 'CE';
  return '';
}
function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; }
}
function dateKey(value = '') {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
function billOf(value = {}) {
  if (typeof value === 'string') return String(value || '').trim().toUpperCase();
  return String(value.shipmentCode || value.运单号 || value.shipmentNo || value.waybill || value.code || '').trim().toUpperCase();
}
function rowTime(row = {}) {
  return String(row.eventTime || row.creationDate || row.lastUpdateDate || row.updatedAt || row.createdAt || row.reportTime || '').trim();
}
function rowCode(row = {}) {
  return String(row.eventCode || row.trackingEventCode || row.statusCode || row.shipmentStatus || row.orderStatus || '').trim();
}
function rowText(row = {}) {
  return [row.eventCode,row.trackingEventCode,row.statusCode,row.shipmentStatus,row.statusText,row.trackingEventDescZh,row.trackingEventDesc,row.trackingEventDescKm,row.place,row.locationCode,row.eventShop,row.operator,row.eventCourier,row.remark,row.primaryCategory,row.主分类,row.异常分类,row.currentState,row.scanNormalizedState,row.退回状态]
    .map(value => String(value || '').trim()).filter(Boolean).join(' ');
}
function groupByBill(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const bill = billOf(row); if (!bill) continue;
    if (!map.has(bill)) map.set(bill, []);
    map.get(bill).push(row);
  }
  return map;
}
function latestOf(rows = []) {
  const usable = [...rows].filter(row => dateKey(rowTime(row))).sort((a,b) => rowTime(a).localeCompare(rowTime(b)));
  return usable.at(-1) || rows.at(-1) || {};
}
function scanForBill(rows = [], bill = '') {
  return rows.find(row => billOf(row) === bill) || {};
}
function terminalTruth({ scan = {}, shipment = {}, events = [], analysis = {} } = {}) {
  const all = [scan, shipment, analysis, ...events];
  const text = all.map(rowText).join(' ');
  const codes = all.map(rowCode).map(value => String(value || '').toUpperCase());
  const pod = String(scan.orderStatus || analysis.orderStatus || '') === '85' || analysis.是否POD === '是' || codes.includes('80') || codes.includes('4004') || POD_RE.test(text);
  const returned = !pod && (codes.includes('86') || codes.includes('P4008') || RETURN_RE.test(text));
  const cancelled = !pod && !returned && (String(scan.orderStatus || analysis.orderStatus || '') === '10' || CANCEL_RE.test(text));
  return { pod, returned, cancelled, terminal: pod || returned || cancelled, state: pod ? 'POD' : returned ? 'RETURNED' : cancelled ? 'CANCELLED' : 'OPEN' };
}
function classifyOpen(events = [], analysis = {}) {
  const latest = latestOf(events);
  const text = [rowText(latest),rowText(analysis)].join(' ');
  if (PENDING_RE.test(text)) return 'Pending';
  if (DELIVERY_RE.test(text)) return '派送中';
  if (/shop|store|门店|加盟|CP\d|FS\d/i.test(text)) return '门店/加盟店';
  if (/cycle\s*count|盘点/i.test(text)) return '盘点';
  if (/\bOC\b|OC\d/i.test(text)) return 'OC';
  return String(analysis.primaryCategory || analysis.主分类 || analysis.异常分类 || '手动查询未闭环');
}
function extractRawField(objects = [], keys = []) {
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue;
    for (const key of keys) {
      const value = object[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
  }
  return '';
}
export function ensureV203ManualEvidenceSchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_query_evidence (
      businessType TEXT NOT NULL,
      shipmentCode TEXT NOT NULL,
      observedDate TEXT NOT NULL,
      sourceType TEXT NOT NULL DEFAULT 'MANUAL_QUERY',
      terminalState TEXT NOT NULL DEFAULT 'OPEN',
      primaryCategory TEXT,
      latestEventTime TEXT,
      latestEventDesc TEXT,
      regionCode TEXT,
      recipientProvince TEXT,
      orderTime TEXT,
      podTime TEXT,
      scanJson TEXT NOT NULL DEFAULT '{}',
      shipmentJson TEXT NOT NULL DEFAULT '{}',
      trackEventsJson TEXT NOT NULL DEFAULT '[]',
      exceptionItemsJson TEXT NOT NULL DEFAULT '[]',
      analysisJson TEXT NOT NULL DEFAULT '{}',
      queryMetaJson TEXT NOT NULL DEFAULT '{}',
      firstObservedAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (businessType, shipmentCode, observedDate)
    );
    CREATE INDEX IF NOT EXISTS idx_manual_query_evidence_range ON manual_query_evidence(businessType, observedDate, terminalState);
    CREATE INDEX IF NOT EXISTS idx_manual_query_evidence_bill ON manual_query_evidence(shipmentCode, updatedAt);
  `);
  return true;
}
function upsertTrackingPool(db, record) {
  const now = nowIso();
  const closed = ['POD','RETURNED','CANCELLED'].includes(record.terminalState);
  const closeReason = closed ? record.terminalState : '';
  const stateJson = JSON.stringify({
    sourceOrigin:'MANUAL_QUERY', manualEvidenceVersion:V203_MANUAL_EVIDENCE_VERSION,
    businessType:record.businessType, shipmentCode:record.shipmentCode,
    currentState:record.terminalState, primaryCategory:record.primaryCategory,
    latestEventTime:record.latestEventTime, latestEventDesc:record.latestEventDesc,
    最后节点时间:record.latestEventTime, 最后节点:record.latestEventDesc,
    regionCode:record.regionCode, recipientProvince:record.recipientProvince,
    是否POD:record.terminalState==='POD'?'是':'否',
    退回状态:record.terminalState==='RETURNED'?'已退回':'',
    订单取消:record.terminalState==='CANCELLED'?'是':'否'
  });
  try {
    db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt)
      VALUES(?,?,?,?,?,'SUCCESS',?,?,?)
      ON CONFLICT(shipmentCode) DO UPDATE SET
        businessType=excluded.businessType,
        reportDate=CASE WHEN excluded.reportDate>=shipment_current_state.reportDate THEN excluded.reportDate ELSE shipment_current_state.reportDate END,
        state=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','CANCELLED') THEN shipment_current_state.state ELSE excluded.state END,
        apiStatus='SUCCESS',
        lastEventTime=CASE WHEN COALESCE(excluded.lastEventTime,'')>=COALESCE(shipment_current_state.lastEventTime,'') THEN excluded.lastEventTime ELSE shipment_current_state.lastEventTime END,
        stateJson=CASE WHEN COALESCE(excluded.lastEventTime,'')>=COALESCE(shipment_current_state.lastEventTime,'') THEN excluded.stateJson ELSE shipment_current_state.stateJson END,
        updatedAt=excluded.updatedAt`)
      .run(record.shipmentCode,record.businessType,record.observedDate,'MANUAL_QUERY',closed?record.terminalState:(record.primaryCategory||'OPEN'),record.latestEventTime||'',stateJson,now);
  } catch {}
  try {
    db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt)
      VALUES(?,?,?,?,? ,?,?,'SUCCESS',?,?,?,?)
      ON CONFLICT(shipmentCode) DO UPDATE SET
        businessType=excluded.businessType,
        lastReportDate=CASE WHEN excluded.lastReportDate>=carryover_open_items.lastReportDate THEN excluded.lastReportDate ELSE carryover_open_items.lastReportDate END,
        lastSnapshotId='MANUAL_QUERY',
        status=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','CANCELLED') THEN 'CLOSED' ELSE excluded.status END,
        apiStatus='SUCCESS',
        closeReason=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','CANCELLED') THEN carryover_open_items.closeReason ELSE excluded.closeReason END,
        stateJson=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','CANCELLED') THEN carryover_open_items.stateJson ELSE excluded.stateJson END,
        updatedAt=excluded.updatedAt`)
      .run(record.shipmentCode,record.businessType,record.observedDate,record.observedDate,'MANUAL_QUERY','MANUAL_QUERY',closed?'CLOSED':'OPEN',closeReason,stateJson,now,now);
  } catch {}
}
export function persistV203ManualQuery({ requestedBusinessType, reportDate, payload = {}, requestMeta = {} } = {}) {
  const businessType = normalizeV203BusinessType(requestedBusinessType);
  const observedDate = dateKey(reportDate) || dateKey(payload.reportDate) || new Date().toISOString().slice(0,10);
  const shipmentCodes = [...new Set((payload.shipmentCodes || []).map(billOf).filter(Boolean))];
  if (!businessType || !shipmentCodes.length) return { ok:false, persisted:0, reason:'INVALID_BUSINESS_OR_EMPTY' };
  const db = getDb(); ensureV203ManualEvidenceSchema(db);
  const scanRows = payload.scanRows || [];
  const shipmentRows = payload.shipmentRows || [];
  const trackEvents = payload.trackEvents || [];
  const exceptionItems = payload.exceptionItems || [];
  const analyzedRows = payload.rows || [];
  const shipmentMap = groupByBill(shipmentRows), eventMap = groupByBill(trackEvents), exceptionMap = groupByBill(exceptionItems), analysisMap = groupByBill(analyzedRows);
  const insert = db.prepare(`INSERT INTO manual_query_evidence(
      businessType,shipmentCode,observedDate,sourceType,terminalState,primaryCategory,latestEventTime,latestEventDesc,regionCode,recipientProvince,orderTime,podTime,
      scanJson,shipmentJson,trackEventsJson,exceptionItemsJson,analysisJson,queryMetaJson,firstObservedAt,updatedAt)
    VALUES(?,?,?,'MANUAL_QUERY',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(businessType,shipmentCode,observedDate) DO UPDATE SET
      terminalState=excluded.terminalState,primaryCategory=excluded.primaryCategory,latestEventTime=excluded.latestEventTime,latestEventDesc=excluded.latestEventDesc,
      regionCode=COALESCE(NULLIF(excluded.regionCode,''),manual_query_evidence.regionCode),recipientProvince=COALESCE(NULLIF(excluded.recipientProvince,''),manual_query_evidence.recipientProvince),
      orderTime=COALESCE(NULLIF(excluded.orderTime,''),manual_query_evidence.orderTime),podTime=COALESCE(NULLIF(excluded.podTime,''),manual_query_evidence.podTime),
      scanJson=excluded.scanJson,shipmentJson=excluded.shipmentJson,trackEventsJson=excluded.trackEventsJson,exceptionItemsJson=excluded.exceptionItemsJson,analysisJson=excluded.analysisJson,queryMetaJson=excluded.queryMetaJson,updatedAt=excluded.updatedAt`);
  const now = nowIso(); let persisted = 0; const records = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const shipmentCode of shipmentCodes) {
      const scan = scanForBill(scanRows,shipmentCode);
      const shipment = (shipmentMap.get(shipmentCode)||[])[0] || {};
      const events = eventMap.get(shipmentCode)||[];
      const exceptions = exceptionMap.get(shipmentCode)||[];
      const analysis = (analysisMap.get(shipmentCode)||[])[0] || {};
      const terminal = terminalTruth({scan,shipment,events,analysis});
      const latest = latestOf(events.length?events:[shipment,scan].filter(Boolean));
      const latestEventTime = rowTime(latest) || String(analysis.latestEventTime || analysis.最后节点时间 || '');
      const latestEventDesc = rowText(latest) || String(analysis.latestEventDesc || analysis.最后节点 || analysis.primaryCategory || '');
      const primaryCategory = terminal.terminal ? terminal.state : classifyOpen(events,analysis);
      const candidates = [analysis,shipment,scan,...events];
      const regionCode = extractRawField(candidates,['regionCode','区域','区域分类']);
      const recipientProvince = extractRawField(candidates,['recipientProvince','收件省份','province','destinationProvince']);
      const orderTime = extractRawField(candidates,['orderTime','下单时间','下单日期','creationDate']);
      const podTime = terminal.pod ? (extractRawField(candidates,['POD时间','podTime','deliveredAt']) || latestEventTime) : '';
      const record={businessType,shipmentCode,observedDate,terminalState:terminal.state,primaryCategory,latestEventTime,latestEventDesc,regionCode,recipientProvince,orderTime,podTime};
      insert.run(businessType,shipmentCode,observedDate,terminal.state,primaryCategory,latestEventTime,latestEventDesc,regionCode,recipientProvince,orderTime,podTime,JSON.stringify(scan||{}),JSON.stringify(shipment||{}),JSON.stringify(events),JSON.stringify(exceptions),JSON.stringify(analysis||{}),JSON.stringify({...requestMeta,sourceOrigin:'MANUAL_QUERY',evidenceVersion:V203_MANUAL_EVIDENCE_VERSION}),now,now);
      records.push(record); persisted++;
    }
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  for (const record of records) upsertTrackingPool(db,record);
  return { ok:true,persisted,businessType,reportDate:observedDate,records };
}
export function listV203ManualEvidence({ businessType, fromDate = '', toDate = '' } = {}) {
  const type = normalizeV203BusinessType(businessType);
  if (!type) return [];
  const db = getDb(); ensureV203ManualEvidenceSchema(db);
  const from = dateKey(fromDate) || '0000-01-01', to = dateKey(toDate) || '9999-12-31';
  return db.prepare(`SELECT * FROM manual_query_evidence WHERE businessType=? AND observedDate BETWEEN ? AND ? ORDER BY observedDate,shipmentCode`).all(type,from,to).map(row=>({
    ...row,
    scan:safeJson(row.scanJson,{}),shipment:safeJson(row.shipmentJson,{}),trackEvents:safeJson(row.trackEventsJson,[]),exceptionItems:safeJson(row.exceptionItemsJson,[]),analysis:safeJson(row.analysisJson,{}),queryMeta:safeJson(row.queryMetaJson,{})
  }));
}
export function auditV203Waybills(bills = []) {
  const normalized=[...new Set((bills||[]).map(billOf).filter(Boolean))].slice(0,500);
  const db=getDb();ensureV203ManualEvidenceSchema(db);const result=[];
  const hasTable=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));
  for(const bill of normalized){
    const found=[];let latest=null;
    const probes=[
      ['unified_import_rows','SELECT businessType,reportDate,rowJson FROM unified_import_rows WHERE shipmentCode=? ORDER BY reportDate DESC LIMIT 5'],
      ['manual_query_evidence','SELECT businessType,observedDate reportDate,analysisJson rowJson,latestEventTime,latestEventDesc,terminalState FROM manual_query_evidence WHERE shipmentCode=? ORDER BY observedDate DESC,updatedAt DESC LIMIT 5'],
      ['shipment_current_state','SELECT businessType,reportDate,stateJson rowJson,lastEventTime,state terminalState FROM shipment_current_state WHERE shipmentCode=? ORDER BY reportDate DESC LIMIT 5'],
      ['carryover_open_items','SELECT businessType,sourceReportDate reportDate,stateJson rowJson,updatedAt lastEventTime,closeReason terminalState FROM carryover_open_items WHERE shipmentCode=? LIMIT 5'],
      ['business_final_rows','SELECT businessType,reportDate,rawJson rowJson,latestEventTime,latestEventDesc FROM business_final_rows WHERE shipmentCode=? ORDER BY reportDate DESC LIMIT 5'],
      ['business_track_events','SELECT businessType,reportDate,rawJson rowJson,eventTime lastEventTime,eventCode latestEventDesc FROM business_track_events WHERE shipmentCode=? ORDER BY eventTime DESC LIMIT 5']
    ];
    for(const [table,sql] of probes){if(!hasTable(table))continue;let rows=[];try{rows=db.prepare(sql).all(bill);}catch{}if(rows.length){found.push({table,count:rows.length,rows});for(const row of rows){if(!latest||String(row.lastEventTime||row.reportDate||'')>String(latest.lastEventTime||latest.reportDate||''))latest={...row,table};}}}
    result.push({shipmentCode:bill,foundIn:found.map(item=>item.table),dailyMembership:found.some(item=>item.table==='unified_import_rows'),manualEvidence:found.some(item=>item.table==='manual_query_evidence'),latest,details:found});
  }
  return result;
}
