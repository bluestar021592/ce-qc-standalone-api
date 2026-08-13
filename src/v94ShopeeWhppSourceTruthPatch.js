import express from 'express';
import { getDb } from './db.js';
import { inspectV90FastDashboard } from './v90FastDashboardReadPatch.js';
import {
  SHOPEE_WHPP_RETENTION_TRUTH_VERSION,
  loadStrictShopeeWhppRetentionRows
} from './shopeeWhppRetentionTruth.js';

export const V94_SHOPEE_WHPP_SOURCE_TRUTH_ID = '2026-08-13-v94-shopee-whpp-source-truth-v1';
const SUMMARY_ROUTE = '/api/v89/instant-dashboard';
const DETAIL_ROUTE = '/api/v89/shopee-whpp-detail';
const TYPES = new Set(['SHOPEECN','SHOPEEVN']);

function text(value = '') { return String(value ?? '').trim(); }
function dateOnly(value = '') {
  const valueText = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : '';
}

function latestBatch(db, requestedDate = '') {
  const date = dateOnly(requestedDate);
  return date
    ? db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC LIMIT 1").get(date) || null
    : db.prepare("SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get() || null;
}

function strictRows(db, batch, type) {
  if (!batch?.snapshotId) return [];
  return loadStrictShopeeWhppRetentionRows({
    db,
    snapshotId: batch.snapshotId,
    reportDate: batch.reportDate,
    businessType: type
  });
}

function summaryHandler(req, res) {
  const startedAt = Date.now();
  try {
    const requestedDate = req.query.date || req.query.reportDate || '';
    const base = inspectV90FastDashboard(requestedDate);
    const db = getDb();
    const batch = latestBatch(db, requestedDate);
    const shopeeWhpp = { SHOPEECN: 0, SHOPEEVN: 0 };
    if (batch) {
      shopeeWhpp.SHOPEECN = strictRows(db, batch, 'SHOPEECN').length;
      shopeeWhpp.SHOPEEVN = strictRows(db, batch, 'SHOPEEVN').length;
    }
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.setHeader('X-CE-QC-Dashboard', 'V94-WHPP-TERMINAL-LOCATION');
    res.setHeader('Server-Timing', `v94;dur=${Date.now() - startedAt}`);
    res.json({
      ...base,
      ok: true,
      patchId: V94_SHOPEE_WHPP_SOURCE_TRUTH_ID,
      shopeeWhpp,
      shopeeWhppRule: {
        version: SHOPEE_WHPP_RETENTION_TRUTH_VERSION,
        definition: 'LATEST_EFFECTIVE_LOCATION_WHPP_AND_NOT_POD_RETURN_OR_OUTBOUND'
      },
      generatedAt: new Date().toISOString(),
      cacheHit: false
    });
  } catch (error) {
    res.status(500).json({ ok: false, patchId: V94_SHOPEE_WHPP_SOURCE_TRUTH_ID, error: error?.message || String(error) });
  }
}

function detailHandler(req, res) {
  try {
    const type = text(req.query.businessType).toUpperCase();
    if (!TYPES.has(type)) return res.status(400).json({ ok: false, error: 'businessType仅支持SHOPEECN或SHOPEEVN。' });
    const db = getDb();
    const batch = latestBatch(db, req.query.date || req.query.reportDate || '');
    if (!batch) return res.json({ ok: true, rows: [], total: 0, businessType: type, reportDate: '' });
    const allRows = strictRows(db, batch, type);
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(1000, Number(req.query.pageSize || 200)));
    const offset = (page - 1) * pageSize;
    const rows = allRows.slice(offset, offset + pageSize);
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.json({
      ok: true,
      patchId: V94_SHOPEE_WHPP_SOURCE_TRUTH_ID,
      sourceTruthVersion: SHOPEE_WHPP_RETENTION_TRUTH_VERSION,
      businessType: type,
      reportDate: batch.reportDate,
      total: allRows.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(allRows.length / pageSize)),
      rows
    });
  } catch (error) {
    res.status(500).json({ ok: false, patchId: V94_SHOPEE_WHPP_SOURCE_TRUTH_ID, error: error?.message || String(error) });
  }
}

// V89 registers summary/detail lazily from its listen wrapper. V90 already wraps
// app.get for the tiny summary. V94 wraps listen last and temporarily bypasses
// both older handlers for these two routes, so card count and drilldown are built
// from the exact same normalized track-event source truth.
const previousListen = express.application.listen;
express.application.listen = function v94ShopeeWhppSourceTruthListen(...args) {
  const app = this;
  const previousGet = app.get;
  app.get = function v94RouteRegistration(pathValue, ...handlers) {
    if (pathValue === SUMMARY_ROUTE) return app.route(pathValue).get(summaryHandler);
    if (pathValue === DETAIL_ROUTE) return app.route(pathValue).get(detailHandler);
    return previousGet.call(app, pathValue, ...handlers);
  };
  try {
    return previousListen.apply(app, args);
  } finally {
    app.get = previousGet;
  }
};
