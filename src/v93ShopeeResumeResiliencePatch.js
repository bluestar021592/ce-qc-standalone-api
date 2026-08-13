import crypto from 'node:crypto';
import express from 'express';
import { getDb, nowIso } from './db.js';

export const V93_SHOPEE_RESUME_RESILIENCE_ID = '2026-08-13-v93-shopee-resume-resilience-v1';
const SHOPEE = 'SHOPEE';
const GUARDED_ROUTES = new Set(['/api/shopee/run/start', '/api/shopee/run/resume']);
const LEGACY_BATCH_KEY = /^(?:scan-status|track-event|exception-item):\d{6}$/i;

function text(value = '') { return String(value ?? '').trim(); }
function shortHash(value = '') { return text(value).replace(/[^a-f0-9]/gi, '').slice(0, 12).toLowerCase(); }
function hashCodesJson(value = '[]') {
  const source = text(value) || '[]';
  return crypto.createHash('sha256').update(source).digest('hex');
}

export function payloadScopedBatchKey(batchKey = '', payloadHash = '', shipmentCodesJson = '[]') {
  const key = text(batchKey);
  if (!key || !LEGACY_BATCH_KEY.test(key)) return key;
  const hash = shortHash(payloadHash) || shortHash(hashCodesJson(shipmentCodesJson));
  return `${key}:p${hash || 'unknown'}`;
}

/**
 * business_api_batches is audit/idempotency metadata only. Per-waybill
 * scan/event/exception status tables are the authoritative resume checkpoint.
 *
 * Old versions reused track-event:000001 for both the original 50-waybill batch
 * and a later resume subset. That made an expected resume subset look like data
 * corruption and could abort the whole checkpoint save. Move old numeric-only
 * audit keys into payload-scoped keys before every SHOPEE start/resume so the
 * next unfinished subset gets a fresh audit slot without deleting business data.
 */
export function rekeyLegacyShopeeApiBatches(db = getDb(), reportDate = '') {
  const date = text(reportDate);
  const params = [SHOPEE];
  const whereDate = date ? ' AND reportDate=?' : '';
  if (date) params.push(date);
  const rows = db.prepare(`SELECT businessType,reportDate,runId,apiName,batchKey,shipmentCodesJson,payloadHash,status,attemptCount,resultCount,errorMessage,createdAt,updatedAt
    FROM business_api_batches
    WHERE businessType=?${whereDate}
    ORDER BY reportDate,runId,apiName,batchKey`).all(...params)
    .filter(row => LEGACY_BATCH_KEY.test(text(row.batchKey)));
  if (!rows.length) return { moved: 0, merged: 0, reportDate: date };

  const selectTarget = db.prepare('SELECT 1 FROM business_api_batches WHERE businessType=? AND reportDate=? AND runId=? AND apiName=? AND batchKey=?');
  const deleteTarget = db.prepare('DELETE FROM business_api_batches WHERE businessType=? AND reportDate=? AND runId=? AND apiName=? AND batchKey=?');
  const updateKey = db.prepare('UPDATE business_api_batches SET batchKey=?,payloadHash=CASE WHEN COALESCE(payloadHash,\'\')=\'\' THEN ? ELSE payloadHash END,updatedAt=? WHERE businessType=? AND reportDate=? AND runId=? AND apiName=? AND batchKey=?');
  let moved = 0;
  let merged = 0;
  const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const payloadHash = text(row.payloadHash) || hashCodesJson(row.shipmentCodesJson || '[]');
      const nextKey = payloadScopedBatchKey(row.batchKey, payloadHash, row.shipmentCodesJson || '[]');
      if (!nextKey || nextKey === row.batchKey) continue;
      const keyArgs = [row.businessType, row.reportDate, row.runId || '', row.apiName || '', nextKey];
      if (selectTarget.get(...keyArgs)) {
        // The same payload may have been retried more than once. Keep the latest
        // numeric-key record as the current audit record and remove only the older
        // duplicate audit row. No scan/event/final/carry data is touched.
        deleteTarget.run(...keyArgs);
        merged += 1;
      }
      updateKey.run(nextKey, payloadHash, now, row.businessType, row.reportDate, row.runId || '', row.apiName || '', row.batchKey);
      moved += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return { moved, merged, reportDate: date };
}

export function prepareShopeeResumeAudit(db = getDb()) {
  const latest = db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='SHOPEE' ORDER BY reportDate DESC LIMIT 1").get();
  const reportDate = text(latest?.reportDate);
  const rekey = rekeyLegacyShopeeApiBatches(db, reportDate);
  const now = nowIso();
  if (reportDate) {
    db.prepare("UPDATE business_run_locks SET errorMessage='',updatedAt=? WHERE businessType='SHOPEE' AND reportDate=? AND status IN ('failed','paused','running')")
      .run(now, reportDate);
  }
  return { patchId: V93_SHOPEE_RESUME_RESILIENCE_ID, reportDate, ...rekey };
}

function prepareMiddleware(req, res, next) {
  try {
    req.v93ShopeeResume = prepareShopeeResumeAudit(getDb());
    next();
  } catch (error) {
    console.error('[V93][SHOPEE_RESUME_PREPARE]', error);
    res.status(500).json({ ok: false, code: 'SHOPEE_RESUME_PREPARE_FAILED', error: error.message || String(error) });
  }
}

// Install last, immediately before server.js registers the routes. This makes the
// guard independent from older compatibility wrappers and guarantees that the
// current database is normalized before the run handler loads SHOPEE state.
const previousPost = express.application.post;
express.application.post = function v93ShopeeResumePost(pathValue, ...handlers) {
  if (GUARDED_ROUTES.has(String(pathValue || ''))) {
    return previousPost.call(this, pathValue, prepareMiddleware, ...handlers);
  }
  return previousPost.call(this, pathValue, ...handlers);
};

let startupResult = null;
try {
  startupResult = prepareShopeeResumeAudit(getDb());
  console.log(`[CE-QC][V93] SHOPEE resume audit prepared ${JSON.stringify(startupResult)}`);
} catch (error) {
  // Startup must not be killed by audit metadata cleanup. The guarded route will
  // retry preparation and return a controlled API error if the database is locked.
  console.warn('[CE-QC][V93] startup audit preparation deferred:', error?.message || error);
}

export function getV93StartupResult() { return startupResult; }
