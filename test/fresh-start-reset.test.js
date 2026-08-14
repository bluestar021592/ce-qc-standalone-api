import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

test('go-live fresh start clears business history but preserves schema and verified backup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-fresh-start-'));
  process.env.DATA_DIR = dir;
  process.env.DB_FILE = path.join(dir, 'fresh-start.db');

  const { getDb, closeDb } = await import('../src/db.js');
  const { createPurgeChallenge, executePurge, PURGE_PHRASE } = await import('../src/dataPurge.js');
  const db = getDb();

  try {
    db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-08-01');
    db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,fileHash,status,summaryJson,warningsJson,createdAt)
      VALUES('fresh-batch','fresh-snapshot','2026-08-01','hash','VALID','{}','[]','2026-08-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,rowJson,createdAt)
      VALUES('fresh-batch','fresh-snapshot','2026-08-01','CE','CC-FRESH-1','{}','2026-08-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO shipment_daily_snapshots(snapshotId,batchId,reportDate,businessType,shipmentCode,rowJson,createdAt)
      VALUES('fresh-snapshot','fresh-batch','2026-08-01','CE','CC-FRESH-1','{}','2026-08-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,stateJson,updatedAt)
      VALUES('CC-FRESH-1','CE','2026-08-01','fresh-snapshot','PENDING','{}','2026-08-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,stateJson,createdAt,updatedAt)
      VALUES('CC-FRESH-1','CE','2026-08-01','2026-08-01','fresh-snapshot','fresh-snapshot','OPEN','{}','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES
      ('carry_refresh_last_success_at','2026-08-01T02:00:00.000Z','2026-08-01T02:00:00.000Z'),
      ('carry_refresh_last_rollover_date','2026-08-01','2026-08-01T02:00:00.000Z'),
      ('carry_refresh_last_error','old refresh error','2026-08-01T02:00:00.000Z'),
      ('dashboard_cache_worker_active','stale-worker','2026-08-01T02:00:00.000Z'),
      ('dashboard_cache_worker_active_until','1','2026-08-01T02:00:00.000Z')`).run();

    const schemaBefore = Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value || 0);
    const userVersionBefore = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
    assert.equal(schemaBefore, 18);
    assert.equal(userVersionBefore, 18);

    const challenge = await createPurgeChallenge({ email: 'fresh-start-admin' });
    assert.equal(challenge.backup.integrity, 'ok');
    assert.ok(fs.existsSync(challenge.backup.path));
    const blockUntil = Number(db.prepare("SELECT value FROM app_meta WHERE key='data_purge_block_until'").get()?.value || 0);
    assert.ok(blockUntil > Date.now(), 'purge challenge must block automatic carry/cache maintenance while backup/confirmation is active');
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(challenge.backup.path), 'manifest.json'), 'utf8'));
    assert.equal(manifest.migrationVersion, 18);

    await new Promise(resolve => setTimeout(resolve, 5100));
    const result = await executePurge({
      challengeId: challenge.challengeId,
      phrase: PURGE_PHRASE,
      backupConfirmed: true,
      user: { email: 'fresh-start-admin' }
    });

    for (const table of ['daily_reports', 'unified_import_batches', 'unified_import_rows', 'shipment_daily_snapshots', 'shipment_current_state', 'carryover_open_items']) {
      assert.equal(Number(result.after[table] || 0), 0, `${table} should be empty after fresh start`);
    }
    assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key='db_schema_version'").get()?.value || 0), 18);
    assert.equal(Number(db.prepare('PRAGMA user_version').get()?.user_version || 0), 18);
    assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM app_meta WHERE key LIKE 'carry_refresh_%'").get()?.count || 0), 0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM app_meta WHERE key IN ('data_purge_block_until','dashboard_cache_worker_active','dashboard_cache_worker_active_until')").get()?.count || 0), 0);
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    assert.ok(db.prepare("SELECT value FROM app_meta WHERE key='last_full_clear_at'").get()?.value);
    assert.ok(Number(db.prepare('SELECT COUNT(*) count FROM backup_records').get()?.count || 0) >= 1);
  } finally {
    // Windows keeps the SQLite database/WAL files locked while DatabaseSync is open.
    // Close the shared handle before removing the isolated temp directory so cleanup
    // itself never turns a successful fresh-start verification into a false failure.
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.DB_FILE;
  }
});
