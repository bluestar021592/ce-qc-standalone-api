import express from 'express';
import fs from 'fs/promises';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';
import { saveUnifiedImport, updateCarryoverResults } from './unifiedImportStore.js';
import { loadState, saveState } from './storage.js';
import { resetRunForReport } from './store.js';
import {
  SHOPEE, loadBusinessState, saveBusinessState, resetBusinessRunForReport
} from './businessStore.js';
import { markDashboardCacheDirty } from './rangeDashboardStore.js';
import { getDb } from './db.js';
import { CEClient } from './ceClient.js';
import { analyzeShipment, normalizeEvent } from './analyzer.js';
import { analyzeShopeeShipment } from './shopeeAnalyzer.js';
import { classifyScanTerminal } from './scanTerminal.js';
import { getShopCodeMap } from './shopCodes.js';
import { isSpecialCategory } from './specialNode.js';

const PATCH_ID = '2026-08-16-v139-daily-carry-isolation-v1';
const DAILY_RUN_ROUTES = new Set(['/api/run', '/api/run/start', '/api/resume', '/api/run/resume']);
const SHOPEE_RUN_ROUTES = new Set(['/api/shopee/run/start', '/api/shopee/run/resume']);
const CCSL_TYPES = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN', 'SHOPEEVN']);
const BUSINESS_TYPES = ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];
const MANUAL_LIMIT_MAX = 200;
const carryClient = new CEClient();

