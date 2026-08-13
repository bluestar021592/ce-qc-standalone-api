import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const file = new URL('../src/v42WhppPatch.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8');

test('V77 V42 route is syntax-valid and makes the fresh same-date import authoritative', () => {
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);

  assert.match(source, /2026-08-13-v77-fresh-import-authority/);
  assert.match(source, /2026-08-13-v77-ceaf-whpp-source-authority/);
  assert.match(source, /function invalidateMutableSameDatePointers/);

  for (const table of [
    'run_locks',
    'run_checkpoints',
    'history_summary',
    'business_run_locks',
    'business_run_checkpoints',
    'business_history_summary'
  ]) {
    assert.match(source, new RegExp(`DELETE FROM ${table}`));
  }

  // New same-date imports may invalidate mutable pointers, but immutable historical
  // snapshots must remain available for audit and rollback evidence.
  assert.doesNotMatch(source, /DELETE FROM business_export_snapshots/);
  assert.doesNotMatch(source, /DELETE FROM export_snapshots/);

  const saveWhpp = source.indexOf('const whppState = saveWhppDailyImport');
  const invalidate = source.indexOf('invalidateMutableSameDatePointers(parsed.reportDate)');
  const response = source.indexOf('res.json({', invalidate);
  assert.ok(saveWhpp >= 0, 'WHPP daily import must be persisted');
  assert.ok(invalidate > saveWhpp, 'stale pointers must be cleared only after fresh data is persisted');
  assert.ok(response > invalidate, 'the API must return only after stale pointers are cleared');
});

test('V77 keeps the V75 normalizer before V42 and V76 repair before server startup', () => {
  const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
  const v75 = bootstrap.indexOf('v75CeafUploadNormalizerPatch');
  const v42 = bootstrap.indexOf('v42WhppPatch');
  const v76 = bootstrap.indexOf('v76CurrentCeafSplitRepair');
  const server = bootstrap.indexOf("importPhase('server'");
  assert.ok(v75 >= 0 && v42 > v75, 'V75 must normalize the temporary workbook before V42 owns the route');
  assert.ok(v76 > v42, 'V76 current-data repair must load after route patches');
  assert.ok(server > v76, 'V76 repair must finish before the web server starts');
});
