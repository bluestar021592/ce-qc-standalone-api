import express from 'express';
import { getDb } from './db.js';

export const V214_FAST_TREND_ROUTE_ID = '2026-08-22-v214-cache-backed-trends-v1';
export const V232_FAST_DAILY_TREND_ID = '2026-08-22-v232-fast-seven-business-daily-trends-v1';
const ROUTE = '/api/v27/trends';
const STANDARD_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const TYPES = new Set([...STANDARD_TYPES,'WHPP','CCSL','SHOPEE','ALL']);
const GROUP_TYPES = Object.freeze({
  CCSL: ['CE','CEAF','TBKH','ALI1688'],
  SHOPEE: ['SHOPEECN','SHOPEEVN'],
  ALL: STANDARD_TYPES
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
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '{}')) || {}); }
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
        ORDER BY reportDate ASC
        LIMIT 180
      `).all(fromDate, toDate);
  const dates = rows.map(row => String(row.reportDate || '')).filter(Boolean).sort();
  return {
    dates,
    from: dates[0] || fromDate,
    to: dates.at(-1) || toDate,
    mode: singleDay ? 'LAST_7_VALID_DAYS' : 'FULL_SELECTED_RANGE'
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

function standardRowsForDate(db, reportDate, snapshotId, types) {
  const selected = (types || []).filter(type => STANDARD_TYPES.includes(type));
  if (!snapshotId || !selected.length) return [];
  const placeholders = selected.map(() => '?').join(',');
  let cached = [];
  try {
    cached = db.prepare(`
      SELECT businessType,regionCode,metricsJson
      FROM dashboard_daily_cache
      WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED'
        AND businessType IN (${placeholders})
      ORDER BY businessType,regionCode
    `).all(reportDate, snapshotId, ...selected).map(row => ({
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
  `).all(snapshotId, reportDate, ...selected).map(row => ({
    businessType: String(row.businessType || '').toUpperCase(),
    total: n(row.total), pod: 0, returned: 0, pending1: 0, oc1: 0,
    delivery1: 0, deliveryStay: 0, attempt1: 0, attempt2: 0, attempt3: 0
  }));
}

function whppRowForDate(db, reportDate) {
  let daily = null;
  let history = null;
  try {
    daily = db.prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate) || null;
  } catch {}
  try {
    history = db.prepare("SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(reportDate) || null;
  } catch {}
  const summary = { ...safeJson(daily?.summaryJson), ...safeJson(history?.summaryJson) };
  const total = n(summary.total ?? daily?.totalCount);
  return {
    businessType: 'WHPP',
    regionCode: '',
    ...summary,
    total,
    pod: n(summary.pod),
    returned: n(summary.returned),
    pending1: n(summary.pending1 ?? summary.pending),
    pending2: n(summary.pending2),
    pending3: n(summary.pending3),
    oc1: n(summary.oc1),
    oc2: n(summary.oc2),
    oc3: n(summary.oc3),
    delivery1: n(summary.delivery1 ?? summary.delivering ?? summary.deliveryStay),
    deliveryStay: n(summary.deliveryStay ?? summary.delivering ?? summary.delivery1)
  };
}

function rowsForDate(db, reportDate, snapshotId, type) {
  if (type === 'WHPP') return [whppRowForDate(db, reportDate)];
  const standard = standardRowsForDate(db, reportDate, snapshotId, GROUP_TYPES[type] || [type]);
  if (type === 'ALL') standard.push(whppRowForDate(db, reportDate));
  return standard;
}

