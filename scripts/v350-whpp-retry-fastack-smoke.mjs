import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runV350WhppAutoDrain, V143_WHPP_RETRY_QUEUE_PATCH_ID } from '../src/v143WhppRetryQueuePatch.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.join(__dirname,'..','src','v143WhppRetryQueuePatch.js'),'utf8');
const uiSource=fs.readFileSync(path.join(__dirname,'..','public','v141-whpp-retry-isolation-ui.js'),'utf8');
new Function(uiSource);

assert.match(V143_WHPP_RETRY_QUEUE_PATCH_ID,/v350-whpp-retry-fast-ack-auto-drain/);
assert.match(source,/function runHandler\(req,res\)\{try\{const limit=[\s\S]*?startRetryJob\(limit,res\);res\.status\(202\)\.json\(\{ok:true,patchId:PATCH_ID,started:true,fastAck:true,autoDrain:true,job\}\)/,'POST must acknowledge without queue summary work');
const runHandlerStart=source.indexOf('function runHandler(req,res){');
const runHandlerEnd=source.indexOf('let installed=',runHandlerStart);
assert.ok(runHandlerStart>=0&&runHandlerEnd>runHandlerStart,'runHandler source must exist');
const runHandlerSource=source.slice(runHandlerStart,runHandlerEnd);
assert.doesNotMatch(runHandlerSource,/pendingRows\(|queueSummary\(/,'POST hot path must not synchronously scan retry SQLite before 202');
assert.match(source,/response\?\.once\)response\.once\('finish',\(\)=>setImmediate\(launch\)\)/,'SQLite retry work must start only after the HTTP response finish event');
assert.doesNotMatch(source,/UPPER\(COALESCE\(c?\.?apiStatus/,'retry predicates must not wrap apiStatus in UPPER/COALESCE');
assert.match(source,/apiStatus COLLATE NOCASE IN/,'case-insensitive failure semantics must be preserved without UPPER/COALESCE');
assert.match(source,/MAX_BATCH=200/,'WHPP retry batches remain bounded at 200');
assert.match(source,/NO_PROGRESS/,'auto drain must stop when a pass makes no progress');

assert.match(uiSource,/v398-whpp-first-retry-auto-kick-v1/,'retry center must expose the automatic first-kick revision');
assert.match(uiSource,/fetch\('\/api\/whpp\/progress'/,'auto-kick must verify the canonical WHPP runtime before starting a retry');
assert.match(uiSource,/function whppNeedsAutomaticKick\(/,'auto-kick must require RETRY_REQUIRED\/待重试 truth instead of merely seeing an old failure row');
assert.match(uiSource,/outcome==='RETRY_REQUIRED'/,'runtime RETRY_REQUIRED is an explicit auto-kick trigger');
assert.match(uiSource,/whppRetryCountForDate\(whpp,reportDate\)/,'auto-kick must bind retry tickets to the exact current WHPP report date');
assert.match(uiSource,/if\(signature===autoWhppKickSignature\)return false/,'the same unchanged failure cohort must never be auto-kicked repeatedly');
assert.match(uiSource,/runRetry\(\{automatic:true,targetOverride:'WHPP'\}\)/,'WHPP must receive the same first recheck request that previously required a manual click');
assert.match(uiSource,/target==='WHPP'\?'\/api\/v143\/whpp-retry-queue\/recheck'/,'automatic and manual WHPP recovery must share the existing bounded V350 endpoint');
assert.match(uiSource,/addEventListener\('click',\(\)=>runRetry\(\)\)/,'manual retry remains available for real no-progress or auth failures');

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

console.log('[V398/V350] WHPP retry smoke passed · RETRY_REQUIRED exact-date first kick is automatic · unchanged failures kick once · manual fallback remains · HTTP finish precedes SQLite selection · 236 auto-drains as 200+36 · zero-progress stops after one pass');
await import('./v351-whpp-unified-dashboard-bridge-smoke.mjs');