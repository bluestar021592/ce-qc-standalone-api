import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file),'utf8');
const syntax = file => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding:'utf8' });
  assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
};

const progress = read('src/v33RunProgressPatch.js');
const truth = read('public/v140-current-business-truth.js');
const cache = read('src/dashboardCacheWorker.js');
const injector = read('src/v44WhppUiPatch.js');
const trends = read('src/v27TrendPatch.js');
const reimport = read('src/v74CeafDuplicateReimportPatch.js');

test('V149/V150/V151/V154 candidate files are syntax valid', () => {
  for (const file of [
    'src/v33RunProgressPatch.js','public/v140-current-business-truth.js','src/dashboardCacheWorker.js','src/v44WhppUiPatch.js',
    'src/v27TrendPatch.js','src/v74CeafDuplicateReimportPatch.js'
  ]) syntax(file);
});

test('V149 live progress is lightweight, backward-compatible, and bounded by target pool', () => {
  assert.match(progress, /v149-tiny-run-progress-compat-v2/);
  assert.match(progress, /FROM run_locks/);
  assert.match(progress, /FROM run_checkpoints/);
  assert.match(progress, /FROM business_run_locks/);
  assert.match(progress, /FROM business_run_checkpoints/);
  assert.match(progress, /payload\.scanDone, payload\.scanResults/);
  assert.match(progress, /payload\.trackDone, payload\.trackResults/);
  assert.match(progress, /function boundedCounts/);
  assert.match(progress, /Math\.min\(total, rawDone\)/);
  assert.match(progress, /Math\.min\(Math\.max\(0, total - done\), rawRetry\)/);
  assert.match(progress, /V149_RUN_LOCK_PLUS_TINY_CHECKPOINT_BOUNDED/);
  assert.doesNotMatch(progress, /loadState\s*\(/);
  assert.doesNotMatch(progress, /loadBusinessState\s*\(/);
  assert.doesNotMatch(progress, /business_api_batches/);
  assert.doesNotMatch(progress, /business_track_events/);
  assert.doesNotMatch(progress, /business_exception_items/);
});

test('V150 current boards use exact snapshot membership and block legacy V55 history override', () => {
  assert.match(truth, /v150-current-business-truth-v3-v55-guard/);
  assert.match(truth, /classificationCounts\?\.\[type\]/);
  assert.match(truth, /\/api\/business-state\/\$\{encodeURIComponent\(type\)\}\?snapshotId=/);
  assert.match(truth, /function restrictToCurrentMembers/);
  assert.match(truth, /carryBills: filterBills\(state\.carryBills\)/);
  assert.match(truth, /nextCarryBills: filterBills\(state\.nextCarryBills\)/);
  assert.match(truth, /podLocks: filterBills\(state\.podLocks\)/);
  assert.match(truth, /function installV55CurrentGuard/);
  assert.match(truth, /state\.v55Summary = \{ total, __source: 'V150_EXACT_CURRENT_SNAPSHOT' \}/);
  assert.match(truth, /__v150BlocksLegacyV55RangeFallback/);
  assert.match(truth, /当前日报数据对账失败/);
  assert.match(truth, /当前日报读取失败/);
  assert.doesNotMatch(truth, /\/api\/v89\/instant-dashboard/);
});

test('V151 trends recognize VALID daily imports even when processing snapshots are not COMPLETED', () => {
  assert.match(trends, /listLightweightBusinessHistory/);
  assert.match(trends, /WHERE status='VALID' AND reportDate<=\?/);
  assert.match(trends, /WHERE status='VALID' AND reportDate BETWEEN \? AND \?/);
  assert.match(trends, /historySource:'VALID_UNIFIED_IMPORT_SQLITE'/);
  assert.doesNotMatch(trends, /loadRangeDashboard/);
  assert.doesNotMatch(trends, /s\.status='COMPLETED'/);
  assert.doesNotMatch(trends, /ns\.status='COMPLETED'/);
});

test('V154 exact same-day workbook reimport supersedes the prior VALID batch before V42 and restores it on failure', () => {
  assert.match(reimport, /v154-safe-same-date-reimport-v3/);
  assert.match(reimport, /prepareSameFileReplacement/);
  assert.match(reimport, /fileHash LIKE \?/);
  assert.match(reimport, /SET status='SUPERSEDED'/);
  assert.match(reimport, /restorePriorBatchIfReplacementFailed/);
  assert.match(reimport, /SET status='VALID'/);
  assert.match(reimport, /sameFileReplacementPreHandler/);
  assert.match(reimport, /handlers\.slice\(0, -1\), sameFileReplacementPreHandler, finalHandler/);
  assert.match(reimport, /FORCE_NEW_BATCH_FOR_SAME_WORKBOOK/);
  assert.doesNotMatch(reimport, /DELETE\s+FROM\s+unified_import/i);
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

test('V152 current/history fixes keep destructive storage operations out of the changed paths', () => {
  assert.match(injector, /v149-hotpath-isolation-v2/);
  assert.match(injector, /v152-multi-generation-fact-truth-v2/);
  assert.match(injector, /v140-current-business-truth\.js\?v=20260816-4/);
  assert.ok(injector.indexOf('v109-instant-business-navigation.js') < injector.indexOf('v140-current-business-truth.js'));
  const combined = `${progress}\n${truth}\n${cache}\n${injector}\n${trends}\n${reimport}`;
  assert.doesNotMatch(combined, /DROP\s+TABLE/i);
  assert.doesNotMatch(combined, /DELETE\s+FROM\s+(?:unified_import_batches|unified_import_rows|unified_snapshots|shipment_daily_snapshots)\b/i);
});
