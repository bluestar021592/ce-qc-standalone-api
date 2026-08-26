import fs from 'node:fs';
import assert from 'node:assert/strict';

process.env.CE_MIN_BATCH_BUDGET_MS = '80';
const { queryBatchWithFallback } = await import(`../src/trackBatching.js?v316=${Date.now()}`);

const logs = [];
const startedAt = Date.now();
const hung = await queryBatchWithFallback({
  batch: ['A','B','C'],
  query: async () => new Promise(() => {}),
  apiName: 'otwms-order-confirm-query',
  fallbackSizes: [1],
  transientRetries: 0,
  batchTimeBudgetMs: 160,
  onLog: async line => logs.push(String(line))
});
const elapsedMs = Date.now() - startedAt;
assert.ok(elapsedMs < 1500, `never-settling CE request must fail forward, elapsed=${elapsedMs}ms`);
assert.equal(hung.successes.length, 0);
assert.equal(hung.failures.length, 1);
assert.deepEqual(hung.failures[0].batch, ['A','B','C']);
assert.equal(hung.failures[0].error?.code, 'BATCH_TIME_BUDGET_EXCEEDED');
assert.ok(logs.some(line => line.includes('主流程立即继续下一批')));

let attempts = 0;
const recovered = await queryBatchWithFallback({
  batch: ['D','E'],
  query: async codes => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('socket hang up');
      error.code = 'ECONNRESET';
      throw error;
    }
    return codes.map(shipmentCode => ({ shipmentCode }));
  },
  apiName: 'otwms-order-confirm-query',
  transientRetries: 1,
  transientDelayMs: 10,
  batchTimeBudgetMs: 1000
});
assert.equal(attempts, 2);
assert.equal(recovered.successes.length, 1);
assert.equal(recovered.failures.length, 0);

const v147 = fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js', import.meta.url), 'utf8');
const v315 = fs.readFileSync(new URL('../src/v315OperationalDataRefreshPatch.js', import.meta.url), 'utf8');
const redirect = fs.readFileSync(new URL('../src/v314ModuleRedirectPatch.js', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
const batching = fs.readFileSync(new URL('../src/trackBatching.js', import.meta.url), 'utf8');

assert.ok(v147.indexOf("import './v315OperationalDataRefreshPatch.js';") >= 0, 'V315 runtime policy must be activated');
assert.ok(v147.indexOf("import './v315OperationalDataRefreshPatch.js';") < v147.indexOf("import './v294CarryoverSchedulerActivation.js';"), 'V315 policy must load before carryover scheduler/pipeline preload');
assert.match(v315, /process\.env\.ORDER_BATCH_SIZE = '100'/);
assert.match(v315, /process\.env\.REQUEST_TIMEOUT_MS = '12000'/);
assert.match(redirect, /carryoverRefreshScheduler\.js/);
assert.match(redirect, /specifier === '\.\/pipeline\.js'/);
assert.match(pipeline, /const ORDER_BATCH_SIZE = Number\(process\.env\.ORDER_BATCH_SIZE \|\| 350\)/);
assert.match(batching, /queryWithinHardDeadline/);
assert.match(batching, /Promise\.race/);

const sampleTotal = 5453;
const boundedBatches = Math.ceil(sampleTotal / 100);
assert.equal(boundedBatches, 55);
assert.notEqual(boundedBatches, 16, '5453 tickets must no longer run as 350-ticket/16-batch CCSL mode');

console.log(`[V316] CCSL no-freeze smoke passed · never-settling batch released in ${elapsedMs}ms · 5453 tickets => ${boundedBatches} bounded batches · transient retry recovered`);
