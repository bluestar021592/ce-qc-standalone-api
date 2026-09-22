import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicDir=path.join(root,'public');
process.env.CE_QC_RECOVERY_SAFE_MODE='1';
process.env.CE_QC_BACKGROUND_MAINTENANCE_ENABLED='0';
process.env.CE_QC_SKIP_STARTUP_POD_REPAIR='1';
process.env.DATA_DIR=path.join(os.tmpdir(),'ce-qc-v581-data');
process.env.DB_FILE=path.join(process.env.DATA_DIR,'v581.db');
const [{buildV509InjectedHtmlForTest},{applyV330UiHtmlForTest}]=await Promise.all([
  import('../src/v44WhppUiPatch.js'),
  import('../src/v231MetricTruthUiInjectionPatch.js')
]);
const productionHtml=applyV330UiHtmlForTest(buildV509InjectedHtmlForTest());

function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function browserExecutable(){
  const candidates=[];
  if(process.platform==='win32'){
    for(const base of [process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA]){
      if(!base)continue;
      candidates.push(path.join(base,'Microsoft','Edge','Application','msedge.exe'),path.join(base,'Google','Chrome','Application','chrome.exe'));
    }
  }else{
    for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){const hit=spawnSync('which',[name],{encoding:'utf8'});if(hit.status===0&&hit.stdout.trim())candidates.push(hit.stdout.trim());}
  }
  return candidates.find(p=>{try{return fs.existsSync(p)}catch{return false}})||'';
}
function typeFor(file){
  const ext=path.extname(file).toLowerCase();
  return ext==='.html'?'text/html; charset=utf-8':ext==='.js'||ext==='.mjs'?'application/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':ext==='.svg'?'image/svg+xml':ext==='.json'?'application/json; charset=utf-8':ext==='.png'?'image/png':ext==='.jpg'||ext==='.jpeg'?'image/jpeg':'application/octet-stream';
}
function sendJson(res,obj){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj));}

const genericState={businessType:'CCSL',reportDate:'',snapshotId:'',processing:{running:false,paused:false},dashboard:{},detailTabs:{},finalRows:[],dbStatus:{ok:true,dbFile:'TEST',usingFallbackDataDir:false},network:{lanUrl:'http://127.0.0.1'}};
const genericShopee={businessType:'SHOPEE',reportDate:'',snapshotId:'',processing:{running:false,paused:false},dashboard:{},detailTabs:{},finalRows:[],dbStatus:{ok:true}};
const bootstrap={ok:true,state:genericState,shopeeState:genericShopee,authStatus:{loggedIn:true,account:'TEST'},session:{ok:true,user:{displayName:'Test User',department:'QC',role:'ADMIN',businessScope:'ALL'},unreadNotifications:0},history:{CCSL:[],SHOPEE:[],UNIFIED:[]},unifiedImport:null,businessStates:{}};

class CDP{
  constructor(ws){this.ws=new WebSocket(ws);this.id=0;this.pending=new Map();this.events=[];}
  async open(){await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true});});this.ws.addEventListener('message',e=>{const d=JSON.parse(String(e.data||'{}'));if(d.id){const p=this.pending.get(d.id);if(!p)return;this.pending.delete(d.id);d.error?p.reject(new Error(d.error.message)):p.resolve(d.result||{});}else this.events.push(d);});}
  send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expression){const out=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(out.exceptionDetails)throw new Error(out.exceptionDetails.exception?.description||out.exceptionDetails.text||'eval failed');return out.result?.value;}
  close(){try{this.ws.close()}catch{}}
}
async function waitFor(fn,timeout=15000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const v=await fn();if(v)return v;last=v}catch(error){last=error}await new Promise(r=>setTimeout(r,100));}throw new Error('waitFor timeout: '+(last?.message||last||''));}

const port=await freePort();
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  if(u.pathname==='/api/bootstrap')return sendJson(res,bootstrap);
  if(u.pathname==='/api/health')return sendJson(res,{ok:true,db:{ok:true}});
  if(u.pathname==='/api/ce-auth-status')return sendJson(res,{ok:true,authStatus:{loggedIn:true}});
  if(u.pathname==='/api/session')return sendJson(res,{ok:true,user:bootstrap.session.user,unreadNotifications:0});
  if(u.pathname==='/api/history'||u.pathname==='/api/unified-history')return sendJson(res,{ok:true,rows:[]});
  if(u.pathname==='/api/import/unified-latest')return sendJson(res,{ok:true,import:null});
  if(u.pathname==='/api/state')return sendJson(res,{ok:true,state:genericState});
  if(u.pathname==='/api/shopee/state')return sendJson(res,{ok:true,state:genericShopee});
  if(u.pathname==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.write('event: READY\ndata: {}\n\n');return;}
  if(u.pathname.startsWith('/api/'))return sendJson(res,{ok:true,rows:[],state:{},metrics:{},history:[]});
  const routeLike=['/','/ce','/ceaf','/tbkh','/ali1688','/whpp','/shopeecn','/shopeevn','/import','/tracking','/exceptions','/reports','/settings','/logs','/data-management'];
  let file=u.pathname;
  if(routeLike.includes(file))file='/index.html';
  file=String(file||''); while(file.startsWith('/')) file=file.slice(1);
  if(file==='index.html'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(productionHtml);
    return;
  }
  const abs=path.normalize(path.join(publicDir,file));
  if(!abs.startsWith(publicDir)||!fs.existsSync(abs)||fs.statSync(abs).isDirectory()){res.writeHead(404);res.end('not found');return;}
  res.writeHead(200,{'content-type':typeFor(abs),'cache-control':'no-store'});
  fs.createReadStream(abs).pipe(res);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});

