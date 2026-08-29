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

const PATCH_ID = '2026-08-29-v155-fresh-import-direct-whpp-authority-v2';
const IMPORT_RULESET_VERSION = '2026-08-13-v77-ceaf-whpp-source-authority';
const CORE_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const APP_PATHS = new Set(['/', '/home', '/ce', '/ceaf', '/tbkh', '/ali1688', '/shopeecn', '/shopeevn', '/whpp', '/tracking', '/abnormal', '/carry', '/export', '/import', '/data', '/settings', '/logs']);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.resolve(__dirname, '..', 'public', 'index.html');
let whppRunPromise = null;

function existingWhppDailyMembership(reportDate) {
  const date = String(reportDate || '').slice(0, 10);
  if (!date) return { headerPresent: false, present: false, incomplete: false, count: 0, expected: 0, actual: 0 };
  const db = getDb();
  const daily = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);
  if (!daily) return { headerPresent: false, present: false, incomplete: false, count: 0, expected: 0, actual: 0 };
  const expected = Number(daily.totalCount || 0);
  const actual = Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''").get(date)?.count || 0);
  // A persisted header is authoritative only when its exact member count agrees.
  // This intentionally includes 0/0: a confirmed zero-WHPP day is real truth and
  // must not be rewritten or have its WHPP run/history pointers cleared later.
  const present = actual === expected;
  return { headerPresent: true, present, incomplete: !present, count: present ? actual : 0, expected, actual };
}

function releaseSameFileSupersededSlot(reportDate, fileHash) {
  const date = String(reportDate || '').slice(0, 10);
  const hash = String(fileHash || '').trim();
  if (!date || !hash) return 0;
  const db = getDb();
  const rows = db.prepare("SELECT batchId FROM unified_import_batches WHERE reportDate=? AND fileHash=? AND status='SUPERSEDED' ORDER BY createdAt,batchId").all(date, hash);
  if (!rows.length) return 0;
  const update = db.prepare("UPDATE unified_import_batches SET status=? WHERE batchId=? AND status='SUPERSEDED'");
  let changed = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const batchId = String(row.batchId || '').trim();
      if (!batchId) continue;
      changed += Number(update.run(`SUPERSEDED:${batchId}`, batchId)?.changes || 0);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  if (changed) console.log(`[CE-QC][V42][REUPLOAD_SLOT_RELEASED] reportDate=${date} fileHash=${hash.slice(0, 16)} retired=${changed}`);
  return changed;
}

