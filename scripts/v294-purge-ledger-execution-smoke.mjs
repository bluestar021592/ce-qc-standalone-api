import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v294-purge-'));
const dbFile = path.join(root, 'ce_qc_monitor.db');
const exportsDir = path.join(root, 'exports');
const importsDir = path.join(root, 'imports');
const longJsonExportsDir = path.join(root, 'long-json');
fs.mkdirSync(exportsDir, { recursive: true });
fs.mkdirSync(importsDir, { recursive: true });
fs.writeFileSync(path.join(exportsDir, 'old.xlsx'), 'old');
fs.writeFileSync(path.join(importsDir, 'old.xlsx'), 'old');

function statFingerprint(file) {
  try {
    const stat = fs.statSync(file);
    return { exists: true, size: Number(stat.size || 0), mtimeMs: Number(stat.mtimeMs || 0) };
  } catch {
    return { exists: false, size: 0, mtimeMs: 0 };
  }
}
function databaseFingerprint(file) {
  return { db: statFingerprint(file), wal: statFingerprint(`${file}-wal`) };
}

try {
  const db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode=DELETE;
    CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT,updatedAt TEXT);
    CREATE TABLE app_state(key TEXT PRIMARY KEY,valueJson TEXT,updatedAt TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,message TEXT);
    CREATE TABLE backup_records(id INTEGER PRIMARY KEY,path TEXT);
    CREATE TABLE qc_tracking_ledger(shipmentCode TEXT PRIMARY KEY,businessType TEXT,attemptNo INTEGER,signingDays INTEGER);
    CREATE TABLE qc_tracking_audit(id INTEGER PRIMARY KEY,shipmentCode TEXT,action TEXT);
    INSERT INTO app_meta VALUES('last_processed_report_date','2026-08-21','x');
    INSERT INTO app_state VALUES('current','{"reportDate":"2026-08-21"}','x');
    INSERT INTO users(name) VALUES('keep-user');
    INSERT INTO audit_logs(message) VALUES('keep-audit');
    INSERT INTO backup_records(path) VALUES('keep-backup');
    INSERT INTO qc_tracking_ledger VALUES('CCOLD12345678','TBKH',2,4);
    INSERT INTO qc_tracking_audit(shipmentCode,action) VALUES('CCOLD12345678','STRICT_ATTEMPT_EVIDENCE');
  `);
  db.close();

  const payload = {
    dbFile,
    exportsDir,
    importsDir,
    longJsonExportsDir,
    expectedFingerprint: databaseFingerprint(dbFile),
    nextState: { logs: [] }
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const worker = new URL('./CE_QC_PurgeDeleteWorker.mjs', import.meta.url);
  const run = spawnSync(process.execPath, [worker.pathname, encoded], {
    cwd: path.resolve(new URL('..', import.meta.url).pathname),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', DATA_DIR: root }
  });
  assert.equal(run.status, 0, `purge worker failed\nstdout=${run.stdout}\nstderr=${run.stderr}`);

  const verify = new DatabaseSync(dbFile);
  assert.equal(Number(verify.prepare('SELECT COUNT(*) count FROM qc_tracking_ledger').get().count), 0, 'old lifecycle ledger must be deleted');
  assert.equal(Number(verify.prepare('SELECT COUNT(*) count FROM qc_tracking_audit').get().count), 0, 'old lifecycle audit evidence must be deleted');
  assert.equal(Number(verify.prepare('SELECT COUNT(*) count FROM users').get().count), 1, 'users must be preserved');
  assert.equal(Number(verify.prepare('SELECT COUNT(*) count FROM audit_logs').get().count), 1, 'system audit log must be preserved');
  assert.equal(Number(verify.prepare('SELECT COUNT(*) count FROM backup_records').get().count), 1, 'backup records must be preserved');
  assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='last_processed_report_date'").get().value, '');
  assert.equal(verify.prepare("SELECT value FROM app_meta WHERE key='current_snapshot_id'").get().value, '');
  verify.close();
  assert.equal(fs.existsSync(path.join(exportsDir, 'old.xlsx')), false, 'generated exports must be cleared');
  assert.equal(fs.existsSync(path.join(importsDir, 'old.xlsx')), false, 'temporary imports must be cleared');

  console.log('[V294] purge execution smoke passed · temp database removes old qc_tracking ledger/audit while preserving users/system audit/backup records');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}
