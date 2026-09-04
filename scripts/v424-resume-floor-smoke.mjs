import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const v67Source=fs.readFileSync('public/v67-resilient-run-guard.js','utf8');
const v169Source=fs.readFileSync('public/v169-seven-business-legacy-status-sync.js','utf8');
const v322Source=fs.readFileSync('src/v322WebAvailabilityPatch.js','utf8');
const v415Source=fs.readFileSync('src/v415RetroactiveCompletionGuard.js','utf8');
const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');
const backupSource=fs.readFileSync('scripts/CE_QC_PreUpdate_Backup.mjs','utf8');

assert.match(v67Source,/V424_RESUME_FLOOR_REVISION\s*=\s*'2026-09-04-v424-restart-proof-resume-floor-v1'/);
assert.match(v169Source,/V424_RESUME_FLOOR_HANDOFF_REVISION='2026-09-04-v424-v169-v67-proof-handoff-v1'/);
assert.match(v322Source,/V424_SAME_LIFECYCLE_COMPLETION_FALLBACK_ID='2026-09-04-v424-same-lifecycle-completion-snapshot-v1'/);
assert.match(v415Source,/V424_SAME_LIFECYCLE_COMPLETION_GUARD_ID='2026-09-04-v424-same-lifecycle-completion-proof-v1'/);

function assertCurrentMemberCompletionSemantics(name,source){
  assert.doesNotMatch(source,/function currentCompletionSnapshot[\s\S]*?if\(!id\)return null/,`${name} must not let a later runId hide same-lifecycle completion`);
  assert.match(source,/claimSource:'SAME_VALID_IMPORT_LIFECYCLE'/,`${name} must expose the bounded same-lifecycle fallback`);
  assert.match(source,/lifecycle&&atOrAfter\(lifecycle\.generatedAt,boundary\)/,`${name} lifecycle fallback must stay behind the current VALID import boundary`);
  assert.match(source,/function currentCompletionSnapshot[\s\S]*?reportDate=\?/,`${name} completion fallback must remain exact-date scoped`);
  assert.match(source,/function currentCompletionSnapshot[\s\S]*?COALESCE\(status,'VALID'\)='VALID'/,`${name} fallback must require VALID snapshots`);
  assert.match(source,/function currentCompletionSnapshot[\s\S]*?COALESCE\(reconciliationStatus,'COMPLETED'\)='COMPLETED'/,`${name} fallback must require completion-certified snapshots`);
  assert.match(source,/function currentCompletionSnapshot[\s\S]*?businessType='SHOPEE'/,`${name} SHOPEE fallback must remain isolated to SHOPEE snapshots`);

  assert.match(source,/readV418CurrentMembershipCounts/,`${name} status proof must remain anchored to V418 current membership`);
  assert.match(source,/readV418CcslProcessingProof\(db,\{reportDate:date,snapshotId,boundary\}\)/,`${name} CCSL fallback still requires exact current-member processing proof`);

  const directShopeeProof=/readV418BusinessSuccessCoverage\(db,\{businessType:'SHOPEE',date,snapshotId,boundary,memberTypes:\['SHOPEECN','SHOPEEVN'\]\}\)/.test(source);
  const helperDelegatesToV418=/function\s+businessSuccessCoverage\([^)]*\)[\s\S]{0,500}?readV418BusinessSuccessCoverage\(db,\{businessType,date,snapshotId,boundary,memberTypes\}\)[\s\S]{0,220}?result\?\.ok\?n\(result\.count\):0/.test(source);
  const helperUsesExactShopeeCohort=/businessSuccessCoverage\(db,\{businessType:'SHOPEE',date,snapshotId,boundary,memberTypes:\['SHOPEECN','SHOPEEVN'\]\}\)/.test(source);
  assert.ok(directShopeeProof||(helperDelegatesToV418&&helperUsesExactShopeeCohort),`${name} SHOPEE completion must reach V418 SUCCESS coverage for the exact SHOPEECN+SHOPEEVN current cohort, directly or through the fail-closed helper`);

  const directFullCoverage=/coverage\?\.ok&&n\(coverage\.count\)>=n\(counts\.SHOPEE\)/.test(source);
  const helperFullCoverage=/shopeeSnapshot&&shopeeCovered>=counts\.SHOPEE/.test(source);
  assert.ok(directFullCoverage||helperFullCoverage,`${name} SHOPEE completion must require full current-member SUCCESS coverage, never partial evidence`);

  assert.match(source,/memberTypes:\['WHPP'\]/,`${name} WHPP proof must remain isolated to the exact WHPP current cohort`);
  const directWhppCoverage=/coverage\?\.ok&&n\(coverage\.count\)>=n\(counts\.WHPP\)/.test(source);
  const helperWhppCoverage=/whppCovered>=counts\.WHPP/.test(source);
  assert.ok(directWhppCoverage||helperWhppCoverage,`${name} WHPP completion must also require full current-member SUCCESS coverage`);
}
for(const [name,source] of [['V322',v322Source],['V415',v415Source]])assertCurrentMemberCompletionSemantics(name,source);