function invalidateMutableSameDatePointers(reportDate, { whppChanged = true } = {}) {
  const date = String(reportDate || '').slice(0, 10);
  if (!date) return;
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    // A newly imported same-date source is the current truth. Mutable summary and
    // run pointers from an older source must not shadow it; immutable export
    // snapshots are intentionally retained for audit/history.
    db.prepare('DELETE FROM run_locks WHERE reportDate=?').run(date);
    db.prepare('DELETE FROM run_checkpoints WHERE reportDate=?').run(date);
    db.prepare('DELETE FROM history_summary WHERE reportDate=?').run(date);
    db.prepare("DELETE FROM business_run_locks WHERE reportDate=? AND businessType='SHOPEE'").run(date);
    db.prepare("DELETE FROM business_run_checkpoints WHERE reportDate=? AND businessType='SHOPEE'").run(date);
    db.prepare("DELETE FROM business_history_summary WHERE reportDate=? AND businessType='SHOPEE'").run(date);
    if (whppChanged) {
      db.prepare("DELETE FROM business_run_locks WHERE reportDate=? AND businessType='WHPP'").run(date);
      db.prepare("DELETE FROM business_run_checkpoints WHERE reportDate=? AND businessType='WHPP'").run(date);
      db.prepare("DELETE FROM business_history_summary WHERE reportDate=? AND businessType='WHPP'").run(date);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function invalidateDashboardReadCaches() {
  for (const name of [
    '__CE_QC_INVALIDATE_V236_CURRENT_SUMMARY__',
    '__CE_QC_INVALIDATE_V253_DASHBOARD_FAST_PATH__',
    '__CE_QC_INVALIDATE_V284_DAILY_MEMBERSHIP__'
  ]) {
    try { if (typeof globalThis[name] === 'function') globalThis[name](); }
    catch (error) { console.warn('[CE-QC][V42][CACHE_INVALIDATE]', name, error?.message || error); }
  }
}

async function handleUnifiedImportV42(req, res) {
  try {
    if (!req.file) throw new Error('没有收到综合日报Excel文件');
    const parsed = parseUnifiedDailyExcel(req.file.path, {
      reportDate: req.body?.reportDate || '',
      originalName: req.file.originalname
    });
    // A byte-identical Excel must be reclassified after business ownership rules change.
    // Persist the ruleset version with the hash so an old VALID batch cannot silently win
    // simply because the source file bytes are unchanged.
    parsed.fileHash = `${parsed.fileHash}:${IMPORT_RULESET_VERSION}`;
    const whppRows = parsed.rows.filter(row => row.businessType === WHPP);

    // Fail closed before *any* persistence. If an existing same-date WHPP header
    // says 236 while only 235 normalized members remain, an incoming sibling file
    // with zero WHPP rows is not evidence that WHPP became zero. Do not let that
    // upload overwrite either the damaged WHPP evidence or the six-business state.
    const preservedWhpp = whppRows.length === 0
      ? existingWhppDailyMembership(parsed.reportDate)
      : { headerPresent: false, present: false, incomplete: false, count: 0, expected: 0, actual: 0 };
    if (whppRows.length === 0 && preservedWhpp.headerPresent && preservedWhpp.incomplete) {
      const error = new Error(`WHPP标准日报成员不完整：日报头${preservedWhpp.expected}票，成员${preservedWhpp.actual}票；已阻止空WHPP日报覆盖。`);
      error.code = 'WHPP_STANDARD_DAILY_INCOMPLETE';
      error.expected = preservedWhpp.expected;
      error.actual = preservedWhpp.actual;
      throw error;
    }

    const coreRows = parsed.rows.filter(row => row.businessType !== WHPP);
    const coreParsed = coreProjection(parsed, coreRows);
    // The legacy unique index includes status, so a third upload of the exact same
    // date/file would otherwise collide when the current VALID row becomes the next
    // literal SUPERSEDED row. Preserve every audit batch, but move already-retired
    // duplicates to an immutable per-batch retired status before the canonical store
    // performs its atomic VALID -> SUPERSEDED -> new VALID replacement.
    const releasedSupersededSlots = releaseSameFileSupersededSlot(parsed.reportDate, coreParsed.fileHash);
    const saved = saveUnifiedImport(coreParsed, req.file.originalname);
    const queue = getUnifiedProcessingQueue(saved.batchId);

    initializeCcslState(parsed.reportDate, req.file.originalname, coreRows.filter(row => CCSL_TYPES.has(row.businessType)), queue.rows);
    initializeShopeeState(parsed.reportDate, req.file.originalname, coreRows.filter(row => SHOPEE_TYPES.has(row.businessType)), queue.rows);

    const whppChanged = whppRows.length > 0 || !preservedWhpp.present;
    let whppState;
    let effectiveWhppCount;
    let whppImportSource;
    if (preservedWhpp.present) {
      const current = loadWhppState();
      whppState = current.reportDate === parsed.reportDate
        ? current
        : { businessType: WHPP, reportDate: parsed.reportDate, dailyReportReady: true };
      effectiveWhppCount = preservedWhpp.count;
      whppImportSource = 'PRESERVED_EXISTING_COMPLETE_DAILY_MEMBERSHIP';
    } else {
      whppState = saveWhppDailyImport({
        reportDate: parsed.reportDate,
        sourceName: req.file.originalname,
        rows: whppRows,
        batchId: saved.batchId,
        snapshotId: saved.snapshotId
      });
      effectiveWhppCount = whppRows.length;
      whppImportSource = whppRows.length ? 'DIRECT_PARSER_WHPP_DAILY_IMPORT' : 'DIRECT_CONFIRMED_ZERO_WHPP_DAILY_IMPORT';
    }
    invalidateMutableSameDatePointers(parsed.reportDate, { whppChanged });
    invalidateDashboardReadCaches();

    const effectiveCounts = { ...(parsed.classificationCounts || {}), WHPP: effectiveWhppCount };
    const effectiveTotal = Object.values(effectiveCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    res.json({
      ok: true,
      patchId: PATCH_ID,
      importRulesetVersion: IMPORT_RULESET_VERSION,
      ...saved,
      releasedSupersededSlots,
      classificationCounts: effectiveCounts,
      sourceReconciliation: {
        ...(parsed.sourceReconciliation || {}),
        businessTypes: ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'],
        validUniqueWaybills: effectiveTotal,
        classifiedWaybills: effectiveTotal,
        difference: 0,
        balanced: true,
        runtimeTruth: 'CURRENT_CORE_IMPORT_PLUS_DIRECT_OR_PRESERVED_WHPP_DAILY'
      },
      summary: { ...(parsed.summary || {}), validUniqueWaybills: effectiveTotal, totalUnique: effectiveTotal },
      warnings: parsed.warnings,
      sheetDiagnostics: parsed.sheetDiagnostics,
      whpp: {
        businessType: WHPP,
        count: effectiveWhppCount,
        parsedCount: whppRows.length,
        preservedExistingMembership: preservedWhpp.present,
        source: whppImportSource,
        reportDate: parsed.reportDate,
        dailyReportReady: whppState.dailyReportReady
      },
      architectureNote: 'WHPP使用独立持久化快照；同日同文件可重复安全覆盖并保留历史批次；写入前先校验同日WHPP完整性；非空日报直接落库；同日空WHPP分区不得擦除既有完整或损坏证据；导入后立即失效当前看板/趋势只读缓存；现有CCSL/SHOPEE统一快照保持兼容。'
    });
  } catch (error) {
    console.error('[V42][UNIFIED_IMPORT]', error);
    res.status(400).json({ ok: false, code: error.code || 'WHPP_UNIFIED_IMPORT_FAILED', error: error.message || String(error), expected: error.expected ?? null, actual: error.actual ?? null, shipmentCode: error.shipmentCode || '' });
  }
}

function initializeCcslState(reportDate, sourceName, rows, queueRows) {
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
      source: 'V155_UNIFIED_VALID_MEMBERSHIP'
    },
    carryBills: [...new Set(carry)], nextCarryBills: [...new Set(carry)],
    scanResults: [], scanQueryStatus: [], trackResults: [], trackEvents: [], trackQueryStatus: [], finalRows: [], needTrackBills: [],
    processing: { running: false, paused: false, phase: '待处理', batchIndex: 0, totalBatches: 0 },
    lastRunSummary: null, lastRun: null, currentRun: null
  });
}

