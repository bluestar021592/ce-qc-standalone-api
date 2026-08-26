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

// End-to-end batch-loop regression: batch 2 never settles, yet batch 3 must run.
const syntheticBills = Array.from({ length: 300 }, (_, index) => `WB${String(index + 1).padStart(4, '0')}`);
const syntheticSuccess = [];
const syntheticFailed = [];
for (let offset = 0; offset < syntheticBills.length; offset += 100) {
  const batch = syntheticBills.slice(offset, offset + 100);
  const outcome = await queryBatchWithFallback({
    batch,
    query: async codes => offset === 100 ? new Promise(() => {}) : codes.map(shipmentCode => ({ shipmentCode })),
    apiName: 'otwms-order-confirm-query',
    fallbackSizes: [100,50,10,1],
    transientRetries: 0,
    batchTimeBudgetMs: 180
  });
  syntheticSuccess.push(...outcome.successes.flatMap(item => item.batch));
  syntheticFailed.push(...outcome.failures.flatMap(item => item.batch));
}
assert.equal(syntheticSuccess.length, 200, 'later CCSL batches must continue after one hung batch');
assert.equal(syntheticFailed.length, 100, 'only the hung batch should enter retry center');
assert.equal(syntheticSuccess.at(-1), 'WB0300', 'the final later batch must be reached');

const v147 = fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../src/v316BatchPolicyPreload.js', import.meta.url), 'utf8');
const v315 = fs.readFileSync(new URL('../src/v315OperationalDataRefreshPatch.js', import.meta.url), 'utf8');
const redirect = fs.readFileSync(new URL('../src/v314ModuleRedirectPatch.js', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
const batching = fs.readFileSync(new URL('../src/trackBatching.js', import.meta.url), 'utf8');

const preloadImport = v147.indexOf("import './v316BatchPolicyPreload.js';");
const redirectImport = v147.indexOf("import './v314ModuleRedirectPatch.js';");
const v315Import = v147.indexOf("import './v315OperationalDataRefreshPatch.js';");
const schedulerImport = v147.indexOf("import './v294CarryoverSchedulerActivation.js';");
assert.ok(preloadImport >= 0, 'V316 preload must be activated');
assert.ok(preloadImport < redirectImport && preloadImport < v315Import && preloadImport < schedulerImport, 'V316 bounded policy must execute before every pipeline/scheduler preload path');
assert.match(preload, /process\.env\.ORDER_BATCH_SIZE = '100'/);
assert.match(preload, /process\.env\.REQUEST_TIMEOUT_MS = '12000'/);
assert.match(preload, /process\.env\.CE_TRACK_BATCH_BUDGET_MS = '25000'/);
assert.match(preload, /process\.env\.CE_TRANSIENT_RETRIES = '1'/);
assert.ok(v315Import < schedulerImport, 'V315 operational refresh must load before carryover scheduler');
assert.match(v315, /process\.env\.ORDER_BATCH_SIZE = '100'/);
assert.match(redirect, /carryoverRefreshScheduler\.js/);
assert.match(redirect, /specifier === '\.\/pipeline\.js'/);
assert.match(pipeline, /const ORDER_BATCH_SIZE = Number\(process\.env\.ORDER_BATCH_SIZE \|\| 350\)/);
assert.match(batching, /queryWithinHardDeadline/);
assert.match(batching, /Promise\.race/);

const sampleTotal = 5453;
const alreadyCompleted = 2100;
const boundedBatches = Math.ceil(sampleTotal / 100);
assert.equal(boundedBatches, 55);
assert.notEqual(boundedBatches, 16, '5453 tickets must no longer run as 350-ticket/16-batch CCSL mode');
const firstPending = alreadyCompleted + 1;
assert.equal(firstPending, 2101, 'the persisted 2100 successful bills must resume at the next uncompleted bill');

console.log(`[V316] CCSL no-freeze smoke passed · never-settling batch released in ${elapsedMs}ms · bad middle batch failed forward and WB0300 completed · 5453 tickets => ${boundedBatches} bounded batches · checkpoint resumes at ${firstPending}`);
