import express from 'express';
import fs from 'node:fs/promises';
import './v108PerformanceIndexPatch.js';
import './v281ArchivedHistoricalReparse.js';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';
import { getUnifiedProcessingQueue, saveUnifiedImport } from './unifiedImportStore.js';
import { loadState, saveState } from './storage.js';
import { resetRunForReport } from './store.js';
import { SHOPEE, loadBusinessState, resetBusinessRunForReport, saveBusinessState } from './businessStore.js';

const PATCH_ID = '2026-08-24-v280-sparse-excel-precommit-observability-v1';
const originalUse = express.application.use;
const previousPost = express.application.post;
let installed = false;

const CORE_LIVE_ASSET_RE = /\/(?:app|dashboard-v18|dashboard-chart-v18|dashboard-data-adapter-v18)\.js$|\/dashboard-v18\.css$|\/(?:v271-canonical-integrity-owner|v272-layout-trend-finalizer|v274-trend-speed-guard)\.js$/i;

function cacheableAsset(req, res, next) {
  const pathname = String(req.path || req.url || '').split('?')[0];
  const originalUrl = String(req.originalUrl || req.url || '');
  const accept = String(req.headers?.accept || '');
  const htmlNavigation = pathname === '/' || /\.html$/i.test(pathname) || accept.includes('text/html');

  if (htmlNavigation) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Clear-Site-Data', '"cache"');
  } else if (CORE_LIVE_ASSET_RE.test(pathname)) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (/\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(pathname)) {
    const versioned = /[?&]v=[^&]+/i.test(originalUrl);
    res.setHeader('Cache-Control', versioned
      ? 'private, max-age=86400, stale-while-revalidate=604800'
      : 'private, max-age=300, stale-while-revalidate=3600');
  }
  next();
}

express.application.use = function v280StaticAssetCacheUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!installed && candidates.some(fn => fn.name === 'serveStatic')) {
    installed = true;
    originalUse.call(this, cacheableAsset);
  }
  return originalUse.apply(this, args);
};

function observeUnifiedImportRequest(req, res, next) {
  req.v280RequestStartedAt = Date.now();
  console.info('[CE-QC][V280_IMPORT_REQUEST_START]', JSON.stringify({
    contentLength: Number(req.headers?.['content-length'] || 0),
    contentType: String(req.headers?.['content-type'] || '').slice(0, 100)
  }));
  next();
}

function safeJsonRow(row = {}) {
  try {
    const parsed = typeof row.stateJson === 'string' ? JSON.parse(row.stateJson || '{}') : (row.stateJson || {});
    return { ...parsed, shipmentCode: parsed.shipmentCode || row.shipmentCode, businessType: parsed.businessType || row.businessType, sourceReportDate: row.sourceReportDate || parsed.sourceReportDate, lastReportDate: row.lastReportDate || parsed.lastReportDate };
  } catch {
    return { ...row };
  }
}

function clearRunResults(state = {}) {
  state.scanPool = [];
  state.scanResults = [];
  state.needTrackBills = [];
  state.trackResults = [];
  state.trackEvents = [];
  state.finalRows = [];
  state.finalDiversionRows = [];
  state.nextCarryBills = [];
  state.lastRunSummary = null;
  state.lastRun = null;
  state.currentRun = null;
  state.processing = { running: false, paused: false, phase: '' };
}

async function finishUnifiedCompatibility({ parsed, saved, sourceName, filePath }) {
  const startedAt = Date.now();
  try {
    const processingQueue = getUnifiedProcessingQueue(saved.batchId);
    const ccslRows = parsed.rows.filter(row => ['CE', 'CEAF', 'TBKH', 'ALI1688'].includes(row.businessType));
    const shopeeRows = parsed.rows.filter(row => ['SHOPEECN', 'SHOPEEVN'].includes(row.businessType));
    const historicalCcsl = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['CE', 'CEAF', 'TBKH', 'ALI1688'].includes(row.businessType));
    const historicalShopee = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['SHOPEECN', 'SHOPEEVN'].includes(row.businessType));

    const ccslState = await loadState();
    ccslState.reportDate = parsed.reportDate;
    ccslState.sourceName = sourceName;
    ccslState.dailyReportReady = true;
    ccslState.dailyParseRows = ccslRows.map(row => ({ ...row, result: 'PNH', reason: row.classificationReason }));
    ccslState.dailyParseSummary = { totalRecognized: ccslRows.length, pnh: ccslRows.length, nonPnh: 0, excluded: 0, duplicate: parsed.summary.duplicateRows };
    ccslState.pnhBills = ccslRows.map(row => row.shipmentCode);
    ccslState.nonPnhBills = [];
    ccslState.excludedBills = [];
    ccslState.duplicateBills = [];
    clearRunResults(ccslState);
    ccslState.carryBills = historicalCcsl.map(row => row.shipmentCode);
    ccslState.priorCarryRows = historicalCcsl.map(row => safeJsonRow(row));
    resetRunForReport(parsed.reportDate);
    await saveState(ccslState);

    const shopeeState = loadBusinessState(SHOPEE);
    shopeeState.businessType = SHOPEE;
    shopeeState.reportDate = parsed.reportDate;
    shopeeState.sourceName = sourceName;
    shopeeState.dailyReportReady = true;
    shopeeState.dailyParseRows = shopeeRows.map(row => ({
      ...row,
      recipient_raw: row.recipientRaw,
      recipient_normalized: row.recipientNormalized,
      recipient_group: row.businessType === 'SHOPEEVN' ? 'VN' : 'CN',
      region_code: row.regionCode,
      import_disposition: 'ACCEPTED'
    }));
    shopeeState.dailyParseSummary = {
      totalRecognized: shopeeRows.length,
      groupCounts: { CN: saved.classificationCounts.SHOPEECN, VN: saved.classificationCounts.SHOPEEVN },
      conflictCount: parsed.summary.classificationConflicts
    };
    shopeeState.pnhBills = shopeeRows.map(row => row.shipmentCode);
    clearRunResults(shopeeState);
    shopeeState.carryBills = historicalShopee.map(row => row.shipmentCode);
    shopeeState.priorCarryRows = historicalShopee.map(row => safeJsonRow(row));
    resetBusinessRunForReport(SHOPEE, parsed.reportDate);
    saveBusinessState(shopeeState, SHOPEE);

    try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
    console.info('[CE-QC][V280_IMPORT_COMPAT_DONE]', JSON.stringify({ reportDate: parsed.reportDate, batchId: saved.batchId, durationMs: Date.now() - startedAt }));
  } catch (error) {
    console.error('[CE-QC][V280_IMPORT_COMPAT_FAILED]', JSON.stringify({ reportDate: parsed?.reportDate || '', batchId: saved?.batchId || '', error: error?.message || String(error) }));
  } finally {
    if (filePath) await fs.unlink(filePath).catch(() => {});
  }
}

