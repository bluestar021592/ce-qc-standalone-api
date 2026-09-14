import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const V505_URL='/v505-data-purge-recovery.js?v=20260911-v505-8';
const STARTUP_PROBE_URL='/v505-purge-startup-probe.js?v=20260912-v505-startup-probe-2';
const V502_URL='/v502-multidrive-backup-ui.js?v=20260912-v502-3';

test('V505 version-aware purge UI owner is delivered after app.js and transport loss recovers persisted server truth before any retry',()=>{
  const index=read('public/index.html');
  const runtimeLoader=read('public/v14-geometry-fixture.js');
  const backupLoader=read('public/v502-multidrive-backup-ui.js');
  const lazy=read('public/v108-route-lazy-features.js');
  const owner=read('public/v505-data-purge-recovery.js');
  const startupProbe=read('public/v505-purge-startup-probe.js');

  const appAt=index.indexOf('/app.js?v=account-menu-20260806-1');
  const runtimeAt=index.indexOf('/v14-geometry-fixture.js?v=20260805-1');
  assert.ok(appAt>=0&&runtimeAt>appAt,'runtime loader must execute after app.js so V505 can replace the legacy inline purge owner');

  assert.match(runtimeLoader,/loadRuntimeScript\('\/v505-data-purge-recovery\.js\?v=20260911-v505-8'\)/,'the always-loaded runtime chain must claim the latest V505 owner before route lazy features');
  assert.match(runtimeLoader,/v502-multidrive-backup-ui\.js\?v=20260912-v502-3/,'the V502 loader carrying startup recovery must be cache-busted');
  assert.ok(runtimeLoader.indexOf(V505_URL)<runtimeLoader.indexOf(V502_URL),'V505 must claim ownership before the V502 loader can schedule any fallback');

  assert.match(backupLoader,/v505-data-purge-recovery\.js\?v=20260911-v505-8/);
  assert.match(backupLoader,/v8-version-aware-owner/,'V502 must request the current owner when an older V505 patch is already present');
  assert.match(backupLoader,/v505-purge-startup-probe\.js\?v=20260912-v505-startup-probe-2/,'V502 must install the exact-job-bound startup-orphan probe on every normal data-management runtime');
  assert.ok(backupLoader.indexOf(STARTUP_PROBE_URL)>=0);
  assert.match(backupLoader,/script\.onload=loadStartupProbe/,'if V505 owner must be reloaded, the startup probe may load only after that owner has executed');
  assert.match(lazy,/v505-data-purge-recovery\.js\?v=20260911-v505-8/);
  assert.doesNotMatch(lazy,/v104-fast-purge-ui\.js/,'clean data-management navigation must never install the retired V104 purge workflow');
  assert.match(lazy,/v106-purge-legacy-controls-hide\.js/,'V106 stays only as a compatibility guard for stale/already-open pages');

  assert.match(owner,/v8-version-aware-owner/);
  assert.match(owner,/previous\?\.patchId===PATCH_ID/,'same-version duplicate delivery must be a no-op');
  assert.match(owner,/previous\?\.getStatus\?\.\(\)\.active/,'an older owner already running a protected purge flow must not be replaced mid-flight');
  assert.match(owner,/setTimeout\(claimPurgeOwner,4200\)/,'new owner must reclaim after older delayed owner callbacks could still fire');
  assert.match(owner,/setTimeout\(claimPurgeOwner,8000\)/,'new owner must win even on a heavily delayed stale-loader callback');

  assert.match(owner,/error\.code=String\(data\.code\|\|'PURGE_HTTP_REJECTED'\)/,'structured server safety codes must survive the fetch wrapper instead of becoming fake transport errors');
  assert.match(owner,/TRANSIENT_CONTROL_CODES/);
  assert.match(owner,/submitPrepareRecovering/,'lost PREPARE responses must recover/reuse the persisted PREPARE instead of inviting another task');
  assert.match(owner,/submitExecuteRecovering/,'lost EXECUTE responses must recover server truth before considering a resubmission');
  assert.match(owner,/const recovered=await submitPrepareRecovering\(4\)/,'EXECUTE response loss must probe the server through the idempotent PREPARE recovery route first');
  assert.match(owner,/sameChallenge[\s\S]*?return postExecute\(challenge\)/,'DELETE may be resubmitted only when recovery proves no EXECUTE exists and the same verified challenge is still authoritative');
  assert.match(owner,/PURGE_TRANSPORT_INTERRUPTED/);
  assert.match(owner,/\^DATA_PURGE_\|\^V505_PURGE_/,'server safety blocks must render as protected/locked state, not “清空未执行” retry guidance');
  assert.match(owner,/不要重复点击；系统会继续按持久化任务和安全锁保护/);

  assert.match(startupProbe,/PROBE_AFTER_MS=75_000/,'browser waits before recovery probing; the server remains authoritative on the longer startup-orphan threshold');
  assert.match(startupProbe,/\/api\/admin\/data-purge\/prepare/,'startup probe must go through the serialized PREPARE control route');
  assert.doesNotMatch(startupProbe,/\/api\/admin\/data-purge\/execute/,'startup probe must never POST the destructive EXECUTE route');
  assert.match(startupProbe,/\['QUEUED','RUNNING'\]/,'only pre-commit startup states may trigger the probe');
  assert.match(startupProbe,/__CE_QC_V505_DATA_PURGE_RECOVERY__/,'probe must derive the exact currently protected browser job from the V505 owner');
  assert.match(startupProbe,/String\(status\?\.jobId\|\|''\)!==jobId/,'stale status evidence must match the exact current job before recovery is requested');

  assert.doesNotMatch(runtimeLoader,/20260911-v505-7/);
  assert.doesNotMatch(backupLoader,/20260911-v505-7/);
  assert.doesNotMatch(lazy,/20260911-v505-7/);
});

