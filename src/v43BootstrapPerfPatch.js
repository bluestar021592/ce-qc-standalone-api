import express from 'express';
import { networkInterfaces } from 'node:os';

import { loadLightweightUnifiedBusinessState } from './lightweightDashboardStore.js';
import { summarizeLightweightCcslState, summarizeLightweightShopeeState } from './lightweightDashboardSummary.js';
import { listUnifiedImportHistory, getLatestUnifiedImport } from './unifiedImportStore.js';
import { listSnapshotHistory } from './snapshots.js';
import { SHOPEE, listBusinessHistoryDates } from './businessStore.js';
import { loadToken, summarizeToken } from './authStore.js';
import { publicUser } from './accessControl.js';
import { getDbStatus } from './store.js';
import { getShopCodeSummary } from './shopCodes.js';

const PATCH_ID = '2026-08-10-v43-fast-bootstrap-v1';
const TYPES = Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']);
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const CACHE_TTL_MS = Math.max(5_000, Number(process.env.BOOTSTRAP_LIGHT_CACHE_MS || 30_000));
let payloadCache = null;
let payloadCacheAt = 0;
let buildPromise = null;

function codeOf(value) {
  if (typeof value === 'string') return value.trim().toUpperCase();
  return String(value?.shipmentCode || value?.运单号 || value?.waybill || '').trim().toUpperCase();
}

function uniqueCodes(values = []) {
  return [...new Set((values || []).map(codeOf).filter(Boolean))];
}

function mergeRawStates(states = [], scope = 'CCSL') {
  const active = states.filter(state => state?.snapshotId || state?.reportDate);
  const reference = active[0] || states[0] || {};
  const flat = key => states.flatMap(state => Array.isArray(state?.[key]) ? state[key] : []);
  const pnhBills = uniqueCodes(flat('pnhBills'));
  const carryBills = uniqueCodes(flat('carryBills'));
  const nextCarryBills = uniqueCodes(flat('nextCarryBills'));
  const podLocks = uniqueCodes(flat('podLocks'));
  const needTrackBills = uniqueCodes(flat('needTrackBills'));
  const scanPool = uniqueCodes(flat('scanPool'));
  return {
    businessType: scope,
    reportDate: reference.reportDate || '',
    sourceName: reference.sourceName || '',
    batchId: reference.batchId || '',
    snapshotId: reference.snapshotId || '',
    snapshotStatus: active.length && active.every(state => state.snapshotStatus === 'COMPLETED') ? 'COMPLETED' : (reference.snapshotStatus || 'IMPORTED'),
    dailyReportReady: Boolean(reference.reportDate && pnhBills.length),
    pnhBills,
    nonPnhBills: [],
    excludedBills: [],
    duplicateBills: [],
    dailyParseRows: flat('dailyParseRows'),
    dailyParseSummary: {
      totalRecognized: pnhBills.length,
      pnh: pnhBills.length,
      groupCounts: {
        CN: states.find(state => state.businessType === 'SHOPEECN')?.pnhBills?.length || 0,
        VN: states.find(state => state.businessType === 'SHOPEEVN')?.pnhBills?.length || 0
      }
    },
    finalRows: flat('finalRows'),
    scanResults: flat('scanResults'),
    scanPool,
    needTrackBills,
    trackResults: flat('trackResults'),
    trackEvents: [],
    carryBills,
    nextCarryBills,
    podLocks,
    historySummary: [],
    currentRun: reference.currentRun || null,
    lastRunSummary: reference.lastRunSummary || null,
    processing: reference.processing || { running: false, paused: false, phase: '' },
    logs: [],
    _normalizedSqliteRead: true,
    _bootstrapLightweightV43: true
  };
}

function compactTabs(tabs = {}) {
  return Object.fromEntries(Object.entries(tabs || {}).map(([key, value]) => [key, {
    ...(value || {}),
    rows: [],
    total: Number(value?.total ?? value?.rows?.length ?? 0)
  }]));
}

function compactSummary(summary = {}, viewBusinessType = '') {
  const dashboard = summary.dashboard ? { ...summary.dashboard } : summary.dashboard;
  if (dashboard?.detailTabs) dashboard.detailTabs = compactTabs(dashboard.detailTabs);
  return {
    ...summary,
    ...(viewBusinessType ? { viewBusinessType } : {}),
    dailyPreview: [],
    detailTabs: compactTabs(summary.detailTabs),
    dashboard,
    logs: []
  };
}

