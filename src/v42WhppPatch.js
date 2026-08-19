import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';
import { saveUnifiedImport, getUnifiedProcessingQueue } from './unifiedImportStore.js';
import { loadAppState, saveAppState } from './store.js';
import { SHOPEE, loadBusinessState, saveBusinessState } from './businessStore.js';
import { CEClient } from './ceClient.js';
import { runWhppPipeline } from './whppPipeline.js';
import { buildWhppDashboard } from './whppReporting.js';
import { WHPP, loadWhppState, saveWhppState, saveWhppDailyImport, finalizeWhppState, listWhppHistory, loadWhppSnapshot } from './whppStore.js';
import { getDb } from './db.js';
import {
  V207_IMPORT_INTEGRITY_VERSION,
  inspectV207BeforeUpload,
  commitV207Ownership,
  loadV207CanonicalRowsForDate,
  assertV207RuntimeMembership
} from './v207UnifiedImportIntegrity.js';

const PATCH_ID = '2026-08-19-v207-seven-business-no-loss-reupload-v1';
const IMPORT_RULESET_VERSION = '2026-08-19-v207-no-silent-drop-and-append-only-ownership';
const CORE_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const APP_PATHS = new Set(['/', '/home', '/ce', '/ceaf', '/tbkh', '/ali1688', '/shopeecn', '/shopeevn', '/whpp', '/tracking', '/abnormal', '/carry', '/export', '/import', '/data', '/settings', '/logs']);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.resolve(__dirname, '..', 'public', 'index.html');
let whppRunPromise = null;

