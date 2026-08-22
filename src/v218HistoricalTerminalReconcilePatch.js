import express from 'express';
import { getDb, nowIso } from './db.js';

const PATCH_ID = '2026-08-22-v218-history-terminal-reconcile-v1';
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
function chunks(values, size = 250) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
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
  const evidence = [row.primaryCategory, row.currentMainCategory, row.latestEventDesc].map(text).join(' ');
  const pod = Number(row.isPod || 0) === 1 || POD_RE.test(evidence);
  const returned = !pod && RETURN_RE.test(evidence);
  if (!pod && !returned) return null;
  return {
    reason: pod ? 'POD' : 'RETURNED',
    stateJson: {
      shipmentCode: bill(row.shipmentCode),
      reportDate: text(row.reportDate),
      primaryCategory: text(row.primaryCategory),
      currentMainCategory: text(row.currentMainCategory),
      latestEventDesc: text(row.latestEventDesc),
      latestEventTime: text(row.latestEventTime),
      currentState: pod ? 'POD' : 'RETURNED',
      ...(pod ? { 是否POD: '是' } : { 退回状态: '已退回' }),
      localTerminalEvidence: true
    },
    lastEventTime: text(row.latestEventTime),
    source: 'business_final_rows'
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
  if (!openRows.length) return { scanned: 0, closedPod: 0, closedReturned: 0 };

  const candidates = new Map(openRows.map(row => [bill(row.shipmentCode), row]));
  const evidence = new Map();
  const codes = [...candidates.keys()].filter(Boolean);

  for (const group of chunks(codes)) {
    const marks = group.map(() => '?').join(',');
    const currentRows = db.prepare(`
      SELECT shipmentCode,state,lastEventTime,stateJson
      FROM shipment_current_state
      WHERE shipmentCode IN (${marks})
    `).all(...group);
    for (const row of currentRows) {
      const code = bill(row.shipmentCode);
      const terminal = terminalFromCurrent(row);
      if (terminal) evidence.set(code, terminal);
    }
  }

  const unresolved = codes.filter(code => !evidence.has(code));
  for (const group of chunks(unresolved)) {
    const marks = group.map(() => '?').join(',');
    const finalRows = db.prepare(`
      SELECT shipmentCode,reportDate,isPod,primaryCategory,currentMainCategory,latestEventTime,latestEventDesc
      FROM business_final_rows
      WHERE businessType='SHOPEE' AND shipmentCode IN (${marks})
      ORDER BY shipmentCode,reportDate DESC
    `).all(...group);
    for (const row of finalRows) {
      const code = bill(row.shipmentCode);
      if (!code || evidence.has(code)) continue;
      const terminal = terminalFromFinal(row);
      if (terminal) evidence.set(code, terminal);
    }
  }

  if (!evidence.size) return { scanned: codes.length, closedPod: 0, closedReturned: 0 };
  const now = nowIso();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const updateCarry = db.prepare(`
    UPDATE carryover_open_items
    SET status='CLOSED',apiStatus='SUCCESS',closeReason=?,lastReportDate=?,stateJson=?,updatedAt=?
    WHERE shipmentCode=? AND status='OPEN'
  `);
  const updateCurrent = db.prepare(`
    UPDATE shipment_current_state
    SET state=?,apiStatus='SUCCESS',lastEventTime=CASE WHEN ?<>'' THEN ? ELSE lastEventTime END,stateJson=?,updatedAt=?
    WHERE shipmentCode=?
  `);
  let closedPod = 0, closedReturned = 0;
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
      if (terminal.reason === 'POD') closedPod += 1;
      else closedReturned += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { scanned: codes.length, closedPod, closedReturned };
}

function reconcileMiddleware(req, res, next) {
  try {
    const selection = selectionFrom(req);
    if (selection) {
      const result = reconcileLocalTerminalEvidence(selection);
      if (result.closedPod || result.closedReturned) {
        console.log(`[CE-QC][V218] local terminal reconcile ${JSON.stringify({ ...selection, ...result })}`);
        res.setHeader('X-CE-QC-History-Reconcile', `V218;pod=${result.closedPod};returned=${result.closedReturned}`);
      }
    }
  } catch (error) {
    console.warn('[CE-QC][V218] local terminal reconcile skipped:', error?.message || error);
  }
  next();
}

const previousGet = express.application.get;
express.application.get = function v218HistorySummaryGet(pathValue, ...handlers) {
  if (String(pathValue || '') === SUMMARY_ROUTE && handlers.length) {
    return previousGet.call(this, pathValue, reconcileMiddleware, ...handlers);
  }
  return previousGet.call(this, pathValue, ...handlers);
};

const previousPost = express.application.post;
express.application.post = function v218HistoryStartPost(pathValue, ...handlers) {
  if (String(pathValue || '') === START_ROUTE && handlers.length) {
    return previousPost.call(this, pathValue, reconcileMiddleware, ...handlers);
  }
  return previousPost.call(this, pathValue, ...handlers);
};

export function inspectV218HistoryTerminalReconcile(selection) {
  return selection ? reconcileLocalTerminalEvidence(selection) : { patchId: PATCH_ID };
}
export const V218_HISTORY_TERMINAL_RECONCILE_ID = PATCH_ID;
