// Windows Edge integration for V788 settings. Disposable local DB only.
// Never queries CE TMS, never touches D: and never clicks the start button.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {createV788SyntheticEvidence,deleteV788SyntheticEvidence} from './v788-edge-synthetic-evidence-fixture.mjs';
import {makeV788PilotSnapshot,PILOT_ROOT} from './v788-create-isolated-pilot-snapshot.mjs';
import {DatabaseSync} from 'node:sqlite';

function freePort(){
  return new Promise((resolve,reject)=>{
    const s=net.createServer();s.once('error',reject);
    s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
  });
}
function findBrowser(){
  for(const root of [process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA]){
    if(!root)continue;
    for(const sub of ['Microsoft/Edge/Application/msedge.exe','Google/Chrome/Application/chrome.exe']){
      const exe=path.join(root,...sub.split('/'));
      if(fs.existsSync(exe))return exe;
    }
  }
  return '';
}
function authCookie(secret,role){
  const json={v:431,iat:Date.now(),exp:Date.now()+3600000,channel:'LOCAL',
    user:{id:999,username:'v788-edge',displayName:'V788 Edge Test',
      role,businessScope:'ALL',department:'TEST'}};
  const body=Buffer.from(JSON.stringify(json)).toString('base64url');
  return body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url');
}
async function waitFor(fn,label,ms=30000){
  const end=Date.now()+ms;let error='';
  while(Date.now()<end){
    try{const value=await fn();if(value)return value}
    catch(e){error=String(e?.message||e)}
    await new Promise(r=>setTimeout(r,180));
  }
  throw Error('V788_EDGE_TIMEOUT_'+label+': '+error);
}
async function httpStatus(url,cookieValue){
  const r=await fetch(url,{headers:{Cookie:'ce_qc_local_auth_v431='+cookieValue},
    signal:AbortSignal.timeout(6500)});
  return {status:r.status,body:await r.json().catch(()=>({}))};
}
class CDP{
  constructor(url){this.socket=new WebSocket(url);this.seq=0;this.pending=new Map();this.urls=[]}
  async open(){
    await new Promise((resolve,reject)=>{
      this.socket.addEventListener('open',resolve,{once:true});
      this.socket.addEventListener('error',()=>reject(Error('V788_BROWSER_CDP_OPEN_ERROR')),{once:true});
    });
    this.socket.addEventListener('message',event=>{
      let item;try{item=JSON.parse(String(event.data||''))}catch{return}
      if(item.method==='Network.requestWillBeSent')
        this.urls.push(String(item.params?.request?.url||''));
      if(!item.id)return;
      const job=this.pending.get(item.id);if(!job)return;
      this.pending.delete(item.id);clearTimeout(job.timer);
      if(item.error)job.reject(Error(String(item.error.message||'CDP_ERROR')));
      else job.resolve(item.result||{});
    });
  }
  send(method,params={}){
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('V788_CDP_TIMEOUT_'+method))},9500);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.send(JSON.stringify({id,method,params}))}
      catch(e){clearTimeout(timer);this.pending.delete(id);reject(e)}
    });
  }
  async eval(expression){
    const response=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(response.exceptionDetails)throw Error('V788_JS_RUNTIME_ERROR');
    return response.result?.value;
  }
  close(){try{this.socket.close()}catch{}}
}
function kill(child){
  if(!child?.pid)return;
  try{spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{
    stdio:'ignore',windowsHide:true,timeout:5000})}catch{}
  try{child.kill('SIGKILL')}catch{}
}
if(process.platform!=='win32'){
  console.log('[V788_REAL_EDGE] SKIP on non-Windows; real run belongs to Windows workflow');
  process.exit(0);
}
const browser=findBrowser();
assert.ok(browser,'V788 Edge browser missing; real test MUST NOT show PASS');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v788-edge-'));
const dataDir=path.join(root,'data'),browserDir=path.join(root,'browser'),appLocal=path.join(root,'localapp');
for(const dir of [dataDir,browserDir,appLocal])fs.mkdirSync(dir,{recursive:true});
const [port,debugPort,authPort,exportPort]=await Promise.all([freePort(),freePort(),freePort(),freePort()]);
const base='http://127.0.0.1:'+port,secret='V788_EDGE_TEST_SECRET_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let backend,edge,cdp,log='',lastUi=null,syntheticCreated=false,trialRootCreated=false;
try{
  backend=spawn(process.execPath,['bootstrap.js'],{
    cwd:process.cwd(),stdio:['ignore','pipe','pipe'],windowsHide:true,
    env:{...process.env,DATA_DIR:dataDir,DB_FILE:path.join(dataDir,'candidate_only.db'),
      PORT:String(port),NODE_ENV:'test',LOCALAPPDATA:appLocal,CE_QC_LOCAL_SESSION_SECRET:secret,
      CE_QC_AUTH_SIDECAR_PORT:String(authPort),CE_QC_EXPORT_SIDECAR_PORT:String(exportPort),
      CE_QC_SKIP_STARTUP_POD_REPAIR:'1',CE_QC_BACKGROUND_MAINTENANCE_ENABLED:'0',
      CE_QC_ENABLE_EXPORT_SIDECAR_AT_STARTUP:'0'}
  });
  for(const stream of [backend.stdout,backend.stderr]){
    stream.on('data',x=>{log+=String(x);if(log.length>120000)log=log.slice(-120000)});
  }
  const admin=authCookie(secret,'ADMIN'),viewer=authCookie(secret,'VIEWER');
  await waitFor(async()=>{
    try{return (await httpStatus(base+'/api/health',admin)).status===200}catch{return false}
  },'BACKEND_HEALTH');
  const noAccess=await httpStatus(base+'/api/v788/whpp-evidence/status',viewer);
  const accepted=await httpStatus(base+'/api/v788/whpp-evidence/status',admin);
  assert.equal(noAccess.status,403,'VIEWER must not read admin V788 status');
  assert.equal(accepted.status,200,'ADMIN must read V788 status');
  assert.equal(accepted.body.ok,true);
  assert.equal(accepted.body.readyToPublish,false);
  assert.equal(accepted.body.businessStateUpdated,false);
  assert.equal(accepted.body.isolatedSourceReady,false,
    'temporary Windows runner without D: acceptance copy must prohibit real TMS start');
  console.log('[V788_REAL_EDGE] ADMIN GET 200; VIEWER GET 403; isolated source absent and safely blocked');

  edge=spawn(browser,[
    '--headless=new','--disable-gpu','--disable-extensions','--no-first-run',
    '--no-default-browser-check','--disable-background-networking',
    '--disable-background-timer-throttling','--disable-renderer-backgrounding',
    '--window-size=1600,1000','--remote-debugging-port='+debugPort,
    '--user-data-dir='+browserDir,'about:blank'
  ],{stdio:'ignore',windowsHide:true});
  const target=await waitFor(async()=>{
    try{
      const response=await fetch('http://127.0.0.1:'+debugPort+'/json',{
        signal:AbortSignal.timeout(1800)});
      const list=await response.json();
      return list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||null;
    }catch{return null}
  },'EDGE_TARGET',25000);
  cdp=new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCookie',{name:'ce_qc_local_auth_v431',value:admin,url:base+'/'});
  await cdp.send('Page.navigate',{url:base+'/settings?auth=v788-real-edge'});
  await waitFor(async()=>{
    return await cdp.eval("document.readyState==='complete' && !!document.querySelector('#v625SettingsTabs [data-settings-tab=\"interface\"]')");
  },'REAL_V625_SETTINGS_NAV');
  // Click the real active-shell tab, not the deprecated index.html settings.
  const tabClicked=await cdp.eval("(()=>{const tab=document.querySelector('#v625SettingsTabs [data-settings-tab=\"interface\"]');if(!tab)return false;tab.click();return true})()");
  assert.equal(tabClicked,true,'actual V625 settings interface tab must be clickable');
  const info=await waitFor(async()=>{
    const data=await cdp.eval("(()=>({path:location.pathname,panel:document.getElementById('v788WhppEvidencePanel')?.hidden,button:document.getElementById('v788WhppEvidenceStart')?.disabled,title:document.getElementById('v788WhppEvidenceStart')?.textContent,info:document.getElementById('v788WhppEvidenceText')?.textContent||''}))()");
    lastUi=data;
    return data?.path==='/settings'&&data.panel===false
      &&String(data.info).includes('CE系统接口凭证')?data:false;
  },'ADMIN_SETTINGS_UI',30000);
  assert.equal(info.button,true,'No CE credentials means no TMS start');
  assert.match(String(info.title||''),/核验/);
  assert.equal(cdp.urls.filter(x=>x.includes('/api/v788/whpp-evidence/start')).length,0,
    'Loading settings must not auto-start CE TMS');
  console.log('[V788_REAL_EDGE] PASS real Windows Edge ADMIN /settings; disabled without source; 0 TMS POST');
  // Now simulate EXACT 346 fake members and saved proof on disposable CI D:.
  // The browser MUST render 190/156 + 290 POD + 56 returned from the
  // independent original SQLite + SQLite sidecar, never from JSON alone.
  process.env.NODE_ENV='test';
  createV788SyntheticEvidence();
  syntheticCreated=true;
  const evidence=await httpStatus(base+'/api/v788/whpp-evidence/status',admin);
  assert.equal(evidence.status,200);
  assert.equal(evidence.body.sidecarVerified,true,'real source and sidecar must both validate');
  assert.equal(evidence.body.isolatedSourceReady,true);
  assert.equal(evidence.body.savedMembers,346);
  assert.equal(evidence.body.pod,290);
  assert.equal(evidence.body.returned,56);
  assert.equal(evidence.body.podTimeSourceInventory?.available,true,
    'isolated source/time inventory must be readable only after exact TMS proof');
  assert.equal(evidence.body.podTimeSourceInventory?.podMembers,290);
  assert.equal(evidence.body.podTimeSourceInventory?.signingTimeAccepted,false,
    'time evidence candidates cannot be accepted as formal signing-day evidence');
  assert.equal(evidence.body.statusOnlyPreview.dates[0].pod,166);
  assert.equal(evidence.body.statusOnlyPreview.dates[1].returned,32);
  // The real Edge backend must be able to recover persisted SQLite evidence
  // even if the last-run JSON progress file disappeared or was corrupted.
  // Never query TMS or alter source/sidecar to recover a view-only report.
  const fixtureReport=String.raw`D:\CE_QC_V788_验收副本\V788_WHPP_TMS_逐票证据验收.json`;
  const originalReport=fs.readFileSync(fixtureReport,'utf8');
  fs.unlinkSync(fixtureReport);
  const noReport=await httpStatus(base+'/api/v788/whpp-evidence/status',admin);
  assert.equal(noReport.body.sidecarVerified,true,'valid saved SQLite proof must survive missing JSON report');
  assert.equal(noReport.body.independentlyVerifiedCounts,true);
  assert.equal(noReport.body.savedMembers,346);
  assert.equal(noReport.body.pod,290);
  assert.equal(noReport.body.reportCheck,'REPORT_MISSING_OR_UNSAFE_USING_SQLITE_PROOF');
  fs.writeFileSync(fixtureReport,'{malformed-progress-json');
  const malformedReport=await httpStatus(base+'/api/v788/whpp-evidence/status',admin);
  assert.equal(malformedReport.body.sidecarVerified,true,'malformed JSON cannot conceal verified SQLite evidence');
  assert.equal(malformedReport.body.reportCheck,'REPORT_UNREADABLE_USING_SQLITE_PROOF');
  const staleReport=JSON.parse(originalReport);
  staleReport.sourceSignature='f'.repeat(64);
  fs.writeFileSync(fixtureReport,JSON.stringify(staleReport));
  const stale=await httpStatus(base+'/api/v788/whpp-evidence/status',admin);
  assert.equal(stale.body.sidecarVerified,true,'stale progress signature cannot override exact source + persisted sidecar signature');
  assert.equal(stale.body.reportCheck,'STALE_REPORT_SIGNATURE_USING_SQLITE_PROOF');
  fs.writeFileSync(fixtureReport,originalReport);
  const refreshed=await cdp.eval("(async()=>{const b=document.getElementById('v788WhppEvidenceRefresh');if(!b)return false;b.click();return true})()");
  assert.equal(refreshed,true,'REAL V625 page must have a visible refresh button');
  const verified=await waitFor(async()=>{
    const line=await cdp.eval("document.getElementById('v788WhppEvidenceText')?.textContent||''");
    return String(line).includes('290')&&String(line).includes('56')
      &&String(line).includes('190')&&String(line).includes('156')?line:false;
  },'SYNTHETIC_346_REAL_EDGE_DISPLAY',14000);
  assert.ok(verified.includes('2026-07-01')&&verified.includes('2026-07-02')); 
  assert.match(verified,/独立TMS明确签收时间：0\/290票；仍缺290票/,
    'real Edge cannot claim a signing-time KPI when synthetic TMS status lacks explicit POD timestamps');
  assert.match(verified,/尚未写入正式签收时间账本/,
    'status-only acceptance must not imply production timing has been repaired');
  assert.match(verified,/隔离库签收时间来源诊断/,
    'real Edge must display the 290-member POD timestamp candidate inventory');
  assert.match(verified,/仍无明确时间/,
    'zero saved explicit time evidence is a blocker, not zero signing days');
  assert.match(verified,/历史账本：隔离副本账本只读检查暂不可用/,
    'missing isolated ledger tables must render an explicit no-verdict diagnostic');
  assert.doesNotMatch(verified,/历史账本待同步：POD 0票、已退回 0票/,
    'unreadable ledger must never be advertised as a clean zero-difference reconciliation');
  const buttonNow=await cdp.eval("document.getElementById('v788WhppEvidenceStart')?.disabled");
  assert.equal(buttonNow,true,'completed proof must never allow another real TMS request');
  assert.equal(cdp.urls.filter(x=>x.includes('/api/v788/whpp-evidence/start')).length,0);
  console.log('[V788_REAL_EDGE] PASS synthetic 346 exact source: 190/156, POD 166+124, returned 24+32; real V625 DOM; zero TMS calls');
  // A disposable candidate trial must be able to clone the pre-existing
  // isolated acceptance source *without* opening the formal business DB.
  assert.equal(fs.existsSync(PILOT_ROOT),false,'GitHub CI must not overwrite any trial root');
  fs.mkdirSync(PILOT_ROOT);
  trialRootCreated=true;
  const trialDir=path.win32.join(PILOT_ROOT,'data');
  fs.mkdirSync(trialDir);
  const trialDb=path.win32.join(trialDir,'pilot_copy.db');
  const cloned=await makeV788PilotSnapshot(trialDb);
  assert.equal(cloned.sourceMembers,346);
  assert.equal(cloned.formalDatabaseOpened,false);
  assert.equal(cloned.sourceReadOnly,true);
  const proofCopy=new DatabaseSync(trialDb,{readOnly:true});
  try{
    assert.equal(proofCopy.prepare("SELECT COUNT(DISTINCT shipmentCode) n FROM business_daily_parse_rows WHERE businessType='WHPP'").get().n,346);
  }finally{proofCopy.close()}
  console.log('[V788_REAL_EDGE] PASS candidate trial snapshot: copied exact isolated 346-member SQLite to disposable D pilot sandbox; formal DB untouched');
}catch(error){
  console.error('[V788_REAL_EDGE] FAIL '+String(error?.stack||error));
  console.error('[V788_REAL_EDGE] last settings state='+JSON.stringify(lastUi));
  console.error('[V788_REAL_EDGE] last browser URLs='+JSON.stringify(cdp?.urls.slice(-22)||[]));
  if(cdp)try{
    const state=await cdp.eval("(()=>({href:location.href,title:document.title,ready:document.readyState,body:document.body?.innerText?.slice(0,600),scriptLoaded:typeof loadV788WhppEvidenceStatus,appLoaded:typeof renderAll,loginText:document.body?.innerText?.includes('登录')}))()");
    console.error('[V788_REAL_EDGE] browser diagnosis='+JSON.stringify(state));
  }catch(ex){console.error('[V788_REAL_EDGE] browser diagnosis unavailable '+String(ex?.message||ex))}
  console.error('[V788_REAL_EDGE] backend tail:\n'+log.slice(-4800));
  process.exitCode=1;
}finally{
  cdp?.close();kill(edge);kill(backend);
  if(trialRootCreated)try{
    const testCopy=path.win32.join(PILOT_ROOT,'data','pilot_copy.db');
    for(const f of [testCopy,testCopy+'-wal',testCopy+'-shm'])
      if(fs.existsSync(f))fs.unlinkSync(f);
    fs.rmdirSync(path.win32.join(PILOT_ROOT,'data'));
    fs.rmdirSync(PILOT_ROOT);
  }catch(error){
    console.error('[V788_REAL_EDGE] trial sandbox cleanup failed '+String(error?.message||error));
    process.exitCode=1;
  }
  if(syntheticCreated)try{deleteV788SyntheticEvidence()}catch(error){
    console.error('[V788_REAL_EDGE] CI synthetic cleanup failed '+String(error?.message||error));
    process.exitCode=1;
  }
  try{fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}catch{}
}
