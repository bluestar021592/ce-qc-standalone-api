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
async function probeAssetHttp(port,pathName,timeoutMs=8000){
  const started=Date.now();
  return await new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:pathName,method:'GET',headers:{Accept:'application/javascript','Cache-Control':'no-store'}},res=>{
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;chunks.push(chunk);});
      res.on('end',()=>resolve({status:Number(res.statusCode||0),ms:Date.now()-started,bytes,text:Buffer.concat(chunks).toString('utf8'),cache:String(res.headers['cache-control']||'')}));
    });
    req.on('error',reject);
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('asset HTTP probe timed out after '+timeoutMs+'ms')));
    req.end();
  });
}
async function probeBootstrapHttp(port,secret,timeoutMs=12000){
  const started=Date.now();
  const cookie='ce_qc_local_auth_v431='+signedCookie(secret);
  return await new Promise((resolve,reject)=>{
    const req=http.request({
      host:'127.0.0.1',port,path:'/api/bootstrap',method:'GET',
      headers:{Cookie:cookie,Accept:'application/json','Cache-Control':'no-store'}
    },res=>{
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;chunks.push(chunk);});
      res.on('end',()=>{
        const raw=Buffer.concat(chunks).toString('utf8');
        let parsed={};
        try{parsed=raw?JSON.parse(raw):{};}catch{}
        const topBytes={};
        for(const key of ['state','shopeeState','history','unifiedImport','businessStates','session','authStatus']){
          try{topBytes[key]=Buffer.byteLength(JSON.stringify(parsed?.[key]??null),'utf8');}catch{topBytes[key]=-1;}
        }
        resolve({
          status:Number(res.statusCode||0),
          ms:Date.now()-started,
          bytes,
          mode:String(res.headers['x-ce-qc-bootstrap-mode']||''),
          serverMs:String(res.headers['x-ce-qc-bootstrap-ms']||''),
          serverBytes:String(res.headers['x-ce-qc-bootstrap-bytes']||''),
          okJson:parsed?.ok===true,
          topBytes
        });
      });
    });
    req.on('error',reject);
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('bootstrap HTTP probe timed out after '+timeoutMs+'ms')));
    req.end();
  });
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
  const bootstrapProbe=await probeBootstrapHttp(port,secret,12000);
  console.log('[V617_BOOTSTRAP_HTTP] status='+bootstrapProbe.status+' ms='+bootstrapProbe.ms+' bytes='+bootstrapProbe.bytes+' mode='+bootstrapProbe.mode+' serverMs='+bootstrapProbe.serverMs+' serverBytes='+bootstrapProbe.serverBytes+' okJson='+(bootstrapProbe.okJson?1:0));
  console.log('[V619_BOOTSTRAP_TOP_BYTES] '+JSON.stringify(bootstrapProbe.topBytes||{}));
  assert.equal(bootstrapProbe.status,200,'V617 direct bootstrap HTTP probe must succeed before browser navigation');
  assert.equal(bootstrapProbe.okJson,true,'V617 direct bootstrap HTTP probe must return ok:true');
  assert.ok(bootstrapProbe.ms<8000,'V617 direct bootstrap HTTP probe must stay below 8s');
  const appAsset=await probeAssetHttp(port,'/app.js?v=20261001-v619-1',8000);
  console.log('[V619_APP_ASSET] status='+appAsset.status+' ms='+appAsset.ms+' bytes='+appAsset.bytes+' cache='+appAsset.cache+' hasV612='+(appAsset.text.includes('V612_REFRESH_START')?1:0)+' hasV616='+(appAsset.text.includes('V616_BOOTSTRAP_FETCH_START')?1:0));
  assert.equal(appAsset.status,200,'V619 app.js asset probe must succeed');
  assert.match(appAsset.text,/V616_BOOTSTRAP_FETCH_START/,'V619 delivered app.js must contain V616 bootstrap client diagnostics');

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
  await waitFor(async()=>backendLog.includes('event=V581_ENFORCE page=home')&&backendLog.includes('extra=bind|target=true'),15000,100,'stable shell bind diagnostic');
  stage('stable shell bind observed from page diagnostics');
  await waitFor(async()=>backendLog.includes('event=V615_RUNTIME_CHAIN_DONE page=home'),20000,100,'runtime script chain completion diagnostic');

  const ceHit=await waitFor(async()=>{
    const rows=backendLog.split(/\r?\n/).filter(line=>line.includes('event=V620_CE_HIT page=home')&&line.includes('extra=ms=2600|'));
    for(let i=rows.length-1;i>=0;i--){
      const m=rows[i].match(/extra=ms=2600\|x=(-?\d+)\|y=(-?\d+)\|w=(\d+)\|h=(\d+)\|card=([^|]*)\|top=([^|]*)/);
      if(!m)continue;
      const hit={x:Number(m[1]),y:Number(m[2]),w:Number(m[3]),h:Number(m[4]),card:m[5],top:m[6]};
      if(hit.x>0&&hit.y>0&&hit.w>0&&hit.h>0)return hit;
    }
    return null;
  },15000,100,'V620 2600ms CE hit coordinates');
  assert.ok(ceHit&&ceHit.x>0&&ceHit.y>64,'V620 must report a visible CE card after 2.6s');
  assert.notEqual(ceHit.top,'-','V620 must resolve the real top element at the CE hit point');
  stage('V620 page-owned liveness passed at 2600ms x='+ceHit.x+' y='+ceHit.y+' top='+ceHit.top);

  stage('verifying exact V600 native interaction asset');
  const earlyAsset=await withTimeout(new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/v592-early-sidebar-capture.js?v=20261001-v608-1'},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));});
    req.on('error',reject);
    req.setTimeout(5000,()=>req.destroy(new Error('native interaction asset request timeout')));
    req.end();
  }),7000,'native interaction asset request');
  assert.match(earlyAsset,/2026-09-29-v603-real-edge-geometry-rescue-v1/,'real server must deliver the V603 real-Edge interaction rescue');
  assert.doesNotMatch(earlyAsset,/global\.addEventListener\('pointerdown',pointerOwner,true\)/,'native interaction runtime must not capture pointerdown globally');
  assert.doesNotMatch(earlyAsset,/global\.addEventListener\('click',clickOwner,true\)/,'native interaction runtime must not capture click globally');
  assert.match(earlyAsset,/ceQcV600NativeInteraction/,'native interaction marker must be published');
  stage('native interaction contract delivered');

  stage('dispatching real Windows Edge mouse click at V620 CE coordinates');
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:ceHit.x,y:ceHit.y,button:'none'},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:ceHit.x,y:ceHit.y,button:'left',clickCount:1},12000);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:ceHit.x,y:ceHit.y,button:'left',clickCount:1},12000);

  const ceTarget=await waitForPageTarget(debugPort,'/ce',20000);
  assert.ok(ceTarget?.url,'physical CE click must navigate the real Edge page target to /ce');
  await waitFor(async()=>backendLog.includes('event=V612_APP_SCRIPT_START page=ce'),15000,100,'CE page app startup diagnostic after physical click');
  stage('V620 real CE mouse click navigated to /ce without Runtime.evaluate');

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
  try{
    const runtime=cdp?await cdp.eval("(()=>({href:location.href,ready:document.readyState,stable:!!window.__CE_QC_V581_STABLE_SHELL__,early:!!window.__CE_QC_V596_EARLY_INTERACTION__,v609:document.documentElement?.dataset?.ceQcV609MainHitScanRetired||'',shell:document.documentElement?.dataset?.ceQcStableShell||'',title:document.title,bodyClass:document.body?.className||''}))()",2500):null;
    console.error('[V609_DIAG] runtime='+JSON.stringify(runtime));
  }catch(diagError){
    console.error('[V609_DIAG] runtime unavailable: '+String(diagError?.message||diagError));
  }
  const focused=backendLog.split(/\r?\n/).filter(line=>/V612_|V615_|V616_|V617_|V598_MAINTHREAD_LAG|V607_SELF_CHECK/.test(line)).slice(-160).join('\n');
  if(focused)console.error('[V617_DIAG_FOCUSED]\n'+focused);
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
