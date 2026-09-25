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
  const p=await cdp.eval(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  assert.ok(p&&Number.isFinite(p.x)&&Number.isFinite(p.y),'missing clickable point for '+selector);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y,button:'none'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
}

const browser=browserExecutable();
if(!browser){
  if(process.platform==='win32')throw new Error('V581 production-shell browser smoke requires Edge/Chrome on Windows');
  console.log('[V581_PRODUCTION_BROWSER] skipped outside Windows without Chromium');
  process.exit(0);
}

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
  cdp=new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCookie',{name:'ce_qc_local_auth_v431',value:signedCookie(secret),url:'http://127.0.0.1:'+port+'/'});
  stage('navigating production shell');
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/?auth=v581'},8000);
  await waitFor(()=>cdp.eval("document.readyState==='complete'&&!!window.__CE_QC_V581_STABLE_SHELL__",2500),15000,100,'V581 owner after production navigation');
  stage('V581 owner loaded');
  await waitFor(()=>cdp.eval("(()=>{const t=document.querySelector('.topbar'),m=document.querySelector('.main-content'),h=document.getElementById('homePage');if(!t||!m||!h)return false;const ts=getComputedStyle(t),ms=getComputedStyle(m),r=h.getBoundingClientRect();return ts.display!=='none'&&ts.visibility!=='hidden'&&ms.display!=='none'&&!h.hidden&&r.width>200&&r.height>80;})()",2500),10000,100,'visible HOME shell');
  stage('HOME shell visible');
  const first=await cdp.eval("(()=>({auth:new URLSearchParams(location.search).get('auth'),title:document.getElementById('pageTitle')?.textContent||'',links:[...document.querySelectorAll('.side-nav .side-link')].map(n=>({tag:n.tagName,href:n.getAttribute('href'),page:n.dataset.page})),homeText:String(document.getElementById('homePage')?.textContent||'').trim().slice(0,120)}))()");
  assert.equal(first.auth,'v581');
  assert.equal(first.title,'首页总看板');
  assert.ok(first.links.length>=14,'full production sidebar should exist');
  assert.ok(first.links.every(x=>x.tag==='A'&&x.href),'every sidebar route must be a native anchor');
  assert.ok(first.homeText.length>10,'HOME must not be a blank rectangle');

  stage('forcing blank shell and testing deterministic recovery');
  await cdp.eval("(()=>{const a=document.querySelector('.app-body'),t=document.querySelector('.topbar'),m=document.querySelector('.main-content'),h=document.getElementById('homePage');a.style.setProperty('display','none','important');t.style.setProperty('display','none','important');m.style.setProperty('display','none','important');h.hidden=true;h.style.setProperty('display','none','important');window.__CE_QC_V581_STABLE_SHELL__.enforce('production-browser-forced-blank');return true;})()",3000);
  await waitFor(()=>cdp.eval("(()=>{const a=getComputedStyle(document.querySelector('.app-body')),t=getComputedStyle(document.querySelector('.topbar')),m=getComputedStyle(document.querySelector('.main-content')),h=document.getElementById('homePage');return a.display!=='none'&&t.display!=='none'&&m.display!=='none'&&!h.hidden&&getComputedStyle(h).display!=='none';})()",2000),4000,80,'forced blank-shell recovery');
  stage('forced blank shell recovered');

  stage('clicking native CE link');
  await click(cdp,'.side-nav a[data-page="ce"]');
  await waitFor(()=>cdp.eval("location.pathname==='/ce'&&!!window.__CE_QC_V581_STABLE_SHELL__&&document.readyState==='complete'",2500),12000,100,'CE hard navigation');
  await waitFor(()=>cdp.eval("(()=>{const p=document.getElementById('ccslPage'),t=document.getElementById('pageTitle');return p&&!p.hidden&&getComputedStyle(p).display!=='none'&&t?.textContent==='CE看板';})()",2500),8000,100,'CE visible route');
  stage('CE hard navigation passed');

  stage('clicking native import link');
  await click(cdp,'.side-nav a[data-page="import"]');
  await waitFor(()=>cdp.eval("location.pathname==='/import'&&!!window.__CE_QC_V581_STABLE_SHELL__&&document.readyState==='complete'",2500),12000,100,'import hard navigation');
  await waitFor(()=>cdp.eval("(()=>{const p=document.getElementById('importPage'),t=document.getElementById('pageTitle');return p&&!p.hidden&&getComputedStyle(p).display!=='none'&&t?.textContent==='数据导入';})()",2500),8000,100,'import visible route');
  stage('import hard navigation passed');

  stage('verifying final production HTML owner ordering');
  const delivered=await withTimeout(new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/?auth=v581',headers:{Cookie:'ce_qc_local_auth_v431='+signedCookie(secret)}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));});
    req.on('error',reject);
    req.setTimeout(5000,()=>req.destroy(new Error('production HTML request timeout')));
    req.end();
  }),7000,'production HTML verification request');
  assert.doesNotMatch(delivered,/installV575CoordinateOwner/,'production HTML must retire the V575 capture owner');
  assert.doesNotMatch(delivered,/v580-visible-shell-recovery\.js/,'production HTML must retire V580 layered recovery');
  const lastScript=[...delivered.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi)].at(-1)?.[1]||'';
  assert.match(lastScript,/v581-stable-shell-owner\.js/,'V581 must be the final delivered browser owner');

  console.log('[V581_PRODUCTION_BROWSER] full production server + auth cookie + real Edge/Chromium passed · HOME visible/nonblank · forced blank shell self-heals · sidebar uses native anchors · hard CE/import navigation reloads correct pages · V581 is delivered last');
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
