import express from 'express';
import { getDb } from './db.js';

const PATCH_ID = '2026-08-13-v90-fast-dashboard-normalized-read-v1';
const SUMMARY_ROUTE = '/api/v89/instant-dashboard';
const CORE_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const CACHE_MS = Math.max(5_000, Number(process.env.V90_DASHBOARD_CACHE_MS || 30_000));
const cache = new Map();

const text = value => String(value ?? '').trim();
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value).slice(0, 10)) ? text(value).slice(0, 10) : '';
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : JSON.parse(String(value || '')) || fallback; }
  catch { return fallback; }
}
function token(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/[\s_-]+/g, '');
}
function isAirMarker(value) { return ['CCAF', 'CEAF'].includes(token(value)); }
function rowHasExactAirMarker(row = {}) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {};
  return Object.values(raw).some(isAirMarker);
}
function placeholders(size) { return Array.from({ length: size }, () => '?').join(','); }

function latestBatch(db, requestedDate = '') {
  const date = dateOnly(requestedDate);
  return date
    ? db.prepare(`SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC LIMIT 1`).get(date) || null
    : db.prepare(`SELECT batchId,snapshotId,reportDate,createdAt FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1`).get() || null;
}

function importedCounts(db, snapshotId) {
  const result = Object.fromEntries(CORE_TYPES.map(type => [type, 0]));
  if (!snapshotId) return result;
  const rows = db.prepare(`SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE snapshotId=? GROUP BY businessType`).all(snapshotId);
  for (const row of rows) if (Object.hasOwn(result, row.businessType)) result[row.businessType] = Number(row.count || 0);
  return result;
}

