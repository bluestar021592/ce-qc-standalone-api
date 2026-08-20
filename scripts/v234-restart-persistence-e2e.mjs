import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const REPORT_DATE='2026-08-17';
const USERNAME='v234admin';
const PASSWORD='V234-Restart-Persistence!';
const APP_PORT=5377;
const AUTH_PORT=5379;
const EXPORT_PORT=5378;
const APP_ORIGIN=`http://127.0.0.1:${APP_PORT}`;
const AUTH_ORIGIN=`http://127.0.0.1:${AUTH_PORT}`;
const PROJECT_ROOT=fileURLToPath(new URL('..',import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v234-'));
const dbFile=path.join(temp,'ce_qc_monitor.db');
const env={
  ...process.env,
  DATA_DIR:temp,
  DB_FILE:dbFile,
  EXPORTS_DIR:path.join(temp,'exports'),
  PORT:String(APP_PORT),
  HOST:'127.0.0.1',
  ACCESS_MODE:'DUAL',
  CE_QC_AUTH_SIDECAR_PORT:String(AUTH_PORT),
  CE_QC_EXPORT_SIDECAR_PORT:String(EXPORT_PORT),
  CE_QC_BACKGROUND_MAINTENANCE_ENABLED:'0',
  DASHBOARD_CACHE_STARTUP_DELAY_MS:'3600000',
  DASHBOARD_CACHE_REFRESH_MS:'7200000',
  NODE_ENV:'test'
};
const REQUIRED_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let active=null;

function fail(message,logs=[]){
  const tail=logs.slice(-120).join('');
  throw new Error(`${message}${tail?`\n--- server tail ---\n${tail}`:''}`);
}
async function waitFor(url,{timeoutMs=90000,accept=()=>true,headers={},logs=[]}={}){
  const end=Date.now()+timeoutMs;
  let last='';
  while(Date.now()<end){
    try{
      const response=await fetch(url,{cache:'no-store',headers});
      last=`HTTP ${response.status}`;
      if(accept(response))return response;
    }catch(error){last=error?.message||String(error);}
    await sleep(250);
  }
  fail(`timed out waiting for ${url}; last=${last}`,logs);
}
async function jsonRequest(url,options={},logs=[]){
  const response=await fetch(url,{cache:'no-store',...options});
  const text=await response.text();
  let payload={};
  try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};}
  if(!response.ok||payload?.ok===false)fail(`${options.method||'GET'} ${url} failed HTTP ${response.status}: ${text.slice(0,1600)}`,logs);
  return{response,payload,text};
}
function portOpen(port){
  return new Promise(resolve=>{
    const socket=net.createConnection({host:'127.0.0.1',port});
    let settled=false;
    const done=value=>{if(settled)return;settled=true;try{socket.destroy();}catch{}resolve(value);};
    socket.setTimeout(500,()=>done(false));
    socket.once('connect',()=>done(true));
    socket.once('error',()=>done(false));
  });
}
async function waitPortsClosed(ports,timeoutMs=12000){
  const end=Date.now()+timeoutMs;
  let open=[];
  while(Date.now()<end){
    open=[];
    for(const port of ports)if(await portOpen(port))open.push(port);
    if(!open.length)return;
    await sleep(250);
  }
  throw new Error(`process tree did not release ports after shutdown: ${open.join(',')}`);
}
function posixDescendants(rootPid){
  try{
    const result=spawnSync('ps',['-eo','pid=,ppid='],{encoding:'utf8',timeout:5000});
    if(result.status!==0)return[];
    const children=new Map();
    for(const line of String(result.stdout||'').split(/\r?\n/)){
      const match=line.trim().match(/^(\d+)\s+(\d+)$/);if(!match)continue;
      const pid=Number(match[1]),ppid=Number(match[2]);
      if(!children.has(ppid))children.set(ppid,[]);children.get(ppid).push(pid);
    }
    const out=[];
    const visit=pid=>{for(const child of children.get(pid)||[]){out.push(child);visit(child);}};
    visit(Number(rootPid));
    return out;
  }catch{return[];}
}
function pidAlive(pid){try{process.kill(Number(pid),0);return true;}catch{return false;}}
async function terminateProcessTree(run){
  if(!run?.child?.pid)return;
  const rootPid=run.child.pid;
  if(process.platform==='win32'){
    spawnSync('taskkill',['/PID',String(rootPid),'/T','/F'],{encoding:'utf8',windowsHide:true,timeout:15000});
  }else{
    const descendants=posixDescendants(rootPid);
    for(const pid of descendants.reverse()){try{process.kill(pid,'SIGTERM');}catch{}}
    try{run.child.kill('SIGTERM');}catch{}
    await sleep(1200);
    for(const pid of [rootPid,...descendants])if(pidAlive(pid)){try{process.kill(pid,'SIGKILL');}catch{}}
  }
  await waitPortsClosed([APP_PORT,AUTH_PORT,EXPORT_PORT]);
}

