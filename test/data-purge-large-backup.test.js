import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashFileStream } from '../src/dataPurge.js';

test('backup primitives support a sparse file larger than 2 GiB without whole-file Buffer reads', async () => {
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
  const { createPurgeChallenge, executePurge, PURGE_PHRASE } = await import('../src/dataPurge.js');
  const db = getDb();
  db.prepare('INSERT INTO daily_reports(reportDate) VALUES(?)').run('2026-08-05');
  const challenge = await createPurgeChallenge({ email: 'test-admin' });
  await new Promise(resolve => setTimeout(resolve, 5100));
  const result = await executePurge({ challengeId: challenge.challengeId, phrase: PURGE_PHRASE, backupConfirmed: true, user: { email: 'test-admin' } });
  assert.ok(result.before.daily_reports >= 1);
  assert.equal(result.after.daily_reports, 0);
  assert.equal(result.integrity, 'ok');
  assert.equal(result.walCheckpoint, 'TRUNCATE');
  assert.ok(db.prepare('SELECT COUNT(*) count FROM backup_records').get().count >= 1);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});
