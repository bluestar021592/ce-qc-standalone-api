import './v206InteractiveFirstRuntimePatch.js';
import express from 'express';
import { getDb } from './db.js';
import { loadV351UnifiedWhppMembership } from './v351WhppUnifiedDashboardBridgePatch.js';

const PATCH_ID = '2026-08-31-v388-current-queue-includes-historical-open-v1';
const TARGETS = new Set(['/api/bootstrap', '/api/import/unified-latest']);
const TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const WRAPPED = Symbol.for('ce-qc.v161-unified-import-runtime-truth');

function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function num(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function one(sql, ...params) { return num(getDb().prepare(sql).get(...params)?.count); }

function batchFor(base = {}) {
  const db = getDb();
  const snapshotId = String(base?.snapshotId || '').trim();
  if (snapshotId) {
    const row = db.prepare("SELECT * FROM unified_import_batches WHERE snapshotId=? AND status='VALID' LIMIT 1").get(snapshotId);
    if (row) return row;
  }
  const reportDate = String(base?.reportDate || '').trim();
  if (reportDate) {
    const row = db.prepare("SELECT * FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1").get(reportDate);
    if (row) return row;
  }
  return db.prepare("SELECT * FROM unified_import_batches WHERE status='VALID' ORDER BY createdAt DESC LIMIT 1").get() || null;
}

function directWhppMembership(reportDate = '') {
  const date = String(reportDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { count: 0, source: 'INVALID_REPORT_DATE', direct: false };
  const db = getDb();
  let daily = null;
  try {
    daily = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date) || null;
  } catch {}
  if (daily) {
    const expected = num(daily.totalCount);
    const actual = one("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''", date);
    if (expected === actual) {
      return { count: actual, source: actual > 0 ? 'WHPP_STANDARD_DAILY' : 'WHPP_STANDARD_DAILY_ZERO', direct: true, expected, actual };
    }
    return { count: 0, source: 'WHPP_STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED', direct: true, expected, actual };
  }
  try {
    const fallback = loadV351UnifiedWhppMembership(date, db);
    if (fallback?.present) {
      return {
        count: Array.isArray(fallback.bills) ? fallback.bills.length : Array.isArray(fallback.rows) ? fallback.rows.length : 0,
        source: fallback.membershipSource || 'V351_SAFE_HISTORY_DISASTER_FALLBACK',
        direct: false
      };
    }
  } catch {}
  return { count: 0, source: 'NO_SAFE_WHPP_MEMBERSHIP', direct: false };
}

function classificationTruth(batch) {
  const counts = Object.fromEntries(TYPES.map(type => [type, 0]));
  if (!batch) return { counts, whpp: { count: 0, source: 'NO_VALID_BATCH', direct: false } };
  const rows = getDb().prepare('SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE batchId=? GROUP BY businessType').all(batch.batchId);
  for (const row of rows) if (Object.prototype.hasOwnProperty.call(counts, row.businessType) && row.businessType !== 'WHPP') counts[row.businessType] = num(row.count);
  const whpp = directWhppMembership(batch.reportDate);
  counts.WHPP = num(whpp.count);
  return { counts, whpp };
}

function regionCounts(batch, baseRegions = {}) {
  const base = {
    PP: num(baseRegions?.PP),
    PV: num(baseRegions?.PV),
    UNKNOWN: num(baseRegions?.UNKNOWN)
  };
  if (!batch) return base;
  const stored = safeJson(batch.regionCountsJson, {});
  const storedPP = num(stored.PP), storedPV = num(stored.PV), storedUnknown = num(stored.UNKNOWN);
  if (storedPP + storedPV > 0) return { ...stored, PP: storedPP, PV: storedPV, UNKNOWN: storedUnknown };
  const rows = getDb().prepare(`SELECT UPPER(COALESCE(regionCode,'')) regionCode,COUNT(*) count
    FROM unified_import_rows WHERE batchId=? GROUP BY UPPER(COALESCE(regionCode,''))`).all(batch.batchId);
  const out = { PP: 0, PV: 0, UNKNOWN: 0 };
  for (const row of rows) {
    if (row.regionCode === 'PP') out.PP += num(row.count);
    else if (row.regionCode === 'PV') out.PV += num(row.count);
    else out.UNKNOWN += num(row.count);
  }
  // V388: a recovered immutable-source metadata payload outranks an old batch
  // whose persisted regionCode column was empty. Never overwrite recovered PP/PV
  // with zeros merely because legacy unified_import_rows lacked region evidence.
  if (out.PP + out.PV === 0 && base.PP + base.PV > 0) return base;
  return out;
}

function snapshotMeta(batch) {
  if (!batch) return { status: '', payload: {} };
  const row = getDb().prepare('SELECT status,payloadJson FROM unified_snapshots WHERE snapshotId=? LIMIT 1').get(batch.snapshotId) || {};
  return { status: String(row.status || 'IMPORTED'), payload: safeJson(row.payloadJson, {}) };
}

function runtimeCarry(batch, counts, snapshotStatus, baseCarry = {}) {
  const reportDate = String(batch?.reportDate || '');
  const historicalOpen = one("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate<?", reportDate);
  if (snapshotStatus !== 'COMPLETED') {
    const mainQueue = TYPES.reduce((sum, type) => sum + num(counts[type]), 0);
    return {
      ...baseCarry,
      todayOpen: mainQueue,
      historicalOpen,
      rechecked: num(baseCarry?.rechecked),
      currentOpen: mainQueue + historicalOpen,
      historicalSeparate: true,
      runtimeTruth: 'CURRENT_SEVEN_BUSINESS_IMPORT_MEMBERS_PLUS_HISTORICAL_OPEN'
    };
  }
  const todayOpen = one("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate=?", reportDate);
  return {
    ...baseCarry,
    todayOpen,
    historicalOpen,
    currentOpen: todayOpen + historicalOpen,
    historicalSeparate: true,
    runtimeTruth: 'COMPLETED_TODAY_OPEN_PLUS_HISTORICAL_OPEN'
  };
}

function normalizeImport(base = {}) {
  const batch = batchFor(base);
  if (!batch) return base;
  const truth = classificationTruth(batch);
  const counts = truth.counts;
  const regions = regionCounts(batch, base.regionCounts || {});
  const meta = snapshotMeta(batch);
  const currentImportTotal = TYPES.reduce((sum, type) => sum + num(counts[type]), 0);
  const whppIncomplete = truth.whpp.source === 'WHPP_STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED';
  const summary = {
    ...safeJson(batch.summaryJson, {}),
    ...(base.summary || {}),
    validUniqueWaybills: currentImportTotal,
    totalUnique: currentImportTotal
  };
  const sourceReconciliation = {
    ...(base.sourceReconciliation || {}),
    businessTypes: [...TYPES],
    validUniqueWaybills: currentImportTotal,
    classifiedWaybills: currentImportTotal,
    difference: whppIncomplete ? num(truth.whpp.expected) - num(truth.whpp.actual) : 0,
    balanced: !whppIncomplete,
    runtimeTruth: 'SIX_LEGACY_UNIFIED_PARTITIONS_PLUS_DIRECT_WHPP_DAILY'
  };
  return {
    ...base,
    batchId: batch.batchId,
    snapshotId: batch.snapshotId,
    reportDate: batch.reportDate,
    sourceName: batch.sourceName || base.sourceName || '',
    dateDetectionSource: batch.dateDetectionSource || base.dateDetectionSource || '数据库批次',
    dateCandidates: safeJson(batch.dateCandidatesJson, base.dateCandidates || []),
    dateWasManuallyCorrected: Boolean(batch.dateWasManuallyCorrected),
    classificationCounts: counts,
    regionCounts: regions,
    summary,
    sourceReconciliation,
    containerFormat: base.containerFormat || meta.payload?.containerFormat || 'OOXML_ZIP',
    snapshotStatus: meta.status,
    carryover: runtimeCarry(batch, counts, meta.status, base.carryover || {}),
    whppClassificationSource: truth.whpp.source,
    whppClassificationCount: num(truth.whpp.count),
    whppDirectDailyPrimary: Boolean(truth.whpp.direct),
    whppMembershipIncomplete: whppIncomplete,
    runtimeTruthPatch: PATCH_ID
  };
}

function wrapRoute(handler) {
  if (typeof handler !== 'function' || handler[WRAPPED]) return handler;
  const wrapped = function v161UnifiedImportRuntimeTruthHandler(req, res, next) {
    const originalJson = res.json;
    res.json = function v161Json(payload) {
      try {
        if (req.path === '/api/bootstrap' && payload?.unifiedImport) payload.unifiedImport = normalizeImport(payload.unifiedImport);
        if (req.path === '/api/import/unified-latest' && payload?.import) payload.import = normalizeImport(payload.import);
      } catch (error) {
        console.warn('[CE-QC][V161] runtime truth normalization failed:', error?.message || error);
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
express.application.get = function v161UnifiedImportRuntimeTruthGet(...args) {
  if (args.length >= 2 && TARGETS.has(String(args[0] || ''))) {
    return previousGet.apply(this, [args[0], ...args.slice(1).map(wrapRoute)]);
  }
  return previousGet.apply(this, args);
};

export { normalizeImport as normalizeV161UnifiedImport, runtimeCarry as runtimeV388CarryTruth, regionCounts as regionCountsV388 };
export const V161_UNIFIED_IMPORT_RUNTIME_TRUTH_PATCH_ID = PATCH_ID;
