import express from 'express';
import { getDb } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';

export const V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID = '2026-08-29-v351-whpp-safe-history-disaster-fallback-v4';
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
function latestKnownDate(db) {
  for (const sql of [
    "SELECT MAX(reportDate) reportDate FROM unified_import_batches WHERE status='VALID'",
    "SELECT MAX(reportDate) reportDate FROM business_daily_reports WHERE businessType='WHPP'",
    "SELECT MAX(reportDate) reportDate FROM business_history_summary WHERE businessType='WHPP'"
  ]) {
    try {
      const value = dateOnly(db.prepare(sql).get()?.reportDate || '');
      if (value) return value;
    } catch {}
  }
  return '';
}
function historyTotal(reportDate, db) {
  try {
    const row = db.prepare(`SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(reportDate);
    const summary = safeJson(row?.summaryJson, {});
    for (const key of ['total', 'today', 'todayTotal', 'pnh', 'todayPnh']) {
      const value = Number(summary?.[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  } catch {}
  return 0;
}
function loadPreservedWhppMembership(reportDate, db) {
  // A normalized daily header is authoritative only when its declared total and
  // distinct member rows match exactly. Never turn a partial 235/236 cohort into
  // a new canonical 235-member day. Exact zero is a valid standard daily truth,
  // but it is represented as an empty fallback cohort because primary readers
  // own current exact-zero publication.
  const standard = loadStandardWhppMembership(reportDate, db);
  if (standard.daily && standard.present && standard.rows.length) {
    return {
      rows: standard.rows,
      source: 'WHPP_STANDARD_DAILY_ROWS',
      historyTotal: historyTotal(reportDate, db),
      expected: standard.expected,
      actual: standard.actual
    };
  }
  if (standard.daily && standard.present && standard.expected === 0) {
    return { rows: [], source: 'WHPP_STANDARD_DAILY_ZERO', historyTotal: historyTotal(reportDate, db), expected: 0, actual: 0 };
  }
  if (standard.daily && !standard.present) {
    return {
      rows: [],
      source: 'WHPP_STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED',
      historyTotal: historyTotal(reportDate, db),
      expected: standard.expected,
      actual: standard.actual
    };
  }

  // Never infer a full daily membership from a partial fact set. Recovery from
  // final facts is allowed only when there is no standard daily header and the
  // unique fact count exactly equals the previously completed WHPP history total.
  const expected = historyTotal(reportDate, db);
  if (!expected) return { rows: [], source: '', historyTotal: 0 };
  let scanRows = [];
  try { scanRows = db.prepare(`SELECT shipmentCode,rawJson FROM business_scan_results WHERE businessType='WHPP' AND reportDate=?`).all(reportDate); } catch {}
  const scanByBill = new Map(scanRows.map(row => [String(row.shipmentCode || '').trim().toUpperCase(), safeJson(row.rawJson, {})]));
  let factRows = [];
  try {
    factRows = uniqueRows(db.prepare(`SELECT shipmentCode,rawJson FROM business_final_rows
      WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row => {
        const raw = safeJson(row.rawJson, {});
        const code = String(row.shipmentCode || '').trim().toUpperCase();
        const scan = scanByBill.get(code) || {};
        const region = String(raw.regionCode || raw.区域 || scan.regionCode || scan.region_code || scan.区域 || '').trim().toUpperCase();
        return { ...scan, ...raw, shipmentCode: code, 运单号: code, businessType: 'WHPP', reportDate, regionCode: region === 'PP' || region === 'PV' ? region : '' };
      }));
  } catch {}
  if (factRows.length !== expected) return { rows: [], source: '', historyTotal: expected };
  return { rows: factRows, source: 'WHPP_FINAL_FACTS_MATCH_HISTORY_TOTAL', historyTotal: expected };
}

