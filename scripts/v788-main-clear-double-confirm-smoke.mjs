// Test the actual V625 destructive button, NOT a reimplementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js=fs.readFileSync('public/v625-shell.js','utf8');
const start=js.indexOf('let v788MainClearSubmitting=false;');
const end=js.indexOf('\nasync function loadUsers()',start);
assert.ok(start>=0&&end>start,'one guarded main-page clear path must be installed');
const source=js.slice(start,end);

const goodPreflight={
  cp72Ready:true,activeCpCount:72,dataStorageReady:true,
  safeToStartClear:true,alreadyClearedNoFreshBusiness:false,
  version:{installedCommit:'f'.repeat(40),installedOnLocalMain:true,
    cachedMainMatchesInstalled:true,formalUpdateVerified:true,
    installedThroughManagedUpdaterVerified:true}
};
async function simulate({preflight=goodPreflight,confirmed=true,typed='永久清除全部业务数据'}={}){
  const calls=[],button={disabled:false},messages=[];
  const context={
    byId:id=>id==='v626ClearAllData'?button:null,
    json:async(url)=>{
      calls.push({verb:'GET',url});
      assert.equal(url,'/api/admin/data-purge/direct/preflight');
      return preflight;
    },
    confirm:message=>{calls.push({verb:'CONFIRM',message});return confirmed},
    prompt:(message,defaultText)=>{
      calls.push({verb:'PROMPT',message,defaultText});
      return typed;
    },
    note:(id,text,level)=>messages.push({id,text,level}),
    post:async(url,body)=>{
      calls.push({verb:'POST',url,body});
      return {jobId:'isolated-test-only'};
    },
    pollDirectPurge:async(jobId)=>{
      calls.push({verb:'POLL',jobId});
      return {deletedRows:50};
    },
    v765InvalidateAllProofCache(){},
    v765BoardDetailCache:{clear(){}},
    v626LatestImport:{},v626OpenRows:[1],
    renderOpenPodRows(){},
    loadBackups:async()=>{},
    fmt:n=>String(n),
  };
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'v625-shell.js',timeout:1000});
  await context.clearAllBusinessData();
  assert.equal(button.disabled,false,'button must recover after any denial');
  return {calls,messages};
}
function noWrites(output,label){
  assert.equal(output.calls.filter(x=>x.verb==='POST').length,0,label);
  assert.equal(output.calls.filter(x=>x.verb==='POLL').length,0,label);
}
const draft=await simulate({preflight:{...goodPreflight,version:{
  ...goodPreflight.version,formalUpdateVerified:false
}}});
noWrites(draft,'candidate branch cannot send purge POST');
assert.equal(draft.calls.length,1,'unsafe installation must reject before showing any prompt');

const noCp=await simulate({preflight:{...goodPreflight,activeCpCount:71}});
noWrites(noCp,'71 or unknown CP stores cannot be purged');
assert.equal(noCp.calls.length,1);

const replay=await simulate({preflight:{...goodPreflight,safeToStartClear:false,
  alreadyClearedNoFreshBusiness:true}});
noWrites(replay,'postcommit duplicate clear must be rejected before any prompt');

const firstNo=await simulate({confirmed:false});
noWrites(firstNo,'cancel at first confirmation');
assert.equal(firstNo.calls.filter(x=>x.verb==='PROMPT').length,0);

const typedWrong=await simulate({typed:'not approved'});
noWrites(typedWrong,'wrong human typed text must not send destructive POST');
assert.equal(typedWrong.calls.filter(x=>x.verb==='PROMPT').length,1);

const typedCancel=await simulate({typed:null});
noWrites(typedCancel,'cancel second confirmation');

const yes=await simulate();
assert.deepEqual(yes.calls.map(x=>x.verb),['GET','CONFIRM','PROMPT','POST','POLL']);
assert.equal(yes.calls[3].url,'/api/admin/data-purge/direct');
assert.equal(yes.calls[3].body.phrase,'永久清除全部业务数据');
assert.match(yes.calls[1].message,/72个有效CP码/);
assert.match(yes.calls[2].message,/二次确认/);
assert.ok(yes.messages.some(x=>x.text.includes('业务数据已全部清空')));
console.log('[V788 MAIN CLEAR] PASS fresh official-main+72CP gate, replay safety, first cancel, typed second cancel/wrong and accepted path; no actual SQLite writes');
