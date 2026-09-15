import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-21-v208-fast-dashboard-index-only-first-paint-v1';
const PERF_PATCH_ID = '2026-08-21-v209-dashboard-request-timing-v1';
const BOOTSTRAP_AUTHORITY_ID = '2026-08-21-v211-force-v210-bootstrap-route-v2-safe-router-stack';
const SUMMARY_ROUTE = '/api/v89/instant-dashboard';
const BOOTSTRAP_ROUTE = '/api/bootstrap';
const CORE_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const CACHE_MS = Math.max(5_000, Number(process.env.V90_DASHBOARD_CACHE_MS || 30_000));
const cache = new Map();

// V211: V43 is imported before this module and owns the fastBootstrap closure.
// Extract that exact private handler through a disposable Express app, then force
// the real /api/bootstrap route to that handler immediately before listen(). This
// avoids any later route-registration patch accidentally restoring the old heavy
// server bootstrap handler. Express 4 exposes a deprecated `router` getter that
// throws when read as a setting; route inspection must use the internal _router
// stack directly so a supervised backend restart cannot die during listen().
function extractV43FastBootstrapHandler() {
  try {
    const probe = express();
    const fallback = function v211BootstrapProbeFallback(req, res) { res.status(599).end(); };
    probe.get(BOOTSTRAP_ROUTE, fallback);
    const stack = probe._router?.stack || [];
    for (const layer of stack) {
      if (layer?.route?.path !== BOOTSTRAP_ROUTE) continue;
      for (const routeLayer of layer.route.stack || []) {
        const handler = routeLayer?.handle;
        if (typeof handler === 'function' && handler !== fallback) return handler;
      }
    }
  } catch (error) {
    console.warn('[CE-QC][V211] unable to extract V43 fast bootstrap handler:', error?.message || error);
  }
  return null;
}

const V43_FAST_BOOTSTRAP_HANDLER = extractV43FastBootstrapHandler();
const previousListenForBootstrapAuthority = express.application.listen;
express.application.listen = function v211ForceFastBootstrapListen(...args) {
  try {
    const stack = this._router?.stack || [];
    let matched = 0;
    let replaced = 0;
    for (const layer of stack) {
      if (layer?.route?.path !== BOOTSTRAP_ROUTE) continue;
      matched += 1;
      for (const routeLayer of layer.route.stack || []) {
        if (!routeLayer?.method || String(routeLayer.method).toLowerCase() === 'get') {
          if (V43_FAST_BOOTSTRAP_HANDLER && routeLayer.handle !== V43_FAST_BOOTSTRAP_HANDLER) {
            routeLayer.handle = V43_FAST_BOOTSTRAP_HANDLER;
            replaced += 1;
          }
        }
      }
    }
    console.log(`[CE-QC][V211] ${BOOTSTRAP_AUTHORITY_ID} matched=${matched} replaced=${replaced} handler=${V43_FAST_BOOTSTRAP_HANDLER?.name || 'missing'}`);
  } catch (error) {
    console.error('[CE-QC][V211] bootstrap route authority failed:', error?.stack || error);
  }
  return previousListenForBootstrapAuthority.apply(this, args);
};

// V209 diagnostic: record the real server-side duration of every slow API
// request. Include the bootstrap response authority header so the startup log can
// prove whether V210 or the old server handler actually served the request.
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
        const authority = url.startsWith(BOOTSTRAP_ROUTE) ? ` authority=${String(res?.getHeader?.('X-CE-QC-Bootstrap') || 'none')}` : '';
        console.log(`[CE-QC][PERF][V209] ${method} ${url} status=${Number(res?.statusCode || 0)} duration=${duration}ms${authority}`);
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
export const V211_BOOTSTRAP_ROUTE_AUTHORITY_ID = BOOTSTRAP_AUTHORITY_ID;