function cleanCodes(values = []) {
  return [...new Set((values || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
}

function billOf(row = {}) {
  return String(row.shipmentCode || row.运单号 || row.waybill || '').trim().toUpperCase();
}

function safeJson(value, fallback = {}) {
  try { return typeof value === 'string' ? (JSON.parse(value || '{}') || fallback) : (value || fallback); }
  catch { return fallback; }
}

function clearDailyRunResults(state = {}) {
  state.priorCarryRows = [];
  state.carryBills = [];
  state.scanPool = [];
  state.scanResults = [];
  state.scanQueryStatus = [];
  state.scanRetryBills = [];
  state.shipmentTrackResults = [];
  state.shipmentQueryStatus = [];
  state.needTrackBills = [];
  state.trackResults = [];
  state.trackEvents = [];
  state.eventQueryStatus = [];
  state.exceptionItems = [];
  state.exceptionQueryStatus = [];
  state.apiBatchStatus = [];
  state.finalRows = [];
  state.finalDiversionRows = [];
  state.nextCarryBills = [];
  state.lastRunSummary = null;
  state.lastRun = null;
  state.currentRun = null;
  state.apiDiagnostic = null;
  state.processing = { running: false, paused: false, phase: '' };
  return state;
}

function compactImportedState(state = {}, businessType = 'CCSL') {
  return {
    businessType,
    reportDate: state.reportDate || '',
    sourceName: state.sourceName || '',
    dailyReportReady: Boolean(state.dailyReportReady || state.reportDate),
    pnh: Number(state.pnhBills?.length || 0),
    total: Number(state.pnhBills?.length || 0),
    carry: 0,
    scanResults: 0,
    trackResults: 0,
    finalRows: 0,
    nextCarry: 0,
    processing: state.processing || { running: false, paused: false, phase: '' },
    dailySummary: state.dailyParseSummary || null
  };
}

function latestUnifiedReportDate() {
  return String(getDb().prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate || '').trim();
}

function carrySummary(reportDate = latestUnifiedReportDate()) {
  const db = getDb();
  const date = String(reportDate || '').trim();
  if (!date) return { reportDate: '', historicalOpen: 0, cumulativeHistorical: 0, historicalClosed: 0, oldestOpenDate: '', byBusiness: Object.fromEntries(BUSINESS_TYPES.map(type => [type, 0])) };
  const one = (sql, ...params) => Number(db.prepare(sql).get(...params)?.count || 0);
  const rows = db.prepare("SELECT businessType,COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate<? GROUP BY businessType").all(date);
  const byBusiness = Object.fromEntries(BUSINESS_TYPES.map(type => [type, 0]));
  for (const row of rows) if (byBusiness[row.businessType] !== undefined) byBusiness[row.businessType] = Number(row.count || 0);
  return {
    reportDate: date,
    historicalOpen: one("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate<?", date),
    cumulativeHistorical: one("SELECT COUNT(*) count FROM carryover_open_items WHERE sourceReportDate<?", date),
    historicalClosed: one("SELECT COUNT(*) count FROM carryover_open_items WHERE status='CLOSED' AND sourceReportDate<?", date),
    oldestOpenDate: String(db.prepare("SELECT MIN(sourceReportDate) value FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate<?").get(date)?.value || ''),
    byBusiness
  };
}

function buildImportCarryDisplay(saved = {}, reportDate = '') {
  const separate = carrySummary(reportDate);
  const todayOpen = Number(saved?.carryover?.todayOpen || 0);
  return {
    todayOpen,
    historicalOpen: separate.historicalOpen,
    rechecked: 0,
    // V139: this field is rendered as “当前处理队列”. It intentionally means
    // today's queue only. Historical carry is displayed separately and never joins
    // the automatic daily run.
    currentOpen: todayOpen,
    historicalSeparate: true,
    cumulativeHistorical: separate.cumulativeHistorical,
    historicalClosed: separate.historicalClosed
  };
}

async function fastUnifiedImport(req, res) {
  try {
    if (!req.file) throw new Error('没有收到综合日报Excel文件');
    const parsed = parseUnifiedDailyExcel(req.file.path, {
      reportDate: req.body?.reportDate || '',
      originalName: req.file.originalname
    });
    const saved = saveUnifiedImport(parsed, req.file.originalname);
    const ccslRows = parsed.rows.filter(row => CCSL_TYPES.has(row.businessType));
    const shopeeRows = parsed.rows.filter(row => SHOPEE_TYPES.has(row.businessType));

    // Daily processing is intentionally isolated from historical carry. The
    // historical queue remains in carryover_open_items and is handled only by the
    // V139 manual carry window.
    const ccslState = clearDailyRunResults(await loadState());
    ccslState.reportDate = parsed.reportDate;
    ccslState.sourceName = req.file.originalname;
    ccslState.dailyReportReady = true;
    ccslState.dailyParseRows = ccslRows.map(row => ({ ...row, result: 'PNH', reason: row.classificationReason }));
    ccslState.dailyParseSummary = {
      totalRecognized: ccslRows.length,
      pnh: ccslRows.length,
      nonPnh: 0,
      excluded: 0,
      duplicate: Number(parsed.summary?.duplicateRows || 0)
    };
    ccslState.pnhBills = ccslRows.map(row => row.shipmentCode);
    ccslState.nonPnhBills = [];
    ccslState.excludedBills = [];
    ccslState.duplicateBills = [];
    resetRunForReport(parsed.reportDate);
    await saveState(ccslState);

    const shopeeState = clearDailyRunResults(loadBusinessState(SHOPEE));
    shopeeState.businessType = SHOPEE;
    shopeeState.reportDate = parsed.reportDate;
    shopeeState.sourceName = req.file.originalname;
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
      groupCounts: {
        CN: Number(saved.classificationCounts?.SHOPEECN || 0),
        VN: Number(saved.classificationCounts?.SHOPEEVN || 0)
      },
      conflictCount: Number(parsed.summary?.classificationConflicts || 0)
    };
    shopeeState.pnhBills = shopeeRows.map(row => row.shipmentCode);
    resetBusinessRunForReport(SHOPEE, parsed.reportDate);
    saveBusinessState(shopeeState, SHOPEE);

    markDashboardCacheDirty(parsed.reportDate, 'UNIFIED_IMPORT_V139');
    await fs.unlink(req.file.path).catch(() => {});
    res.json({
      ok: true,
      ...saved,
      carryover: buildImportCarryDisplay(saved, parsed.reportDate),
      state: compactImportedState(ccslState, 'CCSL'),
      shopeeState: compactImportedState(shopeeState, 'SHOPEE'),
      dailyIsolation: { enabled: true, historicalCarryInDailyRun: 0, patchId: PATCH_ID }
    });
  } catch (error) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({ ok: false, error: error.message, sheetDiagnostics: error.sheetDiagnostics || [] });
  }
}

async function isolateCcslCarry(req, res, next) {
  try {
    const state = await loadState();
    if ((state.carryBills || []).length || (state.priorCarryRows || []).length) {
      state.carryBills = [];
      state.priorCarryRows = [];
      // nextCarryBills can contain current-day unresolved tickets from a partial run.
      // They already exist in pnhBills, so removing this duplicate run source is safe;
      // scanResults/trackResults checkpoints are preserved for resume.
      state.nextCarryBills = [];
      await saveState(state);
    }
    next();
  } catch (error) { next(error); }
}

function isolateShopeeCarry(req, res, next) {
  try {
    const state = loadBusinessState(SHOPEE);
    if ((state.carryBills || []).length || (state.priorCarryRows || []).length) {
      state.carryBills = [];
      state.priorCarryRows = [];
      state.nextCarryBills = [];
      saveBusinessState(state, SHOPEE);
    }
    next();
  } catch (error) { next(error); }
}

function listHistoricalCarry({ reportDate = latestUnifiedReportDate(), businessType = 'ALL', limit = 200 } = {}) {
  const date = String(reportDate || '').trim();
  if (!date) return [];
  const type = String(businessType || 'ALL').trim().toUpperCase();
  const params = [date];
  let typeSql = '';
  if (BUSINESS_TYPES.includes(type)) { typeSql = ' AND businessType=?'; params.push(type); }
  params.push(Math.max(1, Math.min(MANUAL_LIMIT_MAX, Number(limit || 200))));
  return getDb().prepare(`SELECT shipmentCode,businessType,sourceReportDate,lastReportDate,status,apiStatus,closeReason,stateJson,updatedAt
    FROM carryover_open_items
    WHERE status='OPEN' AND sourceReportDate<?${typeSql}
    ORDER BY sourceReportDate ASC,updatedAt ASC,shipmentCode ASC LIMIT ?`).all(...params);
}

function carryPreviewRow(row = {}) {
  const state = safeJson(row.stateJson, {});
  return {
    shipmentCode: row.shipmentCode,
    businessType: row.businessType,
    sourceReportDate: row.sourceReportDate,
    lastReportDate: row.lastReportDate,
    apiStatus: row.apiStatus || '',
    category: state.primaryCategory || state.主分类 || state.异常分类 || '',
    latestNode: state.latestEventDesc || state.lastEventDesc || state.最新节点 || state.最后节点 || '',
    latestEventTime: state.latestEventTime || state.lastEventTime || state.最新时间 || state.最后节点时间 || '',
    updatedAt: row.updatedAt || ''
  };
}

async function queryExceptionWithRetries(codes = []) {
  const clean = cleanCodes(codes);
  if (!clean.length) return { rows: [], failed: new Set() };
  const rows = [];
  const failed = new Set();
  for (let i = 0; i < clean.length; i += 50) {
    const batch = clean.slice(i, i + 50);
    let done = false;
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        rows.push(...await carryClient.exceptionQuery(batch));
        done = true;
        break;
      } catch (error) {
        lastError = error;
        if (/未授权|unauthorized|token|过期|expired/i.test(String(error?.message || ''))) throw error;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    if (!done) for (const bill of batch) failed.add(bill);
    if (!done && lastError) console.warn('[CE-QC][V139] carry exception retry exhausted:', lastError?.message || lastError);
  }
  return { rows, failed };
}

function groupRows(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const bill = billOf(row);
    if (!bill) continue;
    if (!map.has(bill)) map.set(bill, []);
    map.get(bill).push(row);
  }
  return map;
}

