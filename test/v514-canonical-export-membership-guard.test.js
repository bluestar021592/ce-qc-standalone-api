import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v514-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'v514.db');

const { closeDb, getDb } = await import('../src/db.js');
const { assertV514CanonicalExportMembership, V514_CANONICAL_EXPORT_MEMBERSHIP_GUARD_ID } = await import('../src/v514CanonicalExportMembershipGuard.js');

function reset() {
  const db = getDb();
  db.exec('DELETE FROM unified_import_rows; DELETE FROM unified_import_batches;');
  try { db.exec('DELETE FROM shipment_daily_snapshots;'); } catch {}
  return db;
}

function addBatch({ date = '2026-09-14', batchId = 'B1', snapshotId = 'S1', createdAt = '2026-09-14T01:00:00.000Z' } = {}) {
  getDb().prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt)
    VALUES(?,?,?,?,?,'VALID','{}','[]',?)`).run(batchId, snapshotId, date, 'daily.xlsx', `${batchId}-hash`, createdAt);
}

function addSource({ date = '2026-09-14', batchId = 'B1', snapshotId = 'S1', type = 'CE', bill } = {}) {
  getDb().prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
    VALUES(?,?,?,?,?,'PP','','','sheet',1,'test','{}',?)`).run(batchId, snapshotId, date, type, bill, new Date().toISOString());
}

const exportRow = (bill, date = '2026-09-14') => ({ shipmentCode: bill, businessType: 'CE', reportMembershipDate: date, dailyMembershipDates: [date] });

test('exact canonical date+waybill membership passes', () => {
  reset();
  addBatch();
  addSource({ bill: 'CC100001' });
  addSource({ bill: 'CC100002' });
  const result = assertV514CanonicalExportMembership({
    businessType: 'CE',
    range: { from: '2026-09-14', to: '2026-09-14' },
    rows: [exportRow('CC100001'), exportRow('CC100002')]
  });
  assert.equal(result.id, V514_CANONICAL_EXPORT_MEMBERSHIP_GUARD_ID);
  assert.equal(result.authoritativeDays, 1);
  assert.equal(result.sourceMembers, 2);
  assert.equal(result.exportMembersOnAuthoritativeDays, 2);
  assert.equal(result.passed, true);
});

test('same-count member substitution fails instead of passing a count-only export', () => {
  reset();
  addBatch();
  addSource({ bill: 'CC100001' });
  addSource({ bill: 'CC100002' });
  assert.throws(
    () => assertV514CanonicalExportMembership({
      businessType: 'CE',
      range: { from: '2026-09-14', to: '2026-09-14' },
      rows: [exportRow('CC100001'), exportRow('CC999999')]
    }),
    error => error?.code === 'V514_CANONICAL_EXPORT_MEMBERSHIP_MISMATCH'
      && error?.diagnostics?.missingFromExport?.includes('2026-09-14|CC100002')
      && error?.diagnostics?.unexpectedInExport?.includes('2026-09-14|CC999999')
  );
});

test('authoritative zero-member business date blocks stale legacy export rows', () => {
  reset();
  addBatch();
  addSource({ type: 'CE', bill: 'CC100001' });
  assert.throws(
    () => assertV514CanonicalExportMembership({
      businessType: 'CEAF',
      range: { from: '2026-09-14', to: '2026-09-14' },
      rows: [{ shipmentCode: 'AIR-STALE-001', businessType: 'CEAF', reportMembershipDate: '2026-09-14' }]
    }),
    error => error?.code === 'V514_CANONICAL_EXPORT_MEMBERSHIP_MISMATCH'
      && error?.diagnostics?.sourceMembers === 0
      && error?.diagnostics?.unexpectedInExport?.includes('2026-09-14|AIR-STALE-001')
  );
});

test('missing canonical member fails even when export has fewer rows without duplicates', () => {
  reset();
  addBatch();
  addSource({ bill: 'CC100001' });
  addSource({ bill: 'CC100002' });
  assert.throws(
    () => assertV514CanonicalExportMembership({
      businessType: 'CE',
      range: { from: '2026-09-14', to: '2026-09-14' },
      rows: [exportRow('CC100001')]
    }),
    error => error?.code === 'V514_CANONICAL_EXPORT_MEMBERSHIP_MISMATCH'
      && error?.diagnostics?.missingFromExport?.includes('2026-09-14|CC100002')
  );
});

test('dates without a VALID unified source remain legacy-compatible', () => {
  reset();
  const result = assertV514CanonicalExportMembership({
    businessType: 'CE',
    range: { from: '2026-01-01', to: '2026-01-01' },
    rows: [{ shipmentCode: 'CCLEGACY001', businessType: 'CE', reportMembershipDate: '2026-01-01' }]
  });
  assert.equal(result.authoritativeDays, 0);
  assert.equal(result.legacyOnly, true);
  assert.equal(result.passed, true);
});

test('latest VALID batch of a date is authoritative when an older same-date batch exists', () => {
  reset();
  addBatch({ batchId: 'OLD', snapshotId: 'S-OLD', createdAt: '2026-09-14T00:00:00.000Z' });
  addSource({ batchId: 'OLD', snapshotId: 'S-OLD', bill: 'CCOLD001' });
  addBatch({ batchId: 'NEW', snapshotId: 'S-NEW', createdAt: '2026-09-14T02:00:00.000Z' });
  addSource({ batchId: 'NEW', snapshotId: 'S-NEW', bill: 'CCNEW001' });
  const result = assertV514CanonicalExportMembership({
    businessType: 'CE',
    range: { from: '2026-09-14', to: '2026-09-14' },
    rows: [exportRow('CCNEW001')]
  });
  assert.equal(result.passed, true);
  assert.equal(result.sourceMembers, 1);
  assert.deepEqual(result.missingFromExport, []);
  assert.deepEqual(result.unexpectedInExport, []);
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
