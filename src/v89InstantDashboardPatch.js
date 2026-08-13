import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-13-v89-instant-dashboard-source-truth-v1';
const SUMMARY_ROUTE = '/api/v89/instant-dashboard';
const DETAIL_ROUTE = '/api/v89/shopee-whpp-detail';
const CORE_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const cache = new Map();
const CACHE_MS = Math.max(5_000, Number(process.env.V89_DASHBOARD_CACHE_MS || 30_000));

function text(value) { return String(value ?? '').trim(); }
function dateOnly(value) {
  const valueText = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : '';
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}
function token(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/[\s_-]+/g, '');
}
function isAirMarker(value) {
  const normalized = token(value);
  return normalized === 'CCAF' || normalized === 'CEAF';
}
function rowHasExactAirMarker(row = {}) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  return Object.values(raw).some(isAirMarker);
}
function placeholders(size) { return Array.from({ length: size }, () => '?').join(','); }

function latestBatch(db, requestedDate = '') {
  const date = dateOnly(requestedDate);
  if (date) {
    return db.prepare(`
      SELECT batchId,snapshotId,reportDate,createdAt
      FROM unified_import_batches
      WHERE status='VALID' AND reportDate=?
      ORDER BY createdAt DESC LIMIT 1
    `).get(date) || null;
  }
  return db.prepare(`
    SELECT batchId,snapshotId,reportDate,createdAt
    FROM unified_import_batches
    WHERE status='VALID'
    ORDER BY reportDate DESC,createdAt DESC LIMIT 1
  `).get() || null;
}

function importedCounts(db, snapshotId) {
  const result = Object.fromEntries(CORE_TYPES.map(type => [type, 0]));
  if (!snapshotId) return result;
  for (const row of db.prepare(`
    SELECT businessType,COUNT(*) AS count
    FROM unified_import_rows
    WHERE snapshotId=?
    GROUP BY businessType
  `).all(snapshotId)) {
    if (Object.hasOwn(result, row.businessType)) result[row.businessType] = Number(row.count || 0);
  }
  return result;
}

function whppRawTotal(db, reportDate) {
  const report = db.prepare(`
    SELECT totalCount FROM business_daily_reports
    WHERE businessType='WHPP' AND reportDate=?
    LIMIT 1
  `).get(reportDate);
  if (report?.totalCount !== undefined && report?.totalCount !== null) return Number(report.totalCount || 0);
  return Number(db.prepare(`
    SELECT COUNT(DISTINCT shipmentCode) AS count
    FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=?
  `).get(reportDate)?.count || 0);
}

function airCandidatesInWhpp(db, reportDate) {
  const rows = db.prepare(`
    SELECT shipmentCode,rowJson
    FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=?
      AND (UPPER(COALESCE(rowJson,'')) LIKE '%CCAF%' OR UPPER(COALESCE(rowJson,'')) LIKE '%CEAF%')
  `).all(reportDate);
  const map = new Map();
  for (const record of rows) {
    const shipmentCode = text(record.shipmentCode).toUpperCase();
    if (!shipmentCode) continue;
    const row = safeJson(record.rowJson, {});
    if (rowHasExactAirMarker(row)) map.set(shipmentCode, row);
  }
  return [...map.keys()];
}

