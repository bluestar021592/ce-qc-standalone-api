import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';
import { getDb, getRuntimeConfig } from './db.js';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';
import { saveUnifiedImport } from './unifiedImportStore.js';

export const V281_ARCHIVED_HISTORICAL_REPARSE_ID = '2026-08-24-v281-archive-backed-same-hash-history-reparse-v1';
export const V281_PRIORITY_REPORT_DATE = '2026-08-17';
const CELL_ADDRESS_RE = /^[A-Z]{1,3}[1-9]\d*$/;
const WAYBILL_CELL_RE = /^(?:TBKH|SPE|CC|CE)[A-Z0-9]{8,}$/;
const normBill = value => String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/[\s-]+/g, '');

function meaningfulCellValue(cell) {
  if (!cell || typeof cell !== 'object') return '';
  if (cell.w !== undefined && cell.w !== null && String(cell.w).trim()) return cell.w;
  if (cell.v !== undefined && cell.v !== null && String(cell.v).trim()) return cell.v;
  if (cell.f !== undefined && cell.f !== null && String(cell.f).trim()) return cell.f;
  return '';
}

function sparseMeaningfulRange(sheet = {}) {
  let maxRow = -1;
  let maxColumn = -1;
  for (const [address, cell] of Object.entries(sheet || {})) {
    if (!CELL_ADDRESS_RE.test(address)) continue;
    if (!String(meaningfulCellValue(cell)).trim()) continue;
    const decoded = XLSX.utils.decode_cell(address);
    if (!Number.isFinite(decoded?.r) || !Number.isFinite(decoded?.c)) continue;
    maxRow = Math.max(maxRow, decoded.r);
    maxColumn = Math.max(maxColumn, decoded.c);
  }
  return maxRow >= 0 && maxColumn >= 0
    ? { s: { r: 0, c: 0 }, e: { r: maxRow, c: maxColumn } }
    : null;
}

export function parseV281ArchivedSparse(filePath, reportDate) {
  const original = XLSX.utils.sheet_to_json;
  XLSX.utils.sheet_to_json = function v281SparseSheetToJson(sheet, options = {}) {
    if (options?.range !== undefined && options?.range !== null) return original(sheet, options);
    const range = sparseMeaningfulRange(sheet);
    if (!range) return [];
    return original(sheet, { ...options, range });
  };
  try {
    return parseUnifiedDailyExcel(filePath, { reportDate, originalName: `${reportDate}.xlsx` });
  } finally {
    XLSX.utils.sheet_to_json = original;
  }
}

export function readV281SparseWaybillCensus(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false, dense: false });
  const bills = new Set();
  const sheets = [];
  for (const sheetName of workbook.SheetNames) {
    const meta = workbook.Workbook?.Sheets?.find(item => item.name === sheetName);
    if (Number(meta?.Hidden || 0) > 0) continue;
    const sheet = workbook.Sheets[sheetName] || {};
    const local = new Set();
    let scannedCells = 0;
    for (const [address, cell] of Object.entries(sheet)) {
      if (!CELL_ADDRESS_RE.test(address)) continue;
      const value = meaningfulCellValue(cell);
      if (!String(value).trim()) continue;
      scannedCells += 1;
      const bill = normBill(value);
      if (WAYBILL_CELL_RE.test(bill)) {
        bills.add(bill);
        local.add(bill);
      }
    }
    sheets.push({ sheetName, waybillCandidates: local.size, scannedCells, originalRef: String(sheet['!ref'] || '') });
  }
  return { count: bills.size, bills: [...bills].sort(), sheets };
}

export async function findV281ArchivedSourceByHash(sourceRoot, fileHash) {
  const hash = String(fileHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) return '';
  let months = [];
  try { months = await fsPromises.readdir(sourceRoot, { withFileTypes: true }); } catch { return ''; }
  months = months.filter(entry => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name));
  for (const month of months) {
    for (const ext of ['.xlsx', '.xls']) {
      const candidate = path.join(sourceRoot, month.name, `${hash}${ext}`);
      try {
        const stat = await fsPromises.stat(candidate);
        if (stat.isFile()) return candidate;
      } catch {}
    }
  }
  return '';
}

