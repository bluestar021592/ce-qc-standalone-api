import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../src/migrations.js';

const root = path.resolve('data/codex_ui_track_crossday/migration_rollback');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
const dbFile = path.join(root, 'rollback_fixture.db');
const db = new DatabaseSync(dbFile);
db.exec(`
  PRAGMA user_version=8;
  CREATE TABLE app_state(key TEXT PRIMARY KEY,valueJson TEXT NOT NULL,updatedAt TEXT);
  INSERT INTO app_state VALUES('main','{"reportDate":"2026-07-01","marker":"OLD_DATA"}','2026-07-01T00:00:00Z');
  CREATE VIEW business_shipment_tracks AS SELECT 'COLLISION' AS shipmentCode;
`);
let errorMessage = '';
try { migrateDatabase(db, { dbFile, backupsDir: path.join(root, 'backups') }); }
catch (error) { errorMessage = error.message; }
const version = db.prepare('PRAGMA user_version').get().user_version;
const oldData = db.prepare("SELECT valueJson FROM app_state WHERE key='main'").get().valueJson;
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
db.close();
const backup = fs.readdirSync(path.join(root, 'backups')).find(name => name.endsWith('.db')) || '';
assert(errorMessage.includes('已回滚'));
assert.equal(version, 8);
assert(oldData.includes('OLD_DATA'));
assert.equal(integrity, 'ok');
assert(backup);
const backupDb = new DatabaseSync(path.join(root, 'backups', backup), { readOnly: true });
assert.equal(backupDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
backupDb.close();
const result = { ok: true, fromVersion: 8, targetVersion: 9, rolledBack: true, oldDataPreserved: true, integrity, backup: path.join(root, 'backups', backup), errorMessage };
const out = path.resolve('data/codex_ui_track_crossday/migration_rollback_results.json');
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, reportFile: out }, null, 2));
