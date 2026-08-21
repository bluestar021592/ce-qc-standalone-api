import express from 'express';
import { getDb } from './db.js';
import { loadToken, summarizeToken } from './authStore.js';
import { accessIdentity, publicUser } from './accessControl.js';

const PATCH_ID = '2026-08-21-v212-authenticated-indexed-bootstrap-v1';
const PERF_PATCH_ID = '2026-08-21-v209-dashboard-request-timing-v1';
const SUMMARY_ROUTE = '/api/v89/instant-dashboard';
const BOOTSTRAP_ROUTE = '/api/bootstrap';
const BUSINESS_ROUTE_PREFIX = '/api/business-state/';
const CEAF_FAST_ROUTE = '/api/v204/ceaf-fast-state';
const CORE_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const CCSL_TYPES = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const CACHE_MS = Math.max(5_000, Number(process.env.V90_DASHBOARD_CACHE_MS || 30_000));
const cache = new Map();
let bootstrapCache = null;
let bootstrapCacheAt = 0;

const text = value => String(value ?? '').trim();
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value).slice(0, 10)) ? text(value).slice(0, 10) : '';
const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const rate = (value, total) => total ? Math.round(n(value) * 10000 / n(total)) / 100 : 0;

function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}

function latestBatch(db, requestedDate = '') {
  const date = dateOnly(requestedDate);
  return date
    ? db.prepare(`SELECT b.batchId,b.snapshotId,b.reportDate,b.sourceName,b.fileHash,b.createdAt,COALESCE(s.status,'IMPORTED') snapshotStatus
        FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
        WHERE b.status='VALID' AND b.reportDate=? ORDER BY b.createdAt DESC,b.batchId DESC LIMIT 1`).get(date) || null
    : db.prepare(`SELECT b.batchId,b.snapshotId,b.reportDate,b.sourceName,b.fileHash,b.createdAt,COALESCE(s.status,'IMPORTED') snapshotStatus
        FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
        WHERE b.status='VALID' ORDER BY b.reportDate DESC,b.createdAt DESC,b.batchId DESC LIMIT 1`).get() || null;
}

function historyRows(db, limit = 60) {
  const bounded = Math.max(1, Math.min(120, Number(limit) || 60));
  return db.prepare(`WITH ranked AS (
      SELECT b.reportDate,b.snapshotId,b.batchId,b.sourceName,b.fileHash,b.createdAt,COALESCE(s.status,'IMPORTED') snapshotStatus,
             ROW_NUMBER() OVER(PARTITION BY b.reportDate ORDER BY b.createdAt DESC,b.batchId DESC) rn
      FROM unified_import_batches b LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId WHERE b.status='VALID')
    SELECT reportDate,snapshotId,batchId,sourceName,fileHash,createdAt,snapshotStatus FROM ranked
    WHERE rn=1 ORDER BY reportDate DESC,createdAt DESC LIMIT ?`).all(bounded);
}

function importedCounts(db, snapshotId) {
  const result = Object.fromEntries(CORE_TYPES.map(type => [type, 0]));
  if (!snapshotId) return result;
  const rows = db.prepare(`SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType`).all(snapshotId);
  for (const row of rows) {
    const type = text(row.businessType).toUpperCase();
    if (Object.hasOwn(result, type)) result[type] = n(row.count);
  }
  return result;
}

function mergeMetric(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === 'number' && Number.isFinite(value)) target[key] = n(target[key]) + value;
  }
  return target;
}

function cachedMetricsByType(db, batch, counts) {
  const byType = Object.fromEntries(CORE_TYPES.map(type => [type, { total: n(counts[type]) }]));
  if (!batch?.reportDate || !batch?.snapshotId) return byType;
  let rows = [];
  try {
    rows = db.prepare(`SELECT businessType,metricsJson FROM dashboard_daily_cache
      WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED' ORDER BY businessType,regionCode`)
      .all(batch.reportDate, batch.snapshotId);
  } catch {}
  if (!rows.length) return byType;
  const seen = new Set();
  for (const row of rows) {
    const type = text(row.businessType).toUpperCase();
    if (!Object.hasOwn(byType, type)) continue;
    if (!seen.has(type)) { byType[type] = {}; seen.add(type); }
    mergeMetric(byType[type], safeJson(row.metricsJson, {}));
  }
  for (const type of CORE_TYPES) {
    const m = byType[type];
    if (!Number.isFinite(Number(m.total)) || n(m.total) <= 0) m.total = n(counts[type]);
    m.pod = n(m.pod);
    m.returned = n(m.returned);
    m.podRate = rate(m.pod, m.total);
    m.returnRate = rate(m.returned, m.total);
    m.unresolved = Math.max(0, n(m.total) - n(m.pod) - n(m.returned));
    m.firstAttemptRate = n(m.firstAttemptRate || m.dispatchAttempt1Rate || rate(m.attempt1, m.total));
  }
  return byType;
}