function initializeShopeeState(reportDate, sourceName, rows, queueRows) {
  const current = loadBusinessState(SHOPEE);
  const today = rows.map(row => row.shipmentCode);
  const carry = queueRows.filter(row => SHOPEE_TYPES.has(String(row.businessType || '').toUpperCase()) && row.sourceType === 'HISTORICAL_CARRY').map(row => row.shipmentCode);
  const dailyParseRows = rows.map(row => ({
    ...row,
    运单号: row.shipmentCode,
    recipient_raw: row.recipientRaw || '',
    recipient_normalized: row.recipientNormalized || '',
    recipient_group: row.businessType === 'SHOPEECN' ? 'CN' : 'VN',
    recipient_group_reason: 'UNIFIED_BUSINESS_TYPE',
    source_row_number: Number(row.rowNumber || 0),
    importStatus: 'ACCEPTED'
  }));
  saveBusinessState({
    ...current,
    businessType: SHOPEE, reportDate, sourceName, dailyReportReady: true,
    pnhBills: today, dailyParseRows,
    dailyParseSummary: { totalRecognized: today.length, groupCounts: { CN: rows.filter(row => row.businessType === 'SHOPEECN').length, VN: rows.filter(row => row.businessType === 'SHOPEEVN').length }, importedAt: new Date().toISOString() },
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
    warnings: [...(parsed.warnings || []), ...(parsed.rows.some(row => row.businessType === WHPP) ? [{ type: 'WHPP_SEPARATE_PERSISTENCE', message: 'WHPP本土由V42独立持久化和业务快照处理，不进入旧六板块统一快照。' }] : [])]
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
    this.get('/api/whpp/progress', (req, res) => { const state = loadWhppState(); res.json({ ok: true, reportDate: state.reportDate, processing: state.processing, summary: state.lastRunSummary, log: (state.progressLog || []).slice(-50) }); });
    this.post('/api/whpp/run/start', runWhpp);
    this.post('/api/whpp/run/resume', runWhpp);
    this.post('/api/whpp/run/pause', (req, res) => { const state = loadWhppState(); state.processing = { ...(state.processing || {}), paused: true }; saveWhppState(state); res.json({ ok: true, reportDate: state.reportDate, processing: state.processing }); });
    this.post('/api/whpp/run/continue', (req, res) => { const state = loadWhppState(); state.processing = { ...(state.processing || {}), paused: false }; saveWhppState(state); res.json({ ok: true, reportDate: state.reportDate, processing: state.processing }); });
  }
  return previousListen.apply(this, args);
};

export const V42_WHPP_PATCH_ID = PATCH_ID;