async function seedOnce(){
  process.env.DATA_DIR=temp;
  process.env.DB_FILE=dbFile;
  process.env.EXPORTS_DIR=path.join(temp,'exports');
  process.env.NODE_ENV='test';
  const {getDb,closeDb}=await import('../src/db.js');
  const db=getDb();
  const now=new Date().toISOString();
  const hash=bcrypt.hashSync(PASSWORD,10);
  db.prepare(`INSERT INTO users(username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,mustChangePassword,createdAt,updatedAt)
    VALUES(?,?,?,?,?,'ADMIN','ALL',1,0,?,?)`).run(USERNAME,'V234 Admin','QC','v234@example.invalid',hash,now,now);
  const daily=db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)`);
  for(const type of REQUIRED_TYPES)daily.run(type,REPORT_DATE,`${type}.xlsx`,1,'{}',now,now);
  const ccsl=db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,sourceType,isPod,category,primaryCategory,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`);
  for(const type of ['CE','CEAF','TBKH','ALI1688'])ccsl.run(`V234-${type}`,REPORT_DATE,type,1,'POD','POD',JSON.stringify({regionCode:'PP',currentState:'POD'}),now,now);
  const business=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`);
  business.run('SHOPEECN','V234-SCN',REPORT_DATE,1,'POD','SUCCESS',JSON.stringify({regionCode:'PP',currentState:'POD'}),now,now);
  business.run('SHOPEEVN','V234-SVN',REPORT_DATE,1,'POD','SUCCESS',JSON.stringify({regionCode:'PV',currentState:'POD'}),now,now);
  business.run('WHPP','V234-WHPP',REPORT_DATE,1,'POD','SUCCESS',JSON.stringify({regionCode:'PP',currentState:'POD'}),now,now);
  closeDb();
}
function persistedTruth(){
  const db=new DatabaseSync(dbFile,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON');
    const counts={};
    for(const type of REQUIRED_TYPES){
      counts[type]=Number(db.prepare("SELECT COALESCE(MAX(totalCount),0) total FROM business_daily_reports WHERE reportDate=? AND UPPER(businessType)=?").get(REPORT_DATE,type)?.total||0);
    }
    const user=Number(db.prepare('SELECT COUNT(*) total FROM users WHERE username=?').get(USERNAME)?.total||0);
    const finalRows=Number(db.prepare('SELECT COUNT(DISTINCT shipmentCode) total FROM final_rows WHERE reportDate=?').get(REPORT_DATE)?.total||0);
    const businessRows=Number(db.prepare('SELECT COUNT(DISTINCT shipmentCode) total FROM business_final_rows WHERE reportDate=?').get(REPORT_DATE)?.total||0);
    return{counts,user,finalRows,businessRows};
  }finally{try{db.close();}catch{}}
}
function assertPersistedTruth(label,truth){
  for(const type of REQUIRED_TYPES)if(Number(truth?.counts?.[type]||0)<1)fail(`${label}: persisted ${type} disappeared/zero`);
  if(truth.user!==1||truth.finalRows<4||truth.businessRows<3)fail(`${label}: persisted fixture changed unexpectedly: ${JSON.stringify(truth)}`);
}

async function startAndAccept(iteration){
  const logs=[];
  const child=spawn(process.execPath,['bootstrap.js'],{cwd:PROJECT_ROOT,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  const collect=chunk=>logs.push(String(chunk));
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.once('exit',(code,signal)=>logs.push(`\n[child exit code=${code} signal=${signal}]\n`));
  const run={iteration,child,logs,authPid:0};
  active=run;

  const pingResponse=await waitFor(`${AUTH_ORIGIN}/api/v213/auth-ping`,{timeoutMs:90000,accept:r=>r.status===200,headers:{accept:'application/json'},logs});
  const pingText=await pingResponse.text();
  let pingPayload={};try{pingPayload=pingText?JSON.parse(pingText):{};}catch{pingPayload={raw:pingText};}
  run.authPid=Number(pingPayload?.pid||0);
  if(pingPayload?.ok!==true||!run.authPid)fail(`restart #${iteration}: auth sidecar readiness/pid mismatch: ${pingText.slice(0,1200)}`,logs);

  const healthResponse=await waitFor(`${APP_ORIGIN}/api/health`,{timeoutMs:90000,accept:r=>r.status===200,headers:{accept:'application/json'},logs});
  const healthText=await healthResponse.text();
  let health={};try{health=healthText?JSON.parse(healthText):{};}catch{health={raw:healthText};}
  if(healthResponse.headers.get('x-ce-qc-data-gate')!=='V232-LIVE-PERSISTED-BOARDS'||health?.scope!=='LOOPBACK_READINESS_ONLY'||health?.ok!==true||health?.ready!==true)fail(`restart #${iteration}: live health ownership/readiness mismatch: ${healthText.slice(0,1600)}`,logs);
  if(String(health?.reportDate||'')!==REPORT_DATE||health?.dataState!=='PERSISTED_BOARDS_READY'||Number(health?.nonZeroBusinessCount||0)!==7)fail(`restart #${iteration}: persisted health truth mismatch: ${healthText.slice(0,1600)}`,logs);
  for(const type of REQUIRED_TYPES)if(Number(health?.businesses?.[type]||0)<1)fail(`restart #${iteration}: health ${type} remained zero`,logs);

  const sidecar=await jsonRequest(`${AUTH_ORIGIN}/api/v213/local-auth/login`,{
    method:'POST',headers:{'content-type':'application/json','accept':'application/json','origin':APP_ORIGIN},body:JSON.stringify({username:USERNAME,password:PASSWORD})
  },logs);
  const handoffToken=String(sidecar.payload?.handoffToken||'');
  if(!handoffToken)fail(`restart #${iteration}: auth sidecar returned no handoff token`,logs);
  const handoff=await jsonRequest(`${APP_ORIGIN}/api/v223/fast-auth/accept`,{
    method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({handoffToken})
  },logs);
  if(handoff.payload?.authMode!=='V223_MAIN_SESSION_HANDOFF')fail(`restart #${iteration}: unexpected handoff mode ${handoff.payload?.authMode||'-'}`,logs);
  const cookie=`ce_v213_fast_session=${handoffToken}`;
  const authHeaders={cookie,accept:'application/json'};
  const session=await jsonRequest(`${APP_ORIGIN}/api/session`,{headers:authHeaders},logs);
  if(session.payload?.user?.username!==USERNAME||session.payload?.user?.role!=='ADMIN')fail(`restart #${iteration}: session identity mismatch`,logs);
  const boot=await jsonRequest(`${APP_ORIGIN}/api/bootstrap`,{headers:authHeaders},logs);
  const bootDate=String(boot.payload?.unifiedImport?.reportDate||boot.payload?.state?.reportDate||'');
  if(bootDate!==REPORT_DATE)fail(`restart #${iteration}: bootstrap report date ${bootDate||'EMPTY'} != ${REPORT_DATE}`,logs);
  const states=boot.payload?.businessStates||{};
  for(const type of REQUIRED_TYPES){
    const total=Number(states?.[type]?.dashboard?.metrics?.total??states?.[type]?.dashboard?.totalMonitored??0);
    if(total<1)fail(`restart #${iteration}: bootstrap ${type} remained zero`,logs);
  }
  const whpp=await jsonRequest(`${APP_ORIGIN}/api/v71/whpp-summary?reportDate=${REPORT_DATE}`,{headers:authHeaders},logs);
  if(Number(whpp.payload?.total||whpp.payload?.metrics?.total||0)<1)fail(`restart #${iteration}: WHPP summary remained zero`,logs);
  console.log(`[V234] restart #${iteration} accepted pid=${child.pid} authPid=${run.authPid} date=${REPORT_DATE} sevenBoards=7 WHPP=nonzero.`);
  return run;
}

