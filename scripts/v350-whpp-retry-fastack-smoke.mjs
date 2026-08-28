import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runV350WhppAutoDrain, V143_WHPP_RETRY_QUEUE_PATCH_ID } from '../src/v143WhppRetryQueuePatch.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.join(__dirname,'..','src','v143WhppRetryQueuePatch.js'),'utf8');

assert.match(V143_WHPP_RETRY_QUEUE_PATCH_ID,/v350-whpp-retry-fast-ack-auto-drain/);
assert.match(source,/function runHandler\(req,res\)\{try\{const limit=[\s\S]*?startRetryJob\(limit\);res\.status\(202\)\.json\(\{ok:true,patchId:PATCH_ID,started:true,fastAck:true,autoDrain:true,job\}\)/,'POST must acknowledge before any queue summary is read');
const runHandlerSource=source.match(/function runHandler\(req,res\)\{[\s\S]*?\n\nlet installed=/)?.[0]||'';
assert.ok(runHandlerSource,'runHandler source must exist');
assert.doesNotMatch(runHandlerSource,/pendingRows\(|queueSummary\(/,'POST hot path must not synchronously scan retry SQLite before 202');
assert.match(source,/setImmediate\(async\(\)=>\{/,'retry work must move behind the HTTP acknowledgement');
assert.doesNotMatch(source,/UPPER\(COALESCE\(c?\.?apiStatus/,'retry predicates must keep apiStatus bare instead of wrapping it in functions');
assert.match(source,/MAX_BATCH=200/,'WHPP retry batches remain bounded at 200');
assert.match(source,/NO_PROGRESS/,'auto drain must stop when a pass makes no progress');

let remaining=236;
const passLimits=[];
const progress=[];
const drained=await runV350WhppAutoDrain({
  batchSize:200,
  maxPasses:20,
  summaryFn:()=>({total:remaining}),
  recheckFn:async(limit,onProgress)=>{
    passLimits.push(limit);
    const processed=Math.min(limit,remaining);
    onProgress({phase:'订单扫描',resolved:processed,total:processed,recovered:processed,closed:0});
    remaining-=processed;
    return {processed,recovered:processed,closed:0,stillRetry:0,results:[]};
  },
  onJob:state=>progress.push({...state})
});
assert.equal(drained.initialTotal,236);
assert.equal(drained.passes,2,'236 tickets must auto-drain as 200 + 36 without a second click');
assert.deepEqual(passLimits,[200,200]);
assert.equal(drained.processed,236);
assert.equal(drained.recovered,236);
assert.equal(drained.stillRetry,0);
assert.equal(drained.stopReason,'EMPTY');
assert.ok(progress.some(item=>item.passes===2),'second background pass must be observable');

let stuckRemaining=236;
let stuckCalls=0;
const stopped=await runV350WhppAutoDrain({
  batchSize:200,
  maxPasses:20,
  summaryFn:()=>({total:stuckRemaining}),
  recheckFn:async()=>{
    stuckCalls+=1;
    return {processed:200,recovered:0,closed:0,stillRetry:200,results:[]};
  }
});
assert.equal(stuckCalls,1,'zero-recovery pass must never loop against CE indefinitely');
assert.equal(stopped.passes,1);
assert.equal(stopped.stillRetry,236);
assert.equal(stopped.stopReason,'NO_PROGRESS');

console.log('[V350] WHPP retry fast-ack smoke passed · POST returns before SQLite selection · 236 auto-drains as 200+36 · zero-progress stops after one pass · no DB schema change');