function invalidateMutableSameDatePointers(reportDate) {
  const date = String(reportDate || '').slice(0, 10);
  if (!date) return;
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM run_locks WHERE reportDate=?').run(date);
    db.prepare('DELETE FROM run_checkpoints WHERE reportDate=?').run(date);
    db.prepare('DELETE FROM history_summary WHERE reportDate=?').run(date);
    db.prepare("DELETE FROM business_run_locks WHERE reportDate=? AND businessType IN ('SHOPEE','WHPP')").run(date);
    db.prepare("DELETE FROM business_run_checkpoints WHERE reportDate=? AND businessType IN ('SHOPEE','WHPP')").run(date);
    db.prepare("DELETE FROM business_history_summary WHERE reportDate=? AND businessType IN ('SHOPEE','WHPP')").run(date);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

async function handleUnifiedImportV42(req, res) {
  try {
    if (!req.file) throw new Error('没有收到综合日报Excel文件');
    const parsed = parseUnifiedDailyExcel(req.file.path, {
      reportDate: req.body?.reportDate || '',
      originalName: req.file.originalname
    });
    const preflight = inspectV207BeforeUpload(parsed);

    parsed.fileHash = `${parsed.fileHash}:${IMPORT_RULESET_VERSION}`;
    const uploadedCoreRows = parsed.rows.filter(row => row.businessType !== WHPP);
    const coreParsed = coreProjection(parsed, uploadedCoreRows);
    const saved = saveUnifiedImport(coreParsed, req.file.originalname);

    const integrity = commitV207Ownership(parsed, {
      sourceName: req.file.originalname,
      batchId: saved.batchId,
      snapshotId: saved.snapshotId,
      fileHash: parsed.fileHash
    });
    const canonicalRows = loadV207CanonicalRowsForDate(parsed.reportDate);
    const coreRows = canonicalRows.filter(row => row.businessType !== WHPP);
    const whppRows = canonicalRows.filter(row => row.businessType === WHPP);
    const ccslRows = coreRows.filter(row => CCSL_TYPES.has(row.businessType));
    const shopeeRows = coreRows.filter(row => SHOPEE_TYPES.has(row.businessType));
    const queue = getUnifiedProcessingQueue(saved.batchId);

    initializeCcslState(parsed.reportDate, req.file.originalname, ccslRows, queue.rows, integrity);
    initializeShopeeState(parsed.reportDate, req.file.originalname, shopeeRows, queue.rows, integrity);
    const whppState = saveWhppDailyImport({
      reportDate: parsed.reportDate,
      sourceName: req.file.originalname,
      rows: whppRows,
      batchId: saved.batchId,
      snapshotId: saved.snapshotId
    });

    const runtimeReconciliation = assertV207RuntimeMembership({
      reportDate: parsed.reportDate,
      ccslRows,
      shopeeRows,
      whppRows
    });
    invalidateMutableSameDatePointers(parsed.reportDate);

    const warningList = [...(parsed.warnings || [])];
    if (integrity.recoveredFromEarlierUpload > 0) {
      warningList.push({
        type: 'V207_ARCHIVE_RECOVERY',
        count: integrity.recoveredFromEarlierUpload,
        message: `本次文件比该日历史底账少 ${integrity.recoveredFromEarlierUpload} 票；系统已从不可丢失底账自动保留这些运单，未发生漏票。`
      });
    }
    if (preflight.reclassifiedCount > 0) {
      warningList.push({
        type: 'V207_BUSINESS_RECLASSIFIED',
        count: preflight.reclassifiedCount,
        message: `本次上传有 ${preflight.reclassifiedCount} 票业务归属发生修正；V207以本次明确归属为准，同时保留历史来源审计。`
      });
    }

    res.json({
      ok: true,
      patchId: PATCH_ID,
      importRulesetVersion: IMPORT_RULESET_VERSION,
      importIntegrityVersion: V207_IMPORT_INTEGRITY_VERSION,
      ...saved,
      classificationCounts: integrity.canonicalCounts,
      uploadedClassificationCounts: parsed.classificationCounts,
      sourceReconciliation: parsed.sourceReconciliation,
      runtimeReconciliation,
      importIntegrity: {
        ...integrity,
        preflight,
        status: integrity.reconciliation?.balanced && runtimeReconciliation.balanced
          ? (integrity.completeReupload ? 'COMPLETE_REUPLOAD' : 'NO_LOSS_ARCHIVE_RECOVERY')
          : 'FAILED'
      },
      summary: {
        ...parsed.summary,
        uploadedUniqueWaybills: parsed.summary?.validUniqueWaybills || parsed.rows.length,
        canonicalUniqueWaybills: integrity.canonicalUnique,
        recoveredFromEarlierUpload: integrity.recoveredFromEarlierUpload
      },
      warnings: warningList,
      sheetDiagnostics: parsed.sheetDiagnostics,
      whpp: {
        businessType: WHPP,
        uploadedCount: Number(parsed.classificationCounts?.WHPP || 0),
        canonicalCount: whppRows.length,
        reportDate: parsed.reportDate,
        dailyReportReady: whppState.dailyReportReady
      },
      architectureNote: 'V207以七业务不可丢失成员底账作为运行时入口：重新上传不会删除历史已确认运单；本次明确出现的运单可更新归属和字段；看板、扫描、轨迹、导出继续基于同一成员真值层。'
    });
  } catch (error) {
    console.error('[V42/V207][UNIFIED_IMPORT]', error);
    res.status(400).json({
      ok: false,
      code: error.code || 'V207_UNIFIED_IMPORT_FAILED',
      error: error.message || String(error),
      shipmentCode: error.shipmentCode || '',
      sheetDiagnostics: error.sheetDiagnostics || [],
      checks: error.checks || []
    });
  }
}

function initializeCcslState(reportDate, sourceName, rows, queueRows, integrity = {}) {
  const current = loadAppState();
  const today = rows.map(row => row.shipmentCode);
  const carry = queueRows.filter(row => CCSL_TYPES.has(String(row.businessType || '').toUpperCase()) && row.sourceType === 'HISTORICAL_CARRY').map(row => row.shipmentCode);
  const businessCounts = Object.fromEntries([...CCSL_TYPES].map(type => [type, rows.filter(row => String(row.businessType || '').toUpperCase() === type).length]));
  saveAppState({
    ...current,
    businessType: 'CCSL', reportDate, sourceName, dailyReportReady: true,
    pnhBills: today,
    dailyParseRows: rows.map(row => ({ ...row, result: 'PNH', 运单号: row.shipmentCode })),
    dailyParseSummary: {
      totalRecognized: today.length,
      totalUniqueCount: today.length,
      pnh: today.length,
      pnhCount: today.length,
      nonPnh: 0,
      nonPnhCount: 0,
      excluded: 0,
      excludedCount: 0,
      duplicate: 0,
      duplicateCount: 0,
      businessCounts,
      importedAt: new Date().toISOString(),
      source: 'V207_APPEND_ONLY_CANONICAL_MEMBERSHIP',
      importIntegrity: {
        canonicalUnique: integrity.canonicalUnique || 0,
        recoveredFromEarlierUpload: integrity.recoveredFromEarlierUpload || 0
      }
    },
    carryBills: [...new Set(carry)], nextCarryBills: [...new Set(carry)],
    scanResults: [], scanQueryStatus: [], trackResults: [], trackEvents: [], trackQueryStatus: [], finalRows: [], needTrackBills: [],
    processing: { running: false, paused: false, phase: '待处理', batchIndex: 0, totalBatches: 0 },
    lastRunSummary: null, lastRun: null, currentRun: null
  });
}

function initializeShopeeState(reportDate, sourceName, rows, queueRows, integrity = {}) {
  const current = loadBusinessState(SHOPEE);
  const today = rows.map(row => row.shipmentCode);
  const carry = queueRows.filter(row => SHOPEE_TYPES.has(String(row.businessType || '').toUpperCase()) && row.sourceType === 'HISTORICAL_CARRY').map(row => row.shipmentCode);
  const dailyParseRows = rows.map(row => ({
    ...row,
    运单号: row.shipmentCode,
    recipient_raw: row.recipientRaw || '',
    recipient_normalized: row.recipientNormalized || '',
    recipient_group: row.businessType === 'SHOPEECN' ? 'CN' : 'VN',
    recipient_group_reason: 'V207_CANONICAL_BUSINESS_TYPE',
    source_row_number: Number(row.rowNumber || 0),
    importStatus: 'ACCEPTED'
  }));
  saveBusinessState({
    ...current,
    businessType: SHOPEE, reportDate, sourceName, dailyReportReady: true,
    pnhBills: today, dailyParseRows,
    dailyParseSummary: {
      totalRecognized: today.length,
      groupCounts: {
        CN: rows.filter(row => row.businessType === 'SHOPEECN').length,
        VN: rows.filter(row => row.businessType === 'SHOPEEVN').length
      },
      importedAt: new Date().toISOString(),
      source: 'V207_APPEND_ONLY_CANONICAL_MEMBERSHIP',
      importIntegrity: {
        canonicalUnique: integrity.canonicalUnique || 0,
        recoveredFromEarlierUpload: integrity.recoveredFromEarlierUpload || 0
      }
    },
    carryBills: [...new Set(carry)], nextCarryBills: [...new Set(carry)],
    scanResults: [], scanQueryStatus: [], trackResults: [], trackEvents: [], eventQueryStatus: [], exceptionItems: [], exceptionQueryStatus: [], finalRows: [], needTrackBills: [],
    processing: { running: false, paused: false, phase: '待处理', batchIndex: 0, totalBatches: 0 },
    lastRunSummary: null, lastRun: null, currentRun: null
  }, SHOPEE);
}

function coreProjection(parsed, rows) {
  const counts = Object.fromEntries(CORE_TYPES.map(type => [type, rows.filter(row => row.businessType === type).length]));
  const total = rows.length;
  return {
    ...parsed,
    rows,
    classificationCounts: counts,
    sourceReconciliation: { businessTypes: [...CORE_TYPES], validUniqueWaybills: total, classifiedWaybills: total, difference: 0, balanced: true },
    summary: { ...(parsed.summary || {}), validUniqueWaybills: total },
    warnings: [...(parsed.warnings || []), ...(parsed.rows.some(row => row.businessType === WHPP) ? [{ type: 'WHPP_SEPARATE_PERSISTENCE', message: 'WHPP本土保留独立业务快照，但成员归属已同时写入V207七业务不可丢失底账。' }] : [])]
  };
}

async function runWhpp(req, res) {
  if (whppRunPromise) return res.status(409).json({ ok: false, code: 'WHPP_RUN_ALREADY_ACTIVE', error: 'WHPP当前任务正在运行，请勿重复启动。' });
  const state = loadWhppState();
  if (!state.reportDate || !state.dailyReportReady) return res.status(400).json({ ok: false, code: 'WHPP_REPORT_MISSING', error: '当前未导入WHPP本土日报数据。' });
  const client = new CEClient();
  const log = [];
  const onProgress = async message => { log.push({ at: new Date().toISOString(), message: String(message || '') }); if (log.length > 200) log.shift(); };
  whppRunPromise = (async () => {
    const result = await runWhppPipeline({
      state,
      client,
      onProgress,
      onCheckpoint: async current => { current.progressLog = [...log]; saveWhppState(current); },
      isPaused: async () => Boolean(loadWhppState().processing?.paused)
    });
    const finalized = finalizeWhppState(result.state);
    return { ...finalized, summary: result.summary, log };
  })();
  try {
    const result = await whppRunPromise;
    res.json({ ok: true, patchId: PATCH_ID, reportDate: result.state.reportDate, snapshotId: result.snapshotId, summary: result.summary, dashboard: result.dashboard, log: result.log.slice(-50) });
  } catch (error) {
    console.error('[V42][WHPP_RUN]', error);
    const current = loadWhppState();
    const auth = /401|403|未授权|unauthorized|登录.*失效|token/i.test(`${error?.ceStatus || ''} ${error?.ceCode || ''} ${error?.message || ''}`);
    res.status(auth ? 409 : 500).json({ ok: false, code: auth ? 'AUTH_REQUIRED' : (error.code || 'WHPP_RUN_FAILED'), error: auth ? 'CE系统登录已失效，请重新登录后继续WHPP处理。' : (error.message || String(error)), reportDate: current.reportDate, processing: current.processing, log: log.slice(-50) });
  } finally {
    whppRunPromise = null;
  }
}

function whppStatePayload(reportDate = '') {
  const current = loadWhppState();
  if (!reportDate || reportDate === current.reportDate) return { state: current, dashboard: buildWhppDashboard(current), snapshotStatus: current.snapshotStatus || 'IMPORTED' };
  const row = getDb().prepare(`SELECT snapshotId,payloadJson FROM business_export_snapshots WHERE businessType='WHPP' AND reportDate=? ORDER BY createdAt DESC LIMIT 1`).get(reportDate);
  if (!row) return { state: { businessType: WHPP, reportDate, pnhBills: [], finalRows: [] }, dashboard: buildWhppDashboard({ businessType: WHPP, reportDate }), snapshotStatus: 'EMPTY' };
  const payload = JSON.parse(row.payloadJson || '{}');
  return { state: payload.state || {}, dashboard: payload.dashboard || buildWhppDashboard(payload.state || {}), snapshotStatus: 'COMPLETED', snapshotId: row.snapshotId };
}

function whppDetail(req, res) {
  const reportDate = String(req.query.reportDate || '').slice(0, 10);
  const tab = String(req.query.tab || 'all');
  const payload = whppStatePayload(reportDate);
  const detail = payload.dashboard?.detailTabs?.[tab] || { label: tab, rows: [], total: 0 };
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.max(1, Math.min(300, Number(req.query.pageSize || 200)));
  const start = (page - 1) * pageSize;
  res.json({ ok: true, businessType: WHPP, reportDate: payload.state?.reportDate || reportDate, tab, label: detail.label || tab, total: Number(detail.total || detail.rows?.length || 0), page, pageSize, rows: (detail.rows || []).slice(start, start + pageSize) });
}

function whppHtmlMiddleware(req, res, next) {
  if (req.method !== 'GET' || !APP_PATHS.has(req.path)) return next();
  try {
    const html = fs.readFileSync(INDEX_FILE, 'utf8').replace('</body>', '  <script src="/whpp-v42.js?v=20260810-1"></script>\n</body>');
    res.type('html').send(html);
  } catch (error) { next(error); }
}

const previousPost = express.application.post;
express.application.post = function v42WhppPost(pathValue, ...handlers) {
  if (pathValue === '/api/import/unified-daily-report' && handlers.length) {
    return previousPost.call(this, pathValue, ...handlers.slice(0, -1), handleUnifiedImportV42);
  }
  return previousPost.call(this, pathValue, ...handlers);
};

const previousUse = express.application.use;
let htmlInjectionInstalled = false;
express.application.use = function v42WhppUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!htmlInjectionInstalled && candidates.some(fn => fn.name === 'serveStatic')) {
    htmlInjectionInstalled = true;
    previousUse.call(this, whppHtmlMiddleware);
  }
  return previousUse.apply(this, args);
};

