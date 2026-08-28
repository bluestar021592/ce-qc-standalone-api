import express from 'express';
import { getDb } from './db.js';
import { buildWhppDashboard } from './whppReporting.js';
import { loadV351UnifiedWhppMembership } from './v351WhppUnifiedDashboardBridgePatch.js';

export const V352_WHPP_VISIBLE_TRUTH_OWNER_ID = '2026-08-28-v352-whpp-visible-single-truth-owner-v2';
const SUMMARY_ROUTES = new Set(['/api/v132/whpp-fast-summary', '/api/v71/whpp-summary']);
const DETAIL_ROUTES = new Set(['/api/v172/whpp-metric-detail', '/api/whpp/metric-detail']);
const originalListen = express.application.listen;
let installed = false;

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

function normalizeSqlFinalFact(row = {}) {
  const normalized = { ...row };
  const sqlPod = Number(row.isPod || 0) === 1;
  if (sqlPod) {
    // business_final_rows.isPod is persisted terminal evidence. Older rawJson can
    // legitimately omit UI aliases, so restore those aliases in memory only.
    normalized.isPod = 1;
    normalized.是否POD = '是';
    normalized.POD状态 = 'POD';
    normalized.currentState = 'POD';
    if (!String(normalized.primaryCategory || '').trim()) normalized.primaryCategory = 'POD';
  }
  return normalized;
}

function loadStandardMembership(db, reportDate) {
  const daily = db.prepare(`SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(reportDate);
  if (!daily) return { present: false, rows: [] };
  const rows = db.prepare(`SELECT shipmentCode,rowJson FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row => ({
    ...safeJson(row.rowJson, {}), shipmentCode: row.shipmentCode, 运单号: row.shipmentCode, businessType: 'WHPP', reportDate
  }));
  return { present: true, rows: uniqueRows(rows), totalCount: Number(daily.totalCount || 0) };
}

function latestDate(db) {
  const unified = String(db.prepare(`SELECT MAX(reportDate) reportDate FROM unified_import_batches WHERE status='VALID'`).get()?.reportDate || '');
  if (dateOnly(unified)) return dateOnly(unified);
  return dateOnly(db.prepare(`SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP' ORDER BY reportDate DESC LIMIT 1`).get()?.reportDate || '');
}

function loadFacts(db, reportDate) {
  return uniqueRows(db.prepare(`SELECT shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,rawJson
    FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? ORDER BY shipmentCode`).all(reportDate).map(row => {
    const raw = safeJson(row.rawJson, {});
    return normalizeSqlFinalFact({
      ...raw,
      shipmentCode: row.shipmentCode,
      运单号: row.shipmentCode,
      businessType: 'WHPP',
      reportDate,
      isPod: Number(row.isPod || 0),
      primaryCategory: row.primaryCategory || raw.primaryCategory || raw.主分类 || '',
      apiStatus: row.apiStatus || raw.apiStatus || '',
      carryStatus: row.carryStatus || raw.carryStatus || '',
      latestEventTime: row.latestEventTime || raw.latestEventTime || raw.最后节点时间 || '',
      latestEventDesc: row.latestEventDesc || raw.latestEventDesc || raw.最后节点 || '',
      latestNode: row.latestNode || raw.latestNode || ''
    });
  }));
}

export function buildV352WhppVisibleDashboard({ reportDate = '', membershipRows = [], finalRows = [] } = {}) {
  const members = uniqueRows(membershipRows);
  const memberSet = new Set(members.map(billOf));
  const facts = uniqueRows(finalRows.map(normalizeSqlFinalFact)).filter(row => memberSet.has(billOf(row)));
  const dashboard = buildWhppDashboard({
    businessType: 'WHPP',
    reportDate: dateOnly(reportDate),
    dailyReportReady: true,
    pnhBills: members.map(billOf),
    dailyParseRows: members,
    finalRows: facts
  });
  assertVisibleConsistency(dashboard);
  return dashboard;
}

export function assertV352WhppVisibleConsistency(dashboard = {}) {
  const metrics = dashboard.metrics || {};
  const regions = dashboard.regions || {};
  const values = ['total', 'pod', 'returned', 'cancelled', 'unresolved', 'pending1', 'pending2', 'pending3', 'oc1', 'oc2', 'oc3'];
  const mismatches = [];
  for (const key of values) {
    const top = Number(metrics[key] || 0);
    const regional = ['PP', 'PV', 'UNKNOWN'].reduce((sum, code) => sum + Number(regions?.[code]?.[key] || 0), 0);
    if (top !== regional) mismatches.push({ key, top, regional });
  }
  if (mismatches.length) {
    const error = new Error(`WHPP可见看板真值不一致：${mismatches.map(item => `${item.key}=${item.top}/${item.regional}`).join(', ')}`);
    error.code = 'WHPP_VISIBLE_TRUTH_MISMATCH';
    error.mismatches = mismatches;
    throw error;
  }
  return true;
}

