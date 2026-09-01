import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const convergenceSource=fs.readFileSync(new URL('../public/v412-seven-business-convergence.js',import.meta.url),'utf8');
const shellSource=fs.readFileSync(new URL('../src/v44WhppUiPatch.js',import.meta.url),'utf8');

function runtime(){
  const listeners=new Map();
  const storage=new Map();
  let originalCalls=0;
  const document={
    readyState:'complete',
    visibilityState:'visible',
    body:{},
    documentElement:{dataset:{}},
    getElementById(){return null;},
    querySelector(){return null;},
    createTreeWalker(){return {currentNode:null,nextNode(){return false;}};},
    addEventListener(type,handler){const list=listeners.get(type)||[];list.push(handler);listeners.set(type,list);},
    dispatchEvent(){return true;}
  };
  const checkedAt=Date.now()-1000;
  const sandbox={
    console,
    document,
    NodeFilter:{SHOW_TEXT:4},
    MutationObserver:class{constructor(callback){this.callback=callback;}observe(){}disconnect(){}},
    CustomEvent:class{constructor(type,init={}){this.type=type;this.detail=init.detail;}},
    localStorage:{
      getItem(key){return storage.has(key)?storage.get(key):null;},
      setItem(key,value){storage.set(key,String(value));},
      removeItem(key){storage.delete(key);}
    },
    location:{pathname:'/import'},
    setTimeout(fn){fn();return 1;},
    clearTimeout(){},
    Date,
    JSON,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Math,
    Promise,
    unifiedImportState:{
      reportDate:'2026-08-16',
      snapshotId:'IMPORT-A',
      classificationCounts:{CE:2069,CEAF:50,TBKH:1889,ALI1688:283,SHOPEECN:769,SHOPEEVN:0,WHPP:228},
      summary:{validUniqueWaybills:5060,totalUnique:5060}
    },
    __CE_QC_V168_SEVEN_BUSINESS_STATUS__:{
      lastTruth:{
        reportDate:'2026-08-16',
        complete:true,
        statusFresh:true,
        checkedAt,
        stages:[
          {key:'CCSL',state:'done',statusFresh:true},
          {key:'SHOPEE',state:'done',statusFresh:true},
          {key:'WHPP',state:'done',statusFresh:true}
        ]
      },
      async refresh(){return this.lastTruth;}
    },
    runUnified(){originalCalls+=1;return {ok:true,original:true};},
    resumeUnified(){originalCalls+=1;return {ok:true,original:true};}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(convergenceSource,sandbox,{filename:'v412-seven-business-convergence.js'});
  return {sandbox,listeners,get originalCalls(){return originalCalls;}};
}

test('V413 seven-business total includes WHPP instead of legacy six-business 5060',()=>{
  const rt=runtime();
  assert.equal(rt.sandbox.__CE_QC_V412_SEVEN_BUSINESS_CONVERGENCE__.sevenTotal(),5288);
  assert.equal(rt.sandbox.unifiedImportState.summary.validUniqueWaybills,5288);
  assert.equal(rt.sandbox.unifiedImportState.summary.totalUnique,5288);
  assert.equal(rt.sandbox.unifiedImportState.sevenBusinessValidUniqueWaybills,5288);
});

test('V413 blocks duplicate unified execution when exact lifecycle CCSL/SHOPEE/WHPP are already complete',async()=>{
  const rt=runtime();
  const result=await rt.sandbox.runUnified();
  assert.equal(result.ok,true);
  assert.equal(result.skipped,true);
  assert.equal(result.reason,'SEVEN_BUSINESS_ALREADY_COMPLETE_V413');
  assert.equal(rt.originalCalls,0,'V67/original runner must not be re-entered after exact lifecycle seven-business completion');
  assert.equal(rt.sandbox.__CE_QC_UNIFIED_RUN_STAGE__.type,'DONE');
  assert.equal(rt.sandbox.__CE_QC_V412_SEVEN_BUSINESS_CONVERGENCE__.readMarker()?.lifecycleKey,'IMPORT-A');
});

test('V413 clears persisted WHPP completion when a new daily report file is selected',()=>{
  const rt=runtime();
  assert.equal(rt.sandbox.__CE_QC_V412_SEVEN_BUSINESS_CONVERGENCE__.readMarker()?.completed,true);
  for(const handler of rt.listeners.get('change')||[])handler({target:{id:'excelFile'}});
  assert.equal(rt.sandbox.__CE_QC_V412_SEVEN_BUSINESS_CONVERGENCE__.readMarker(),null);
});

test('V413 same-date new import cannot inherit stale prior lifecycle completion truth',async()=>{
  const rt=runtime();
  assert.equal(rt.sandbox.__CE_QC_V412_SEVEN_BUSINESS_CONVERGENCE__.readMarker()?.lifecycleKey,'IMPORT-A');
  rt.sandbox.unifiedImportState.snapshotId='IMPORT-B';
  for(const handler of rt.listeners.get('ce-qc-unified-import-committed')||[])handler({detail:{reportDate:'2026-08-16'}});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(rt.sandbox.__CE_QC_V412_SEVEN_BUSINESS_CONVERGENCE__.readMarker(),null,'stale V168 checkedAt must not recreate a marker for IMPORT-B');
  const result=await rt.sandbox.runUnified();
  assert.equal(result.original,true,'stale prior lifecycle truth must delegate to V67 instead of falsely skipping');
  assert.equal(rt.originalCalls,1);
});

test('V413 remains idempotent, reconciles import success text, and never owns processing APIs',()=>{
  assert.match(convergenceSource,/2026-09-01-v413-lifecycle-bound-seven-business-convergence-v4/);
  assert.doesNotMatch(convergenceSource,/\/api\/whpp\/run\/(?:start|resume)|\/api\/(?:run|resume)|\/api\/shopee\/run\/(?:start|resume)/);
  assert.doesNotMatch(convergenceSource,/async function execute|function execute\(/);
  assert.match(convergenceSource,/\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]/);
  assert.match(convergenceSource,/SEVEN_BUSINESS_ALREADY_COMPLETE_V413/);
  assert.match(convergenceSource,/lifecycleKey/);
  assert.match(convergenceSource,/truthCurrentEnough/);
  assert.match(convergenceSource,/日报导入完成，[\\s\\S]*个唯一运单/,'legacy green import-success total must be rewritten to seven-business truth');
  assert.match(convergenceSource,/patchText\(document\.getElementById\('importPage'\),total\)/,'all import-page success text owners must converge to the same total');
  assert.match(convergenceSource,/setTimeout\(runObservedSync,60\)/,'observer reconciliation must be throttled instead of running on every mutation');
  assert.match(convergenceSource,/String\(valid\.textContent\|\|''\)\.trim\(\)!==totalText/,'unchanged visible total must not rewrite DOM and retrigger its observer');
  assert.match(convergenceSource,/dataset\.v412SevenBusinessTotal!==String\(total\)/,'unchanged dataset truth must remain idempotent');
});

test('runtime loader order is V67 -> V168 -> V169 -> V413 convergence',()=>{
  const v67=shellSource.indexOf('v67-resilient-run-guard.js?v=20260830-v360-1');
  const v168=shellSource.indexOf('v168-seven-business-status.js?v=20260901-v411-1');
  const v169=shellSource.indexOf('v169-seven-business-legacy-status-sync.js?v=20260901-v411-1');
  const v413=shellSource.indexOf('v412-seven-business-convergence.js?v=20260901-v413-3');
  assert.ok(v67>=0&&v168>v67&&v169>v168&&v413>v169);
});
