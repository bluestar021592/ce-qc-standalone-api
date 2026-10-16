// Real HTTP login/session smoke, executed ONLY inside a disposable Windows
// GitHub CI V788 pilot. Never runs on a user's workstation or formal database.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import bcrypt from 'bcryptjs';

const expected=path.win32.join('D:\\CE_QC_V788_试用沙盒','data','ce_qc_monitor.db');
const actual=path.win32.normalize(String(process.env.DB_FILE||''));
assert.equal(process.platform,'win32','V788 pilot login smoke is Windows CI only');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.CI,'true');
assert.equal(process.env.CE_QC_V788_PILOT_CI_NO_BROWSER,'1');
assert.equal(process.env.CE_QC_V788_PILOT_ISOLATED,'1');
assert.equal(String(process.env.PORT),'5278');
assert.equal(String(process.env.CE_QC_AUTH_SIDECAR_PORT),'5280');
assert.equal(actual.toLowerCase(),expected.toLowerCase(),'never open production or acceptance-source SQLite');
assert.ok(String(process.env.CE_QC_LOCAL_SESSION_SECRET||'').length>=43,'pilot must have ephemeral shared key');

const base='http://127.0.0.1:5278';
async function getJson(url,options={}){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(6000)});
  return {status:response.status,headers:response.headers,body:await response.json().catch(()=>({}))};
}
let healthy=false;
for(let i=0;i<30;i++){
  try{
    const p=await getJson(base+'/api/local-auth-proxy/health');
    if(p.status===200&&p.body?.bridgeOk===true){healthy=true;break;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,300));
}
assert.ok(healthy,'5280 sidecar must be ready through 5278 bridge before login');

const username='v788_ci_'+crypto.randomBytes(6).toString('hex');
const password=crypto.randomBytes(36).toString('base64url');
const db=new DatabaseSync(expected);
let inserted=false;
try{
  const now=new Date().toISOString();
  const hash=bcrypt.hashSync(password,8);
  db.prepare(`INSERT INTO users
    (username,displayName,passwordHash,role,businessScope,enabled,status,mustChangePassword,createdAt,updatedAt)
    VALUES(?,?,?,'ADMIN','ALL',1,'ACTIVE',0,?,?)`).run(username,'V788 Isolated Test',hash,now,now);
  inserted=true;
  const login=await getJson(base+'/api/local-auth-proxy/login',{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json','origin':base},
    body:JSON.stringify({username,password})
  });
  assert.equal(login.status,200,'isolated sidecar credentials must bind to main-port login');
  assert.equal(login.body?.ok,true,'bridge must not return AUTH_SESSION_REBIND_FAILED');
  const setCookie=String(login.headers.get('set-cookie')||'');
  assert.ok(setCookie.startsWith('ce_qc_local_auth_v788_pilot='),'pilot cookie must be independent of official V787');
  const cookie=setCookie.split(';')[0];
  const session=await getJson(base+'/api/session',{headers:{Cookie:cookie}});
  assert.equal(session.status,200,'5278 must accept the signed same-origin session');
  assert.equal(session.body?.user?.username,username,'session must match the isolated test account');
  console.log('[V788_PILOT_LOGIN] PASS real 5278→5280 login, Set-Cookie, and /api/session; no V787 access');
}finally{
  try{if(inserted)db.prepare('DELETE FROM users WHERE username=?').run(username)}
  finally{db.close()}
}
