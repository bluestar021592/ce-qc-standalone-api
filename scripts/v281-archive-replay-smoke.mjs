import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
const {
  V281_ARCHIVED_HISTORICAL_REPARSE_ID,
  findV281ArchivedSourceByHash,
  parseV281ArchivedSparse,
  readV281SparseWaybillCensus,
  assessV281Replay,
  replayV281ArchivedReportDate
} = await import('../src/v281ArchivedHistoricalReparse.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v281-'));
try {
  const reportDate = '2026-08-17';
  const sourceRoot = path.join(temp, 'source_uploads');
  const monthRoot = path.join(sourceRoot, '2026-08');
  fs.mkdirSync(monthRoot, { recursive: true });

  const rawFile = path.join(temp, 'source.xlsx');
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['运单号', '日报日期', '备注/关联单号'],
    ['CC260817000001', reportDate, 'CE999999999999'],
    ['CE260817000002', reportDate, ''],
    ['TBKH260817000003', reportDate, '']
  ]);
  // Simulate a workbook whose declared used range is much larger than the real
  // populated cells. The extra CE... value is intentionally outside the shipment
  // column and must remain diagnostic evidence only, never a blocking source bill.
  sheet['!ref'] = 'A1:Z5000';
  XLSX.utils.book_append_sheet(workbook, sheet, '日报');
  XLSX.writeFile(workbook, rawFile);

  const bytes = fs.readFileSync(rawFile);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const archivedFile = path.join(monthRoot, `${hash}.xlsx`);
  fs.copyFileSync(rawFile, archivedFile);

  const found = await findV281ArchivedSourceByHash(sourceRoot, hash);
  assert.equal(found, archivedFile, 'V281 must locate the exact same-hash archived source');

  const census = readV281SparseWaybillCensus(found);
  assert.equal(census.count, 3, 'blocking census must count exactly the three shipment-column waybills');
  assert.equal(census.diagnosticCount, 4, 'all-cell diagnostics must still retain the off-column CE-like reference');
  assert.equal(census.ignoredOffColumnCount, 1, 'one off-column waybill-like reference must be explicitly diagnosed');
  assert.equal(census.sheets[0]?.shipmentColumn, 'A');
  const parsed = parseV281ArchivedSparse(found, reportDate);
  assert.equal(parsed.reportDate, reportDate);
  assert.equal(parsed.fileHash, hash);
  assert.equal(parsed.summary.validUniqueWaybills, 3);
  assert.equal(parsed.sourceReconciliation.balanced, true);

  const safe = assessV281Replay({
    reportDate,
    fileHash: hash,
    previousBills: ['CC260817000001', 'CE260817000002'],
    parsed,
    census
  });
  assert.equal(safe.ok, true);
  assert.equal(safe.difference, 1);
  assert.equal(safe.sourceDiagnosticCount, 4);
  assert.equal(safe.ignoredOffColumnCount, 1);

  const unsafe = assessV281Replay({
    reportDate,
    fileHash: hash,
    previousBills: ['CC260817000001', 'CE260817000002', 'CC260817009999'],
    parsed,
    census
  });
  assert.equal(unsafe.ok, false, 'V281 must reject a replay that loses any previous member');
  assert.equal(unsafe.missingPreviousCount, 1);

  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE unified_import_batches(
      batchId TEXT PRIMARY KEY,
      snapshotId TEXT,
      reportDate TEXT,
      sourceName TEXT,
      fileHash TEXT,
      status TEXT,
      summaryJson TEXT,
      warningsJson TEXT,
      createdAt TEXT,
      dateDetectionSource TEXT,
      dateCandidatesJson TEXT,
      dateWasManuallyCorrected INTEGER,
      regionCountsJson TEXT
    );
    CREATE TABLE unified_import_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId TEXT,
      snapshotId TEXT,
      reportDate TEXT,
      businessType TEXT,
      shipmentCode TEXT,
      regionCode TEXT,
      recipientRaw TEXT,
      recipientNormalized TEXT,
      sheetName TEXT,
      rowNumber INTEGER,
      classificationReason TEXT,
      rowJson TEXT,
      createdAt TEXT,
      classificationSource TEXT,
      classificationMatchedValue TEXT,
      classificationWarning TEXT
    );
    CREATE TABLE shipment_daily_snapshots(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshotId TEXT,
      batchId TEXT,
      reportDate TEXT,
      businessType TEXT,
      shipmentCode TEXT,
      regionCode TEXT,
      classificationSource TEXT,
      rowJson TEXT,
      createdAt TEXT
    );
    CREATE TABLE unified_snapshots(
      snapshotId TEXT PRIMARY KEY,
      batchId TEXT,
      reportDate TEXT,
      status TEXT,
      payloadJson TEXT,
      createdAt TEXT
    );
    CREATE TABLE shipment_current_state(
      shipmentCode TEXT PRIMARY KEY,
      businessType TEXT,
      reportDate TEXT,
      state TEXT,
      stateJson TEXT,
      updatedAt TEXT
    );
    CREATE TABLE carryover_open_items(
      shipmentCode TEXT PRIMARY KEY,
      businessType TEXT,
      sourceReportDate TEXT,
      lastReportDate TEXT,
      status TEXT,
      stateJson TEXT,
      updatedAt TEXT
    );
  `);

  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson)
    VALUES(?,?,?,?,?,'VALID','{}','[]',?,'','[]',0,'{}')`)
    .run('BOLD', 'SOLD', reportDate, 'old-2026-08-17.xlsx', hash, '2026-08-17T10:00:00Z');
  const oldRow = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  oldRow.run('BOLD', 'SOLD', reportDate, 'CE', 'CC260817000001', 'PP', '', '', '日报', 2, '', '{}', '2026-08-17T10:00:00Z', '', '', '');
  oldRow.run('BOLD', 'SOLD', reportDate, 'WHPP', 'CE260817000002', 'PV', '', '', '日报', 3, '', '{}', '2026-08-17T10:00:00Z', '', '', '');

  db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,state,stateJson,updatedAt) VALUES(?,?,?,?,?,?)`)
    .run('CC260817000001', 'CE', '2026-08-21', 'POD', '{"marker":"CURRENT_0821"}', '2026-08-21T20:00:00Z');
  db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,status,stateJson,updatedAt) VALUES(?,?,?,?,?,?,?)`)
    .run('CE260817000002', 'WHPP', reportDate, '2026-08-21', 'CLOSED', '{"marker":"CARRY_0821"}', '2026-08-21T20:00:00Z');
  const currentBefore = JSON.stringify(db.prepare('SELECT * FROM shipment_current_state ORDER BY shipmentCode').all());
  const carryBefore = JSON.stringify(db.prepare('SELECT * FROM carryover_open_items ORDER BY shipmentCode').all());

  const logs = [];
  const logger = {
    info: (...args) => logs.push(['info', ...args]),
    warn: (...args) => logs.push(['warn', ...args]),
    error: (...args) => logs.push(['error', ...args])
  };
  const repaired = await replayV281ArchivedReportDate(reportDate, { db, sourceRoot, logger });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.previousCount, 2);
  assert.equal(repaired.newCount, 3);
  assert.equal(repaired.recovered, 1);
  assert.equal(repaired.currentStatePreserved, true);

  const oldStatus = String(db.prepare('SELECT status FROM unified_import_batches WHERE batchId=?').get('BOLD')?.status || '');
  assert.match(oldStatus, /^SUPERSEDED_V281:/);
  const newBatch = db.prepare("SELECT batchId,status FROM unified_import_batches WHERE reportDate=? AND status='VALID'").get(reportDate);
  assert.ok(newBatch?.batchId && newBatch.batchId !== 'BOLD', 'new historical replay batch must become the sole VALID batch');
  assert.equal(newBatch.status, 'VALID');
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=?').get(newBatch.batchId)?.count || 0), 3);
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM shipment_daily_snapshots WHERE batchId=?').get(newBatch.batchId)?.count || 0), 3);
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM unified_snapshots WHERE batchId=?').get(newBatch.batchId)?.count || 0), 1);

  assert.equal(JSON.stringify(db.prepare('SELECT * FROM shipment_current_state ORDER BY shipmentCode').all()), currentBefore,
    'historical replay must not mutate shipment_current_state');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM carryover_open_items ORDER BY shipmentCode').all()), carryBefore,
    'historical replay must not mutate carryover_open_items');
  assert.ok(logs.some(row => String(row.join(' ')).includes('V281_ARCHIVE_REPLAY_REPAIRED')));
  db.close();

  console.log(`[V282] column-bound historical replay smoke passed · ${V281_ARCHIVED_HISTORICAL_REPARSE_ID} · real=3 diagnostic=4 offColumn=1 · recovered 1 row · current/carry unchanged`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
