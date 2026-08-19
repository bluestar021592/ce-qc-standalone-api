import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const REPORT_DATE='2026-08-16';
const USERNAME='v225admin';
const PASSWORD='V225-Test-Password!';
const PROJECT_ROOT=fileURLToPath(new URL('..',import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v225-'));
const dbFile=path.join(temp,'ce_qc_monitor.db');
const env={
  ...process.env,
  DATA_DIR:temp,
  DB_FILE:dbFile,
  EXPORTS_DIR:path.join(temp,'exports'),
  PORT:'5177',
  HOST:'127.0.0.1',
  ACCESS_MODE:'DUAL',
  CE_QC_AUTH_SIDECAR_PORT:'5179',
  CE_QC_EXPORT_SIDECAR_PORT:'5178',
  CE_QC_BACKGROUND_MAINTENANCE_ENABLED:'0',
  DASHBOARD_CACHE_STARTUP_DELAY_MS:'3600000',
  DASHBOARD_CACHE_REFRESH_MS:'7200000',
  NODE_ENV:'test'
};

let child=null;
const logs=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fail(message){throw new Error(`${message}\n--- server tail ---\n${logs.slice(-120).join('')}`);}
async function waitFor(url,{timeoutMs=50000,accept=()=>true}={}){
  const end=Date.now()+timeoutMs;
  let last='';
  while(Date.now()<end){
    try{
      const response=await fetch(url,{cache:'no-store'});
      last=`HTTP ${response.status}`;
      if(accept(response))return response;
    }catch(error){last=error?.message||String(error);}
    await sleep(250);
  }
  fail(`timed out waiting for ${url}; last=${last}`);
}
async function jsonRequest(url,options={}){
  const response=await fetch(url,{cache:'no-store',...options});
  const text=await response.text();
  let payload={};
  try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};}
  if(!response.ok||payload?.ok===false)fail(`${options.method||'GET'} ${url} failed HTTP ${response.status}: ${text.slice(0,1200)}`);
  return{response,payload};
}

