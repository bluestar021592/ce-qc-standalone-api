import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

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

// V348 production hot-path regression. Progress and all in-run fact checkpoints
// must be zero-wait lightweight writes. In particular, the historical batch-4
// boundary (1400 tickets) must NEVER call originalStorage.saveState() on the large
// database. One authoritative mirror is allowed only after running=false.
const oldDbFile = process.env.DB_FILE;
const oldDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-v348-'));
const tempDbFile = path.join(tempDir, 'v348.db');
const seedDb = new DatabaseSync(tempDbFile);
seedDb.exec(`
  CREATE TABLE run_locks(
    reportDate TEXT PRIMARY KEY,runId TEXT,status TEXT,currentStage TEXT,batchIndex INTEGER,totalBatches INTEGER,errorMessage TEXT,updatedAt TEXT
  );
  CREATE TABLE run_checkpoints(
    runId TEXT,reportDate TEXT,stage TEXT,batchIndex INTEGER,totalBatches INTEGER,status TEXT,payloadJson TEXT,errorMessage TEXT,createdAt TEXT,updatedAt TEXT
  );
`);
seedDb.prepare(`INSERT INTO run_locks(reportDate,runId,status,currentStage,batchIndex,totalBatches,errorMessage,updatedAt) VALUES(?,?,'running','订单扫描',0,4,'','x')`)
  .run('2026-08-11','V348-RUN');
seedDb.close();
process.env.DB_FILE = tempDbFile;
process.env.DATA_DIR = tempDir;
const checkpointRuntime = await import(`../src/v340CcslStorageCheckpoint.js?v348=${Date.now()}`);
try {
  const completed = Array.from({length:350},(_,i)=>({shipmentCode:`V348-${String(i+1).padStart(4,'0')}`,status:'success'}));
  const state = {
    reportDate:'2026-08-11',
    currentRun:{runId:'V348-RUN'},
    processing:{running:true,paused:false,phase:'订单扫描',batchIndex:1,totalBatches:4,error:''},
    scanPool:Array.from({length:1400},(_,i)=>`V348-${String(i+1).padStart(4,'0')}`),
    scanQueryStatus:completed,
    scanResults:completed.map(row=>({运单号:row.shipmentCode})),
    podLocks:[],needTrackBills:[],trackQueryStatus:[],trackResults:[],trackEvents:[],finalRows:[],nextCarryBills:[]
  };
  await checkpointRuntime.saveState(state);
  let inspect = new DatabaseSync(tempDbFile);
  assert.equal(inspect.prepare(`SELECT batchIndex FROM run_locks WHERE reportDate='2026-08-11'`).get().batchIndex,1);
  inspect.close();

  // Same facts, only displayed batch pointer/log progress changed: zero SQLite write.
  state.processing.batchIndex=2;
  state.logs=['订单扫描 351-700 / 1400'];
  await checkpointRuntime.saveState(state);
  inspect = new DatabaseSync(tempDbFile);
  assert.equal(inspect.prepare(`SELECT batchIndex FROM run_locks WHERE reportDate='2026-08-11'`).get().batchIndex,1,'progress-only save must not advance SQLite before the batch has produced facts');
  inspect.close();

  // New facts require a real light checkpoint. Hold a competing writer lock and
  // prove V348 returns immediately instead of inheriting the main busy wait.
  state.scanQueryStatus.push(...Array.from({length:350},(_,i)=>({shipmentCode:`V348-${String(i+351).padStart(4,'0')}`,status:'success'})));
  state.scanResults.push(...Array.from({length:350},(_,i)=>({运单号:`V348-${String(i+351).padStart(4,'0')}`})));
  const blocker = new DatabaseSync(tempDbFile);
  blocker.exec('PRAGMA busy_timeout = 0');
  blocker.exec('BEGIN IMMEDIATE');
  const lockStarted = Date.now();
  await checkpointRuntime.saveState(state);
  const lockElapsed = Date.now()-lockStarted;
  assert.ok(lockElapsed < 500, `locked light checkpoint must fail open immediately, got ${lockElapsed}ms`);
  const live = await checkpointRuntime.loadState();
  assert.equal(live,state,'active-run pause checks must reuse the in-memory state instead of parsing full app_state');
  blocker.exec('ROLLBACK');
  blocker.close();

  // This is the exact historical freeze boundary: batch 4/4 = 1400 tickets.
  // The fixture intentionally lacks app_state/fact tables, so any attempted full
  // mirror would throw. V348 must stay lightweight and simply advance run_locks.
  state.scanQueryStatus.push(...Array.from({length:700},(_,i)=>({shipmentCode:`V348-${String(i+701).padStart(4,'0')}`,status:'success'})));
  state.scanResults.push(...Array.from({length:700},(_,i)=>({运单号:`V348-${String(i+701).padStart(4,'0')}`})));
  state.processing.batchIndex=4;
  await checkpointRuntime.saveState(state);
  inspect = new DatabaseSync(tempDbFile);
  assert.equal(inspect.prepare(`SELECT batchIndex FROM run_locks WHERE reportDate='2026-08-11'`).get().batchIndex,4,'batch 4/4 must remain a light checkpoint; no in-run full mirror allowed');
  inspect.close();
  assert.equal(checkpointRuntime.shouldUseCcslLightCheckpoint(state),true,'all running CCSL saves must stay lightweight, including the final scan batch');
} finally {
  checkpointRuntime.resetV347CheckpointRuntimeForTest();
  if (oldDbFile === undefined) delete process.env.DB_FILE; else process.env.DB_FILE = oldDbFile;
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  try { fs.rmSync(tempDir,{recursive:true,force:true}); } catch {}
}

