
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const match=index.match(/<script>\s*\(function installV575CoordinateOwner[\s\S]*?<\/script>/);
assert.ok(match,'V575 inline owner must exist before browser smoke');
const ownerSource=match[0].replace(/^<script>\s*/,'').replace(/<\/script>$/,'');

function freePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});
  });
}
function exists(value){try{return Boolean(value&&fs.existsSync(value));}catch{return false;}}
function browserExecutable(){
  const candidates=[];
  if(process.platform==='win32'){
    for(const root of [process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA]){
      if(!root)continue;
      candidates.push(path.join(root,'Microsoft','Edge','Application','msedge.exe'));
      candidates.push(path.join(root,'Google','Chrome','Application','chrome.exe'));
    }
  }else{
    for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
      const hit=spawnSync('which',[name],{encoding:'utf8'});
      if(hit.status===0&&hit.stdout.trim())candidates.push(hit.stdout.trim());
    }
  }
  return candidates.find(exists)||'';
}
function fixtureHtml(){
  return '<!doctype html><html><head><meta charset="utf-8"><title>V575 browser smoke</title>'+
    '<script>'+ownerSource.replace(/<\\/script/gi,'<\\\\/script')+'<\\/script>'+
    '<style>'+
    'html,body{margin:0;width:100%;height:100%;font-family:Arial}'+
    '.app-stage,.app-shell{min-height:100vh}.sidebar{position:fixed;left:0;top:0;width:300px;height:100vh;background:#06365f;padding:12px;box-sizing:border-box}'+
    '.side-nav{display:grid;gap:6px}.side-link{height:48px;border:0;background:#0b4d82;color:#fff;text-align:left;padding:0 18px}'+
    '.app-body{margin-left:300px;padding:24px}.app-page[hidden]{display:none!important}'+
    '#sidebarBlocker{position:fixed;left:0;top:0;width:300px;height:100vh;z-index:2147483647;background:rgba(255,0,0,.001);pointer-events:auto}'+
    '#contentBlocker{position:fixed;left:340px;top:250px;width:260px;height:100px;z-index:2147483647;background:rgba(0,0,255,.001);pointer-events:auto}'+
    '#metricButton{position:absolute;left:360px;top:270px;width:220px;height:60px}'+
    '</style></head><body>'+
    '<div class="app-stage"><div class="app-shell">'+
    '<aside class="sidebar"><nav class="side-nav">'+
    '<button class="side-link active" data-page="home">首页总看板</button>'+
    '<button class="side-link" data-page="ce">CE看板</button>'+
    '<button class="side-link" data-page="tbkh">TBKH看板</button>'+
    '<button class="side-link" data-page="whpp">WHPP本土看板</button>'+
    '<button class="side-link" data-page="import">数据导入</button>'+
    '<button class="side-link" data-page="tracking">轨迹查询</button>'+
    '</nav></aside>'+
    '<main class="app-body">'+
    '<section id="homePage" class="app-page"><h1>HOME</h1></section>'+
    '<section id="ccslPage" class="app-page" hidden><h1>CCSL</h1></section>'+
    '<section id="shopeePage" class="app-page" hidden><h1>SHOPEE</h1></section>'+
    '<section id="importPage" class="app-page" hidden><h1>IMPORT</h1></section>'+
    '<section id="trackPage" class="app-page" hidden><h1>TRACK</h1></section>'+
    '<button id="metricButton" onclick="document.body.dataset.metric=\'clicked\'">metric</button>'+
    '</main></div></div>'+
    '<div id="sidebarBlocker"></div><div id="contentBlocker"></div>'+
    '</body></html>';
}
class CDP{
  constructor(ws){this.ws=new WebSocket(ws);this.id=0;this.pending=new Map();}
  async open(){
    await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true});});
    this.ws.addEventListener('message',event=>{
      const data=JSON.parse(String(event.data||'{}'));if(!data.id)return;
      const p=this.pending.get(data.id);if(!p)return;this.pending.delete(data.id);
      if(data.error)p.reject(new Error(data.error.message||JSON.stringify(data.error)));else p.resolve(data.result||{});
    });
  }
  send(method,params={}){
    const id=++this.id;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});
  }
  async eval(expression){
    const out=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(out.exceptionDetails)throw new Error(out.exceptionDetails.text||'Runtime.evaluate failed');
    return out.result&&out.result.value;
  }
  close(){try{this.ws.close();}catch{}}
}
async function waitFor(fn,timeout=10000,interval=100){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    try{const value=await fn();if(value)return value;}catch{}
    await new Promise(resolve=>setTimeout(resolve,interval));
  }
  throw new Error('Timed out waiting for browser condition');
}
async function clickAt(cdp,selector,expectedBlocker){
  const expression='(()=>{const n=document.querySelector('+JSON.stringify(selector)+');if(!n)return null;const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()';
  const point=await cdp.eval(expression);
  assert.ok(point&&Number.isFinite(point.x)&&Number.isFinite(point.y),'missing point for '+selector);
  if(expectedBlocker){
    const top=await cdp.eval('document.elementFromPoint('+point.x+','+point.y+')?.id||""');
    assert.equal(top,expectedBlocker,expectedBlocker+' must own the native hit before V575 coordinate recovery');
  }
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y,button:'none'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
}