function addMetricSets(types, byType) {
  const out = {};
  for (const type of types) mergeMetric(out, byType[type] || {});
  out.total = types.reduce((sum, type) => sum + n(byType[type]?.total), 0);
  out.pod = types.reduce((sum, type) => sum + n(byType[type]?.pod), 0);
  out.returned = types.reduce((sum, type) => sum + n(byType[type]?.returned), 0);
  out.podRate = rate(out.pod, out.total);
  out.returnRate = rate(out.returned, out.total);
  out.unresolved = Math.max(0, out.total - out.pod - out.returned);
  out.firstAttemptRate = rate(types.reduce((sum, type) => sum + n(byType[type]?.attempt1), 0), out.total);
  return out;
}

function ccslState(type, batch, metrics) {
  const total = n(metrics.total);
  return {
    businessType: type === 'CCSL' ? 'CCSL' : type,
    viewBusinessType: type,
    reportDate: batch?.reportDate || '', snapshotId: batch?.snapshotId || '', snapshotStatus: batch?.snapshotStatus || 'IMPORTED',
    sourceName: batch?.sourceName || '', batchId: batch?.batchId || '', dailyReportReady: Boolean(batch?.reportDate && total),
    sourceTotal: total, total, pnhBills: [], dailyParseRows: [], finalRows: [], scanResults: [], trackResults: [], trackEvents: [], carryBills: [], nextCarryBills: [], podLocks: [], historySummary: [], logs: [],
    dailyParseSummary: { totalRecognized: total, pnh: total },
    processing: { running: false, paused: false, phase: batch?.snapshotStatus === 'COMPLETED' ? '处理完成' : '待处理' },
    dashboard: {
      pnh: total, totalMonitored: total, todayPod: n(metrics.pod), podRate: n(metrics.podRate), abnormalCount: Math.max(0, total - n(metrics.pod)),
      metrics,
      categories: {
        pendingTotal: n(metrics.pending1), ocTotal: n(metrics.oc1), ccslCnDiversion: n(metrics.ccslCnDiversion),
        ccslZtDiversion: n(metrics.ccslZtDiversion), ccsl580Diversion: n(metrics.ccsl580Diversion),
        phnomPenhShop: n(metrics.phnomPenhShop || n(metrics.shopTransit) + n(metrics.shopArrived))
      },
      routing: {
        ccslCnDiversion: n(metrics.ccslCnDiversion), ccslZtDiversion: n(metrics.ccslZtDiversion),
        ccsl580Diversion: n(metrics.ccsl580Diversion), phnomPenhShop: n(metrics.phnomPenhShop || n(metrics.shopTransit) + n(metrics.shopArrived))
      }
    },
    detailTabs: { dashboard: { rows: [], total: 0 }, allData: { rows: [], total }, coreAbnormal: { rows: [], total: Math.max(0, total - n(metrics.pod)) } },
    _v212IndexedSummary: true
  };
}

function shopeeState(type, batch, metrics) {
  const total = n(metrics.total);
  const state = ccslState(type, batch, metrics);
  state.businessType = type === 'SHOPEE' ? 'SHOPEE' : 'SHOPEE';
  state.viewBusinessType = type;
  state.total = total;
  state.dashboard = {
    ...state.dashboard,
    metrics,
    recipientGroups: { ALL: { metrics, regions: {} } },
    regions: {}, dashboardRows: [], detailTabs: { dashboard: { rows: [], total: 0 } }
  };
  state.detailTabs = { dashboard: { rows: [], total: 0 }, all: { rows: [], total }, abnormal: { rows: [], total: n(metrics.unresolved) } };
  return state;
}

function stateForType(type, batch, byType) {
  const normalized = text(type).toUpperCase();
  if (normalized === 'CCSL') return ccslState('CCSL', batch, addMetricSets([...CCSL_TYPES], byType));
  if (normalized === 'SHOPEE') return shopeeState('SHOPEE', batch, addMetricSets([...SHOPEE_TYPES], byType));
  if (CCSL_TYPES.has(normalized)) return ccslState(normalized, batch, byType[normalized] || {});
  if (SHOPEE_TYPES.has(normalized)) return shopeeState(normalized, batch, byType[normalized] || {});
  return null;
}

function buildIndexedTruth(requestedDate = '') {
  const db = getDb();
  const batch = latestBatch(db, requestedDate);
  if (!batch) return { batch: null, counts: Object.fromEntries(CORE_TYPES.map(type => [type, 0])), byType: Object.fromEntries(CORE_TYPES.map(type => [type, { total: 0 }])) };
  const counts = importedCounts(db, batch.snapshotId);
  const byType = cachedMetricsByType(db, batch, counts);
  return { batch, counts, byType };
}