function selectConfirmRow(rows = []) {
  const priorities = { POD: 5, RETURN_COMPLETED: 4, RETURN_IN_PROGRESS: 3, OPEN_TRACK_REQUIRED: 2, SCAN_PENDING_RETRY: 1 };
  return [...rows].sort((a, b) => {
    const left = classifyScanTerminal(a, 'success').currentState;
    const right = classifyScanTerminal(b, 'success').currentState;
    return Number(priorities[right] || 0) - Number(priorities[left] || 0);
  })[0] || null;
}

function terminalRow({ bill, businessType, prior, scanRow, terminal, reportDate }) {
  const base = {
    ...prior,
    ...scanRow,
    运单号: bill,
    shipmentCode: bill,
    businessType,
    reportDate,
    来源类型: '跨日遗留手动复查',
    currentState: terminal.currentState,
    scanNormalizedState: terminal.currentState,
    trackRequired: terminal.trackRequired,
    trackSkippedReason: terminal.trackSkippedReason,
    API状态: '成功',
    查询状态: 'success'
  };
  if (terminal.currentState === 'POD') return { ...base, 是否POD: '是', POD状态: 'POD', primaryCategory: 'POD闭环', 主分类: 'POD闭环', 异常分类: 'POD闭环', carry状态: 'closed_pod' };
  if (terminal.currentState === 'RETURN_COMPLETED') return { ...base, 是否POD: '否', POD状态: '未POD', 退回状态: '已退回', primaryCategory: '退回', 主分类: '退回', 异常分类: '退回', carry状态: 'closed_return' };
  return base;
}

