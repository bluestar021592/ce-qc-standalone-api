import express from 'express';
import { getDb } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';
import { saveWhppDailyImport } from './whppStore.js';

export const V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID = '2026-08-28-v351-whpp-unified-membership-dashboard-bridge-v1';
const SUMMARY_ROUTE = '/api/v71/whpp-summary';
const UNIFIED_IMPORT_ROUTE = '/api/import/unified-daily-report';
const WRAPPED_POST = Symbol.for('ce-qc.v351-whpp-unified-import-post');
let summaryInstalled = false;

function dateOnly(value = '') {
  const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}
function safeJson(value, fallback = {}) {
  try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); }
  catch { return fallback; }
}
function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}
function uniqueRows(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const bill = billOf(row);
    if (bill) map.set(bill, { ...row, shipmentCode: bill, 运单号: bill, businessType: 'WHPP' });
  }
  return [...map.values()];
}

function latestUnifiedDate(db) {
  return String(db.prepare(`SELECT MAX(reportDate) reportDate FROM unified_import_batches WHERE status='VALID'`).get()?.reportDate || '');
}

export function loadV351UnifiedWhppMembership(reportDate = '', db = getDb()) {
  const date = dateOnly(reportDate) || dateOnly(latestUnifiedDate(db));
  if (!date) return { present: false, reportDate: '', batchId: '', snapshotId: '', sourceName: '', rows: [], bills: [] };
  const batch = db.prepare(`SELECT batchId,snapshotId,reportDate,sourceName FROM unified_import_batches
    WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1`).get(date);
  if (!batch) return { present: false, reportDate: date, batchId: '', snapshotId: '', sourceName: '', rows: [], bills: [] };
  const rows = uniqueRows(db.prepare(`SELECT shipmentCode,regionCode,rowJson FROM unified_import_rows
    WHERE batchId=? AND businessType='WHPP' ORDER BY shipmentCode`).all(batch.batchId).map(row => ({
      ...safeJson(row.rowJson, {}),
      shipmentCode: String(row.shipmentCode || '').trim().toUpperCase(),
      运单号: String(row.shipmentCode || '').trim().toUpperCase(),
      businessType: 'WHPP',
      reportDate: date,
      regionCode: row.regionCode || safeJson(row.rowJson, {}).regionCode || ''
    })));
  return {
    present: true,
    reportDate: date,
    batchId: String(batch.batchId || ''),
    snapshotId: String(batch.snapshotId || ''),
    sourceName: String(batch.sourceName || ''),
    rows,
    bills: rows.map(billOf)
  };
}

function loadStandardWhppMembership(reportDate, db) {
  const daily = db.prepare(`SELECT reportDate,sourceFile,totalCount,summaryJson FROM business_daily_reports
    WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(reportDate);
  if (!daily) return { present: false, daily: null, rows: [], bills: [] };
  const rows = uniqueRows(db.prepare(`SELECT shipmentCode,rowJson FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row => ({
      ...safeJson(row.rowJson, {}), shipmentCode: row.shipmentCode, 运单号: row.shipmentCode, businessType: 'WHPP', reportDate
    })));
  return { present: true, daily, rows, bills: rows.map(billOf) };
}

