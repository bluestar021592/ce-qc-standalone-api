import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const RUNTIME_V505_URL='/v505-data-purge-recovery.js?v=20260911-v505-8';
const V545_V505_URL='/v505-data-purge-recovery.js?v=20260920-v555-1';
const STARTUP_PROBE_URL='/v505-purge-startup-probe.js?v=20260912-v505-startup-probe-2';
const V502_URL='/v502-multidrive-backup-ui.js?v=20260912-v502-3';

test('V545 cache-busted purge owner is delivered after app.js and requires explicit backup plus explicit delete confirmation',()=>{
  const index=read('public/index.html');
  const runtimeLoader=read('public/v14-geometry-fixture.js');
  const backupLoader=read('public/v502-multidrive-backup-ui.js');
  const lazy=read('public/v108-route-lazy-features.js');
  const owner=read('public/v505-data-purge-recovery.js');
  const startupProbe=read('public/v505-purge-startup-probe.js');
  const purgeConsole=read('public/purge-console.html');

  const appAt=index.indexOf('/app.js?v=20261003-v623-1');
  const runtimeAt=index.indexOf('/v14-geometry-fixture.js?v=20261003-v623-1');
  assert.ok(appAt>=0&&runtimeAt>appAt,'V623 business runtime loader must remain after app.js so the modern purge owner can still supersede legacy inline functions');

  // The always-loaded compatibility chain may still bootstrap the older owner,
  // but V502 and the data-route lazy group must cache-bust and supersede it with V545.
  assert.match(runtimeLoader,/loadRuntimeScript\('\/v505-data-purge-recovery\.js\?v=20260911-v505-8'\)/);
  assert.match(runtimeLoader,/v502-multidrive-backup-ui\.js\?v=20260912-v502-3/);
  assert.ok(runtimeLoader.indexOf(RUNTIME_V505_URL)<runtimeLoader.indexOf(V502_URL));

  assert.match(backupLoader,/2026-09-15-v545-explicit-purge-owner-cache-bust-v1/);
  assert.match(backupLoader,/v505-data-purge-recovery\.js\?v=20260920-v555-1/,'V502 must request the visible-progress owner, not leave the older one authoritative');
  assert.match(backupLoader,/v555-visible-execute-progress/,'V502 must require the corrected visible-progress owner rather than accept stale V545');
  assert.match(backupLoader,/v505-purge-startup-probe\.js\?v=20260912-v505-startup-probe-2/);
  assert.ok(backupLoader.indexOf(STARTUP_PROBE_URL)>=0);
  assert.match(backupLoader,/script\.onload=loadStartupProbe/);

  assert.match(lazy,/2026-09-15-v545-explicit-purge-owner-v1/);
  assert.match(lazy,/v505-data-purge-recovery\.js\?v=20260920-v555-1/);
  assert.match(lazy,/v106-purge-legacy-controls-hide\.js\?v=20260915-v545-1/);
  assert.match(lazy,/event\.stopImmediatePropagation\(\)/,'first destructive click must be capture-blocked until V545 is installed');
  assert.match(lazy,/installed\.includes\('v555-visible-execute-progress'\)/,'lazy gate must refuse to invoke a stale V505 owner');
  assert.match(lazy,/loadGroup\('data'\)\.then/);
  assert.doesNotMatch(lazy,/v104-fast-purge-ui\.js/);

  assert.match(owner,/2026-09-20-v555-visible-execute-progress-v1/);
  assert.match(owner,/previous\?\.patchId===PATCH_ID/);
  assert.match(owner,/previous\?\.getStatus\?\.\(\)\.active/);
  assert.match(owner,/global\.continueDataPurge=v505ContinueDataPurge/,'legacy step-one button must be rebound to V545 explicit PREPARE');
  assert.match(owner,/global\.executeDataPurge=v505ExecuteDataPurge/,'legacy step-two button must be rebound to V545 explicit EXECUTE');
  assert.match(owner,/尚未开始任何备份或清空任务/,'opening the wizard must be inert');
  assert.match(owner,/只有点击“备份并继续”后才会创建并校验清空前安全备份/);
  assert.match(owner,/String\(phrase\?\.value\|\|''\)==='永久清除全部业务数据'/,'DELETE button must require the exact destructive phrase');
  assert.match(owner,/Boolean\(checkbox\?\.checked\)/,'DELETE button must require explicit backup acknowledgement');
  assert.match(owner,/最终确认：现在将永久清除全部业务数据/,'DELETE submission must require a final user confirmation');
  assert.match(owner,/showExecutionProgress/,'final confirmation must switch to a visible execution state before network submission');
  assert.match(owner,/if\(stepTwo\)stepTwo\.hidden=true/,'confirmation form must be hidden once EXECUTE is accepted client-side');
  assert.match(owner,/if\(stepOne\)stepOne\.hidden=false/,'the live status panel must be visible while EXECUTE runs');
  assert.match(owner,/if\(button\)button\.disabled=true/,'the destructive button must disable immediately after final confirmation');
  assert.match(purgeConsole,/v560-direct-data-purge\.js\?v=20261017-v788-replay-2/,'lightweight purge console now intentionally uses the direct no-backup owner');
  assert.doesNotMatch(purgeConsole,/v505-data-purge-recovery\.js/,'direct recovery console must not start the legacy backup owner');
  assert.match(owner,/v505ContinueDataPurge[\s\S]*?submitPrepareRecovering/,'PREPARE may start only from the explicit continue action');
  assert.match(owner,/v505ExecuteDataPurge[\s\S]*?executeChallenge\(preparedChallenge\)/,'EXECUTE may start only from the explicit final action');
  assert.match(owner,/setTimeout\(claimPurgeOwner,4200\)/);
  assert.match(owner,/setTimeout\(claimPurgeOwner,8000\)/);

  assert.match(owner,/error\.code=String\(data\.code\|\|'PURGE_HTTP_REJECTED'\)/);
  assert.match(owner,/TRANSIENT_CONTROL_CODES/);
  assert.match(owner,/submitPrepareRecovering/);
  assert.match(owner,/submitExecuteRecovering/);
  assert.match(owner,/const recovered=await submitPrepareRecovering\(4\)/);
  assert.match(owner,/sameChallenge[\s\S]*?return postExecute\(challenge\)/);
  assert.match(owner,/PURGE_TRANSPORT_INTERRUPTED/);
  assert.match(owner,/\^DATA_PURGE_\|\^V505_PURGE_/);
  assert.match(owner,/不要重复点击；系统会继续按持久化任务和安全锁保护/);
  assert.match(owner,/readExecutionFailureDetail/,'public FAILED status must trigger an authenticated detail probe');
  assert.match(owner,/recoverJobId:String\(job\?\.jobId\|\|''\)/,'failure detail probe must bind to the exact execute job id');
  assert.match(owner,/V505_PURGE_EXECUTE_FAILED/,'exact worker error must be surfaced without trusting the public status payload');
  assert.match(owner,/readLatestExecutionFailureDetail/,'reopening the wizard must be able to inspect retained failure evidence without starting a new backup');
  assert.match(owner,/inspectFailed:true/,'reopen diagnostic must use an explicit inert admin probe');
  assert.match(owner,/上一次清空未执行/);

  assert.match(startupProbe,/PROBE_AFTER_MS=75_000/);
  assert.match(startupProbe,/\/api\/admin\/data-purge\/prepare/);
  assert.doesNotMatch(startupProbe,/\/api\/admin\/data-purge\/execute/);
  assert.match(startupProbe,/\['QUEUED','RUNNING'\]/);
  assert.match(startupProbe,/__CE_QC_V505_DATA_PURGE_RECOVERY__/);
  assert.match(startupProbe,/String\(status\?\.jobId\|\|''\)!==jobId/);

  assert.ok(lazy.indexOf(V545_V505_URL)>=0);
  assert.doesNotMatch(backupLoader,/20260915-v544-1/);
  assert.doesNotMatch(lazy,/20260915-v544-1/);
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
  let diagnosticPosts=0;
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
  assert.equal(preparePosts,1);
  assert.equal(executePosts,0);
});