function buildNetworkInfo(req) {
  const port = Number(process.env.PORT || 5177);
  const addresses = [];
  for (const rows of Object.values(networkInterfaces())) {
    for (const item of rows || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  const lanIp = addresses[0] || '';
  const publicUrl = String(process.env.PUBLIC_URL || '').trim();
  return {
    lanUrl: lanIp ? `http://${lanIp}:${port}` : '',
    publicUrl,
    publicConfigured: Boolean(publicUrl),
    currentOrigin: `${req.protocol || 'http'}://${req.get?.('host') || `127.0.0.1:${port}`}`
  };
}

async function buildPayload(req) {
  const startedAt = Date.now();
  const unifiedHistory = listUnifiedImportHistory(30);
  const latestUnified = unifiedHistory[0] || getLatestUnifiedImport();
  const snapshotId = String(latestUnified?.snapshotId || '');
  const rawStates = Object.fromEntries(TYPES.map(type => [
    type,
    loadLightweightUnifiedBusinessState(type, snapshotId, { includeHistory: false })
  ]));
  const dbStatus = getDbStatus();
  const shopCodes = getShopCodeSummary();
  const network = buildNetworkInfo(req);

  const businessStates = {};
  for (const type of TYPES) {
    const raw = rawStates[type];
    const summarized = SHOPEE_TYPES.has(type)
      ? summarizeLightweightShopeeState(raw, { dbStatus })
      : summarizeLightweightCcslState(raw, { dbStatus, network, shopCodes });
    businessStates[type] = compactSummary({
      ...summarized,
      businessType: SHOPEE_TYPES.has(type) ? 'SHOPEE' : type
    }, type);
  }

  const ccslRaw = mergeRawStates(TYPES.filter(type => CCSL_TYPES.has(type)).map(type => rawStates[type]), 'CCSL');
  const shopeeRaw = mergeRawStates(TYPES.filter(type => SHOPEE_TYPES.has(type)).map(type => rawStates[type]), 'SHOPEE');
  const state = compactSummary(summarizeLightweightCcslState(ccslRaw, { dbStatus, network, shopCodes }));
  const shopeeState = compactSummary(summarizeLightweightShopeeState(shopeeRaw, { dbStatus }));
  const token = await loadToken();

  return {
    ok: true,
    patchId: PATCH_ID,
    bootstrapMode: 'LIGHTWEIGHT_NORMALIZED_SQLITE',
    state,
    shopeeState,
    authStatus: summarizeToken(token),
    session: { ok: true, user: publicUser(req.user), unreadNotifications: 0 },
    history: {
      CCSL: listSnapshotHistory(60),
      SHOPEE: listBusinessHistoryDates(SHOPEE, 60),
      UNIFIED: unifiedHistory
    },
    unifiedImport: latestUnified,
    businessStates,
    generatedAt: new Date().toISOString(),
    serverBuildMs: Date.now() - startedAt
  };
}

async function fastBootstrap(req, res) {
  const now = Date.now();
  if (payloadCache && now - payloadCacheAt < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'private, max-age=5');
    res.setHeader('X-CE-QC-Bootstrap', 'V43-HIT');
    res.setHeader('Server-Timing', 'bootstrap;dur=0');
    return res.json({ ...payloadCache, cacheHit: true });
  }
  if (!buildPromise) {
    buildPromise = buildPayload(req).finally(() => { buildPromise = null; });
  }
  const payload = await buildPromise;
  payloadCache = payload;
  payloadCacheAt = Date.now();
  res.setHeader('Cache-Control', 'private, max-age=5');
  res.setHeader('X-CE-QC-Bootstrap', 'V43-MISS');
  res.setHeader('Server-Timing', `bootstrap;dur=${Number(payload.serverBuildMs || 0)}`);
  return res.json({ ...payload, cacheHit: false });
}

const previousGet = express.application.get;
express.application.get = function v43FastBootstrapRegistration(pathValue, ...handlers) {
  if (pathValue === '/api/bootstrap' && handlers.length) {
    return previousGet.call(this, pathValue, fastBootstrap);
  }
  return previousGet.call(this, pathValue, ...handlers);
};

export const V43_BOOTSTRAP_PERF_PATCH_ID = PATCH_ID;
