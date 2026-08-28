import express from 'express';
import { getDb } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';

export const V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID = '2026-08-28-v351-whpp-unified-membership-dashboard-bridge-v3';
const SUMMARY_ROUTE = '/api/v71/whpp-summary';
const DETAIL_ROUTES = ['/api/v172/whpp-metric-detail', '/api/whpp/metric-detail'];
const UNIFIED_IMPORT_ROUTE = '/api/import/unified-daily-report';
const WRAPPED_POST = Symbol.for('ce-qc.v351-whpp-unified-import-post');
let readRoutesInstalled = false;

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
function regionOf(row = {}) {
  const value = String(row.regionCode || row.区域 || '').trim().toUpperCase();
  return value === 'PP' ? 'PP' : value === 'PV' ? 'PV' : 'UNKNOWN';
}
function normalizeTab(value = 'all') {
  const raw = String(value || 'all').trim();
  const aliases = {
    podRate: 'pod', returnRate: 'returned', cancelRate: 'cancelled',
    '签收率': 'pod', '签收件数': 'pod', '今日POD': 'pod', 'POD率': 'pod',
    '已退回件': 'returned', '当前未闭环': 'unresolved', '订单取消': 'cancelled',
    'Pending不连续': 'pendingNonContinuous', 'Pending1+': 'pending1', 'Pending2+': 'pending2', 'Pending3+': 'pending3',
    'OC1+': 'oc1', 'OC2+': 'oc2', 'OC3+': 'oc3', '盘点2天+': 'cycle2', '入库无扫描': 'inboundNoScan',
    '派送中': 'delivery', '工单': 'workOrder', 'CCSLCN': 'ccslCnDiversion', 'CEZT': 'ccslZtDiversion',
    'CCSL580': 'ccsl580Retention', '金边门店': 'phnomPenhShop', '外省门店': 'provinceShop'
  };
  return aliases[raw] || raw || 'all';
}

function latestUnifiedDate(db) {
  return String(db.prepare(`SELECT MAX(reportDate) reportDate FROM unified_import_batches WHERE status='VALID'`).get()?.reportDate || '');
}