const browser=browserExecutable();
if(!browser){console.log('[V581_PROD_SHELL] skipped: no Chromium');server.close();process.exit(0);}
const debugPort=await freePort();
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v581-prod-shell-'));
const child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port='+debugPort,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
let cdp;
try{
  const target=await waitFor(async()=>{const r=await fetch('http://127.0.0.1:'+debugPort+'/json');const list=await r.json();return list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||null;});
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.open();await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Log.enable');
  const navResult=await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+port+'/?auth=v580&prodShell=1'});
  await new Promise(r=>setTimeout(r,2500));
  const probe=await cdp.eval("(()=>({href:location.href,readyState:document.readyState,title:document.title,body:(document.body&&document.body.innerText||'').slice(0,300),html:(document.documentElement&&document.documentElement.outerHTML||'').slice(0,500),sidebar:!!document.querySelector('.sidebar'),appBody:!!document.querySelector('.app-body')}))()");
  console.log('[V581_PROD_SHELL_PROBE]',JSON.stringify({navResult,probe}));
  assert.equal(probe.sidebar,true,'actual production index did not load a sidebar; probe='+JSON.stringify(probe));
  assert.equal(probe.appBody,true,'actual production index did not load app-body; probe='+JSON.stringify(probe));
  const snapshot=async label=>{
    const state=await cdp.eval(`(()=>{const q=s=>document.querySelector(s);const cs=s=>q(s)?getComputedStyle(q(s)):null;const rr=s=>{const r=q(s)?.getBoundingClientRect();return r?{left:r.left,top:r.top,width:r.width,height:r.height}:null};const ce=q('.side-link[data-page="ce"]');const cr=ce?.getBoundingClientRect();const hit=cr?document.elementFromPoint(cr.left+cr.width/2,cr.top+cr.height/2):null;return {
      readyState:document.readyState,compat:document.documentElement.dataset.v554Compatibility||'',appReady:!!window.__CE_QC_V575_COORDINATE_OWNER__,v580:!!window.__CE_QC_V580_VISIBLE_SHELL__,
      appBody:{display:cs('.app-body')?.display,visibility:cs('.app-body')?.visibility,opacity:cs('.app-body')?.opacity,rect:rr('.app-body')},
      topbar:{display:cs('.topbar')?.display,visibility:cs('.topbar')?.visibility,rect:rr('.topbar')},
      main:{display:cs('.main-content')?.display,visibility:cs('.main-content')?.visibility,rect:rr('.main-content')},
      homeHidden:q('#homePage')?.hidden,title:q('#pageTitle')?.textContent,homeText:q('#homePage')?.innerText?.slice(0,250),
      ceRect:cr?{left:cr.left,top:cr.top,width:cr.width,height:cr.height}:null,hit:{tag:hit?.tagName||'',id:hit?.id||'',cls:String(hit?.className||''),page:hit?.closest?.('[data-page]')?.dataset?.page||''}
    }})()`);
    console.log('[V581_PROD_SHELL_STATE:'+label+']',JSON.stringify(state));return state;
  };
  await new Promise(r=>setTimeout(r,500));
  await snapshot('0.5s');
  await waitFor(()=>cdp.eval("document.documentElement.dataset.v554Compatibility==='ready'"),20000).catch(()=>false);
  const state=await snapshot('compat-ready');
  assert.notEqual(state.appBody.display,'none','production app body must be visible after all injected compatibility scripts');
  assert.notEqual(state.topbar.display,'none','production topbar must be visible after all injected compatibility scripts');
  assert.notEqual(state.main.display,'none','production main must be visible after all injected compatibility scripts');
  assert.equal(state.homeHidden,false,'production home page must be visible');
  assert.ok((state.appBody.rect?.width||0)>500,'production app body must occupy viewport');
  assert.ok((state.topbar.rect?.height||0)>20,'production topbar must have height');
  assert.ok((state.main.rect?.height||0)>100,'production main content must have height');
  assert.match(state.homeText||'',/核心指标总览/,'production home static content must be visible');
  assert.equal(state.hit.page,'ce','native hit-test must reach CE sidebar control, not an overlay');
  const clickNative=async page=>{
    const p=await cdp.eval(`(()=>{const e=document.querySelector('.side-link[data-page="${page}"]');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
  };
  await clickNative('ce');
  await waitFor(()=>cdp.eval("!document.getElementById('ccslPage').hidden&&document.querySelector('.side-link[data-page=ce]').classList.contains('active')"),5000);
  await clickNative('import');
  await waitFor(()=>cdp.eval("!document.getElementById('importPage').hidden&&document.querySelector('.side-link[data-page=import]').classList.contains('active')"),5000);
  const exceptions=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params?.exceptionDetails?.exception?.description||e.params?.exceptionDetails?.text||'').filter(Boolean);
  console.log('[V581_PROD_SHELL_EXCEPTIONS]',JSON.stringify(exceptions.slice(0,10)));
  assert.equal(exceptions.length,0,'production shell emitted runtime exceptions: '+exceptions.join(' | '));
  console.log('[V581_PROD_SHELL] exact V509+V330 delivered production HTML passed in real Chromium/Edge after all deferred compatibility assets: home/topbar visible, native CE/import clicks work, zero runtime exceptions');
}finally{
  try{cdp?.close()}catch{}
  try{child.kill('SIGKILL')}catch{}
  await new Promise(r=>server.close(r));
  try{fs.rmSync(profile,{recursive:true,force:true})}catch{}
}
