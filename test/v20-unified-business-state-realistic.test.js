import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// This regression uses the real unified store with an isolated SQLite file. It proves
// that one exact unified snapshot returns five non-empty business slices immediately
// after import, before scan/track processing exists.
test('exact unified snapshot hydrates all five imported business slices before processing', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v20-'));
  process.env.DATA_DIR = temp;
  process.env.DB_FILE = path.join(temp, 'v20.db');

  const [{ getDb, closeDb }, store] = await Promise.all([
    import('../src/db.js'),
    import('../src/unifiedImportStore.js')
  ]);
  const db = getDb();
  const now = new Date().toISOString();
  const batchId = 'v20-batch';
  const snapshotId = 'v20-snapshot';
  const reportDate = '2026-07-26';
  const rows = [
    ['CE001', 'CE', 'PP'],
    ['TB001', 'TBKH', 'PV'],
    ['AL001', 'ALI1688', 'PP'],
    ['CN001', 'SHOPEECN', 'PP'],
    ['VN001', 'SHOPEEVN', 'PV']
  ];

  db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)`)
    .run(snapshotId, batchId, reportDate, 'IMPORTED', '{}', now);
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,dateDetectionSource,dateCandidatesJson,dateWasManuallyCorrected,regionCountsJson,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(batchId, snapshotId, reportDate, 'fixture.xlsx', 'fixture-hash', 'VALID', 'MANUAL', '[]', 0, JSON.stringify({ PP: 3, PV: 2 }), JSON.stringify({ validUniqueWaybills: 5 }), '[]', now);

  const insert = db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [shipmentCode, businessType, regionCode] of rows) {
    insert.run(batchId, snapshotId, reportDate, businessType, shipmentCode, regionCode, businessType, businessType, 'Fixture', 1, 'TEST', JSON.stringify({ shipmentCode }), now);
  }

  for (const type of ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']) {
    const state = store.loadUnifiedBusinessState(type, snapshotId);
    assert.equal(state.reportDate, reportDate);
    assert.equal(state.snapshotId, snapshotId);
    assert.equal(state.businessType, type);
    assert.equal(state.pnhBills.length, 1);
    assert.equal(state.dailyParseRows.length, 1);
    assert.equal(state.pnhBills[0], rows.find(row => row[1] === type)[0]);
  }

  closeDb();
});