export function loadV351UnifiedWhppMembership(reportDate = '', db = getDb()) {
  const date = dateOnly(reportDate) || latestKnownDate(db);
  if (!date) return { present: false, batchPresent: false, reportDate: '', batchId: '', snapshotId: '', sourceName: '', membershipSource: 'EMPTY', rows: [], bills: [] };
  let batch = null;
  try {
    batch = db.prepare(`SELECT batchId,snapshotId,reportDate,sourceName FROM unified_import_batches
      WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1`).get(date);
  } catch {}

  // A missing VALID unified batch is not evidence that WHPP had zero shipments.
  // Older imported dates may only retain the dedicated WHPP normalized rows, or
  // an exact completed-history/final-fact cohort. Use those preserved sources.
  if (!batch) {
    const preserved = loadPreservedWhppMembership(date, db);
    return {
      present: preserved.rows.length > 0,
      batchPresent: false,
      reportDate: date,
      batchId: '', snapshotId: '', sourceName: '',
      membershipSource: preserved.source || 'NO_VALID_UNIFIED_BATCH',
      recoveredFromPreservedWhpp: Boolean(preserved.rows.length),
      historyTotal: preserved.historyTotal || 0,
      expected: preserved.expected,
      actual: preserved.actual,
      rows: preserved.rows,
      bills: preserved.rows.map(billOf)
    };
  }

  let rows = [];
  try {
    rows = uniqueRows(db.prepare(`SELECT shipmentCode,regionCode,rowJson FROM unified_import_rows
      WHERE batchId=? AND businessType='WHPP' ORDER BY shipmentCode`).all(batch.batchId).map(row => {
        const raw = safeJson(row.rowJson, {});
        return {
          ...raw,
          shipmentCode: String(row.shipmentCode || '').trim().toUpperCase(),
          运单号: String(row.shipmentCode || '').trim().toUpperCase(),
          businessType: 'WHPP', reportDate: date,
          regionCode: row.regionCode || raw.regionCode || ''
        };
      }));
  } catch {}
  if (rows.length) {
    return {
      present: true, batchPresent: true, reportDate: date,
      batchId: String(batch.batchId || ''), snapshotId: String(batch.snapshotId || ''), sourceName: String(batch.sourceName || ''),
      membershipSource: 'LATEST_VALID_UNIFIED_MEMBERSHIP', recoveredFromPreservedWhpp: false,
      rows, bills: rows.map(billOf)
    };
  }

  // Likewise, a VALID sibling import with zero WHPP rows must not erase WHPP.
  const preserved = loadPreservedWhppMembership(date, db);
  return {
    present: preserved.rows.length > 0,
    batchPresent: true,
    reportDate: date,
    batchId: String(batch.batchId || ''), snapshotId: String(batch.snapshotId || ''), sourceName: String(batch.sourceName || ''),
    membershipSource: preserved.source || 'UNIFIED_WHPP_EMPTY_KEEP_STANDARD',
    recoveredFromPreservedWhpp: Boolean(preserved.rows.length),
    historyTotal: preserved.historyTotal || 0,
    expected: preserved.expected,
    actual: preserved.actual,
    rows: preserved.rows,
    bills: preserved.rows.map(billOf)
  };
}

