import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('dynamic carry protects return-in-progress and cancellation outcomes',()=>{
  const source=read('src/carryoverRefreshScheduler.js');
  assert.match(source,/KEEP_OPEN_UNTIL_RETURN_86/);
  assert.match(source,/ORDER_CANCELLED/);
  assert.match(source,/CLOSE_CANCELLED/);
});

test('full purge remains exclusive and normal migrations remain non-destructive',()=>{
  const purge=read('src/dataPurge.js');
  const migration=read('src/migrations.js');
  assert.match(purge,/data_purge_block_until/);
  assert.match(purge,/waitForBackgroundMaintenanceIdle/);
  assert.doesNotMatch(migration,/\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration,/\bDELETE\s+FROM\b/i);
  assert.match(migration,/backupDbFile\(db, cfg\)/);
  assert.match(migration,/ROLLBACK/);
});

test('managed launcher uses explicit argument-list parameters and fail-safe startup',()=>{
  const launcher=read('tools/CE_QC_Managed_Launcher.ps1');
  assert.doesNotMatch(launcher,/\[string\[\]\]\s*\$Args\b/i);
  assert.doesNotMatch(launcher,/@Args\b/i);
  assert.match(launcher,/\$ArgumentList/);
  assert.match(launcher,/\$GitArguments/);
  assert.match(launcher,/current installed version/);
});