async function runExecuteTransportScenario({acceptedBeforeDisconnect}){
  const source=read('public/v505-data-purge-recovery.js');
  const challenge={
    ok:true,status:'SUCCEEDED',challengeId:'challenge-v545-ui-test',notBefore:new Date(Date.now()-1000).toISOString(),
    databasePath:'D:/safe/test.db',backup:{path:'D:/safe/pre-clear.db',size:1024,integrity:'quick-ok'},administrator:'admin'
  };
  const executeJob={ok:true,async:true,kind:'EXECUTE',status:'QUEUED',jobId:'execute-v545-ui-test',statusUrl:`/purge-status/${'a'.repeat(48)}.json`};
  let preparePosts=0;
  let diagnosticPosts=0;
  let executePosts=0;
  let persistedExecute=null;
  let executeUiAtSubmit=null;
  let reloads=0;
  const alerts=[];
  const confirms=[];
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,checked:false,value:'',innerHTML:'',textContent:'',insertAdjacentHTML(_where,html){this.innerHTML+=html;}});
    return nodes.get(id);
  };
  const context={
    AbortController,
    console:{info(){},warn(){},error(){}},
    document:{getElementById:id=>node(id)},
    location:{reload(){reloads+=1;}},
    confirm:value=>{confirms.push(String(value));return true;},
    alert:value=>alerts.push(String(value)),
    setTimeout(fn){queueMicrotask(fn);return 1;},
    clearTimeout(){},
    setInterval(){return 1;},
    clearInterval(){},
    accessSession:{user:{role:'ADMIN'}},
    fetch:async(url,options={})=>{
      const method=String(options.method||'GET').toUpperCase();
      if(url==='/api/admin/data-purge/prepare'&&method==='POST'){
        let body={};try{body=JSON.parse(String(options.body||'{}'));}catch{}
        if(body.inspectFailed===true){diagnosticPosts+=1;return responseJson({ok:true,kind:'NONE',status:'NONE',diagnostic:true});}
        preparePosts+=1;
        return responseJson(persistedExecute||challenge);
      }
      if(url==='/api/admin/data-purge/execute'&&method==='POST'){
        executePosts+=1;
        if(!executeUiAtSubmit)executeUiAtSubmit={stepOneHidden:node('purgeStepOne').hidden,stepTwoHidden:node('purgeStepTwo').hidden,buttonDisabled:node('purgeExecuteButton').disabled,preview:node('purgePreview').innerHTML};
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
  const afterOpen={preparePosts,executePosts};
  await context.continueDataPurge();
  const afterPrepare={preparePosts,executePosts};
  node('purgeBackupConfirmed').checked=true;
  node('purgePhrase').value='永久清除全部业务数据';
  context.updatePurgeButton();
  await context.executeDataPurge();
  return {afterOpen,afterPrepare,preparePosts,diagnosticPosts,executePosts,reloads,alerts,confirms,preview:node('purgePreview').innerHTML,executeUiAtSubmit};
}

test('V545 opening the purge wizard is inert and lost EXECUTE response recovers an already-persisted job without a second DELETE',async()=>{
  const result=await runExecuteTransportScenario({acceptedBeforeDisconnect:true});
  assert.deepEqual(result.afterOpen,{preparePosts:0,executePosts:0},'opening the purge wizard must not copy the DB or submit DELETE');
  assert.equal(result.diagnosticPosts,1,'opening may perform one inert admin-only failed-execute diagnostic');
  assert.deepEqual(result.afterPrepare,{preparePosts:1,executePosts:0},'explicit 备份并继续 may create PREPARE but must not auto-submit DELETE');
  assert.equal(result.executePosts,1,'when first EXECUTE reached server, recovery must discover that job rather than POST DELETE again');
  assert.equal(result.preparePosts,2,'one explicit PREPARE plus one idempotent recovery probe is sufficient');
  assert.equal(result.reloads,1);
  assert.deepEqual(result.alerts,[]);
  assert.equal(result.confirms.length,2,'wizard open and final destructive submission must be two separate confirmations');
  assert.deepEqual(result.executeUiAtSubmit?.stepOneHidden,false,'live status panel must be visible before EXECUTE fetch begins');
  assert.deepEqual(result.executeUiAtSubmit?.stepTwoHidden,true,'confirmation controls must disappear before EXECUTE fetch begins');
  assert.deepEqual(result.executeUiAtSubmit?.buttonDisabled,true,'destructive button must disable before EXECUTE fetch begins');
  assert.match(String(result.executeUiAtSubmit?.preview||''),/正在提交后台事务化清空任务/);
});

test('V545 retries EXECUTE once only after explicit final confirmation and recovery proves no execute job exists',async()=>{
  const result=await runExecuteTransportScenario({acceptedBeforeDisconnect:false});
  assert.deepEqual(result.afterOpen,{preparePosts:0,executePosts:0});
  assert.equal(result.diagnosticPosts,1);
  assert.deepEqual(result.afterPrepare,{preparePosts:1,executePosts:0});
  assert.equal(result.executePosts,2,'second EXECUTE is allowed only after server recovery proves first request was not persisted');
  assert.equal(result.preparePosts,2);
  assert.equal(result.reloads,1);
  assert.deepEqual(result.alerts,[]);
  assert.equal(result.confirms.length,2);
});

test('V788 direct no-backup purge stops polling after a terminal FAILED response, even for a V788 error code',async()=>{
  const source=read('public/v560-direct-data-purge.js');
  const phrase='永久清除全部业务数据';
  const nodes=new Map(), alerts=[];
  let now=1_000_000, statusReads=0, deletePosts=0;
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{
      id,hidden:true,disabled:false,value:'',innerHTML:'',textContent:''
    });
    return nodes.get(id);
  };
  class AdvancingDate extends Date {
    static now(){now+=7000;return now;}
  }
  const context={
    AbortController,Date:AdvancingDate,
    console:{info(){},warn(){},error(){}},
    document:{getElementById:node},
    alert:message=>alerts.push(String(message)),
    confirm:()=>true,
    setInterval:()=>1,clearInterval(){},
    setTimeout:callback=>{queueMicrotask(callback);return 1;},
    clearTimeout(){},
    fetch:async(url,options={})=>{
      if(url==='/api/session')
        return responseJson({ok:true,user:{role:'ADMIN'}});
      if(url==='/api/admin/data-purge/direct/preflight')
        return responseJson({ok:true,cp72Ready:true,activeCpCount:72,
          dataStorageReady:true,safeToStartClear:true,alreadyClearedNoFreshBusiness:false,version:{
            installedOnLocalMain:true,cachedMainMatchesInstalled:true,
            formalUpdateVerified:true,installedThroughManagedUpdaterVerified:true,
            installedCommit:'a'.repeat(40)
          }});
      if(url==='/api/admin/data-purge/direct'&&options.method==='POST'){
        deletePosts++;
        return responseJson({ok:true,jobId:'v788-terminal-failure',status:'QUEUED'},202);
      }
      if(url.startsWith('/api/admin/data-purge/direct/status?jobId=')){
        statusReads++;
        return responseJson({
          ok:true,jobId:'v788-terminal-failure',status:'FAILED',
          code:'V788_CP72_CHANGED',error:'CP门店配置变动，事务已安全回滚'
        });
      }
      throw Error('Unexpected request: '+url);
    }
  };
  context.window=context;
  vm.runInNewContext(source,context,{filename:'v560-direct-data-purge.js'});
  await context.openDirectDataPurge();
  node('directPurgePhrase').value=phrase;
  context.updateDirectPurgeButton();
  assert.equal(node('directPurgeExecuteButton').disabled,false,
    'exact phrase and elapsed countdown allow explicit submit in isolated UI test');
  await context.executeDirectDataPurge();
  assert.equal(deletePosts,1,'must submit the confirmed destructive action at most once');
  assert.equal(statusReads,1,'terminal FAILED must stop polling on first response regardless of error prefix');
  assert.match(node('directPurgePreview').innerHTML,/CP门店配置变动，事务已安全回滚/);
  assert.doesNotMatch(node('directPurgePreview').innerHTML,/全部业务数据已直接清空/);
  assert.equal(context.__CE_QC_V560_DIRECT_PURGE__.getStatus().active,false);
  assert.equal(context.__CE_QC_V560_DIRECT_PURGE__.getStatus().requiresReconciliation,true,
    'an uncertain destructive result must lock the current wizard');
  assert.equal(node('directPurgeExecuteButton').disabled,true,
    'failure must never silently re-enable the irreversible submit button');
  assert.match(node('directPurgePreview').innerHTML,/已禁止重复提交/);
  await context.openDirectDataPurge();
  assert.equal(alerts.length,1,'second attempt on same page must be blocked');
  assert.match(alerts[0],/上一笔直接清空请求的结果需要只读核对/);
});

