import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('same report date history returns newest VALID batch rather than superseded completed batch', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v20-history-'));
  process.env.DATA_DIR = temp;
  process.env.DB_FILE = path.join(temp, 'history.db');
  const [{ getDb, closeDb }, store] = await Promise.all([
    import('../src/db.js'),
    import('../src/unifiedImportStore.js')
  ]);
  const db = getDb();
  const date = '2026-07-26';
  const older = '2026-08-07T01:00:00.000Z';
  const newer = '2026-08-07T02:00:00.000Z';

  db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)`)
    .run('old-snapshot', 'old-batch', date, 'COMPLETED', '{}', older);
  db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)`)
    .run('new-snapshot', 'new-batch', date, 'IMPORTED', '{}', newer);

  const insertBatch = db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)`);
  insertBatch.run('old-batch', 'old-snapshot', date, 'old.xlsx', 'old-hash', 'SUPERSEDED', JSON.stringify({ validUniqueWaybills: 99 }), '[]', older);
  insertBatch.run('new-batch', 'new-snapshot', date, 'new.xlsx', 'new-hash', 'VALID', JSON.stringify({ validUniqueWaybills: 5 }), '[]', newer);

  const history = store.listUnifiedImportHistory(10);
  assert.equal(history.length, 1);
  assert.equal(history[0].batchId, 'new-batch');
  assert.equal(history[0].snapshotId, 'new-snapshot');
  assert.equal(history[0].summary.validUniqueWaybills, 5);
  closeDb();
});
