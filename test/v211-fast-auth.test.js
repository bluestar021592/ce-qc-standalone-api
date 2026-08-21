import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { __test, V209_LOGIN_RELIABILITY_VERSION } from '../src/v209LoginReliabilityPatch.js';

const secret='0123456789abcdef0123456789abcdef0123456789abcdef';
function sign(payload){const body=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');return`${body}.${sig}`;}

test('V223 main process verifies sidecar-issued stateless auth token',()=>{
  const payload={v:213,iat:Date.now(),exp:Date.now()+60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN',businessScope:'ALL'}};
  const token=sign(payload);const verified=__test.verifyFastToken(token,213,secret);
  assert.equal(verified.channel,'LOCAL');
  assert.equal(verified.user.username,'ce002784');
  assert.match(V209_LOGIN_RELIABILITY_VERSION,/v223-main-session-handoff-v1/);
});

test('V223 rejects tampered and expired sidecar tokens',()=>{
  const expired=sign({v:213,iat:Date.now()-120_000,exp:Date.now()-60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN'}});
  assert.equal(__test.verifyFastToken(expired,213,secret),null);
  const good=sign({v:213,iat:Date.now(),exp:Date.now()+60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN'}});
  const tampered=`${good.slice(0,-1)}${good.endsWith('A')?'B':'A'}`;
  assert.equal(__test.verifyFastToken(tampered,213,secret),null);
});

test('V223 local channel only accepts matching loopback or private LAN endpoints',()=>{
  const req=(host,ip)=>({hostname:host,socket:{remoteAddress:ip},get:name=>name==='host'?host:''});
  assert.equal(__test.localChannel(req('127.0.0.1','127.0.0.1')),'LOCAL');
  assert.equal(__test.localChannel(req('192.168.88.68','192.168.88.20')),'LAN');
  assert.equal(__test.localChannel(req('192.168.88.68','8.8.8.8')),'');
});

test('V223 browser login completes 5179 auth then 5177 main-session handoff before navigation',()=>{
  const html=__test.inlineLoginScript();
  assert.match(html,/5179/);
  assert.match(html,/\/api\/v213\/auth-ping/);
  assert.match(html,/\/api\/v213\/local-auth\/login/);
  assert.match(html,/\/api\/v223\/fast-auth\/accept/);
  assert.match(html,/handoffToken/);
  assert.match(html,/正在建立主程序会话/);
  assert.doesNotMatch(html,/fetch\('\/api\/internal-auth\/login'/);
});

test('V223/V249 auth sidecar is read-only, bounded, persistent and returns a signed handoff token',()=>{
  const source=fs.readFileSync(new URL('../src/v213AuthSidecar.js',import.meta.url),'utf8');
  assert.match(source,/new DatabaseSync\(file,\{readOnly:true\}\)/);
  assert.match(source,/PRAGMA query_only=ON/);
  const busy=source.match(/PRAGMA busy_timeout=(\d+)/);
  assert.ok(busy,'auth sidecar must set a bounded SQLite busy timeout');
  assert.ok(Number(busy[1])>0&&Number(busy[1])<=2000,`auth sidecar busy timeout must stay interactive; got ${busy[1]}ms`);
  assert.match(source,/let authDb=null/);
  assert.match(source,/let authStmt=null/);
  assert.match(source,/if\(authDb&&authStmt&&authDbFile===file\)return authDb/);
  assert.match(source,/CE_QC_AUTH_SIDECAR_PORT\|\|5179/);
  assert.match(source,/V249_AUTH_LOGIN_START/);
  assert.match(source,/V249_AUTH_LOGIN_OK/);
  assert.match(source,/handoffToken:issued\.token/);
  assert.doesNotMatch(source,/import \{ getDb/);
  assert.doesNotMatch(source,/INSERT INTO user_sessions/);
  assert.doesNotMatch(source,/UPDATE users SET failedLoginCount/);
});

test('V223 main handoff is middleware-local and does not wait for dashboard/bootstrap data',()=>{
  const source=fs.readFileSync(new URL('../src/v209LoginReliabilityPatch.js',import.meta.url),'utf8');
  assert.equal(__test.HANDOFF_PATH,'/api/v223/fast-auth/accept');
  assert.match(source,/V223_AUTH_HANDOFF_OK/);
  assert.match(source,/req\.path===HANDOFF_PATH/);
  assert.match(source,/setFastCookie\(res,token,payload\)/);
  assert.match(source,/if\(channel&&readFastSession\(req,channel\)\)return next\(\)/);
  assert.doesNotMatch(source,/HANDOFF_PATH[^\n]*getDb\(/);
});

test('V213/V223 auth sidecar is spawned only by bootstrap/server, never by unit tests',()=>{
  assert.equal(__test.shouldStartAuthSidecar(),false);
});

test('V214 main web process never performs the large CCSL POD-lock repair synchronously after login',()=>{
  const source=fs.readFileSync(new URL('../src/v167CcslPodLockFactRepair.js',import.meta.url),'utf8');
  assert.match(source,/v214-ccsl-pod-lock-worker-v1/);
  assert.match(source,/scheduleRepairWorker\(\)/);
  assert.match(source,/v167CcslPodLockFactRepairWorker\.js/);
  assert.match(source,/if \(!database && String\(process\.env\.CE_QC_V167_REPAIR_WORKER/);
  assert.match(source,/will run outside the 5177 web process/);
});

test('V214 isolated POD-lock worker is syntactically valid before installation',()=>{
  const file=fileURLToPath(new URL('../src/v167CcslPodLockFactRepairWorker.js',import.meta.url));
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
