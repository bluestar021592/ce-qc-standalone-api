import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import {
  createUnifiedThroughputClient,
  createShopeeThroughputClient,
  createCcslThroughputClient,
  splitFixedBatches,
  V314_ALL_BUSINESS_THROUGHPUT_CORE_ID,
  V314_CONFIRM_CONCURRENCY,
  V339_CCSL_CONFIRM_CONCURRENCY
} from '../src/v314ShopeeThroughputCore.js';
import { queryBatchWithFallback, queryTrackBatchWithFallback } from '../src/trackBatching.js';
import { resolveV314Target } from '../src/v314ModuleRedirectPatch.js';

for(const file of [
  'src/runtimePipeline.js','src/runtimeBusinessStore.js','src/runtimeStorage.js',
  'src/v314PipelineThroughput.js','src/v314BusinessStoreCheckpoint.js','src/v340CcslStorageCheckpoint.js',
  'src/v314ShopeeThroughputCore.js','src/v339CcslThroughputCore.js','src/v314ModuleRedirectPatch.js','src/trackBatching.js'
])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.match(V314_ALL_BUSINESS_THROUGHPUT_CORE_ID,/all-business-bounded-retry-350-scan-50x4-track/);
assert.equal(V314_CONFIRM_CONCURRENCY,2,'Shopee confirm keeps bounded x2');
assert.equal(V339_CCSL_CONFIRM_CONCURRENCY,1,'CCSL confirm remains one remote 350 lane');
assert.match(resolveV314Target('./src/pipeline.js','file:///C:/CE/app/server.js'),/runtimePipeline\.js$/);
assert.match(resolveV314Target('./src/businessStore.js','file:///C:/CE/app/server.js'),/runtimeBusinessStore\.js$/);
assert.match(resolveV314Target('./src/storage.js','file:///C:/CE/app/server.js'),/runtimeStorage\.js$/);

const runtimePipeline=fs.readFileSync('src/runtimePipeline.js','utf8');
const runtimeStore=fs.readFileSync('src/runtimeBusinessStore.js','utf8');
const runtimeStorage=fs.readFileSync('src/runtimeStorage.js','utf8');
const pipelineShim=fs.readFileSync('src/v314PipelineThroughput.js','utf8');
const storeShim=fs.readFileSync('src/v314BusinessStoreCheckpoint.js','utf8');
const storageShim=fs.readFileSync('src/v340CcslStorageCheckpoint.js','utf8');
const compat=fs.readFileSync('src/v339CcslThroughputCore.js','utf8');
const core=fs.readFileSync('src/v314ShopeeThroughputCore.js','utf8');
const batching=fs.readFileSync('src/trackBatching.js','utf8');

assert.match(runtimePipeline,/createUnifiedThroughputClient/,'unversioned runtime pipeline must own throughput');
assert.match(runtimePipeline,/createUnifiedThroughputClient\(state,completeClient,\{trackConcurrency:4\}\)/,'runtime must force 50-ticket tracking x4');
assert.match(runtimePipeline,/scanBatchSize:350/);assert.match(runtimePipeline,/trackBatchSize:50/);assert.match(runtimePipeline,/trackConcurrency:4/);
assert.match(pipelineShim,/runtimePipeline\.js/,'V314 pipeline file must be compatibility-only');
assert.match(storeShim,/runtimeBusinessStore\.js/,'V314 business store file must be compatibility-only');
assert.match(storageShim,/runtimeStorage\.js/,'V340 storage file must be compatibility-only');
assert.match(compat,/Compatibility module only/);assert.doesNotMatch(compat,/function createCcslThroughputClient/,'old CCSL file must not own duplicate throughput logic');
assert.doesNotMatch(core,/if\(!plannedKeys\.has\(key\)\)return query\(batch\)/,'fallback/on-demand requests must never bypass bounded scheduler');
assert.match(core,/enqueue\(batch,!plannedKeys\.has\(key\)\)/,'fallback/on-demand requests must enter the same scheduler with priority');
assert.match(core,/planMode:isShopee\?'stable-filter':'compact-pending'/,'CCSL track resume must compact pending tickets exactly like pipeline.js');
assert.match(batching,/return \[\];/,'default trajectory fallback must remain fixed-batch with no recursive 25\/10\/5\/1 degradation');

