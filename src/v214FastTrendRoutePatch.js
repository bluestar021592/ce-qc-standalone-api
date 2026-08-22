import express from 'express';
import { getDb } from './db.js';

export const V214_FAST_TREND_ROUTE_ID = '2026-08-22-v214-cache-backed-trends-v1';
const ROUTE = '/api/v27/trends';
const TYPES = new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','CCSL','SHOPEE']);
const GROUP_TYPES = Object.freeze({
  CCSL: ['CE','CEAF','TBKH','ALI1688'],
  SHOPEE: ['SHOPEECN','SHOPEEVN']
});
const CACHE_MS = 30_000;
const responseCache = new Map();

const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const rate = (value, total) => total ? Math.round(n(value) * 10000 / n(total)) / 100 : 0;
const validDate = value => {
  const date = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
};
function safeJson(value) {
  try { return JSON.parse(String(value || '{}')) || {}; }
  catch { return {}; }
}

function resolveTrendWindow(db, fromDate, toDate) {
  const singleDay = fromDate === toDate;
  const rows = singleDay
    ? db.prepare(`
        SELECT DISTINCT reportDate
        FROM unified_import_batches
        WHERE status='VALID' AND reportDate<=?
        ORDER BY reportDate DESC
        LIMIT 7
      `).all(toDate)
    : db.prepare(`
        SELECT DISTINCT reportDate
        FROM unified_import_batches
        WHERE status='VALID' AND reportDate BETWEEN ? AND ?
        ORDER BY reportDate DESC
        LIMIT 7
      `).all(fromDate, toDate);
  const dates = rows.map(row => String(row.reportDate || '')).filter(Boolean).sort();
  return {
    dates,
    from: dates[0] || fromDate,
    to: dates.at(-1) || toDate
  };
}

function latestSnapshot(db, reportDate) {
  return db.prepare(`
    SELECT snapshotId
    FROM unified_import_batches
    WHERE status='VALID' AND reportDate=?
    ORDER BY createdAt DESC,batchId DESC
    LIMIT 1
  `).get(reportDate)?.snapshotId || '';
}

function rawRowsForDate(db, reportDate, snapshotId, types) {
  if (!snapshotId || !types.length) return [];
  const placeholders = types.map(() => '?').join(',');
  let cached = [];
  try {
    cached = db.prepare(`
      SELECT businessType,regionCode,metricsJson
      FROM dashboard_daily_cache
      WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED'
        AND businessType IN (${placeholders})
      ORDER BY businessType,regionCode
    `).all(reportDate, snapshotId, ...types).map(row => ({
      businessType: String(row.businessType || '').toUpperCase(),
      regionCode: String(row.regionCode || '').toUpperCase(),
      ...safeJson(row.metricsJson)
    }));
  } catch {}
  if (cached.length) return cached;

  return db.prepare(`
    SELECT businessType,COUNT(*) AS total
    FROM unified_import_rows
    WHERE snapshotId=? AND reportDate=? AND businessType IN (${placeholders})
    GROUP BY businessType
  `).all(snapshotId, reportDate, ...types).map(row => ({
    businessType: String(row.businessType || '').toUpperCase(),
    total: n(row.total), pod: 0, oc1: 0, attempt1: 0, attempt2: 0, attempt3: 0
  }));
}

function summarize(rows) {
  const out = {
    total: 0, pod: 0, oc1: 0, attempt1: 0, attempt2: 0, attempt3: 0,
    weightedFirst: 0, weightedFirstBase: 0, weightedOc: 0, weightedOcBase: 0
  };
  for (const row of rows) {
    const total = n(row.total);
    out.total += total;
    out.pod += n(row.pod);
    out.oc1 += n(row.oc1);
    out.attempt1 += n(row.attempt1 ?? row.dispatchAttempt1);
    out.attempt2 += n(row.attempt2 ?? row.dispatchAttempt2);
    out.attempt3 += n(row.attempt3 ?? row.dispatchAttempt3);
    const first = Number(row.firstPodRate ?? row.firstAttemptRate ?? row.dispatchAttempt1Rate);
    if (Number.isFinite(first) && total > 0) {
      out.weightedFirst += first * total;
      out.weightedFirstBase += total;
    }
    const ocRate = Number(row.ocRate);
    if (Number.isFinite(ocRate) && total > 0) {
      out.weightedOc += ocRate * total;
      out.weightedOcBase += total;
    }
  }
  out.podRate = rate(out.pod, out.total);
  out.ocRate = out.oc1 > 0 ? rate(out.oc1, out.total)
    : out.weightedOcBase ? Number((out.weightedOc / out.weightedOcBase).toFixed(2)) : 0;
  out.firstRate = out.weightedFirstBase ? Number((out.weightedFirst / out.weightedFirstBase).toFixed(2)) : out.podRate;
  return out;
}

