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
  // A normal same-tab hard navigation keeps the existing page target. Prefer proving
  // the new pathname on the already attached session; hosted Windows can lag or omit
  // the /json target URL refresh even though the real navigation has completed.
  try{
    await waitFor(async()=>{
      try{return await current.eval("location.pathname",1800)===expectedPath;}catch{return false;}
    },9000,120,'existing browser target path '+expectedPath);
    stage('existing browser target observed '+expectedPath);
    return current;
  }catch{}
  // Only reattach when the existing CDP session genuinely stopped following the tab.
  const target=await waitForPageTarget(debugPort,expectedPath,25000);
  stage('published browser target observed '+expectedPath);
  let next=null;
  try{next=await attachTarget(target);}
  catch(error){throw error;}
  try{current?.close();}catch{}
  await new Promise(r=>setTimeout(r,80));
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
  await evalWait(cdp,"document.documentElement.dataset.ceQcV609MainHitScanRetired==='1'",8000,80,'V609 main-content hit scan retirement marker');
  const timerAlive=await cdp.eval("new Promise(resolve=>setTimeout(()=>resolve('timer-ok'),750))",5000);
  assert.equal(timerAlive,'timer-ok','V609 production page main thread must remain timer-responsive after startup');
  await evalWait(cdp,'!!window.__CE_QC_V596_EARLY_INTERACTION__',8000,80,'V600 native interaction bootstrap after production navigation');
  await evalWait(cdp,"document.documentElement.dataset.ceQcV597LegacyInteractionRetired==='1'",8000,80,'V597 legacy interaction retirement marker');
  stage('V600 native interaction active; legacy capture owners retired');
  const retiredOwners=await cdp.eval("({v569:!!window.__CE_QC_V569_FINAL_INTERACTION_OWNER__,v570:!!window.__CE_QC_V570_EARLY_INTERACTION_OWNER__,v573:!!window.__CE_QC_V573_HEAD_INTERACTION_BRIDGE__,v580:!!window.__CE_QC_V580_VISIBLE_SHELL_RECOVERY__})",5000);
  assert.deepEqual(retiredOwners,{v569:false,v570:false,v573:false,v580:false},'retired interaction owners must not exist at runtime');
  stage('V602 retired interaction globals absent at runtime');

  stage('verifying exact V600 native interaction asset');
  const earlyAsset=await withTimeout(new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/v592-early-sidebar-capture.js?v=20260929-v600-1'},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));});
    req.on('error',reject);
    req.setTimeout(5000,()=>req.destroy(new Error('V600 native interaction asset request timeout')));
    req.end();
  }),7000,'V600 native interaction asset request');
  assert.match(earlyAsset,/2026-09-29-v603-real-edge-geometry-rescue-v1/,'real server must deliver the V603 real-Edge interaction rescue');
  assert.doesNotMatch(earlyAsset,/2026-09-29-v600-native-browser-interaction-v1/,'real server must not deliver the superseded V600 interaction bootstrap');
  assert.doesNotMatch(earlyAsset,/global\.addEventListener\('pointerdown',pointerOwner,true\)/,'V600 must not capture pointerdown globally');
  assert.doesNotMatch(earlyAsset,/global\.addEventListener\('click',clickOwner,true\)/,'V600 must not capture click globally');
  assert.match(earlyAsset,/ceQcV600NativeInteraction/,'V600 native interaction marker must be published');
  stage('V600 native interaction contract delivered');

  stage('waiting for real functional controls before V601 interaction proof');
  await evalWait(cdp,"!!document.querySelector('.main-content .v18-business-card[href^=\\\"/ce?\\\"]') && !!document.querySelector('.top-user') && !!document.getElementById('accountDropdown')",12000,80,'real functional HOME controls');
  const proof=await cdp.eval("(()=>{window.__CE_QC_V581_STABLE_SHELL__?.enforce?.('v601-functional-settle');const main=document.querySelector('.main-content .v18-business-card[href^=\\\"/ce?\\\"]'),top=document.querySelector('.top-user'),sidebar=document.querySelector('.sidebar'),app=document.querySelector('.app-body'),bar=document.querySelector('.topbar'),title=document.querySelector('#pageTitle');if(!main||!top||!sidebar||!app||!bar||!title)return null;main.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const box=n=>{const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return{top:box(top),main:box(main),sidebar:box(sidebar),app:box(app),bar:box(bar),title:box(title),cssVar:getComputedStyle(document.documentElement).getPropertyValue('--ce-qc-shell-left').trim(),vw:innerWidth};})()",12000);
  assert.ok(proof&&proof.sidebar.right>70,'V601 functional interaction proof must resolve real delivered controls');
  assert.ok(Math.abs(proof.app.left-proof.sidebar.right)<=1.5,'app body must start exactly after the real sidebar');
  assert.ok(Math.abs(proof.bar.left-proof.sidebar.right)<=1.5,'topbar must start exactly after the real sidebar');
  assert.ok(proof.title.left+0.5>=proof.sidebar.right,'page title must not sit underneath the sidebar');
  assert.ok(Math.abs(parseFloat(proof.cssVar||'0')-proof.sidebar.right)<=1.5,'V601 shell variable must equal the measured sidebar edge');
  assert.ok(proof.main.y>=64&&proof.main.y<950,'real CE dashboard card must be visible before functional click');
  stage('V601 functional geometry passed edge='+proof.sidebar.right+' vw='+proof.vw);

  stage('proving top user control actually opens its menu after a physical click');
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:proof.top.x,y:proof.top.y,button:'none'},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:proof.top.x,y:proof.top.y,button:'left',clickCount:1},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:proof.top.x,y:proof.top.y,button:'left',clickCount:1},12000);
  await evalWait(cdp,"document.getElementById('accountDropdown')?.hidden===false",4000,50,'top user menu functional result');
  stage('V601 top user menu functional click passed');

  stage('proving V603 survives a stale invisible hit surface present only in persistent Edge sessions');
  await cdp.eval("(()=>{const menu=document.getElementById('accountDropdown');if(menu)menu.hidden=true;const old=document.getElementById('v603-real-edge-stale-hit-fixture');old?.remove();const a=document.querySelector('.main-content .v18-business-card[href^=\\\"/ce?\\\"]');if(!a)return false;a.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=a.getBoundingClientRect();const blocker=document.createElement('div');blocker.id='v603-real-edge-stale-hit-fixture';Object.assign(blocker.style,{position:'fixed',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',zIndex:'2147483646',background:'transparent',pointerEvents:'auto'});document.body.appendChild(blocker);return true;})()",5000);
  const blockerProof=await cdp.eval("(()=>{const b=document.getElementById('v603-real-edge-stale-hit-fixture');if(!b)return null;const r=b.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;return{id:document.elementFromPoint(x,y)?.id||'',x,y,width:r.width,height:r.height};})()",5000);
  assert.equal(blockerProof?.id,'v603-real-edge-stale-hit-fixture','V603 fixture must really cover the CE card');
  assert.ok(blockerProof?.width>0&&blockerProof?.height>0,'V603 fixture must retain non-zero CE card geometry');
  stage('proving CE home card actually navigates after a physical click');
  await cdp.eval("(()=>{window.__V602_CLICK_TRACE__={before:location.href,defaultPrevented:null,target:null};const a=document.querySelector('.main-content .v18-business-card[href^=\\\"/ce?\\\"]');a?.addEventListener('click',e=>{queueMicrotask(()=>{window.__V602_CLICK_TRACE__.defaultPrevented=e.defaultPrevented;window.__V602_CLICK_TRACE__.target=e.target?.tagName||'';});},{once:true});return true;})()",5000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:blockerProof.x,y:blockerProof.y,button:'none'},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:blockerProof.x,y:blockerProof.y,button:'left',clickCount:1},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:blockerProof.x,y:blockerProof.y,button:'left',clickCount:1},12000);
  try{
    const trace=await cdp.eval("window.__V602_CLICK_TRACE__",1800);
    stage('V602 CE click trace before='+String(trace?.before||'')+' prevented='+String(trace?.defaultPrevented)+' target='+String(trace?.target||''));
  }catch{}
  cdp=await reattachAfterNavigation(cdp,debugPort,'/ce');
  await evalWait(cdp,"location.pathname==='/ce' && document.getElementById('pageTitle')?.textContent?.includes('CE')",8000,80,'CE card functional navigation');
  stage('V601 CE card functional navigation passed after navigation reattach');

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
  assert.ok(earlyIndex>=0&&stableIndex>earlyIndex&&appIndex>stableIndex,'V600 native interaction bootstrap must be delivered before the stable shell and app.js');

  console.log('[V601_PRODUCTION_BROWSER] real Edge passed · top user menu opens and CE home card physically navigates to /ce · native functional interaction proven end-to-end');
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
