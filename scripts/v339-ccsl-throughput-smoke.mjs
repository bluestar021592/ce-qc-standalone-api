import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import {
  createCcslThroughputClient,
  V339_CCSL_CONFIRM_CONCURRENCY,
  V339_CCSL_THROUGHPUT_CORE_ID
} from '../src/v339CcslThroughputCore.js';
import { shouldUseCcslLightCheckpoint, V340_CCSL_FAST_CHECKPOINT_ID } from '../src/v340CcslStorageCheckpoint.js';
import { resolveV314Target } from '../src/v314ModuleRedirectPatch.js';

for(const file of ['src/v339CcslThroughputCore.js','src/v340CcslStorageCheckpoint.js','src/v314PipelineThroughput.js','src/v314ModuleRedirectPatch.js','src/pipeline.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.equal(V339_CCSL_CONFIRM_CONCURRENCY,1,'CCSL confirm remote lane must default to exactly one 350-ticket request');
assert.match(V339_CCSL_THROUGHPUT_CORE_ID,/v340-ccsl-single-lane-rolling-prefetch/);
assert.match(V340_CCSL_FAST_CHECKPOINT_ID,/v341-ccsl-light-checkpoint-fail-open/);
assert.match(resolveV314Target('./src/storage.js','file:///C:/CE/app/server.js'),/v340CcslStorageCheckpoint\.js$/,'production server must use lightweight CCSL storage checkpoints');

const wrapper=fs.readFileSync('src/v314PipelineThroughput.js','utf8');
const pipeline=fs.readFileSync('src/pipeline.js','utf8');
const checkpointWrapper=fs.readFileSync('src/v340CcslStorageCheckpoint.js','utf8');
assert.match(wrapper,/createCcslThroughputClient/,'production pipeline wrapper must activate CCSL rolling prefetch');
assert.match(wrapper,/scanBatchSize:\s*350/);
assert.match(wrapper,/scanRemoteConcurrency:\s*V339_CCSL_CONFIRM_CONCURRENCY/);
assert.match(wrapper,/trackBatchSize:\s*50/);
assert.match(wrapper,/V340_CCSL_THROUGHPUT/,'startup log must expose the live V340 CCSL throughput owner');
assert.match(checkpointWrapper,/SCAN_FULL_MIRROR_STRIDE=4/);
assert.match(checkpointWrapper,/TRACK_FULL_MIRROR_STRIDE=8/);
assert.match(checkpointWrapper,/run_locks/);
assert.match(checkpointWrapper,/run_checkpoints/);
assert.match(checkpointWrapper,/FAIL_OPEN_BUSINESS_PIPELINE_CONTINUES/,'light checkpoint failures must never abort CCSL');
assert.match(checkpointWrapper,/V341_CCSL_CHECKPOINT_SKIPPED/,'skipped checkpoint must remain observable');
const lightBody=checkpointWrapper.slice(checkpointWrapper.indexOf('function lightCheckpoint'),checkpointWrapper.indexOf('export async function saveState'));
assert.doesNotMatch(lightBody,/BEGIN IMMEDIATE|ROLLBACK|throw error/,'light progress persistence must not own a SQLite transaction or throw into the QC pipeline');
assert.match(pipeline,/const ORDER_BATCH_SIZE = Number\(process\.env\.ORDER_BATCH_SIZE \|\| 350\)/);
assert.match(pipeline,/Promise\.all\(Array\.from\(\{ length: Math\.max\(1, TRACK_CONCURRENCY\) \}/,'CCSL trajectory must retain native bounded worker concurrency');

assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'订单扫描',batchIndex:1,totalBatches:7}}),true);
assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'订单扫描',batchIndex:4,totalBatches:7}}),false,'every fourth scan batch must persist full truth');
assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'订单扫描',batchIndex:7,totalBatches:7}}),false,'final scan batch must persist full truth');
assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'轨迹查询',batchIndex:7,totalBatches:20}}),true);
assert.equal(shouldUseCcslLightCheckpoint({processing:{running:true,phase:'轨迹查询',batchIndex:8,totalBatches:20}}),false,'every eighth track batch must persist full truth');

