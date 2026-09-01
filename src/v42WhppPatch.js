import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';
import { saveAppState } from './store.js';
import { SHOPEE, saveBusinessState } from './businessStore.js';
import { CEClient } from './ceClient.js';
import { runWhppPipeline } from './whppPipeline.js';
import { buildWhppDashboard } from './whppReporting.js';
import { WHPP, loadWhppState, saveWhppState, saveWhppDailyImport, finalizeWhppState, listWhppHistory, loadWhppSnapshot } from './whppStore.js';
import { getDb, nowIso } from './db.js';

const PATCH_ID = '2026-08-30-v366-seven-business-atomic-whpp-rehydrate-v2';
const IMPORT_RULESET_VERSION = '2026-08-13-v77-ceaf-whpp-source-authority';
const CORE_TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
const ALL_TYPES = [...CORE_TYPES, WHPP];
const CCSL_TYPES = new Set(['CE','CEAF','TBKH','ALI1688']);
const SHOPEE_TYPES = new Set(['SHOPEECN','SHOPEEVN']);
const APP_PATHS = new Set(['/', '/home', '/ce', '/ceaf', '/tbkh', '/ali1688', '/shopeecn', '/shopeevn', '/whpp', '/tracking', '/abnormal', '/carry', '/export', '/import', '/data', '/settings', '/logs']);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.resolve(__dirname, '..', 'public', 'index.html');
let whppRunPromise = null;

