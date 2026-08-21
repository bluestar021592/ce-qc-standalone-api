import express from 'express';
import { networkInterfaces } from 'node:os';

import { getDb } from './db.js';
import { loadToken, summarizeToken } from './authStore.js';
import { publicUser } from './accessControl.js';
import { getDbStatus } from './store.js';

const PATCH_ID = '2026-08-21-v210-fast-bootstrap-history-window-v1';
const TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const CACHE_TTL_MS = Math.max(5_000, Number(process.env.BOOTSTRAP_LIGHT_CACHE_MS || 30_000));
const NUMERIC_KEYS = Object.freeze([
  'total','pod','pending1','pending2','pending3','pendingNonContinuous',
  'oc1','oc2','oc3','cycle2','delivery1','inboundNoScan','workOrder',
  'shopRetention1','shopRetention2','shopRetention3','provinceOpen','selfPickup',
  'cecnRetention','ceztRetention','retention580','returned','returnInProgress',
  'returnRequired','deliveryStay','transitHubStay','severeOverdue','attempt1','attempt2',
  'attempt3','shopTransit','shopArrived','shopPending','pvDelivery','pvStoreRetention',
  'pvStoreInboundNoScan','pvOtherUnresolved','ccslCnDiversion','ccslZtDiversion',
  'ccsl580Diversion','phnomPenhShop','phnomPenhShopTransit','phnomPenhShopArrived'
]);

let payloadCache = null;
let payloadCacheAt = 0;
let buildPromise = null;

