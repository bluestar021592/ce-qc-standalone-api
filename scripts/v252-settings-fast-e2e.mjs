import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const USERNAME='v252viewer',PASSWORD='V252-Settings-Fast!';
const APP_PORT=5577,EXPORT_PORT=5578,AUTH_PORT=5579;
const APP=`http://127.0.0.1:${APP_PORT}`,AUTH=`http://127.0.0.1:${AUTH_PORT}`;
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v252-settings-'));const dbFile=path.join(temp,'ce_qc_monitor.db');
const env={...process.env,DATA_DIR:temp,DB_FILE:dbFile,EXPORTS_DIR:path.join(temp,'exports'),PORT:String(APP_PORT),HOST:'127.0.0.1',ACCESS_MODE:'DUAL',CE_QC_AUTH_SIDECAR_PORT:String(AUTH_PORT),CE_QC_EXPORT_SIDECAR_PORT:String(EXPORT_PORT),CE_QC_BACKGROUND_MAINTENANCE_ENABLED:'0',CE_QC_DISABLE_SHOPEE_DELIVERY_TRACKER:'1',DASHBOARD_CACHE_STARTUP_DELAY_MS:'3600000',DASHBOARD_CACHE_REFRESH_MS:'7200000',NODE_ENV:'test'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let child=null;
function fail(message,logs=[]){throw new Error(`${message}${logs.length?`\n--- server tail ---\n${logs.slice(-100).join('')}`:''}`);}
async function waitFor(url,{timeout=90000,accept=r=>r.ok,headers={},logs=[]}={}){const end=Date.now()+timeout;let last='';while(Date.now()<end){try{const r=await fetch(url,{cache:'no-store',headers});last=`HTTP ${r.status}`;if(accept(r))return r;}catch(e){last=e?.message||String(e);}await sleep(200);}fail(`timeout ${url}; last=${last}`,logs);}
async function json(url,options={}){const r=await fetch(url,{cache:'no-store',...options});const text=await r.text();let p={};try{p=text?JSON.parse(text):{};}catch{p={raw:text};}return{r,p,text};}
function portOpen(port){return new Promise(resolve=>{const s=net.createConnection({host:'127.0.0.1',port});let done=false;const finish=v=>{if(done)return;done=true;try{s.destroy();}catch{}resolve(v)};s.setTimeout(400,()=>finish(false));s.once('connect',()=>finish(true));s.once('error',()=>finish(false));});}
async function cleanup(){if(child?.pid){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8',timeout:15000});else{try{child.kill('SIGTERM');}catch{}}}const end=Date.now()+10000;while(Date.now()<end){if(!(await portOpen(APP_PORT))&&!(await portOpen(AUTH_PORT))&&!(await portOpen(EXPORT_PORT)))break;await sleep(200);}try{fs.rmSync(temp,{recursive:true,force:true});}catch{}}

try{
  process.env.DATA_DIR=temp;process.env.DB_FILE=dbFile;process.env.EXPORTS_DIR=path.join(temp,'exports');process.env.NODE_ENV='test';
  const {getDb,closeDb}=await import('../src/db.js');const db=getDb(),now=new Date().toISOString();
  db.prepare(`INSERT INTO users(username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,mustChangePassword,createdAt,updatedAt) VALUES(?,?,?,?,?,'VIEWER','ALL',1,0,?,?)`).run(USERNAME,'V252 Viewer','QC','v252@example.invalid',bcrypt.hashSync(PASSWORD,10),now,now);closeDb();
  const logs=[];child=spawn(process.execPath,['bootstrap.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',c=>logs.push(String(c)));child.stderr.on('data',c=>logs.push(String(c)));
  await waitFor(`${AUTH}/api/v213/auth-ping`,{headers:{origin:APP,accept:'application/json'},logs});
  const login=await json(`${AUTH}/api/v213/local-auth/login`,{method:'POST',headers:{origin:APP,'content-type':'application/json','accept':'application/json'},body:JSON.stringify({username:USERNAME,password:PASSWORD})});
  if(!login.r.ok||!login.p?.handoffToken)fail(`sidecar login failed ${login.text}`,logs);
  await waitFor(`${APP}/api/health`,{accept:r=>r.status===200,headers:{accept:'application/json'},logs});
  const cookie=`ce_v213_fast_session=${login.p.handoffToken}`;
  const settings=await fetch(`${APP}/settings`,{cache:'no-store',headers:{cookie,accept:'text/html'}});const html=await settings.text();
  if(!settings.ok||!html.includes('/v252-settings-recovery.js?v=20260821-v253-1'))fail('V253 recovery client was not injected into real /settings HTML',logs);
  const root=await fetch(`${APP}/`,{cache:'no-store',headers:{cookie,accept:'text/html'}});const rootHtml=await root.text();
  if(!root.ok||!rootHtml.includes('/v252-settings-recovery.js?v=20260821-v253-1'))fail('V253 recovery client was not injected into root HTML for SPA navigation',logs);
  const shell=await json(`${APP}/api/v252/settings-shell`,{headers:{cookie,accept:'application/json'}});
  if(!shell.r.ok||shell.p?.user?.username!==USERNAME||shell.p?.user?.role!=='VIEWER'||shell.p?.dashboardRequired!==false)fail(`V252 settings shell mismatch ${shell.text}`,logs);
  const started=Date.now();const missing=await json(`${APP}/api/v252/ce-login`,{method:'POST',headers:{cookie,'content-type':'application/json','accept':'application/json'},body:JSON.stringify({tenantId:'000000',username:'',password:''})});
  if(missing.r.status!==400||Date.now()-started>2500)fail(`V252 CE connector route did not remain fast/reachable for authenticated VIEWER: HTTP ${missing.r.status} ${missing.text}`,logs);
  console.log('CE_QC_V253_SETTINGS_HTML_INJECT=PASS');
  console.log('CE_QC_V253_ROOT_SPA_INJECT=PASS');
  console.log('CE_QC_V252_SETTINGS_SHELL_WITHOUT_DASHBOARD=PASS');
  console.log('CE_QC_V252_CE_CONNECTOR_ROUTE_REACHABLE=PASS');
}finally{await cleanup();}
