import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function identityKey(user = {}) {
  const identity = String(user.id || user.email || user.username || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

async function waitForStatus(statusFile, jobId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let status = null;
  while (Date.now() < deadline) {
    try { status = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch {}
    if (status?.jobId === jobId && ['SUCCEEDED', 'FAILED'].includes(String(status.status || '').toUpperCase())) return status;
    await wait(150);
  }
  return status;
}

test('V505 keeps a stale-heartbeat prepare job locked while its worker PID is still alive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v505-live-prepare-'));
  process.env.DATA_DIR = dir;
  process.env.DB_FILE = path.join(dir, 'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH = '1';
  const { getDb, getRuntimeConfig } = await import('../src/db.js');
  const { inspectLivePrepareJob } = await import('../src/v505PurgeCoordinator.js');
  getDb();
  const user = { email: 'stale-alive-admin' };
  const jobDir = path.join(getRuntimeConfig().backupsDir, '.purge_prepare_jobs');
  fs.mkdirSync(jobDir, { recursive: true });
  const jobFile = path.join(jobDir, `${identityKey(user)}.job.json`);
  const statusToken = crypto.randomBytes(24).toString('hex');
  const fake = {
    jobId: crypto.randomUUID(),
    statusToken,
    statusFile: path.join(getRuntimeConfig().projectRoot, 'public', 'purge-status', `${statusToken}.json`),
    status: 'RUNNING',
    email: user.email,
    submittedAt: Date.now() - 180_000,
    startedAt: Date.now() - 170_000,
    heartbeatAt: Date.now() - 120_000,
    workerPid: process.pid,
    updatedAt: Date.now() - 120_000
  };
  fs.writeFileSync(jobFile, JSON.stringify(fake), 'utf8');

  const inspected = inspectLivePrepareJob(user);
  assert.equal(inspected?.dead, false);
  assert.equal(inspected?.job?.jobId, fake.jobId);
  assert.equal(inspected?.payload?.jobId, fake.jobId);
  assert.equal(inspected?.payload?.workerState, 'ALIVE');
  assert.equal(inspected?.payload?.heartbeatStale, true);
  assert.match(inspected?.payload?.message || '', /保持锁定/);
  assert.match(inspected?.payload?.message || '', /不会启动第二份备份/);

  fs.rmSync(jobFile, { force: true });
});

test('V505 detached execute returns quickly, reuses one live job, and finishes transactional purge out of the HTTP process', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v505-execute-'));
  process.env.DATA_DIR = dir;
  process.env.DB_FILE = path.join(dir, 'test.db');
  process.env.CE_QC_DISABLE_CARRY_REFRESH = '1';
  const { getDb, getRuntimeConfig } = await import('../src/db.js');
  const { createPurgeChallenge, PURGE_PHRASE } = await import('../src/dataPurge.js');
  const { queuePurgeExecution, inspectExecutionRecovery, V505_PURGE_COORDINATOR_ID } = await import('../src/v505PurgeCoordinator.js');
  const db = getDb();
  const user = { email: 'execute-admin', username: 'execute-admin', role: 'ADMIN' };

  db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-09-09');
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,fileHash,status,summaryJson,warningsJson,createdAt)
    VALUES('batch-v505','snapshot-v505','2026-09-09','hash','IMPORTED','{}','[]','2026-09-09T00:00:00Z')`).run();
  db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,rowJson,createdAt)
    VALUES('batch-v505','snapshot-v505','2026-09-09','CE','CC-V505-1','{}','2026-09-09T00:00:00Z')`).run();
  db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,stateJson,updatedAt)
    VALUES('CC-V505-1','CE','2026-09-09','snapshot-v505','PENDING','{}','2026-09-09T00:00:00Z')`).run();

  const prepared = await createPurgeChallenge(user);
  assert.equal(prepared.status, 'QUEUED');
  const prepareStatusFile = path.join(getRuntimeConfig().projectRoot, 'public', prepared.statusUrl.replace(/^\//, ''));
  const prepareStatus = await waitForStatus(prepareStatusFile, prepared.jobId);
  assert.equal(prepareStatus?.status, 'SUCCEEDED', prepareStatus?.error || 'prepare worker did not finish');
  const challenge = await createPurgeChallenge(user);
  assert.equal(challenge.status, 'SUCCEEDED');
  assert.ok(challenge.challengeId);

  const delay = Math.max(0, new Date(challenge.notBefore).getTime() - Date.now());
  if (delay) await wait(delay + 100);

  const request = { challengeId: challenge.challengeId, phrase: PURGE_PHRASE, backupConfirmed: true };
  const submittedAt = Date.now();
  const first = await queuePurgeExecution(user, request);
  const submitElapsedMs = Date.now() - submittedAt;
  assert.ok(submitElapsedMs < 5000, `execute submission blocked for ${submitElapsedMs}ms`);
  assert.equal(first.async, true);
  assert.equal(first.kind, 'EXECUTE');
  assert.match(first.jobId, /^[0-9a-f-]{36}$/i);
  assert.match(first.statusUrl, /^\/purge-status\/[a-f0-9]{48}\.json$/i);
  assert.equal(first.coordinatorPatch, V505_PURGE_COORDINATOR_ID);

  const second = await queuePurgeExecution(user, request);
  assert.equal(second.jobId, first.jobId, 'duplicate execute submission must reuse the live worker');

  const executeStatusFile = path.join(getRuntimeConfig().projectRoot, 'public', first.statusUrl.replace(/^\//, ''));
  const executeStatus = await waitForStatus(executeStatusFile, first.jobId);
  assert.equal(executeStatus?.status, 'SUCCEEDED', executeStatus?.error || 'execute worker did not finish');

  const recovered = inspectExecutionRecovery(user);
  assert.equal(recovered?.status, 'SUCCEEDED');
  assert.equal(recovered?.jobId, first.jobId);
  assert.equal(recovered?.completed, true);
  assert.equal(recovered?.result?.countSource, 'DELETE_CHANGESET_EXACT');
  assert.equal(recovered?.result?.backupSourceFingerprint, 'MATCHED');
  assert.equal(recovered?.result?.integrity, 'ok');

  assert.equal(db.prepare('SELECT COUNT(*) count FROM daily_reports').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM unified_import_batches').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM unified_import_rows').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM shipment_current_state').get().count, 0);
  assert.ok(db.prepare('SELECT COUNT(*) count FROM backup_records').get().count >= 1);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value || 0), 18);
});
