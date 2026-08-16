import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-16-v162-shopee-live-api-progress-v1';
const TARGET = '/api/v33/run-progress';
const WRAPPED = Symbol.for('ce-qc.v162-shopee-live-api-progress');

function num(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function apiNameForPhase(phase = '') {
  const text = String(phase || '').toLowerCase();
  if (text.includes('shipment-event')) return 'tms-shipment-event-query';
  if (text.includes('exception-item')) return 'exception-item-query';
  return '';
}

function liveApiCounts(progress = {}) {
  if (String(progress.businessType || '').toUpperCase() !== 'SHOPEE') return null;
  const reportDate = String(progress.reportDate || '').trim();
  const runId = String(progress.runId || '').trim();
  const apiName = apiNameForPhase(progress.phase);
  if (!reportDate || !runId || !apiName) return null;

  const rows = getDb().prepare(`
    SELECT status,
           SUM(COALESCE(shipmentCount,0)) AS shipmentCount,
           SUM(COALESCE(resultCount,0)) AS resultCount
    FROM business_api_batches
    WHERE businessType='SHOPEE' AND reportDate=? AND runId=? AND apiName=?
    GROUP BY status
  `).all(reportDate, runId, apiName);
  if (!rows.length) return { apiName, success: 0, failed: 0, observed: 0, resultRows: 0 };

  let success = 0;
  let failed = 0;
  let resultRows = 0;
  for (const row of rows) {
    const count = num(row.shipmentCount);
    if (String(row.status || '').toLowerCase() === 'success') success += count;
    else if (String(row.status || '').toLowerCase() === 'failed') failed += count;
    resultRows += num(row.resultCount);
  }
  return { apiName, success, failed, observed: success + failed, resultRows };
}

function applyLiveProgress(payload = {}) {
  const live = liveApiCounts(payload);
  if (!live) return payload;
  const total = num(payload.trackTotal || payload.total);
  const success = Math.min(total, live.success);
  const failed = Math.min(Math.max(0, total - success), live.failed);
  const observed = Math.min(total, Math.max(success + failed, live.observed));
  return {
    ...payload,
    trackDone: success,
    trackRetry: failed,
    trackObserved: observed,
    done: success,
    retry: failed,
    total,
    liveApiName: live.apiName,
    liveApiResultRows: live.resultRows,
    progressRule: `${payload.progressRule || 'V149'}+V162_SHOPEE_API_BATCH_LIVE`,
    v162LiveProgress: true
  };
}

function wrap(handler) {
  if (typeof handler !== 'function' || handler[WRAPPED]) return handler;
  const wrapped = function v162ShopeeLiveProgressHandler(req, res, next) {
    const originalJson = res.json;
    res.json = function v162Json(payload) {
      try {
        if (String(req.query?.businessType || '').toUpperCase() === 'SHOPEE') payload = applyLiveProgress(payload);
      } catch (error) {
        console.warn('[CE-QC][V162] live Shopee progress fallback failed:', error?.message || error);
      } finally {
        res.json = originalJson;
      }
      return originalJson.call(this, payload);
    };
    return handler.call(this, req, res, next);
  };
  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped;
}

const previousGet = express.application.get;
express.application.get = function v162ShopeeLiveProgressGet(...args) {
  if (args.length >= 2 && String(args[0] || '') === TARGET) {
    return previousGet.apply(this, [args[0], ...args.slice(1).map(wrap)]);
  }
  return previousGet.apply(this, args);
};

export { applyLiveProgress, liveApiCounts };
export const V162_SHOPEE_LIVE_PROGRESS_PATCH_ID = PATCH_ID;
