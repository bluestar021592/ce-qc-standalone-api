import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';
import { getDb, getRuntimeConfig, nowIso } from './db.js';
import { parseUnifiedDailyExcel } from './unifiedExcelParser.js';

export const V281_ARCHIVED_HISTORICAL_REPARSE_ID = '2026-08-24-v282-archive-replay-column-bound-census-v4';
export const V281_PRIORITY_REPORT_DATE = '2026-08-17';
const CELL_ADDRESS_RE = /^[A-Z]{1,3}[1-9]\d*$/;
const WAYBILL_CELL_RE = /^(?:TBKH|SPE|CC|CE)[A-Z0-9]{8,}$/;
const SHIPMENT_HEADERS = [
  '运单号', '运单编号', '单号', '面单号', '快递单号', '物流单号',
  'waybill', 'waybillno', 'waybillnumber', 'trackingno', 'trackingnumber', 'shipmentcode'
];
const normBill = value => String(value ?? '').normalize('NFKC').trim().toUpperCase().replace(/[\s-]+/g, '');
const normalizeHeader = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, '');
const normalizedShipmentHeaders = SHIPMENT_HEADERS.map(normalizeHeader);

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

function buildHeaderRows(sheet = {}) {
  const rows = Array.from({ length: 30 }, () => []);
  for (const [address, cell] of Object.entries(sheet || {})) {
    if (!CELL_ADDRESS_RE.test(address)) continue;
    const decoded = XLSX.utils.decode_cell(address);
    if (!Number.isFinite(decoded?.r) || !Number.isFinite(decoded?.c) || decoded.r >= 30) continue;
    const value = meaningfulCellValue(cell);
    if (!String(value).trim()) continue;
    rows[decoded.r][decoded.c] = value;
  }
  for (const range of sheet['!merges'] || []) {
    if (range.s.r >= 30) continue;
    const source = rows[range.s.r]?.[range.s.c];
    if (!String(source ?? '').trim()) continue;
    for (let r = range.s.r; r <= Math.min(range.e.r, 29); r += 1) {
      rows[r] ||= [];
      for (let c = range.s.c; c <= range.e.c; c += 1) if (!String(rows[r][c] ?? '').trim()) rows[r][c] = source;
    }
  }
  return rows;
}

function findShipmentBinding(sheet = {}) {
  const rows = buildHeaderRows(sheet);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const headers = (rows[rowIndex] || []).map(normalizeHeader);
    let columnIndex = -1;
    for (const alias of normalizedShipmentHeaders) {
      columnIndex = headers.findIndex(header => header === alias);
      if (columnIndex >= 0) break;
    }
    if (columnIndex < 0) continue;
    let hasWaybillBelow = false;
    for (const [address, cell] of Object.entries(sheet || {})) {
      if (!CELL_ADDRESS_RE.test(address)) continue;
      const decoded = XLSX.utils.decode_cell(address);
      if (decoded.c !== columnIndex || decoded.r <= rowIndex || decoded.r > rowIndex + 80) continue;
      if (WAYBILL_CELL_RE.test(normBill(meaningfulCellValue(cell)))) { hasWaybillBelow = true; break; }
    }
    if (hasWaybillBelow) return { headerRow: rowIndex, columnIndex, header: String(rows[rowIndex]?.[columnIndex] || '') };
  }
  return null;
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
  const diagnosticBills = new Set();
  const sheets = [];
  let ignoredOffColumnCount = 0;
  for (const sheetName of workbook.SheetNames) {
    const meta = workbook.Workbook?.Sheets?.find(item => item.name === sheetName);
    if (Number(meta?.Hidden || 0) > 0) continue;
    const sheet = workbook.Sheets[sheetName] || {};
    const binding = findShipmentBinding(sheet);
    const local = new Set();
    const broad = new Set();
    let scannedCells = 0;
    for (const [address, cell] of Object.entries(sheet)) {
      if (!CELL_ADDRESS_RE.test(address)) continue;
      const value = meaningfulCellValue(cell);
      if (!String(value).trim()) continue;
      scannedCells += 1;
      const bill = normBill(value);
      if (!WAYBILL_CELL_RE.test(bill)) continue;
      diagnosticBills.add(bill);
      broad.add(bill);
      const decoded = XLSX.utils.decode_cell(address);
      if (!binding || decoded.c !== binding.columnIndex || decoded.r <= binding.headerRow) continue;
      bills.add(bill);
      local.add(bill);
    }
    const ignored = [...broad].filter(bill => !local.has(bill));
    ignoredOffColumnCount += ignored.length;
    sheets.push({
      sheetName,
      waybillCandidates: local.size,
      allCellWaybillCandidates: broad.size,
      ignoredOffColumnCandidates: ignored.length,
      ignoredOffColumnSamples: ignored.slice(0, 20),
      shipmentHeader: binding?.header || '',
      shipmentHeaderRow: binding ? binding.headerRow + 1 : null,
      shipmentColumn: binding ? XLSX.utils.encode_col(binding.columnIndex) : '',
      scannedCells,
      originalRef: String(sheet['!ref'] || '')
    });
  }
  return {
    count: bills.size,
    bills: [...bills].sort(),
    diagnosticCount: diagnosticBills.size,
    diagnosticBills: [...diagnosticBills].sort(),
    ignoredOffColumnCount,
    sheets
  };
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
    sourceDiagnosticCount: Number(census?.diagnosticCount || 0),
    ignoredOffColumnCount: Number(census?.ignoredOffColumnCount || 0),
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

