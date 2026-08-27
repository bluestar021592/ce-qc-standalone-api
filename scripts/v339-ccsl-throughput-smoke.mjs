import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { createCcslThroughputClient,V339_CCSL_CONFIRM_CONCURRENCY,V339_CCSL_THROUGHPUT_CORE_ID } from '../src/v339CcslThroughputCore.js';
import { shouldUseCcslLightCheckpoint,V340_CCSL_FAST_CHECKPOINT_ID } from '../src/v340CcslStorageCheckpoint.js';
import { resolveV314Target } from '../src/v314ModuleRedirectPatch.js';

for(const file of ['src/v339CcslThroughputCore.js','src/v314ShopeeThroughputCore.js','src/v340CcslStorageCheckpoint.js','src/v314PipelineThroughput.js','src/v314ModuleRedirectPatch.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.equal(V339_CCSL_CONFIRM_CONCURRENCY,1);assert.match(V339_CCSL_THROUGHPUT_CORE_ID,/v340-ccsl-single-lane-rolling-prefetch/);assert.match(V340_CCSL_FAST_CHECKPOINT_ID,/v341-ccsl-light-checkpoint-fail-open/);assert.match(resolveV314Target('./src/storage.js','file:///C:/CE/app/server.js'),/v340CcslStorageCheckpoint\.js$/);
const compat=fs.readFileSync('src/v339CcslThroughputCore.js','utf8'),wrapper=fs.readFileSync('src/v314PipelineThroughput.js','utf8'),checkpoint=fs.readFileSync('src/v340CcslStorageCheckpoint.js','utf8');
assert.match(compat,/Compatibility module only/);assert.doesNotMatch(compat,/function createCcslThroughputClient/,'legacy V339 file must not own duplicate throughput logic');assert.match(wrapper,/createUnifiedThroughputClient/);assert.match(wrapper,/trackConcurrency:4/);assert.match(wrapper,/scanBatchSize:350/);assert.match(wrapper,/trackBatchSize:50/);assert.match(checkpoint,/SCAN_FULL_MIRROR_STRIDE=4/);assert.match(checkpoint,/TRACK_FULL_MIRROR_STRIDE=8/);assert.match(checkpoint,/FAIL_OPEN_BUSINESS_PIPELINE_CONTINUES/);
assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'订单扫描',batchIndex:1,totalBatches:7}}),true);assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'订单扫描',batchIndex:4,totalBatches:7}}),false);assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'轨迹查询',batchIndex:8,totalBatches:20}}),false);

const scanBills=Array.from({length:700},(_,i)=>`C${String(i+1).padStart(4,'0')}`);let scanActive=0,scanMax=0;
const scanClient=createCcslThroughputClient({businessType:'CCSL',scanPool:scanBills,scanQueryStatus:[]},{async confirmQuery(codes){scanActive++;scanMax=Math.max(scanMax,scanActive);assert.ok(codes.length<=350);await new Promise(r=>setTimeout(r,25));scanActive--;return codes.map(shipmentCode=>({shipmentCode}));}},{confirmConcurrency:1,hardBudgetMs:500});
for(let i=0;i<scanBills.length;i+=350)await scanClient.confirmQuery(scanBills.slice(i,i+350));assert.equal(scanMax,1,'CCSL confirm must remain one remote 350 lane');

const trackBills=Array.from({length:670},(_,i)=>`T${String(i+1).padStart(4,'0')}`);let active=0,maxActive=0,calls=0;
const trackClient=createCcslThroughputClient({businessType:'CCSL',needTrackBills:trackBills,trackQueryStatus:[]},{async trackQuery(codes){calls++;active++;maxActive=Math.max(maxActive,active);assert.ok(codes.length<=50);await new Promise(r=>setTimeout(r,35));active--;return codes.map(shipmentCode=>({shipmentCode}));}},{trackConcurrency:4});
const started=performance.now();for(let i=0;i<trackBills.length;i+=50)await trackClient.trackQuery(trackBills.slice(i,i+50));const elapsed=performance.now()-started;assert.equal(calls,14);assert.equal(maxActive,4,'CCSL track must use 50-ticket x4 bounded prefetch');assert.ok(elapsed<320);
console.log(`[V343/V341] CCSL compatibility smoke passed · active owner is unified · scan 350 single remote lane · track 50x4 · storage checkpoints remain fail-open · ${elapsed.toFixed(1)}ms synthetic`);