function correctAirClassification(db, batch, counts, whppTotal) {
  const candidates = airCandidatesInWhpp(db, batch.reportDate);
  if (!candidates.length) return { counts, whpp: whppTotal, movedToCeaf: 0, removedFromWhpp: 0, candidates: [] };
  const currentByBill = new Map();
  const marks = placeholders(candidates.length);
  for (const row of db.prepare(`
    SELECT shipmentCode,businessType
    FROM unified_import_rows
    WHERE snapshotId=? AND shipmentCode IN (${marks})
  `).all(batch.snapshotId, ...candidates)) {
    currentByBill.set(text(row.shipmentCode).toUpperCase(), text(row.businessType).toUpperCase());
  }

  const corrected = { ...counts };
  let movedToCeaf = 0;
  let removedFromWhpp = 0;
  for (const bill of candidates) {
    // A WHPP parse-row with an exact CCAF/CEAF source marker is never WHPP stock.
    // Remove that duplicate/wrong source assignment from WHPP regardless of whether
    // an earlier repair already created the CEAF unified row.
    if (whppTotal - removedFromWhpp > 0) removedFromWhpp += 1;
    const current = currentByBill.get(bill) || '';
    if (current === 'CEAF') continue;
    if (Object.hasOwn(corrected, current)) corrected[current] = Math.max(0, Number(corrected[current] || 0) - 1);
    corrected.CEAF = Number(corrected.CEAF || 0) + 1;
    movedToCeaf += 1;
  }
  return {
    counts: corrected,
    whpp: Math.max(0, Number(whppTotal || 0) - removedFromWhpp),
    movedToCeaf,
    removedFromWhpp,
    candidates
  };
}

function whppFinalWhere() {
  return `
    AND COALESCE(f.isPod,0)=0
    AND UPPER(COALESCE(f.primaryCategory,'')) NOT IN ('POD','POD闭环','退回','RETURN','RETURNED','RETURN_COMPLETED')
    AND COALESCE(f.rawJson,'') NOT LIKE '%\"退回状态\":\"已退回\"%'
    AND COALESCE(f.rawJson,'') NOT LIKE '%\"currentState\":\"RETURN_COMPLETED\"%'
    AND COALESCE(f.rawJson,'') NOT LIKE '%\"currentState\":\"RETURNED\"%'
    AND COALESCE(f.rawJson,'') NOT LIKE '%\"orderStatus\":\"100\"%'
    AND COALESCE(f.rawJson,'') NOT LIKE '%\"orderStatus\":100%'
    AND (
      UPPER(REPLACE(REPLACE(REPLACE(COALESCE(f.latestNode,''),' ',''),'CEL:',''),'CE:',''))='WHPP'
      OR UPPER(COALESCE(f.latestEventDesc,'')) LIKE '%CE:WHPP%'
      OR UPPER(COALESCE(f.latestEventDesc,'')) LIKE '%CEL:WHPP%'
      OR COALESCE(f.primaryCategory,'')='WHPP滞留包裹'
      OR COALESCE(f.rawJson,'') LIKE '%SHOPEE_WHPP_RETENTION%'
    )
  `;
}

function shopeeWhppCount(db, batch, type) {
  if (!batch?.snapshotId || !['SHOPEECN', 'SHOPEEVN'].includes(type)) return 0;
  return Number(db.prepare(`
    SELECT COUNT(DISTINCT f.shipmentCode) AS count
    FROM business_final_rows f
    WHERE f.reportDate=?
      AND f.businessType IN ('SHOPEE', ?)
      AND EXISTS (
        SELECT 1 FROM unified_import_rows u
        WHERE u.snapshotId=? AND u.businessType=? AND u.shipmentCode=f.shipmentCode
      )
      ${whppFinalWhere()}
  `).get(batch.reportDate, type, batch.snapshotId, type)?.count || 0);
}

