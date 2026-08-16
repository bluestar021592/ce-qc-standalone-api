import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const syntax = file => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding:'utf8' });
  assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
};

const progress = read('src/v33RunProgressPatch.js');
const truth = read('public/v140-current-business-truth.js');
const cache = read('src/dashboardCacheWorker.js');
const injector = read('src/v44WhppUiPatch.js');

test('V149 hot-path files are syntax valid', () => {
  for (const file of ['src/v33RunProgressPatch.js','public/v140-current-business-truth.js','src/dashboardCacheWorker.js','src/v44WhppUiPatch.js']) syntax(file);
});

test('V149 live progress never hydrates full CCSL or SHOPEE business state', () => {
  assert.match(progress, /v149-tiny-run-progress-compat-v1/);
  assert.match(progress, /FROM run_locks/);
  assert.match(progress, /FROM run_checkpoints/);
  assert.match(progress, /FROM business_run_locks/);
  assert.match(progress, /FROM business_run_checkpoints/);
  assert.match(progress, /payload\.scanDone, payload\.scanResults/);
  assert.match(progress, /payload\.trackDone, payload\.trackResults/);
  assert.doesNotMatch(progress, /loadState\s*\(/);
  assert.doesNotMatch(progress, /loadBusinessState\s*\(/);
});

test('V149 current business boards use the exact current import snapshot', () => {
  assert.match(truth, /v149-current-business-truth-v1/);
  assert.match(truth, /classificationCounts\?\.\[type\]/);
  assert.match(truth, /\/api\/business-state\/\$\{encodeURIComponent\(type\)\}\?snapshotId=/);
  assert.doesNotMatch(truth, /\/api\/v89\/instant-dashboard/);
  assert.doesNotMatch(truth, /v55Summary\?\.total/);
  assert.match(truth, /当前日报数据对账失败/);
});

test('V149 dashboard cache yields to import and foreground scan-track processing', () => {
  assert.match(cache, /UNIFIED_IMPORT\|DAILY_IMPORT\|SHOPEE_IMPORT/);
  assert.match(cache, /IMPORT_DIRTY_ONLY_WAIT_FOR_RUN_COMPLETED/);
  assert.match(cache, /activeForegroundRun/);
  assert.match(cache, /FOREGROUND_PROCESSING_ACTIVE/);
  const importGuard = cache.indexOf('IMPORT_DIRTY_ONLY_WAIT_FOR_RUN_COMPLETED');
  const actualCacheRead = cache.indexOf('const status = getDashboardCacheStatus();');
  assert.ok(importGuard >= 0 && actualCacheRead >= 0 && importGuard < actualCacheRead);
});

test('V149 UI cache bust is installed without touching business rules', () => {
  assert.match(injector, /v149-hotpath-isolation-v1/);
  assert.match(injector, /v140-current-business-truth\.js\?v=20260816-2/);
  assert.doesNotMatch(`${progress}\n${truth}\n${cache}\n${injector}`, /DROP\s+TABLE/i);
  assert.doesNotMatch(`${progress}\n${truth}\n${cache}\n${injector}`, /DELETE\s+FROM\s+(?:unified_import_batches|unified_import_rows|unified_snapshots|shipment_daily_snapshots)\b/i);
});
