import express from 'express';
import { getDb, nowIso } from './db.js';

const PATCH_ID = '2026-08-22-v219-history-terminal-evidence-parity-v1';
const SUMMARY_ROUTE = '/api/v183/history-refresh/summary';
const START_ROUTE = '/api/v183/history-refresh/start';
const TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const RETURN_RE = /RETURNED|RETURN_COMPLETED|已退回|退回完成|退件完成|R退回/i;
const POD_RE = /\bPOD\b|DELIVERED|签收|妥投|已妥投|Successfully delivered/i;

function text(value) { return String(value ?? '').trim(); }
function bill(value) { return text(value).toUpperCase(); }
function dateKey(value) {
  const v = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function selectionFrom(req) {
  const source = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const businessType = text(source.businessType).toUpperCase();
  const fromDate = dateKey(source.fromDate);
  const toDate = dateKey(source.toDate);
  if (!TYPES.has(businessType) || !fromDate || !toDate || fromDate > toDate) return null;
  return { businessType, fromDate, toDate };
}
function chunks(values, size = 220) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
function mergeTerminalMaps(podEvidence, returnEvidence, code, terminal) {
  if (!code || !terminal) return;
  if (terminal.reason === 'POD') podEvidence.set(code, terminal);
  else if (!returnEvidence.has(code)) returnEvidence.set(code, terminal);
}
function terminalFromCurrent(row = {}) {
  const state = text(row.state).toUpperCase();
  const json = safeJson(row.stateJson, {});
  const evidence = [
    state, json.currentState, json.scanNormalizedState, json.退回状态, json.primaryCategory,
    json.currentMainCategory, json.主分类, json.异常分类, json.latestEventDesc, json.最后节点
  ].map(text).join(' ');
  const pod = state === 'POD' || json.是否POD === '是' || String(json.orderStatus || '') === '85' || POD_RE.test(evidence);
  const returned = !pod && (state === 'RETURNED' || state === 'RETURN_COMPLETED' || json.退回状态 === '已退回' || RETURN_RE.test(evidence));
  if (!pod && !returned) return null;
  return {
    reason: pod ? 'POD' : 'RETURNED',
    stateJson: {
      ...json,
      currentState: pod ? 'POD' : 'RETURNED',
      ...(pod ? { 是否POD: '是' } : { 退回状态: '已退回' })
    },
    lastEventTime: text(row.lastEventTime),
    source: 'shipment_current_state'
  };
}
function terminalFromFinal(row = {}) {
  const raw = safeJson(row.rawJson, {});
  const evidence = [row.primaryCategory, row.currentMainCategory, row.latestEventDesc, raw.currentState, raw.退回状态, raw.primaryCategory, raw.主分类, raw.异常分类].map(text).join(' ');
  const pod = Number(row.isPod || 0) === 1 || raw.是否POD === '是' || String(raw.orderStatus || '') === '85' || POD_RE.test(evidence);
  const returned = !pod && RETURN_RE.test(evidence);
  if (!pod && !returned) return null;
  return {
    reason: pod ? 'POD' : 'RETURNED',
    stateJson: {
      ...raw,
      shipmentCode: bill(row.shipmentCode), reportDate: text(row.reportDate),
      primaryCategory: text(row.primaryCategory), currentMainCategory: text(row.currentMainCategory),
      latestEventDesc: text(row.latestEventDesc), latestEventTime: text(row.latestEventTime),
      currentState: pod ? 'POD' : 'RETURNED',
      ...(pod ? { 是否POD: '是' } : { 退回状态: '已退回' }),
      localTerminalEvidence: true
    },
    lastEventTime: text(row.latestEventTime),
    source: 'business_final_rows'
  };
}
function eventEvidence(row = {}) {
  const raw = safeJson(row.rawJson, {});
  return [
    row.eventCode, raw.eventCode, raw.trackingEventCode, raw.statusCode,
    raw.trackingEventDescZh, raw.trackingEventDesc, raw.trackingEventDescKm,
    raw.statusText, raw.remark, raw.place, raw.eventShop, raw.locationCode
  ].map(text).filter(Boolean).join(' ');
}
function terminalFromTrack(row = {}) {
  const code = text(row.eventCode || safeJson(row.rawJson, {}).eventCode);
  const evidence = eventEvidence(row);
  const pod = code === '80' || POD_RE.test(evidence);
  const returned = !pod && (code === '86' || RETURN_RE.test(evidence));
  if (!pod && !returned) return null;
  return {
    reason: pod ? 'POD' : 'RETURNED',
    stateJson: {
      shipmentCode: bill(row.shipmentCode),
      currentState: pod ? 'POD' : 'RETURNED',
      latestEventTime: text(row.eventTime),
      latestEventDesc: evidence,
      eventCode: code,
      ...(pod ? { 是否POD: '是' } : { 退回状态: '已退回' }),
      localTerminalEvidence: true
    },
    lastEventTime: text(row.eventTime),
    source: pod ? 'business_track_events:80/POD' : 'business_track_events:86/RETURN'
  };
}
function terminalFromDaily(row = {}) {
  const parsed = safeJson(row.rowJson, {});
  const raw = parsed?.raw && typeof parsed.raw === 'object' ? parsed.raw : parsed;
  const values = Object.entries(raw || {});
  const byNames = names => {
    const wanted = new Set(names.map(v => String(v).toLowerCase().replace(/[\s_\-]/g, '')));
    for (const [key, value] of values) {
      const normalized = String(key).toLowerCase().replace(/[\s_\-]/g, '');
      if (wanted.has(normalized) && value !== undefined && value !== null && text(value)) return text(value);
    }
    return '';
  };
  const status = byNames(['状态标识','状态代码','status','statuscode']).toUpperCase();
  const desc = byNames(['状态说明','状态描述','statusdesc','statusdescription','statusname']);
  const evidence = [status, desc, raw.currentState, raw.退回状态, raw.primaryCategory, raw.主分类, raw.异常分类].map(text).join(' ');
  const pod = raw.是否POD === '是' || String(raw.orderStatus || '') === '85' || POD_RE.test(evidence);
  const returned = !pod && (status === 'R' || RETURN_RE.test(evidence));
  if (!pod && !returned) return null;
  return {
    reason: pod ? 'POD' : 'RETURNED',
    stateJson: {
      ...parsed,
      shipmentCode: bill(row.shipmentCode),
      reportDate: text(row.reportDate),
      currentState: pod ? 'POD' : 'RETURNED',
      latestEventDesc: desc || evidence,
      ...(pod ? { 是否POD: '是' } : { 退回状态: '已退回' }),
      localTerminalEvidence: true
    },
    lastEventTime: '',
    source: 'unified_import_rows:terminal-description'
  };
}

function reconcileLocalTerminalEvidence(selection, db = getDb()) {
  const openRows = db.prepare(`
    SELECT shipmentCode,stateJson,lastReportDate
    FROM carryover_open_items
    WHERE status='OPEN' AND UPPER(COALESCE(businessType,''))=?
      AND sourceReportDate BETWEEN ? AND ?
    ORDER BY sourceReportDate,shipmentCode
  `).all(selection.businessType, selection.fromDate, selection.toDate);
  if (!openRows.length) return { scanned: 0, closedPod: 0, closedReturned: 0, evidenceSources: {} };

  const candidates = new Map(openRows.map(row => [bill(row.shipmentCode), row]));
  const codes = [...candidates.keys()].filter(Boolean);
  const podEvidence = new Map();
  const returnEvidence = new Map();

  for (const group of chunks(codes, 300)) {
    const marks = group.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT shipmentCode,state,lastEventTime,stateJson FROM shipment_current_state WHERE shipmentCode IN (${marks})`).all(...group)) {
      mergeTerminalMaps(podEvidence, returnEvidence, bill(row.shipmentCode), terminalFromCurrent(row));
    }
  }

  for (const group of chunks(codes, 300)) {
    const marks = group.map(() => '?').join(',');
    let rows = [];
    try {
      rows = db.prepare(`SELECT shipmentCode,reportDate,isPod,primaryCategory,currentMainCategory,latestEventTime,latestEventDesc,rawJson FROM business_final_rows WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,reportDate DESC`).all(...group);
    } catch {}
    for (const row of rows) mergeTerminalMaps(podEvidence, returnEvidence, bill(row.shipmentCode), terminalFromFinal(row));
  }

  for (const group of chunks(codes, 220)) {
    const marks = group.map(() => '?').join(',');
    let rows = [];
    try {
      rows = db.prepare(`SELECT shipmentCode,eventTime,eventCode,rawJson,createdAt FROM business_track_events WHERE businessType='SHOPEE' AND shipmentCode IN (${marks}) ORDER BY shipmentCode,eventTime,createdAt,id`).all(...group);
    } catch {}
    for (const row of rows) mergeTerminalMaps(podEvidence, returnEvidence, bill(row.shipmentCode), terminalFromTrack(row));
  }

  for (const group of chunks(codes, 450)) {
    const marks = group.map(() => '?').join(',');
    let rows = [];
    try { rows = db.prepare(`SELECT shipmentCode,podTime,source FROM business_pod_locks WHERE shipmentCode IN (${marks})`).all(...group); } catch {}
    for (const row of rows) {
      const code = bill(row.shipmentCode);
      if (!code) continue;
      podEvidence.set(code, {
        reason: 'POD',
        stateJson: { shipmentCode: code, currentState: 'POD', 是否POD: '是', POD时间: text(row.podTime), localTerminalEvidence: true },
        lastEventTime: text(row.podTime),
        source: `business_pod_locks:${text(row.source)}`
      });
    }
  }

  for (const group of chunks(codes, 180)) {
    const marks = group.map(() => '?').join(',');
    let rows = [];
    try {
      rows = db.prepare(`SELECT shipmentCode,reportDate,rowJson FROM unified_import_rows WHERE businessType=? AND reportDate BETWEEN ? AND ? AND shipmentCode IN (${marks}) ORDER BY shipmentCode,reportDate DESC,rowNumber DESC`).all(selection.businessType, selection.fromDate, selection.toDate, ...group);
    } catch {}
    for (const row of rows) mergeTerminalMaps(podEvidence, returnEvidence, bill(row.shipmentCode), terminalFromDaily(row));
  }

  const evidence = new Map();
  for (const code of codes) {
    if (podEvidence.has(code)) evidence.set(code, podEvidence.get(code));
    else if (returnEvidence.has(code)) evidence.set(code, returnEvidence.get(code));
  }
  if (!evidence.size) return { scanned: codes.length, closedPod: 0, closedReturned: 0, evidenceSources: {} };

  const now = nowIso();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const updateCarry = db.prepare(`UPDATE carryover_open_items SET status='CLOSED',apiStatus='SUCCESS',closeReason=?,lastReportDate=?,stateJson=?,updatedAt=? WHERE shipmentCode=? AND status='OPEN'`);
  const updateCurrent = db.prepare(`UPDATE shipment_current_state SET state=?,apiStatus='SUCCESS',lastEventTime=CASE WHEN ?<>'' THEN ? ELSE lastEventTime END,stateJson=?,updatedAt=? WHERE shipmentCode=?`);
  let closedPod = 0, closedReturned = 0;
  const evidenceSources = {};
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [code, terminal] of evidence) {
      const existing = candidates.get(code) || {};
      const merged = {
        ...safeJson(existing.stateJson, {}),
        ...terminal.stateJson,
        historyTerminalReconciledAt: now,
        historyTerminalReconcileSource: terminal.source
      };
      const changed = updateCarry.run(terminal.reason, today, JSON.stringify(merged), now, code)?.changes || 0;
      if (!changed) continue;
      updateCurrent.run(terminal.reason, terminal.lastEventTime || '', terminal.lastEventTime || '', JSON.stringify(merged), now, code);
      evidenceSources[terminal.source] = Number(evidenceSources[terminal.source] || 0) + 1;
      if (terminal.reason === 'POD') closedPod += 1;
      else closedReturned += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { scanned: codes.length, closedPod, closedReturned, evidenceSources };
}

function reconcileMiddleware(req, res, next) {
  try {
    const selection = selectionFrom(req);
    if (selection) {
      const result = reconcileLocalTerminalEvidence(selection);
      console.log(`[CE-QC][V219] history terminal reconcile ${JSON.stringify({ ...selection, ...result })}`);
      res.setHeader('X-CE-QC-History-Reconcile', `V219;scanned=${result.scanned};pod=${result.closedPod};returned=${result.closedReturned}`);
    }
  } catch (error) {
    console.warn('[CE-QC][V219] history terminal reconcile skipped:', error?.message || error);
  }
  next();
}

const previousGet = express.application.get;
express.application.get = function v219HistorySummaryGet(pathValue, ...handlers) {
  if (String(pathValue || '') === SUMMARY_ROUTE && handlers.length) return previousGet.call(this, pathValue, reconcileMiddleware, ...handlers);
  return previousGet.call(this, pathValue, ...handlers);
};

const previousPost = express.application.post;
express.application.post = function v219HistoryStartPost(pathValue, ...handlers) {
  if (String(pathValue || '') === START_ROUTE && handlers.length) return previousPost.call(this, pathValue, reconcileMiddleware, ...handlers);
  return previousPost.call(this, pathValue, ...handlers);
};

export function inspectV218HistoryTerminalReconcile(selection) {
  return selection ? reconcileLocalTerminalEvidence(selection) : { patchId: PATCH_ID };
}
export const V218_HISTORY_TERMINAL_RECONCILE_ID = PATCH_ID;
