import express from 'express';
import { getDb } from './db.js';
import { loadV207CanonicalRowsForDate, V207_IMPORT_INTEGRITY_VERSION, V207_TYPES } from './v207UnifiedImportIntegrity.js';

const PATCH_ID = '2026-08-19-v207-unified-import-runtime-truth-v2';
const TARGETS = new Set(['/api/bootstrap', '/api/import/unified-latest']);
const TYPES = [...V207_TYPES];
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

function ledgerRows(batch) {
  if (!batch?.reportDate) return [];
  try { return loadV207CanonicalRowsForDate(String(batch.reportDate)); }
  catch { return []; }
}
function classificationCounts(batch) {
  const out = Object.fromEntries(TYPES.map(type => [type, 0]));
  if (!batch) return out;
  const ledger = ledgerRows(batch);
  if (ledger.length) {
    for (const row of ledger) if (Object.prototype.hasOwnProperty.call(out, row.businessType)) out[row.businessType] += 1;
    return out;
  }
  const rows = getDb().prepare('SELECT businessType,COUNT(*) count FROM unified_import_rows WHERE batchId=? GROUP BY businessType').all(batch.batchId);
  for (const row of rows) if (Object.prototype.hasOwnProperty.call(out, row.businessType)) out[row.businessType] = num(row.count);
  try { out.WHPP = Number(getDb().prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(batch.reportDate)?.count || 0); } catch {}
  return out;
}

function regionCounts(batch) {
  if (!batch) return { PP: 0, PV: 0, UNKNOWN: 0 };
  const ledger = ledgerRows(batch);
  if (ledger.length) {
    return {
      PP: ledger.filter(row => String(row.regionCode || '').toUpperCase() === 'PP').length,
      PV: ledger.filter(row => String(row.regionCode || '').toUpperCase() === 'PV').length,
      UNKNOWN: ledger.filter(row => !['PP','PV'].includes(String(row.regionCode || '').toUpperCase())).length
    };
  }
  const stored = safeJson(batch.regionCountsJson, {});
  const storedPP = num(stored.PP), storedPV = num(stored.PV), storedUnknown = num(stored.UNKNOWN);
  if (storedPP + storedPV + storedUnknown > 0) return { ...stored, PP: storedPP, PV: storedPV, UNKNOWN: storedUnknown };
  const rows = getDb().prepare(`SELECT UPPER(COALESCE(regionCode,'')) regionCode,COUNT(*) count
    FROM unified_import_rows WHERE batchId=? GROUP BY UPPER(COALESCE(regionCode,''))`).all(batch.batchId);
  const out = { PP: 0, PV: 0, UNKNOWN: 0 };
  for (const row of rows) {
    if (row.regionCode === 'PP') out.PP += num(row.count);
    else if (row.regionCode === 'PV') out.PV += num(row.count);
    else out.UNKNOWN += num(row.count);
  }
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
      rechecked: 0,
      currentOpen: mainQueue,
      historicalSeparate: true,
      runtimeTruth: 'V207_SEVEN_BUSINESS_CANONICAL_MEMBERS'
    };
  }
  const todayOpen = one("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate=?", reportDate);
  return {
    ...baseCarry,
    todayOpen,
    historicalOpen,
    currentOpen: todayOpen,
    historicalSeparate: true,
    runtimeTruth: 'COMPLETED_OPEN_ITEMS'
  };
}

function normalizeImport(base = {}) {
  const batch = batchFor(base);
  if (!batch) return base;
  const ledger = ledgerRows(batch);
  const counts = classificationCounts(batch);
  const regions = regionCounts(batch);
  const meta = snapshotMeta(batch);
  const summary = { ...safeJson(batch.summaryJson, {}), ...(base.summary || {}) };
  const recovered = ledger.filter(row => row.v207RecoveredFromPrior).length;
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
    summary: {
      ...summary,
      canonicalUniqueWaybills: ledger.length || TYPES.reduce((sum,type)=>sum+num(counts[type]),0),
      recoveredFromEarlierUpload: recovered
    },
    v207Rebaseline: ledger.length ? {
      version: V207_IMPORT_INTEGRITY_VERSION,
      canonicalUnique: ledger.length,
      recoveredFromEarlierUpload: recovered,
      completeReupload: recovered === 0
    } : { version: V207_IMPORT_INTEGRITY_VERSION, canonicalUnique: 0, status: 'WAITING_REUPLOAD' },
    containerFormat: base.containerFormat || meta.payload?.containerFormat || 'OOXML_ZIP',
    snapshotStatus: meta.status,
    carryover: runtimeCarry(batch, counts, meta.status, base.carryover || {}),
    runtimeTruthPatch: PATCH_ID
  };
}

function wrapRoute(handler) {
  if (typeof handler !== 'function' || handler[WRAPPED]) return handler;
  const wrapped = function v207UnifiedImportRuntimeTruthHandler(req, res, next) {
    const originalJson = res.json;
    res.json = function v207Json(payload) {
      try {
        if (req.path === '/api/bootstrap' && payload?.unifiedImport) payload.unifiedImport = normalizeImport(payload.unifiedImport);
        if (req.path === '/api/import/unified-latest' && payload?.import) payload.import = normalizeImport(payload.import);
      } catch (error) {
        console.warn('[CE-QC][V207] runtime truth normalization failed:', error?.message || error);
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
express.application.get = function v207UnifiedImportRuntimeTruthGet(...args) {
  if (args.length >= 2 && TARGETS.has(String(args[0] || ''))) {
    return previousGet.apply(this, [args[0], ...args.slice(1).map(wrapRoute)]);
  }
  return previousGet.apply(this, args);
};

export { normalizeImport as normalizeV161UnifiedImport };
export const V161_UNIFIED_IMPORT_RUNTIME_TRUTH_PATCH_ID = PATCH_ID;
