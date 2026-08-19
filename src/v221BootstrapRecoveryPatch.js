import express from 'express';
import { networkInterfaces } from 'node:os';

import { getDb } from './db.js';
import { loadToken, summarizeToken } from './authStore.js';
import { publicUser } from './accessControl.js';
import { getDbStatus } from './store.js';

export const V221_BOOTSTRAP_RECOVERY_VERSION = '2026-08-19-v221-persisted-bootstrap-recovery-v1';

const TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);
const CCSL_TYPES = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const NUMERIC_KEYS = Object.freeze([
  'total', 'pod', 'pending1', 'pending2', 'pending3', 'pendingNonContinuous',
  'oc1', 'oc2', 'oc3', 'cycle2', 'delivery1', 'inboundNoScan', 'workOrder',
  'shopRetention1', 'shopRetention2', 'shopRetention3', 'provinceOpen', 'selfPickup',
  'cecnRetention', 'ceztRetention', 'retention580', 'returned', 'returnInProgress',
  'returnRequired', 'deliveryStay', 'transitHubStay', 'severeOverdue', 'attempt1', 'attempt2',
  'attempt3', 'attemptUnknown', 'cancelled', 'delivering', 'pending', 'shopTransit', 'shopArrived',
  'shopPending', 'pvDelivery', 'pvStoreRetention', 'pvStoreInboundNoScan', 'pvOtherUnresolved',
  'ccslCnDiversion', 'ccslZtDiversion', 'ccsl580Diversion', 'phnomPenhShop',
  'phnomPenhShopTransit', 'phnomPenhShopArrived'
]);

const previousGet = express.application.get;
let fallbackCache = null;
let fallbackCacheAt = 0;
const FALLBACK_CACHE_MS = 15_000;

