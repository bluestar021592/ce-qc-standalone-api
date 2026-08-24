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
    ['运单号', '日报日期'],
    ['CC260817000001', reportDate],
    ['CE260817000002', reportDate],
    ['TBKH260817000003', reportDate]
  ]);
  // Simulate a workbook whose declared used range is much larger than the real
  // populated cells. V281 must still parse the actual three rows safely.
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
  assert.equal(census.count, 3, 'sparse source census must see exactly three real waybills');
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
      fileHash TEXT,
      reportDate TEXT,
      status TEXT,
      createdAt TEXT
    );
    CREATE TABLE unified_import_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId TEXT,
      shipmentCode TEXT
    );
  `);
  db.prepare('INSERT INTO unified_import_batches(batchId,fileHash,reportDate,status,createdAt) VALUES(?,?,?,?,?)')
    .run('BOLD', hash, reportDate, 'VALID', '2026-08-17T10:00:00Z');
  db.prepare('INSERT INTO unified_import_rows(batchId,shipmentCode) VALUES(?,?)').run('BOLD', 'CC260817000001');
  db.prepare('INSERT INTO unified_import_rows(batchId,shipmentCode) VALUES(?,?)').run('BOLD', 'CE260817000002');

  const saveFn = async parsedInput => {
    const batchId = 'BNEW';
    db.prepare('INSERT INTO unified_import_batches(batchId,fileHash,reportDate,status,createdAt) VALUES(?,?,?,?,?)')
      .run(batchId, parsedInput.fileHash, parsedInput.reportDate, 'VALID', '2026-08-24T08:00:00Z');
    const ins = db.prepare('INSERT INTO unified_import_rows(batchId,shipmentCode) VALUES(?,?)');
    for (const row of parsedInput.rows) ins.run(batchId, row.shipmentCode);
    return { batchId, reportDate: parsedInput.reportDate, fileHash: parsedInput.fileHash };
  };
  const logs = [];
  const logger = {
    info: (...args) => logs.push(['info', ...args]),
    warn: (...args) => logs.push(['warn', ...args]),
    error: (...args) => logs.push(['error', ...args])
  };
  const repaired = await replayV281ArchivedReportDate(reportDate, { db, sourceRoot, saveFn, logger });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.previousCount, 2);
  assert.equal(repaired.newCount, 3);
  assert.equal(repaired.recovered, 1);
  assert.match(String(db.prepare('SELECT status FROM unified_import_batches WHERE batchId=?').get('BOLD')?.status || ''), /^SUPERSEDED_V281:/);
  assert.equal(db.prepare('SELECT status FROM unified_import_batches WHERE batchId=?').get('BNEW')?.status, 'VALID');
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM unified_import_rows WHERE batchId=?').get('BNEW')?.count || 0), 3);
  assert.ok(logs.some(row => String(row.join(' ')).includes('V281_ARCHIVE_REPLAY_REPAIRED')));
  db.close();

  console.log(`[V281] archive same-hash replay smoke passed · ${V281_ARCHIVED_HISTORICAL_REPARSE_ID} · recovered 1 row without losing old membership`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