const browser=browserExecutable();
if(!browser){
  if(process.platform==='win32')throw new Error('V575 browser smoke requires Edge/Chrome on Windows runner');
  console.log('[V575_BROWSER] no Chrome/Chromium found on this non-Windows runner; Windows updater gate remains authoritative');
  process.exit(0);
}
const webPort=await freePort();
const debugPort=await freePort();
const html=fixtureHtml();
const server=http.createServer((req,res)=>{
  const url=new URL(req.url||'/','http://127.0.0.1:'+webPort);
  if(url.pathname==='/api/client-diag'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end('{"ok":true}');return;}
  if(url.pathname==='/fixture'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);return;}
  res.writeHead(204);res.end();
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(webPort,'127.0.0.1',resolve);});
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v575-browser-'));
const args=['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--remote-debugging-port='+debugPort,'--user-data-dir='+userData,'about:blank'];
const child=spawn(browser,args,{stdio:'ignore',windowsHide:true});
let cdp;
try{
  const target=await waitFor(async()=>{
    const response=await fetch('http://127.0.0.1:'+debugPort+'/json');
    if(!response.ok)return null;
    const list=await response.json();
    return list.find(row=>row.type==='page'&&row.webSocketDebuggerUrl)||null;
  },15000,150);
  cdp=new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+webPort+'/fixture'});
  await waitFor(()=>cdp.eval("document.readyState==='complete'&&!!window.__CE_QC_V575_COORDINATE_OWNER__&&!!document.querySelector('[data-page=ce]')"),10000,80);

  await clickAt(cdp,'.side-link[data-page="ce"]','sidebarBlocker');
  await waitFor(()=>cdp.eval("location.pathname==='/ce'&&!document.getElementById('ccslPage').hidden&&document.querySelector('[data-page=ce]').classList.contains('active')"),3000,50);

  await cdp.eval("document.getElementById('sidebarBlocker').style.pointerEvents='auto'");
  await clickAt(cdp,'.side-link[data-page="import"]','sidebarBlocker');
  await waitFor(()=>cdp.eval("location.pathname==='/import'&&!document.getElementById('importPage').hidden&&document.querySelector('[data-page=import]').classList.contains('active')"),3000,50);

  await clickAt(cdp,'#metricButton','contentBlocker');
  await waitFor(()=>cdp.eval("document.body.dataset.metric==='clicked'"),3000,50);

  const owner=await cdp.eval("window.__CE_QC_V575_COORDINATE_OWNER__");
  assert.equal(owner.version,'2026-09-21-v575-coordinate-nav-owner-v1');
  console.log('[V575_BROWSER] real Chromium/Edge pointer smoke passed · transparent sidebar overlay intercepted native hit · CE/import still switched by coordinate recovery · blocked dashboard button still fired');
} finally {
  try{cdp&&cdp.close();}catch{}
  try{child.kill('SIGKILL');}catch{}
  await new Promise(resolve=>server.close(resolve));
  try{fs.rmSync(userData,{recursive:true,force:true});}catch{}
}