try{
  process.env.DATA_DIR=temp;
  process.env.DB_FILE=dbFile;
  process.env.EXPORTS_DIR=path.join(temp,'exports');
  process.env.NODE_ENV='test';
  const {getDb,closeDb}=await import('../src/db.js');
  const db=getDb();
  const now=new Date().toISOString();
  const hash=bcrypt.hashSync(PASSWORD,10);
  db.prepare(`INSERT INTO users(username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,mustChangePassword,createdAt,updatedAt)
    VALUES(?,?,?,?,?,'ADMIN','ALL',1,0,?,?)`).run(USERNAME,'V225 Admin','QC','v225@example.invalid',hash,now,now);

  const daily=db.prepare(`INSERT INTO business_daily_reports(businessType,reportDate,sourceFile,totalCount,summaryJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)`);
  for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) daily.run(type,REPORT_DATE,`${type}.xlsx`,1,'{}',now,now);

  const ccsl=db.prepare(`INSERT INTO final_rows(shipmentCode,reportDate,sourceType,isPod,category,primaryCategory,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`);
  for(const type of ['CE','CEAF','TBKH','ALI1688']) ccsl.run(`V225-${type}`,REPORT_DATE,type,1,'POD','POD',JSON.stringify({regionCode:'PP',currentState:'POD'}),now,now);

  const business=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,apiStatus,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`);
  business.run('SHOPEECN','V225-SCN',REPORT_DATE,1,'POD','SUCCESS',JSON.stringify({regionCode:'PP',currentState:'POD'}),now,now);
  business.run('SHOPEEVN','V225-SVN',REPORT_DATE,1,'POD','SUCCESS',JSON.stringify({regionCode:'PV',currentState:'POD'}),now,now);
  business.run('WHPP','V225-WHPP',REPORT_DATE,1,'POD','SUCCESS',JSON.stringify({regionCode:'PP',currentState:'POD'}),now,now);
  closeDb();

  child=spawn(process.execPath,['bootstrap.js'],{cwd:PROJECT_ROOT,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  const collect=chunk=>logs.push(String(chunk));
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.once('exit',(code,signal)=>logs.push(`\n[child exit code=${code} signal=${signal}]\n`));

  await waitFor('http://127.0.0.1:5179/api/v213/auth-ping',{accept:r=>r.status===200});
  const root=await waitFor('http://127.0.0.1:5177/',{accept:r=>r.status===200});
  const rootText=await root.text();
  if(!/CE质控系统内部登录|CE QC internal sign-in/i.test(rootText))fail('unauthenticated root did not fail closed to the internal login page');

  const sidecar=await jsonRequest('http://127.0.0.1:5179/api/v213/local-auth/login',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json','origin':'http://127.0.0.1:5177'},
    body:JSON.stringify({username:USERNAME,password:PASSWORD})
  });
  const handoffToken=String(sidecar.payload.handoffToken||'');
  if(!handoffToken)fail('sidecar login succeeded without a deterministic handoff token');

  const handoff=await jsonRequest('http://127.0.0.1:5177/api/v223/fast-auth/accept',{
    method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({handoffToken})
  });
  if(handoff.payload?.authMode!=='V223_MAIN_SESSION_HANDOFF')fail(`unexpected handoff mode ${handoff.payload?.authMode||'-'}`);
  const setCookie=String(handoff.response.headers.get('set-cookie')||'');
  if(!setCookie.includes('ce_v213_fast_session='))fail('5177 handoff did not issue the main fast-session cookie');
  const cookie=`ce_v213_fast_session=${handoffToken}`;
  const authHeaders={cookie,accept:'application/json'};

  const session=await jsonRequest('http://127.0.0.1:5177/api/session',{headers:authHeaders});
  if(session.payload?.user?.username!==USERNAME||session.payload?.user?.role!=='ADMIN')fail(`main session identity mismatch: ${JSON.stringify(session.payload?.user||{})}`);

  const boot=await jsonRequest('http://127.0.0.1:5177/api/bootstrap',{headers:authHeaders});
  const bootDate=String(boot.payload?.unifiedImport?.reportDate||boot.payload?.state?.reportDate||'');
  if(bootDate!==REPORT_DATE)fail(`bootstrap did not recover persisted report date; got ${bootDate||'EMPTY'}`);
  const states=boot.payload?.businessStates||{};
  for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']){
    const total=Number(states?.[type]?.dashboard?.metrics?.total??states?.[type]?.dashboard?.totalMonitored??0);
    if(total<1)fail(`bootstrap business ${type} remained zero despite persisted fixture data`);
  }

  const whpp=await jsonRequest(`http://127.0.0.1:5177/api/v71/whpp-summary?reportDate=${REPORT_DATE}`,{headers:authHeaders});
  if(Number(whpp.payload?.total||whpp.payload?.metrics?.total||0)<1)fail('WHPP lightweight summary remained zero despite persisted fixture data');

  const app=await fetch('http://127.0.0.1:5177/',{headers:{cookie,accept:'text/html'},cache:'no-store'});
  const html=await app.text();
  if(app.status!==200)fail(`authenticated app shell returned HTTP ${app.status}`);
  if(!html.includes('/v225-auth-bootstrap-guard.js'))fail('authenticated app shell is missing V225 pre-app auth/bootstrap guard');
  if(!html.includes('/app.js'))fail('authenticated app shell is missing app.js');

  console.log(`[V226] runtime E2E passed: 5179 auth -> 5177 handoff cookie -> session ${USERNAME} -> persisted ${REPORT_DATE} -> 7 business non-zero -> WHPP summary -> guarded app shell.`);
}finally{
  if(child&&!child.killed){try{child.kill('SIGTERM');}catch{}}
  await sleep(700);
  try{fs.rmSync(temp,{recursive:true,force:true});}catch{}
}