test('V788 direct purge treats permanent task-status HTTP errors as non-retryable',()=>{
  const source=read('public/v560-direct-data-purge.js');
  assert.match(source,/Number\(error\?\.status\|\|0\)>=400&&Number\(error\?\.status\|\|0\)<500/,
    'unknown or unauthorized job must not run twenty repeated status requests');
  assert.match(source,/requiresReconciliation=true;/,
    'unknown result must trigger destructive resubmission lock');
});


test('V788 direct purge browser rejects an already-cleared empty DB before showing confirmation',async()=>{
  const source=read('public/v560-direct-data-purge.js');
  const nodes=new Map(), alerts=[];
  let deletePosts=0, confirms=0,preflightReads=0;
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,disabled:false,value:'',hidden:true,innerHTML:'',textContent:''});
    return nodes.get(id);
  };
  const context={
    AbortController,
    console:{info(){},warn(){},error(){}},
    document:{getElementById:node},
    location:{replace(){throw Error('Unexpected login redirect')}},
    alert:x=>alerts.push(String(x)),
    confirm:()=>{confirms++;return true;},
    setTimeout:()=>1,clearTimeout(){},
    setInterval:()=>1,clearInterval(){},
    fetch:async(url,options={})=>{
      if(url==='/api/session')return responseJson({ok:true,user:{role:'ADMIN'}});
      if(url==='/api/admin/data-purge/direct/preflight'){
        preflightReads++;
        return responseJson({ok:true,cp72Ready:true,activeCpCount:72,
          dataStorageReady:true,alreadyClearedNoFreshBusiness:true,safeToStartClear:false,
          code:'V788_PURGE_ALREADY_EMPTY'});
      }
      if(url==='/api/admin/data-purge/direct'&&options.method==='POST'){
        deletePosts++;return responseJson({ok:true},202);
      }
      throw Error('Unexpected request: '+url);
    }
  };
  context.window=context;
  vm.runInNewContext(source,context,{filename:'v560-direct-data-purge.js'});
  await context.openDirectDataPurge();
  assert.equal(preflightReads,1,'fresh server preflight must run before opening any destructive dialog');
  assert.equal(node('directPurgeDialog').hidden,true);
  assert.equal(deletePosts,0,'a previously emptied database must not receive another DELETE');
  assert.equal(confirms,0,'previously committed purge must bypass destructive confirmation entirely');
  assert.equal(alerts.length,1);
  assert.match(alerts[0],/上一笔清空已提交/);
});
