import express from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-17-v163-shopee-daily-membership-isolation-v2';
const ROUTES = new Set(['/api/shopee/run/start', '/api/shopee/run/resume']);
const WRAPPED = Symbol.for('ce-qc.v163-shopee-daily-carry-isolation');
const HOLD_PREFIX = 'V163_HOLD:';

function safeJson(value, fallback = {}) {
  try { return JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}
function now() { return new Date().toISOString(); }

function ensureHoldTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS v163_shopee_carry_hold(
    token TEXT NOT NULL,
    rowId INTEGER NOT NULL,
    originalStatus TEXT NOT NULL,
    originalRawJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    PRIMARY KEY(token,rowId)
  )`);
}

function restoreToken(db, token) {
  if (!token) return 0;
  ensureHoldTable(db);
  const rows = db.prepare('SELECT rowId,originalStatus,originalRawJson FROM v163_shopee_carry_hold WHERE token=? ORDER BY rowId').all(token);
  const update = db.prepare('UPDATE business_carry_bills SET status=?,rawJson=?,updatedAt=? WHERE rowid=?');
  let restored = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      update.run(row.originalStatus || 'active', row.originalRawJson || '{}', now(), row.rowId);
      restored += 1;
    }
    db.prepare('DELETE FROM v163_shopee_carry_hold WHERE token=?').run(token);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return restored;
}

function restoreStaleHolds() {
  const db = getDb();
  ensureHoldTable(db);
  const tokens = db.prepare('SELECT DISTINCT token FROM v163_shopee_carry_hold ORDER BY createdAt').all().map(row => row.token);
  let total = 0;
  for (const token of tokens) total += restoreToken(db, token);
  if (total) console.warn(`[CE-QC][V163] restored ${total} historical SHOPEE carry rows left in temporary isolation.`);
}

function latestShopeeDate(db) {
  return String(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='SHOPEE' ORDER BY updatedAt DESC,reportDate DESC LIMIT 1").get()?.reportDate || '');
}

function dailyCount(db, reportDate) {
  return Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='SHOPEE' AND reportDate=?").get(reportDate)?.count || 0);
}

function mixedRuntimeFacts(db, reportDate) {
  const expected = dailyCount(db, reportDate);
  const scanRows = Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_scan_results WHERE businessType='SHOPEE' AND reportDate=?").get(reportDate)?.count || 0);
  const stateRow = db.prepare("SELECT valueJson FROM business_states WHERE businessType='SHOPEE'").get();
  const state = safeJson(stateRow?.valueJson, {});
  const scanPool = Array.isArray(state.scanPool) ? new Set(state.scanPool.map(v => String(v || '').trim().toUpperCase()).filter(Boolean)).size : 0;
  return { expected, scanRows, scanPool, mixed: expected > 0 && (scanRows > expected || scanPool > expected) };
}

function resetMixedRuntime(db, reportDate) {
  const facts = mixedRuntimeFacts(db, reportDate);
  if (!facts.mixed) return { reset: false, ...facts };
  const stateRow = db.prepare("SELECT valueJson FROM business_states WHERE businessType='SHOPEE'").get();
  const state = safeJson(stateRow?.valueJson, {});
  const cleaned = {
    ...state,
    scanPool: [], scanRetryBills: [], scanResults: [], scanQueryStatus: [], shipmentTrackResults: [], shipmentQueryStatus: [],
    needTrackBills: [], trackEvents: [], eventQueryStatus: [], exceptionItems: [], exceptionQueryStatus: [], apiBatchStatus: [],
    trackResults: [], finalRows: [], currentRun: null, lastRunSummary: null, lastRun: null,
    processing: { running: false, paused: false, phase: '' }, snapshotId: ''
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['business_run_checkpoints','business_api_batches','business_scan_results','business_shipment_tracks','business_track_events','business_exception_items','business_final_rows']) {
      db.prepare(`DELETE FROM ${table} WHERE businessType='SHOPEE' AND reportDate=?`).run(reportDate);
    }
    db.prepare("DELETE FROM business_run_locks WHERE businessType='SHOPEE' AND reportDate=?").run(reportDate);
    db.prepare("UPDATE business_states SET valueJson=?,updatedAt=? WHERE businessType='SHOPEE'").run(JSON.stringify(cleaned), now());
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  console.warn(`[CE-QC][V163] reset mixed SHOPEE runtime for ${reportDate}: daily=${facts.expected}, scanRows=${facts.scanRows}, scanPool=${facts.scanPool}`);
  return { reset: true, ...facts };
}

function quarantineHistorical(db, reportDate) {
  ensureHoldTable(db);
  const token = `${HOLD_PREFIX}${reportDate}:${randomUUID()}`;
  // Current-day auto processing is membership based, never date-label based.
  // Legacy carry rows can have sourceDate/reportDate rewritten by an old mixed run,
  // so every active carry bill that is NOT a member of today's daily report must
  // be isolated regardless of its stored sourceDate/reportDate value.
  const rows = db.prepare(`
    SELECT rowid,status,rawJson,reportDate,sourceDate,shipmentCode
    FROM business_carry_bills c
    WHERE businessType='SHOPEE' AND status='active'
      AND NOT EXISTS (
        SELECT 1 FROM business_daily_parse_rows d
        WHERE d.businessType='SHOPEE' AND d.reportDate=? AND d.shipmentCode=c.shipmentCode
      )
  `).all(reportDate);
  if (!rows.length) return { token: '', count: 0 };
  const insert = db.prepare('INSERT INTO v163_shopee_carry_hold(token,rowId,originalStatus,originalRawJson,createdAt) VALUES(?,?,?,?,?)');
  const update = db.prepare('UPDATE business_carry_bills SET status=?,rawJson=?,updatedAt=? WHERE rowid=?');
  const stamp = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const raw = safeJson(row.rawJson, {});
      insert.run(token, row.rowid, row.status || 'active', row.rawJson || '{}', stamp);
      update.run(token, JSON.stringify({ ...raw, carry状态: 'closed_v163_daily_isolation', __v163Held: true }), stamp, row.rowid);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  console.log(`[CE-QC][V163] isolated ${rows.length} non-daily SHOPEE carry rows from ${reportDate} daily run.`);
  return { token, count: rows.length };
}

function isolationMiddleware(req, res, next) {
  let token = '';
  let restored = false;
  const restore = () => {
    if (restored || !token) return;
    restored = true;
    try {
      const count = restoreToken(getDb(), token);
      console.log(`[CE-QC][V163] restored ${count} historical SHOPEE carry rows after daily run request.`);
    } catch (error) {
      console.error('[CE-QC][V163] failed to restore historical carry:', error?.stack || error);
    }
  };
  try {
    const db = getDb();
    const reportDate = latestShopeeDate(db);
    if (!reportDate) return next();
    if (req.path === '/api/shopee/run/start') resetMixedRuntime(db, reportDate);
    const held = quarantineHistorical(db, reportDate);
    token = held.token;
    if (token) {
      res.once('finish', restore);
      res.once('close', restore);
    }
    req.v163ShopeeDailyIsolation = { reportDate, held: held.count, patchId: PATCH_ID };
    return next();
  } catch (error) {
    restore();
    return next(error);
  }
}

restoreStaleHolds();

const previousPost = express.application.post;
express.application.post = function v163ShopeeDailyIsolationPost(pathValue, ...handlers) {
  if (ROUTES.has(String(pathValue || ''))) {
    return previousPost.call(this, pathValue, isolationMiddleware, ...handlers);
  }
  return previousPost.call(this, pathValue, ...handlers);
};

export { mixedRuntimeFacts, resetMixedRuntime, quarantineHistorical, restoreToken };
export const V163_SHOPEE_DAILY_ISOLATION_PATCH_ID = PATCH_ID;