export function assessV281Replay({ reportDate, fileHash, previousBills = [], parsed, census }) {
  const parsedBills = new Set((parsed?.rows || []).map(row => normBill(row?.shipmentCode)).filter(Boolean));
  const previous = [...new Set((previousBills || []).map(normBill).filter(Boolean))];
  const censusBills = [...new Set((census?.bills || []).map(normBill).filter(Boolean))];
  const missingPrevious = previous.filter(bill => !parsedBills.has(bill));
  const missingFromParse = censusBills.filter(bill => !parsedBills.has(bill));
  const parsedCount = parsedBills.size;
  const previousCount = previous.length;
  const sameDate = String(parsed?.reportDate || '') === String(reportDate || '');
  const sameHash = String(parsed?.fileHash || '').toLowerCase() === String(fileHash || '').toLowerCase();
  const balanced = Boolean(parsed?.sourceReconciliation?.balanced);
  const ok = sameDate && sameHash && balanced && missingPrevious.length === 0 && missingFromParse.length === 0 && parsedCount >= previousCount;
  return {
    ok,
    sameDate,
    sameHash,
    balanced,
    parsedCount,
    previousCount,
    difference: parsedCount - previousCount,
    missingPreviousCount: missingPrevious.length,
    missingPreviousBills: missingPrevious.slice(0, 50),
    sourceCensusCount: Number(census?.count || censusBills.length || 0),
    sourceMissingCount: missingFromParse.length,
    sourceMissingBills: missingFromParse.slice(0, 50)
  };
}

