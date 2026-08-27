import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import {
  createCcslThroughputClient,
  V339_CCSL_CONFIRM_CONCURRENCY,
  V339_CCSL_THROUGHPUT_CORE_ID
} from '../src/v339CcslThroughputCore.js';

for(const file of ['src/v339CcslThroughputCore.js','src/v314PipelineThroughput.js','src/pipeline.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.equal(V339_CCSL_CONFIRM_CONCURRENCY,2,'CCSL confirm prefetch must default to two 350-ticket requests');
assert.match(V339_CCSL_THROUGHPUT_CORE_ID,/v339-ccsl-hard-bounded-confirm-prefetch/);

const wrapper=fs.readFileSync('src/v314PipelineThroughput.js','utf8');
const pipeline=fs.readFileSync('src/pipeline.js','utf8');
assert.match(wrapper,/createCcslThroughputClient/,'production pipeline wrapper must activate V339 for CCSL');
assert.match(wrapper,/scanBatchSize:\s*350/);
assert.match(wrapper,/scanConcurrency:\s*V339_CCSL_CONFIRM_CONCURRENCY/);
assert.match(wrapper,/trackBatchSize:\s*50/);
assert.match(wrapper,/V339_CCSL_THROUGHPUT/,'startup log must expose the live CCSL throughput owner');
assert.match(pipeline,/const ORDER_BATCH_SIZE = Number\(process\.env\.ORDER_BATCH_SIZE \|\| 350\)/);
assert.match(pipeline,/Promise\.all\(Array\.from\(\{ length: Math\.max\(1, TRACK_CONCURRENCY\) \}/,'CCSL trajectory must retain native bounded worker concurrency');

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
},{confirmConcurrency:2,hardBudgetMs:1000});
const batches=[];for(let i=0;i<bills.length;i+=350)batches.push(bills.slice(i,i+350));
const started=performance.now();
for(const batch of batches){
  const rows=await client.confirmQuery(batch);
  assert.equal(rows.length,batch.length);
}
const elapsed=performance.now()-started;
assert.equal(calls,4,'four primary 350-ticket CCSL batches must hit CE once on success');
assert.equal(maxActive,2,'CCSL scan must have exactly two primary batches in flight when backlog exists');
assert.ok(elapsed<400,`4x120ms CCSL batches should finish near two waves instead of four serial waves; elapsed=${elapsed.toFixed(1)}ms`);

// Resume must preserve the native stable 350-ticket source slices. Completed bills
// are removed inside their original slice; pending bills must never be compacted
// across slice boundaries because that would break checkpoint/retry identity.
const resumeBills=Array.from({length:800},(_,i)=>`R${String(i+1).padStart(4,'0')}`);
const completed=resumeBills.slice(0,100).map(shipmentCode=>({shipmentCode,status:'success'}));
const resumeCalls=[];
const resumeClient=createCcslThroughputClient({businessType:'CCSL',scanPool:resumeBills,scanQueryStatus:completed},{
  async confirmQuery(codes){resumeCalls.push([...codes]);return codes.map(shipmentCode=>({shipmentCode}));}
},{confirmConcurrency:2,hardBudgetMs:500});
const expected=[resumeBills.slice(100,350),resumeBills.slice(350,700),resumeBills.slice(700,800)];
for(const batch of expected)await resumeClient.confirmQuery(batch);
assert.deepEqual(resumeCalls.map(row=>row.join(',')),expected.map(row=>row.join(',')),'CCSL resume prefetch must exactly match native stable batch shapes');

// A prefetched request that never settles must release its orchestration slot by
// the same hard-budget concept used by V337/V338. Later batches still execute and
// the failed primary batch remains visible to native queryBatchWithFallback.
const hangBills=Array.from({length:1050},(_,i)=>`H${String(i+1).padStart(4,'0')}`);
const hangCalls=[];
const hangClient=createCcslThroughputClient({businessType:'CCSL',scanPool:hangBills,scanQueryStatus:[]},{
  async confirmQuery(codes){
    hangCalls.push(codes[0]);
    if(codes[0]==='H0351')return new Promise(()=>{});
    await new Promise(resolve=>setTimeout(resolve,20));
    return codes.map(shipmentCode=>({shipmentCode}));
  }
},{confirmConcurrency:2,hardBudgetMs:100});
const h1=hangBills.slice(0,350),h2=hangBills.slice(350,700),h3=hangBills.slice(700,1050);
assert.equal((await hangClient.confirmQuery(h1)).length,350);
await assert.rejects(()=>hangClient.confirmQuery(h2),error=>error?.code==='V339_CCSL_PREFETCH_HARD_TIMEOUT');
assert.equal((await hangClient.confirmQuery(h3)).length,350,'third 350-ticket batch must complete even when prefetched second batch never settles');
assert.ok(hangCalls.includes('H0701'),'later primary batch must actually reach the CE client after the hung prefetch budget expires');

console.log(`[V339] CCSL throughput smoke passed · scan=350x2 prefetch · synthetic ${elapsed.toFixed(1)}ms vs ~480ms serial · stable checkpoint resume shapes preserved · hung prefetched batch hard-released · native track=50x4 retained`);