function responseJson(value,status=200){
  return {ok:status>=200&&status<300,status,async text(){return JSON.stringify(value);},async json(){return value;}};
}

test('V505 stale PREPARE browser probe asks only the serialized PREPARE route to recover the same durable job',async()=>{
  const source=read('public/v505-purge-startup-probe.js');
  const statusUrl=`/purge-status/${'e'.repeat(48)}.json`;
  const jobId='prepare-startup-probe-test';
  let statusReads=0;
  let preparePosts=0;
  let executePosts=0;
  const context={
    console:{info(){},warn(){},error(){}},
    setInterval(){return {unref(){}};},
    fetch:async(url,options={})=>{
      const method=String(options.method||'GET').toUpperCase();
      if(String(url).startsWith(statusUrl)){
        statusReads+=1;
        return responseJson({ok:true,jobId,status:'QUEUED',heartbeatAt:Date.now()-90_000});
      }
      if(url==='/api/admin/data-purge/prepare'&&method==='POST'){
        preparePosts+=1;
        return responseJson({ok:true,kind:'PREPARE',status:'QUEUED'});
      }
      if(url==='/api/admin/data-purge/execute'&&method==='POST'){
        executePosts+=1;
        return responseJson({ok:true});
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    },
    __CE_QC_V505_DATA_PURGE_RECOVERY__:{
      getStatus:()=>({active:true,currentJob:{kind:'PREPARE',status:'QUEUED',jobId,statusUrl}})
    }
  };
  context.window=context;
  vm.runInNewContext(source,context,{filename:'v505-purge-startup-probe.js'});
  await context.__CE_QC_V505_PURGE_STARTUP_PROBE__.tick();
  assert.equal(statusReads,1);
  assert.equal(preparePosts,1,'stale PREPARE startup state must request serialized server recovery through PREPARE');
  assert.equal(executePosts,0,'browser probe must never create or retry a destructive EXECUTE request');
});

async function runExecuteTransportScenario({acceptedBeforeDisconnect}){
  const source=read('public/v505-data-purge-recovery.js');
  const challenge={
    ok:true,status:'SUCCEEDED',challengeId:'challenge-v505-ui-test',notBefore:new Date(Date.now()-1000).toISOString(),
    databasePath:'D:/safe/test.db',backup:{path:'D:/safe/pre-clear.db',size:1024,integrity:'quick-ok'}
  };
  const executeJob={ok:true,async:true,kind:'EXECUTE',status:'QUEUED',jobId:'execute-v505-ui-test',statusUrl:`/purge-status/${'a'.repeat(48)}.json`};
  let preparePosts=0;
  let executePosts=0;
  let persistedExecute=null;
  let reloads=0;
  const alerts=[];
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,hidden:false,innerHTML:'',textContent:'',insertAdjacentHTML(_where,html){this.innerHTML+=html;}});
    return nodes.get(id);
  };
  const context={
    AbortController,
    console:{info(){},warn(){},error(){}},
    document:{getElementById:id=>node(id)},
    location:{reload(){reloads+=1;}},
    confirm:()=>true,
    alert:value=>alerts.push(String(value)),
    setTimeout(fn){queueMicrotask(fn);return 1;},
    clearTimeout(){},
    setInterval(){return 1;},
    clearInterval(){},
    fetch:async(url,options={})=>{
      const method=String(options.method||'GET').toUpperCase();
      if(url==='/api/session')return responseJson({ok:true,user:{role:'ADMIN'}});
      if(url==='/api/admin/data-purge/prepare'&&method==='POST'){
        preparePosts+=1;
        return responseJson(persistedExecute||challenge);
      }
      if(url==='/api/admin/data-purge/execute'&&method==='POST'){
        executePosts+=1;
        if(executePosts===1){
          if(acceptedBeforeDisconnect)persistedExecute=executeJob;
          throw new TypeError('socket reset after request transmission');
        }
        persistedExecute=executeJob;
        return responseJson(executeJob,202);
      }
      if(String(url).startsWith('/purge-status/'))return responseJson({ok:true,jobId:executeJob.jobId,status:'SUCCEEDED'});
      throw new Error(`unexpected fetch ${method} ${url}`);
    }
  };
  context.window=context;
  vm.runInNewContext(source,context,{filename:'v505-data-purge-recovery.js'});
  await context.openDataPurge();
  return {preparePosts,executePosts,reloads,alerts,preview:node('purgePreview').innerHTML};
}

test('V505 lost EXECUTE response recovers an already-persisted job without sending a second DELETE request',async()=>{
  const result=await runExecuteTransportScenario({acceptedBeforeDisconnect:true});
  assert.equal(result.executePosts,1,'when the first EXECUTE reached the server, browser recovery must discover that exact job rather than POST EXECUTE again');
  assert.equal(result.preparePosts,2,'one initial PREPARE plus one idempotent recovery probe is sufficient');
  assert.equal(result.reloads,1);
  assert.deepEqual(result.alerts,[]);
});

test('V505 retries EXECUTE once only after recovery proves no execute job exists and the same challenge is still valid',async()=>{
  const result=await runExecuteTransportScenario({acceptedBeforeDisconnect:false});
  assert.equal(result.executePosts,2,'a second EXECUTE is allowed only after PREPARE recovery proves the first request was not persisted');
  assert.equal(result.preparePosts,2);
  assert.equal(result.reloads,1);
  assert.deepEqual(result.alerts,[]);
});