function historyTotal(reportDate, db) {
  const row = db.prepare(`SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(reportDate);
  const summary = safeJson(row?.summaryJson, {});
  for (const key of ['total', 'today', 'todayTotal', 'pnh', 'todayPnh']) {
    const value = Number(summary?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function loadPreservedWhppMembership(reportDate, db) {
  const standardRows = uniqueRows(db.prepare(`SELECT shipmentCode,rowJson FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row => ({
      ...safeJson(row.rowJson, {}),
      shipmentCode: row.shipmentCode,
      运单号: row.shipmentCode,
      businessType: 'WHPP',
      reportDate
    })));
  if (standardRows.length) {
    return { rows: standardRows, source: 'WHPP_STANDARD_DAILY_ROWS', historyTotal: historyTotal(reportDate, db) };
  }

  // A previous bad zero-member bridge could have deleted only the normalized
  // WHPP daily membership while leaving final facts/history untouched. Recover
  // membership only when the preserved final-row count exactly matches the old
  // completed history total; never infer membership from a partial fact set.
  const expected = historyTotal(reportDate, db);
  if (!expected) return { rows: [], source: '', historyTotal: 0 };

  const scanRows = db.prepare(`SELECT shipmentCode,rawJson FROM business_scan_results
    WHERE businessType='WHPP' AND reportDate=?`).all(reportDate);
  const scanByBill = new Map(scanRows.map(row => [String(row.shipmentCode || '').trim().toUpperCase(), safeJson(row.rawJson, {})]));
  const factRows = uniqueRows(db.prepare(`SELECT shipmentCode,rawJson FROM business_final_rows
    WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row => {
      const raw = safeJson(row.rawJson, {});
      const bill = String(row.shipmentCode || '').trim().toUpperCase();
      const scan = scanByBill.get(bill) || {};
      const region = String(raw.regionCode || raw.区域 || scan.regionCode || scan.region_code || scan.区域 || '').trim().toUpperCase();
      return {
        ...scan,
        ...raw,
        shipmentCode: bill,
        运单号: bill,
        businessType: 'WHPP',
        reportDate,
        regionCode: region === 'PP' || region === 'PV' ? region : ''
      };
    }));
  if (factRows.length !== expected) return { rows: [], source: '', historyTotal: expected };
  return { rows: factRows, source: 'WHPP_FINAL_FACTS_MATCH_HISTORY_TOTAL', historyTotal: expected };
}

export function loadV351UnifiedWhppMembership(reportDate = '', db = getDb()) {
  const date = dateOnly(reportDate) || dateOnly(latestUnifiedDate(db));
  if (!date) return { present: false, batchPresent: false, reportDate: '', batchId: '', snapshotId: '', sourceName: '', membershipSource: 'EMPTY', rows: [], bills: [] };
  const batch = db.prepare(`SELECT batchId,snapshotId,reportDate,sourceName FROM unified_import_batches
    WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC LIMIT 1`).get(date);
  if (!batch) return { present: false, batchPresent: false, reportDate: date, batchId: '', snapshotId: '', sourceName: '', membershipSource: 'NO_VALID_UNIFIED_BATCH', rows: [], bills: [] };
  const rows = uniqueRows(db.prepare(`SELECT shipmentCode,regionCode,rowJson FROM unified_import_rows
    WHERE batchId=? AND businessType='WHPP' ORDER BY shipmentCode`).all(batch.batchId).map(row => {
      const raw = safeJson(row.rowJson, {});
      return {
        ...raw,
        shipmentCode: String(row.shipmentCode || '').trim().toUpperCase(),
        运单号: String(row.shipmentCode || '').trim().toUpperCase(),
        businessType: 'WHPP',
        reportDate: date,
        regionCode: row.regionCode || raw.regionCode || ''
      };
    }));
  if (rows.length) {
    return {
      present: true,
      batchPresent: true,
      reportDate: date,
      batchId: String(batch.batchId || ''),
      snapshotId: String(batch.snapshotId || ''),
      sourceName: String(batch.sourceName || ''),
      membershipSource: 'LATEST_VALID_UNIFIED_MEMBERSHIP',
      recoveredFromPreservedWhpp: false,
      rows,
      bills: rows.map(billOf)
    };
  }

  // Important: a VALID unified batch with zero WHPP rows is not evidence that
  // WHPP had zero shipments. WHPP is a dedicated business stage. Never let an
  // empty unified partition erase an existing WHPP daily membership.
  const preserved = loadPreservedWhppMembership(date, db);
  return {
    present: preserved.rows.length > 0,
    batchPresent: true,
    reportDate: date,
    batchId: String(batch.batchId || ''),
    snapshotId: String(batch.snapshotId || ''),
    sourceName: String(batch.sourceName || ''),
    membershipSource: preserved.source || 'UNIFIED_WHPP_EMPTY_KEEP_STANDARD',
    recoveredFromPreservedWhpp: Boolean(preserved.rows.length),
    historyTotal: preserved.historyTotal || 0,
    rows: preserved.rows,
    bills: preserved.rows.map(billOf)
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
    FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row => {
      const raw = safeJson(row.rawJson, {});
      return {
        ...raw,
        shipmentCode: row.shipmentCode,
        运单号: row.shipmentCode,
        businessType: 'WHPP',
        reportDate,
        isPod: Number(row.isPod || 0),
        primaryCategory: row.primaryCategory || raw.primaryCategory || '',
        apiStatus: row.apiStatus || '',
        carryStatus: row.carryStatus || '',
        latestEventTime: row.latestEventTime || raw.latestEventTime || '',
        latestEventDesc: row.latestEventDesc || raw.latestEventDesc || '',
        latestNode: row.latestNode || raw.latestNode || ''
      };
    }));
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
    truthSource: unified.present ? unified.membershipSource || 'LATEST_VALID_UNIFIED_MEMBERSHIP' : 'WHPP_STANDARD_DAILY',
    unifiedMembership: unified.present ? unified.bills.length : null,
    standardMembership: standard.present ? Number(standard.daily?.totalCount || standard.bills.length || 0) : null,
    standardRows: standard.bills.length,
    finalEvidenceRows: finalRows.length,
    staleHistoryRejected: staleHistory,
    needsNormalizedRepair: unified.present && (!standard.present || Number(standard.daily?.totalCount || 0) !== unified.bills.length || standard.bills.length !== unified.bills.length),
    patchId: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID
  };
}

export function ensureV351WhppNormalizedDaily(reportDate = '') {
  const db = getDb();
  const unified = loadV351UnifiedWhppMembership(reportDate, db);
  if (!unified.present) return { repaired: false, reason: unified.batchPresent ? 'UNIFIED_WHPP_EMPTY_KEEP_STANDARD' : 'NO_VALID_UNIFIED_BATCH', reportDate: unified.reportDate || dateOnly(reportDate) };
  const standard = loadStandardWhppMembership(unified.reportDate, db);
  const standardCount = standard.present ? Number(standard.daily?.totalCount || 0) : -1;
  const sameMembers = standard.present && standardCount === unified.bills.length && standard.bills.length === unified.bills.length && (() => {
    const set = new Set(standard.bills); return unified.bills.every(code => set.has(code));
  })();
  if (sameMembers) return { repaired: false, reason: 'STANDARD_DAILY_CURRENT', reportDate: unified.reportDate, total: unified.bills.length };

  // Membership-only repair: never rewrite current state, carryover, final facts,
  // scan/track evidence, run locks, or snapshots. Existing completed truth stays intact.
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt)
      VALUES('WHPP',?,?,?,?,?,?)
      ON CONFLICT(businessType,reportDate) DO UPDATE SET sourceFile=excluded.sourceFile,totalCount=excluded.totalCount,summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`)
      .run(unified.reportDate, unified.sourceName, unified.bills.length, JSON.stringify({ batchId: unified.batchId, snapshotId: unified.snapshotId, total: unified.bills.length, source: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID, membershipSource: unified.membershipSource || '' }), now, now);
    db.prepare(`DELETE FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?`).run(unified.reportDate);
    const insert = db.prepare(`INSERT INTO business_daily_parse_rows(
      businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt
    ) VALUES('WHPP',?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of unified.rows) {
      insert.run(
        unified.reportDate,
        billOf(row),
        row.sheetName || '',
        Number(row.rowNumber || 0),
        Number(row.source_row_number || row.rowNumber || 0),
        row.recipientRaw || row.recipient_raw || '',
        row.recipientNormalized || row.recipient_normalized || '',
        'WHPP',
        row.classificationReason || unified.membershipSource || 'LATEST_VALID_UNIFIED_MEMBERSHIP',
        '',
        JSON.stringify({ ...row, businessType: 'WHPP', reportDate: unified.reportDate }),
        now
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  console.log('[CE-QC][V351_WHPP_BRIDGE_REPAIRED]', JSON.stringify({ reportDate: unified.reportDate, total: unified.bills.length, batchId: unified.batchId, membershipSource: unified.membershipSource || '', scope: 'MEMBERSHIP_TABLES_ONLY' }));
  return { repaired: true, reason: unified.recoveredFromPreservedWhpp ? 'RESTORED_PRESERVED_WHPP_MEMBERSHIP_ONLY' : 'UNIFIED_TO_WHPP_STANDARD_DAILY_MEMBERSHIP_ONLY', reportDate: unified.reportDate, total: unified.bills.length };
}

function scheduleNormalizedRepair(summary) {
  if (!summary?.needsNormalizedRepair || !summary?.reportDate) return;
  setImmediate(() => {
    try { ensureV351WhppNormalizedDaily(summary.reportDate); }
    catch (error) { console.error('[CE-QC][V351_WHPP_BACKGROUND_MEMBERSHIP_REPAIR]', error?.stack || error); }
  });
}

function summaryHandler(req, res, next) {
  try {
    const summary = summaryForDate(req.query?.reportDate || '');
    if (!summary) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...summary });
    scheduleNormalizedRepair(summary);
  } catch (error) {
    console.error('[CE-QC][V351_WHPP_SUMMARY]', error?.stack || error);
    next();
  }
}

function detailHandler(req, res, next) {
  try {
    const summary = summaryForDate(req.query?.reportDate || req.query?.date || '');
    if (!summary) return next();
    const tab = normalizeTab(req.query?.tab || req.query?.metric || 'all');
    const detail = summary.dashboard?.detailTabs?.[tab] || summary.dashboard?.detailTabs?.all || { label: tab, rows: [], total: 0 };
    const region = String(req.query?.region || '').trim().toUpperCase();
    let rows = Array.isArray(detail.rows) ? detail.rows : [];
    if (region === 'PP' || region === 'PV') rows = rows.filter(row => regionOf(row) === region);
    const page = Math.max(1, Number(req.query?.page || 1));
    const pageSize = Math.max(1, Math.min(1000, Number(req.query?.pageSize || 300)));
    const start = (page - 1) * pageSize;
    const regionLabel = region === 'PP' ? '本省PP' : region === 'PV' ? '外省PV' : '';
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      patchId: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID,
      businessType: 'WHPP',
      reportDate: summary.reportDate,
      tab,
      region,
      label: `${regionLabel}${regionLabel ? ' · ' : ''}${detail.label || tab}`,
      total: rows.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      truthSource: summary.truthSource,
      rows: rows.slice(start, start + pageSize)
    });
    scheduleNormalizedRepair(summary);
  } catch (error) {
    console.error('[CE-QC][V351_WHPP_DETAIL]', error?.stack || error);
    next();
  }
}

const previousListen = express.application.listen;
express.application.listen = function v351WhppUnifiedDashboardBridgeListen(...args) {
  if (!readRoutesInstalled) {
    readRoutesInstalled = true;
    this.get(SUMMARY_ROUTE, summaryHandler);
    for (const route of DETAIL_ROUTES) this.get(route, detailHandler);
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
  summaryTruth: 'NONEMPTY_VALID_UNIFIED_MEMBERSHIP_THEN_PRESERVED_WHPP_STANDARD_OR_VERIFIED_FACTS',
  detailTruth: 'SAME_CANONICAL_DASHBOARD_DETAIL_TABS',
  staleZeroHistory: 'REJECT_IF_TOTAL_MISMATCH',
  existingDateRepair: 'ASYNC_MEMBERSHIP_TABLES_ONLY_AFTER_RESPONSE',
  futureUnifiedImport: 'ZERO_WHPP_PARTITION_NEVER_ERASES_STANDARD_DAILY',
  databaseSchemaChange: false,
  factMutation: false
}));