// Execute the shipped V625 admin delivery-check function in isolation.
// Its two existing ADMIN GET endpoints must never be mistaken for actual
// production installation/Excel approval or invoke destructive actions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('public/v625-shell.html','utf8');
const source=fs.readFileSync('public/v625-shell.js','utf8');
const first=source.indexOf('let v788FormalReadinessLoading=false;');
const last=source.indexOf('// V788 isolated WHPP trial lives in the REAL V625 shell',first);
assert.ok(first>0&&last>first,'one-click release-status logic must ship inside real V625 app');
assert.match(html,/id="v788FormalReadinessPanel"/);
assert.match(html,/id="v788FormalReadinessRefresh"/);
assert.match(html,/id="v788FormalReadinessText"/);
assert.ok(source.includes("byId('v788FormalReadinessRefresh')?.addEventListener('click',loadV788FormalReadinessV625)"));
assert.ok(source.includes("if(name==='interface'){void loadV788FormalReadinessV625()"),
  'opening interface settings should automatically show live delivery blockers');

async function check(release,audit){
  const output={textContent:''};
  const button={disabled:false};
  const requested=[];
  const c={
    page:'settings',console,
    byId:id=>id==='v788FormalReadinessText'?output:
      id==='v788FormalReadinessRefresh'?button:null,
    json:async(url)=>{
      requested.push(url);
      if(url==='/api/admin/data-purge/direct/preflight'){
        if(release instanceof Error)throw release;
        return release;
      }
      if(url==='/api/v788/readonly-audit/status'){
        if(audit instanceof Error)throw audit;
        return audit;
      }
      throw Error('Unexpected endpoint: '+url);
    }
  };
  vm.createContext(c);
  vm.runInContext(source.slice(first,last),c,{filename:'v625-shell.js',timeout:1000});
  await c.loadV788FormalReadinessV625();
  assert.equal(button.disabled,false,'read-only refresh must be usable after completion');
  assert.deepEqual(requested.sort(),[
    '/api/admin/data-purge/direct/preflight','/api/v788/readonly-audit/status'
  ],'delivery checker must issue only the two existing ADMIN GETs');
  return output.textContent;
}
const released={
  cp72Ready:true,activeCpCount:72,dataStorageReady:true,
  version:{installedCommit:'a'.repeat(40),installedBranch:'main',
    formalUpdateVerified:true,installedThroughManagedUpdaterVerified:true,
    installedOnLocalMain:true,cachedMainMatchesInstalled:true}
};
const historical={ok:true,status:'NEEDS_REAL_EVIDENCE',counts:{blocked:0,reviewing:2},
  isolatedSourceReady:true,existingWhppExcel:{status:'XLSX_CONTENT_VERIFIED'},
  gates:[]};
const good=await check(released,historical);
assert.match(good,/本机安装凭据已验证/);
assert.match(good,/72个，主数据盘可读/);
assert.match(good,/已有逐票回读通过（仅WHPP）/);
assert.match(good,/七业务真实日报导入、终态、签收天数与报表：仍须独立实机验收/);
assert.match(good,/不授权清空/,'even synthetic complete local signals must never permit deletion');

const draft=await check({...released,version:{
  ...released.version,formalUpdateVerified:false,installedBranch:'v788-board-calibration'
}}, {...historical,isolatedSourceReady:false,existingWhppExcel:null});
assert.match(draft,/未验证，不允许把候选版视为正式版/);
assert.match(draft,/先走正式候选版本审核、合并发布与托管更新/);
assert.match(draft,/未找到可安全读取的既有副本/);

const badCp=await check({...released,cp72Ready:false,activeCpCount:0},historical);
assert.match(badCp,/核查当前72个有效门店码/);
assert.match(badCp,/未达到正式检查条件/);

const offline=await check(new Error('request failed'),new Error('request failed'));
assert.match(offline,/当前系统后端：未能完整验证/);
assert.match(offline,/本机安装版本：无法核实/);
assert.match(offline,/旧业务数据清空：此检查不授权清空/);
assert.doesNotMatch(offline,/本机安装凭据已验证/);

console.log('[V788 LOCAL DELIVERY] PASS backend/auth/managed SHA/CP72/isolation/real Excel independent fail-closed read-only checklist');
