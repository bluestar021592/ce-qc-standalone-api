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

for(const file of ['src/v314ShopeeThroughputCore.js','src/v314PipelineThroughput.js','src/v339CcslThroughputCore.js','src/v314ModuleRedirectPatch.js','src/v314BusinessStoreCheckpoint.js','src/trackBatching.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.match(V314_ALL_BUSINESS_THROUGHPUT_CORE_ID,/all-business-bounded-retry-350-scan-50x4-track/);
assert.equal(V314_CONFIRM_CONCURRENCY,2,'Shopee confirm keeps bounded x2');
assert.equal(V339_CCSL_CONFIRM_CONCURRENCY,1,'CCSL confirm remains one remote 350 lane');
assert.match(resolveV314Target('./src/pipeline.js','file:///C:/CE/app/server.js'),/v314PipelineThroughput\.js$/);
assert.match(resolveV314Target('./src/businessStore.js','file:///C:/CE/app/server.js'),/v314BusinessStoreCheckpoint\.js$/);
const wrapper=fs.readFileSync('src/v314PipelineThroughput.js','utf8'),compat=fs.readFileSync('src/v339CcslThroughputCore.js','utf8'),core=fs.readFileSync('src/v314ShopeeThroughputCore.js','utf8'),store=fs.readFileSync('src/v314BusinessStoreCheckpoint.js','utf8');
assert.match(wrapper,/createUnifiedThroughputClient/,'production must have one throughput owner');
assert.match(wrapper,/createUnifiedThroughputClient\(state,options\.client,\{trackConcurrency:4\}\)/,'production must force 50-ticket tracking to x4 even if a legacy environment still says TRACK_CONCURRENCY=1');
assert.doesNotMatch(wrapper,/createShopeeThroughputClient|createCcslThroughputClient/,'production wrapper must not branch into layered business-specific throughput implementations');
assert.match(wrapper,/scanBatchSize:350/);assert.match(wrapper,/trackBatchSize:50/);assert.match(wrapper,/trackConcurrency:4/);
assert.match(compat,/Compatibility module only/);assert.doesNotMatch(compat,/function createCcslThroughputClient/,'old CCSL file must be a compatibility re-export, not a second implementation');
assert.doesNotMatch(core,/if\(!plannedKeys\.has\(key\)\)return query\(batch\)/,'fallback/on-demand requests must never bypass the bounded scheduler');
assert.match(core,/enqueue\(batch,!plannedKeys\.has\(key\)\)/,'fallback/on-demand requests must enter the same scheduler with priority');
assert.match(core,/planMode:isShopee\?'stable-filter':'compact-pending'/,'CCSL track resume must compact pending tickets exactly like pipeline.js');

// SHOPEE runtime persistence must not become a second throughput limiter. Every
// active save is a tiny zero-wait checkpoint; only pause/error/final boundaries
// may enter the authoritative full business mirror.
assert.match(store,/DatabaseSync/,'SHOPEE progress checkpoints must use a dedicated SQLite connection');
assert.match(store,/PRAGMA busy_timeout = 0/,'SHOPEE progress writes must never wait on the main writer lock');
assert.match(store,/inRunFullMirror: false/,'active SHOPEE processing must never perform periodic full mirrors');
assert.match(store,/authoritativeFullMirrorPolicy: 'PAUSE_ERROR_OR_FINAL_ONLY'/);
assert.match(store,/export function loadBusinessState/,'active pause reads must be served by the V314 owner');
assert.match(store,/liveState\?\.processing\?\.running/,'active SHOPEE pause polling must use in-memory state');
assert.match(store,/if \(shouldUseLightCheckpoint\(state, type\)\) return lightCheckpoint\(state, type\)/);
assert.match(store,/ZERO_WAIT_FAIL_OPEN_NEVER_ABORT_SHOPEE/,'progress SQLite contention must not abort CE API processing');
assert.match(store,/finalMirrorFailurePolicy: 'FAIL_CLOSED'/,'authoritative final persistence must remain fail-closed');
assert.doesNotMatch(store,/scanFullMirrorEveryBatches|eventExceptionFullMirrorEveryBatches/,'old 2-scan/4-track full mirror cadence must be retired');
assert.doesNotMatch(store,/shouldUseFastCheckpoint/,'legacy stride selector must no longer own runtime persistence');
assert.doesNotMatch(store,/BEGIN IMMEDIATE/,'progress checkpoint path must not grab an immediate SQLite writer lock');

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

// A failed 350-ticket CCSL request used to degrade to 100/50/10/1 through the raw
// client, outside the x1 owner. Reproduce that path and prove every child stays in
// the same single remote lane even while the next 350-ticket batch is prefetched.
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
  assert.ok(calls.some(c=>c.length===100),'synthetic failed 350 batch must actually exercise fallback children');
  assert.ok(calls.every(c=>c.length<=350));
}

// Track fallback children must also remain under the x4 owner. This exercises the
// generic CCSL 50 -> 25 fallback while several future 50-ticket requests are already
// being prefetched.
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
  assert.equal(result.failures.length,0);assert.equal(result.successes.flatMap(x=>x.batch).length,50);
  assert.ok(callSizes.includes(25),'synthetic failed 50 batch must exercise 25-ticket fallback');
  assert.ok(maxActive<=4,`track fallback must never exceed x4, observed ${maxActive}`);
}

// CCSL resumes by removing successful tickets before splitting into 50s. The pool
// must use the same compact-pending boundary or its speculative batches overlap the
// actual resumed requests and can query the same ticket twice.
{
  const bills=Array.from({length:120},(_,i)=>`CCSL-R-${String(i+1).padStart(4,'0')}`);
  const completed=bills.slice(0,10);const rawCalls=[];
  const state={businessType:'CCSL',needTrackBills:bills,trackQueryStatus:completed.map(shipmentCode=>({shipmentCode,status:'success'}))};
  const raw={async trackQuery(codes){rawCalls.push([...codes]);await new Promise(r=>setTimeout(r,5));return codes.map(shipmentCode=>({shipmentCode}));}};
  const client=createCcslThroughputClient(state,raw,{trackConcurrency:4});
  const pending=bills.filter(code=>!completed.includes(code));const expected=splitFixedBatches(pending,50);
  for(const batch of expected)await client.trackQuery(batch);
  assert.deepEqual(rawCalls.map(batch=>batch.join('|')).sort(),expected.map(batch=>batch.join('|')).sort(),'CCSL resumed track prefetch must use the exact compact-pending 50-ticket boundaries');
  const flattened=rawCalls.flat();assert.equal(new Set(flattened).size,flattened.length,'CCSL resume must not duplicate track tickets across overlapping prefetch batches');
}

const aliasRaw={async trackQuery(codes){return codes.map(shipmentCode=>({shipmentCode}));}};
assert.ok(createShopeeThroughputClient({businessType:'SHOPEE',needTrackBills:['A']},aliasRaw).__ceQcThroughputPools.track);
assert.ok(createCcslThroughputClient({businessType:'CCSL',needTrackBills:['B']},aliasRaw).__ceQcThroughputPools.track);
console.log(`[V345] all-business throughput + SHOPEE final-only checkpoint smoke passed · scan=350 for all · SHOPEE confirm x2 · CCSL confirm single lane including fallback · track=50x4 including fallback · SHOPEE active SQLite checkpoint zero-wait/fail-open · synthetic track ${shopeeTrack.toFixed(1)}/${ccslTrack.toFixed(1)}ms`);
