import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
const { replayV281ArchivedReportDate } = await import('../src/v281ArchivedHistoricalReparse.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v281-fail-'));
try {
  const reportDate = '2026-08-18';
  const sourceRoot = path.join(temp, 'source_uploads');
  const monthRoot = path.join(sourceRoot, '2026-08');
  fs.mkdirSync(monthRoot, { recursive: true });

  const rawFile = path.join(temp, 'source.xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['运单号', '日报日期'],
    ['CC260818000001', reportDate],
    ['CE260818000002', reportDate],
    ['TBKH260818000003', reportDate]
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '日报');
  XLSX.writeFile(wb, rawFile);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(rawFile)).digest('hex');
  fs.copyFileSync(rawFile, path.join(monthRoot, `${hash}.xlsx`));

  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE unified_import_batches(batchId TEXT PRIMARY KEY,snapshotId TEXT,reportDate TEXT,sourceName TEXT,fileHash TEXT,status TEXT,summaryJson TEXT,warningsJson TEXT,createdAt TEXT,dateDetectionSource TEXT,dateCandidatesJson TEXT,dateWasManuallyCorrected INTEGER,regionCountsJson TEXT);
    CREATE TABLE unified_import_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT,snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT,recipientRaw TEXT,recipientNormalized TEXT,sheetName TEXT,rowNumber INTEGER,classificationReason TEXT,rowJson TEXT,createdAt TEXT,classificationSource TEXT,classificationMatchedValue TEXT,classificationWarning TEXT);
    CREATE TABLE shipment_daily_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,batchId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT,classificationSource TEXT,rowJson TEXT,createdAt TEXT);
    CREATE TABLE unified_snapshots(snapshotId TEXT PRIMARY KEY,batchId TEXT,reportDate TEXT,status TEXT,payloadJson TEXT,createdAt TEXT);
  `);
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson) VALUES(?,?,?,?,?,'VALID','{}','[]',?,'','[]',0,'{}')`)
    .run('BOLD18', 'SOLD18', reportDate, 'old.xlsx', hash, '2026-08-18T10:00:00Z');
  const oldRow = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  oldRow.run('BOLD18','SOLD18',reportDate,'CE','CC260818000001','PP','','','日报',2,'','{}','2026-08-18T10:00:00Z','','','');
  oldRow.run('BOLD18','SOLD18',reportDate,'WHPP','CE260818000002','PV','','','日报',3,'','{}','2026-08-18T10:00:00Z','','','');

  const badSave = async parsed => {
    const badBatch = 'BBAD18';
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson) VALUES(?,?,?,?,?,'VALID','{}','[]',?,'','[]',0,'{}')`)
      .run(badBatch, 'SBAD18', parsed.reportDate, 'bad-replay.xlsx', parsed.fileHash, '2026-08-24T08:30:00Z');
    const ins = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt,classificationSource,classificationMatchedValue,classificationWarning) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of parsed.rows) {
      ins.run(badBatch,'SBAD18',parsed.reportDate,row.businessType,row.shipmentCode,row.regionCode||'','','',row.sheetName||'日报',row.rowNumber||0,'','{}','2026-08-24T08:30:00Z','','','');
    }
    // Force post-save verification failure after a committed new VALID batch.
    return { batchId: badBatch, reportDate: parsed.reportDate, fileHash: 'b'.repeat(64) };
  };

  const result = await replayV281ArchivedReportDate(reportDate, { db, sourceRoot, saveFn: badSave, logger: { info(){}, warn(){}, error(){} } });
  assert.equal(result.ok, false);
  assert.equal(result.repaired, false);
  assert.equal(result.reason, 'REPLAY_SAVE_FAILED');
  assert.equal(result.rejectedNewBatchId, 'BBAD18');
  assert.equal(db.prepare('SELECT status FROM unified_import_batches WHERE batchId=?').get('BOLD18').status, 'VALID', 'old historical batch must be restored');
  assert.match(db.prepare('SELECT status FROM unified_import_batches WHERE batchId=?').get('BBAD18').status, /^INVALID_V281_FAILED:/, 'failed new batch must be invalidated before old batch is restored');
  assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM unified_import_batches WHERE reportDate=? AND status='VALID'").get(reportDate).count), 1, 'failure recovery must leave exactly one VALID batch');
  db.close();
  console.log('[V281] post-save verification failure recovery smoke passed · bad new batch invalidated · old VALID restored · exactly one VALID remains');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
