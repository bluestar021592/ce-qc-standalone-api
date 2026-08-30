import express from 'express';
import { startCarryoverRefreshScheduler } from './carryoverRefreshScheduler.js';
import { getDb } from './db.js';
import { SHOPEE, loadBusinessState, saveBusinessState } from './businessStore.js';
import { WHPP, loadWhppState, saveWhppState } from './whppStore.js';

export const V98_CARRY_REFRESH_ENDPOINT_ID = '2026-08-14-v98-backend-owned-open-carry-refresh-v4';
export const V98_RUNTIME_CARRY_HYDRATION_ID = '2026-08-30-v374-runtime-carry-hydration-v3';

const CCSL_RUN_ROUTES = new Set(['/api/run','/api/run/start','/api/resume','/api/run/resume']);
const SHOPEE_RUN_ROUTES = new Set(['/api/shopee/run/start','/api/shopee/run/resume']);
const WHPP_RUN_ROUTES = new Set(['/api/whpp/run/start','/api/whpp/run/resume']);
const CCSL_TYPES = ['CE','CEAF','TBKH','ALI1688','CCSL'];
const SHOPEE_TYPES = ['SHOPEECN','SHOPEEVN','SHOPEE'];
const WHPP_TYPES = ['WHPP'];

function parseJson(value, fallback = {}) {
  try { return JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}

function normalizeDate(value) {
  const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function latestValidReportDate(db) {
  return normalizeDate(db.prepare(`
    SELECT reportDate FROM unified_import_batches
    WHERE status='VALID'
    ORDER BY reportDate DESC,createdAt DESC,batchId DESC LIMIT 1
  `).get()?.reportDate || '');
}

function loadOpenCarryRows(db, reportDate, businessTypes, businessStateType = '') {
  if (!reportDate || !businessTypes.length) return [];
  const placeholders = businessTypes.map(() => '?').join(',');
  const joinBusinessDaily = businessStateType === SHOPEE
    ? "LEFT JOIN business_daily_parse_rows b ON b.businessType='SHOPEE' AND b.reportDate=c.sourceReportDate AND b.shipmentCode=c.shipmentCode"
    : '';
  return db.prepare(`
    SELECT c.shipmentCode,c.businessType,c.sourceReportDate,c.lastReportDate,c.stateJson,
           s.businessType AS currentBusinessType,s.stateJson AS currentStateJson
           ${businessStateType === SHOPEE ? ',b.recipient_group AS historicalRecipientGroup,b.rowJson AS historicalRowJson' : ''}
    FROM carryover_open_items c
    LEFT JOIN shipment_current_state s ON s.shipmentCode=c.shipmentCode
    ${joinBusinessDaily}
    WHERE UPPER(COALESCE(c.status,''))='OPEN'
      AND c.sourceReportDate<?
      AND UPPER(COALESCE(c.businessType,'')) IN (${placeholders})
    ORDER BY c.sourceReportDate,c.shipmentCode
  `).all(reportDate, ...businessTypes);
}

function uniqueBills(rows = []) {
  return [...new Set(rows.map(row => String(row.shipmentCode || '').trim().toUpperCase()).filter(Boolean))];
}

function inferShopeePriorRow(row = {}) {
  const carrySaved = parseJson(row.stateJson, {});
  const currentSaved = parseJson(row.currentStateJson, {});
  const historicalSaved = parseJson(row.historicalRowJson, {});
  const saved = { ...carrySaved, ...historicalSaved, ...currentSaved };
  const storedType = String(row.businessType || '').trim().toUpperCase();
  const currentType = String(row.currentBusinessType || '').trim().toUpperCase();
  const embeddedType = String(saved.businessType || saved.sourceBusinessType || '').trim().toUpperCase();
  const historicalGroup = String(row.historicalRecipientGroup || '').trim().toUpperCase();
  const recipientGroup = String(saved.recipient_group || saved.recipientGroup || historicalGroup || '').trim().toUpperCase();
  const resolvedType = ['SHOPEECN','SHOPEEVN'].includes(storedType)
    ? storedType
    : (['SHOPEECN','SHOPEEVN'].includes(currentType)
        ? currentType
        : (['SHOPEECN','SHOPEEVN'].includes(embeddedType)
            ? embeddedType
            : (recipientGroup === 'CN' ? 'SHOPEECN' : (recipientGroup === 'VN' ? 'SHOPEEVN' : 'SHOPEE'))));
  const resolvedGroup = recipientGroup || (resolvedType === 'SHOPEECN' ? 'CN' : (resolvedType === 'SHOPEEVN' ? 'VN' : 'OTHER'));
  return {
    ...saved,
    shipmentCode: String(row.shipmentCode || '').trim().toUpperCase(),
    运单号: String(row.shipmentCode || '').trim().toUpperCase(),
    businessType: resolvedType,
    recipient_group: ['CN','VN'].includes(resolvedGroup) ? resolvedGroup : 'OTHER',
    recipient_group_reason: saved.recipient_group_reason || 'V374_HISTORICAL_OPEN_REHYDRATE',
    sourceDate: row.sourceReportDate || '',
    sourceReportDate: row.sourceReportDate || '',
    lastReportDate: row.lastReportDate || '',
    sourceType: 'HISTORICAL_CARRY'
  };
}

function rewriteCcslCarry(db, reportDate) {
  const row = db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get();
  if (!row) return { count: 0, changed: false, legacy: 0 };
  const state = parseJson(row.valueJson, {});
  const date = normalizeDate(state.reportDate) || reportDate;
  if (!date) return { count: 0, changed: false, legacy: 0 };
  const carryRows = loadOpenCarryRows(db, date, CCSL_TYPES);
  const carryBills = uniqueBills(carryRows);
  const legacy = carryRows.filter(item => String(item.businessType || '').toUpperCase() === 'CCSL').length;
  const previous = [...new Set((state.carryBills || state.nextCarryBills || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
  const changed = previous.length !== carryBills.length || previous.some((bill, index) => bill !== carryBills[index]);
  const next = {
    ...state,
    reportDate: date,
    carryBills,
    nextCarryBills: carryBills,
    carryHydration: {
      source: V98_RUNTIME_CARRY_HYDRATION_ID,
      hydratedAt: new Date().toISOString(),
      historicalOpen: carryBills.length,
      legacyBusinessRows: legacy,
      acceptedBusinessTypes: CCSL_TYPES
    }
  };
  if (changed || normalizeDate(state.reportDate) !== date) {
    db.prepare("UPDATE app_state SET valueJson=?,updatedAt=? WHERE key='current'").run(JSON.stringify(next), new Date().toISOString());
  }
  return { count: carryBills.length, changed, legacy };
}

function rewriteShopeeCarry(db, reportDate) {
  const state = loadBusinessState(SHOPEE);
  const date = normalizeDate(state.reportDate) || reportDate;
  if (!date) return { count: 0, changed: false, legacy: 0, unresolvedGroup: 0 };
  const carryRows = loadOpenCarryRows(db, date, SHOPEE_TYPES, SHOPEE);
  const priorByBill = new Map();
  for (const row of carryRows.map(inferShopeePriorRow)) {
    const bill = String(row.shipmentCode || '').trim().toUpperCase();
    if (!bill || priorByBill.has(bill)) continue;
    priorByBill.set(bill, row);
  }
  const priorCarryRows = [...priorByBill.values()];
  const eligible = priorCarryRows.filter(row => ['CN','VN'].includes(String(row.recipient_group || '').toUpperCase()));
  const carryBills = uniqueBills(eligible);
  const legacy = carryRows.filter(item => String(item.businessType || '').toUpperCase() === 'SHOPEE').length;
  const unresolvedGroup = priorCarryRows.length - eligible.length;
  const previous = [...new Set((state.carryBills || state.nextCarryBills || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
  const changed = previous.length !== carryBills.length || previous.some((bill, index) => bill !== carryBills[index]);
  const next = {
    ...state,
    reportDate: date,
    carryBills,
    nextCarryBills: carryBills,
    priorCarryRows: eligible,
    carryHydration: {
      source: V98_RUNTIME_CARRY_HYDRATION_ID,
      hydratedAt: new Date().toISOString(),
      historicalOpen: carryBills.length,
      legacyBusinessRows: legacy,
      unresolvedGroup,
      acceptedBusinessTypes: SHOPEE_TYPES
    }
  };
  saveBusinessState(next, SHOPEE);
  return { count: carryBills.length, changed, legacy, unresolvedGroup };
}

function rewriteWhppCarry(db, reportDate) {
  const state = loadWhppState();
  const date = normalizeDate(state.reportDate) || reportDate;
  if (!date) return { count: 0, changed: false, legacy: 0 };
  const carryRows = loadOpenCarryRows(db, date, WHPP_TYPES);
  const carryBills = uniqueBills(carryRows);
  const previous = [...new Set((state.carryBills || state.nextCarryBills || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
  const changed = previous.length !== carryBills.length || previous.some((bill, index) => bill !== carryBills[index]);
  saveWhppState({
    ...state,
    reportDate: date,
    carryBills,
    nextCarryBills: carryBills,
    carryHydration: {
      source: V98_RUNTIME_CARRY_HYDRATION_ID,
      hydratedAt: new Date().toISOString(),
      historicalOpen: carryBills.length,
      acceptedBusinessTypes: WHPP_TYPES
    }
  });
  return { count: carryBills.length, changed, legacy: 0 };
}

function hydrateRuntimeCarry(kind) {
  const db = getDb();
  const reportDate = latestValidReportDate(db);
  if (!reportDate) return { reportDate: '', count: 0, changed: false, legacy: 0 };
  if (kind === 'CCSL') return { reportDate, ...rewriteCcslCarry(db, reportDate) };
  if (kind === 'SHOPEE') return { reportDate, ...rewriteShopeeCarry(db, reportDate) };
  if (kind === 'WHPP') return { reportDate, ...rewriteWhppCarry(db, reportDate) };
  return { reportDate, count: 0, changed: false, legacy: 0 };
}

function carryHydrationMiddleware(kind) {
  return (req, res, next) => {
    try {
      const hydrated = hydrateRuntimeCarry(kind);
      res.setHeader('X-CE-QC-Carry-Hydration', `${kind}:${hydrated.count}`);
      console.log(`[CE-QC][V374][CARRY_HYDRATE] business=${kind} reportDate=${hydrated.reportDate || '-'} historicalOpen=${hydrated.count} legacy=${hydrated.legacy || 0} unresolvedGroup=${hydrated.unresolvedGroup || 0} changed=${hydrated.changed ? 1 : 0}`);
      next();
    } catch (error) {
      console.error(`[CE-QC][V374][CARRY_HYDRATE_FAILED] business=${kind}`, error);
      res.status(500).json({ ok: false, code: 'CARRY_HYDRATION_FAILED', error: `历史未闭环队列重建失败：${error?.message || error}` });
    }
  };
}

function latestRetryTruth(db, businessType, reportDate) {
  const type = String(businessType || 'CCSL').toUpperCase() === 'SHOPEE' ? 'SHOPEE' : 'CCSL';
  const date = normalizeDate(reportDate);
  if (!date) return { scanRetry: 0, trackRetry: 0 };
  let checkpoint = null;
  if (type === 'SHOPEE') {
    const lock = db.prepare("SELECT runId FROM business_run_locks WHERE businessType='SHOPEE' AND reportDate=?").get(date);
    if (lock?.runId) checkpoint = db.prepare("SELECT payloadJson FROM business_run_checkpoints WHERE businessType='SHOPEE' AND reportDate=? AND runId=? ORDER BY updatedAt DESC,id DESC LIMIT 1").get(date, lock.runId);
  } else {
    const lock = db.prepare('SELECT runId FROM run_locks WHERE reportDate=?').get(date);
    if (lock?.runId) checkpoint = db.prepare('SELECT payloadJson FROM run_checkpoints WHERE reportDate=? AND runId=? ORDER BY updatedAt DESC,rowid DESC LIMIT 1').get(date, lock.runId);
  }
  const payload = parseJson(checkpoint?.payloadJson, {});
  const last = payload.lastRunSummary && typeof payload.lastRunSummary === 'object' ? payload.lastRunSummary : {};
  const scanRetry = Math.max(0, Number(payload.scanRetry || 0), Number(last.scanRetry || 0), Array.isArray(last.retryBills) && !Number(last.trackRetry || 0) ? Number(last.retryBills.length || 0) : 0);
  const trackRetry = Math.max(0, Number(payload.trackRetry || 0), Number(last.trackRetry || 0));
  return { scanRetry, trackRetry };
}

function correctedProgressCount(totalValue, doneValue, retryValue, observedValue, canonicalRetryValue) {
  const total = Math.max(0, Number(totalValue) || 0);
  const observed = Math.min(total, Math.max(0, Number(observedValue) || 0, Number(doneValue) || 0));
  const retry = Math.min(total, Math.max(0, Number(retryValue) || 0, Number(canonicalRetryValue) || 0));
  const done = Math.min(Math.max(0, total - retry), Math.max(0, Number(doneValue) || 0, observed - retry));
  return { total, observed: Math.max(observed, Math.min(total, done + retry)), retry, done };
}

function correctProgressPayload(value = {}) {
  if (!value || typeof value !== 'object' || value.ok === false) return value;
  const businessType = String(value.businessType || 'CCSL').toUpperCase() === 'SHOPEE' ? 'SHOPEE' : 'CCSL';
  const reportDate = normalizeDate(value.reportDate || '');
  if (!reportDate) return value;
  const truth = latestRetryTruth(getDb(), businessType, reportDate);
  const scan = correctedProgressCount(value.scanTotal, value.scanDone, value.scanRetry, value.scanObserved, truth.scanRetry);
  const track = correctedProgressCount(value.trackTotal, value.trackDone, value.trackRetry, value.trackObserved, truth.trackRetry);
  const isTrack = /轨迹|track|shipment-event|exception-item/i.test(String(value.phase || ''));
  return {
    ...value,
    progressRule: `${String(value.progressRule || '')}+V374_RETRY_FIRST_TRUTH`,
    scanDone: scan.done,
    scanRetry: scan.retry,
    scanObserved: scan.observed,
    scanTotal: scan.total,
    trackDone: track.done,
    trackRetry: track.retry,
    trackObserved: track.observed,
    trackTotal: track.total,
    done: isTrack ? track.done : scan.done,
    retry: isTrack ? track.retry : scan.retry,
    total: isTrack ? track.total : scan.total,
    retryTruthSource: V98_RUNTIME_CARRY_HYDRATION_ID
  };
}

function wrapProgressHandler(handler) {
  if (typeof handler !== 'function' || handler.__v374ProgressTruth) return handler;
  const wrapped = function v374ProgressTruthHandler(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = value => {
      res.json = originalJson;
      return originalJson(correctProgressPayload(value));
    };
    return handler.call(this, req, res, next);
  };
  Object.defineProperty(wrapped, '__v374ProgressTruth', { value: true });
  return wrapped;
}

// Keep using the existing V98 owner instead of stacking another runtime patch.
const previousPost = express.application.post;
express.application.post = function v98CarryHydrationPost(pathValue, ...handlers) {
  if (CCSL_RUN_ROUTES.has(pathValue)) return previousPost.call(this, pathValue, carryHydrationMiddleware('CCSL'), ...handlers);
  if (SHOPEE_RUN_ROUTES.has(pathValue)) return previousPost.call(this, pathValue, carryHydrationMiddleware('SHOPEE'), ...handlers);
  if (WHPP_RUN_ROUTES.has(pathValue)) return previousPost.call(this, pathValue, carryHydrationMiddleware('WHPP'), ...handlers);
  return previousPost.call(this, pathValue, ...handlers);
};

const previousGet = express.application.get;
express.application.get = function v98RetryTruthGet(pathValue, ...handlers) {
  if (pathValue === '/api/v33/run-progress' && handlers.length) {
    return previousGet.call(this, pathValue, ...handlers.map(wrapProgressHandler));
  }
  return previousGet.call(this, pathValue, ...handlers);
};

// No HTTP bypass route exists. The refresh scheduler lives inside the same Node
// backend that owns port 5177, so it inherits the backend lifecycle and stops
// automatically whenever the managed desktop console closes.
let installed = false;
const previousListen = express.application.listen;
express.application.listen = function v98CarryRefreshListen(...args) {
  if (!installed) {
    installed = true;
    startCarryoverRefreshScheduler();
  }
  return previousListen.apply(this, args);
};