function n(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function rate(value, total) {
  return total ? Number((n(value) * 100 / n(total)).toFixed(2)) : 0;
}
function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')) || fallback; } catch { return fallback; }
}
function blankMetrics() {
  return Object.fromEntries(NUMERIC_KEYS.map(key => [key, 0]));
}
function normalizeMetrics(value = {}) {
  const source = safeJson(value, {});
  const out = blankMetrics();
  for (const key of NUMERIC_KEYS) out[key] = n(source[key]);
  out.attempt1 = n(source.attempt1 || source.dispatchAttempt1 || source.firstAttemptCount);
  out.attempt2 = n(source.attempt2 || source.dispatchAttempt2);
  out.attempt3 = n(source.attempt3 || source.dispatchAttempt3);
  out.attemptUnknown = n(source.attemptUnknown || source.dispatchAttemptUnclassifiedPod);
  out.pending = n(source.pending || source.pending1);
  out.delivering = n(source.delivering || source.delivery1 || source.deliveryStay);
  out.cancelled = n(source.cancelled);
  return out;
}
function addMetrics(rows = []) {
  const out = blankMetrics();
  for (const row of rows) {
    const metrics = normalizeMetrics(row);
    for (const key of NUMERIC_KEYS) out[key] += n(metrics[key]);
  }
  out.podRate = rate(out.pod, out.total);
  out.returnRate = rate(out.returned, out.total);
  out.dispatchAttempt1 = out.attempt1;
  out.dispatchAttempt2 = out.attempt2;
  out.dispatchAttempt3 = out.attempt3;
  out.dispatchAttemptUnclassifiedPod = out.attemptUnknown;
  out.dispatchAttemptDenominator = out.total;
  out.dispatchAttempt1Rate = rate(out.attempt1, out.pod || out.total);
  out.dispatchAttempt2Rate = rate(out.attempt2, out.pod || out.total);
  out.dispatchAttempt3Rate = rate(out.attempt3, out.pod || out.total);
  out.firstAttemptCount = out.attempt1;
  out.firstAttemptRate = rate(out.attempt1, out.total);
  out.unresolved = Math.max(0, out.total - out.pod - out.returned - out.cancelled);
  return out;
}
function tableExists(name) {
  try { return Boolean(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)); }
  catch { return false; }
}
function canonicalStatus() {
  try {
    const row = getDb().prepare(`
      SELECT b.snapshotId,b.reportDate,b.batchId,b.sourceName,b.fileHash,b.createdAt,
             COALESCE(s.status,'IMPORTED') AS snapshotStatus,
             (SELECT COUNT(*) FROM unified_import_rows u WHERE u.snapshotId=b.snapshotId) AS rowCount
      FROM unified_import_batches b
      LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.status='VALID'
      ORDER BY b.reportDate DESC,b.createdAt DESC
      LIMIT 1
    `).get() || null;
    return row ? { ...row, rowCount: n(row.rowCount), ready: n(row.rowCount) > 0 } : { ready: false, rowCount: 0 };
  } catch {
    return { ready: false, rowCount: 0 };
  }
}
function cacheLatest() {
  if (!tableExists('dashboard_daily_cache')) return null;
  try {
    const row = getDb().prepare(`
      SELECT reportDate,MAX(snapshotId) AS snapshotId,MAX(snapshotStatus) AS snapshotStatus,MAX(refreshedAt) AS refreshedAt
      FROM dashboard_daily_cache
      WHERE reportDate<>''
      GROUP BY reportDate
      HAVING COUNT(*)>0
      ORDER BY reportDate DESC
      LIMIT 1
    `).get() || null;
    if (!row?.reportDate) return null;
    const total = getDb().prepare(`SELECT COALESCE(SUM(CAST(json_extract(metricsJson,'$.total') AS REAL)),0) AS total FROM dashboard_daily_cache WHERE reportDate=?`).get(row.reportDate);
    return n(total?.total) > 0 ? { ...row, total: n(total.total), source: 'DASHBOARD_DAILY_CACHE' } : null;
  } catch { return null; }
}
function cacheRows(reportDate) {
  if (!reportDate || !tableExists('dashboard_daily_cache')) return [];
  try {
    return getDb().prepare(`SELECT businessType,regionCode,metricsJson FROM dashboard_daily_cache WHERE reportDate=? ORDER BY businessType,regionCode`).all(reportDate).map(row => ({
      ...normalizeMetrics(row.metricsJson),
      businessType: String(row.businessType || '').toUpperCase(),
      regionCode: String(row.regionCode || '').toUpperCase()
    }));
  } catch { return []; }
}
function cacheHistory(limit = 60) {
  if (!tableExists('dashboard_daily_cache')) return [];
  try {
    return getDb().prepare(`
      SELECT reportDate,MAX(snapshotId) AS snapshotId,MAX(snapshotStatus) AS snapshotStatus,MAX(refreshedAt) AS createdAt
      FROM dashboard_daily_cache
      WHERE reportDate<>''
      GROUP BY reportDate
      ORDER BY reportDate DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(120, Number(limit || 60)))).map(row => ({ ...row, batchId: `CACHE_${row.reportDate}` }));
  } catch { return []; }
}
function latestLegacyDate() {
  const candidates = [];
  const probes = [
    ['daily_reports', 'SELECT MAX(reportDate) AS reportDate FROM daily_reports'],
    ['business_daily_reports', 'SELECT MAX(reportDate) AS reportDate FROM business_daily_reports'],
    ['final_rows', 'SELECT MAX(reportDate) AS reportDate FROM final_rows'],
    ['business_final_rows', 'SELECT MAX(reportDate) AS reportDate FROM business_final_rows']
  ];
  for (const [table, sql] of probes) {
    if (!tableExists(table)) continue;
    try { const date = String(getDb().prepare(sql).get()?.reportDate || ''); if (date) candidates.push(date); } catch {}
  }
  return candidates.sort().at(-1) || '';
}
function legacyReportTotal(type, reportDate) {
  if (!reportDate) return 0;
  if (tableExists('business_daily_reports')) {
    try {
      const exact = getDb().prepare('SELECT totalCount FROM business_daily_reports WHERE UPPER(businessType)=? AND reportDate=? ORDER BY updatedAt DESC LIMIT 1').get(type, reportDate);
      if (n(exact?.totalCount) > 0) return n(exact.totalCount);
    } catch {}
  }
  if (SHOPEE_TYPES.has(type) && tableExists('business_daily_parse_rows')) {
    try {
      const group = type === 'SHOPEECN' ? 'CN' : 'VN';
      const row = getDb().prepare("SELECT COUNT(DISTINCT shipmentCode) AS total FROM business_daily_parse_rows WHERE reportDate=? AND UPPER(COALESCE(businessType,''))='SHOPEE' AND UPPER(COALESCE(recipient_group,''))=?").get(reportDate, group);
      if (n(row?.total) > 0) return n(row.total);
    } catch {}
  }
  if (CCSL_TYPES.has(type) && tableExists('final_rows')) {
    try {
      const row = getDb().prepare("SELECT COUNT(DISTINCT shipmentCode) AS total FROM final_rows WHERE reportDate=? AND UPPER(COALESCE(sourceType,''))=?").get(reportDate, type);
      if (n(row?.total) > 0) return n(row.total);
    } catch {}
  }
  if (SHOPEE_TYPES.has(type) && tableExists('business_final_rows')) {
    try {
      const group = type === 'SHOPEECN' ? 'CN' : 'VN';
      const row = getDb().prepare("SELECT COUNT(DISTINCT shipmentCode) AS total FROM business_final_rows WHERE reportDate=? AND (UPPER(COALESCE(businessType,''))=? OR (UPPER(COALESCE(businessType,''))='SHOPEE' AND UPPER(COALESCE(recipient_group,''))=?))").get(reportDate, type, group);
      if (n(row?.total) > 0) return n(row.total);
    } catch {}
  }
  return 0;
}
function legacyCcslMetrics(type, reportDate) {
  const out = blankMetrics();
  out.total = legacyReportTotal(type, reportDate);
  if (!tableExists('final_rows')) return out;
  try {
    const row = getDb().prepare(`
      SELECT COUNT(DISTINCT shipmentCode) AS finalTotal,
        SUM(CASE WHEN COALESCE(isPod,0)=1 THEN 1 ELSE 0 END) AS pod,
        SUM(CASE WHEN UPPER(COALESCE(primaryCategory,category,'')) LIKE '%RETURN%' OR COALESCE(primaryCategory,category,'') LIKE '%退回%' THEN 1 ELSE 0 END) AS returned,
        SUM(CASE WHEN UPPER(COALESCE(primaryCategory,category,'')) LIKE '%PENDING%' THEN 1 ELSE 0 END) AS pending1,
        SUM(CASE WHEN UPPER(COALESCE(primaryCategory,category,'')) LIKE '%OC%' THEN 1 ELSE 0 END) AS oc1,
        SUM(CASE WHEN COALESCE(cycleCountDays,0)>=2 THEN 1 ELSE 0 END) AS cycle2,
        SUM(CASE WHEN COALESCE(primaryCategory,category,'') LIKE '%工单%' THEN 1 ELSE 0 END) AS workOrder,
        SUM(CASE WHEN COALESCE(primaryCategory,category,'') LIKE '%入库无扫描%' THEN 1 ELSE 0 END) AS inboundNoScan
      FROM final_rows
      WHERE reportDate=? AND UPPER(COALESCE(sourceType,''))=?
    `).get(reportDate, type) || {};
    Object.assign(out, {
      total: Math.max(out.total, n(row.finalTotal)), pod: n(row.pod), returned: n(row.returned),
      pending1: n(row.pending1), oc1: n(row.oc1), cycle2: n(row.cycle2),
      workOrder: n(row.workOrder), inboundNoScan: n(row.inboundNoScan)
    });
  } catch {}
  return out;
}
function legacyShopeeMetrics(type, reportDate) {
  const out = blankMetrics();
  out.total = legacyReportTotal(type, reportDate);
  if (!tableExists('business_final_rows')) return out;
  const group = type === 'SHOPEECN' ? 'CN' : 'VN';
  try {
    const row = getDb().prepare(`
      SELECT COUNT(DISTINCT shipmentCode) AS finalTotal,
        SUM(CASE WHEN COALESCE(isPod,0)=1 THEN 1 ELSE 0 END) AS pod,
        SUM(CASE WHEN UPPER(COALESCE(primaryCategory,'')) LIKE '%RETURN%' OR COALESCE(primaryCategory,'') LIKE '%退回%' THEN 1 ELSE 0 END) AS returned,
        SUM(CASE WHEN UPPER(COALESCE(primaryCategory,'')) LIKE '%CANCEL%' OR COALESCE(primaryCategory,'') LIKE '%取消%' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN UPPER(COALESCE(primaryCategory,'')) LIKE '%PENDING%' THEN 1 ELSE 0 END) AS pending1,
        SUM(CASE WHEN UPPER(COALESCE(primaryCategory,'')) LIKE '%OC%' THEN 1 ELSE 0 END) AS oc1,
        SUM(CASE WHEN COALESCE(primaryCategory,'') LIKE '%入库无扫描%' THEN 1 ELSE 0 END) AS inboundNoScan
      FROM business_final_rows
      WHERE reportDate=? AND (UPPER(COALESCE(businessType,''))=? OR (UPPER(COALESCE(businessType,''))='SHOPEE' AND UPPER(COALESCE(recipient_group,''))=?))
    `).get(reportDate, type, group) || {};
    Object.assign(out, {
      total: Math.max(out.total, n(row.finalTotal)), pod: n(row.pod), returned: n(row.returned),
      cancelled: n(row.cancelled), pending1: n(row.pending1), oc1: n(row.oc1), inboundNoScan: n(row.inboundNoScan)
    });
  } catch {}
  return out;
}
function legacyRows(reportDate) {
  return TYPES.map(type => ({
    ...(SHOPEE_TYPES.has(type) ? legacyShopeeMetrics(type, reportDate) : legacyCcslMetrics(type, reportDate)),
    businessType: type,
    regionCode: 'UNKNOWN'
  })).filter(row => n(row.total) > 0);
}
function legacyHistory(limit = 60) {
  const dates = new Set();
  for (const [table, sql] of [
    ['daily_reports', 'SELECT reportDate FROM daily_reports ORDER BY reportDate DESC LIMIT ?'],
    ['business_daily_reports', 'SELECT DISTINCT reportDate FROM business_daily_reports ORDER BY reportDate DESC LIMIT ?']
  ]) {
    if (!tableExists(table)) continue;
    try { for (const row of getDb().prepare(sql).all(limit)) if (row.reportDate) dates.add(row.reportDate); } catch {}
  }
  return [...dates].sort().reverse().slice(0, limit).map(reportDate => ({ reportDate, snapshotId: `LEGACY_${reportDate}`, batchId: `LEGACY_${reportDate}`, snapshotStatus: 'PERSISTED', createdAt: '' }));
}
function sourceArchiveSummary() {
  if (!tableExists('v209_import_source_archive')) return { acceptedFiles: 0, archivedDates: 0, latestArchivedDate: '' };
  try {
    const row = getDb().prepare("SELECT COUNT(*) AS acceptedFiles,COUNT(DISTINCT reportDate) AS archivedDates,COALESCE(MAX(reportDate),'') AS latestArchivedDate FROM v209_import_source_archive WHERE status='ACCEPTED'").get() || {};
    return { acceptedFiles: n(row.acceptedFiles), archivedDates: n(row.archivedDates), latestArchivedDate: row.latestArchivedDate || '' };
  } catch { return { acceptedFiles: 0, archivedDates: 0, latestArchivedDate: '' }; }
}
function dashboardRow(date, label, value) {
  return { 日期: date || '', 项目: label, metricKey: label, 数值: n(value), 数值原值: n(value), 迷你走势数据: [] };
}
function makeCcslState(label, rows, meta) {
  const m = addMetrics(rows);
  const date = meta?.reportDate || '';
  const dashboardRows = [
    dashboardRow(date, '今日PNH', m.total), dashboardRow(date, '今日POD', m.pod), dashboardRow(date, 'POD率', m.podRate),
    dashboardRow(date, 'Pending不连续', m.pendingNonContinuous), dashboardRow(date, 'Pending1+', m.pending1), dashboardRow(date, 'Pending2+', m.pending2), dashboardRow(date, 'Pending3+', m.pending3),
    dashboardRow(date, 'OC1+', m.oc1), dashboardRow(date, 'OC2+', m.oc2), dashboardRow(date, 'OC3+', m.oc3), dashboardRow(date, '盘点2天+', m.cycle2),
    dashboardRow(date, '入库无扫描节点', m.inboundNoScan), dashboardRow(date, '工单未处理', m.workOrder), dashboardRow(date, '外省未完结POD件', m.provinceOpen)
  ];
  return {
    businessType: label === 'CCSL' ? 'CCSL' : label,
    viewBusinessType: label,
    reportDate: date,
    sourceName: meta?.sourceName || '',
    snapshotId: meta?.snapshotId || '',
    snapshotStatus: meta?.snapshotStatus || 'PERSISTED',
    dailyReportReady: Boolean(date && m.total),
    pnhBills: [], nonPnhBills: [], excludedBills: [], duplicateBills: [], dailyParseRows: [], finalRows: [], scanResults: [], trackResults: [], trackEvents: [], carryBills: [], nextCarryBills: [], podLocks: [], needTrackBills: [], historySummary: [],
    dailyParseSummary: { totalRecognized: m.total, pnh: m.total },
    processing: { running: false, paused: false, phase: '' },
    dashboard: { pnh: m.total, totalMonitored: m.total, todayPod: m.pod, podRate: m.podRate, abnormalCount: m.unresolved, metrics: m, categories: { pendingTotal: m.pending1, ocTotal: m.oc1 }, routing: {} },
    detailTabs: { dashboard: { label: `${label}看板`, rows: dashboardRows, total: dashboardRows.length }, allData: { label: '全部数据', rows: [], total: m.total }, coreAbnormal: { label: '遗留异常', rows: [], total: m.unresolved } },
    dbStatus: getDbStatus(), logs: [], _v221RecoveredSummary: true
  };
}
function shopeeRegion(rows, regionCode) {
  return addMetrics(rows.filter(row => String(row.regionCode || 'UNKNOWN').toUpperCase() === regionCode));
}
function makeShopeeState(label, rows, meta, groupsInput = {}) {
  const all = addMetrics(rows);
  const date = meta?.reportDate || '';
  const sources = label === 'SHOPEE' ? { ALL: rows, CN: groupsInput.CN || [], VN: groupsInput.VN || [] } : { ALL: rows, [label === 'SHOPEECN' ? 'CN' : 'VN']: rows };
  const groups = {};
  for (const [name, source] of Object.entries(sources)) groups[name] = { metrics: addMetrics(source), regions: { PP: shopeeRegion(source, 'PP'), PV: shopeeRegion(source, 'PV'), UNKNOWN: shopeeRegion(source, 'UNKNOWN') } };
  const dashboardRows = [
    dashboardRow(date, '今日总单', all.total), dashboardRow(date, '今日POD', all.pod), dashboardRow(date, 'POD率', all.podRate),
    dashboardRow(date, '首派成功率', all.firstAttemptRate), dashboardRow(date, '1派签收件数', all.attempt1), dashboardRow(date, '2派签收件数', all.attempt2), dashboardRow(date, '3派签收件数', all.attempt3),
    dashboardRow(date, 'Pending1+', all.pending1), dashboardRow(date, 'Pending2+', all.pending2), dashboardRow(date, 'Pending3+', all.pending3), dashboardRow(date, '已退回件', all.returned)
  ];
  return {
    businessType: 'SHOPEE', viewBusinessType: label, reportDate: date, sourceName: meta?.sourceName || '', snapshotId: meta?.snapshotId || '', snapshotStatus: meta?.snapshotStatus || 'PERSISTED',
    dailyReportReady: Boolean(date && all.total), total: all.total, pnhBills: [], dailyParseRows: [], finalRows: [], scanResults: [], trackResults: [], trackEvents: [], carryBills: [], nextCarryBills: [], podLocks: [], historySummary: [],
    dailyParseSummary: { totalRecognized: all.total, groupCounts: { CN: n(groups.CN?.metrics?.total), VN: n(groups.VN?.metrics?.total) } }, processing: { running: false, paused: false, phase: '' },
    dashboard: { metrics: all, recipientGroups: groups, regions: { PP: shopeeRegion(rows, 'PP'), PV: shopeeRegion(rows, 'PV'), UNKNOWN: shopeeRegion(rows, 'UNKNOWN') }, dashboardRows, detailTabs: { dashboard: { rows: dashboardRows, total: dashboardRows.length } } },
    detailTabs: { dashboard: { label: `${label}看板`, rows: dashboardRows, total: dashboardRows.length }, all: { label: '全部数据', rows: [], total: all.total }, abnormal: { label: '当前异常', rows: [], total: all.unresolved } },
    dbStatus: getDbStatus(), logs: [], _v221RecoveredSummary: true
  };
}
function makeWhppState() {
  if (!tableExists('business_final_rows')) return null;
  try {
    const date = String(getDb().prepare("SELECT MAX(reportDate) AS reportDate FROM business_final_rows WHERE UPPER(COALESCE(businessType,''))='WHPP'").get()?.reportDate || '');
    if (!date) return null;
    const row = getDb().prepare(`SELECT COUNT(DISTINCT shipmentCode) AS total,SUM(CASE WHEN COALESCE(isPod,0)=1 THEN 1 ELSE 0 END) AS pod,SUM(CASE WHEN UPPER(COALESCE(primaryCategory,'')) LIKE '%RETURN%' OR COALESCE(primaryCategory,'') LIKE '%退回%' THEN 1 ELSE 0 END) AS returned,SUM(CASE WHEN UPPER(COALESCE(primaryCategory,'')) LIKE '%CANCEL%' OR COALESCE(primaryCategory,'') LIKE '%取消%' THEN 1 ELSE 0 END) AS cancelled FROM business_final_rows WHERE UPPER(COALESCE(businessType,''))='WHPP' AND reportDate=?`).get(date) || {};
    const metrics = { ...blankMetrics(), total: n(row.total), pod: n(row.pod), returned: n(row.returned), cancelled: n(row.cancelled) };
    const state = makeCcslState('WHPP', [{ ...metrics, businessType: 'WHPP', regionCode: 'UNKNOWN' }], { reportDate: date, snapshotId: `WHPP_${date}`, snapshotStatus: 'PERSISTED', sourceName: 'WHPP历史底账' });
    state.dashboard.podRate = rate(metrics.pod, metrics.total);
    state.dashboard.metrics = addMetrics([{ ...metrics, businessType: 'WHPP' }]);
    return state;
  } catch { return null; }
}
function buildNetworkInfo(req) {
  const port = Number(process.env.PORT || 5177);
  const addresses = [];
  for (const list of Object.values(networkInterfaces())) for (const item of list || []) if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
  const publicUrl = String(process.env.PUBLIC_URL || '').trim();
  return { lanUrl: addresses[0] ? `http://${addresses[0]}:${port}` : '', publicUrl, publicConfigured: Boolean(publicUrl), currentOrigin: `${req.protocol || 'http'}://${req.get?.('host') || `127.0.0.1:${port}`}` };
}
function buildFallbackCore() {
  const now = Date.now();
  if (fallbackCache && now - fallbackCacheAt < FALLBACK_CACHE_MS) return fallbackCache;
  const cache = cacheLatest();
  const legacyDate = cache ? '' : latestLegacyDate();
  const meta = cache ? { reportDate: cache.reportDate, snapshotId: cache.snapshotId || `CACHE_${cache.reportDate}`, snapshotStatus: cache.snapshotStatus || 'COMPLETED', sourceName: '历史看板缓存' } : legacyDate ? { reportDate: legacyDate, snapshotId: `LEGACY_${legacyDate}`, snapshotStatus: 'PERSISTED', sourceName: '历史持久化底账' } : { reportDate: '', snapshotId: '', snapshotStatus: 'EMPTY', sourceName: '' };
  const rows = cache ? cacheRows(cache.reportDate) : legacyDate ? legacyRows(legacyDate) : [];
  const byType = Object.fromEntries(TYPES.map(type => [type, rows.filter(row => row.businessType === type)]));
  const businessStates = {
    CE: makeCcslState('CE', byType.CE, meta), CEAF: makeCcslState('CEAF', byType.CEAF, meta), TBKH: makeCcslState('TBKH', byType.TBKH, meta), ALI1688: makeCcslState('ALI1688', byType.ALI1688, meta),
    SHOPEECN: makeShopeeState('SHOPEECN', byType.SHOPEECN, meta), SHOPEEVN: makeShopeeState('SHOPEEVN', byType.SHOPEEVN, meta)
  };
  const whpp = makeWhppState();
  if (whpp) businessStates.WHPP = whpp;
  const ccslRows = rows.filter(row => CCSL_TYPES.has(row.businessType));
  const shopeeRows = rows.filter(row => SHOPEE_TYPES.has(row.businessType));
  const state = makeCcslState('CCSL', ccslRows, meta);
  const shopeeState = makeShopeeState('SHOPEE', shopeeRows, meta, { CN: byType.SHOPEECN, VN: byType.SHOPEEVN });
  const history = cache ? cacheHistory(60) : legacyHistory(60);
  const classificationCounts = Object.fromEntries(TYPES.map(type => [type, n(addMetrics(byType[type]).total)]));
  if (whpp) classificationCounts.WHPP = n(whpp.dashboard?.metrics?.total || whpp.dashboard?.totalMonitored);
  const total = Object.values(classificationCounts).reduce((sum, value) => sum + n(value), 0);
  const archive = sourceArchiveSummary();
  fallbackCache = {
    state, shopeeState, businessStates,
    history: { CCSL: history, SHOPEE: history, UNIFIED: history },
    unifiedImport: meta.reportDate ? { batchId: meta.snapshotId, snapshotId: meta.snapshotId, reportDate: meta.reportDate, sourceName: meta.sourceName, snapshotStatus: meta.snapshotStatus, classificationCounts, summary: { validUniqueWaybills: total, totalUnique: total }, sourceReconciliation: { validUniqueWaybills: total, classifiedWaybills: total, difference: 0, balanced: true }, carryover: { todayOpen: 0, historicalOpen: 0, currentOpen: 0 }, recoveredFromPersistedSummary: true } : null,
    recoveryStatus: { source: cache ? 'DASHBOARD_DAILY_CACHE' : legacyDate ? 'LEGACY_PERSISTED_TABLES' : 'EMPTY_WORKING_LEDGER', canonicalReady: false, archive, noReuploadRequiredWhenArchiveAvailable: archive.acceptedFiles > 0 },
    generatedAt: new Date().toISOString()
  };
  fallbackCacheAt = now;
  return fallbackCache;
}
async function fallbackBootstrap(req, res) {
  try {
    const core = buildFallbackCore();
    const token = await loadToken();
    const state = { ...core.state, network: buildNetworkInfo(req) };
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-CE-QC-Bootstrap', 'V221-PERSISTED-FALLBACK');
    return res.json({ ok: true, patchId: V221_BOOTSTRAP_RECOVERY_VERSION, bootstrapMode: 'PERSISTED_RECOVERY_SUMMARY', ...core, state, authStatus: summarizeToken(token), session: { ok: true, user: publicUser(req.user), unreadNotifications: 0 } });
  } catch (error) {
    console.error('[CE-QC][V221_BOOTSTRAP_FALLBACK_FAILED]', error?.stack || error);
    return res.status(500).json({ ok: false, code: 'V221_BOOTSTRAP_FALLBACK_FAILED', error: error?.message || String(error) });
  }
}
function wrapNativeBootstrap(nativeHandler) {
  return async function v221RecoveryAwareBootstrap(req, res, next) {
    try {
      const status = canonicalStatus();
      if (status.ready) {
        res.setHeader('X-CE-QC-Bootstrap-Source', 'CANONICAL_UNIFIED_LEDGER');
        const result = nativeHandler.call(this, req, res, next);
        if (result && typeof result.then === 'function') await result;
        return result;
      }
      return fallbackBootstrap(req, res);
    } catch (error) {
      console.error('[CE-QC][V221_NATIVE_BOOTSTRAP_DEGRADED]', error?.stack || error);
      return fallbackBootstrap(req, res);
    }
  };
}

express.application.get = function v221BootstrapRecoveryRegistration(pathValue, ...handlers) {
  if (pathValue === '/api/bootstrap' && handlers.length) {
    const nativeHandler = handlers.at(-1);
    // Register through Route#get directly so the older V43 Application#get shim
    // cannot replace this recovery-aware handler a second time.
    return this.route(pathValue).get(wrapNativeBootstrap(nativeHandler));
  }
  return previousGet.call(this, pathValue, ...handlers);
};

console.log('[CE-QC][V221] recovery-aware bootstrap armed: canonical ledger first, persisted dashboard cache/legacy summary fallback; session is request-scoped.');