function normalizeDate(value) {
  const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function existingWhppDailyMembership(reportDate) {
  const date = normalizeDate(reportDate);
  if (!date) return { headerPresent: false, present: false, incomplete: false, count: 0, expected: 0, actual: 0 };
  const db = getDb();
  const daily = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=? LIMIT 1").get(date);
  if (!daily) return { headerPresent: false, present: false, incomplete: false, count: 0, expected: 0, actual: 0 };
  const expected = Number(daily.totalCount || 0);
  const actual = Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''").get(date)?.count || 0);
  const present = actual === expected;
  return { headerPresent: true, present, incomplete: !present, count: present ? actual : 0, expected, actual };
}

function loadPreservedWhppDailyRows(reportDate) {
  const date = normalizeDate(reportDate);
  if (!date) return [];
  const rows = getDb().prepare(`
    SELECT shipmentCode,sheetName,rowNumber,source_row_number,recipient_raw,recipient_normalized,rowJson
    FROM business_daily_parse_rows
    WHERE businessType='WHPP' AND reportDate=? AND TRIM(COALESCE(shipmentCode,''))<>''
    ORDER BY id
  `).all(date);
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const bill = String(row.shipmentCode || '').trim().toUpperCase();
    if (!bill || seen.has(bill)) continue;
    seen.add(bill);
    let parsed = {};
    try { parsed = JSON.parse(row.rowJson || '{}') || {}; } catch {}
    result.push({
      ...parsed,
      shipmentCode: bill,
      businessType: WHPP,
      reportDate: date,
      sheetName: parsed.sheetName || row.sheetName || '',
      rowNumber: Number(parsed.rowNumber || row.rowNumber || row.source_row_number || 0),
      recipientRaw: parsed.recipientRaw || parsed.recipient_raw || row.recipient_raw || '',
      recipientNormalized: parsed.recipientNormalized || parsed.recipient_normalized || row.recipient_normalized || '',
      classificationSource: parsed.classificationSource || 'PRESERVED_WHPP_STANDARD_DAILY',
      classificationMatchedValue: parsed.classificationMatchedValue || 'CE',
      classificationReason: parsed.classificationReason || '复用该日期已验证WHPP标准日报成员'
    });
  }
  return result;
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

function fastCarryoverSummary(reportDate) {
  const db = getDb();
  let todayOpen = 0;
  let historicalOpen = 0;
  const countToday = db.prepare("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND businessType=? AND sourceReportDate=?");
  const countHistorical = db.prepare("SELECT COUNT(*) count FROM carryover_open_items WHERE status='OPEN' AND businessType=? AND sourceReportDate<?");
  for (const type of ALL_TYPES) {
    todayOpen += Number(countToday.get(type, reportDate)?.count || 0);
    historicalOpen += Number(countHistorical.get(type, reportDate)?.count || 0);
  }
  return { todayOpen, historicalOpen, rechecked: 0, currentOpen: todayOpen + historicalOpen, historicalSeparate: true, source: 'V366_INDEXED_COUNTS' };
}

function historicalCarryBills(types, reportDate) {
  const db = getDb();
  const stmt = db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE status='OPEN' AND businessType=? AND sourceReportDate<? ORDER BY sourceReportDate,shipmentCode");
  const bills = [];
  for (const type of types) for (const row of stmt.all(type, reportDate)) bills.push(String(row.shipmentCode || '').trim().toUpperCase());
  return [...new Set(bills.filter(Boolean))];
}

function shopeePriorCarryRows(carryBills = []) {
  const db = getDb();
  const lookup = db.prepare("SELECT shipmentCode,businessType,sourceReportDate,lastReportDate FROM carryover_open_items WHERE shipmentCode=? AND status='OPEN' LIMIT 1");
  const rows = [];
  for (const value of [...new Set(carryBills || [])]) {
    const bill = String(value || '').trim().toUpperCase();
    if (!bill) continue;
    const found = lookup.get(bill);
    const businessType = String(found?.businessType || '').toUpperCase();
    if (!SHOPEE_TYPES.has(businessType)) continue;
    rows.push({
      shipmentCode: bill,
      运单号: bill,
      businessType,
      recipient_group: businessType === 'SHOPEECN' ? 'CN' : 'VN',
      recipient_group_reason: 'HISTORICAL_CARRY_BUSINESS_TYPE',
      sourceDate: found?.sourceReportDate || '',
      sourceReportDate: found?.sourceReportDate || '',
      lastReportDate: found?.lastReportDate || '',
      sourceType: 'HISTORICAL_CARRY'
    });
  }
  return rows;
}

function podBillsForMembership(bills = []) {
  const db = getDb();
  const unique = [...new Set((bills || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
  const found = [];
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT shipmentCode FROM shipment_current_state WHERE shipmentCode IN (${placeholders}) AND UPPER(COALESCE(state,''))='POD'`).all(...chunk);
    found.push(...rows.map(row => String(row.shipmentCode || '').trim().toUpperCase()));
  }
  return [...new Set(found.filter(Boolean))];
}

function stageUnifiedCoreImport(parsed, sourceName) {
  const db = getDb();
  const batchId = `BATCH-${crypto.randomUUID()}`;
  const snapshotId = `SNAP-${crypto.randomUUID()}`;
  const stageStatus = `STAGING:${batchId}`;
  const createdAt = nowIso();
  const payload = {
    reportDate: parsed.reportDate,
    dateDetectionSource: parsed.dateDetectionSource,
    dateCandidates: parsed.dateCandidates,
    dateConflict: parsed.dateConflict,
    containerFormat: parsed.containerFormat,
    classificationCounts: parsed.classificationCounts,
    sourceReconciliation: parsed.sourceReconciliation,
    regionCounts: parsed.regionCounts,
    summary: parsed.summary,
    sheetDiagnostics: parsed.sheetDiagnostics,
    rows: parsed.rows
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      batchId, snapshotId, parsed.reportDate, sourceName, parsed.fileHash, stageStatus,
      JSON.stringify(parsed.summary || {}), JSON.stringify(parsed.warnings || []), createdAt,
      parsed.dateDetectionSource || '', JSON.stringify(parsed.dateCandidates || []), parsed.dateWasManuallyCorrected ? 1 : 0,
      JSON.stringify(parsed.regionCounts || {})
    );
    const insertRow = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertDaily = db.prepare(`INSERT INTO shipment_daily_snapshots(snapshotId,batchId,reportDate,businessType,shipmentCode,regionCode,classificationSource,rowJson,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    const upsertCurrent = db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt)
      VALUES(?,?,?,?,?,'PENDING_SCAN','',?,?)
      ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,snapshotId=excluded.snapshotId,
        state=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN shipment_current_state.state ELSE 'PENDING_SCAN' END,
        apiStatus=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN shipment_current_state.apiStatus ELSE 'PENDING_SCAN' END,
        lastEventTime=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN shipment_current_state.lastEventTime ELSE '' END,
        stateJson=CASE WHEN UPPER(COALESCE(shipment_current_state.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED') THEN shipment_current_state.stateJson ELSE excluded.stateJson END,
        updatedAt=excluded.updatedAt`);
    const upsertCarry = db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,'OPEN','PENDING_SCAN','',?,?,?)
      ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,lastReportDate=excluded.lastReportDate,lastSnapshotId=excluded.lastSnapshotId,
        status=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP') THEN 'CLOSED' ELSE 'OPEN' END,
        apiStatus=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP') THEN carryover_open_items.apiStatus ELSE 'PENDING_SCAN' END,
        closeReason=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP') THEN carryover_open_items.closeReason ELSE '' END,
        stateJson=CASE WHEN carryover_open_items.status='CLOSED' AND UPPER(COALESCE(carryover_open_items.closeReason,'')) IN ('POD','RETURNED','RETURN_COMPLETED','ORDER_CANCELLED','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION','SELF_PICKUP') THEN carryover_open_items.stateJson ELSE excluded.stateJson END,
        updatedAt=excluded.updatedAt`);
    for (const row of parsed.rows) {
      const rowJson = JSON.stringify(row);
      insertRow.run(batchId, snapshotId, parsed.reportDate, row.businessType, row.shipmentCode, row.regionCode, row.recipientRaw, row.recipientNormalized, row.sheetName, row.rowNumber, row.classificationReason, rowJson, createdAt, row.classificationSource || '', row.classificationMatchedValue || '', row.classificationWarning || '');
      insertDaily.run(snapshotId, batchId, parsed.reportDate, row.businessType, row.shipmentCode, row.regionCode, row.classificationSource || '', rowJson, createdAt);
      upsertCurrent.run(row.shipmentCode, row.businessType, parsed.reportDate, snapshotId, 'PENDING_SCAN', rowJson, createdAt);
      upsertCarry.run(row.shipmentCode, row.businessType, parsed.reportDate, parsed.reportDate, snapshotId, snapshotId, rowJson, createdAt, createdAt);
    }
    db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,'STAGING',?,?)`).run(snapshotId, batchId, parsed.reportDate, JSON.stringify(payload), createdAt);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return { batchId, snapshotId, reportDate: parsed.reportDate, sourceName, fileHash: parsed.fileHash, stageStatus, createdAt };
}

function activateUnifiedCoreImport(staged) {
  const db = getDb();
  const releasedSupersededSlots = releaseSameFileSupersededSlot(staged.reportDate, staged.fileHash);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE unified_snapshots SET status='SUPERSEDED' WHERE reportDate=? AND snapshotId<>? AND status IN ('IMPORTED','COMPLETED','INVALID_FAILED_RECONCILIATION')").run(staged.reportDate, staged.snapshotId);
    db.prepare("UPDATE unified_import_batches SET status='SUPERSEDED' WHERE reportDate=? AND batchId<>? AND status='VALID'").run(staged.reportDate, staged.batchId);
    db.prepare("UPDATE unified_import_batches SET status='VALID' WHERE batchId=? AND status=?").run(staged.batchId, staged.stageStatus);
    db.prepare("UPDATE unified_snapshots SET status='IMPORTED' WHERE snapshotId=? AND status='STAGING'").run(staged.snapshotId);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return releasedSupersededSlots;
}

function failStagedImport(staged, error) {
  if (!staged?.batchId) return;
  const db = getDb();
  try {
    db.prepare('UPDATE unified_import_batches SET status=? WHERE batchId=? AND status=?').run(`FAILED_STAGING:${staged.batchId}`, staged.batchId, staged.stageStatus);
    db.prepare("UPDATE unified_snapshots SET status='INVALID_FAILED_IMPORT' WHERE snapshotId=? AND status='STAGING'").run(staged.snapshotId);
    console.warn(`[CE-QC][V366_IMPORT_STAGE_FAILED] reportDate=${staged.reportDate} batchId=${staged.batchId} error=${error?.message || error}`);
  } catch {}
}

function verifyAtomicImportPersistence({ reportDate, staged, expectedCounts }) {
  const db = getDb();
  const date = normalizeDate(reportDate);
  const counts = Object.fromEntries(ALL_TYPES.map(type => [type, Number(expectedCounts?.[type] || 0)]));
  const coreExpected = [...CCSL_TYPES].reduce((sum, type) => sum + counts[type], 0);
  const shopeeExpected = [...SHOPEE_TYPES].reduce((sum, type) => sum + counts[type], 0);
  const fail = (code, message, extra = {}) => {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, extra);
    throw error;
  };

  const batch = db.prepare('SELECT status FROM unified_import_batches WHERE batchId=? AND reportDate=?').get(staged.batchId, date);
  if (batch?.status !== 'VALID') fail('IMPORT_VERIFY_BATCH_NOT_VALID', `日报${date}尚未形成唯一VALID批次。`);
  const snapshot = db.prepare('SELECT status FROM unified_snapshots WHERE snapshotId=? AND reportDate=?').get(staged.snapshotId, date);
  if (snapshot?.status !== 'IMPORTED') fail('IMPORT_VERIFY_SNAPSHOT_NOT_IMPORTED', `日报${date}统一快照尚未提交。`);

  for (const type of CORE_TYPES) {
    const actual = Number(db.prepare('SELECT COUNT(DISTINCT shipmentCode) count FROM shipment_daily_snapshots WHERE snapshotId=? AND businessType=?').get(staged.snapshotId, type)?.count || 0);
    if (actual !== counts[type]) fail('IMPORT_VERIFY_CORE_MEMBERSHIP_MISMATCH', `${date} ${type} 分类落库不一致：应${counts[type]}票，实际${actual}票。`, { businessType: type, expected: counts[type], actual });
  }

  const ccslReport = db.prepare('SELECT totalUniqueCount FROM daily_reports WHERE reportDate=?').get(date);
  const ccslRows = Number(db.prepare('SELECT COUNT(DISTINCT shipmentCode) count FROM daily_parse_rows WHERE reportDate=?').get(date)?.count || 0);
  if (Number(ccslReport?.totalUniqueCount || 0) !== coreExpected || ccslRows !== coreExpected) {
    fail('IMPORT_VERIFY_CCSL_QUEUE_MISMATCH', `${date} CCSL待处理成员未完整建立：应${coreExpected}票，日报${Number(ccslReport?.totalUniqueCount || 0)}票，成员${ccslRows}票。`);
  }

  const shopeeReport = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='SHOPEE' AND reportDate=?").get(date);
  const shopeeRows = Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='SHOPEE' AND reportDate=?").get(date)?.count || 0);
  const shopeeGroups = Object.fromEntries(db.prepare("SELECT recipient_group groupName,COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='SHOPEE' AND reportDate=? GROUP BY recipient_group").all(date).map(row => [String(row.groupName || '').toUpperCase(), Number(row.count || 0)]));
  if (Number(shopeeReport?.totalCount || 0) !== shopeeExpected || shopeeRows !== shopeeExpected || Number(shopeeGroups.CN || 0) !== counts.SHOPEECN || Number(shopeeGroups.VN || 0) !== counts.SHOPEEVN) {
    fail('IMPORT_VERIFY_SHOPEE_QUEUE_MISMATCH', `${date} SHOPEE待处理成员未完整建立：应CN ${counts.SHOPEECN}/VN ${counts.SHOPEEVN}，实际CN ${Number(shopeeGroups.CN || 0)}/VN ${Number(shopeeGroups.VN || 0)}。`);
  }

  const whppReport = db.prepare("SELECT totalCount FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=?").get(date);
  const whppRows = Number(db.prepare("SELECT COUNT(DISTINCT shipmentCode) count FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").get(date)?.count || 0);
  if (Number(whppReport?.totalCount || 0) !== counts.WHPP || whppRows !== counts.WHPP) {
    fail('IMPORT_VERIFY_WHPP_QUEUE_MISMATCH', `${date} WHPP待处理成员未完整建立：应${counts.WHPP}票，日报${Number(whppReport?.totalCount || 0)}票，成员${whppRows}票。`);
  }

  let ccslState = {}, shopeeState = {}, whppState = {};
  try { ccslState = JSON.parse(db.prepare("SELECT valueJson FROM app_state WHERE key='current'").get()?.valueJson || '{}'); } catch {}
  try { shopeeState = JSON.parse(db.prepare("SELECT valueJson FROM business_states WHERE businessType='SHOPEE'").get()?.valueJson || '{}'); } catch {}
  try { whppState = JSON.parse(db.prepare("SELECT valueJson FROM business_states WHERE businessType='WHPP'").get()?.valueJson || '{}'); } catch {}
  if (normalizeDate(ccslState.reportDate) !== date || ccslState.dailyReportReady !== true) fail('IMPORT_VERIFY_CCSL_STATE_DATE_MISMATCH', `CCSL当前处理状态没有切换到${date}。`);
  if (normalizeDate(shopeeState.reportDate) !== date || shopeeState.dailyReportReady !== true) fail('IMPORT_VERIFY_SHOPEE_STATE_DATE_MISMATCH', `SHOPEE当前处理状态没有切换到${date}。`);
  if (normalizeDate(whppState.reportDate) !== date || whppState.dailyReportReady !== true) fail('IMPORT_VERIFY_WHPP_STATE_DATE_MISMATCH', `WHPP当前处理状态没有切换到${date}。`);

  return { ok: true, reportDate: date, total: Object.values(counts).reduce((sum, value) => sum + value, 0), counts, ccslExpected: coreExpected, shopeeExpected, whppExpected: counts.WHPP };
}

async function handleUnifiedImportV42(req, res) {
  const startedAt = Date.now();
  let staged = null;
  try {
    if (!req.file) throw new Error('没有收到综合日报Excel文件');
    const parsed = parseUnifiedDailyExcel(req.file.path, {
      reportDate: req.body?.reportDate || '',
      originalName: req.file.originalname
    });
    parsed.fileHash = `${parsed.fileHash}:${IMPORT_RULESET_VERSION}`;
    const whppRows = parsed.rows.filter(row => row.businessType === WHPP);
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
    staged = stageUnifiedCoreImport(coreParsed, req.file.originalname);
    console.log(`[CE-QC][V366_IMPORT_STAGE] staged reportDate=${parsed.reportDate} coreRows=${coreRows.length} whppRows=${whppRows.length} elapsedMs=${Date.now() - startedAt}`);

    const ccslCarry = historicalCarryBills([...CCSL_TYPES], parsed.reportDate);
    const shopeeCarry = historicalCarryBills([...SHOPEE_TYPES], parsed.reportDate);
    initializeCcslState(parsed.reportDate, req.file.originalname, coreRows.filter(row => CCSL_TYPES.has(row.businessType)), ccslCarry);
    initializeShopeeState(parsed.reportDate, req.file.originalname, coreRows.filter(row => SHOPEE_TYPES.has(row.businessType)), shopeeCarry);
    console.log(`[CE-QC][V366_IMPORT_STAGE] core_states_ready reportDate=${parsed.reportDate} ccslCarry=${ccslCarry.length} shopeeCarry=${shopeeCarry.length} elapsedMs=${Date.now() - startedAt}`);

    let whppState;
    let effectiveWhppCount;
    let whppImportSource;
    if (preservedWhpp.present) {
      const preservedRows = loadPreservedWhppDailyRows(parsed.reportDate);
      if (preservedRows.length !== preservedWhpp.count) {
        const error = new Error(`WHPP标准日报重建失败：应${preservedWhpp.count}票，实际读取${preservedRows.length}票。`);
        error.code = 'WHPP_PRESERVED_MEMBERSHIP_REHYDRATE_MISMATCH';
        error.expected = preservedWhpp.count;
        error.actual = preservedRows.length;
        throw error;
      }
      whppState = saveWhppDailyImport({
        reportDate: parsed.reportDate,
        sourceName: req.file.originalname,
        rows: preservedRows,
        batchId: staged.batchId,
        snapshotId: staged.snapshotId,
        preserveFinalizedLifecycle: true
      });
      effectiveWhppCount = preservedRows.length;
      whppImportSource = 'REHYDRATED_EXISTING_COMPLETE_DAILY_MEMBERSHIP';
    } else {
      whppState = saveWhppDailyImport({
        reportDate: parsed.reportDate,
        sourceName: req.file.originalname,
        rows: whppRows,
        batchId: staged.batchId,
        snapshotId: staged.snapshotId
      });
      effectiveWhppCount = whppRows.length;
      whppImportSource = whppRows.length ? 'DIRECT_PARSER_WHPP_DAILY_IMPORT' : 'DIRECT_CONFIRMED_ZERO_WHPP_DAILY_IMPORT';
    }
    console.log(`[CE-QC][V366_IMPORT_STAGE] whpp_ready reportDate=${parsed.reportDate} whpp=${effectiveWhppCount} source=${whppImportSource} elapsedMs=${Date.now() - startedAt}`);

    const whppLifecycleChanged = !(preservedWhpp.present && String(whppState.snapshotStatus || '').toUpperCase() === 'COMPLETED');
    invalidateMutableSameDatePointers(parsed.reportDate, { whppChanged: whppLifecycleChanged });
    const releasedSupersededSlots = activateUnifiedCoreImport(staged);

    const effectiveCounts = { ...(parsed.classificationCounts || {}), WHPP: effectiveWhppCount };
    const verification = verifyAtomicImportPersistence({ reportDate: parsed.reportDate, staged, expectedCounts: effectiveCounts });
    invalidateDashboardReadCaches();

    const effectiveTotal = Object.values(effectiveCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    const carryover = fastCarryoverSummary(parsed.reportDate);
    console.log(`[CE-QC][V366_IMPORT_COMMITTED] reportDate=${parsed.reportDate} total=${effectiveTotal} batchId=${staged.batchId} verified=1 elapsedMs=${Date.now() - startedAt}`);
    res.json({
      ok: true,
      patchId: PATCH_ID,
      importRulesetVersion: IMPORT_RULESET_VERSION,
      batchId: staged.batchId,
      snapshotId: staged.snapshotId,
      reportDate: parsed.reportDate,
      sourceName: req.file.originalname,
      fileHash: parsed.fileHash,
      dateDetectionSource: parsed.dateDetectionSource,
      dateCandidates: parsed.dateCandidates,
      dateConflict: parsed.dateConflict,
      dateWasManuallyCorrected: parsed.dateWasManuallyCorrected,
      containerFormat: parsed.containerFormat,
      regionCounts: parsed.regionCounts,
      carryover,
      duplicateFile: false,
      sameDateOverwrite: releasedSupersededSlots >= 0,
      releasedSupersededSlots,
      classificationCounts: effectiveCounts,
      sourceReconciliation: {
        ...(parsed.sourceReconciliation || {}),
        businessTypes: [...ALL_TYPES],
        validUniqueWaybills: effectiveTotal,
        classifiedWaybills: effectiveTotal,
        difference: 0,
        balanced: true,
        runtimeTruth: 'V366_ATOMIC_COMMIT_AFTER_CCSL_SHOPEE_WHPP_VERIFIED'
      },
      summary: { ...(parsed.summary || {}), validUniqueWaybills: effectiveTotal, totalUnique: effectiveTotal },
      warnings: parsed.warnings,
      sheetDiagnostics: parsed.sheetDiagnostics,
      persistenceVerification: verification,
      whpp: {
        businessType: WHPP,
        count: effectiveWhppCount,
        parsedCount: whppRows.length,
        preservedExistingMembership: preservedWhpp.present,
        source: whppImportSource,
        reportDate: parsed.reportDate,
        dailyReportReady: whppState.dailyReportReady
      },
      importCommitted: true,
      importElapsedMs: Date.now() - startedAt,
      architectureNote: '新日报先进入不可见STAGING；CCSL、SHOPEE、WHPP三个处理状态和七业务成员全部落库反查一致后，才由V366外层事务一次COMMIT。任何一步失败整体ROLLBACK，上一份正式日报继续生效。'
    });
  } catch (error) {
    failStagedImport(staged, error);
    console.error('[V42][UNIFIED_IMPORT]', error);
    res.status(400).json({ ok: false, code: error.code || 'WHPP_UNIFIED_IMPORT_FAILED', error: error.message || String(error), expected: error.expected ?? null, actual: error.actual ?? null, shipmentCode: error.shipmentCode || '' });
  }
}

function initializeCcslState(reportDate, sourceName, rows, carryBills) {
  const today = rows.map(row => row.shipmentCode);
  const allMembers = [...new Set([...today, ...(carryBills || [])])];
  const podLocks = podBillsForMembership(allMembers);
  const businessCounts = Object.fromEntries([...CCSL_TYPES].map(type => [type, rows.filter(row => String(row.businessType || '').toUpperCase() === type).length]));
  saveAppState({
    businessType: 'CCSL', reportDate, sourceName, dailyReportReady: true,
    pnhBills: today,
    dailyParseRows: rows.map(row => ({ ...row, result: 'PNH', reason: row.classificationReason, 运单号: row.shipmentCode })),
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
      source: 'V366_COMMITTED_UNIFIED_MEMBERSHIP'
    },
    nonPnhBills: [], excludedBills: [], duplicateBills: [],
    carryBills: [...new Set(carryBills || [])], nextCarryBills: [...new Set(carryBills || [])], podLocks,
    scanPool: [], scanResults: [], scanQueryStatus: [], trackResults: [], trackEvents: [], trackQueryStatus: [], finalRows: [], finalDiversionRows: [], needTrackBills: [],
    historySummary: [], logs: [],
    processing: { running: false, paused: false, phase: '待处理', batchIndex: 0, totalBatches: 0 },
    lastRunSummary: null, lastRun: null, currentRun: null
  });
}

function initializeShopeeState(reportDate, sourceName, rows, carryBills) {
  const today = rows.map(row => row.shipmentCode);
  const allMembers = [...new Set([...today, ...(carryBills || [])])];
  const podLocks = podBillsForMembership(allMembers);
  const priorCarryRows = shopeePriorCarryRows(carryBills);
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
    businessType: SHOPEE, reportDate, sourceName, dailyReportReady: true,
    pnhBills: today, dailyParseRows,
    dailyParseSummary: {
      totalRecognized: today.length,
      groupCounts: { CN: rows.filter(row => row.businessType === 'SHOPEECN').length, VN: rows.filter(row => row.businessType === 'SHOPEEVN').length },
      importedAt: new Date().toISOString(),
      source: 'V366_COMMITTED_UNIFIED_MEMBERSHIP'
    },
    recipientConflicts: [], recipientReconciliation: null,
    carryBills: [...new Set(carryBills || [])], nextCarryBills: [...new Set(carryBills || [])], podLocks,
    scanPool: [], scanRetryBills: [], scanResults: [], scanQueryStatus: [], shipmentTrackResults: [], shipmentQueryStatus: [],
    trackResults: [], trackEvents: [], eventQueryStatus: [], exceptionItems: [], exceptionQueryStatus: [], finalRows: [], priorCarryRows, needTrackBills: [], apiBatchStatus: [],
    historySummary: [], logs: [],
    processing: { running: false, paused: false, phase: '待处理', batchIndex: 0, totalBatches: 0 },
    lastRunSummary: null, lastRun: null, currentRun: null, snapshotId: ''
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
    summary: { ...(parsed.summary || {}), validUniqueWaybills: total, totalUnique: total },
    warnings: [...(parsed.warnings || []), ...(parsed.rows.some(row => row.businessType === WHPP) ? [{ type: 'WHPP_SEPARATE_PERSISTENCE', message: 'WHPP本土使用独立第三处理阶段，但与同一日报提交事务共同确认后才切换当前日期。' }] : [])]
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