assert.match(runtimeStore,/DatabaseSync/,'SHOPEE progress checkpoints must use a dedicated SQLite connection');
assert.match(runtimeStore,/PRAGMA busy_timeout = 0/,'SHOPEE progress writes must never wait on the main writer lock');
assert.match(runtimeStore,/inRunFullMirror:false/,'active SHOPEE processing must never perform periodic full mirrors');
assert.match(runtimeStore,/authoritativeFullMirrorPolicy:'PAUSE_ERROR_OR_FINAL_ONLY'/);
assert.match(runtimeStore,/export function loadBusinessState/,'active pause reads must be served by the core owner');
assert.match(runtimeStore,/liveState\?\.processing\?\.running/,'active SHOPEE pause polling must use in-memory state');
assert.match(runtimeStore,/ZERO_WAIT_FAIL_OPEN_NEVER_ABORT_SHOPEE/,'progress SQLite contention must not abort CE API processing');
assert.match(runtimeStore,/finalMirrorFailurePolicy:'FAIL_CLOSED'/,'authoritative final persistence must remain fail-closed');
assert.doesNotMatch(runtimeStore,/scanFullMirrorEveryBatches|eventExceptionFullMirrorEveryBatches/,'old periodic full mirror cadence must stay retired');
assert.doesNotMatch(runtimeStore,/BEGIN IMMEDIATE/,'progress checkpoint path must not grab an immediate writer lock');
assert.match(runtimeStorage,/FINAL_ONLY_AFTER_RUNNING_FALSE/,'CCSL full mirror must remain final-only');

async function trackCase(businessType){
  const bills=Array.from({length:670},(_,i)=>`${businessType}-${String(i+1).padStart(4,'0')}`);let active=0,maxActive=0,calls=0;
  const state={businessType,needTrackBills:bills,eventQueryStatus:[],trackQueryStatus:[],scanPool:[],scanQueryStatus:[]};
  const raw={async trackQuery(codes){calls++;active++;maxActive=Math.max(maxActive,active);assert.ok(codes.length<=50);await new Promise(r=>setTimeout(r,35));active--;return codes.map(shipmentCode=>({shipmentCode}));}};
  const client=createUnifiedThroughputClient(state,raw,{trackConcurrency:4}),batches=splitFixedBatches(bills,50),started=performance.now();
  assert.equal(client.__ceQcThroughputPools.track.planMode,businessType==='SHOPEE'?'stable-filter':'compact-pending');
  for(const batch of batches)assert.equal((await client.trackQuery(batch)).length,batch.length);
  const elapsed=performance.now()-started;
  assert.equal(calls,batches.length);assert.equal(maxActive,4,`${businessType} track must actually reach x4 bounded concurrency`);assert.ok(elapsed<340,`${businessType} 14x35ms track batches should be prefetched x4, got ${elapsed.toFixed(1)}ms`);
  return elapsed;
}
const shopeeTrack=await trackCase('SHOPEE');const ccslTrack=await trackCase('CCSL');

async function confirmCase(businessType,expectedConcurrency){
  const bills=Array.from({length:700},(_,i)=>`${businessType}-C-${String(i+1).padStart(4,'0')}`),batches=splitFixedBatches(bills,350);let active=0,maxActive=0,calls=0;
  const raw={async confirmQuery(codes){calls++;active++;maxActive=Math.max(maxActive,active);assert.ok(codes.length<=350);await new Promise(r=>setTimeout(r,25));active--;return codes.map(shipmentCode=>({shipmentCode,orderStatus:70}));}};
  const client=createUnifiedThroughputClient({businessType,scanPool:bills,scanQueryStatus:[]},raw,{confirmConcurrency:expectedConcurrency,hardBudgetMs:500});
  for(const batch of batches)assert.equal((await client.confirmQuery(batch)).length,batch.length);
  assert.equal(calls,2);assert.equal(maxActive,expectedConcurrency,`${businessType} confirm concurrency mismatch`);
}
await confirmCase('SHOPEE',2);await confirmCase('CCSL',1);

