import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const USERNAME='v249admin';
const PASSWORD='V249-Direct-Auth!';
const APP_PORT=5477,EXPORT_PORT=5478,AUTH_PORT=5479;
const APP_ORIGIN=`http://127.0.0.1:${APP_PORT}`;
const AUTH_ORIGIN=`http://127.0.0.1:${AUTH_PORT}`;
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v249-auth-'));
const dbFile=path.join(temp,'ce_qc_monitor.db');
const env={...process.env,DATA_DIR:temp,DB_FILE:dbFile,EXPORTS_DIR:path.join(temp,'exports'),PORT:String(APP_PORT),HOST:'127.0.0.1',ACCESS_MODE:'DUAL',CE_QC_AUTH_SIDECAR_PORT:String(AUTH_PORT),CE_QC_EXPORT_SIDECAR_PORT:String(EXPORT_PORT),CE_QC_BACKGROUND_MAINTENANCE_ENABLED:'0',CE_QC_DISABLE_SHOPEE_DELIVERY_TRACKER:'1',DASHBOARD_CACHE_STARTUP_DELAY_MS:'3600000',DASHBOARD_CACHE_REFRESH_MS:'7200000',NODE_ENV:'test'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child=null;

function fail(message,logs=[]){throw new Error(`${message}${logs.length?`\n--- server tail ---\n${logs.slice(-120).join('')}`:''}`);}
async function waitFor(url,{timeoutMs=90000,accept=r=>r.ok,headers={},logs=[]}={}){const end=Date.now()+timeoutMs;let last='';while(Date.now()<end){try{const r=await fetch(url,{cache:'no-store',headers});last=`HTTP ${r.status}`;if(accept(r))return r;}catch(e){last=e?.message||String(e);}await sleep(200);}fail(`timeout waiting for ${url}; last=${last}`,logs);}
async function requestJson(url,options={},logs=[]){const r=await fetch(url,{cache:'no-store',...options});const text=await r.text();let p={};try{p=text?JSON.parse(text):{};}catch{p={raw:text};}return{r,p,text};}
function portOpen(port){return new Promise(resolve=>{const s=net.createConnection({host:'127.0.0.1',port});let done=false;const finish=v=>{if(done)return;done=true;try{s.destroy();}catch{}resolve(v)};s.setTimeout(500,()=>finish(false));s.once('connect',()=>finish(true));s.once('error',()=>finish(false));});}
async function waitClosed(){const end=Date.now()+12000;while(Date.now()<end){if(!(await portOpen(APP_PORT))&&!(await portOpen(AUTH_PORT))&&!(await portOpen(EXPORT_PORT)))return;await sleep(250);}throw new Error('V249 process tree did not release ports');}
async function killTree(){if(!child?.pid)return;if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{encoding:'utf8',windowsHide:true,timeout:15000});else{try{child.kill('SIGTERM');}catch{}await sleep(800);try{child.kill('SIGKILL');}catch{}}await waitClosed();}
function extractFastCookie(headers){const values=typeof headers.getSetCookie==='function'?headers.getSetCookie():[headers.get('set-cookie')||''];for(const value of values){const match=String(value||'').match(/ce_v213_fast_session=([^;,\s]+)/);if(match)return `ce_v213_fast_session=${match[1]}`;}return '';}

