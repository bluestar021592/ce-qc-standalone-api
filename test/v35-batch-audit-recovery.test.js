import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/v28ResumeGuardPatch.js', import.meta.url), 'utf8');

test('SHOPEE batch audit recovery guards both start and resume', () => {
  assert.match(source, /\/api\/shopee\/run\/start/);
  assert.match(source, /\/api\/shopee\/run\/resume/);
  assert.match(source, /DELETE FROM business_api_batches WHERE businessType=\? AND reportDate=\? AND runId=\?/);
  assert.match(source, /\['failed', 'paused'\]/);
});

test('batch audit recovery preserves per-waybill checkpoints', () => {
  assert.match(source, /per-waybill\/event arrays/);
  assert.doesNotMatch(source, /DELETE FROM business_scan_results/);
  assert.doesNotMatch(source, /DELETE FROM business_track_events/);
  assert.doesNotMatch(source, /DELETE FROM business_exception_items/);
  assert.doesNotMatch(source, /DELETE FROM business_pod_locks/);
  assert.doesNotMatch(source, /DELETE FROM business_final_rows/);
});

test('batch audit recovery never serializes the fully hydrated state', () => {
  assert.doesNotMatch(source, /saveBusinessState\s*\(/);
  assert.doesNotMatch(source, /JSON\.stringify\s*\(\s*state\s*\)/);
  assert.match(source, /Invalid string length/);
});