async function recheckHistoricalCarry(rows, reportDate) {
  const selected = rows.map(row => String(row.shipmentCode || '').trim().toUpperCase()).filter(Boolean);
  if (!selected.length) return { rows: [], scanFailed: [], trackFailed: [] };
  const priorByBill = new Map(rows.map(row => [String(row.shipmentCode || '').trim().toUpperCase(), safeJson(row.stateJson, {})]));
  const businessByBill = new Map(rows.map(row => [String(row.shipmentCode || '').trim().toUpperCase(), String(row.businessType || '').trim().toUpperCase()]));

  // V139 confirmQuery itself performs three final missing-waybill retry rounds.
  const confirmRows = await carryClient.confirmQuery(selected);
  const confirmByBill = groupRows(confirmRows);
  const scanFailed = new Set(selected.filter(bill => !(confirmByBill.get(bill) || []).length));
  const trackBills = [];
  const resultByBill = new Map();

  for (const bill of selected) {
    const businessType = businessByBill.get(bill) || 'CE';
    const prior = priorByBill.get(bill) || {};
    const selectedScan = selectConfirmRow(confirmByBill.get(bill) || []);
    if (!selectedScan) {
      resultByBill.set(bill, {
        ...prior, shipmentCode: bill, 运单号: bill, businessType, reportDate,
        来源类型: '跨日遗留手动复查', 是否POD: '否', API状态: '失败', 查询状态: 'refresh_failed',
        primaryCategory: '订单扫描待重试', 主分类: '订单扫描待重试', 异常分类: '订单扫描待重试',
        QC判断: '跨日遗留手动复查：订单扫描连续重试后仍无有效返回。'
      });
      continue;
    }
    const terminal = classifyScanTerminal(selectedScan, 'success');
    const row = terminalRow({ bill, businessType, prior, scanRow: selectedScan, terminal, reportDate });
    if (terminal.currentState === 'POD' || terminal.currentState === 'RETURN_COMPLETED') resultByBill.set(bill, row);
    else {
      resultByBill.set(bill, row);
      if (terminal.trackRequired !== false) trackBills.push(bill);
    }
  }

  let eventRows = [];
  const trackFailed = new Set();
  if (trackBills.length) {
    try {
      eventRows = (await carryClient.trackQuery(trackBills)).map(row => ({ ...normalizeEvent(row), reportDate }));
    } catch (error) {
      // The wrapped trackQuery already attempts each failed batch three more times.
      // If it still fails, keep the selected tickets OPEN rather than inventing a
      // business status.
      console.warn('[CE-QC][V139] carry track retry exhausted:', error?.message || error);
      for (const bill of trackBills) trackFailed.add(bill);
    }
  }
  const eventByBill = groupRows(eventRows);
  const shopeeTrackBills = trackBills.filter(bill => SHOPEE_TYPES.has(businessByBill.get(bill)));
  const exceptionResult = await queryExceptionWithRetries(shopeeTrackBills);
  const exceptionByBill = groupRows(exceptionResult.rows);
  const shopCodeMap = getShopCodeMap();

  for (const bill of trackBills) {
    const businessType = businessByBill.get(bill) || 'CE';
    const prior = priorByBill.get(bill) || {};
    const scanRow = resultByBill.get(bill) || { shipmentCode: bill, 运单号: bill };
    const failed = trackFailed.has(bill);
    let analyzed;
    if (SHOPEE_TYPES.has(businessType)) {
      analyzed = analyzeShopeeShipment({
        waybill: bill,
        reportDate,
        scanRow,
        events: eventByBill.get(bill) || [],
        exceptions: exceptionByBill.get(bill) || [],
        dailyRow: prior,
        priorRow: prior,
        apiStatus: {
          shipment: 'success',
          event: failed ? 'failed' : 'success',
          exception: exceptionResult.failed.has(bill) ? 'failed' : 'success'
        }
      });
    } else {
      analyzed = analyzeShipment({
        waybill: bill,
        reportDate,
        scanRow,
        events: eventByBill.get(bill) || [],
        shopCodeMap
      });
    }
    analyzed.businessType = businessType;
    analyzed.reportDate = reportDate;
    analyzed.来源类型 = '跨日遗留手动复查';
    if (failed) {
      analyzed.API状态 = '失败';
      analyzed.查询状态 = 'refresh_failed';
      analyzed.primaryCategory = '待重试';
      analyzed.主分类 = '待重试';
      analyzed.异常分类 = '待重试';
      analyzed.QC判断 = '跨日遗留手动复查：轨迹查询连续重试后仍失败。';
    }
    resultByBill.set(bill, analyzed);
  }

  const results = selected.map(bill => resultByBill.get(bill)).filter(Boolean);
  // Never let a normal special terminal become an abnormal carry item.
  for (const row of results) {
    if (isSpecialCategory(row) || row.primaryCategory === '仓库自提') {
      row.API状态 = row.API状态 || '成功';
      row.查询状态 = row.查询状态 || 'success';
    }
  }
  return { rows: results, scanFailed: [...scanFailed], trackFailed: [...trackFailed] };
}

