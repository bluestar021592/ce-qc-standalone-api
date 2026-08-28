import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CEClient } from '../src/ceClient.js';
import { classifyScanTerminal } from '../src/scanTerminal.js';
import {
  V349_CONFIRM_COMPLETENESS_ID,
  recoverPartialConfirmResponse,
  createConfirmCompletenessClient
} from '../src/v349ConfirmCompletenessClient.js';

assert.match(V349_CONFIRM_COMPLETENESS_ID,/v349-confirm-partial-response-recovery-v3/);
assert.equal(CEClient.prototype.confirmQuery.name,'v349CompleteConfirmQuery','V349 must install once at the CEClient boundary so WHPP/retry-center cannot miss the owner');

// Exact production symptom: 362 requested, HTTP succeeds, but only 23 waybills are
// present in the response. V349 must never mark the other 339 as transport failures
// when bounded child queries can recover them.
const bills=Array.from({length:362},(_,i)=>`CE349${String(i+1).padStart(6,'0')}`);
const firstReturned=new Set(bills.slice(0,23));
const calls=[];
const fullRows=await recoverPartialConfirmResponse(async codes=>{
  calls.push([...codes]);
  if(calls.length===1){
    return codes.filter(code=>firstReturned.has(code)).map(shipmentCode=>({shipmentCode,orderStatus:'50'}));
  }
  return codes.map(shipmentCode=>({shipmentCode,orderStatus:'50'}));
},bills,{label:'CCSL-362-to-23-regression',recoveryBudgetMs:8000});
const fullCodes=new Set(fullRows.map(row=>String(row.shipmentCode||'').toUpperCase()));
assert.equal(fullCodes.size,362,'all 362 successful/missing waybills must be represented after V349 recovery');
assert.equal(calls[0].length,362,'first request must preserve the canonical parent batch');
assert.ok(calls.slice(1).every(batch=>batch.length<=100),'partial-response children must be bounded to 100/50/10/1');
assert.ok(calls.slice(1).flat().every(code=>!firstReturned.has(code)),'the 23 already returned waybills must never be queried again');
assert.equal(fullRows.filter(row=>row.ceQcSyntheticNoScanEvidence).length,0,'recoverable missing rows must not be fabricated as no-scan evidence');

// WHPP symptom: a successful response can still omit many waybills. Successful
// small compensation requests that also omit them prove no scan-row evidence; those
// bills must continue trajectory/anomaly analysis rather than refresh_failed.
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

// If the parent response was partial but every compensation request itself fails,
// V349 must NOT fabricate no-scan evidence. Omitted codes remain absent from the
// returned rows so canonical pipeline code keeps them as genuine interface retries.
let compensationCalls=0;
const compensationFailureRows=await recoverPartialConfirmResponse(async codes=>{
  compensationCalls+=1;
  if(compensationCalls===1)return [{shipmentCode:codes[0],orderStatus:'50'}];
  const error=new Error('child transport failed');
  error.code='ECONNRESET';
  throw error;
},['CF1','CF2','CF3','CF4'],{label:'CHILD-FAIL-TRUTH',recoveryBudgetMs:1000});
assert.deepEqual(compensationFailureRows.map(row=>row.shipmentCode),['CF1'],'failed compensation must leave CF2-CF4 absent for the real retry center');
assert.equal(compensationFailureRows.some(row=>row.ceQcSyntheticNoScanEvidence),false,'failed compensation must never be mislabeled as no-scan evidence');

// True parent transport failure semantics are untouched: the initial request
// exception bubbles to canonical V345/V346 fallback/retry rather than being hidden.
let transportCalls=0;
await assert.rejects(
  ()=>recoverPartialConfirmResponse(async()=>{
    transportCalls+=1;
    const error=new Error('socket hang up');
    error.code='ECONNRESET';
    throw error;
  },['CE-TRUE-FAIL'],{recoveryBudgetMs:1000}),
  /socket hang up/
);
assert.equal(transportCalls,1,'V349 must not swallow or recursively retry a true parent transport failure');

// Alternate/mock CE-compatible clients used by throughput tests still receive the
// same contract through the explicit proxy owner.
const mock={confirmQuery:async codes=>codes.map(shipmentCode=>({shipmentCode,orderStatus:'50'})),trackQuery:async()=>[]};
const wrapped=createConfirmCompletenessClient(mock,{label:'MOCK'});
assert.notEqual(wrapped,mock);
assert.equal((await wrapped.confirmQuery(['M1','M2'])).length,2);

const pipeline=fs.readFileSync(new URL('../src/v314PipelineThroughput.js',import.meta.url),'utf8');
const whpp=fs.readFileSync(new URL('../src/whppPipeline.js',import.meta.url),'utf8');
assert.match(pipeline,/v349ConfirmCompletenessClient/,'CCSL/SHOPEE throughput entry must explicitly load V349');
assert.match(whpp,/createUnifiedThroughputClient/,'WHPP must remain its independent V346 bounded third-stage throughput owner');
assert.match(whpp,/CONFIRM_BATCH_SIZE = 350/,'WHPP scan batch remains 350');
assert.match(whpp,/trackConcurrency: 4/,'WHPP trajectory remains 50x4 via V346');

console.log(`[V349] partial confirm completeness smoke passed · exact CCSL 362→23 recovery · already-returned 23 never re-requested · WHPP 144 successful omissions become no-scan trajectory evidence · failed compensation stays real retry · true parent failure still bubbles to V345/V346 · CEClient boundary owner active`);