function whppHistory(db, reportDate) {
  const row = db.prepare(`SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(reportDate);
  return safeJson(row?.summaryJson, {});
}

function whppRawTotal(db, reportDate, history = null) {
  const report = db.prepare(`SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(reportDate);
  if (report?.totalCount !== undefined && report?.totalCount !== null) return n(report.totalCount);
  const historyTotal = Number(history?.total);
  if (Number.isFinite(historyTotal) && historyTotal >= 0) return historyTotal;
  return n(db.prepare(`SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?`).get(reportDate)?.count);
}

function buildSummary(requestedDate = '') {
  const db = getDb();
  const { batch, counts } = buildIndexedTruth(requestedDate);
  if (!batch) return { ok: true, patchId: PATCH_ID, reportDate: '', counts: {}, total: 0, shopeeWhpp: {}, whppSummary: { reportDate: '', completed: false, metrics: { total: 0 } } };
  const key = `${batch.snapshotId}|${batch.reportDate}|fast`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.payload, cacheHit: true };
  const history = whppHistory(db, batch.reportDate);
  counts.WHPP = whppRawTotal(db, batch.reportDate, history);
  const total = Object.values(counts).reduce((sum, value) => sum + n(value), 0);
  const whppMetrics = { ...history, total: n(history.total ?? counts.WHPP), pod: n(history.pod), returned: n(history.returned) };
  whppMetrics.podRate = rate(whppMetrics.pod, whppMetrics.total);
  whppMetrics.returnRate = rate(whppMetrics.returned, whppMetrics.total);
  whppMetrics.unresolved = Math.max(0, whppMetrics.total - whppMetrics.pod - whppMetrics.returned);
  const payload = { ok: true, patchId: PATCH_ID, reportDate: batch.reportDate, snapshotId: batch.snapshotId, counts, total, shopeeWhpp: {}, whppSummary: { reportDate: batch.reportDate, completed: Object.keys(history).length > 0, metrics: whppMetrics }, generatedAt: new Date().toISOString(), cacheHit: false };
  cache.set(key, { at: Date.now(), payload });
  return payload;
}

async function buildBootstrap(req) {
  const now = Date.now();
  if (bootstrapCache && now - bootstrapCacheAt < CACHE_MS) return { ...bootstrapCache, cacheHit: true };
  const startedAt = Date.now();
  const db = getDb();
  const { batch, counts, byType } = buildIndexedTruth();
  const history = historyRows(db, 60);
  const businessStates = Object.fromEntries(CORE_TYPES.map(type => [type, stateForType(type, batch, byType)]));
  const state = stateForType('CCSL', batch, byType);
  const shopeeStateValue = stateForType('SHOPEE', batch, byType);
  const token = await loadToken();
  const total = Object.values(counts).reduce((sum, value) => sum + n(value), 0);
  const unifiedImport = batch ? {
    batchId: batch.batchId, snapshotId: batch.snapshotId, reportDate: batch.reportDate, sourceName: batch.sourceName || '', fileHash: batch.fileHash || '', snapshotStatus: batch.snapshotStatus || 'IMPORTED',
    classificationCounts: counts, summary: { validUniqueWaybills: total, totalUnique: total },
    sourceReconciliation: { validUniqueWaybills: total, classifiedWaybills: total, difference: 0, balanced: true }, carryover: { todayOpen: 0, historicalOpen: 0, currentOpen: 0 }
  } : null;
  const payload = {
    ok: true, patchId: PATCH_ID, bootstrapMode: 'V212_INDEXED_DIRECT', state, shopeeState: shopeeStateValue,
    authStatus: summarizeToken(token), session: { ok: true, user: publicUser(req.user), unreadNotifications: 0 },
    history: { CCSL: history, SHOPEE: history, UNIFIED: history }, unifiedImport, businessStates,
    generatedAt: new Date().toISOString(), serverBuildMs: Date.now() - startedAt, cacheHit: false
  };
  bootstrapCache = payload; bootstrapCacheAt = Date.now();
  return payload;
}

function summaryHandler(req, res) {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const payload = buildSummary(url.searchParams.get('date') || url.searchParams.get('reportDate') || '');
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.setHeader('X-CE-QC-Dashboard', 'V212-INDEXED-FIRST-PAINT');
    res.setHeader('Server-Timing', `v212;dur=${Date.now() - startedAt}`);
    res.json(payload);
  } catch (error) { res.status(500).json({ ok: false, patchId: PATCH_ID, error: error?.message || String(error) }); }
}

