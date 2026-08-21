import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-21-v208-fast-dashboard-index-only-first-paint-v1';
const PERF_PATCH_ID = '2026-08-21-v209-dashboard-request-timing-v1';
const SUMMARY_ROUTE = '/api/v89/instant-dashboard';
const CORE_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const CACHE_MS = Math.max(5_000, Number(process.env.V90_DASHBOARD_CACHE_MS || 30_000));
const cache = new Map();

// V209 diagnostic only: record the real server-side duration of every slow API
// request. This does not alter any response or database data. It lets the startup
// log tell us exactly which route is occupying the single synchronous SQLite/main
// process while the browser waits for all dashboards to appear together.
const PERF_WRAP = Symbol.for('ce-qc.v209.request-timing');
if (!express.application[PERF_WRAP]) {
  const previousHandle = express.application.handle;
  express.application.handle = function v209TimedExpressHandle(req, res, callback) {
    const startedAt = Date.now();
    const method = String(req?.method || '');
    const url = String(req?.originalUrl || req?.url || '');
    const selected = /^(?:\/api\/bootstrap|\/api\/v89\/instant-dashboard|\/api\/business-state\/|\/api\/state(?:\?|$)|\/api\/shopee\/state(?:\?|$)|\/api\/import\/unified-latest(?:\?|$)|\/api\/history(?:\?|$)|\/api\/unified-history(?:\?|$))/.test(url);
    const finish = () => {
      const duration = Date.now() - startedAt;
      if (selected || (url.startsWith('/api/') && duration >= 250)) {
        console.log(`[CE-QC][PERF][V209] ${method} ${url} status=${Number(res?.statusCode || 0)} duration=${duration}ms`);
      }
    };
    res?.once?.('finish', finish);
    res?.once?.('close', () => {
      if (!res?.writableFinished) {
        const duration = Date.now() - startedAt;
        if (selected || (url.startsWith('/api/') && duration >= 250)) {
          console.log(`[CE-QC][PERF][V209] ${method} ${url} closed-before-finish duration=${duration}ms`);
        }
      }
    });
    return previousHandle.call(this, req, res, callback);
  };
  Object.defineProperty(express.application, PERF_WRAP, { value: true, configurable: false });
  console.log(`[CE-QC][PERF][V209] ${PERF_PATCH_ID} installed; API requests >=250ms will be timed.`);
}

const text = value => String(value ?? '').trim();
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value).slice(0, 10)) ? text(value).slice(0, 10) : '';
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}

function latestBatch(db, requestedDate = '') {
  const date = dateOnly(requestedDate);
  return date
    ? db.prepare(`SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC LIMIT 1`).get(date) || null
    : db.prepare(`SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1`).get() || null;
}

function importedCounts(db, snapshotId) {
  const result = Object.fromEntries(CORE_TYPES.map(type => [type, 0]));
  if (!snapshotId) return result;
  const rows = db.prepare(`
    SELECT businessType,COUNT(*) count
    FROM unified_import_rows
    WHERE snapshotId=?
    GROUP BY businessType
  `).all(snapshotId);
  for (const row of rows) {
    const type = text(row.businessType).toUpperCase();
    if (Object.hasOwn(result, type)) result[type] = Number(row.count || 0);
  }
  return result;
}

function whppHistory(db, reportDate) {
  const row = db.prepare(`
    SELECT summaryJson
    FROM business_history_summary
    WHERE businessType='WHPP' AND reportDate=?
    LIMIT 1
  `).get(reportDate);
  return safeJson(row?.summaryJson, {});
}

function whppRawTotal(db, reportDate, history = null) {
  const report = db.prepare(`
    SELECT totalCount
    FROM business_daily_reports
    WHERE businessType='WHPP' AND reportDate=?
    LIMIT 1
  `).get(reportDate);
  if (report?.totalCount !== undefined && report?.totalCount !== null) return Number(report.totalCount || 0);
  const historyTotal = Number(history?.total);
  if (Number.isFinite(historyTotal) && historyTotal >= 0) return historyTotal;
  return Number(db.prepare(`
    SELECT COUNT(DISTINCT shipmentCode) count
    FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=?
  `).get(reportDate)?.count || 0);
}