function latestValidBatch(db, reportDate) {
  return db.prepare("SELECT batchId,fileHash,createdAt FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(reportDate);
}

function batchBills(db, batchId) {
  return db.prepare("SELECT UPPER(TRIM(shipmentCode)) shipmentCode FROM unified_import_rows WHERE batchId=? AND TRIM(COALESCE(shipmentCode,''))<>'' ORDER BY shipmentCode")
    .all(batchId).map(row => String(row.shipmentCode || ''));
}

function recoverPending(db, reportDate) {
  const pendingRows = db.prepare("SELECT batchId,fileHash,status FROM unified_import_batches WHERE reportDate=? AND status LIKE 'V281_REPARSE_PENDING:%'").all(reportDate);
  for (const row of pendingRows) {
    const replacement = db.prepare("SELECT batchId FROM unified_import_batches WHERE reportDate=? AND fileHash=? AND status='VALID' AND batchId<>? ORDER BY createdAt DESC LIMIT 1").get(reportDate, row.fileHash, row.batchId);
    if (replacement) db.prepare('UPDATE unified_import_batches SET status=? WHERE batchId=?').run(`SUPERSEDED_V281:${replacement.batchId}`, row.batchId);
    else db.prepare("UPDATE unified_import_batches SET status='VALID' WHERE batchId=?").run(row.batchId);
  }
}

export async function replayV281ArchivedReportDate(reportDate, options = {}) {
  const db = options.db || getDb();
  const saveFn = options.saveFn || saveUnifiedImport;
  const sourceRoot = options.sourceRoot || path.join(getRuntimeConfig().dataDir, 'evidence_archive', 'source_uploads');
  const logger = options.logger || console;
  const startedAt = Date.now();
  recoverPending(db, reportDate);
  const batch = latestValidBatch(db, reportDate);
  if (!batch?.batchId || !batch?.fileHash) {
    const result = { ok: false, skipped: true, reason: 'NO_VALID_BATCH_WITH_FILE_HASH', reportDate };
    logger.info?.('[CE-QC][V281_ARCHIVE_REPLAY]', JSON.stringify(result));
    return result;
  }
  const previousBills = batchBills(db, batch.batchId);
  const archivePath = await findV281ArchivedSourceByHash(sourceRoot, batch.fileHash);
  if (!archivePath) {
    const result = { ok: false, skipped: true, reason: 'ARCHIVED_SOURCE_NOT_FOUND', reportDate, batchId: batch.batchId, fileHash: batch.fileHash, previousCount: previousBills.length };
    logger.info?.('[CE-QC][V281_ARCHIVE_REPLAY]', JSON.stringify(result));
    return result;
  }

  const censusStarted = Date.now();
  const census = readV281SparseWaybillCensus(archivePath);
  const censusMs = Date.now() - censusStarted;
  const parseStarted = Date.now();
  const parsed = parseV281ArchivedSparse(archivePath, reportDate);
  const parseMs = Date.now() - parseStarted;
  const assessment = assessV281Replay({ reportDate, fileHash: batch.fileHash, previousBills, parsed, census });
  logger.info?.('[CE-QC][V281_ARCHIVE_REPLAY_CHECK]', JSON.stringify({ reportDate, batchId: batch.batchId, archivePath, censusMs, parseMs, ...assessment }));
  if (!assessment.ok) {
    return { ok: false, skipped: true, reason: 'SAFETY_CHECK_FAILED', reportDate, batchId: batch.batchId, censusMs, parseMs, ...assessment };
  }
  if (assessment.difference <= 0) {
    const result = { ok: true, skipped: true, reason: 'NO_RECOVERED_ROWS', reportDate, batchId: batch.batchId, censusMs, parseMs, ...assessment };
    logger.info?.('[CE-QC][V281_ARCHIVE_REPLAY]', JSON.stringify(result));
    return result;
  }

  const pending = `V281_REPARSE_PENDING:${batch.batchId}`;
  const changed = db.prepare("UPDATE unified_import_batches SET status=? WHERE batchId=? AND status='VALID'").run(pending, batch.batchId).changes;
  if (!changed) {
    const result = { ok: false, skipped: true, reason: 'BATCH_STATUS_CHANGED', reportDate, batchId: batch.batchId };
    logger.warn?.('[CE-QC][V281_ARCHIVE_REPLAY]', JSON.stringify(result));
    return result;
  }

  try {
    const saveStarted = Date.now();
    const saved = await saveFn(parsed, `V281_ARCHIVE_REPLAY_${reportDate}_${path.basename(archivePath)}`);
    const saveMs = Date.now() - saveStarted;
    const newCount = Number(db.prepare('SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=?').get(saved.batchId)?.count || 0);
    if (!saved?.batchId || String(saved.reportDate || '') !== reportDate || String(saved.fileHash || '').toLowerCase() !== String(batch.fileHash).toLowerCase() || newCount !== assessment.parsedCount) {
      throw new Error(`V281 replay post-save verification failed: newCount=${newCount}, expected=${assessment.parsedCount}`);
    }
    db.prepare('UPDATE unified_import_batches SET status=? WHERE batchId=? AND status=?').run(`SUPERSEDED_V281:${saved.batchId}`, batch.batchId, pending);
    try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
    const result = { ok: true, repaired: true, reportDate, oldBatchId: batch.batchId, newBatchId: saved.batchId, fileHash: batch.fileHash, previousCount: assessment.previousCount, newCount, recovered: newCount - assessment.previousCount, censusMs, parseMs, saveMs, durationMs: Date.now() - startedAt };
    logger.info?.('[CE-QC][V281_ARCHIVE_REPLAY_REPAIRED]', JSON.stringify(result));
    return result;
  } catch (error) {
    try { db.prepare("UPDATE unified_import_batches SET status='VALID' WHERE batchId=? AND status=?").run(batch.batchId, pending); } catch {}
    const result = { ok: false, repaired: false, reason: 'REPLAY_SAVE_FAILED', reportDate, batchId: batch.batchId, error: error?.message || String(error), durationMs: Date.now() - startedAt };
    logger.error?.('[CE-QC][V281_ARCHIVE_REPLAY_FAILED]', JSON.stringify(result));
    return result;
  }
}

function schedulePriorityReplay() {
  if (process.env.NODE_ENV === 'test' || process.env.CI) return;
  const timer = setTimeout(() => {
    void replayV281ArchivedReportDate(V281_PRIORITY_REPORT_DATE).catch(error => {
      console.error('[CE-QC][V281_ARCHIVE_REPLAY_FATAL]', JSON.stringify({ reportDate: V281_PRIORITY_REPORT_DATE, error: error?.message || String(error) }));
    });
  }, 8_000);
  timer.unref?.();
}

schedulePriorityReplay();
console.info('[CE-QC][V281_ARCHIVE_REPLAY]', V281_ARCHIVED_HISTORICAL_REPARSE_ID, `priority=${V281_PRIORITY_REPORT_DATE}`, 'same-file-hash archive replay is allowed only when old membership is a full subset, source census is complete, classification is balanced, and row count never shrinks.');