assert.match(shell,/<script src="\/v67-resilient-run-guard\.js\?v=20260904-v424-1"/);
assert.match(shell,/<script src="\/v169-seven-business-legacy-status-sync\.js\?v=20260904-v424-1"/);

// V425 storage hygiene is updater-only. The live database stays where DATA_DIR/DB_FILE
// points, while verified pre-update copies may use C or D according to real free space.
// Cleanup is constrained to updater-owned backup paths and must retain at least two
// verified physical rollback copies before older copies can be retired.
assert.match(backupSource,/V425_BACKUP_STORAGE_POLICY_ID='2026-09-04-v425-c-d-auto-backup-retention-v1'/,'pre-update backup must expose the C/D auto-storage policy');
assert.match(backupSource,/managedBackupRoot=path\.join\(managedLauncherHome,'backups','pre_update'\)/,'C-side managed launcher backup root must be available');
assert.match(backupSource,/legacyBackupRoot=path\.join\(dataDir,'backups','pre_update'\)/,'existing D-side pre_update backups must remain discoverable');
assert.match(backupSource,/fs\.statfsSync\(existing\)/,'backup placement must use actual filesystem free-space data');
assert.match(backupSource,/sort\(\(a,b\)=>b\.freeBytes-a\.freeBytes\)/,'C/D candidates must prefer the root with more real free space');
assert.match(backupSource,/PHYSICAL_BACKUP_KEEP_COUNT=Math\.max\(2/,'automatic cleanup must never reduce verified physical rollback copies below two');
assert.match(backupSource,/function safeRemoveBackupDir[\s\S]*if\(!isDirectChildOfBackupRoot\(dir\)\)/,'recursive cleanup must be constrained to direct children of known pre_update roots');
assert.match(backupSource,/function pruneLegacyLooseBackups[\s\S]*physicalVerifiedBackups\(\)\.length<PHYSICAL_BACKUP_KEEP_COUNT/,'legacy loose updater copies may be pruned only after the verified retention floor exists');
assert.match(backupSource,/INSUFFICIENT_BACKUP_SPACE:[\s\S]*C\/D auto-selection refused an unsafe copy/,'full backup must fail closed when neither C nor D has safe headroom');
assert.doesNotMatch(backupSource,/fs\.(?:rmSync|unlinkSync)\(dbFile/,'storage cleanup must never delete the live SQLite database');

const REPORT_DATE='2026-09-01';
function v168Truth(){
  const checkedAt=Date.now();
  return{
    reportDate:REPORT_DATE,
    complete:false,
    statusFresh:true,
    checkedAt,
    stages:[
      {key:'CCSL',complete:true,state:'done',date:REPORT_DATE,statusFresh:true},
      {key:'SHOPEE',complete:false,state:'failed',date:REPORT_DATE,details:'PROCESS_RESTART_INTERRUPTED',statusFresh:true},
      {key:'WHPP',complete:false,state:'pending',date:REPORT_DATE,statusFresh:true}
    ]
  };
}
function persistedAll({ccslComplete=true,shopeeComplete=true,whppComplete=true}={}){
  const stage=(key,complete)=>({key,reportDate:REPORT_DATE,complete,statusFresh:true,lastMessage:'',state:complete?'done':'pending'});
  return{
    ok:true,
    statusVersion:'2026-09-02-v414-one-read-seven-business-status-v1',
    reportDate:REPORT_DATE,
    complete:ccslComplete&&shopeeComplete&&whppComplete,
    stages:{CCSL:stage('CCSL',ccslComplete),SHOPEE:stage('SHOPEE',shopeeComplete),WHPP:stage('WHPP',whppComplete)}
  };
}
function makeResponse(payload,status=200){
  return{ok:status>=200&&status<300,status,text:async()=>JSON.stringify(payload)};
}
async function installV67({bareResume=false}={}){
  const calls=[];
  let getCount=0;
  const statusNode={dataset:{},innerHTML:''};
  const runButton={disabled:false,textContent:'',title:'',dataset:{}};
  const document={
    readyState:'complete',visibilityState:'visible',body:{},
    getElementById(id){
      if(id==='importPage')return{hidden:false};
      if(id==='reportDate')return{value:REPORT_DATE};
      if(id==='ccslRunStatus')return statusNode;
      return null;
    },
    querySelector(selector){return selector==='[data-testid="global-auto-process"]'?runButton:null;},
    addEventListener(){},dispatchEvent(){}
  };
  class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
  const truth=v168Truth();
  const window={document,location:{pathname:'/import'},addEventListener(){},__CE_QC_V168_SEVEN_BUSINESS_STATUS__:{lastTruth:truth}};
  const nativeSetTimeout=setTimeout;
  const timer=(fn,ms,...args)=>Number(ms||0)<=20?nativeSetTimeout(fn,ms,...args):0;
  const fetch=async(url,options={})=>{
    const method=String(options.method||'GET').toUpperCase();
    calls.push({method,url:String(url)});
    if(method==='POST')return makeResponse({ok:true});
    if(String(url).startsWith('/api/v33/run-progress?')){
      getCount+=1;
      if(bareResume&&getCount===1)return makeResponse(persistedAll({ccslComplete:false,shopeeComplete:true,whppComplete:true}));
      return makeResponse(persistedAll());
    }
    if(String(url).startsWith('/api/import/unified-latest'))return makeResponse({ok:true,import:{reportDate:REPORT_DATE}});
    return makeResponse({ok:true});
  };
  const context={window,document,location:window.location,CustomEvent,console,fetch,URLSearchParams,AbortController,Promise,Date,setTimeout:timer,clearTimeout, setInterval:()=>0,clearInterval:()=>{}};
  vm.runInNewContext(v67Source,context,{filename:'v67-resilient-run-guard.js'});
  await new Promise(resolve=>nativeSetTimeout(resolve,5));
  assert.equal(typeof window.resumeUnified,'function','V67 must install the public resume entry');
  return{window,calls,truth,statusNode};
}

{
  const {window,calls,truth}=await installV67();
  const handoff=window.__CE_QC_V67_RESILIENT_RUN_GUARD__.createShopeeRestartHandoff({reportDate:REPORT_DATE,checkedAt:truth.checkedAt});
  assert.ok(handoff,'fresh exact V168 restart proof must produce an opaque V67 resume-floor handoff');
  assert.equal(handoff.resumeStage,'SHOPEE');
  const result=await window.resumeUnified(handoff);
  const posts=calls.filter(call=>call.method==='POST').map(call=>call.url);
  assert.equal(posts.filter(url=>url==='/api/resume').length,0,'SHOPEE restart floor must never reopen CCSL /api/resume');
  assert.equal(posts.filter(url=>url==='/api/run').length,0,'SHOPEE restart floor must never reopen CCSL /api/run');
  assert.equal(posts.filter(url=>url==='/api/shopee/run/resume').length,1,'SHOPEE restart floor must resume SHOPEE exactly once');
  assert.equal(posts.filter(url=>url.startsWith('/api/whpp/run/')).length,0,'already-complete WHPP truth must be skipped after SHOPEE resume');
  assert.equal(result.ok,true);
  assert.equal(result.results.length,3);
  assert.equal(result.results[0].skipped,true);
  assert.equal(result.results[0].resumeFloor,'2026-09-04-v424-restart-proof-resume-floor-v1');
}
{
  const {window,truth}=await installV67();
  assert.equal(window.__CE_QC_V67_RESILIENT_RUN_GUARD__.createShopeeRestartHandoff({reportDate:REPORT_DATE,checkedAt:truth.checkedAt-1}),null,'checkedAt mismatch must reject the handoff');
  assert.equal(window.__CE_QC_V67_RESILIENT_RUN_GUARD__.createShopeeRestartHandoff({reportDate:'2026-08-31',checkedAt:truth.checkedAt}),null,'wrong-date handoff must be rejected');
}
{
  const {window,calls}=await installV67({bareResume:true});
  const forged={revision:'2026-09-04-v424-restart-proof-resume-floor-v1',resumeStage:'SHOPEE',reportDate:REPORT_DATE,issuedAt:Date.now()};
  await window.resumeUnified(forged);
  const posts=calls.filter(call=>call.method==='POST').map(call=>call.url);
  assert.equal(posts.filter(url=>url==='/api/resume').length,1,'a forged/bare resume has no resume-floor privilege and retains normal CCSL verification/resume semantics');
}

console.log('[V425/V424] restart resume-floor + backup storage smoke passed · same fresh V168 proof skips already-complete CCSL · CCSL /api/resume=0 on exact SHOPEE restart · SHOPEE resume=1 · stale/wrong/forged handoffs rejected · V322+V415 completion remains current-member-proven · C/D backup selection is free-space aware · updater cleanup retains >=2 verified physical backups and cannot delete live SQLite');
