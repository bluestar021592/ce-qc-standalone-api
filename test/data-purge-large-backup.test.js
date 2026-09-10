import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashFileStream } from '../src/dataPurge.js';

const RUN_LARGE_DURABILITY = String(process.env.CE_QC_RUN_LARGE_DURABILITY || '') === '1';

test('backup primitives support a sparse file larger than 2 GiB without whole-file Buffer reads', { skip: !RUN_LARGE_DURABILITY }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-large-backup-'));
  const source = path.join(dir, 'source.db');
  const backup = path.join(dir, 'backup.db');
  const size = 2 * 1024 * 1024 * 1024 + 4096;
  try {
    const handle = fs.openSync(source, 'w');
    fs.ftruncateSync(handle, size);
    fs.writeSync(handle, Buffer.from('SQLite format 3\0'), 0, 16, 0);
    fs.closeSync(handle);
    await fs.promises.copyFile(source, backup);
    assert.equal(fs.statSync(backup).size, size);
    const digest = await hashFileStream(backup);
    assert.match(digest, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verified backup gates transactional business purge and preserves system tables', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-purge-lifecycle-'));
  process.env.DATA_DIR = dir;
  process.env.DB_FILE = path.join(dir, 'test.db');
  const { getDb } = await import('../src/db.js');
  const { createPurgeChallenge, executePurge, resealPurgeChallenge, PURGE_PHRASE, V505_PURGE_RECOVERY_ID } = await import('../src/dataPurge.js');
  const db = getDb();
  db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-08-05');
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,fileHash,status,summaryJson,warningsJson,createdAt)
    VALUES('batch-1','snapshot-1','2026-08-05','hash','IMPORTED','{}','[]','2026-08-05T00:00:00Z')`).run();
  db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,rowJson,createdAt)
    VALUES('batch-1','snapshot-1','2026-08-05','CE','CC-TEST-1','{}','2026-08-05T00:00:00Z')`).run();
  db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,stateJson,updatedAt)
    VALUES('CC-TEST-1','CE','2026-08-05','snapshot-1','PENDING','{}','2026-08-05T00:00:00Z')`).run();
  db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,stateJson,createdAt,updatedAt)
    VALUES('CC-TEST-1','CE','2026-08-05','2026-08-05','snapshot-1','snapshot-1','OPEN','{}','2026-08-05T00:00:00Z','2026-08-05T00:00:00Z')`).run();
  const schemaBefore = Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value || 0);
  assert.equal(schemaBefore, 18);

  const challengePromise = createPurgeChallenge({ email: 'test-admin' });
  await assert.rejects(
    createPurgeChallenge({ email: 'test-admin' }),
    error => error?.code === 'PURGE_PREPARE_RUNNING' && /PURGE_PREPARE_RUNNING/.test(error.message)
  );
  const challenge = await challengePromise;
  assert.equal(challenge.counts, null);
  assert.equal(challenge.countMode, 'DEFERRED_TO_TRANSACTIONAL_DELETE');
  assert.equal(challenge.recoveryPatch, V505_PURGE_RECOVERY_ID);

  const recoveredChallenge = await createPurgeChallenge({ email: 'test-admin' });
  assert.equal(recoveredChallenge.challengeId, challenge.challengeId);
  assert.equal(recoveredChallenge.recovered, true);
  assert.equal(recoveredChallenge.recoveryPatch, V505_PURGE_RECOVERY_ID);

  const manifestPath = path.join(path.dirname(challenge.backup.path), 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.migrationVersion, 18);
  assert.equal(manifest.counts, null);
  assert.equal(manifest.countMode, 'DEFERRED_TO_TRANSACTIONAL_DELETE');
  assert.equal(manifest.sourceStableDuringBackup, true);
  assert.equal(manifest.recoveryPatch, V505_PURGE_RECOVERY_ID);

  db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('v124_test_retained_audit','1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(new Date().toISOString());
  const seal = resealPurgeChallenge(challenge.challengeId, { email: 'test-admin' });
  assert.equal(seal.sourceSeal, 'POST_PREPARE_AUDIT');

  await new Promise(resolve => setTimeout(resolve, 5100));
  const result = await executePurge({ challengeId: challenge.challengeId, phrase: PURGE_PHRASE, backupConfirmed: true, user: { email: 'test-admin' } });
  assert.ok(result.before.daily_reports >= 1);
  assert.equal(result.before.unified_import_rows, 1);
  assert.equal(result.before.shipment_current_state, 1);
  assert.equal(result.before.carryover_open_items, 1);
  assert.equal(result.after.daily_reports, 0);
  assert.equal(result.after.unified_import_batches, 0);
  assert.equal(result.after.unified_import_rows, 0);
  assert.equal(result.after.shipment_current_state, 0);
  assert.equal(result.after.carryover_open_items, 0);
  assert.equal(result.countSource, 'DELETE_CHANGESET_EXACT');
  assert.equal(result.backupSourceFingerprint, 'MATCHED');
  assert.equal(result.integrity, 'ok');
  assert.equal(result.integrityCheck, 'TRANSACTION_AND_SCHEMA');
  assert.equal(result.walCheckpoint, 'AUTO');
  assert.equal(result.deleteMode, 'FAST_TABLE_DELETE_FK_GUARDED');
  assert.equal(result.recoveryPatch, V505_PURGE_RECOVERY_ID);
  assert.ok(db.prepare('SELECT COUNT(*) count FROM backup_records').get().count >= 1);
  assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='v124_test_retained_audit'").get()?.value, '1');
  assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value || 0), 18);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});