try{
  process.env.DATA_DIR=temp;process.env.DB_FILE=dbFile;process.env.EXPORTS_DIR=path.join(temp,'exports');process.env.NODE_ENV='test';
  const {getDb,closeDb}=await import('../src/db.js');
  const db=getDb(),now=new Date().toISOString();
  db.prepare(`INSERT INTO users(username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,mustChangePassword,createdAt,updatedAt) VALUES(?,?,?,?,?,'ADMIN','ALL',1,0,?,?)`).run(USERNAME,'V249 Admin','QC','v249@example.invalid',bcrypt.hashSync(PASSWORD,10),now,now);
  closeDb();

  const logs=[];child=spawn(process.execPath,['bootstrap.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',c=>logs.push(String(c)));child.stderr.on('data',c=>logs.push(String(c)));

  const ping=await waitFor(`${AUTH_ORIGIN}/api/v213/auth-ping`,{accept:r=>r.status===200,headers:{accept:'application/json',origin:APP_ORIGIN},logs});
  const pingPayload=await ping.json();
  if(pingPayload?.ok!==true||pingPayload?.dbReady!==true||pingPayload?.authPathVersion!=='2026-08-20-v249-direct-sidecar-auth-v1')fail(`V249 auth ping mismatch: ${JSON.stringify(pingPayload)}`,logs);

  const badStarted=Date.now();
  const bad=await requestJson(`${AUTH_ORIGIN}/api/v213/local-auth/login`,{method:'POST',headers:{origin:APP_ORIGIN,'content-type':'application/json','accept':'application/json'},body:JSON.stringify({username:USERNAME,password:'wrong-password'})},logs);
  if(bad.r.status!==401||Date.now()-badStarted>5000)fail(`V249 wrong-password path was not fast/fail-closed: HTTP ${bad.r.status} ${bad.text}`,logs);

  const directStarted=Date.now();
  const direct=await requestJson(`${AUTH_ORIGIN}/api/v213/local-auth/login`,{method:'POST',headers:{origin:APP_ORIGIN,'content-type':'application/json','accept':'application/json'},body:JSON.stringify({username:USERNAME,password:PASSWORD})},logs);
  if(!direct.r.ok||direct.p?.authMode!=='V249_DIRECT_AUTH_SIDECAR'||!direct.p?.handoffToken)fail(`V249 direct sidecar login failed: HTTP ${direct.r.status} ${direct.text}`,logs);
  if(Date.now()-directStarted>5000)fail('V249 direct sidecar login exceeded 5s in isolated runtime',logs);
  if(direct.r.headers.get('x-ce-qc-auth-path')!=='2026-08-20-v249-direct-sidecar-auth-v1')fail('V249 auth response ownership header missing',logs);
  if(!String(direct.r.headers.get('access-control-allow-origin')||'').includes(APP_ORIGIN))fail('V249 direct browser CORS origin was not allowed',logs);
  const cookie=extractFastCookie(direct.r.headers);
  if(!cookie)fail('V251 cookie-first contract missing ce_v213_fast_session Set-Cookie on successful 5179 login',logs);

  await waitFor(`${APP_ORIGIN}/api/health`,{accept:r=>r.status===200,headers:{accept:'application/json'},logs});

  // V251 production browser path deliberately does NOT call /api/v223/fast-auth/accept
  // after a successful direct 5179 login. The host-scoped signed cookie issued on
  // port 5179 must be sufficient for the 5177 middleware to accept the session.
  const session=await requestJson(`${APP_ORIGIN}/api/session`,{headers:{cookie,accept:'application/json'}},logs);
  if(!session.r.ok||session.p?.user?.username!==USERNAME)fail(`V251 cookie-first authenticated session failed without handoff: ${session.text}`,logs);
  const app=await fetch(`${APP_ORIGIN}/`,{headers:{cookie,accept:'text/html'},cache:'no-store'});const html=await app.text();
  if(!app.ok||/CE质控系统内部登录/.test(html))fail('V251 valid direct sidecar cookie still received login page without handoff',logs);

  console.log(`CE_QC_V249_DIRECT_SIDECAR_LOGIN=PASS ms=${Date.now()-directStarted}`);
  console.log('CE_QC_V249_CORS_COOKIE_HANDOFF=PASS');
  console.log('CE_QC_V251_COOKIE_FIRST_LOGIN=PASS');
  console.log('CE_QC_V251_MAIN_SESSION_WITHOUT_HANDOFF=PASS');
}finally{
  try{await killTree();}catch(e){console.error('[V249] cleanup warning:',e?.message||e);}
  try{fs.rmSync(temp,{recursive:true,force:true});}catch{}
}