export function saveV281HistoricalImport(parsed, sourceName, db = getDb()) {
  if (!parsed?.sourceReconciliation?.balanced) throw new Error('V281 historical replay classification reconciliation failed');
  const batchId = `BATCH-${crypto.randomUUID()}`;
  const snapshotId = `SNAP-${crypto.randomUUID()}`;
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
    rows: parsed.rows,
    historicalReplay: { id: V281_ARCHIVED_HISTORICAL_REPARSE_ID, currentStatePreserved: true }
  };
  const existingValid = Number(db.prepare("SELECT COUNT(*) count FROM unified_import_batches WHERE reportDate=? AND status='VALID'").get(parsed.reportDate)?.count || 0);
  if (existingValid > 0) throw new Error(`V281 historical replay expected zero VALID batches after pending transition, found ${existingValid}`);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson) VALUES(?,?,?,?,?,'VALID',?,?,?,?,?,?,?)`)
      .run(batchId, snapshotId, parsed.reportDate, sourceName, parsed.fileHash, JSON.stringify(parsed.summary || {}), JSON.stringify(parsed.warnings || []), createdAt, parsed.dateDetectionSource || '', JSON.stringify(parsed.dateCandidates || []), parsed.dateWasManuallyCorrected ? 1 : 0, JSON.stringify(parsed.regionCounts || {}));
    const insertRow = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertDaily = db.prepare(`INSERT INTO shipment_daily_snapshots(snapshotId,batchId,reportDate,businessType,shipmentCode,regionCode,classificationSource,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const row of parsed.rows || []) {
      const rowJson = JSON.stringify(row);
      insertRow.run(batchId, snapshotId, parsed.reportDate, row.businessType, row.shipmentCode, row.regionCode, row.recipientRaw, row.recipientNormalized, row.sheetName, row.rowNumber, row.classificationReason, rowJson, createdAt, row.classificationSource || '', row.classificationMatchedValue || '', row.classificationWarning || '');
      insertDaily.run(snapshotId, batchId, parsed.reportDate, row.businessType, row.shipmentCode, row.regionCode, row.classificationSource || '', rowJson, createdAt);
    }
    db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,'IMPORTED',?,?)`)
      .run(snapshotId, batchId, parsed.reportDate, JSON.stringify(payload), createdAt);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return {
    batchId,
    snapshotId,
    reportDate: parsed.reportDate,
    fileHash: parsed.fileHash,
    classificationCounts: parsed.classificationCounts,
    sourceReconciliation: parsed.sourceReconciliation,
    regionCounts: parsed.regionCounts,
    summary: parsed.summary,
    warnings: parsed.warnings,
    historicalReplay: true,
    currentStatePreserved: true
  };
}

export async function replayV281ArchivedReportDate(reportDate, options = {}) {
  const db = options.db || getDb();
  const saveFn = options.saveFn || ((parsed, sourceName) => saveV281HistoricalImport(parsed, sourceName, db));
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
  logger.info?.('[CE-QC][V282_ARCHIVE_REPLAY_CHECK]', JSON.stringify({ reportDate, batchId: batch.batchId, archivePath, censusMs, parseMs, ...assessment, sheets: census.sheets }));
  if (!assessment.ok) {
    return { ok: false, skipped: true, reason: 'SAFETY_CHECK_FAILED', reportDate, batchId: batch.batchId, censusMs, parseMs, ...assessment };
  }
  if (assessment.difference <= 0) {
    try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
    const result = { ok: true, skipped: true, reason: 'NO_RECOVERED_ROWS', reportDate, batchId: batch.batchId, trendsRefreshed: true, censusMs, parseMs, ...assessment };
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

  let saved = null;
  try {
    const saveStarted = Date.now();
    saved = await saveFn(parsed, `V281_ARCHIVE_REPLAY_${reportDate}_${path.basename(archivePath)}`);
    const saveMs = Date.now() - saveStarted;
    const newCount = Number(db.prepare('SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=?').get(saved.batchId)?.count || 0);
    if (!saved?.batchId || String(saved.reportDate || '') !== reportDate || String(saved.fileHash || '').toLowerCase() !== String(batch.fileHash).toLowerCase() || newCount !== assessment.parsedCount) {
      throw new Error(`V281 replay post-save verification failed: newCount=${newCount}, expected=${assessment.parsedCount}`);
    }
    const superseded = db.prepare('UPDATE unified_import_batches SET status=? WHERE batchId=? AND status=?').run(`SUPERSEDED_V281:${saved.batchId}`, batch.batchId, pending).changes;
    if (!superseded) throw new Error('V281 replay could not finalize old historical batch status');
    try { globalThis.__CE_QC_REFRESH_V274_TRENDS__?.(); } catch {}
    const result = { ok: true, repaired: true, reportDate, oldBatchId: batch.batchId, newBatchId: saved.batchId, fileHash: batch.fileHash, previousCount: assessment.previousCount, newCount, recovered: newCount - assessment.previousCount, currentStatePreserved: true, censusMs, parseMs, saveMs, durationMs: Date.now() - startedAt };
    logger.info?.('[CE-QC][V281_ARCHIVE_REPLAY_REPAIRED]', JSON.stringify(result));
    return result;
  } catch (error) {
    if (saved?.batchId) {
      try {
        db.prepare("UPDATE unified_import_batches SET status=? WHERE batchId=? AND status='VALID'")
          .run(`INVALID_V281_FAILED:${batch.batchId}`, saved.batchId);
      } catch {}
    }
    try { db.prepare("UPDATE unified_import_batches SET status='VALID' WHERE batchId=? AND status=?").run(batch.batchId, pending); } catch {}
    const result = { ok: false, repaired: false, reason: 'REPLAY_SAVE_FAILED', reportDate, batchId: batch.batchId, rejectedNewBatchId: saved?.batchId || '', error: error?.message || String(error), durationMs: Date.now() - startedAt };
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
console.info('[CE-QC][V281_ARCHIVE_REPLAY]', V281_ARCHIVED_HISTORICAL_REPARSE_ID, `priority=${V281_PRIORITY_REPORT_DATE}`, 'V282 exact same-file-hash archive replay; blocking census is bound to recognized shipment columns while all-cell candidates remain diagnostics; historical tables only; current/carry state never written.');