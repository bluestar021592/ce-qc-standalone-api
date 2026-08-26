import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import {
  createShopeeThroughputClient,
  splitFixedBatches,
  shouldUseFastCheckpoint,
  checkpointStrideForPhase,
  V314_EVENT_CONCURRENCY,
  V314_EXCEPTION_CONCURRENCY,
  V314_CONFIRM_CONCURRENCY
} from '../src/v314ShopeeThroughputCore.js';
import { resolveV314Target, V314_MODULE_REDIRECT_ID } from '../src/v314ModuleRedirectPatch.js';

for (const file of [
  'src/v314ShopeeThroughputCore.js',
  'src/v314PipelineThroughput.js',
  'src/v314BusinessStoreCheckpoint.js',
  'src/v314ModuleRedirectPatch.js'
]) execFileSync(process.execPath,['--check',file],{stdio:'pipe'});

assert.equal(V314_EVENT_CONCURRENCY,4,'SHOPEE event reads default to bounded concurrency 4');
assert.equal(V314_EXCEPTION_CONCURRENCY,4,'SHOPEE exception reads default to bounded concurrency 4');
assert.equal(V314_CONFIRM_CONCURRENCY,2,'SHOPEE confirm reads default to bounded concurrency 2');
assert.match(V314_MODULE_REDIRECT_ID,/v314/);
assert.match(resolveV314Target('./src/pipeline.js','file:///C:/CE/app/server.js'),/v314PipelineThroughput\.js$/);
assert.match(resolveV314Target('./src/businessStore.js','file:///C:/CE/app/server.js'),/v314BusinessStoreCheckpoint\.js$/);
assert.equal(resolveV314Target('./src/pipeline.js','file:///C:/CE/app/scripts/test.mjs'),'','only production server imports are redirected');

const pipelineWrapper=fs.readFileSync('src/v314PipelineThroughput.js','utf8');
const storeWrapper=fs.readFileSync('src/v314BusinessStoreCheckpoint.js','utf8');
const activation=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const nativePipeline=fs.readFileSync('src/pipeline.js','utf8');
const nativeStore=fs.readFileSync('src/businessStore.js','utf8');
assert.match(pipelineWrapper,/createShopeeThroughputClient/,'production pipeline wrapper must use bounded prefetch client');
assert.match(storeWrapper,/shouldUseFastCheckpoint/,'production business store wrapper must throttle heavy full mirrors');
assert.match(storeWrapper,/business_run_locks/,'light checkpoints must keep visible run progress current');
assert.match(storeWrapper,/business_run_checkpoints/,'light checkpoints must remain auditable');
assert.match(activation,/v314ModuleRedirectPatch\.js/,'V314 redirect must activate before server import');
assert.match(nativePipeline,/fallbackSizes:\s*\[\]/,'native SHOPEE 50-ticket fixed-size retry contract must remain intact');
assert.match(nativePipeline,/splitTrackBatches\(cleanAnyBills\(bills\)\)/,'native SHOPEE event\/exception batch size owner must remain intact');
assert.match(nativeStore,/DELETE FROM business_daily_parse_rows/,'smoke must guard the diagnosed heavy full-mirror path so V314 throttles rather than silently changing truth persistence');
assert.match(nativeStore,/DELETE FROM business_track_events/,'full checkpoints must still preserve canonical normalized event tables');

const bills=Array.from({length:670},(_,index)=>`WB${String(index+1).padStart(4,'0')}`);
let active=0,maxActive=0,calls=0;
const fakeClient={
  async trackQuery(codes){
    calls+=1;active+=1;maxActive=Math.max(maxActive,active);
    assert.ok(codes.length<=50,'event request must never exceed 50 tickets');
    await new Promise(resolve=>setTimeout(resolve,40));
    active-=1;
    return codes.map(shipmentCode=>({shipmentCode,eventTime:'2026-08-02 12:00:00'}));
  },
  async exceptionQuery(codes){assert.ok(codes.length<=50);return codes.map(shipmentCode=>({shipmentCode}));},
  async confirmQuery(codes){assert.ok(codes.length<=350);return codes.map(shipmentCode=>({shipmentCode,orderStatus:70}));}
};
const state={businessType:'SHOPEE',needTrackBills:bills,eventQueryStatus:[],exceptionQueryStatus:[],scanPool:bills,scanQueryStatus:[]};
const client=createShopeeThroughputClient(state,fakeClient,{eventConcurrency:4,exceptionConcurrency:4,confirmConcurrency:2});
const batches=splitFixedBatches(bills,50);
const started=performance.now();
for(const batch of batches){
  const rows=await client.trackQuery(batch);
  assert.equal(rows.length,batch.length);
}
const elapsed=performance.now()-started;
assert.equal(calls,batches.length,'each exact 50-ticket primary event batch must hit remote once on success');
assert.ok(maxActive<=4&&maxActive>=3,`event concurrency must be bounded at four, observed ${maxActive}`);
assert.ok(elapsed<350,`14 synthetic 40ms batches should complete via bounded prefetch, elapsed ${elapsed.toFixed(1)}ms`);