const previousListen = express.application.listen;
let routesInstalled = false;
express.application.listen = function v42WhppListen(...args) {
  if (!routesInstalled) {
    routesInstalled = true;
    this.get('/api/whpp/state', (req, res) => res.json({ ok: true, patchId: PATCH_ID, ...whppStatePayload(String(req.query.reportDate || '').slice(0, 10)) }));
    this.get('/api/whpp/history', (req, res) => res.json({ ok: true, businessType: WHPP, rows: listWhppHistory(req.query.limit) }));
    this.get('/api/whpp/snapshot/:id', (req, res) => { const payload = loadWhppSnapshot(req.params.id); return payload ? res.json({ ok: true, ...payload }) : res.status(404).json({ ok: false, error: 'WHPP快照不存在' }); });
    this.get('/api/whpp/metric-detail', whppDetail);
    this.get('/api/whpp/progress', (req, res) => { const state = loadWhppState(); res.json({ ok: true, reportDate: state.reportDate, processing: state.processing, summary: state.lastRunSummary, log: (state.progressLog || []).slice(-50) });
    this.post('/api/whpp/run/start', runWhpp);
    this.post('/api/whpp/run/resume', runWhpp);
    this.post('/api/whpp/run/pause', (req, res) => { const state = loadWhppState(); state.processing = { ...(state.processing || {}), paused: true }; saveWhppState(state); res.json({ ok: true, reportDate: state.reportDate, processing: state.processing }); });
    this.post('/api/whpp/run/continue', (req, res) => { const state = loadWhppState(); state.processing = { ...(state.processing || {}), paused: false }; saveWhppState(state); res.json({ ok: true, reportDate: state.reportDate, processing: state.processing }); });
  }
  return previousListen.apply(this, args);
};

export const V42_WHPP_PATCH_ID = PATCH_ID;
