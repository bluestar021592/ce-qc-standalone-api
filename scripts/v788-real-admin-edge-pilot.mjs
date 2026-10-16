// Windows Edge integration for V788 settings. Disposable local DB only.
// Never queries CE TMS, never touches D: and never clicks the start button.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';

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
let backend,edge,cdp,log='',lastUi=null;
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
  console.log('[V788_REAL_EDGE] PASS real Windows Edge ADMIN /settings; visible panel; disabled TMS; zero POST');
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
  try{fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})}catch{}
}
