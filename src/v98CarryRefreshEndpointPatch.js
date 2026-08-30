import express from 'express';
import { startCarryoverRefreshScheduler } from './carryoverRefreshScheduler.js';
import { getDb } from './db.js';

export const V98_CARRY_REFRESH_ENDPOINT_ID = '2026-08-14-v98-backend-owned-open-carry-refresh-v4';
export const V98_RUNTIME_CARRY_HYDRATION_ID = '2026-08-30-v374-runtime-carry-hydration-v1';

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

function loadOpenCarryRows(db, reportDate, businessTypes) {
  if (!reportDate || !businessTypes.length) return [];
  const placeholders = businessTypes.map(() => '?').join(',');
  return db.prepare(`
    SELECT shipmentCode,businessType,sourceReportDate,lastReportDate,stateJson
    FROM carryover_open_items
    WHERE UPPER(COALESCE(status,''))='OPEN'
      AND sourceReportDate<?
      AND UPPER(COALESCE(businessType,'')) IN (${placeholders})
    ORDER BY sourceReportDate,shipmentCode
  `).all(reportDate, ...businessTypes);
}

function uniqueBills(rows = []) {
  return [...new Set(rows.map(row => String(row.shipmentCode || '').trim().toUpperCase()).filter(Boolean))];
}

function inferShopeePriorRow(row = {}) {
  const saved = parseJson(row.stateJson, {});
  const storedType = String(row.businessType || '').trim().toUpperCase();
  const embeddedType = String(saved.businessType || saved.sourceBusinessType || '').trim().toUpperCase();
  const recipientGroup = String(saved.recipient_group || saved.recipientGroup || '').trim().toUpperCase();
  const resolvedType = ['SHOPEECN','SHOPEEVN'].includes(storedType)
    ? storedType
    : (['SHOPEECN','SHOPEEVN'].includes(embeddedType)
        ? embeddedType
        : (recipientGroup === 'CN' ? 'SHOPEECN' : (recipientGroup === 'VN' ? 'SHOPEEVN' : 'SHOPEE')));
  return {
    ...saved,
    shipmentCode: String(row.shipmentCode || '').trim().toUpperCase(),
    运单号: String(row.shipmentCode || '').trim().toUpperCase(),
    businessType: resolvedType,
    recipient_group: recipientGroup || (resolvedType === 'SHOPEECN' ? 'CN' : (resolvedType === 'SHOPEEVN' ? 'VN' : 'OTHER')),
    recipient_group_reason: saved.recipient_group_reason || 'V374_HISTORICAL_OPEN_REHYDRATE',
    sourceDate: row.sourceReportDate || '',
    sourceReportDate: row.sourceReportDate || '',
    lastReportDate: row.lastReportDate || '',
    sourceType: 'HISTORICAL_CARRY'
  };
}

function rewriteAppStateCarry(db, reportDate) {
  const row = db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get();
  if (!row) return { count: 0, changed: false };
  const state = parseJson(row.valueJson, {});
  const date = normalizeDate(state.reportDate) || reportDate;
  if (!date) return { count: 0, changed: false };
  const carryRows = loadOpenCarryRows(db, date, CCSL_TYPES);
  const carryBills = uniqueBills(carryRows);
  const previous = [...new Set((state.carryBills || state.nextCarryBills || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
  const changed = previous.length !== carryBills.length || previous.some((bill, index) => bill !== carryBills[index]);
  if (changed || normalizeDate(state.reportDate) !== date) {
    const next = {
      ...state,
      reportDate: date,
      carryBills,
      nextCarryBills: carryBills,
      carryHydration: {
        source: V98_RUNTIME_CARRY_HYDRATION_ID,
        hydratedAt: new Date().toISOString(),
        historicalOpen: carryBills.length,
        acceptedBusinessTypes: CCSL_TYPES
      }
    };
    db.prepare("UPDATE app_state SET valueJson=?,updatedAt=? WHERE key='current'").run(JSON.stringify(next), new Date().toISOString());
  }
  return { count: carryBills.length, changed };
}

function rewriteBusinessStateCarry(db, businessType, reportDate, businessTypes) {
  const row = db.prepare('SELECT valueJson FROM business_states WHERE businessType=?').get(businessType);
  if (!row) return { count: 0, changed: false };
  const state = parseJson(row.valueJson, {});
  const date = normalizeDate(state.reportDate) || reportDate;
  if (!date) return { count: 0, changed: false };
  const carryRows = loadOpenCarryRows(db, date, businessTypes);
  const carryBills = uniqueBills(carryRows);
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
      acceptedBusinessTypes: businessTypes
    }
  };
  if (businessType === 'SHOPEE') next.priorCarryRows = carryRows.map(inferShopeePriorRow);
  if (changed || normalizeDate(state.reportDate) !== date || businessType === 'SHOPEE') {
    db.prepare('UPDATE business_states SET valueJson=?,updatedAt=? WHERE businessType=?').run(JSON.stringify(next), new Date().toISOString(), businessType);
  }
  return { count: carryBills.length, changed };
}

function hydrateRuntimeCarry(kind) {
  const db = getDb();
  const reportDate = latestValidReportDate(db);
  if (!reportDate) return { reportDate: '', count: 0, changed: false };
  if (kind === 'CCSL') return { reportDate, ...rewriteAppStateCarry(db, reportDate) };
  if (kind === 'SHOPEE') return { reportDate, ...rewriteBusinessStateCarry(db, 'SHOPEE', reportDate, SHOPEE_TYPES) };
  if (kind === 'WHPP') return { reportDate, ...rewriteBusinessStateCarry(db, 'WHPP', reportDate, WHPP_TYPES) };
  return { reportDate, count: 0, changed: false };
}

function carryHydrationMiddleware(kind) {
  return (req, res, next) => {
    try {
      const hydrated = hydrateRuntimeCarry(kind);
      res.setHeader('X-CE-QC-Carry-Hydration', `${kind}:${hydrated.count}`);
      console.log(`[CE-QC][V374][CARRY_HYDRATE] business=${kind} reportDate=${hydrated.reportDate || '-'} historicalOpen=${hydrated.count} changed=${hydrated.changed ? 1 : 0}`);
      next();
    } catch (error) {
      console.error(`[CE-QC][V374][CARRY_HYDRATE_FAILED] business=${kind}`, error);
      res.status(500).json({ ok: false, code: 'CARRY_HYDRATION_FAILED', error: `历史未闭环队列重建失败：${error?.message || error}` });
    }
  };
}

// Keep using the existing V98 owner instead of stacking another runtime patch.
const previousPost = express.application.post;
express.application.post = function v98CarryHydrationPost(pathValue, ...handlers) {
  if (CCSL_RUN_ROUTES.has(pathValue)) return previousPost.call(this, pathValue, carryHydrationMiddleware('CCSL'), ...handlers);
  if (SHOPEE_RUN_ROUTES.has(pathValue)) return previousPost.call(this, pathValue, carryHydrationMiddleware('SHOPEE'), ...handlers);
  if (WHPP_RUN_ROUTES.has(pathValue)) return previousPost.call(this, pathValue, carryHydrationMiddleware('WHPP'), ...handlers);
  return previousPost.call(this, pathValue, ...handlers);
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