// Confirm transport fallback remains bounded and inside the single remote lane.
{
  const bills=Array.from({length:700},(_,i)=>`CCSL-F-${String(i+1).padStart(4,'0')}`);
  let active=0,maxActive=0,failedParent=false;const calls=[];
  const raw={async confirmQuery(codes){
    active++;maxActive=Math.max(maxActive,active);calls.push([...codes]);await new Promise(r=>setTimeout(r,8));active--;
    if(!failedParent&&codes.length===350&&codes[0]===bills[0]){failedParent=true;throw new Error('synthetic parent failure');}
    return codes.map(shipmentCode=>({shipmentCode,orderStatus:70}));
  }};
  const client=createCcslThroughputClient({businessType:'CCSL',scanPool:bills,scanQueryStatus:[]},raw,{confirmConcurrency:1,hardBudgetMs:1200});
  const result=await queryBatchWithFallback({batch:bills.slice(0,350),query:codes=>client.confirmQuery(codes),apiName:'otwms-order-confirm-query',fallbackSizes:[100,50,10,1],transientRetries:0,batchTimeBudgetMs:1200});
  assert.equal(result.failures.length,0);assert.equal(result.successes.flatMap(x=>x.batch).length,350);
  assert.equal(maxActive,1,'CCSL confirm fallback children must remain inside the single remote lane');
  assert.ok(calls.some(c=>c.length===100),'synthetic failed 350 batch must exercise confirm fallback children');
}

// Trajectory no longer recursively degrades 50 -> 25 -> 10 -> 5 -> 1. One failed
// 50-ticket unit is checkpointed once and handed to the retry center while other
// prefetched 50-ticket units continue under the same x4 limiter.
{
  const bills=Array.from({length:300},(_,i)=>`CCSL-TF-${String(i+1).padStart(4,'0')}`);
  let active=0,maxActive=0,failedParent=false;const callSizes=[];
  const raw={async trackQuery(codes){
    active++;maxActive=Math.max(maxActive,active);callSizes.push(codes.length);await new Promise(r=>setTimeout(r,10));active--;
    if(!failedParent&&codes.length===50&&codes[0]===bills[0]){failedParent=true;throw new Error('synthetic track parent failure');}
    return codes.map(shipmentCode=>({shipmentCode}));
  }};
  const client=createCcslThroughputClient({businessType:'CCSL',needTrackBills:bills,trackQueryStatus:[]},raw,{trackConcurrency:4});
  const result=await queryTrackBatchWithFallback({batch:bills.slice(0,50),query:codes=>client.trackQuery(codes),transientRetries:0,batchTimeBudgetMs:1500});
  assert.equal(result.failures.length,1,'failed trajectory unit must go directly to retry center');
  assert.equal(result.failures[0].batch.length,50);
  assert.equal(callSizes.includes(25),false,'trajectory must never recursively split to 25');
  assert.ok(maxActive<=4,`track requests must never exceed x4, observed ${maxActive}`);
}

{
  const bills=Array.from({length:120},(_,i)=>`CCSL-R-${String(i+1).padStart(4,'0')}`);
  const completed=bills.slice(0,10);const rawCalls=[];
  const state={businessType:'CCSL',needTrackBills:bills,trackQueryStatus:completed.map(shipmentCode=>({shipmentCode,status:'success'}))};
  const raw={async trackQuery(codes){rawCalls.push([...codes]);await new Promise(r=>setTimeout(r,5));return codes.map(shipmentCode=>({shipmentCode}));}};
  const client=createCcslThroughputClient(state,raw,{trackConcurrency:4});
  const pending=bills.filter(code=>!completed.includes(code));const expected=splitFixedBatches(pending,50);
  for(const batch of expected)await client.trackQuery(batch);
  assert.deepEqual(rawCalls.map(batch=>batch.join('|')).sort(),expected.map(batch=>batch.join('|')).sort(),'CCSL resumed track prefetch must use exact compact-pending boundaries');
  const flattened=rawCalls.flat();assert.equal(new Set(flattened).size,flattened.length,'CCSL resume must not duplicate trajectory tickets');
}

const aliasRaw={async trackQuery(codes){return codes.map(shipmentCode=>({shipmentCode}));}};
assert.ok(createShopeeThroughputClient({businessType:'SHOPEE',needTrackBills:['A']},aliasRaw).__ceQcThroughputPools.track);
assert.ok(createCcslThroughputClient({businessType:'CCSL',needTrackBills:['B']},aliasRaw).__ceQcThroughputPools.track);
console.log(`[CORE THROUGHPUT] unversioned runtime owners passed · scan=350 · SHOPEE confirm x2 · CCSL confirm x1 · track=50x4 · failed trajectory stays one 50-ticket retry unit · active SQLite checkpoints zero-wait/final-only · synthetic track ${shopeeTrack.toFixed(1)}/${ccslTrack.toFixed(1)}ms`);