function buildCanonical(reportDate = '') {
  const startedAt = Date.now();
  const db = getDb();
  const requested = dateOnly(reportDate);
  const date = requested || latestDate(db);
  if (!date) {
    const dashboard = buildV352WhppVisibleDashboard({ reportDate: '', membershipRows: [], finalRows: [] });
    return { reportDate: '', dashboard, membershipSource: 'EMPTY', finalEvidenceRows: 0, completed: false, buildMs: Date.now() - startedAt };
  }
  const unified = loadV351UnifiedWhppMembership(date, db);
  const standard = loadStandardMembership(db, date);
  const membershipRows = unified.present ? unified.rows : standard.rows;
  if (!unified.present && !standard.present) {
    const dashboard = buildV352WhppVisibleDashboard({ reportDate: date, membershipRows: [], finalRows: [] });
    return { reportDate: date, dashboard, membershipSource: 'EMPTY', finalEvidenceRows: 0, completed: false, buildMs: Date.now() - startedAt };
  }
  const rawFinalRows = loadFacts(db, date);
  const memberSet = new Set(uniqueRows(membershipRows).map(billOf));
  const finalRows = rawFinalRows.filter(row => memberSet.has(billOf(row)));
  const dashboard = buildV352WhppVisibleDashboard({ reportDate: date, membershipRows, finalRows });
  const history = db.prepare(`SELECT 1 ok FROM business_history_summary WHERE businessType='WHPP' AND reportDate=? LIMIT 1`).get(date);
  const completed = membershipRows.length === 0 ? Boolean(history) : finalRows.length >= uniqueRows(membershipRows).length;
  return {
    reportDate: date,
    dashboard,
    membershipSource: unified.present ? 'LATEST_VALID_UNIFIED_MEMBERSHIP' : 'WHPP_STANDARD_DAILY',
    finalEvidenceRows: finalRows.length,
    completed,
    buildMs: Date.now() - startedAt
  };
}

function summaryPayload(reportDate = '') {
  const canonical = buildCanonical(reportDate);
  const metrics = { ...canonical.dashboard.metrics, retryPending: 0 };
  const regions = canonical.dashboard.regions;
  const snapshotStatus = canonical.completed ? 'COMPLETED' : (metrics.total > 0 ? 'PENDING' : 'EMPTY');
  const slimDashboard = {
    businessType: 'WHPP',
    reportDate: canonical.reportDate,
    metrics,
    regions,
    accounting: canonical.dashboard.accounting
  };
  return {
    ok: true,
    patchId: V352_WHPP_VISIBLE_TRUTH_OWNER_ID,
    reportDate: canonical.reportDate,
    total: Number(metrics.total || 0),
    completed: canonical.completed,
    snapshotStatus,
    metrics,
    regions,
    state: { reportDate: canonical.reportDate, dailyReportReady: true, snapshotStatus },
    dashboard: slimDashboard,
    truthSource: canonical.membershipSource,
    finalEvidenceRows: canonical.finalEvidenceRows,
    serverBuildMs: canonical.buildMs,
    generatedAt: new Date().toISOString()
  };
}

function summaryHandler(req, res) {
  const payload = summaryPayload(req.query?.reportDate || req.query?.date || '');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-CE-QC-WHPP-Summary', 'V352');
  res.json(payload);
}

function detailHandler(req, res) {
  const canonical = buildCanonical(req.query?.reportDate || req.query?.date || '');
  const dashboard = canonical.dashboard;
  const tab = normalizeTab(req.query?.tab || req.query?.metric || 'all');
  const detail = dashboard.detailTabs?.[tab] || dashboard.detailTabs?.all || { label: tab, rows: [], total: 0 };
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
    patchId: V352_WHPP_VISIBLE_TRUTH_OWNER_ID,
    businessType: 'WHPP',
    reportDate: canonical.reportDate,
    tab,
    region,
    label: `${regionLabel}${regionLabel ? ' · ' : ''}${detail.label || tab}`,
    total: rows.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
    truthSource: canonical.membershipSource,
    rows: rows.slice(start, start + pageSize)
  });
}

express.application.listen = function v352WhppVisibleTruthOwnerListen(...args) {
  if (!installed) {
    installed = true;
    for (const route of SUMMARY_ROUTES) this.get(route, summaryHandler);
    for (const route of DETAIL_ROUTES) this.get(route, detailHandler);
  }
  return originalListen.apply(this, args);
};

console.log('[CE-QC][V352_WHPP_VISIBLE_TRUTH_OWNER]', JSON.stringify({
  id: V352_WHPP_VISIBLE_TRUTH_OWNER_ID,
  summaryRoutes: [...SUMMARY_ROUTES],
  detailRoutes: [...DETAIL_ROUTES],
  membershipTruth: 'LATEST_VALID_UNIFIED_THEN_STANDARD_DAILY',
  finalTruth: 'CURRENT_MEMBERS_ONLY_BUSINESS_FINAL_ROWS_WITH_SQL_ISPOD_IN_MEMORY_NORMALIZATION',
  invariant: 'TOP_EQUALS_PP_PLUS_PV_PLUS_UNKNOWN',
  summaryPayload: 'METRICS_REGIONS_ACCOUNTING_ONLY_DETAILS_LAZY',
  databaseWrites: false,
  databaseSchemaChange: false
}));
