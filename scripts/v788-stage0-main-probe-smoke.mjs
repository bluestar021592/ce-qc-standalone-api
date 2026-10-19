import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {inspectStage0UpdateProbe,STAGE0_PROBE_ID} from '../src/v788Stage0UpdateProbe.js';

const server=fs.readFileSync('server.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const script=fs.readFileSync('public/v788-stage0-update.js','utf8');
assert.match(server,/app\.get\('\/api\/admin\/v788-stage0-update', requireRole\('ADMIN'\)/);
assert.match(server,/inspectStage0UpdateProbe\(__dirname\)/);
assert.match(html,/id="v788Stage0UpdateRefresh"/);
assert.match(html,/id="v788Stage0UpdateResult"/);
assert.match(html,/v788-stage0-update\.js\?v=20261019-stage0-1/);
assert.doesNotMatch(script,/fetch\(['"]\/api\/admin\/data-purge/,'stage0 must not start purge');
assert.doesNotMatch(script,/method:['"]POST/,'stage0 must stay GET-only');

const empty=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-stage0-'));
try{
  const p=inspectStage0UpdateProbe(empty);
  assert.equal(p.ok,true);
  assert.equal(p.backendResponding,true);
  assert.equal(p.installedCommit,'');
  assert.equal(p.installedBranch,'UNKNOWN');
  assert.equal(p.localMainMatchesCachedRemote,false);
  assert.equal(p.authorizedToClear,false);
  assert.equal(p.v788FullReleaseInstalled,false);
  assert.equal(p.productionModified,false);
}finally{fs.rmSync(empty,{recursive:true,force:true})}
const real=inspectStage0UpdateProbe(process.cwd());
assert.equal(real.probeId,STAGE0_PROBE_ID);
assert.equal(real.readOnly,true);
assert.equal(real.authorizedToClear,false);
assert.equal(real.realExcelValidated,false);

async function browser(responseStatus,body){
  const out={textContent:''},handlers={};
  const button={disabled:false,addEventListener(name,fn){handlers['button-'+name]=fn}};
  const tab={addEventListener(name,fn){handlers['tab-'+name]=fn}};
  const calls=[];
  const document={
    body:{dataset:{page:'settings'}},
    getElementById(id){return id==='v788Stage0UpdateResult'?out:
      id==='v788Stage0UpdateRefresh'?button:null},
    querySelector(selector){
      assert.equal(selector,'#v625SettingsTabs [data-settings-tab="interface"]');
      return tab
    }
  };
  vm.runInNewContext(script,{
    document,
    AbortSignal:{timeout(){return {}}},
    fetch:async(url,options)=>{
      calls.push({url,options});
      return {ok:responseStatus===200,status:responseStatus,json:async()=>body};
    }
  },{timeout:1500});
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(button.disabled,false,'UI must restore refresh after read');
  assert.equal(calls.length,1,'one initial read only');
  assert.equal(calls[0].url,'/api/admin/v788-stage0-update');
  assert.equal(calls[0].options.method,'GET');
  return {output:out.textContent,tabClick:handlers['tab-click']};
}
const proof={
  ...real,installedCommit:'c'.repeat(40),installedBranch:'main',
  cachedOriginMainCommit:'c'.repeat(40),localMainMatchesCachedRemote:true
};
const good=await browser(200,proof);
assert.match(good.output,/本机5177后台已响应/);
assert.match(good.output,/完整V788：尚未安装或完成真实业务验收/);
assert.match(good.output,/清空旧数据：未放行/);
const blocked=await browser(403,{});
assert.match(blocked.output,/需要管理员登录/);
assert.match(blocked.output,/不能据此清空/);
const unsafe=await browser(200,{...proof,authorizedToClear:true});
assert.match(unsafe.output,/没有完成/);
assert.doesNotMatch(unsafe.output,/后台已响应/);
console.log('[V788 STAGE0 MAIN] PASS standalone admin-readonly local Git version probe, UI 200/403/fail-closed, no business DB or purge');
