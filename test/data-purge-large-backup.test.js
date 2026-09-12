import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashFileStream } from '../src/dataPurge.js';

const RUN_LARGE_DURABILITY = String(process.env.CE_QC_RUN_LARGE_DURABILITY || '') === '1';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const PUBLIC_STATUS_PRIVATE_KEYS = ['email','user','payload','backup','databasePath','challengeId','statusToken','statusFile'];

function identityKey(value=''){
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex').slice(0,24);
}

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

test('purge prepare returns immediately, reuses one detached task, then gates transactional purge with the exact backup-bound source fingerprint', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-purge-lifecycle-'));
  process.env.DATA_DIR = dir;
  process.env.DB_FILE = path.join(dir, 'test.db');
  const { getDb, getRuntimeConfig } = await import('../src/db.js');
  const { createPurgeChallenge, executePurge, PURGE_PHRASE, V505_PURGE_RECOVERY_ID } = await import('../src/dataPurge.js');
  const db = getDb();
  const adminEmail='test-admin';
  db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-08-05');
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,fileHash,status,summaryJson,warningsJson,createdAt)
    VALUES('batch-1','snapshot-1','2026-08-05','hash','IMPORTED','{}','[]','2026-08-05T00:00:00Z')`).run();
  db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,rowJson,createdAt)
    VALUES('batch-1','snapshot-1','2026-08-05','CE','CC-TEST-1','{}','2026-08-05T00:00:00Z')`).run();
  db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,stateJson,updatedAt)
    VALUES('CC-TEST-1','CE','2026-08-05','snapshot-1','PENDING','{}','2026-08-05T00:00:00Z')`).run();
  db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,stateJson,createdAt,updatedAt)
    VALUES('CC-TEST-1','CE','2026-08-05','2026-08-05','snapshot-1','snapshot-1','OPEN','{}','2026-08-05T00:00:00Z','2026-08-05T00:00:00Z')`).run();
  const meta = db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
  meta.run('carry_refresh_regression_probe','stale','2026-08-05T00:00:00Z');
  meta.run('v246_daily_0200_regression_probe','stale','2026-08-05T00:00:00Z');
  const schemaBefore = Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value || 0);
  assert.equal(schemaBefore, 18);

  const submittedAt = Date.now();
  const first = await createPurgeChallenge({ email: adminEmail });
  const submitElapsedMs = Date.now() - submittedAt;
  assert.ok(submitElapsedMs < 5000, `prepare submission blocked for ${submitElapsedMs}ms`);
  assert.equal(first.status, 'QUEUED');
  assert.match(first.jobId, /^[0-9a-f-]{36}$/i);
  assert.match(first.statusUrl, /^\/purge-status\/[a-f0-9]{48}\.json$/i);
  assert.equal(first.recoveryPatch, V505_PURGE_RECOVERY_ID);
  assert.match(first.backup.path, /^PENDING:/);

  const second = await createPurgeChallenge({ email: adminEmail });
  assert.equal(second.jobId, first.jobId);
  assert.ok(['QUEUED', 'RUNNING'].includes(second.status));

  const statusFile = path.join(getRuntimeConfig().projectRoot, 'public', first.statusUrl.replace(/^\//, ''));
  let status = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { status = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch {}
    if (status?.status === 'SUCCEEDED' || status?.status === 'FAILED') break;
    await wait(200);
  }
  assert.equal(status?.jobId, first.jobId);
  assert.equal(status?.status, 'SUCCEEDED', status?.error || 'background purge preparation did not complete');
  for (const key of PUBLIC_STATUS_PRIVATE_KEYS) assert.equal(Object.hasOwn(status || {}, key), false, `public prepare status must not expose ${key}`);

  const challenge = await createPurgeChallenge({ email: adminEmail });
  assert.equal(challenge.status, 'SUCCEEDED');
  assert.equal(challenge.jobId, first.jobId);
  assert.ok(challenge.challengeId);
  assert.equal(challenge.counts, null);
  assert.equal(challenge.countMode, 'DEFERRED_TO_TRANSACTIONAL_DELETE');
  assert.equal(challenge.recoveryPatch, V505_PURGE_RECOVERY_ID);

  const manifestPath = path.join(path.dirname(challenge.backup.path), 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.migrationVersion, 18);
  assert.equal(manifest.counts, null);
  assert.equal(manifest.countMode, 'DEFERRED_TO_TRANSACTIONAL_DELETE');
  assert.equal(manifest.sourceStableDuringBackup, true);
  assert.equal(manifest.sourceFingerprintGate, 'BACKUP_WORKER_BEGIN_IMMEDIATE');
  assert.equal(manifest.backupRecordMode, 'DEFERRED_UNTIL_POST_COMMIT_FINALIZE');
  assert.ok(manifest.sourceFingerprint?.db,'verified manifest must persist the DB+WAL source fingerprint captured by the isolated backup worker');
  assert.equal(manifest.recoveryPatch, V505_PURGE_RECOVERY_ID);
  assert.equal(manifest.prepareJobId, first.jobId);

  const challengeFile=path.join(getRuntimeConfig().backupsDir,'.purge_prepare_jobs',`${identityKey(adminEmail)}.challenge.json`);
  const persistedChallenge=JSON.parse(fs.readFileSync(challengeFile,'utf8'));
  assert.deepEqual(persistedChallenge.challenge?.sourceFingerprint,manifest.sourceFingerprint,'destructive challenge must use the exact fingerprint sealed by the verified backup worker, not a later reseal');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM backup_records WHERE filePath=? AND reason='before-full-clear'").get(challenge.backup.path).count,0,'backup catalog write must be deferred because any DB write after the physical backup would invalidate the backup-bound fingerprint');

  const waitMs = Math.max(0, new Date(challenge.notBefore).getTime() - Date.now());
  if (waitMs) await wait(waitMs + 100);
  const executeJobId=crypto.randomUUID();
  const result = await executePurge({ challengeId: challenge.challengeId, phrase: PURGE_PHRASE, backupConfirmed: true, user: { email: adminEmail }, executeJobId });
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
  assert.equal(result.backupSourceFingerprint, 'MATCHED_UNDER_BEGIN_IMMEDIATE');
  assert.equal(result.integrity, 'ok');
  assert.equal(result.integrityCheck, 'TRANSACTION_AND_SCHEMA');
  assert.equal(result.walCheckpoint, 'AUTO');
  assert.equal(result.deleteMode, 'FAST_TABLE_DELETE_FK_GUARDED');
  assert.equal(result.recoveryPatch, V505_PURGE_RECOVERY_ID);
  assert.equal(result.executeJobId,executeJobId);
  assert.match(String(result.finalizedAt||''),/^\d{4}-\d{2}-\d{2}T/);
  assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='carry_refresh_regression_probe'").get(), undefined, 'runtime carry metadata must be removed by the same destructive SQLite transaction');
  assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='v246_daily_0200_regression_probe'").get(), undefined, 'daily runtime metadata must be removed by the same destructive SQLite transaction');
  assert.ok(db.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get()?.value, 'transaction must persist the full-clear completion marker');
  assert.ok(db.prepare("SELECT COUNT(*) count FROM backup_records WHERE filePath=? AND reason='before-full-clear'").get(challenge.backup.path).count >= 1,'backup catalog row must be written only after destructive COMMIT and post-commit invariants succeed');
  assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value || 0), 18);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(fs.existsSync(statusFile), false);
});
