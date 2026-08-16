import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const patch = fs.readFileSync(new URL('../src/v163ShopeeDailyIsolationPatch.js', import.meta.url), 'utf8');
const boot = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');

test('V163 quarantines historical Shopee carry from current-day run and restores it afterwards', () => {
  assert.match(patch, /business_carry_bills/);
  assert.match(patch, /sourceDate/);
  assert.match(patch, /business_daily_parse_rows/);
  assert.match(patch, /closed_v163_daily_isolation/);
  assert.match(patch, /restoreToken/);
  assert.match(patch, /res\.once\('finish', restore\)/);
});

test('V163 detects and resets an already mixed Shopee runtime before a fresh start', () => {
  assert.match(patch, /scanRows > expected \|\| scanPool > expected/);
  assert.match(patch, /resetMixedRuntime/);
  for (const table of [
    'business_run_checkpoints',
    'business_api_batches',
    'business_scan_results',
    'business_shipment_tracks',
    'business_track_events',
    'business_exception_items',
    'business_final_rows'
  ]) assert.match(patch, new RegExp(table));
  assert.match(patch, /DELETE FROM \$\{table\}/);
  assert.match(patch, /DELETE FROM business_run_locks/);
  assert.match(patch, /req\.path === '\/api\/shopee\/run\/start'/);
});

test('V163 loads before V33 and the existing pipeline still exposes the old combined-carry bug it guards', () => {
  const v163 = boot.indexOf('v163ShopeeDailyIsolationPatch');
  const v33 = boot.indexOf('v33RunProgressPatch');
  assert.ok(v163 >= 0, 'V163 must be loaded');
  assert.ok(v33 > v163, 'V163 must load before route registration');
  assert.match(pipeline, /scanPool = cleanAnyBills\(\[\.\.\.today, \.\.\.carry\]\)/);
});