function loadStandardWhppMembership(reportDate, db) {
  let daily = null;
  try { daily = db.prepare(`SELECT reportDate,sourceFile,totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(reportDate); } catch {}
  if (!daily) return { present: false, daily: null, rows: [], bills: [], expected: null, actual: 0, source: 'MISSING' };
  let rows = [];
  try {
    rows = uniqueRows(db.prepare(`SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row => ({
      ...safeJson(row.rowJson, {}), shipmentCode: row.shipmentCode, 运单号: row.shipmentCode, businessType: 'WHPP', reportDate
    })));
  } catch {}
  const expected = Number(daily.totalCount || 0);
  const actual = rows.length;
  const present = expected === actual;
  return {
    present,
    daily,
    rows: present ? rows : [],
    bills: present ? rows.map(billOf) : [],
    expected,
    actual,
    source: present ? (expected === 0 ? 'WHPP_STANDARD_DAILY_ZERO' : 'WHPP_STANDARD_DAILY') : 'WHPP_STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED'
  };
}
function loadWhppFinalRows(reportDate, db) {
  let rows = [];
  try { rows = db.prepare(`SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate); } catch {}
  return uniqueRows(rows.map(row => {
    const raw = safeJson(row.rawJson, {});
    const normalized = {
      ...raw, shipmentCode: row.shipmentCode, 运单号: row.shipmentCode, businessType: 'WHPP', reportDate,
      isPod: Number(row.isPod || 0), primaryCategory: row.primaryCategory || raw.primaryCategory || '', apiStatus: row.apiStatus || '', carryStatus: row.carryStatus || '',
      latestEventTime: row.latestEventTime || raw.latestEventTime || '', latestEventDesc: row.latestEventDesc || raw.latestEventDesc || '', latestNode: row.latestNode || raw.latestNode || ''
    };
    if (normalized.isPod === 1) {
      normalized.是否POD = '是';
      normalized.POD状态 = 'POD';
      normalized.currentState = 'POD';
      if (!String(normalized.primaryCategory || '').trim()) normalized.primaryCategory = 'POD';
    }
    return normalized;
  }));
}

export function buildV351WhppDashboard({ reportDate = '', membershipRows = [], finalRows = [] } = {}) {
  const members = uniqueRows(membershipRows);
  return buildWhppDashboard({ businessType: 'WHPP', reportDate: dateOnly(reportDate), dailyReportReady: true, pnhBills: members.map(billOf), dailyParseRows: members, finalRows: uniqueRows(finalRows) });
}
function summaryForDate(reportDate = '') {
  const db = getDb();
  const requested = dateOnly(reportDate);
  const canonical = loadV351UnifiedWhppMembership(requested, db);
  const date = requested || canonical.reportDate;
  if (!date) return null;
  const standard = loadStandardWhppMembership(date, db);
  const membershipRows = canonical.present ? canonical.rows : standard.rows;
  if (!canonical.present && !standard.present) return null;
  const finalRows = loadWhppFinalRows(date, db);
  const dashboard = buildV351WhppDashboard({ reportDate: date, membershipRows, finalRows });
  let history = null;
  try { history = db.prepare(`SELECT summaryJson FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(date); } catch {}
  const historySummary = safeJson(history?.summaryJson, {});
  const staleHistory = Boolean(history && Number(historySummary.total ?? -1) !== Number(dashboard.metrics.total || 0));
  return {
    reportDate: date,
    total: Number(dashboard.metrics.total || 0), metrics: dashboard.metrics, regions: dashboard.regions,
    regionPvUnresolved: Number(dashboard.regions?.PV?.unresolved || 0),
    activeStoreRetention: Number((dashboard.detailTabs?.phnomPenhShop?.rows || []).filter(row => Number(row.shopRetentionNaturalDays || 0) >= 2).length + (dashboard.detailTabs?.provinceShop?.rows || []).filter(row => Number(row.shopRetentionNaturalDays || 0) >= 2).length),
    selfPickup: Number((dashboard.detailTabs?.normalDiversion?.rows || []).filter(row => String(row.specialState || row.primaryCategory || row.主分类 || '').toUpperCase() === 'SELF_PICKUP').length),
    completed: Boolean(history) && !staleHistory,
    state: { reportDate: date, dailyReportReady: true, snapshotStatus: history && !staleHistory ? 'COMPLETED' : 'RECONCILED_FROM_PRESERVED_WHPP' },
    dashboard,
    truthSource: canonical.present ? canonical.membershipSource || 'PRESERVED_WHPP_MEMBERSHIP' : standard.source,
    unifiedMembership: canonical.present ? canonical.bills.length : null,
    standardMembership: standard.present ? Number(standard.daily?.totalCount ?? standard.bills.length ?? 0) : null,
    standardRows: standard.bills.length, finalEvidenceRows: finalRows.length, staleHistoryRejected: staleHistory,
    needsNormalizedRepair: canonical.present && !standard.present && !standard.daily,
    patchId: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID
  };
}

export function ensureV351WhppNormalizedDaily(reportDate = '') {
  const db = getDb();
  const canonical = loadV351UnifiedWhppMembership(reportDate, db);
  const date = canonical.reportDate || dateOnly(reportDate);
  const standard = date ? loadStandardWhppMembership(date, db) : { present: false, daily: null, rows: [], bills: [], source: 'MISSING' };
  if (standard.daily && !standard.present) {
    return {
      repaired: false,
      reason: 'STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED',
      reportDate: date,
      expected: standard.expected,
      actual: standard.actual
    };
  }
  if (standard.present) {
    return {
      repaired: false,
      reason: standard.expected === 0 ? 'STANDARD_DAILY_CURRENT_ZERO' : 'STANDARD_DAILY_CURRENT',
      reportDate: date,
      total: standard.actual
    };
  }
  if (!canonical.present) return { repaired: false, reason: canonical.batchPresent ? 'UNIFIED_WHPP_EMPTY_KEEP_STANDARD' : 'NO_SAFE_PRESERVED_WHPP_MEMBERSHIP', reportDate: date };

  // Membership-only repair is allowed only when the normalized daily header is
  // genuinely absent and a safe V351 disaster source exists. Never rewrite an
  // incomplete/conflicting standard cohort to a smaller count.
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt)
      VALUES('WHPP',?,?,?,?,?,?)
      ON CONFLICT(businessType,reportDate) DO UPDATE SET sourceFile=excluded.sourceFile,totalCount=excluded.totalCount,summaryJson=excluded.summaryJson,updatedAt=excluded.updatedAt`)
      .run(canonical.reportDate, canonical.sourceName, canonical.bills.length, JSON.stringify({ batchId: canonical.batchId, snapshotId: canonical.snapshotId, total: canonical.bills.length, source: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID, membershipSource: canonical.membershipSource || '' }), now, now);
    db.prepare(`DELETE FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?`).run(canonical.reportDate);
    const insert = db.prepare(`INSERT INTO business_daily_parse_rows(
      businessType,reportDate,shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,rawText,rowJson,createdAt
    ) VALUES('WHPP',?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of canonical.rows) {
      insert.run(
        canonical.reportDate, billOf(row), row.sheetName || '', Number(row.rowNumber || 0), Number(row.source_row_number || row.rowNumber || 0),
        row.recipientRaw || row.recipient_raw || '', row.recipientNormalized || row.recipient_normalized || '', 'WHPP',
        row.classificationReason || canonical.membershipSource || 'PRESERVED_WHPP_MEMBERSHIP', '',
        JSON.stringify({ ...row, businessType: 'WHPP', reportDate: canonical.reportDate }), now
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  console.log('[CE-QC][V351_WHPP_BRIDGE_REPAIRED]', JSON.stringify({ reportDate: canonical.reportDate, total: canonical.bills.length, batchId: canonical.batchId, membershipSource: canonical.membershipSource || '', scope: 'MISSING_MEMBERSHIP_TABLES_ONLY' }));
  return { repaired: true, reason: canonical.recoveredFromPreservedWhpp ? 'RESTORED_PRESERVED_WHPP_MEMBERSHIP_ONLY' : 'UNIFIED_TO_WHPP_STANDARD_DAILY_MEMBERSHIP_ONLY', reportDate: canonical.reportDate, total: canonical.bills.length };
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
      ok: true, patchId: V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID, businessType: 'WHPP', reportDate: summary.reportDate, tab, region,
      label: `${regionLabel}${regionLabel ? ' · ' : ''}${detail.label || tab}`,
      total: rows.length, page, pageSize, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)), truthSource: summary.truthSource,
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
  summaryTruth: 'EXACT_STANDARD_DAILY_OR_SAFE_HISTORY_DISASTER_RECOVERY_WHEN_STANDARD_HEADER_MISSING',
  detailTruth: 'SAME_CANONICAL_DASHBOARD_DETAIL_TABS',
  staleZeroHistory: 'REJECT_IF_TOTAL_MISMATCH',
  incompleteStandard: 'FAIL_CLOSED_NEVER_REWRITE_TO_SMALLER_COUNT',
  existingDateRepair: 'MISSING_MEMBERSHIP_TABLES_ONLY_AFTER_RESPONSE',
  futureUnifiedImport: 'ZERO_OR_MISSING_UNIFIED_WHPP_NEVER_ERASES_PRESERVED_DAILY_TRUTH',
  databaseSchemaChange: false,
  factMutation: false
}));