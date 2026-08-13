import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const patchUrl = new URL('../src/v94UnifiedImportDisplayTruthPatch.js', import.meta.url);
const patch = fs.readFileSync(patchUrl, 'utf8');
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/v94-business-source-truth-ui-v2.js', import.meta.url), 'utf8');

test('V94 unified import display patch and UI are syntax-valid', () => {
  for (const url of [patchUrl, new URL('../public/v94-business-source-truth-ui-v2.js', import.meta.url)]) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test('unified import response is reconciled to canonical CEAF/WHPP dashboard counts without rewriting source rows', () => {
  assert.match(patch, /ROUTE = '\/api\/import\/unified-daily-report'/);
  assert.match(patch, /inspectV90FastDashboard/);
  assert.match(patch, /classificationCounts:/);
  assert.match(patch, /canonicalClassificationCounts/);
  assert.match(patch, /V94_CANONICAL_POST_CLASSIFICATION/);
  assert.doesNotMatch(patch, /DELETE\s+FROM|UPDATE\s+unified_|INSERT\s+INTO\s+unified_|DROP\s+TABLE/i);
});

test('bootstrap loads canonical import display patch before server registration', () => {
  const display = bootstrap.indexOf('v94UnifiedImportDisplayTruthPatch');
  const server = bootstrap.indexOf("importPhase('server'");
  assert.ok(display >= 0 && server > display);
});

test('browser-side import screen also re-syncs existing immutable snapshots to canonical counts', () => {
  assert.match(ui, /V94_CANONICAL_POST_CLASSIFICATION/);
  assert.match(ui, /classificationCounts/);
  assert.match(ui, /\/api\/v89\/instant-dashboard/);
});