function fastWhppSummary(reportDate, total, history = {}) {
  const metrics = { ...history, total: Number(history.total ?? total ?? 0) };
  delete metrics.accounting;
  delete metrics.snapshotId;
  const numberKeys = [
    'pod','podRate','returned','returnRate','cancelled','cancelRate','unresolved',
    'pendingNonContinuous','pending1','pending2','pending3','oc1','oc2','oc3',
    'cycle2','inboundNoScan','workOrder','delivery','phnomPenhShop','provinceShop'
  ];
  for (const key of numberKeys) metrics[key] = Number(metrics[key] || 0);
  if (!Number.isFinite(metrics.podRate)) metrics.podRate = metrics.total ? metrics.pod * 100 / metrics.total : 0;
  if (!Number.isFinite(metrics.returnRate)) metrics.returnRate = metrics.total ? metrics.returned * 100 / metrics.total : 0;
  if (!Number.isFinite(metrics.cancelRate)) metrics.cancelRate = metrics.total ? metrics.cancelled * 100 / metrics.total : 0;
  if (!Number.isFinite(metrics.unresolved) || metrics.unresolved < 0) {
    metrics.unresolved = Math.max(0, metrics.total - metrics.pod - metrics.returned - metrics.cancelled);
  }
  return { reportDate, completed: Object.keys(history || {}).length > 0, metrics };
}

function buildSummary(requestedDate = '') {
  const db = getDb();
  const batch = latestBatch(db, requestedDate);
  if (!batch) {
    return {
      ok: true,
      patchId: PATCH_ID,
      reportDate: '',
      counts: {},
      total: 0,
      shopeeWhpp: {},
      whppSummary: { reportDate: '', completed: false, metrics: { total: 0 } },
      sourceCorrection: { removedFromWhpp: 0, reason: 'No valid unified import batch.' }
    };
  }

  const key = `${batch.snapshotId}|${batch.reportDate}|fast`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.payload, cacheHit: true };

  // First-paint authority is the already-classified unified import slice. CEAF is
  // authoritative here, so there is no reason to scan rowJson/rawJson with LIKE.
  // Those legacy scans were able to monopolize the single Node/SQLite process for
  // minutes and made every dashboard appear to load together only after they ended.
  const counts = importedCounts(db, batch.snapshotId);
  const whppHistoryState = whppHistory(db, batch.reportDate);
  counts.WHPP = whppRawTotal(db, batch.reportDate, whppHistoryState);
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);

  const payload = {
    ok: true,
    patchId: PATCH_ID,
    reportDate: batch.reportDate,
    snapshotId: batch.snapshotId,
    counts,
    total,
    // SHOPEE WHPP responsibility is owned by its business-state/detail path. Keep
    // first paint independent from the expensive final-row responsibility join.
    shopeeWhpp: {},
    whppSummary: fastWhppSummary(batch.reportDate, counts.WHPP, whppHistoryState),
    sourceCorrection: {
      exactAirMarkerBills: 0,
      movedToCeaf: 0,
      removedFromWhpp: 0,
      reason: 'First paint uses authoritative unified_import_rows CEAF membership and stored WHPP summary; no JSON LIKE scan or SHOPEE responsibility join is executed.'
    },
    generatedAt: new Date().toISOString(),
    cacheHit: false
  };
  cache.set(key, { at: Date.now(), payload });
  return payload;
}

function summaryHandler(req, res) {
  const startedAt = Date.now();
  try {
    const payload = buildSummary(req.query.date || req.query.reportDate || '');
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.setHeader('X-CE-QC-Dashboard', 'V208-INDEX-ONLY-FIRST-PAINT');
    res.setHeader('Server-Timing', `v208;dur=${Date.now() - startedAt}`);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ ok: false, patchId: PATCH_ID, error: error?.message || String(error) });
  }
}

const previousGet = express.application.get;
express.application.get = function v90FastDashboardGet(pathValue, ...handlers) {
  if (pathValue === SUMMARY_ROUTE && handlers.length) return previousGet.call(this, pathValue, summaryHandler);
  return previousGet.call(this, pathValue, ...handlers);
};

export function inspectV90FastDashboard(requestedDate = '') { return buildSummary(requestedDate); }
export const V90_FAST_DASHBOARD_READ_PATCH_ID = PATCH_ID;
export const V209_DASHBOARD_REQUEST_TIMING_PATCH_ID = PERF_PATCH_ID;