function summarize(rows) {
  const out = {
    total: 0, pod: 0, returned: 0, pending1: 0, delivering: 0, oc1: 0,
    attempt1: 0, attempt2: 0, attempt3: 0, attemptUnknown: 0,
    weightedFirst: 0, weightedFirstBase: 0, weightedOc: 0, weightedOcBase: 0
  };
  for (const row of rows) {
    const total = n(row.total);
    out.total += total;
    out.pod += n(row.pod);
    out.returned += n(row.returned);
    out.pending1 += n(row.pending1 ?? row.pending);
    out.delivering += n(row.delivery1 ?? row.deliveryStay ?? row.delivering);
    out.oc1 += n(row.oc1);
    out.attempt1 += n(row.attempt1 ?? row.dispatchAttempt1);
    out.attempt2 += n(row.attempt2 ?? row.dispatchAttempt2);
    out.attempt3 += n(row.attempt3 ?? row.dispatchAttempt3);
    out.attemptUnknown += n(row.attemptUnknown ?? row.attemptUnknownPod);
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
  out.returnRate = rate(out.returned, out.total);
  out.pendingRate = rate(out.pending1, out.total);
  out.deliveringRate = rate(out.delivering, out.total);
  out.ocRate = out.oc1 > 0 ? rate(out.oc1, out.total)
    : out.weightedOcBase ? Number((out.weightedOc / out.weightedOcBase).toFixed(2)) : 0;
  out.firstRate = out.weightedFirstBase ? Number((out.weightedFirst / out.weightedFirstBase).toFixed(2)) : 0;
  return out;
}

function buildPayload(type, requestedFrom, requestedTo) {
  const db = getDb();
  const trendWindow = resolveTrendWindow(db, requestedFrom, requestedTo);
  const shopee = type === 'SHOPEE' || type.startsWith('SHOPEE');
  const payload = {
    dates: [...trendWindow.dates], ticket: [], pod: [], podRate: [], returned: [], returnRate: [],
    pending1: [], pendingRate: [], delivering: [], deliveringRate: [], ocRate: [], firstRate: [],
    attempt1: [], attempt2: [], attempt3: [], attempt1Count: [], attempt2Count: [],
    attempt3Count: [], attemptDenominator: [], attemptUnknownPod: [], daily: []
  };

  for (const reportDate of trendWindow.dates) {
    const snapshotId = latestSnapshot(db, reportDate);
    const rows = rowsForDate(db, reportDate, snapshotId, type);
    const m = summarize(rows);
    payload.ticket.push(m.total);
    payload.pod.push(m.pod);
    payload.podRate.push(m.podRate);
    payload.returned.push(m.returned);
    payload.returnRate.push(m.returnRate);
    payload.pending1.push(m.pending1);
    payload.pendingRate.push(m.pendingRate);
    payload.delivering.push(m.delivering);
    payload.deliveringRate.push(m.deliveringRate);
    payload.ocRate.push(m.ocRate);
    payload.firstRate.push(m.firstRate);
    if (shopee) {
      const attemptBase = m.pod;
      payload.attemptDenominator.push(attemptBase);
      payload.attempt1Count.push(m.attempt1);
      payload.attempt2Count.push(m.attempt2);
      payload.attempt3Count.push(m.attempt3);
      payload.attempt1.push(rate(m.attempt1, attemptBase));
      payload.attempt2.push(rate(m.attempt2, attemptBase));
      payload.attempt3.push(rate(m.attempt3, attemptBase));
      payload.attemptUnknownPod.push(Math.max(m.attemptUnknown, Math.max(0, attemptBase - m.attempt1 - m.attempt2 - m.attempt3)));
    }
    payload.daily.push({
      date: reportDate,
      total: m.total,
      pod: m.pod,
      podRate: m.podRate,
      returned: m.returned,
      returnRate: m.returnRate,
      pending1: m.pending1,
      pendingRate: m.pendingRate,
      delivering: m.delivering,
      deliveringRate: m.deliveringRate,
      ocRate: m.ocRate,
      firstRate: m.firstRate
    });
  }

  return {
    ok: true,
    businessType: type,
    requestedFromDate: requestedFrom,
    requestedToDate: requestedTo,
    fromDate: trendWindow.from,
    toDate: trendWindow.to,
    trendWindowDates: trendWindow.dates,
    trendWindowMode: trendWindow.mode,
    historySource: 'DASHBOARD_DAILY_CACHE_PLUS_WHPP_HISTORY_V232',
    patchId: V214_FAST_TREND_ROUTE_ID,
    fastDailyTrendId: V232_FAST_DAILY_TREND_ID,
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
      res.setHeader('X-CE-QC-Trends','V232-HIT');
      return res.json({ ...hit.payload, cacheHit:true });
    }
    const payload = buildPayload(type, requestedFrom, requestedTo);
    responseCache.set(key, { at:Date.now(), payload });
    res.setHeader('Cache-Control','private, max-age=30, stale-while-revalidate=120');
    res.setHeader('X-CE-QC-Trends','V232-MISS');
    res.setHeader('Server-Timing', `trend;dur=${Date.now()-started}`);
    return res.json({ ...payload, cacheHit:false });
  } catch (error) {
    console.error('[CE-QC][V232][TRENDS]', error?.stack || error);
    return res.status(500).json({ ok:false, patchId:V214_FAST_TREND_ROUTE_ID, fastDailyTrendId:V232_FAST_DAILY_TREND_ID, error:error?.message || String(error) });
  }
}

const previousGet = express.application.get;
express.application.get = function v214FastTrendRegistration(pathValue, ...handlers) {
  if (String(pathValue || '') === ROUTE && handlers.length) {
    console.log(`[CE-QC][V232] ${V232_FAST_DAILY_TREND_ID} replaced heavy ${ROUTE} registration with seven-business cache reader.`);
    return previousGet.call(this, pathValue, fastTrendHandler);
  }
  return previousGet.call(this, pathValue, ...handlers);
};
