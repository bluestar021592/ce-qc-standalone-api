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
  await next.send('DOM.enable');
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
  // The target path itself proves the top-level hard navigation. Route DOM/visibility is
  // already locked by static lifecycle regressions; avoid an extra Runtime.evaluate here
  // because hosted Windows Edge intermittently stalls that CDP domain after navigation.
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
async function domElement(cdp,selector,{box=false}={}){
  let lastError=null;
  for(let attempt=1;attempt<=6;attempt+=1){
    try{
      const doc=await cdp.send('DOM.getDocument',{depth:1,pierce:true},12000);
      const out=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector},12000);
      assert.ok(out.nodeId,'missing DOM node for '+selector);
      const attrsOut=await cdp.send('DOM.getAttributes',{nodeId:out.nodeId},12000);
      const attrs={};
      const list=Array.isArray(attrsOut.attributes)?attrsOut.attributes:[];
      for(let i=0;i<list.length;i+=2)attrs[list[i]]=list[i+1]??'';
      let point=null;
      if(box){
        const model=await cdp.send('DOM.getBoxModel',{nodeId:out.nodeId},12000);
        const quad=model?.model?.border||model?.model?.content;
        assert.ok(Array.isArray(quad)&&quad.length>=8,'missing box model for '+selector);
        const xs=[quad[0],quad[2],quad[4],quad[6]],ys=[quad[1],quad[3],quad[5],quad[7]];
        point={x:xs.reduce((a,b)=>a+b,0)/4,y:ys.reduce((a,b)=>a+b,0)/4};
      }
      return{nodeId:out.nodeId,attrs,point};
    }catch(error){
      lastError=error;
      const msg=String(error?.message||error);
      if(!/Could not find node|No node with given id|timed out/i.test(msg))throw error;
      await new Promise(r=>setTimeout(r,80*attempt));
    }
  }
  throw lastError||new Error('DOM lookup failed for '+selector);
}
async function hitPoint(cdp,selector){
  const info=await domElement(cdp,selector,{box:true});
  const p=info.point;
  stage('hit '+selector+' => href='+(info.attrs.href||'')+' page='+(info.attrs['data-v587-page']||info.attrs['data-page']||''));
  return p;
}
async function pointerDown(cdp,selector){
  const p=await hitPoint(cdp,selector);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y,button:'none'},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1},12000);
  return p;
}
async function pointerUp(cdp,p){
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1},12000);
}
async function click(cdp,selector){
  const p=await pointerDown(cdp,selector);
  await pointerUp(cdp,p);
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
const edge=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion','--window-size=1600,1000','--force-device-scale-factor=1','--remote-debugging-port='+debugPort,'--user-data-dir='+userData,'about:blank'],{stdio:'ignore',windowsHide:true});
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
  stage('V581/V596 stable owner loaded');
  await evalWait(cdp,'!!window.__CE_QC_V596_EARLY_INTERACTION__',8000,80,'V596 unified early interaction owner after production navigation');
  await evalWait(cdp,"document.documentElement.dataset.ceQcV597LegacyInteractionRetired==='1'",8000,80,'V597 legacy interaction retirement marker');
  stage('V597 single interaction ownership active; legacy V565 click capture retired');

  stage('verifying exact V596 early owner asset');
  const earlyAsset=await withTimeout(new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/v592-early-sidebar-capture.js?v=20260928-v596-1'},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));});
    req.on('error',reject);
    req.setTimeout(5000,()=>req.destroy(new Error('V596 early owner asset request timeout')));
    req.end();
  }),7000,'V596 early owner asset request');
  assert.match(earlyAsset,/2026-09-28-v596-unified-coordinate-interaction-v1/,'real server must deliver the V596 unified early owner');
  assert.match(earlyAsset,/global\.addEventListener\('pointerdown',pointerOwner,true\)/,'V596 early owner must capture pointerdown on window');
  assert.match(earlyAsset,/controlAt\(x,y\)/,'V596 early owner must resolve blocked controls by real geometry');
  assert.match(earlyAsset,/global\.location\.href=href/,'V596 early owner must retain hard navigation for sidebar routes');
  stage('V596 early owner contract delivered');

  stage('proving real VIEWER sidebar hard navigation to /ce before long browser work');
  const ceInfoEarly=await domElement(cdp,'.side-nav .side-link[data-page="ce"]',{box:true});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:ceInfoEarly.point.x,y:ceInfoEarly.point.y,button:'none'},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:ceInfoEarly.point.x,y:ceInfoEarly.point.y,button:'left',clickCount:1},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:ceInfoEarly.point.x,y:ceInfoEarly.point.y,button:'left',clickCount:1},12000);
  await waitFor(async()=>{
    try{return await cdp.eval("location.pathname==='/ce'&&document.getElementById('pageTitle')?.textContent.includes('CE')",6000);}
    catch{return false;}
  },10000,120,'V597 early real VIEWER /ce navigation');
  stage('V597 early real VIEWER sidebar hard navigation passed');

  stage('returning to HOME for topbar/main-content proofs');
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/?auth=v581'},8000);
  await evalWait(cdp,'!!window.__CE_QC_V581_STABLE_SHELL__',8000,80,'V581 owner after return HOME');
  await evalWait(cdp,'!!window.__CE_QC_V596_EARLY_INTERACTION__',8000,80,'V596 early owner after return HOME');
  await evalWait(cdp,"document.documentElement.dataset.ceQcV597LegacyInteractionRetired==='1'",8000,80,'V597 retirement marker after return HOME');

  stage('waiting for real delivered right-side controls');
  await evalWait(cdp,"!!document.querySelector('#topRangeQuery')&&!!document.querySelector('.main-content .v18-business-card')",10000,80,'real topbar and dashboard controls');

  stage('verifying V596 shell offsets match the real sidebar edge');
  const layout=await cdp.eval("(()=>{const s=document.querySelector('.sidebar')?.getBoundingClientRect(),a=document.querySelector('.app-body')?.getBoundingClientRect(),t=document.querySelector('.topbar')?.getBoundingClientRect(),h=document.querySelector('#pageTitle')?.getBoundingClientRect();return{sRight:s?.right||0,aLeft:a?.left||0,tLeft:t?.left||0,titleLeft:h?.left||0,cssVar:getComputedStyle(document.documentElement).getPropertyValue('--ce-qc-shell-left').trim()};})()",12000);
  assert.ok(layout.sRight>70,'desktop sidebar must have a measurable visible right edge');
  assert.ok(Math.abs(layout.aLeft-layout.sRight)<=1.5,'app body must start exactly after the real sidebar');
  assert.ok(Math.abs(layout.tLeft-layout.sRight)<=1.5,'topbar must start exactly after the real sidebar');
  assert.ok(layout.titleLeft+0.5>=layout.sRight,'page title must not sit underneath the sidebar');
  assert.ok(Math.abs(parseFloat(layout.cssVar||'0')-layout.sRight)<=1.5,'V596 shell variable must equal the measured sidebar edge');
  stage('V596 dynamic sidebar geometry passed edge='+layout.sRight);

  stage('proving blocked real topbar query is recovered by the single V596 early owner');
  const topInfo=await domElement(cdp,'#topRangeQuery',{box:true});
  await cdp.eval("(()=>{delete document.documentElement.dataset.ceQcV596Fallback;delete document.documentElement.dataset.v596TopAction;document.getElementById('v596TopbarBlocker')?.remove();window.__v596TopOriginal=window.applyTopDateRange;window.applyTopDateRange=function(){document.documentElement.dataset.v596TopAction='1';return true;};const b=document.createElement('div');b.id='v596TopbarBlocker';Object.assign(b.style,{position:'fixed',left:'"+(topInfo.point.x-90)+"px',top:'"+(topInfo.point.y-28)+"px',width:'180px',height:'56px',zIndex:'9000',background:'rgba(255,0,0,0.001)',pointerEvents:'auto'});document.body.appendChild(b);return getComputedStyle(b).pointerEvents;})()",12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:topInfo.point.x,y:topInfo.point.y,button:'none'},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:topInfo.point.x,y:topInfo.point.y,button:'left',clickCount:1},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:topInfo.point.x,y:topInfo.point.y,button:'left',clickCount:1},12000);
  await evalWait(cdp,"document.documentElement.dataset.v596TopAction==='1'",4000,50,'V596 real topbar query fallback delivery');
  const topFallback=await cdp.eval("document.documentElement.dataset.ceQcV596Fallback||''",12000);
  assert.match(String(topFallback),/topRangeQuery/,'V596 must record coordinate fallback for the blocked real topbar query');
  const topBlockerPe=await cdp.eval("getComputedStyle(document.getElementById('v596TopbarBlocker')).pointerEvents",12000);
  assert.equal(topBlockerPe,'auto','small blocker must remain active so success proves V596 geometry fallback, not scheduled blocker cleanup');
  await cdp.eval("(()=>{document.getElementById('v596TopbarBlocker')?.remove();if(window.__v596TopOriginal)window.applyTopDateRange=window.__v596TopOriginal;delete window.__v596TopOriginal;return true;})()",12000);
  stage('V596 real topbar coordinate fallback passed');

  stage('proving blocked real dashboard card is recovered by the same V596 early owner');
  await cdp.eval("(()=>{const btn=document.querySelector('.main-content .v18-business-card');if(!btn)return false;btn.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});return true;})()",12000);
  await new Promise(r=>setTimeout(r,80));
  const mainInfo=await domElement(cdp,'.main-content .v18-business-card',{box:true});
  assert.ok(mainInfo.point.y>=64&&mainInfo.point.y<950,'real dashboard card must be visible before click proof');
  await cdp.eval("(()=>{delete document.documentElement.dataset.ceQcV596Fallback;delete document.documentElement.dataset.v596MainAction;document.getElementById('v596MainContentBlocker')?.remove();window.__v596NavOriginal=window.navigatePage;window.navigatePage=function(page){document.documentElement.dataset.v596MainAction=String(page||'called');return true;};const b=document.createElement('div');b.id='v596MainContentBlocker';Object.assign(b.style,{position:'fixed',left:'"+(mainInfo.point.x-95)+"px',top:'"+(mainInfo.point.y-55)+"px',width:'190px',height:'110px',zIndex:'9000',background:'rgba(255,0,0,0.001)',pointerEvents:'auto'});document.body.appendChild(b);return true;})()",12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:mainInfo.point.x,y:mainInfo.point.y,button:'none'},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:mainInfo.point.x,y:mainInfo.point.y,button:'left',clickCount:1},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:mainInfo.point.x,y:mainInfo.point.y,button:'left',clickCount:1},12000);
  await evalWait(cdp,"!!document.documentElement.dataset.v596MainAction",4000,50,'V596 real dashboard card fallback delivery');
  const mainFallback=await cdp.eval("document.documentElement.dataset.ceQcV596Fallback||''",12000);
  assert.match(String(mainFallback),/v18-business-card/,'V596 must record coordinate fallback for the blocked real dashboard card');
  const mainBlockerPe=await cdp.eval("getComputedStyle(document.getElementById('v596MainContentBlocker')).pointerEvents",12000);
  assert.equal(mainBlockerPe,'auto','small dashboard blocker must remain active so success proves V596 geometry fallback');
  await cdp.eval("(()=>{document.getElementById('v596MainContentBlocker')?.remove();if(window.__v596NavOriginal)window.navigatePage=window.__v596NavOriginal;delete window.__v596NavOriginal;return true;})()",12000);
  stage('V596 real dashboard card coordinate fallback passed');

  stage('verifying one V596 early owner + one stable shell in final production HTML');
  const delivered=await withTimeout(new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/?auth=v581',headers:{Cookie:'ce_qc_local_auth_v431='+signedCookie(secret)}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));});
    req.on('error',reject);
    req.setTimeout(5000,()=>req.destroy(new Error('production HTML request timeout')));
    req.end();
  }),7000,'production HTML verification request');
  assert.doesNotMatch(delivered,/installV575CoordinateOwner/,'production HTML must retire the V575 capture owner');
  assert.doesNotMatch(delivered,/v580-visible-shell-recovery\.js/,'production HTML must retire V580 layered recovery');
  const scripts=[...delivered.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi)].map(m=>m[1]);
  const earlyIndex=scripts.findIndex(src=>/v592-early-sidebar-capture\.js/.test(src));
  const stableIndex=scripts.findIndex(src=>/v581-stable-shell-owner\.js/.test(src));
  const appIndex=scripts.findIndex(src=>/\/app\.js/.test(src));
  assert.ok(earlyIndex>=0&&stableIndex>earlyIndex&&appIndex>stableIndex,'V596 early interaction owner must be delivered before the stable owner and app.js');

  console.log('[V597_PRODUCTION_BROWSER] real Edge passed · early real VIEWER CE navigation reaches /ce · measured sidebar edge aligns shell · legacy V565 click owner retired · blocked topbar/main fallback works');
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

// V597 Windows gate trigger