async function fastUnifiedImportHandler(req, res) {
  const startedAt = Date.now();
  try {
    if (!req.file) throw new Error('没有收到综合日报Excel文件');
    const uploadReceivedMs = req.v280RequestStartedAt ? Date.now() - req.v280RequestStartedAt : null;
    console.info('[CE-QC][V280_IMPORT_UPLOAD_DONE]', JSON.stringify({ sourceName: req.file.originalname || '', bytes: Number(req.file.size || 0), uploadReceivedMs }));

    const parseReuseStarted = Date.now();
    const parsed = req.v280UnifiedParsed || req.v279UnifiedParsed || parseUnifiedDailyExcel(req.file.path, { reportDate: req.body.reportDate || '', originalName: req.file.originalname });
    const parseReuseMs = Date.now() - parseReuseStarted;
    const reusedValidatedParse = Boolean(req.v280UnifiedParsed || req.v279UnifiedParsed);

    const saveStarted = Date.now();
    console.info('[CE-QC][V280_IMPORT_COMMIT_START]', JSON.stringify({ reportDate: parsed.reportDate, rows: Number(parsed.summary?.validUniqueWaybills || 0), reusedValidatedParse }));
    const saved = saveUnifiedImport(parsed, req.file.originalname);
    const sqliteCommitMs = Date.now() - saveStarted;
    console.info('[CE-QC][V280_IMPORT_COMMIT_DONE]', JSON.stringify({ reportDate: parsed.reportDate, batchId: saved.batchId, rows: Number(parsed.summary?.validUniqueWaybills || 0), reusedValidatedParse, parseReuseMs, sqliteCommitMs, totalHandlerMs: Date.now() - startedAt, totalRequestMs: req.v280RequestStartedAt ? Date.now() - req.v280RequestStartedAt : null }));

    res.json({ ok: true, ...saved, compatibilityPending: true, ack: 'SQLITE_COMMITTED', importTiming: { reusedValidatedParse, parseReuseMs, sqliteCommitMs, totalHandlerMs: Date.now() - startedAt, totalRequestMs: req.v280RequestStartedAt ? Date.now() - req.v280RequestStartedAt : null } });
    setImmediate(() => { void finishUnifiedCompatibility({ parsed, saved, sourceName: req.file.originalname, filePath: req.file.path }); });
  } catch (error) {
    console.error('[CE-QC][V280_IMPORT_COMMIT_FAILED]', JSON.stringify({ error: error?.message || String(error), durationMs: Date.now() - startedAt, totalRequestMs: req.v280RequestStartedAt ? Date.now() - req.v280RequestStartedAt : null }));
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    if (!res.headersSent) res.status(400).json({ ok: false, error: error.message, sheetDiagnostics: error.sheetDiagnostics || [] });
  }
}

express.application.post = function v280FastUnifiedImportPost(pathValue, ...handlers) {
  if (String(pathValue || '') === '/api/import/unified-daily-report' && handlers.length >= 1) {
    const last = handlers.length - 1;
    return previousPost.call(this, pathValue, observeUnifiedImportRequest, ...handlers.slice(0, last), fastUnifiedImportHandler);
  }
  return previousPost.call(this, pathValue, ...handlers);
};

export const V89_STATIC_ASSET_CACHE_PATCH_ID = PATCH_ID;
console.info('[CE-QC][V280_IMPORT_FAST_ACK]', PATCH_ID, 'native SPA preserved; upload/census/parse/COMMIT timing observable; V273 validated parse reused; sparse Excel range guard active; compatibility state saves continue in background.');
