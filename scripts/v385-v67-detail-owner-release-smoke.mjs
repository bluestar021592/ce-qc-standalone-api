import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const file='public/v138-ccsl-scan-progress.js';
const v428File='public/v428-base-ccsl-status-owner.js';
execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
execFileSync(process.execPath,['--check',v428File],{stdio:'pipe'});
const source=fs.readFileSync(file,'utf8');
const v428Source=fs.readFileSync(v428File,'utf8');
const loader=fs.readFileSync('src/v44WhppUiPatch.js','utf8');

assert.match(source,/2026-08-31-v385-release-stale-v67-detail-owner-v1/,'V385 detail-owner release revision must remain active');
assert.match(source,/2026-09-05-v427-v168-idle-status-single-owner-v1/,'V427 must declare V168 as the single idle status owner');
assert.match(source,/function releaseV67Owner\(node\)[\s\S]*delete node\.dataset\.v67UnifiedOwner[\s\S]*delete node\.dataset\.v67UnifiedReportDate/,'stale V67 DOM ownership markers must be removable');
assert.match(source,/function activeV67Ccsl\(\)[\s\S]*stage\?\.owner==='V67'[\s\S]*stage\.active===true[\s\S]*===\s*'CCSL'/,'V138 live detail must be restricted to an actually active V67 CCSL stage');
assert.match(source,/function v168OwnsIdleLegacyStatus\(node\)[\s\S]*activeV67Ccsl\(\)[\s\S]*__CE_QC_V168_SEVEN_BUSINESS_STATUS__/,'modern idle detail ownership must belong to V168');
assert.match(source,/if\(stage\?\.owner==='V67'\)\{[\s\S]*if\(stage\.active===true\)[\s\S]*releaseV67Owner\(node\);[\s\S]*return false/,'inactive V67 runner must release CCSL detail ownership immediately');
assert.match(source,/if\(node\.dataset\.v67UnifiedOwner==='1'\)releaseV67Owner\(node\);[\s\S]*return false/,'orphaned V67 ownership without a live runner must also be released');
assert.doesNotMatch(source,/if\(node\.dataset\.v67UnifiedOwner!=='1'\)return false;[\s\S]*return true/,'stale same-date dataset ownership must never permanently block the current owner');
assert.match(source,/if\(global\.__CE_QC_V168_SEVEN_BUSINESS_STATUS__\)\{\s*if\(!activeV67Ccsl\(\)\)return null;[\s\S]*else\{[\s\S]*canonicalCcsl\(reportDate\)/,'V168 modern shell must return before V317 idle recovery polling; V317 is legacy-only fallback');
assert.match(source,/if\(polling\|\|!page\|\|page\.hidden\|\|v168OwnsIdleLegacyStatus\(status\)\)return/,'idle V138 tick must stop before issuing any status request while V168 owns the page');
assert.match(source,/function enforceLastTruth\(\)[\s\S]*if\(v168OwnsIdleLegacyStatus\(status\)\)return/,'250ms legacy repaint enforcement must be inert while V168 owns idle status');
assert.match(source,/status&&\(unifiedOwnsLegacyStatus\(status\)\|\|v168OwnsIdleLegacyStatus\(status\)\)/,'V138 renderer must never repaint over V168 idle fail-closed truth');
assert.match(source,/postJson\('\/api\/v317\/ccsl-recovery'/,'legacy compatibility may retain canonical V317 recovery');
assert.match(source,/setInterval\(enforceLastTruth,250\)/,'active-run CCSL detail repaint enforcement remains available');
assert.match(loader,/v138-ccsl-scan-progress\.js\?v=20260905-v427-1/,'shell must cache-bust the V427 V138 owner fix');

assert.match(v428Source,/2026-09-05-v428-retire-base-ccsl-status-writer-v1/,'V428 base-writer retirement revision must be active');
assert.match(v428Source,/const original=global\.runStatusMarkup/,'V428 must wrap the actual base runStatusMarkup writer contract');
assert.match(v428Source,/function v168OwnsIdleStatus\(\)[\s\S]*__CE_QC_V168_SEVEN_BUSINESS_STATUS__[\s\S]*!activeV67Ccsl\(\)/,'V428 must give idle legacy status ownership exclusively to V168');
assert.match(v428Source,/if\(v168OwnsIdleStatus\(\)\)[\s\S]*unconfirmedMarkup\(\)[\s\S]*node\.innerHTML/,'V428 must preserve V168 fail-closed/fresh DOM instead of recomputing base appState completion');
assert.match(v428Source,/return original\.apply\(this,arguments\)/,'V428 must delegate during active V67 CCSL so live 350/50 progress remains intact');
assert.match(loader,/v428-base-ccsl-status-owner\.js\?v=20260905-v428-1/,'shell must load the V428 base status owner retirement after V168');
const v168LoaderIndex=loader.indexOf('/v168-seven-business-status.js?v=20260902-v414-status-1');
const v428LoaderIndex=loader.indexOf('/v428-base-ccsl-status-owner.js?v=20260905-v428-1');
assert.ok(v168LoaderIndex>=0&&v428LoaderIndex>v168LoaderIndex,'V428 must load after V168 so base renders cannot regain idle ownership');

// Execute the browser owner boundary with a tiny DOM/fetch harness. This catches a
// future regression where source still contains the guard text but idle code issues
// a network request or repaints a cached completion anyway.
const fetches=[];
const statusNode={dataset:{},innerHTML:'V168 状态确认中'};
const reportDateNode={value:'2026-09-05'};
const importPageNode={hidden:false};
const context={
  console,
  setInterval:()=>0,
  clearInterval:()=>{},
  setTimeout:()=>0,
  clearTimeout:()=>{},
  location:{pathname:'/import'},
  document:{
    readyState:'complete',
    getElementById(id){
      if(id==='ccslRunStatus')return statusNode;
      if(id==='reportDate')return reportDateNode;
      if(id==='importPage')return importPageNode;
      return null;
    },
    querySelector(){return null;},
    addEventListener(){}
  },
  fetch:async(url,options={})=>{
    fetches.push({url:String(url),method:String(options.method||'GET').toUpperCase()});
    return {
      ok:true,
      async json(){return {ok:true,businessType:'CCSL',reportDate:'2026-09-05',running:true,phase:'订单扫描',scanDone:7,scanTotal:350,trackDone:0,trackTotal:0};}
    };
  }
};
context.window=context;
context.__CE_QC_V168_SEVEN_BUSINESS_STATUS__={lastTruth:{reportDate:'2026-09-05',statusFresh:false,complete:false}};
vm.runInNewContext(source,context,{filename:file});
const api=context.__CE_QC_V138_CCSL_SCAN_PROGRESS__;
assert.ok(api,'V138 runtime API must install');

const idle=await api.read('CCSL');
assert.equal(idle,null,'idle modern V138 read must return without legacy status I/O');
assert.equal(fetches.length,0,'idle modern V138 must issue zero requests, especially zero V317 POSTs');
api.progressByType.set('CCSL',{businessType:'CCSL',reportDate:'2026-09-05',complete:true,canonicalTruth:true,runStatus:'completed'});
api.enforceLastTruth();
assert.equal(statusNode.innerHTML,'V168 状态确认中','cached legacy completion must not repaint over V168 fail-closed idle truth');

context.__CE_QC_UNIFIED_RUN_STAGE__={owner:'V67',type:'CCSL',active:true,reportDate:'2026-09-05'};
const active=await api.read('CCSL');
assert.equal(active?.running,true,'active V67 CCSL must still receive live progress');
assert.equal(fetches.length,1,'active V67 CCSL should issue exactly one live progress request');
assert.match(fetches[0].url,/^\/api\/v33\/run-progress\?businessType=CCSL&reportDate=2026-09-05$/,'active CCSL must use V33 live progress directly');
assert.equal(fetches[0].method,'GET','active CCSL progress must be a read-only GET');
assert.equal(fetches.some(row=>row.url==='/api/v317/ccsl-recovery'),false,'modern V168 shell must never POST V317 from V138');
api.enforceLastTruth();
assert.match(statusNode.innerHTML,/单批最大350/,'active V67 CCSL must preserve 350-ticket live detail rendering');

// Reproduce the exact production bug from V427: base app.js calls runStatusMarkup
// again after V168 has fail-closed. V428 must make that assignment idempotent.
const baseCalls=[];
const baseStatusNode={innerHTML:'<span>V168 已保护</span>'};
const v428Context={
  console,
  document:{getElementById(id){return id==='ccslRunStatus'?baseStatusNode:null;}},
  runStatusMarkup(){baseCalls.push('base');return '<span>已完成</span><p>当前阶段：处理完成</p><p>轨迹进度：0 / 0 · 单批最大50</p>';},
  __CE_QC_V168_SEVEN_BUSINESS_STATUS__:{lastTruth:{reportDate:'2026-09-05',statusFresh:false,complete:false,stages:[{state:'unknown',statusFresh:false}]}}
};
v428Context.window=v428Context;
vm.runInNewContext(v428Source,v428Context,{filename:v428File});
assert.ok(v428Context.__CE_QC_V428_BASE_CCSL_STATUS_OWNER__,'V428 runtime owner must install');
const guarded=v428Context.runStatusMarkup({processing:{phase:'处理完成'},runStatus:'finished'});
assert.match(guarded,/状态确认中/,'base app.js stale completed markup must be replaced by fail-closed status-confirming markup');
assert.doesNotMatch(guarded,/处理完成|轨迹进度/,'V428 must block the exact stale V427 screenshot content while status is unconfirmed');
assert.equal(baseCalls.length,0,'idle V168 ownership must bypass the base runStatusMarkup computation entirely');

v428Context.__CE_QC_V168_SEVEN_BUSINESS_STATUS__.lastTruth={reportDate:'2026-09-05',statusFresh:true,complete:true,stages:[{state:'done',statusFresh:true}]};
baseStatusNode.innerHTML='<span>V168 fresh completed truth</span>';
const fresh=v428Context.runStatusMarkup({processing:{phase:'处理完成'},runStatus:'finished'});
assert.equal(fresh,baseStatusNode.innerHTML,'fresh idle status must preserve the DOM already rendered by V168');
assert.equal(baseCalls.length,0,'fresh idle V168 truth must still bypass the base writer');

v428Context.__CE_QC_UNIFIED_RUN_STAGE__={owner:'V67',type:'CCSL',active:true,reportDate:'2026-09-05'};
const delegated=v428Context.runStatusMarkup({processing:{phase:'订单扫描'},runStatus:'running'});
assert.match(delegated,/轨迹进度|处理完成/,'active V67 CCSL must delegate to the prior live/base renderer chain');
assert.equal(baseCalls.length,1,'active V67 CCSL must delegate exactly once');

execFileSync(process.execPath,['scripts/v386-dirty-dashboard-cache-truth-smoke.mjs'],{stdio:'inherit'});
console.log('[V428/V427/V386/V385] status + dashboard truth smoke passed · base app.js stale completion writer retired under V168 · V138 issues zero idle V317 requests · active V67 CCSL keeps 350/50 live detail · dirty current dates cannot serve stale derived POD/open metrics');