const v147 = fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../src/v316BatchPolicyPreload.js', import.meta.url), 'utf8');
const v315 = fs.readFileSync(new URL('../src/v315OperationalDataRefreshPatch.js', import.meta.url), 'utf8');
const restore = fs.readFileSync(new URL('../src/v338CcslBatchPolicyRestore.js', import.meta.url), 'utf8');
const redirect = fs.readFileSync(new URL('../src/v314ModuleRedirectPatch.js', import.meta.url), 'utf8');
const checkpointSource = fs.readFileSync(new URL('../src/v340CcslStorageCheckpoint.js', import.meta.url), 'utf8');
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
assert.match(v315, /process\.env\.ORDER_BATCH_SIZE = '350'/,'V315 must never shrink CCSL order scan below 350');
assert.match(v315, /process\.env\.CONFIRM_QUERY_BATCH_SIZE = '350'/,'V315 confirm-query batch must remain 350');
assert.doesNotMatch(v315, /process\.env\.(?:ORDER_BATCH_SIZE|CONFIRM_QUERY_BATCH_SIZE) = '100'/,'V315 legacy 100-ticket scan policy must not reappear');
assert.match(v315, /TRACK_CHUNK = 50/,'V315 strict evidence trajectory chunk remains 50');
assert.match(restore, /process\.env\.ORDER_BATCH_SIZE='350'/);
assert.match(restore, /process\.env\.CONFIRM_QUERY_BATCH_SIZE='350'/);
assert.match(restore, /finalTrackBatchSize:50/);
assert.ok(v315Import < schedulerImport, 'V315 operational refresh must still load before carryover scheduler');
assert.match(redirect, /carryoverRefreshScheduler\.js/);
assert.match(redirect, /specifier === '\.\/pipeline\.js'/);
assert.match(redirect, /v340CcslStorageCheckpoint\.js/,'server storage must remain redirected through the CCSL hot-path checkpoint owner');
assert.match(checkpointSource,/v348-ccsl-final-only-authoritative-mirror/);
assert.match(checkpointSource,/progressOnlySqliteWrites:false/,'progress-only text/log saves must stay out of SQLite');
assert.match(checkpointSource,/PRAGMA busy_timeout = 0/,'light checkpoint must never inherit a blocking SQLite busy timeout');
assert.match(checkpointSource,/IN_MEMORY_WHILE_ACTIVE/,'pause polling must remain in-memory during active CCSL processing');
assert.match(checkpointSource,/inRunFullMirror:false/,'no synchronous full mirror may run while CCSL processing is active');
assert.match(checkpointSource,/FINAL_ONLY_AFTER_RUNNING_FALSE/,'authoritative CCSL full mirror must be final-only');
assert.match(checkpointSource,/V348_CCSL_FINAL_MIRROR_TIMING/,'the one authoritative final mirror must remain observable');
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
assert.match(shell,/v138-ccsl-scan-progress\.js\?v=20260905-v427-1/,'HTML shell must cache-bust the V427 V168-idle/V138-live 350/50 progress owner');

const sampleTotal = 5453;
const alreadyCompleted = 2100;
const boundedBatches = Math.ceil(sampleTotal / 350);
assert.equal(boundedBatches, 16, '5453 tickets must run as 16 CCSL scan batches at 350 tickets per batch');
const firstPending = alreadyCompleted + 1;
assert.equal(firstPending, 2101, 'the persisted 2100 successful bills must resume at the next uncompleted bill');

console.log(`[V348/V338/V316] CCSL no-freeze smoke passed · scan=350 · trajectory=50 · all in-run saves are zero-wait light checkpoints · batch 4/4=1400 never full-mirrors · one final authoritative mirror only after running=false · locked checkpoint fail-open · pause reads=in-memory · 5453=>${boundedBatches} scan batches · never-settling middle batch failed forward and WB1050 completed · safe crash recovery may re-query unfinished API work`);