function whppRawTotal(db, reportDate) {
  const report = db.prepare(`SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(reportDate);
  if (report?.totalCount !== undefined && report?.totalCount !== null) return Number(report.totalCount || 0);
  return Number(db.prepare(`SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?`).get(reportDate)?.count || 0);
}

// This deliberately scans only the tiny WHPP import membership for exact source
// markers. It never scans the large final-row raw JSON table.
function airCandidatesInWhpp(db, reportDate) {
  const rows = db.prepare(`SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?`).all(reportDate);
  const out = new Map();
  for (const record of rows) {
    const bill = text(record.shipmentCode).toUpperCase();
    if (!bill) continue;
    const row = safeJson(record.rowJson, {});
    if (rowHasExactAirMarker(row)) out.set(bill, row);
  }
  return [...out.keys()];
}

function correctAirClassification(db, batch, counts, whppTotal) {
  const candidates = airCandidatesInWhpp(db, batch.reportDate);
  if (!candidates.length) return { counts, whpp: whppTotal, movedToCeaf: 0, removedFromWhpp: 0, candidates: [] };
  const marks = placeholders(candidates.length);
  const currentByBill = new Map();
  for (const row of db.prepare(`SELECT shipmentCode,businessType FROM unified_import_rows WHERE snapshotId=? AND shipmentCode IN (${marks})`).all(batch.snapshotId, ...candidates)) {
    currentByBill.set(text(row.shipmentCode).toUpperCase(), text(row.businessType).toUpperCase());
  }
  const corrected = { ...counts };
  let movedToCeaf = 0;
  for (const bill of candidates) {
    const current = currentByBill.get(bill) || '';
    if (current === 'CEAF') continue;
    if (Object.hasOwn(corrected, current)) corrected[current] = Math.max(0, Number(corrected[current] || 0) - 1);
    corrected.CEAF = Number(corrected.CEAF || 0) + 1;
    movedToCeaf += 1;
  }
  return {
    counts: corrected,
    whpp: Math.max(0, Number(whppTotal || 0) - candidates.length),
    movedToCeaf,
    removedFromWhpp: candidates.length,
    candidates
  };
}

function shopeeWhppCount(db, batch, type) {
  if (!batch?.snapshotId || !['SHOPEECN', 'SHOPEEVN'].includes(type)) return 0;
  return Number(db.prepare(`
    SELECT COUNT(DISTINCT f.shipmentCode) count
    FROM business_final_rows f
    WHERE f.reportDate=?
      AND f.businessType IN ('SHOPEE', ?)
      AND COALESCE(f.isPod,0)=0
      AND UPPER(COALESCE(f.primaryCategory,'')) NOT IN ('POD','POD闭环','退回','RETURN','RETURNED','RETURN_COMPLETED')
      AND EXISTS (
        SELECT 1 FROM unified_import_rows u
        WHERE u.snapshotId=? AND u.businessType=? AND u.shipmentCode=f.shipmentCode
      )
      AND NOT EXISTS (
        SELECT 1 FROM business_scan_results sr
        WHERE sr.reportDate=f.reportDate AND sr.shipmentCode=f.shipmentCode
          AND sr.businessType IN ('SHOPEE', ?)
          AND (COALESCE(sr.isPod,0)=1 OR CAST(COALESCE(sr.orderStatus,'') AS TEXT) IN ('85','100'))
      )
      AND (
        UPPER(REPLACE(REPLACE(REPLACE(COALESCE(f.latestNode,''),' ',''),'CEL:',''),'CE:',''))='WHPP'
        OR UPPER(COALESCE(f.latestEventDesc,'')) LIKE '%CE:WHPP%'
        OR UPPER(COALESCE(f.latestEventDesc,'')) LIKE '%CEL:WHPP%'
        OR COALESCE(f.primaryCategory,'')='WHPP滞留包裹'
      )
  `).get(batch.reportDate, type, batch.snapshotId, type, type)?.count || 0);
}

function fastWhppSummary(db, reportDate, total) {
  const row = db.prepare(`SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(reportDate);
  const history = safeJson(row?.summaryJson, {});
  const metrics = { ...history, total: Number(history.total ?? total ?? 0) };
  delete metrics.accounting;
  delete metrics.snapshotId;
  const numberKeys = ['pod','podRate','returned','returnRate','cancelled','cancelRate','unresolved','pendingNonContinuous','pending1','pending2','pending3','oc1','oc2','oc3','cycle2','inboundNoScan','workOrder','delivery','phnomPenhShop','provinceShop'];
  for (const key of numberKeys) metrics[key] = Number(metrics[key] || 0);
  if (!Number.isFinite(metrics.podRate)) metrics.podRate = metrics.total ? metrics.pod * 100 / metrics.total : 0;
  if (!Number.isFinite(metrics.returnRate)) metrics.returnRate = metrics.total ? metrics.returned * 100 / metrics.total : 0;
  if (!Number.isFinite(metrics.cancelRate)) metrics.cancelRate = metrics.total ? metrics.cancelled * 100 / metrics.total : 0;
  if (!Number.isFinite(metrics.unresolved) || metrics.unresolved < 0) metrics.unresolved = Math.max(0, metrics.total - metrics.pod - metrics.returned - metrics.cancelled);
  return { reportDate, completed: Boolean(row), metrics };
}

function buildSummary(requestedDate = '') {
  const db = getDb();
  const batch = latestBatch(db, requestedDate);
  if (!batch) return { ok:true, patchId:PATCH_ID, reportDate:'', counts:{}, total:0, shopeeWhpp:{SHOPEECN:0,SHOPEEVN:0}, whppSummary:{reportDate:'',completed:false,metrics:{total:0}} };
  const key = `${batch.snapshotId}|${batch.reportDate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.payload, cacheHit:true };
  const baseCounts = importedCounts(db, batch.snapshotId);
  const whppSource = whppRawTotal(db, batch.reportDate);
  const correction = correctAirClassification(db, batch, baseCounts, whppSource);
  const counts = { ...correction.counts, WHPP: correction.whpp };
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const payload = {
    ok:true,
    patchId:PATCH_ID,
    reportDate:batch.reportDate,
    snapshotId:batch.snapshotId,
    counts,
    total,
    shopeeWhpp:{
      SHOPEECN:shopeeWhppCount(db,batch,'SHOPEECN'),
      SHOPEEVN:shopeeWhppCount(db,batch,'SHOPEEVN')
    },
    whppSummary:fastWhppSummary(db,batch.reportDate,correction.whpp),
    sourceCorrection:{
      exactAirMarkerBills:correction.candidates.length,
      movedToCeaf:correction.movedToCeaf,
      removedFromWhpp:correction.removedFromWhpp,
      reason:'Exact CCAF/CEAF source markers are displayed as CEAF without rewriting immutable completed snapshots.'
    },
    generatedAt:new Date().toISOString(),
    cacheHit:false
  };
  cache.set(key,{at:Date.now(),payload});
  return payload;
}

function summaryHandler(req,res) {
  const startedAt = Date.now();
  try {
    const payload = buildSummary(req.query.date || req.query.reportDate || '');
    res.setHeader('Cache-Control','private, max-age=10');
    res.setHeader('X-CE-QC-Dashboard','V90-NORMALIZED');
    res.setHeader('Server-Timing',`v90;dur=${Date.now()-startedAt}`);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ok:false,patchId:PATCH_ID,error:error?.message||String(error)});
  }
}

// V89 registers its route only when app.listen() is called. V90 loads after V89
// but before server.js, so intercept that registration and swap only the summary
// handler. Detail/export/business rules remain untouched.
const previousGet = express.application.get;
express.application.get = function v90FastDashboardGet(pathValue, ...handlers) {
  if (pathValue === SUMMARY_ROUTE && handlers.length) return previousGet.call(this, pathValue, summaryHandler);
  return previousGet.call(this, pathValue, ...handlers);
};

export function inspectV90FastDashboard(requestedDate='') { return buildSummary(requestedDate); }
export const V90_FAST_DASHBOARD_READ_PATCH_ID = PATCH_ID;
