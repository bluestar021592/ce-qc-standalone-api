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
  V314_EVENT_CONCURRENCY,
  V314_CONFIRM_CONCURRENCY,
  V339_CCSL_CONFIRM_CONCURRENCY
} from '../src/v314ShopeeThroughputCore.js';
import { resolveV314Target } from '../src/v314ModuleRedirectPatch.js';

for(const file of ['src/v314ShopeeThroughputCore.js','src/v314PipelineThroughput.js','src/v339CcslThroughputCore.js','src/v314ModuleRedirectPatch.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.match(V314_ALL_BUSINESS_THROUGHPUT_CORE_ID,/all-business-350-scan-50x4-track/);
assert.equal(V314_EVENT_CONCURRENCY,4,'all-business track prefetch must default to four 50-ticket requests');
assert.equal(V314_CONFIRM_CONCURRENCY,2,'Shopee confirm keeps bounded x2');
assert.equal(V339_CCSL_CONFIRM_CONCURRENCY,1,'CCSL confirm remains one remote 350 lane');
assert.match(resolveV314Target('./src/pipeline.js','file:///C:/CE/app/server.js'),/v314PipelineThroughput\.js$/);
const wrapper=fs.readFileSync('src/v314PipelineThroughput.js','utf8'),compat=fs.readFileSync('src/v339CcslThroughputCore.js','utf8');
assert.match(wrapper,/createUnifiedThroughputClient/,'production must have one throughput owner');
assert.doesNotMatch(wrapper,/createShopeeThroughputClient|createCcslThroughputClient/,'production wrapper must not branch into layered business-specific throughput implementations');
assert.match(wrapper,/scanBatchSize:350/);assert.match(wrapper,/trackBatchSize:50/);assert.match(wrapper,/trackConcurrency:V314_EVENT_CONCURRENCY/);
assert.match(compat,/Compatibility module only/);assert.doesNotMatch(compat,/function createCcslThroughputClient/,'old CCSL file must be a compatibility re-export, not a second implementation');

async function trackCase(businessType){
  const bills=Array.from({length:670},(_,i)=>`${businessType}-${String(i+1).padStart(4,'0')}`);let active=0,maxActive=0,calls=0;
  const state={businessType,needTrackBills:bills,eventQueryStatus:[],trackQueryStatus:[],scanPool:[],scanQueryStatus:[]};
  const raw={async trackQuery(codes){calls++;active++;maxActive=Math.max(maxActive,active);assert.ok(codes.length<=50);await new Promise(r=>setTimeout(r,35));active--;return codes.map(shipmentCode=>({shipmentCode}));}};
  const client=createUnifiedThroughputClient(state,raw,{trackConcurrency:4}),batches=splitFixedBatches(bills,50),started=performance.now();
  for(const batch of batches)assert.equal((await client.trackQuery(batch)).length,batch.length);
  const elapsed=performance.now()-started;
  assert.equal(calls,batches.length);assert.equal(maxActive,4,`${businessType} track must actually reach x4 bounded concurrency`);assert.ok(elapsed<320,`${businessType} 14x35ms track batches should be prefetched x4, got ${elapsed.toFixed(1)}ms`);
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

// Compatibility aliases must route into the exact same core behavior.
const aliasRaw={async trackQuery(codes){return codes.map(shipmentCode=>({shipmentCode}));}};
assert.ok(createShopeeThroughputClient({businessType:'SHOPEE',needTrackBills:['A']},aliasRaw).__ceQcThroughputPools.track);
assert.ok(createCcslThroughputClient({businessType:'CCSL',needTrackBills:['B']},aliasRaw).__ceQcThroughputPools.track);
console.log(`[V343] all-business throughput smoke passed · scan=350 for all · SHOPEE confirm x2 · CCSL confirm single lane · track=50x4 for SHOPEE and CCSL · synthetic track ${shopeeTrack.toFixed(1)}/${ccslTrack.toFixed(1)}ms`);