function carryListHandler(req, res) {
  try {
    const reportDate = latestUnifiedReportDate();
    const businessType = String(req.query?.businessType || 'ALL').toUpperCase();
    const limit = Math.max(1, Math.min(MANUAL_LIMIT_MAX, Number(req.query?.limit || 200)));
    const rows = listHistoricalCarry({ reportDate, businessType, limit });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ ok: true, patchId: PATCH_ID, reportDate, summary: carrySummary(reportDate), businessType, limit, rows: rows.map(carryPreviewRow) });
  } catch (error) { res.status(500).json({ ok: false, error: error.message || String(error) }); }
}

async function carryRecheckHandler(req, res) {
  try {
    const reportDate = latestUnifiedReportDate();
    if (!reportDate) return res.status(400).json({ ok: false, error: '暂无综合日报日期，无法确定跨日边界。' });
    const businessType = String(req.body?.businessType || 'ALL').toUpperCase();
    const requested = cleanCodes(req.body?.shipmentCodes || []);
    let sourceRows;
    if (requested.length) {
      const placeholders = requested.map(() => '?').join(',');
      const dbRows = getDb().prepare(`SELECT shipmentCode,businessType,sourceReportDate,lastReportDate,status,apiStatus,closeReason,stateJson,updatedAt
        FROM carryover_open_items WHERE status='OPEN' AND sourceReportDate<? AND shipmentCode IN (${placeholders})`).all(reportDate, ...requested.slice(0, MANUAL_LIMIT_MAX));
      sourceRows = dbRows;
    } else {
      sourceRows = listHistoricalCarry({ reportDate, businessType, limit: Math.max(1, Math.min(MANUAL_LIMIT_MAX, Number(req.body?.limit || 200))) });
    }
    if (!sourceRows.length) return res.json({ ok: true, patchId: PATCH_ID, reportDate, processed: 0, message: '当前筛选范围没有待复查的历史跨日遗留。', summary: carrySummary(reportDate), rows: [] });
    const checked = await recheckHistoricalCarry(sourceRows, reportDate);
    const snapshotId = `MANUAL-CARRY-${reportDate}-${Date.now()}`;
    updateCarryoverResults({ snapshotId, reportDate, rows: checked.rows });
    const closed = checked.rows.filter(row => row.是否POD === '是' || row.退回状态 === '已退回' || isSpecialCategory(row) || row.primaryCategory === '仓库自提' || row.primaryCategory === '正常分流节点').length;
    res.json({
      ok: true,
      patchId: PATCH_ID,
      reportDate,
      processed: checked.rows.length,
      closed,
      stillOpen: checked.rows.length - closed,
      scanFailed: checked.scanFailed.length,
      trackFailed: checked.trackFailed.length,
      summary: carrySummary(reportDate),
      rows: checked.rows.slice(0, 50).map(row => ({ shipmentCode: billOf(row), businessType: row.businessType || '', category: row.primaryCategory || row.主分类 || '', isPod: row.是否POD === '是', returnState: row.退回状态 || '', queryStatus: row.查询状态 || row.API状态 || '' }))
    });
  } catch (error) { res.status(500).json({ ok: false, error: error.message || String(error) }); }
}

const previousPost = express.application.post;
express.application.post = function v139DailyCarryPost(...args) {
  const route = String(args[0] || '');
  if (route === '/api/import/unified-daily-report' && args.length >= 2) {
    const handlers = args.slice(1);
    // Keep multer/auth middleware but replace only the old heavy handler that loaded
    // the whole historical processing queue into both daily runtime states.
    handlers[handlers.length - 1] = fastUnifiedImport;
    return previousPost.apply(this, [args[0], ...handlers]);
  }
  if (DAILY_RUN_ROUTES.has(route)) return previousPost.apply(this, [args[0], isolateCcslCarry, ...args.slice(1)]);
  if (SHOPEE_RUN_ROUTES.has(route)) return previousPost.apply(this, [args[0], isolateShopeeCarry, ...args.slice(1)]);
  return previousPost.apply(this, args);
};

const previousListen = express.application.listen;
let routesInstalled = false;
express.application.listen = function v139DailyCarryListen(...args) {
  if (!routesInstalled) {
    routesInstalled = true;
    this.get('/api/v139/carryover', carryListHandler);
    this.post('/api/v139/carryover/recheck', carryRecheckHandler);
  }
  return previousListen.apply(this, args);
};

export { carrySummary as summarizeV139Carry, clearDailyRunResults as clearV139DailyRunResults };
export const V139_DAILY_CARRY_ISOLATION_PATCH_ID = PATCH_ID;
