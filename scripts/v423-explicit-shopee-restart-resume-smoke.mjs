import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync('public/v169-seven-business-legacy-status-sync.js','utf8');
assert.match(source,/V423_EXPLICIT_SHOPEE_RESTART_REVISION='2026-09-04-v423-explicit-shopee-restart-resume-v1'/);
assert.doesNotMatch(source,/\/api\/shopee\/run\/(?:start|resume)|\/api\/whpp\/run\/(?:start|resume)|\/api\/(?:run|resume)/,'V169 must only choose the V67 public entry and must never become a second API executor');

function stage(key,{complete=false,state='pending',date='2026-09-01',details='',fresh=true}={}){
  return {key,complete,state,date,details,statusFresh:fresh};
}
function truth({ccslComplete=true,shopeeState='failed',shopeeDate='2026-09-01',details='PROCESS_RESTART_INTERRUPTED'}={}){
  return {
    reportDate:'2026-09-01',
    complete:false,
    statusFresh:true,
    checkedAt:Date.now(),
    stages:[
      stage('CCSL',{complete:ccslComplete,state:ccslComplete?'done':'pending'}),
      stage('SHOPEE',{complete:false,state:shopeeState,date:shopeeDate,details}),
      stage('WHPP',{complete:false,state:'pending'})
    ]
  };
}

async function runCase(lastTruth){
  const calls={start:0,resume:0};
  const document={
    readyState:'loading',
    visibilityState:'visible',
    body:{},
    addEventListener(){},
    querySelectorAll(){return[];},
    querySelector(){return null;},
    getElementById(id){return id==='reportDate'?{value:'2026-09-01'}:null;}
  };
  class MutationObserver{constructor(fn){this.fn=fn;}observe(){}}
  const window={
    document,
    location:{pathname:'/import'},
    addEventListener(){},
    runUnified:async()=>{calls.start+=1;return{ok:true,owner:'V67',mode:'start'};},
    resumeUnified:async()=>{calls.resume+=1;return{ok:true,owner:'V67',mode:'resume'};},
    __CE_QC_V168_SEVEN_BUSINESS_STATUS__:{lastTruth,refresh:async()=>lastTruth}
  };
  const context={window,document,location:window.location,MutationObserver,console,setTimeout,clearTimeout,setInterval,clearInterval,Promise,Date};
  vm.runInNewContext(source,context,{filename:'v169-seven-business-legacy-status-sync.js'});
  const result=await window.runUnified();
  return{calls,result,api:window.__CE_QC_V169_LEGACY_STATUS_SYNC__};
}

{
  const {calls,result,api}=await runCase(truth());
  assert.equal(calls.start,0,'exact current-date restart interruption must not re-enter V67 start');
  assert.equal(calls.resume,1,'exact current-date restart interruption must delegate once to V67 resume');
  assert.equal(result.mode,'resume');
  assert.equal(api.v423Revision,'2026-09-04-v423-explicit-shopee-restart-resume-v1');
}
{
  const {calls,result}=await runCase(truth({details:'CE_API_FAILED'}));
  assert.equal(calls.start,1,'generic SHOPEE failure must retain normal V67 start semantics');
  assert.equal(calls.resume,0,'generic failure must not acquire restart privilege');
  assert.equal(result.mode,'start');
}
{
  const {calls,result}=await runCase(truth({shopeeDate:'2026-08-31'}));
  assert.equal(calls.start,1,'wrong-date restart evidence must not be consumed');
  assert.equal(calls.resume,0);
  assert.equal(result.mode,'start');
}
{
  const {calls,result}=await runCase(truth({ccslComplete:false}));
  assert.equal(calls.start,1,'SHOPEE restart routing must not skip an incomplete CCSL stage');
  assert.equal(calls.resume,0);
  assert.equal(result.mode,'start');
}

console.log('[V423] explicit SHOPEE restart-resume smoke passed · exact current-date PROCESS_RESTART_INTERRUPTED after CCSL completion delegates to V67 resume · generic failure/wrong-date/incomplete-CCSL stay on normal V67 start · V169 owns no processing API');