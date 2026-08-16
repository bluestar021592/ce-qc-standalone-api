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

const storage = read('src/storage.js');
const store = read('src/store.js');
const businessStore = read('src/businessStore.js');
const progress = read('src/v33RunProgressPatch.js');
const currentTruth = read('public/v140-current-business-truth.js');
const injector = read('src/v44WhppUiPatch.js');
const cacheWorker = read('src/dashboardCacheWorker.js');
const carryScheduler = read('src/carryoverRefreshScheduler.js');

test('V149 modified runtime files are syntax valid', () => {
  for (const file of [
    'src/storage.js',
    'src/store.js',
    'src/businessStore.js',
    'src/v33RunProgressPatch.js',
    'src/dashboardCacheWorker.js',
    'public/v140-current-business-truth.js',
    'src/v44WhppUiPatch.js'
  ]) syntax(file);
});

test('V149 progress polling reads only tiny run locks/checkpoints', () => {
  assert.match(progress, /v149-tiny-run-progress-v1/);
  assert.match(progress, /FROM run_locks/);
  assert.match(progress, /FROM run_checkpoints/);
  assert.match(progress, /FROM business_run_locks/);
  assert.match(progress, /FROM business_run_checkpoints/);
  assert.doesNotMatch(progress, /loadState\s*\(/);
  assert.doesNotMatch(progress, /loadBusinessState\s*\(/);
  assert.doesNotMatch(progress, /business_track_events/);
  assert.doesNotMatch(progress, /business_exception_items/);
  assert.doesNotMatch(progress, /business_final_rows/);
});

test('V149 CCSL persistence separates import checkpoint and final writes', () => {
  assert.match(storage, /inferPersistenceMode/);
  assert.match(storage, /mode === 'checkpoint'/);
  assert.match(storage, /runtimeCheckpointSignatures/);
  assert.match(storage, /carryBills:\s*\[\], nextCarryBills:\s*\[\], priorCarryRows:\s*\[\]/);
  assert.match(store, /mirrorMode/);
  assert.match(store, /mode === 'import'/);
  assert.match(store, /mode === 'checkpoint'/);
  assert.match(store, /Historical carry is deliberately not injected into the current-day auto run/);
  assert.match(store, /carryBills:\s*\[\]/);
});

test('V149 SHOPEE in-flight save never rewrites normalized scan track and final tables', () => {
  assert.match(businessStore, /inferBusinessPersistenceMode/);
  assert.match(businessStore, /else if \(mode === 'checkpoint'\) mirrorBusinessProgress/);
  const checkpointBody = businessStore.slice(
    businessStore.indexOf('function mirrorBusinessProgress'),
    businessStore.indexOf('function mirrorBusinessApiBatches')
  );
  assert.doesNotMatch(checkpointBody, /DELETE FROM business_scan_results/);
  assert.doesNotMatch(checkpointBody, /DELETE FROM business_track_events/);
  assert.doesNotMatch(checkpointBody, /DELETE FROM business_exception_items/);
  assert.doesNotMatch(checkpointBody, /DELETE FROM business_final_rows/);
  assert.match(checkpointBody, /business_run_checkpoints/);
});

test('V149 current-day SHOPEE does not hydrate historical carry into the automatic scan pool', () => {
  assert.match(businessStore, /const currentCarryBills = state\.currentDayOnly \? \[\] : historicalCarryBills/);
  assert.match(businessStore, /carryBills: state\.currentDayOnly \? \[\]/);
  assert.match(businessStore, /priorCarryRows: state\.currentDayOnly \? \[\]/);
  assert.doesNotMatch(businessStore, /if \(!active\.has\(row\.shipmentCode\)\).*closed_reconciled/s);
});

test('V149 keeps cross-day tracking in its independent two-hour scheduler', () => {
  assert.match(carryScheduler, /CARRY_REFRESH_INTERVAL_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(carryScheduler, /CAMBODIA_DAY_ROLLOVER_0005/);
  assert.match(carryScheduler, /FOREGROUND_PROCESSING_ACTIVE/);
  assert.match(carryScheduler, /carryover_open_items WHERE status='OPEN'/);
});

test('V149 dashboard cache never competes with imports or active foreground processing', () => {
  assert.match(cacheWorker, /UNIFIED_IMPORT\|DAILY_IMPORT\|SHOPEE_IMPORT/);
  assert.match(cacheWorker, /IMPORT_DIRTY_ONLY_WAIT_FOR_RUN_COMPLETED/);
  assert.match(cacheWorker, /activeForegroundRun/);
  assert.match(cacheWorker, /FOREGROUND_PROCESSING_ACTIVE/);
  const importGuard = cacheWorker.indexOf('IMPORT_DIRTY_ONLY_WAIT_FOR_RUN_COMPLETED');
  const cacheStatus = cacheWorker.indexOf('getDashboardCacheStatus()');
  assert.ok(importGuard >= 0 && cacheStatus >= 0 && importGuard < cacheStatus, 'import guard must happen before cache reads');
});

test('V149 current business pages always reconcile against exact import snapshot membership', () => {
  assert.match(currentTruth, /v149-current-business-truth-v1/);
  assert.match(currentTruth, /imported\?\.classificationCounts\?\.\[type\]/);
  assert.match(currentTruth, /\/api\/business-state\/\$\{encodeURIComponent\(type\)\}\?snapshotId=/);
  assert.doesNotMatch(currentTruth, /\/api\/v89\/instant-dashboard/);
  assert.doesNotMatch(currentTruth, /v55Summary\?\.total/);
  assert.match(currentTruth, /当前日报数据对账失败/);
  assert.match(injector, /v140-current-business-truth\.js\?v=20260816-2/);
  assert.match(injector, /v149-data-pipeline-convergence-v1/);
});

test('V149 convergence changes never introduce broad historical purge', () => {
  const convergence = `${storage}\n${businessStore}\n${progress}\n${currentTruth}\n${cacheWorker}`;
  assert.doesNotMatch(convergence, /DROP\s+TABLE/i);
  assert.doesNotMatch(convergence, /DELETE\s+FROM\s+(?:unified_import_batches|unified_import_rows|unified_snapshots|shipment_daily_snapshots)\b/i);
});