function loadWhppFinalRows(reportDate, db) {
  return uniqueRows(db.prepare(`SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson
    FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row => ({
      ...safeJson(row.rawJson, {}),
      shipmentCode: row.shipmentCode,
      运单号: row.shipmentCode,
      businessType: 'WHPP',
      reportDate,
      isPod: Number(row.isPod || 0),
      primaryCategory: row.primaryCategory || safeJson(row.rawJson, {}).primaryCategory || '',
      apiStatus: row.apiStatus || '',
      carryStatus: row.carryStatus || '',
      latestEventTime: row.latestEventTime || safeJson(row.rawJson, {}).latestEventTime || '',
      latestEventDesc: row.latestEventDesc || safeJson(row.rawJson, {}).latestEventDesc || '',
      latestNode: row.latestNode || safeJson(row.rawJson, {}).latestNode || ''
    })));
}

export function buildV351WhppDashboard({ reportDate = '', membershipRows = [], finalRows = [] } = {}) {
  const members = uniqueRows(membershipRows);
  return buildWhppDashboard({
    businessType: 'WHPP',
    reportDate: dateOnly(reportDate),
    dailyReportReady: true,
    pnhBills: members.map(billOf),
    dailyParseRows: members,
    finalRows: uniqueRows(finalRows)
  });
}

function summaryForDate(reportDate = '') {
  const db = getDb();
  const requested = dateOnly(reportDate);
  const unified = loadV351UnifiedWhppMembership(requested, db);
  const date = requested || unified.reportDate;
  if (!date) return null;
  const standard = loadStandardWhppMembership(date, db);
  // Latest VALID unified membership is canonical whenever that report date exists,
  // including a legitimate zero-WHPP day. Older standard rows/history must not
  // override a newer unified classification.
  const membershipRows = unified.present ? unified.rows : standard.rows;
  if (!unified.present && !standard.present) return null;
  const finalRows = loadWhppFinalRows(date, db);
  const dashboard = buildV351WhppDashboard({ reportDate: date, membershipRows, finalRows });
  const history = db.prepare(`SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(date);
  const historySummary = safeJson(history?.summaryJson, {});
  const staleHistory = Boolean(history && Number(historySummary.total ?? -1) !== Number(dashboard.metrics.total || 0));
  return {
    reportDate: date,
    total: Number(dashboard.metrics.total || 0),
    metrics: dashboard.metrics,
    regions: dashboard.regions,
    regionPvUnresolved: Number(dashboard.regions?.PV?.unresolved || 0),
    activeStoreRetention: Number((dashboard.detailTabs?.phnomPenhShop?.rows || []).filter(row => Number(row.shopRetentionNaturalDays || 0) >= 2).length + (dashboard.detailTabs?.provinceShop?.rows || []).filter(row => Number(row.shopRetentionNaturalDays || 0) >= 2).length),
    selfPickup: Number((dashboard.detailTabs?.normalDiversion?.rows || []).filter(row => String(row.specialState || row.primaryCategory || row.主分类 || '').toUpperCase() === 'SELF_PICKUP').length),
    completed: Boolean(history) && !staleHistory,
    state: { reportDate: date, dailyReportReady: true, snapshotStatus: history && !staleHistory ? 'COMPLETED' : 'RECONCILED_FROM_UNIFIED' },
    dashboard,
    truthSource: unified.present ? 'LATEST_VALID_UNIFIED_MEMBERSHIP' : 'WHPP_STANDARD_DAILY',
    unifiedMembership: unified.present ? unified.bills.length : null,
    standardMembership: standard.present ? Number(standard.daily?.totalCount || standard.bills.length || 0) : null,
    finalEvidenceRows: finalRows.length,
    staleHistoryRejected: staleHistory,
    patchId: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID
  };
}

export function ensureV351WhppNormalizedDaily(reportDate = '') {
  const db = getDb();
  const unified = loadV351UnifiedWhppMembership(reportDate, db);
  if (!unified.present) return { repaired: false, reason: 'NO_VALID_UNIFIED_BATCH', reportDate: unified.reportDate || dateOnly(reportDate) };
  const standard = loadStandardWhppMembership(unified.reportDate, db);
  const standardCount = standard.present ? Number(standard.daily?.totalCount || 0) : -1;
  const sameMembers = standard.present && standardCount === unified.bills.length && standard.bills.length === unified.bills.length && (() => {
    const set = new Set(standard.bills); return unified.bills.every(code => set.has(code));
  })();
  if (sameMembers) return { repaired: false, reason: 'STANDARD_DAILY_CURRENT', reportDate: unified.reportDate, total: unified.bills.length };
  const state = saveWhppDailyImport({
    reportDate: unified.reportDate,
    sourceName: unified.sourceName,
    rows: unified.rows,
    batchId: unified.batchId,
    snapshotId: unified.snapshotId
  });
  console.log('[CE-QC][V351_WHPP_BRIDGE_REPAIRED]', JSON.stringify({ reportDate: unified.reportDate, total: unified.bills.length, batchId: unified.batchId }));
  return { repaired: true, reason: 'UNIFIED_TO_WHPP_STANDARD_DAILY', reportDate: unified.reportDate, total: unified.bills.length, state };
}

function summaryHandler(req, res, next) {
  try {
    const summary = summaryForDate(req.query?.reportDate || '');
    if (!summary) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...summary });
  } catch (error) {
    console.error('[CE-QC][V351_WHPP_SUMMARY]', error?.stack || error);
    next();
  }
}

const previousListen = express.application.listen;
express.application.listen = function v351WhppUnifiedDashboardBridgeListen(...args) {
  if (!summaryInstalled) {
    summaryInstalled = true;
    this.get(SUMMARY_ROUTE, summaryHandler);
  }
  return previousListen.apply(this, args);
};

const previousPost = express.application.post;
if (typeof previousPost === 'function' && !previousPost[WRAPPED_POST]) {
  const wrappedPost = function v351WhppUnifiedImportPost(pathValue, ...handlers) {
    if (String(pathValue || '') !== UNIFIED_IMPORT_ROUTE) return previousPost.call(this, pathValue, ...handlers);
    const bridgeResponse = function v351WhppUnifiedImportResponseBridge(req, res, next) {
      const originalJson = res.json.bind(res);
      res.json = function v351WhppUnifiedImportJson(body) {
        if (body?.ok) {
          try {
            const outcome = ensureV351WhppNormalizedDaily(body.reportDate || req.body?.reportDate || '');
            body.whppNormalizedBridge = { ok: true, repaired: Boolean(outcome.repaired), reason: outcome.reason, reportDate: outcome.reportDate, total: outcome.total ?? null, patchId: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID };
          } catch (error) {
            console.error('[CE-QC][V351_WHPP_IMPORT_BRIDGE]', error?.stack || error);
            body.whppNormalizedBridge = { ok: false, error: error?.message || String(error), patchId: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID };
          }
        }
        return originalJson(body);
      };
      next();
    };
    return previousPost.call(this, pathValue, bridgeResponse, ...handlers);
  };
  Object.defineProperty(wrappedPost, WRAPPED_POST, { value: true });
  express.application.post = wrappedPost;
}

console.log('[CE-QC][V351_WHPP_UNIFIED_DASHBOARD_BRIDGE]', JSON.stringify({
  id: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID,
  summaryTruth: 'LATEST_VALID_UNIFIED_MEMBERSHIP_THEN_STANDARD_DAILY',
  staleZeroHistory: 'REJECT_IF_TOTAL_MISMATCH',
  futureUnifiedImport: 'MIRROR_WHPP_STANDARD_DAILY_BEFORE_RESPONSE',
  databaseSchemaChange: false
}));