// Four 350-ticket requests stay strictly single-lane at the CE endpoint, while
// the next request is already rolling during simulated local checkpoint work.
const bills=Array.from({length:1400},(_,i)=>`WB${String(i+1).padStart(4,'0')}`);
let active=0,maxActive=0,calls=0;
const state={businessType:'CCSL',scanPool:bills,scanQueryStatus:[]};
const client=createCcslThroughputClient(state,{
  async confirmQuery(codes){
    calls+=1;active+=1;maxActive=Math.max(maxActive,active);
    assert.ok(codes.length<=350);
    await new Promise(resolve=>setTimeout(resolve,120));
    active-=1;
    return codes.map(shipmentCode=>({shipmentCode,orderStatus:70}));
  }
},{confirmConcurrency:1,hardBudgetMs:1000});
const batches=[];for(let i=0;i<bills.length;i+=350)batches.push(bills.slice(i,i+350));
const started=performance.now();
for(let i=0;i<batches.length;i+=1){
  const rows=await client.confirmQuery(batches[i]);
  assert.equal(rows.length,batches[i].length);
  if(i<batches.length-1)await new Promise(resolve=>setTimeout(resolve,80));
}
const elapsed=performance.now()-started;
assert.equal(calls,4,'four primary 350-ticket CCSL batches must hit CE once on success');
assert.equal(maxActive,1,'CCSL remote confirm must never overlap two 350-ticket calls');
assert.ok(elapsed<650,`rolling single-lane prefetch should overlap local checkpoint work; elapsed=${elapsed.toFixed(1)}ms`);

const resumeBills=Array.from({length:800},(_,i)=>`R${String(i+1).padStart(4,'0')}`);
const completed=resumeBills.slice(0,100).map(shipmentCode=>({shipmentCode,status:'success'}));
const resumeCalls=[];
const resumeClient=createCcslThroughputClient({businessType:'CCSL',scanPool:resumeBills,scanQueryStatus:completed},{
  async confirmQuery(codes){resumeCalls.push([...codes]);return codes.map(shipmentCode=>({shipmentCode}));}
},{confirmConcurrency:1,hardBudgetMs:500});
const expected=[resumeBills.slice(100,350),resumeBills.slice(350,700),resumeBills.slice(700,800)];
for(const batch of expected)await resumeClient.confirmQuery(batch);
assert.deepEqual(resumeCalls.map(row=>row.join(',')),expected.map(row=>row.join(',')),'CCSL resume rolling prefetch must exactly match native stable batch shapes');

const hangBills=Array.from({length:1050},(_,i)=>`H${String(i+1).padStart(4,'0')}`);
const hangCalls=[];
const hangClient=createCcslThroughputClient({businessType:'CCSL',scanPool:hangBills,scanQueryStatus:[]},{
  async confirmQuery(codes){
    hangCalls.push(codes[0]);
    if(codes[0]==='H0351')return new Promise(()=>{});
    await new Promise(resolve=>setTimeout(resolve,20));
    return codes.map(shipmentCode=>({shipmentCode}));
  }
},{confirmConcurrency:1,hardBudgetMs:100});
const h1=hangBills.slice(0,350),h2=hangBills.slice(350,700),h3=hangBills.slice(700,1050);
assert.equal((await hangClient.confirmQuery(h1)).length,350);
await assert.rejects(()=>hangClient.confirmQuery(h2),error=>error?.code==='V339_CCSL_PREFETCH_HARD_TIMEOUT');
assert.equal((await hangClient.confirmQuery(h3)).length,350,'third 350-ticket batch must complete after hung second batch is hard-released');
assert.ok(hangCalls.includes('H0701'),'later primary batch must reach CE after the hung rolling request budget expires');

console.log(`[V341] CCSL throughput smoke passed · scan=350 single remote lane + rolling prefetch · ${elapsed.toFixed(1)}ms with simulated checkpoint overlap · scan full mirror every 4 · track full mirror every 8 · lightweight checkpoint fail-open · hung batch fail-forward · native track=50x4 retained`);
