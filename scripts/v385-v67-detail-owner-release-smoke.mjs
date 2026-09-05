import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const file='public/v138-ccsl-scan-progress.js';
execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const source=fs.readFileSync(file,'utf8');
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

execFileSync(process.execPath,['scripts/v386-dirty-dashboard-cache-truth-smoke.mjs'],{stdio:'inherit'});
console.log('[V427/V386/V385] status + dashboard truth smoke passed · V168 solely owns idle exact-date status · V138 issues zero idle V317 requests · active V67 CCSL keeps 350/50 live detail · dirty current dates cannot serve stale derived POD/open metrics');
