import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runAtomicUnifiedImportWithDbV366 } from '../src/v366AtomicUnifiedImport.js';

function responseCapture() {
  let sent = null;
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = Number(code || 200); return this; },
    json(payload) { sent = { statusCode: this.statusCode, payload }; return this; }
  };
  return { res, read: () => sent };
}

const db = new DatabaseSync(':memory:');
try {
  db.exec(`
    CREATE TABLE official_day(reportDate TEXT PRIMARY KEY, status TEXT NOT NULL, total INTEGER NOT NULL);
    CREATE TABLE staged_batch(batchId TEXT PRIMARY KEY, reportDate TEXT NOT NULL, status TEXT NOT NULL);
    INSERT INTO official_day(reportDate,status,total) VALUES('2026-08-15','VALID',5266);
  `);

  const out = responseCapture();
  await runAtomicUnifiedImportWithDbV366(async (_req, res) => {
    db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO staged_batch(batchId,reportDate,status) VALUES('B-0816','2026-08-16','STAGING:B-0816')").run();
    db.exec('COMMIT');
    db.prepare("UPDATE staged_batch SET status='FAILED_STAGING:B-0816' WHERE batchId='B-0816'").run();
    res.status(400).json({ ok: false, code: 'SYNTHETIC_0816_FAILURE', error: 'synthetic target-day failure' });
  }, {}, out.res, () => {}, db, { useGlobalLock: false });

  const prior = db.prepare("SELECT reportDate,status,total FROM official_day WHERE reportDate='2026-08-15'").get();
  const targetRows = Number(db.prepare("SELECT COUNT(*) count FROM staged_batch WHERE reportDate='2026-08-16'").get()?.count || 0);
  assert.equal(prior?.reportDate, '2026-08-15', 'failed 08-16 import must keep previous official reportDate');
  assert.equal(prior?.status, 'VALID', 'failed 08-16 import must keep previous official VALID status');
  assert.equal(Number(prior?.total || 0), 5266, 'failed 08-16 import must keep previous official 5266 total');
  assert.equal(targetRows, 0, 'failed target-day STAGING/FAILED_STAGING rows must be fully removed by the outer rollback');
  assert.equal(out.read()?.statusCode, 400, 'original explicit failure status must remain a failure after rollback');
  assert.equal(out.read()?.payload?.ok, false);

  const fakeSuccess = responseCapture();
  await runAtomicUnifiedImportWithDbV366(async (_req, res) => {
    db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO staged_batch(batchId,reportDate,status) VALUES('B-FAKE','2026-08-16','STAGING:B-FAKE')").run();
    db.exec('COMMIT');
    res.json({ ok: true, reportDate: '2026-08-16' });
  }, {}, fakeSuccess.res, () => {}, db, { useGlobalLock: false });
  assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM staged_batch WHERE batchId='B-FAKE'").get()?.count || 0), 0, 'missing commit acknowledgement must roll back every target-day staging row');
  assert.equal(fakeSuccess.read()?.statusCode, 500);
  assert.equal(fakeSuccess.read()?.payload?.code, 'ATOMIC_IMPORT_COMMIT_BLOCKED');
  assert.equal(db.prepare("SELECT total FROM official_day WHERE reportDate='2026-08-15'").get()?.total, 5266);

  console.log('[V369] failed staging rollback smoke passed · explicit 08-16 failure removes STAGING/FAILED_STAGING residue · fake success without importCommitted also rolls back · previous VALID 08-15/5266 remains untouched');
} finally {
  db.close();
}