function buildPayload(type, requestedFrom, requestedTo) {
  const db = getDb();
  const trendWindow = resolveTrendWindow(db, requestedFrom, requestedTo);
  const memberTypes = GROUP_TYPES[type] || [type];
  const shopee = type === 'SHOPEE' || type.startsWith('SHOPEE');
  const payload = {
    dates: [...trendWindow.dates], ticket: [], podRate: [], ocRate: [], firstRate: [],
    attempt1: [], attempt2: [], attempt3: [], attempt1Count: [], attempt2Count: [],
    attempt3Count: [], attemptDenominator: [], attemptUnknownPod: []
  };

  for (const reportDate of trendWindow.dates) {
    const snapshotId = latestSnapshot(db, reportDate);
    const rows = rawRowsForDate(db, reportDate, snapshotId, memberTypes);
    const m = summarize(rows);
    payload.ticket.push(m.total);
    payload.podRate.push(m.podRate);
    payload.ocRate.push(m.ocRate);
    payload.firstRate.push(shopee ? rate(m.attempt1, m.total) || m.firstRate : m.firstRate);
    if (shopee) {
      payload.attemptDenominator.push(m.total);
      payload.attempt1Count.push(m.attempt1);
      payload.attempt2Count.push(m.attempt2);
      payload.attempt3Count.push(m.attempt3);
      payload.attempt1.push(rate(m.attempt1, m.total));
      payload.attempt2.push(rate(m.attempt2, m.total));
      payload.attempt3.push(rate(m.attempt3, m.total));
      payload.attemptUnknownPod.push(0);
    }
  }

  return {
    ok: true,
    businessType: type,
    requestedFromDate: requestedFrom,
    requestedToDate: requestedTo,
    fromDate: trendWindow.from,
    toDate: trendWindow.to,
    trendWindowDates: trendWindow.dates,
    historySource: 'DASHBOARD_DAILY_CACHE_V214',
    patchId: V214_FAST_TREND_ROUTE_ID,
    ...payload
  };
}

function fastTrendHandler(req, res) {
  const started = Date.now();
  try {
    const type = String(req.query.businessType || 'CCSL').toUpperCase();
    if (!TYPES.has(type)) return res.status(400).json({ ok:false, error:'业务板块无效' });
    const requestedTo = validDate(req.query.to);
    const requestedFrom = validDate(req.query.from) || requestedTo;
    if (!requestedFrom || !requestedTo || requestedFrom > requestedTo) return res.status(400).json({ ok:false, error:'日期范围无效' });
    const key = `${type}|${requestedFrom}|${requestedTo}`;
    const hit = responseCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      res.setHeader('Cache-Control','private, max-age=30, stale-while-revalidate=120');
      res.setHeader('X-CE-QC-Trends','V214-HIT');
      return res.json({ ...hit.payload, cacheHit:true });
    }
    const payload = buildPayload(type, requestedFrom, requestedTo);
    responseCache.set(key, { at:Date.now(), payload });
    res.setHeader('Cache-Control','private, max-age=30, stale-while-revalidate=120');
    res.setHeader('X-CE-QC-Trends','V214-MISS');
    res.setHeader('Server-Timing', `trend;dur=${Date.now()-started}`);
    return res.json({ ...payload, cacheHit:false });
  } catch (error) {
    console.error('[CE-QC][V214][TRENDS]', error?.stack || error);
    return res.status(500).json({ ok:false, patchId:V214_FAST_TREND_ROUTE_ID, error:error?.message || String(error) });
  }
}

const previousGet = express.application.get;
express.application.get = function v214FastTrendRegistration(pathValue, ...handlers) {
  if (String(pathValue || '') === ROUTE && handlers.length) {
    console.log(`[CE-QC][V214] ${V214_FAST_TREND_ROUTE_ID} replaced heavy ${ROUTE} registration with cache-backed reader.`);
    return previousGet.call(this, pathValue, fastTrendHandler);
  }
  return previousGet.call(this, pathValue, ...handlers);
};