let failOnce=true,retryCalls=0;
const retryState={businessType:'SHOPEE',needTrackBills:['A','B'],eventQueryStatus:[]};
const retryClient=createShopeeThroughputClient(retryState,{
  async trackQuery(codes){
    retryCalls+=1;
    if(failOnce){failOnce=false;throw Object.assign(new Error('ETIMEDOUT'),{code:'ETIMEDOUT'});}
    return codes.map(shipmentCode=>({shipmentCode}));
  }
},{eventConcurrency:1});
await assert.rejects(()=>retryClient.trackQuery(['A','B']),/ETIMEDOUT/);
assert.equal((await retryClient.trackQuery(['A','B'])).length,2);
assert.equal(retryCalls,2,'failed prefetch must remain retryable and never become a false success cache');

// Resume shapes must match the native pipeline exactly. Confirm-query compacts all
// unfinished bills before slicing 350; event/exception keep stable 50-ticket chunks
// and remove only already-completed bills inside each chunk.
const resumeCodes=Array.from({length:400},(_,index)=>`R${String(index+1).padStart(4,'0')}`);
const confirmDone=resumeCodes.slice(0,10).map(shipmentCode=>({shipmentCode,status:'success'}));
const eventDone=resumeCodes.slice(0,5).map(shipmentCode=>({shipmentCode,status:'success'}));
const resumeCalls=[];
const resumeState={businessType:'SHOPEE',scanPool:resumeCodes,scanQueryStatus:confirmDone,needTrackBills:resumeCodes,eventQueryStatus:eventDone,exceptionQueryStatus:[]};
const resumeClient=createShopeeThroughputClient(resumeState,{
  async confirmQuery(codes){resumeCalls.push(['confirm',codes]);return codes.map(shipmentCode=>({shipmentCode}));},
  async trackQuery(codes){resumeCalls.push(['event',codes]);return codes.map(shipmentCode=>({shipmentCode}));},
  async exceptionQuery(codes){return codes.map(shipmentCode=>({shipmentCode}));}
},{confirmConcurrency:2,eventConcurrency:4});
const confirmDoneSet=new Set(confirmDone.map(row=>row.shipmentCode));
const expectedConfirm=splitFixedBatches(resumeCodes.filter(code=>!confirmDoneSet.has(code)),350);
for(const batch of expectedConfirm) await resumeClient.confirmQuery(batch);
const actualConfirm=resumeCalls.filter(([kind])=>kind==='confirm').map(([,codes])=>codes.join(','));
assert.deepEqual(actualConfirm.sort(),expectedConfirm.map(codes=>codes.join(',')).sort(),'partial confirm resume must not prefetch overlapping stale 350-ticket shapes');
const eventDoneSet=new Set(eventDone.map(row=>row.shipmentCode));
const expectedEvent=splitFixedBatches(resumeCodes,50).map(batch=>batch.filter(code=>!eventDoneSet.has(code))).filter(batch=>batch.length);
for(const batch of expectedEvent) await resumeClient.trackQuery(batch);
const actualEvent=resumeCalls.filter(([kind])=>kind==='event').map(([,codes])=>codes.join(','));
assert.deepEqual(actualEvent.sort(),expectedEvent.map(codes=>codes.join(',')).sort(),'partial event resume must preserve native stable 50-ticket chunks without duplicate requests');

assert.equal(checkpointStrideForPhase('tms-shipment-event-query'),4);
assert.equal(checkpointStrideForPhase('exception-item-query'),4);
assert.equal(checkpointStrideForPhase('SHOPEE订单扫描'),2);
assert.equal(shouldUseFastCheckpoint({businessType:'SHOPEE',processing:{running:true,phase:'tms-shipment-event-query',batchIndex:1,totalBatches:14}},'SHOPEE'),true);
assert.equal(shouldUseFastCheckpoint({businessType:'SHOPEE',processing:{running:true,phase:'tms-shipment-event-query',batchIndex:4,totalBatches:14}},'SHOPEE'),false,'every fourth event batch must still persist the full canonical mirror');
assert.equal(shouldUseFastCheckpoint({businessType:'SHOPEE',processing:{running:true,phase:'tms-shipment-event-query',batchIndex:14,totalBatches:14}},'SHOPEE'),false,'final batch must always persist full truth');
assert.equal(shouldUseFastCheckpoint({businessType:'SHOPEE',processing:{running:false,phase:'完成',batchIndex:1,totalBatches:1}},'SHOPEE'),false,'completion must never use a lightweight checkpoint');

console.log(`[V314] SHOPEE throughput smoke passed · 670 tickets => ${batches.length} fixed 50-ticket event batches · bounded concurrency ${maxActive}/4 · ${elapsed.toFixed(1)}ms synthetic vs ~560ms serial · failed batches retryable · partial-resume batch shapes exact · full mirror throttled 4x but final truth always canonical`);