async function bootstrapHandler(req, res) {
  try {
    const payload = await buildBootstrap(req);
    res.setHeader('Cache-Control', 'private, max-age=5');
    res.setHeader('X-CE-QC-Bootstrap', payload.cacheHit ? 'V212-HIT' : 'V212-MISS');
    res.setHeader('Server-Timing', `bootstrap;dur=${n(payload.serverBuildMs)}`);
    res.json(payload);
  } catch (error) { res.status(500).json({ ok: false, patchId: PATCH_ID, code: 'V212_BOOTSTRAP_FAILED', error: error?.message || String(error) }); }
}

function fastBusinessStateHandler(req, res, type) {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const { batch, byType } = buildIndexedTruth(url.searchParams.get('date') || '');
    const state = stateForType(type, batch, byType);
    if (!state) return res.status(400).json({ ok: false, error: '业务板块无效' });
    res.setHeader('Cache-Control', 'private, max-age=5');
    res.setHeader('X-CE-QC-Business-State', 'V212-INDEXED-DIRECT');
    res.json({ ok: true, businessType: state.viewBusinessType || state.businessType, reportDate: state.reportDate, snapshotId: state.snapshotId, snapshotStatus: state.snapshotStatus, state });
  } catch (error) { res.status(500).json({ ok: false, patchId: PATCH_ID, error: error?.message || String(error) }); }
}

const PERF_WRAP = Symbol.for('ce-qc.v209.request-timing');
if (!express.application[PERF_WRAP]) {
  const previousHandle = express.application.handle;
  express.application.handle = function v212AuthenticatedFastHandle(req, res, callback) {
    const startedAt = Date.now();
    const method = String(req?.method || '');
    const urlText = String(req?.originalUrl || req?.url || '');
    const pathname = (() => { try { return new URL(urlText, 'http://127.0.0.1').pathname; } catch { return urlText.split('?')[0]; } })();
    const selected = /^(?:\/api\/bootstrap|\/api\/v89\/instant-dashboard|\/api\/business-state\/|\/api\/v204\/ceaf-fast-state|\/api\/state(?:\?|$)|\/api\/shopee\/state(?:\?|$)|\/api\/import\/unified-latest(?:\?|$))/.test(urlText);
    const finish = () => {
      const duration = Date.now() - startedAt;
      if (selected || (urlText.startsWith('/api/') && duration >= 250)) {
        const authority = pathname === BOOTSTRAP_ROUTE ? ` authority=${String(res?.getHeader?.('X-CE-QC-Bootstrap') || 'none')}` : '';
        console.log(`[CE-QC][PERF][V209] ${method} ${urlText} status=${Number(res?.statusCode || 0)} duration=${duration}ms${authority}`);
      }
    };
    res?.once?.('finish', finish);
    res?.once?.('close', () => { if (!res?.writableFinished && selected) console.log(`[CE-QC][PERF][V209] ${method} ${urlText} closed-before-finish duration=${Date.now() - startedAt}ms`); });

    const direct = method === 'GET' && (
      pathname === BOOTSTRAP_ROUTE || pathname === SUMMARY_ROUTE || pathname === CEAF_FAST_ROUTE ||
      (pathname.startsWith(BUSINESS_ROUTE_PREFIX) && new URL(urlText, 'http://127.0.0.1').searchParams.get('compact') === '1')
    );
    if (!direct) return previousHandle.call(this, req, res, callback);

    return accessIdentity(req, res, () => {
      if (pathname === BOOTSTRAP_ROUTE) return void bootstrapHandler(req, res);
      if (pathname === SUMMARY_ROUTE) return summaryHandler(req, res);
      if (pathname === CEAF_FAST_ROUTE) return fastBusinessStateHandler(req, res, 'CEAF');
      const type = decodeURIComponent(pathname.slice(BUSINESS_ROUTE_PREFIX.length)).toUpperCase();
      return fastBusinessStateHandler(req, res, type);
    });
  };
  Object.defineProperty(express.application, PERF_WRAP, { value: true, configurable: false });
  console.log(`[CE-QC][V212] ${PATCH_ID} installed; bootstrap + compact business reads bypass legacy heavy route stack after normal access authentication.`);
}

const previousGet = express.application.get;
express.application.get = function v212FastDashboardGet(pathValue, ...handlers) {
  if (pathValue === SUMMARY_ROUTE && handlers.length) return previousGet.call(this, pathValue, summaryHandler);
  return previousGet.call(this, pathValue, ...handlers);
};

export function inspectV90FastDashboard(requestedDate = '') { return buildSummary(requestedDate); }
export const V90_FAST_DASHBOARD_READ_PATCH_ID = PATCH_ID;
export const V209_DASHBOARD_REQUEST_TIMING_PATCH_ID = PERF_PATCH_ID;
export const V212_AUTHENTICATED_INDEXED_BOOTSTRAP_ID = PATCH_ID;