let first=null;
let second=null;
try{
  await waitPortsClosed([APP_PORT,AUTH_PORT,EXPORT_PORT],3000);
  await seedOnce();
  const seeded=persistedTruth();
  assertPersistedTruth('seed',seeded);
  console.log(`[V234] seeded once at ${dbFile}; no re-seed is permitted between starts.`);

  first=await startAndAccept(1);
  const firstMainPid=first.child.pid,firstAuthPid=first.authPid;
  await terminateProcessTree(first);active=null;
  const afterFirst=persistedTruth();
  assertPersistedTruth('after restart #1 shutdown',afterFirst);

  second=await startAndAccept(2);
  if(second.child.pid===firstMainPid)fail('restart #2 reused restart #1 main pid; process replacement was not proven',second.logs);
  if(second.authPid===firstAuthPid)fail('restart #2 reused restart #1 auth sidecar pid; stale 5179 process survived shutdown',second.logs);
  const duringSecond=persistedTruth();
  assertPersistedTruth('restart #2 same DB',duringSecond);
  if(JSON.stringify(afterFirst)!==JSON.stringify(duringSecond))fail(`restart #2 persisted truth changed without re-import: before=${JSON.stringify(afterFirst)} after=${JSON.stringify(duringSecond)}`,second.logs);

  await terminateProcessTree(second);active=null;
  const finalTruth=persistedTruth();
  assertPersistedTruth('after restart #2 shutdown',finalTruth);
  if(JSON.stringify(seeded)!==JSON.stringify(finalTruth))fail(`persisted truth did not survive two full starts: seeded=${JSON.stringify(seeded)} final=${JSON.stringify(finalTruth)}`);
  console.log(`[V234] restart persistence E2E passed: seed once -> start/login/bootstrap -> full tree stop -> same DB -> new main/auth pids -> start/login/bootstrap -> full tree stop; ${REPORT_DATE} + 7 boards + WHPP survived without re-import.`);
}finally{
  if(active){try{await terminateProcessTree(active);}catch(error){console.error('[V234] cleanup process-tree warning:',error?.message||error);}active=null;}
  try{fs.rmSync(temp,{recursive:true,force:true});}catch{}
}
