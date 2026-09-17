import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'src', 'db.js'), 'utf8');

test('V553 bootstrap no longer forces the degraded 32MiB/0/FILE SQLite profile', () => {
  assert.doesNotMatch(bootstrap, /process\.env\.SQLITE_CACHE_KIB\s*=\s*['"]32768['"]/);
  assert.doesNotMatch(bootstrap, /process\.env\.SQLITE_MMAP_BYTES\s*=\s*['"]0['"]/);
  assert.doesNotMatch(bootstrap, /process\.env\.SQLITE_TEMP_STORE\s*=\s*['"]FILE['"]/);
  assert.match(bootstrap, /v553-aug22-main-sqlite-profile-v1/);
});

test('V553 keeps the Aug22 main-process SQLite defaults in db.js', () => {
  assert.match(db, /IS_EXPORT_WORKER\s*\?\s*8\s*\*\s*1024\s*:\s*64\s*\*\s*1024/);
  assert.match(db, /IS_EXPORT_WORKER\s*\?\s*0\s*:\s*256\s*\*\s*1024\s*\*\s*1024/);
  assert.match(db, /IS_EXPORT_WORKER\s*\?\s*['"]FILE['"]\s*:\s*['"]MEMORY['"]/);
});

test('V553 keeps export-worker resource isolation instead of globally applying main defaults', () => {
  assert.match(db, /CE_QC_EXPORT_WORKER_MODE/);
  assert.match(db, /SINGLE_BUSINESS_DIRECT/);
  assert.match(db, /ALL_BUSINESS_ORCHESTRATOR/);
  assert.match(db, /PRAGMA cache_size/);
  assert.match(db, /PRAGMA temp_store/);
  assert.match(db, /PRAGMA mmap_size/);
});

test('V553 preserves current no-data-rewrite recovery guards and main-service-first startup', () => {
  assert.match(bootstrap, /CE_QC_RECOVERY_SAFE_MODE\s*=\s*['"]1['"]/);
  assert.match(bootstrap, /CE_QC_DISABLE_STARTUP_STORAGE_SCAN\s*=\s*['"]1['"]/);
  assert.match(bootstrap, /await importServerInteractiveFirst\(\);[\s\S]*?scheduleExportSidecar\(\);[\s\S]*?schedulePostServerRepair\(v167Repair\);/);
});