function n(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(value, total) {
  return total ? Math.round((n(value) * 10000) / n(total)) / 100 : 0;
}

function blankMetrics() {
  return Object.fromEntries(NUMERIC_KEYS.map(key => [key, 0]));
}

function addMetrics(rows = []) {
  const out = blankMetrics();
  for (const row of rows) for (const key of NUMERIC_KEYS) out[key] += n(row?.[key]);
  out.podRate = rate(out.pod, out.total);
  out.returnRate = rate(out.returned, out.total);
  out.dispatchAttempt1 = out.attempt1;
  out.dispatchAttempt2 = out.attempt2;
  out.dispatchAttempt3 = out.attempt3;
  out.dispatchAttemptDenominator = out.total;
  out.dispatchAttempt1Rate = rate(out.attempt1, out.total);
  out.dispatchAttempt2Rate = rate(out.attempt2, out.total);
  out.dispatchAttempt3Rate = rate(out.attempt3, out.total);
  out.firstAttemptRate = out.dispatchAttempt1Rate;
  out.unresolved = Math.max(0, out.total - out.pod - out.returned);
  return out;
}

function safeJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function logStage(name, startedAt) {
  const duration = Date.now() - startedAt;
  if (duration >= 100) console.log(`[CE-QC][PERF][V210] bootstrap.${name} ${duration}ms`);
  return duration;
}

function latestImport() {
  return getDb().prepare(`
    SELECT b.batchId,b.snapshotId,b.reportDate,b.sourceName,b.fileHash,b.createdAt,
           COALESCE(s.status,'IMPORTED') AS snapshotStatus
    FROM unified_import_batches b
    LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
    WHERE b.status='VALID'
    ORDER BY b.reportDate DESC,b.createdAt DESC
    LIMIT 1
  `).get() || null;
}

function simpleHistory(limit = 60) {
  const bounded = Math.max(1, Math.min(120, Number(limit) || 60));
  return getDb().prepare(`
    WITH ranked AS (
      SELECT
        b.reportDate,b.snapshotId,b.batchId,b.sourceName,b.fileHash,b.createdAt,
        COALESCE(s.status,'IMPORTED') AS snapshotStatus,
        ROW_NUMBER() OVER (
          PARTITION BY b.reportDate
          ORDER BY b.createdAt DESC,b.batchId DESC
        ) AS rn
      FROM unified_import_batches b
      LEFT JOIN unified_snapshots s ON s.snapshotId=b.snapshotId
      WHERE b.status='VALID'
    )
    SELECT reportDate,snapshotId,batchId,sourceName,fileHash,createdAt,snapshotStatus
    FROM ranked
    WHERE rn=1
    ORDER BY reportDate DESC,createdAt DESC
    LIMIT ?
  `).all(bounded);
}

function importCountRows(snapshotId) {
  if (!snapshotId) return [];
  return getDb().prepare(`
    SELECT businessType,
           CASE WHEN UPPER(COALESCE(regionCode,''))='PP' THEN 'PP'
                WHEN UPPER(COALESCE(regionCode,''))='PV' THEN 'PV'
                ELSE 'UNKNOWN' END AS regionCode,
           COUNT(*) AS total
    FROM unified_import_rows
    WHERE snapshotId=?
    GROUP BY businessType,regionCode
  `).all(snapshotId).map(row => ({ ...blankMetrics(), ...row, total: n(row.total) }));
}

function cachedDailyRows(latest) {
  if (!latest?.reportDate || !latest?.snapshotId) return [];
  try {
    return getDb().prepare(`
      SELECT businessType,regionCode,metricsJson,snapshotId,snapshotStatus
      FROM dashboard_daily_cache
      WHERE reportDate=? AND snapshotId=? AND snapshotStatus='COMPLETED'
      ORDER BY businessType,regionCode
    `).all(latest.reportDate, latest.snapshotId).map(row => ({
      ...blankMetrics(),
      ...safeJson(row.metricsJson),
      businessType: row.businessType,
      regionCode: row.regionCode || '',
      snapshotId: row.snapshotId,
      snapshotStatus: row.snapshotStatus
    }));
  } catch {
    return [];
  }
}

function mergedRows(latest) {
  const imported = importCountRows(latest?.snapshotId || '');
  const cached = cachedDailyRows(latest);
  const cacheTypes = new Set(cached.map(row => row.businessType));
  const fallback = imported.filter(row => !cacheTypes.has(row.businessType));
  return [...cached, ...fallback];
}

function dashboardMetricRow(date, label, value, tab = '') {
  return { 日期: date || '', 项目: label, metricKey: label, 数值: n(value), 数值原值: n(value), 明细Tab: tab, 迷你走势数据: [] };
}

function makeCcslState(label, rows, latest, dbStatus) {
  const metrics = addMetrics(rows);
  const date = latest?.reportDate || '';
  const dashboardRows = [
    dashboardMetricRow(date,'今日PNH',metrics.total,'allData'),
    dashboardMetricRow(date,'今日POD',metrics.pod,'podClosed'),
    dashboardMetricRow(date,'首投POD率',metrics.podRate,'podClosed'),
    dashboardMetricRow(date,'Pending不连续',metrics.pendingNonContinuous,'pendingNonContinuous'),
    dashboardMetricRow(date,'Pending1+',metrics.pending1,'pendingAll'),
    dashboardMetricRow(date,'Pending2+',metrics.pending2,'pending2plus'),
    dashboardMetricRow(date,'Pending3+',metrics.pending3,'pending3'),
    dashboardMetricRow(date,'OC1+',metrics.oc1,'ocAll'),
    dashboardMetricRow(date,'OC2+',metrics.oc2,'oc2plus'),
    dashboardMetricRow(date,'OC3+',metrics.oc3,'oc3'),
    dashboardMetricRow(date,'盘点2天+',metrics.cycle2,'cycle2'),
    dashboardMetricRow(date,'入库无扫描节点',metrics.inboundNoScan,'inboundNoScan'),
    dashboardMetricRow(date,'工单未处理',metrics.workOrder,'workOrderAbnormal'),
    dashboardMetricRow(date,'外省未完结POD件',metrics.provinceOpen,'provinceOpen'),
    dashboardMetricRow(date,'CCSLCN分流',metrics.ccslCnDiversion,'ccslCnDiversion'),
    dashboardMetricRow(date,'CCSLZT分流',metrics.ccslZtDiversion,'ccslZtDiversion'),
    dashboardMetricRow(date,'CCSL580分流',metrics.ccsl580Diversion,'ccsl580Diversion'),
    dashboardMetricRow(date,'金边门店',metrics.phnomPenhShop || (metrics.shopTransit + metrics.shopArrived),'phnomPenhShop')
  ];
  const total = metrics.total;
  return {
    businessType: label === 'CCSL' ? 'CCSL' : label,
    viewBusinessType: label,
    reportDate: date,
    sourceName: latest?.sourceName || '',
    batchId: latest?.batchId || '',
    snapshotId: latest?.snapshotId || '',
    snapshotStatus: latest?.snapshotStatus || 'IMPORTED',
    dailyReportReady: Boolean(date && total),
    pnhBills: [], nonPnhBills: [], excludedBills: [], duplicateBills: [],
    dailyParseRows: [], finalRows: [], scanResults: [], trackResults: [], trackEvents: [],
    carryBills: [], nextCarryBills: [], podLocks: [], needTrackBills: [], historySummary: [],
    dailyParseSummary: { totalRecognized: total, pnh: total },
    processing: { running: false, paused: false, phase: latest?.snapshotStatus === 'COMPLETED' ? '处理完成' : '待处理' },
    dashboard: {
      pnh: total,
      totalMonitored: total,
      todayPod: metrics.pod,
      podRate: metrics.podRate,
      abnormalCount: Math.max(0, total - metrics.pod),
      categories: {
        pendingTotal: metrics.pending1,
        ocTotal: metrics.oc1,
        ccslCnDiversion: metrics.ccslCnDiversion,
        ccslZtDiversion: metrics.ccslZtDiversion,
        ccsl580Diversion: metrics.ccsl580Diversion,
        phnomPenhShop: metrics.phnomPenhShop || (metrics.shopTransit + metrics.shopArrived)
      },
      routing: {
        ccslCnDiversion: metrics.ccslCnDiversion,
        ccslZtDiversion: metrics.ccslZtDiversion,
        ccsl580Diversion: metrics.ccsl580Diversion,
        phnomPenhShop: metrics.phnomPenhShop || (metrics.shopTransit + metrics.shopArrived)
      }
    },
    detailTabs: {
      dashboard: { label: `${label}看板`, rows: dashboardRows, total: dashboardRows.length },
      allData: { label: '全部数据', rows: [], total },
      coreAbnormal: { label: '核心异常', rows: [], total: Math.max(0, total - metrics.pod) }
    },
    dbStatus,
    logs: [],
    _bootstrapCacheSummaryV43: true
  };
}

function shopeeRegion(rows, regionCode) {
  return addMetrics(rows.filter(row => String(row.regionCode || 'UNKNOWN').toUpperCase() === regionCode));
}

function makeShopeeState(label, rows, latest, groupRows = {}, dbStatus = {}) {
  const date = latest?.reportDate || '';
  const all = addMetrics(rows);
  const regions = {
    PP: shopeeRegion(rows, 'PP'),
    PV: shopeeRegion(rows, 'PV'),
    UNKNOWN: shopeeRegion(rows, 'UNKNOWN')
  };
  const groups = {};
  const sourceGroups = label === 'SHOPEE'
    ? { ALL: rows, CN: groupRows.CN || [], VN: groupRows.VN || [] }
    : { ALL: rows, [label === 'SHOPEECN' ? 'CN' : 'VN']: rows };
  for (const [group, source] of Object.entries(sourceGroups)) {
    const gm = addMetrics(source);
    groups[group] = {
      metrics: gm,
      regions: {
        PP: shopeeRegion(source, 'PP'),
        PV: shopeeRegion(source, 'PV'),
        UNKNOWN: shopeeRegion(source, 'UNKNOWN')
      }
    };
  }
  const dashboardRows = [];
  const defs = [
    ['今日总单','total'],['今日POD','pod'],['POD率','podRate'],['首派成功率','firstAttemptRate'],
    ['Pending1+','pending1'],['Pending2+','pending2'],['Pending3+','pending3'],
    ['OC1+','oc1'],['OC2+','oc2'],['OC3+','oc3'],['入库无扫描','inboundNoScan'],
    ['已退回件','returned'],['退回处理中','returnInProgress'],['退回待处理','returnRequired'],
    ['CCSLCN分流','ccslCnDiversion'],['CCSLZT分流','ccslZtDiversion'],['CCSL580分流','ccsl580Diversion'],
    ['金边门店','phnomPenhShop']
  ];
  for (const [group, payload] of Object.entries(groups)) {
    for (const [name, key] of defs) {
      const value = key === 'podRate' ? payload.metrics.podRate
        : key === 'firstAttemptRate' ? payload.metrics.firstAttemptRate
        : key === 'phnomPenhShop' ? (payload.metrics.phnomPenhShop || payload.metrics.shopTransit + payload.metrics.shopArrived)
        : payload.metrics[key];
      dashboardRows.push({ 日期: date, 项目: group === 'ALL' ? name : `${group} ${name}`, metricKey: `${group}_${name}`, 数值: n(value), 数值原值: n(value), 迷你走势数据: [] });
    }
  }
  const total = all.total;
  const dashboard = {
    metrics: all,
    recipientGroups: groups,
    regions,
    dashboardRows,
    detailTabs: { dashboard: { rows: dashboardRows, total: dashboardRows.length } },
    routing: {
      ccslCnDiversion: all.ccslCnDiversion,
      ccslZtDiversion: all.ccslZtDiversion,
      ccsl580Diversion: all.ccsl580Diversion,
      phnomPenhShop: all.phnomPenhShop || (all.shopTransit + all.shopArrived)
    }
  };
  return {
    businessType: 'SHOPEE',
    viewBusinessType: label,
    reportDate: date,
    sourceName: latest?.sourceName || '',
    batchId: latest?.batchId || '',
    snapshotId: latest?.snapshotId || '',
    snapshotStatus: latest?.snapshotStatus || 'IMPORTED',
    dailyReportReady: Boolean(date && total),
    total,
    pnhBills: [], dailyParseRows: [], finalRows: [], scanResults: [], trackResults: [], trackEvents: [],
    carryBills: [], nextCarryBills: [], podLocks: [], historySummary: [],
    dailyParseSummary: { totalRecognized: total, groupCounts: { CN: n(groups.CN?.metrics?.total), VN: n(groups.VN?.metrics?.total) } },
    processing: { running: false, paused: false, phase: latest?.snapshotStatus === 'COMPLETED' ? '处理完成' : '待处理' },
    dashboard,
    detailTabs: {
      dashboard: { label: `${label}看板`, rows: dashboardRows, total: dashboardRows.length },
      all: { label: '全部数据', rows: [], total },
      abnormal: { label: '当前异常', rows: [], total: all.unresolved }
    },
    dbStatus,
    logs: [],
    _bootstrapCacheSummaryV43: true
  };
}

function buildNetworkInfo(req) {
  const port = Number(process.env.PORT || 5177);
  const addresses = [];
  for (const rows of Object.values(networkInterfaces())) {
    for (const item of rows || []) if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
  }
  const publicUrl = String(process.env.PUBLIC_URL || '').trim();
  return {
    lanUrl: addresses[0] ? `http://${addresses[0]}:${port}` : '',
    publicUrl,
    publicConfigured: Boolean(publicUrl),
    currentOrigin: `${req.protocol || 'http'}://${req.get?.('host') || `127.0.0.1:${port}`}`
  };
}

async function buildPayload(req) {
  const startedAt = Date.now();

  let stageAt = Date.now();
  const historyRows = simpleHistory(60);
  let latest = historyRows[0] || null;
  if (!latest) latest = latestImport();
  logStage('historyLatest', stageAt);

  stageAt = Date.now();
  const rows = mergedRows(latest);
  logStage('mergedRows', stageAt);

  stageAt = Date.now();
  const dbStatus = getDbStatus();
  logStage('dbStatus', stageAt);

  stageAt = Date.now();
  const byType = Object.fromEntries(TYPES.map(type => [type, rows.filter(row => row.businessType === type)]));
  const businessStates = {
    CE: makeCcslState('CE', byType.CE, latest, dbStatus),
    CEAF: makeCcslState('CEAF', byType.CEAF, latest, dbStatus),
    TBKH: makeCcslState('TBKH', byType.TBKH, latest, dbStatus),
    ALI1688: makeCcslState('ALI1688', byType.ALI1688, latest, dbStatus),
    SHOPEECN: makeShopeeState('SHOPEECN', byType.SHOPEECN, latest, {}, dbStatus),
    SHOPEEVN: makeShopeeState('SHOPEEVN', byType.SHOPEEVN, latest, {}, dbStatus)
  };

  const ccslRows = rows.filter(row => CCSL_TYPES.has(row.businessType));
  const shopeeRows = rows.filter(row => SHOPEE_TYPES.has(row.businessType));
  const state = makeCcslState('CCSL', ccslRows, latest, dbStatus);
  state.network = buildNetworkInfo(req);
  const shopeeState = makeShopeeState('SHOPEE', shopeeRows, latest, { CN: byType.SHOPEECN, VN: byType.SHOPEEVN }, dbStatus);
  logStage('buildStates', stageAt);

  stageAt = Date.now();
  const token = await loadToken();
  logStage('loadToken', stageAt);

  const classificationCounts = Object.fromEntries(TYPES.map(type => [type, n(addMetrics(byType[type]).total)]));
  const total = Object.values(classificationCounts).reduce((sum, value) => sum + n(value), 0);
  const unifiedImport = latest ? {
    batchId: latest.batchId,
    snapshotId: latest.snapshotId,
    reportDate: latest.reportDate,
    sourceName: latest.sourceName || '',
    fileHash: latest.fileHash || '',
    snapshotStatus: latest.snapshotStatus || 'IMPORTED',
    classificationCounts,
    summary: { validUniqueWaybills: total, totalUnique: total },
    sourceReconciliation: { validUniqueWaybills: total, classifiedWaybills: total, difference: 0, balanced: true },
    carryover: { todayOpen: 0, historicalOpen: 0, currentOpen: 0 }
  } : null;

  const payload = {
    ok: true,
    patchId: PATCH_ID,
    bootstrapMode: 'CACHE_SUMMARY_ONLY',
    state,
    shopeeState,
    authStatus: summarizeToken(token),
    session: { ok: true, user: publicUser(req.user), unreadNotifications: 0 },
    history: { CCSL: historyRows, SHOPEE: historyRows, UNIFIED: historyRows },
    unifiedImport,
    businessStates,
    generatedAt: new Date().toISOString(),
    serverBuildMs: Date.now() - startedAt
  };
  if (payload.serverBuildMs >= 100) console.log(`[CE-QC][PERF][V210] bootstrap.total ${payload.serverBuildMs}ms`);
  return payload;
}

async function fastBootstrap(req, res) {
  const now = Date.now();
  if (payloadCache && now - payloadCacheAt < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'private, max-age=5');
    res.setHeader('X-CE-QC-Bootstrap', 'V210-HIT');
    res.setHeader('Server-Timing', 'bootstrap;dur=0');
    return res.json({ ...payloadCache, cacheHit: true });
  }
  if (!buildPromise) buildPromise = buildPayload(req).finally(() => { buildPromise = null; });
  const payload = await buildPromise;
  payloadCache = payload;
  payloadCacheAt = Date.now();
  res.setHeader('Cache-Control', 'private, max-age=5');
  res.setHeader('X-CE-QC-Bootstrap', 'V210-MISS');
  res.setHeader('Server-Timing', `bootstrap;dur=${n(payload.serverBuildMs)}`);
  return res.json({ ...payload, cacheHit: false });
}

const previousGet = express.application.get;
express.application.get = function v43FastBootstrapRegistration(pathValue, ...handlers) {
  if (pathValue === '/api/bootstrap' && handlers.length) return previousGet.call(this, pathValue, fastBootstrap);
  return previousGet.call(this, pathValue, ...handlers);
};

export const V43_BOOTSTRAP_PERF_PATCH_ID = PATCH_ID;
