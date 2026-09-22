import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';

const v580=fs.readFileSync(new URL('../public/v580-visible-shell-recovery.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.ok(index.indexOf('/v580-visible-shell-recovery.js')<index.indexOf('(function installV575CoordinateOwner'),'V580 must load before V575 head owner');
assert.match(v580,/startup-5s/);
assert.match(v580,/visibility','visible','important'/);
assert.match(v580,/pageFromPath/);
assert.match(v580,/navigation-click/);

function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function browserExecutable(){
  const candidates=[];
  if(process.platform==='win32'){
    for(const root of [process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA]){
      if(!root)continue;
      candidates.push(path.join(root,'Microsoft','Edge','Application','msedge.exe'),path.join(root,'Google','Chrome','Application','chrome.exe'));
    }
  }else{
    for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){const hit=spawnSync('which',[name],{encoding:'utf8'});if(hit.status===0&&hit.stdout.trim())candidates.push(hit.stdout.trim());}
  }
  return candidates.find(p=>{try{return fs.existsSync(p)}catch{return false}})||'';
}
class CDP{
  constructor(ws){this.ws=new WebSocket(ws);this.id=0;this.pending=new Map();}
  async open(){await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true});});this.ws.addEventListener('message',e=>{const d=JSON.parse(String(e.data||'{}'));if(!d.id)return;const p=this.pending.get(d.id);if(!p)return;this.pending.delete(d.id);d.error?p.reject(new Error(d.error.message)):p.resolve(d.result||{});});}
  send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expression){const out=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(out.exceptionDetails)throw new Error(out.exceptionDetails.text||'eval failed');return out.result&&out.result.value;}
  close(){try{this.ws.close()}catch{}}
}
async function waitFor(fn,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){try{const v=await fn();if(v)return v}catch{}await new Promise(r=>setTimeout(r,80));}throw new Error('timeout');}

const browser=browserExecutable();
if(!browser){if(process.platform==='win32')throw new Error('V580 browser smoke requires Edge/Chrome on Windows');console.log('[V580_BROWSER] skipped outside Windows without Chromium');process.exit(0);}
const webPort=await freePort(),debugPort=await freePort();
const html='<!doctype html><html><head><meta charset="utf-8"><title>V580</title><script>'+v580.split('</script').join('<\\/script')+'</script><style>html,body{margin:0}.sidebar{position:fixed;left:0;top:0;width:220px;height:100vh;background:#06365f}.app-body{margin-left:220px;min-height:100vh}.topbar{height:60px}.app-page[hidden]{display:none!important}</style></head><body><aside class="sidebar"><button class="side-link active" data-page="home">HOME</button></aside><div class="app-body" style="display:none;visibility:hidden;opacity:0"><header class="topbar" style="display:none;visibility:hidden"><h1 id="pageTitle">HOME</h1></header><main class="main-content" style="display:none;visibility:hidden"><section id="homePage" class="app-page" hidden><div id="sentinel">VISIBLE_HOME</div></section><section id="ccslPage" class="app-page" hidden>CCSL</section></main></div></body></html>';
const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(webPort,'127.0.0.1',resolve);});
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v580-browser-'));
const child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port='+debugPort,'--user-data-dir='+userData,'about:blank'],{stdio:'ignore',windowsHide:true});
let cdp;
try{
  const target=await waitFor(async()=>{const resp=await fetch('http://127.0.0.1:'+debugPort+'/json');if(!resp.ok)return null;const list=await resp.json();return list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||null;},15000);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.open();await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+webPort+'/'});
  await waitFor(()=>cdp.eval("document.readyState==='complete'&&!!window.__CE_QC_V580_VISIBLE_SHELL__"));
  await waitFor(()=>cdp.eval("(()=>{const a=getComputedStyle(document.querySelector('.app-body')),t=getComputedStyle(document.querySelector('.topbar')),m=getComputedStyle(document.querySelector('.main-content'));return a.display!=='none'&&a.visibility!=='hidden'&&Number(a.opacity)>0&&t.display!=='none'&&m.display!=='none'&&!document.getElementById('homePage').hidden;})()"),5000);
  const rect=await cdp.eval("(()=>{const r=document.querySelector('.app-body').getBoundingClientRect();return {left:r.left,width:r.width,text:document.getElementById('sentinel').textContent,last:window.__CE_QC_V580_LAST_RECOVERY__};})()");
  assert.ok(rect.left<900&&rect.width>100,'recovered app body must be on screen');
  assert.equal(rect.text,'VISIBLE_HOME');
  assert.ok(rect.last&&rect.last.reason,'recovery diagnostics must be published');
  console.log('[V580_BROWSER] sidebar-only blank shell regression passed · hidden app-body/topbar/main-content + all pages recover to visible HOME in real Chromium/Edge');
} finally{
  try{cdp&&cdp.close()}catch{}
  try{child.kill('SIGKILL')}catch{}
  await new Promise(r=>server.close(r));
  try{fs.rmSync(userData,{recursive:true,force:true})}catch{}
}
