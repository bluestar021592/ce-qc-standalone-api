import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { createCcslThroughputClient,V339_CCSL_CONFIRM_CONCURRENCY,V339_CCSL_THROUGHPUT_CORE_ID } from '../src/v339CcslThroughputCore.js';
import { shouldUseCcslLightCheckpoint,V340_CCSL_FAST_CHECKPOINT_ID } from '../src/runtimeStorage.js';
import { resolveV314Target } from '../src/v314ModuleRedirectPatch.js';

for(const file of [
  'src/runtimePreload.js','src/runtimePipeline.js','src/runtimeStorage.js','src/runtimeBusinessStore.js',
  'src/v339CcslThroughputCore.js','src/v314ShopeeThroughputCore.js','src/v340CcslStorageCheckpoint.js',
  'src/v314PipelineThroughput.js','src/v314ModuleRedirectPatch.js','src/v70ConfirmQueryResiliencePatch.js','src/v338CcslBatchPolicyRestore.js'
])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.equal(V339_CCSL_CONFIRM_CONCURRENCY,1);
assert.match(V339_CCSL_THROUGHPUT_CORE_ID,/v345-ccsl-single-lane-bounded-retry/);
assert.match(V340_CCSL_FAST_CHECKPOINT_ID,/v348-ccsl-final-only-authoritative-mirror/);
assert.match(resolveV314Target('./src/storage.js','file:///C:/CE/app/server.js'),/runtimeStorage\.js$/);

const compat=fs.readFileSync('src/v339CcslThroughputCore.js','utf8');
const runtimePipeline=fs.readFileSync('src/runtimePipeline.js','utf8');
const checkpoint=fs.readFileSync('src/runtimeStorage.js','utf8');
const storageShim=fs.readFileSync('src/v340CcslStorageCheckpoint.js','utf8');
const core=fs.readFileSync('src/v314ShopeeThroughputCore.js','utf8');
const v70=fs.readFileSync('src/v70ConfirmQueryResiliencePatch.js','utf8');
const v338=fs.readFileSync('src/v338CcslBatchPolicyRestore.js','utf8');
const v147=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const preload=fs.readFileSync('src/runtimePreload.js','utf8');
const batching=fs.readFileSync('src/trackBatching.js','utf8');

assert.match(compat,/Compatibility module only/);
assert.doesNotMatch(compat,/function createCcslThroughputClient/,'legacy V339 file must not own duplicate throughput logic');
assert.match(runtimePipeline,/createUnifiedThroughputClient/);
assert.match(runtimePipeline,/trackConcurrency:4/);
assert.match(runtimePipeline,/scanBatchSize:350/);
assert.match(runtimePipeline,/trackBatchSize:50/);
assert.match(v147,/runtimePreload\.js/,'V147 must now be compatibility-only');
assert.match(preload,/v338CcslBatchPolicyRestore\.js/,'core preload must evaluate V338 before the canonical pipeline snapshot');
assert.match(v338,/process\.env\.ORDER_BATCH_SIZE='350'/,'V338 must keep the logical scan planner at 350');
assert.doesNotMatch(v70,/process\.env\.ORDER_BATCH_SIZE\s*=/,'V70 transport safety must never shrink the canonical logical 350 planner');
assert.match(v70,/Math\.min\(100, Number\(process\.env\.CONFIRM_QUERY_BATCH_SIZE/,'V70 may retain <=100 only as internal confirm transport chunks');
assert.doesNotMatch(v70,/CEClient\.prototype\.trackQuery\s*=/,'V70 must not wrap trajectory queries');
assert.doesNotMatch(v70,/CEClient\.prototype\.exceptionQuery\s*=/,'V70 must not wrap exception queries');
assert.match(storageShim,/runtimeStorage\.js/,'V340 must be a compatibility shim');
assert.doesNotMatch(checkpoint,/SCAN_FULL_MIRROR_STRIDE/,'runtime storage must not restore periodic full SQLite mirrors');
assert.doesNotMatch(checkpoint,/TRACK_FULL_MIRROR_STRIDE/,'runtime storage must not restore periodic full SQLite mirrors');
assert.match(checkpoint,/FINAL_ONLY_AFTER_RUNNING_FALSE/,'authoritative CCSL full mirror must remain final-only');
assert.match(checkpoint,/ZERO_WAIT_FAIL_OPEN_BUSINESS_PIPELINE_CONTINUES/,'active-run checkpoint failures must remain zero-wait fail-open');
assert.match(core,/allRequestsBounded:true/,'every on-demand request must remain under the unified limiter');
assert.match(core,/planMode:isShopee\?'stable-filter':'compact-pending'/,'CCSL track resume boundary must match compact pending batching');
assert.match(batching,/fallbackSizes: Array\.isArray\(options\.fallbackSizes\) \? options\.fallbackSizes : \[\]/,'trajectory default must remain fixed 50-ticket retry units');

assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'订单扫描',batchIndex:1,totalBatches:7}}),true);
assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'订单扫描',batchIndex:4,totalBatches:7}}),true,'all active scan batches stay lightweight');
assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'轨迹查询',batchIndex:8,totalBatches:20}}),true,'all active trajectory batches stay lightweight');
assert.equal(shouldUseCcslLightCheckpoint({processing:{running:false,phase:'完成',batchIndex:8,totalBatches:8}}),false,'running=false returns to final authoritative mirror');
assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,paused:true,phase:'订单扫描',batchIndex:2,totalBatches:7}}),false,'paused runs are authoritative boundaries');

const scanBills=Array.from({length:700},(_,i)=>`C${String(i+1).padStart(4,'0')}`);let scanActive=0,scanMax=0;
const scanClient=createCcslThroughputClient({businessType:'CCSL',scanPool:scanBills,scanQueryStatus:[]},{async confirmQuery(codes){scanActive++;scanMax=Math.max(scanMax,scanActive);assert.ok(codes.length<=350);await new Promise(r=>setTimeout(r,25));scanActive--;return codes.map(shipmentCode=>({shipmentCode}));}},{confirmConcurrency:1,hardBudgetMs:500});
for(let i=0;i<scanBills.length;i+=350)await scanClient.confirmQuery(scanBills.slice(i,i+350));
assert.equal(scanMax,1,'CCSL confirm must remain one remote 350 lane');

const trackBills=Array.from({length:670},(_,i)=>`T${String(i+1).padStart(4,'0')}`);let active=0,maxActive=0,calls=0;
const trackClient=createCcslThroughputClient({businessType:'CCSL',needTrackBills:trackBills,trackQueryStatus:[]},{async trackQuery(codes){calls++;active++;maxActive=Math.max(maxActive,active);assert.ok(codes.length<=50);await new Promise(r=>setTimeout(r,35));active--;return codes.map(shipmentCode=>({shipmentCode}));}},{trackConcurrency:4});
assert.equal(trackClient.__ceQcThroughputPools.track.planMode,'compact-pending');
const started=performance.now();
for(let i=0;i<trackBills.length;i+=50)await trackClient.trackQuery(trackBills.slice(i,i+50));
const elapsed=performance.now()-started;
assert.equal(calls,14);assert.equal(maxActive,4,'CCSL track must use 50-ticket x4 bounded prefetch');assert.ok(elapsed<340);

console.log(`[CORE CCSL] compatibility smoke passed · unversioned preload/pipeline/storage owners · logical scan 350 · V70 confirm transport-only <=100 · track 50x4 fixed retry units · active zero-wait light checkpoints · final mirror only after running=false · ${elapsed.toFixed(1)}ms synthetic`);
