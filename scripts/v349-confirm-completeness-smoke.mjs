import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CEClient } from '../src/ceClient.js';
import { classifyScanTerminal } from '../src/scanTerminal.js';
import {
  V349_CONFIRM_COMPLETENESS_ID,
  recoverPartialConfirmResponse,
  createConfirmCompletenessClient
} from '../src/v349ConfirmCompletenessClient.js';

assert.match(V349_CONFIRM_COMPLETENESS_ID,/v349-confirm-partial-response-recovery-v3/);
assert.equal(CEClient.prototype.confirmQuery.name,'v349CompleteConfirmQuery','V349 must install once at the CEClient boundary so WHPP/retry-center cannot miss the owner');

execFileSync(process.execPath,['--check','src/v70ConfirmQueryResiliencePatch.js'],{stdio:'pipe'});
const v70=fs.readFileSync(new URL('../src/v70ConfirmQueryResiliencePatch.js',import.meta.url),'utf8');
assert.match(v70,/V392_CONFIRM_TRANSPORT_BOUNDARY_ID/,'V70 must expose the consolidated transport boundary revision');
assert.match(v70,/const MAX_BATCH = Math\.max\(10, Math\.min\(100,/,'V70 must retain <=100 CE transport safety chunks');
assert.match(v70,/successfulTransportBatches === 0 && lastTransportError/,'all safe-chunk transport failures must bubble to V349\/V345');
assert.match(v70,/return queryConfirmBatches\(this, codes\)/,'V70 confirm entry must only execute the transport-safe batch collector');
assert.doesNotMatch(v70,/confirm-query final retry/,'V70 must never reintroduce a second confirm missing-row retry loop');
assert.doesNotMatch(v70,/retriedRows = await queryConfirmBatches\(this, missing\)/,'missing-row recovery belongs exclusively to V349');
assert.doesNotMatch(v70,/CEClient\.prototype\.trackQuery\s*=/,'V70 must not wrap trackQuery; trackBatching is the single trajectory retry owner');
assert.doesNotMatch(v70,/CEClient\.prototype\.exceptionQuery\s*=/,'V70 must not wrap exceptionQuery; trackBatching is the single exception retry owner');
assert.match(v70,/export const V139_FINAL_RETRY_ROUNDS = 0/,'legacy nested track final retries must remain disabled');

const bills=Array.from({length:362},(_,i)=>`CE349${String(i+1).padStart(6,'0')}`);
const firstReturned=new Set(bills.slice(0,23));
const calls=[];
const fullRows=await recoverPartialConfirmResponse(async codes=>{
  calls.push([...codes]);
  if(calls.length===1)return codes.filter(code=>firstReturned.has(code)).map(shipmentCode=>({shipmentCode,orderStatus:'50'}));
  return codes.map(shipmentCode=>({shipmentCode,orderStatus:'50'}));
},bills,{label:'CCSL-362-to-23-regression',recoveryBudgetMs:8000});
const fullCodes=new Set(fullRows.map(row=>String(row.shipmentCode||'').toUpperCase()));
assert.equal(fullCodes.size,362,'all 362 successful/missing waybills must be represented after V349 recovery');
assert.equal(calls[0].length,362,'first request must preserve the canonical parent batch');
assert.ok(calls.slice(1).every(batch=>batch.length<=100),'partial-response children must be bounded to 100/50/10/1');
assert.ok(calls.slice(1).flat().every(code=>!firstReturned.has(code)),'the 23 already returned waybills must never be queried again');
assert.equal(fullRows.filter(row=>row.ceQcSyntheticNoScanEvidence).length,0,'recoverable missing rows must not be fabricated as no-scan evidence');

const whppBills=Array.from({length:144},(_,i)=>`CE130826${String(i+1).padStart(5,'0')}`);
let whppCalls=0;
const whppRows=await recoverPartialConfirmResponse(async codes=>{
  whppCalls+=1;
  if(whppCalls===1)return codes.slice(0,4).map(shipmentCode=>({shipmentCode,orderStatus:'50'}));
  return [];
},whppBills,{label:'WHPP-144-partial-regression',recoveryBudgetMs:8000});
const synthetic=whppRows.filter(row=>row.ceQcSyntheticNoScanEvidence);
assert.equal(synthetic.length,140,'small successful omissions must become explicit no-scan evidence, not interface failures');
for(const row of synthetic.slice(0,5)){
  const terminal=classifyScanTerminal(row,'success');
  assert.equal(terminal.currentState,'OPEN_TRACK_REQUIRED','successful endpoint absence must remain an open shipment, not API retry');
  assert.equal(terminal.trackRequired,true,'no-scan evidence must continue to trajectory lookup');
  assert.equal(terminal.scanTerminalReason,'ORDER_STATUS_UNKNOWN');
}

let compensationCalls=0;
const compensationFailureRows=await recoverPartialConfirmResponse(async codes=>{
  compensationCalls+=1;
  if(compensationCalls===1)return [{shipmentCode:codes[0],orderStatus:'50'}];
  const error=new Error('child transport failed');error.code='ECONNRESET';throw error;
},['CF1','CF2','CF3','CF4'],{label:'CHILD-FAIL-TRUTH',recoveryBudgetMs:1000});
assert.deepEqual(compensationFailureRows.map(row=>row.shipmentCode),['CF1'],'failed compensation must leave CF2-CF4 absent for the real retry center');
assert.equal(compensationFailureRows.some(row=>row.ceQcSyntheticNoScanEvidence),false,'failed compensation must never be mislabeled as no-scan evidence');

let transportCalls=0;
await assert.rejects(
  ()=>recoverPartialConfirmResponse(async()=>{
    transportCalls+=1;const error=new Error('socket hang up');error.code='ECONNRESET';throw error;
  },['CE-TRUE-FAIL'],{recoveryBudgetMs:1000}),
  /socket hang up/
);
assert.equal(transportCalls,1,'V349 must not swallow or recursively retry a true parent transport failure');

const mock={confirmQuery:async codes=>codes.map(shipmentCode=>({shipmentCode,orderStatus:'50'})),trackQuery:async()=>[]};
const wrapped=createConfirmCompletenessClient(mock,{label:'MOCK'});
assert.notEqual(wrapped,mock);
assert.equal((await wrapped.confirmQuery(['M1','M2'])).length,2);

const runtimePipeline=fs.readFileSync(new URL('../src/runtimePipeline.js',import.meta.url),'utf8');
const pipelineShim=fs.readFileSync(new URL('../src/v314PipelineThroughput.js',import.meta.url),'utf8');
const throughputCore=fs.readFileSync(new URL('../src/throughputCore.js',import.meta.url),'utf8');
const whpp=fs.readFileSync(new URL('../src/whppPipeline.js',import.meta.url),'utf8');
assert.match(runtimePipeline,/v349ConfirmCompletenessClient/,'CCSL/SHOPEE runtime pipeline must explicitly load V349');
assert.match(runtimePipeline,/createUnifiedThroughputClient/,'unversioned runtime pipeline must use the one throughput core');
assert.match(pipelineShim,/runtimePipeline\.js/,'legacy V314 runtime path must stay compatibility-only');
assert.match(throughputCore,/batchSize:350/,'core throughput must retain logical 350-ticket confirm batches');
assert.match(throughputCore,/batchSize:50/,'core throughput must retain fixed 50-ticket track batches');
assert.match(whpp,/createUnifiedThroughputClient/,'WHPP must remain its independent third-stage throughput entry');
assert.match(whpp,/CONFIRM_BATCH_SIZE = 350/,'WHPP scan batch remains 350');
assert.match(whpp,/trackConcurrency: 4/,'WHPP trajectory remains 50x4');

console.log('[V349/CORE] confirm completeness + unversioned throughput ownership passed · V70 confirm transport-only · track/exception retry single-owner · CCSL 362→23 recovery · WHPP successful omissions remain trajectory evidence · failed compensation stays retry');

await import('./v314-shopee-throughput-smoke.mjs');
await import('./v339-ccsl-throughput-smoke.mjs');
await import('./v346-whpp-throughput-smoke.mjs');
await import('./v367-candidate-only-safety-smoke.cjs');
await import('./v368-atomic-store-boundary-smoke.mjs');
await import('./v369-failed-staging-rollback-smoke.mjs');
await import('./v370-post-import-scanpool-runtime-smoke.mjs');
await import('./v371-scanpool-source-runtime-smoke.mjs');
await import('./v350-whpp-retry-fastack-smoke.mjs');
