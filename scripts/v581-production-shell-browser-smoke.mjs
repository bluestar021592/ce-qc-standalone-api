import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';

function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function browserExecutable(){
  const candidates=[];
  if(process.platform==='win32'){
    for(const root of [process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA]){
      if(!root)continue;
      candidates.push(path.join(root,'Microsoft','Edge','Application','msedge.exe'),path.join(root,'Google','Chrome','Application','chrome.exe'));
    }
  }else{
    for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
      const hit=spawnSync('which',[name],{encoding:'utf8'});if(hit.status===0&&hit.stdout.trim())candidates.push(hit.stdout.trim());
    }
  }
  return candidates.find(p=>{try{return fs.existsSync(p)}catch{return false}})||'';
}
function stage(name){console.log('[V582_BROWSER_GATE] '+name);}
function withTimeout(promise,ms,label){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out after '+ms+'ms')),ms);});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}
async function fetchJsonBounded(url,ms=1500){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{
    const response=await fetch(url,{signal:controller.signal,cache:'no-store'});
    if(!response.ok)return null;
    return await response.json();
  }finally{clearTimeout(timer);}
}
async function waitForPageTarget(debugPort,expectedPath,timeout=10000){
  return await waitFor(async()=>{
    const list=await fetchJsonBounded('http://127.0.0.1:'+debugPort+'/json',1500);
    if(!Array.isArray(list))return null;
    for(const target of list){
      if(target?.type!=='page'||!target?.webSocketDebuggerUrl)continue;
      try{
        const u=new URL(String(target.url||'about:blank'));
        if(u.pathname===expectedPath)return target;
      }catch{}
    }
    return null;
  },timeout,80,'browser target path '+expectedPath);
}
async function attachTarget(target){
  const next=new CDP(target.webSocketDebuggerUrl);
  await next.open();
  await next.send('Page.enable');
  await next.send('Runtime.enable');
  await next.send('Network.enable');
  return next;
}
async function reattachAfterNavigation(current,debugPort,expectedPath){
  // Windows Edge can take longer to publish the same-page target URL under CI or
  // antivirus load even after the click handler has fired. Keep the real click
  // requirement, but do not turn a slow /json target refresh into a false failure.
  const target=await waitForPageTarget(debugPort,expectedPath,25000);
  stage('browser target observed '+expectedPath);
  try{current?.close();}catch{}
  await new Promise(r=>setTimeout(r,80));
  const next=await attachTarget(target);
  await evalWait(next,'!!window.__CE_QC_V581_STABLE_SHELL__',6000,80,'stable shell after '+expectedPath);
  return next;
}
function killTree(child,label){
  if(!child?.pid)return;
  try{
    if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:5000});
    else child.kill('SIGKILL');
  }catch{}
  try{child.kill('SIGKILL')}catch{}
  stage('cleanup '+label+' pid='+child.pid);
}
class CDP{
  constructor(ws){this.ws=new WebSocket(ws);this.id=0;this.pending=new Map();}
  async open(){
    await withTimeout(new Promise((resolve,reject)=>{
      this.ws.addEventListener('open',resolve,{once:true});
      this.ws.addEventListener('error',()=>reject(new Error('CDP websocket open error')),{once:true});
    }),5000,'CDP websocket open');
    this.ws.addEventListener('message',e=>{
      let d;
      try{d=JSON.parse(String(e.data||'{}'));}catch{return;}
      if(!d.id)return;
      const p=this.pending.get(d.id);if(!p)return;
      this.pending.delete(d.id);clearTimeout(p.timer);
      d.error?p.reject(new Error(d.error.message||JSON.stringify(d.error))):p.resolve(d.result||{});
    });
    this.ws.addEventListener('close',()=>{
      for(const [id,p] of this.pending){clearTimeout(p.timer);p.reject(new Error('CDP websocket closed with request '+id+' pending'));}
      this.pending.clear();
    });
  }
  send(method,params={},timeoutMs=5000){
    const id=++this.id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);
        reject(new Error('CDP '+method+' timed out after '+timeoutMs+'ms'));
      },timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.ws.send(JSON.stringify({id,method,params}));}
      catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async eval(expression,timeoutMs=5000){
    const out=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},timeoutMs);
    if(out.exceptionDetails)throw new Error(out.exceptionDetails.text||'eval failed');
    return out.result&&out.result.value;
  }
  close(){try{this.ws.close()}catch{}}
}
async function evalWait(cdp,condition,timeout=8000,interval=80,label='browser condition'){
  const source=`(async()=>{const end=Date.now()+${Number(timeout)};while(Date.now()<end){try{if((${condition}))return true;}catch{}await new Promise(r=>setTimeout(r,${Number(interval)}));}return false;})()`;
  const ok=await cdp.eval(source,timeout+2500);
  if(!ok)throw new Error('timeout waiting for '+label);
  return true;
}
async function waitFor(fn,timeout=20000,interval=100,label='condition'){
  const end=Date.now()+timeout;
  let lastError=null;
  while(Date.now()<end){
    try{
      const remaining=Math.max(250,end-Date.now());
      const v=await withTimeout(Promise.resolve().then(fn),Math.min(3000,remaining),label+' attempt');
      if(v)return v;
    }catch(error){lastError=error;}
    await new Promise(r=>setTimeout(r,interval));
  }
  throw new Error('timeout waiting for '+label+(lastError?' · last='+lastError.message:''));
}
function signedCookie(secret){
  const payload={v:431,iat:Date.now(),exp:Date.now()+60*60_000,channel:'LOCAL',user:{id:999,username:'v581-smoke',displayName:'V581 Smoke',role:'VIEWER',businessScope:'ALL',department:'TEST'}};
  const body=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
  const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');
  return body+'.'+sig;
}
async function click(cdp,selector){
  const p=await cdp.eval(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;const r=n.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const top=document.elementFromPoint(x,y);return{x,y,top:top?String(top.tagName||'')+'#'+String(top.id||'')+'.'+String(top.className||''):'',href:n.href||'',page:n.dataset?.page||'',pe:getComputedStyle(n).pointerEvents};})()`);
  assert.ok(p&&Number.isFinite(p.x)&&Number.isFinite(p.y),'missing clickable point for '+selector);
  stage('hit '+selector+' => '+p.top+' page='+p.page+' pointer='+p.pe);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y,button:'none'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
}

if(process.platform!=='win32'){
  console.log('[V582_PRODUCTION_BROWSER] skipped outside Windows; the authoritative real-browser gate runs on the Windows updater workflow');
  process.exit(0);
}
const browser=browserExecutable();
if(!browser)throw new Error('V582 production-shell browser smoke requires Edge/Chrome on Windows');

const port=await freePort();
const debugPort=await freePort();
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v581-production-'));
const dataDir=path.join(root,'data');
const localApp=path.join(root,'localapp');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(localApp,{recursive:true});
const secret='V581_TEST_SECRET_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const child=spawn(process.execPath,['bootstrap.js'],{
  cwd:process.cwd(),
  env:{...process.env,PORT:String(port),NODE_ENV:'test',DATA_DIR:dataDir,LOCALAPPDATA:localApp,CE_QC_LOCAL_SESSION_SECRET:secret,PUBLIC_HOSTNAME:'',CE_QC_AUTH_SIDECAR_PORT:String(await freePort()),CE_QC_EXPORT_SIDECAR_PORT:String(await freePort()),CE_QC_SKIP_STARTUP_POD_REPAIR:'1',CE_QC_BACKGROUND_MAINTENANCE_ENABLED:'0'},
  stdio:['ignore','pipe','pipe'],
  windowsHide:true
});
let backendLog='';
child.stdout.on('data',d=>{backendLog+=String(d);if(backendLog.length>180000)backendLog=backendLog.slice(-180000);});
child.stderr.on('data',d=>{backendLog+=String(d);if(backendLog.length>180000)backendLog=backendLog.slice(-180000);});

const userData=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v581-edge-'));
const edge=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--remote-debugging-port='+debugPort,'--user-data-dir='+userData,'about:blank'],{stdio:'ignore',windowsHide:true});
let cdp;
try{
  stage('waiting for production backend health');
  await waitFor(async()=>{
    try{
      const req=http.request({host:'127.0.0.1',port,path:'/api/health',headers:{Cookie:'ce_qc_local_auth_v431='+signedCookie(secret)}},res=>{res.resume();});
      const result=await new Promise(resolve=>{req.on('response',res=>resolve(res.statusCode));req.on('error',()=>resolve(0));req.setTimeout(800,()=>{req.destroy();resolve(0)});req.end();});
      return result===200;
    }catch{return false;}
  },30000,150,'production backend health');
  stage('production backend health ready');

  stage('waiting for Chromium remote-debug target');
  const target=await waitFor(async()=>{
    const list=await fetchJsonBounded('http://127.0.0.1:'+debugPort+'/json',1500);
    return Array.isArray(list)?list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||null:null;
  },15000,100,'Chromium remote-debug target');
  stage('attaching CDP');
  cdp=await attachTarget(target);
  await cdp.send('Network.setCookie',{name:'ce_qc_local_auth_v431',value:signedCookie(secret),url:'http://127.0.0.1:'+port+'/'});
  stage('navigating production shell');
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/?auth=v581'},8000);
  await evalWait(cdp,'!!window.__CE_QC_V581_STABLE_SHELL__',8000,80,'V581 owner after production navigation');
  stage('V581 owner loaded');
  await evalWait(cdp,"(()=>{const t=document.querySelector('.topbar'),m=document.querySelector('.main-content'),h=document.getElementById('homePage');if(!t||!m||!h)return false;const ts=getComputedStyle(t),ms=getComputedStyle(m),r=h.getBoundingClientRect();return ts.display!=='none'&&ts.visibility!=='hidden'&&ms.display!=='none'&&!h.hidden&&r.width>200&&r.height>80;})()",10000,100,'visible HOME shell');
  stage('HOME shell visible');
  // Static regressions already lock all 15 native sidebar anchors. Do not keep an
  // in-page async timer loop alive here while app bootstrap is still settling; on
  // Windows Edge that can be throttled independently of real input dispatch and
  // produce a false Runtime.evaluate timeout before the click test even begins.
  const first=await cdp.eval("(()=>({auth:new URLSearchParams(location.search).get('auth'),title:document.getElementById('pageTitle')?.textContent||'',homeText:String(document.getElementById('homePage')?.textContent||'').trim().slice(0,120),ce:!!document.querySelector('.side-nav .side-link[data-page=\\\"ce\\\"]'),imp:!!document.querySelector('.side-nav .side-link[data-page=\\\"import\\\"]')}))()",3000);
  assert.equal(first.auth,'v581');
  assert.equal(first.title,'首页总看板');
  assert.equal(first.ce,true,'CE native sidebar route must exist in the live DOM');
  assert.equal(first.imp,true,'import native sidebar route must exist in the live DOM');
  assert.ok(first.homeText.length>10,'HOME must not be a blank rectangle');

  stage('forcing blank shell and testing deterministic recovery');
  const blankRecovery=await cdp.eval("(()=>{const a=document.querySelector('.app-body'),t=document.querySelector('.topbar'),m=document.querySelector('.main-content'),h=document.getElementById('homePage');a.style.setProperty('display','none','important');t.style.setProperty('display','none','important');m.style.setProperty('display','none','important');h.hidden=true;h.style.setProperty('display','none','important');window.__CE_QC_V581_STABLE_SHELL__.enforce('production-browser-forced-blank');const as=getComputedStyle(a),ts=getComputedStyle(t),ms=getComputedStyle(m),hs=getComputedStyle(h);return{ok:as.display!=='none'&&ts.display!=='none'&&ms.display!=='none'&&!h.hidden&&hs.display!=='none',appBody:as.display,topbar:ts.display,main:ms.display,home:hs.display,hidden:h.hidden};})()",3500);
  assert.equal(blankRecovery?.ok,true,'forced blank shell must recover synchronously in the stable owner: '+JSON.stringify(blankRecovery));
  stage('forced blank shell recovered');

  stage('installing transparent sidebar blocker to prove coordinate hard navigation');
  await cdp.eval("(()=>{document.getElementById('v582SidebarBlocker')?.remove();const b=document.createElement('div');b.id='v582SidebarBlocker';Object.assign(b.style,{position:'fixed',left:'0',top:'0',width:'228px',height:'100vh',zIndex:'2147483647',background:'rgba(255,0,0,0.001)',pointerEvents:'auto'});document.body.appendChild(b);return true;})()",2000);
  stage('clicking CE link through transparent blocker');
  await click(cdp,'.side-nav .side-link[data-page="ce"]');
  await evalWait(cdp,"(()=>{const p=document.getElementById('ccslPage'),t=document.getElementById('pageTitle');return location.pathname==='/ce'&&p&&!p.hidden&&getComputedStyle(p).display!=='none'&&t?.textContent==='CE看板';})()",8000,100,'CE direct visible route');
  stage('CE direct route passed');

  stage('reinstalling transparent sidebar blocker before import click');
  await cdp.eval("(()=>{document.getElementById('v582SidebarBlocker')?.remove();const b=document.createElement('div');b.id='v582SidebarBlocker';Object.assign(b.style,{position:'fixed',left:'0',top:'0',width:'228px',height:'100vh',zIndex:'2147483647',background:'rgba(0,0,255,0.001)',pointerEvents:'auto'});document.body.appendChild(b);return true;})()",2000);
  stage('clicking import link through transparent blocker');
  await click(cdp,'.side-nav .side-link[data-page="import"]');
  await evalWait(cdp,"(()=>{const p=document.getElementById('importPage'),t=document.getElementById('pageTitle');return location.pathname==='/import'&&p&&!p.hidden&&getComputedStyle(p).display!=='none'&&t?.textContent==='数据导入';})()",8000,100,'import direct visible route');
  stage('import direct route passed');

  stage('verifying final production HTML owner ordering');
  const delivered=await withTimeout(new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/?auth=v581',headers:{Cookie:'ce_qc_local_auth_v431='+signedCookie(secret)}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));});
    req.on('error',reject);
    req.setTimeout(5000,()=>req.destroy(new Error('production HTML request timeout')));
    req.end();
  }),7000,'production HTML verification request');
  assert.doesNotMatch(delivered,/installV575CoordinateOwner/,'production HTML must retire the V575 capture owner');
  assert.doesNotMatch(delivered,/v580-visible-shell-recovery\.js/,'production HTML must retire V580 layered recovery');
  const scripts=[...delivered.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi)].map(m=>m[1]);
  const stableIndex=scripts.findIndex(src=>/v581-stable-shell-owner\.js/.test(src));
  const appIndex=scripts.findIndex(src=>/\/app\.js/.test(src));
  assert.ok(stableIndex>=0&&appIndex>stableIndex,'V582 stable shell must be delivered before app.js');

  console.log('[V582_PRODUCTION_BROWSER] full production server + auth cookie + real Edge passed · early shell owner loads before app bootstrap · HOME self-heals · stale sidebar hit layers cannot block CE/import direct routing');
} catch(error){
  console.error('[V581_PRODUCTION_BROWSER] backend tail\n'+backendLog.slice(-12000));
  throw error;
} finally{
  try{cdp&&cdp.close();}catch{}
  killTree(edge,'browser');
  killTree(child,'backend');
  await new Promise(r=>setTimeout(r,250));
  try{fs.rmSync(userData,{recursive:true,force:true,maxRetries:10,retryDelay:50})}catch{}
  try{fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50})}catch{}
}
