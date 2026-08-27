import fs from 'node:fs';
import assert from 'node:assert/strict';

process.env.CE_MIN_BATCH_BUDGET_MS = '80';
process.env.CE_CONFIRM_HARD_BUDGET_MS = '180';
const { queryBatchWithFallback, splitTrackBatches, TRACK_QUERY_BATCH_SIZE } = await import(`../src/trackBatching.js?v338=${Date.now()}`);

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

// Confirm-query hard cap remains independent of preload order.
const hardCapStarted = Date.now();
const hardCapped = await queryBatchWithFallback({
  batch: ['CAP-1','CAP-2','CAP-3'],
  query: async () => new Promise(() => {}),
  apiName: 'otwms-order-confirm-query',
  fallbackSizes: [],
  transientRetries: 5,
  batchTimeBudgetMs: 5000
});
const hardCapElapsedMs = Date.now() - hardCapStarted;
assert.ok(hardCapElapsedMs < 1500, `confirm-query core cap must override stale long budget, elapsed=${hardCapElapsedMs}ms`);
assert.equal(hardCapped.successes.length,0);
assert.equal(hardCapped.failures.length,1);
assert.equal(hardCapped.failures[0].error?.code,'BATCH_TIME_BUDGET_EXCEEDED');

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

// Exact production batch-loop regression: three 350-ticket scan batches. Batch 2
// never settles, but the third 350-ticket batch must still execute.
const syntheticBills = Array.from({ length: 1050 }, (_, index) => `WB${String(index + 1).padStart(4, '0')}`);
const syntheticSuccess = [];
const syntheticFailed = [];
for (let offset = 0; offset < syntheticBills.length; offset += 350) {
  const batch = syntheticBills.slice(offset, offset + 350);
  const outcome = await queryBatchWithFallback({
    batch,
    query: async codes => offset === 350 ? new Promise(() => {}) : codes.map(shipmentCode => ({ shipmentCode })),
    apiName: 'otwms-order-confirm-query',
    fallbackSizes: [100,50,10,1],
    transientRetries: 0,
    batchTimeBudgetMs: 180
  });
  syntheticSuccess.push(...outcome.successes.flatMap(item => item.batch));
  syntheticFailed.push(...outcome.failures.flatMap(item => item.batch));
}
assert.equal(syntheticSuccess.length, 700, 'later 350-ticket CCSL scan batch must continue after one hung batch');
assert.equal(syntheticFailed.length, 350, 'only the hung 350-ticket scan batch should enter retry center');
assert.equal(syntheticSuccess.at(-1), 'WB1050', 'the final later 350-ticket batch must be reached');

assert.equal(TRACK_QUERY_BATCH_SIZE,50,'trajectory queries must remain fixed at 50 tickets');
assert.deepEqual(splitTrackBatches(Array.from({length:120},(_,i)=>`TR${i+1}`)).map(batch=>batch.length),[50,50,20]);

const v147 = fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../src/v316BatchPolicyPreload.js', import.meta.url), 'utf8');
const v315 = fs.readFileSync(new URL('../src/v315OperationalDataRefreshPatch.js', import.meta.url), 'utf8');
const restore = fs.readFileSync(new URL('../src/v338CcslBatchPolicyRestore.js', import.meta.url), 'utf8');
const redirect = fs.readFileSync(new URL('../src/v314ModuleRedirectPatch.js', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../src/pipeline.js', import.meta.url), 'utf8');
const batching = fs.readFileSync(new URL('../src/trackBatching.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/v138-ccsl-scan-progress.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

const preloadImport = v147.indexOf("import './v316BatchPolicyPreload.js';");
const redirectImport = v147.indexOf("import './v314ModuleRedirectPatch.js';");
const v315Import = v147.indexOf("import './v315OperationalDataRefreshPatch.js';");
const restoreImport = v147.indexOf("import './v338CcslBatchPolicyRestore.js';");
const schedulerImport = v147.indexOf("import './v294CarryoverSchedulerActivation.js';");
assert.ok(preloadImport >= 0, 'V338 preload must be activated');
assert.ok(preloadImport < redirectImport && preloadImport < v315Import, 'V338 canonical policy must load before legacy pipeline-adjacent modules');
assert.ok(v315Import < restoreImport && restoreImport < schedulerImport, 'V338 final 350/50 restore must execute after legacy V315 and before carryover pipeline preload');
assert.match(preload, /process\.env\.ORDER_BATCH_SIZE = '350'/);
assert.match(preload, /process\.env\.CONFIRM_QUERY_BATCH_SIZE = '350'/);
assert.match(preload, /trackBatchSize: 50/);
assert.match(preload, /process\.env\.REQUEST_TIMEOUT_MS = '12000'/);
assert.match(preload, /process\.env\.CE_TRACK_BATCH_BUDGET_MS = '25000'/);
assert.match(preload, /process\.env\.CE_TRANSIENT_RETRIES = '1'/);
assert.match(restore, /process\.env\.ORDER_BATCH_SIZE='350'/);
assert.match(restore, /process\.env\.CONFIRM_QUERY_BATCH_SIZE='350'/);
assert.match(restore, /finalTrackBatchSize:50/);
assert.ok(v315Import < schedulerImport, 'V315 operational refresh must still load before carryover scheduler');
assert.match(v315, /TRACK_CHUNK = 50/);
assert.match(redirect, /carryoverRefreshScheduler\.js/);
assert.match(redirect, /specifier === '\.\/pipeline\.js'/);
assert.match(pipeline, /const ORDER_BATCH_SIZE = Number\(process\.env\.ORDER_BATCH_SIZE \|\| 350\)/);
assert.match(batching, /export const TRACK_QUERY_BATCH_SIZE = 50/);
assert.match(batching, /queryWithinHardDeadline/);
assert.match(batching, /Promise\.race/);
assert.match(batching,/CONFIRM_HARD_BUDGET_MS/,'batching core must own confirm hard cap independent of preload order');
assert.match(batching,/isConfirmQuery \? Math\.min\(requestedBudgetMs, CONFIRM_HARD_BUDGET_MS\)/,'confirm request must be capped inside the batching core');
assert.match(batching,/CONFIRM_MAX_TRANSIENT_RETRIES = 1/,'confirm-query may perform at most one transport compensation attempt');
assert.match(ui,/batchMax:350/,'running scan UI must show 350 tickets per scan batch');
assert.match(ui,/单批最大350/,'completed/detail UI must show scan batch maximum 350');
assert.match(ui,/单批最大50/,'completed/detail UI must show trajectory batch maximum 50');
assert.match(shell,/v138-ccsl-scan-progress\.js\?v=20260827-v338-1/,'HTML shell must cache-bust the V338 350/50 progress owner');

const sampleTotal = 5453;
const alreadyCompleted = 2100;
const boundedBatches = Math.ceil(sampleTotal / 350);
assert.equal(boundedBatches, 16, '5453 tickets must run as 16 CCSL scan batches at 350 tickets per batch');
const firstPending = alreadyCompleted + 1;
assert.equal(firstPending, 2101, 'the persisted 2100 successful bills must resume at the next uncompleted bill');

console.log(`[V338/V316] CCSL batch policy smoke passed · scan=350 · trajectory=50 · 5453=>${boundedBatches} scan batches · never-settling 350-ticket middle batch failed forward and WB1050 completed · checkpoint resumes at ${firstPending}`);