function buildSummary(requestedDate = '') {
  const db = getDb();
  const batch = latestBatch(db, requestedDate);
  if (!batch) return { ok: true, patchId: PATCH_ID, reportDate: '', counts: {}, total: 0, shopeeWhpp: { SHOPEECN: 0, SHOPEEVN: 0 } };
  const cacheKey = `${batch.snapshotId}|${batch.reportDate}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached.payload, cacheHit: true };

  const baseCounts = importedCounts(db, batch.snapshotId);
  const whppSource = whppRawTotal(db, batch.reportDate);
  const correction = correctAirClassification(db, batch, baseCounts, whppSource);
  const counts = { ...correction.counts, WHPP: correction.whpp };
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const payload = {
    ok: true,
    patchId: PATCH_ID,
    reportDate: batch.reportDate,
    snapshotId: batch.snapshotId,
    counts,
    total,
    shopeeWhpp: {
      SHOPEECN: shopeeWhppCount(db, batch, 'SHOPEECN'),
      SHOPEEVN: shopeeWhppCount(db, batch, 'SHOPEEVN')
    },
    sourceCorrection: {
      exactAirMarkerBills: correction.candidates.length,
      movedToCeaf: correction.movedToCeaf,
      removedFromWhpp: correction.removedFromWhpp,
      reason: 'WHPP source rows carrying an exact CCAF/CEAF marker are displayed as CEAF without rewriting immutable historical snapshots.'
    },
    generatedAt: new Date().toISOString(),
    cacheHit: false
  };
  cache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

function summaryHandler(req, res) {
  try {
    const payload = buildSummary(req.query.date || req.query.reportDate || '');
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.setHeader('Server-Timing', `v89;desc=instant-summary`);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ ok: false, patchId: PATCH_ID, error: error?.message || String(error) });
  }
}

function detailHandler(req, res) {
  try {
    const type = text(req.query.businessType).toUpperCase();
    if (!['SHOPEECN', 'SHOPEEVN'].includes(type)) return res.status(400).json({ ok: false, error: 'businessType仅支持SHOPEECN或SHOPEEVN。' });
    const db = getDb();
    const batch = latestBatch(db, req.query.date || req.query.reportDate || '');
    if (!batch) return res.json({ ok: true, rows: [], total: 0, businessType: type, reportDate: '' });
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(500, Number(req.query.pageSize || 200)));
    const offset = (page - 1) * pageSize;
    const total = shopeeWhppCount(db, batch, type);
    const rows = db.prepare(`
      SELECT f.reportDate,f.shipmentCode,u.regionCode,f.latestEventTime,f.latestEventDesc,f.latestNode
      FROM business_final_rows f
      INNER JOIN unified_import_rows u
        ON u.snapshotId=? AND u.businessType=? AND u.shipmentCode=f.shipmentCode
      WHERE f.reportDate=? AND f.businessType IN ('SHOPEE', ?)
        ${whppFinalWhere()}
      ORDER BY f.latestEventTime DESC,f.shipmentCode
      LIMIT ? OFFSET ?
    `).all(batch.snapshotId, type, batch.reportDate, type, pageSize, offset).map(row => ({
      reportDate: row.reportDate,
      shipmentCode: row.shipmentCode,
      运单号: row.shipmentCode,
      businessType: type,
      regionCode: row.regionCode || '',
      responsibilityHub: 'WHPP',
      currentState: 'SHOPEE_WHPP_RETENTION',
      primaryCategory: 'WHPP滞留包裹',
      latestEventTime: row.latestEventTime || '',
      最后节点时间: row.latestEventTime || '',
      latestEventDesc: row.latestEventDesc || row.latestNode || 'CE:WHPP',
      最后节点: row.latestEventDesc || row.latestNode || 'CE:WHPP'
    }));
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.json({ ok: true, patchId: PATCH_ID, businessType: type, reportDate: batch.reportDate, total, page, pageSize, rows });
  } catch (error) {
    res.status(500).json({ ok: false, patchId: PATCH_ID, error: error?.message || String(error) });
  }
}

const originalListen = express.application.listen;
let installed = false;
express.application.listen = function v89InstantDashboardListen(...args) {
  if (!installed) {
    installed = true;
    this.get(SUMMARY_ROUTE, summaryHandler);
    this.get(DETAIL_ROUTE, detailHandler);
  }
  return originalListen.apply(this, args);
};

export function inspectInstantDashboard(requestedDate = '') { return buildSummary(requestedDate); }
export const V89_INSTANT_DASHBOARD_PATCH_ID = PATCH_ID;
