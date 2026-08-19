import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { __test, V209_LOGIN_RELIABILITY_VERSION } from '../src/v209LoginReliabilityPatch.js';

const secret='0123456789abcdef0123456789abcdef0123456789abcdef';
function sign(payload){const body=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');return`${body}.${sig}`;}

test('V213 main process verifies sidecar-issued stateless auth token',()=>{
  const payload={v:213,iat:Date.now(),exp:Date.now()+60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN',businessScope:'ALL'}};
  const token=sign(payload);const verified=__test.verifyFastToken(token,213,secret);
  assert.equal(verified.channel,'LOCAL');
  assert.equal(verified.user.username,'ce002784');
  assert.match(V209_LOGIN_RELIABILITY_VERSION,/v213-auth-sidecar-login-v1/);
});

test('V213 rejects tampered and expired sidecar tokens',()=>{
  const expired=sign({v:213,iat:Date.now()-120_000,exp:Date.now()-60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN'}});
  assert.equal(__test.verifyFastToken(expired,213,secret),null);
  const good=sign({v:213,iat:Date.now(),exp:Date.now()+60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN'}});
  const tampered=`${good.slice(0,-1)}${good.endsWith('A')?'B':'A'}`;
  assert.equal(__test.verifyFastToken(tampered,213,secret),null);
});

test('V213 local channel only accepts matching loopback or private LAN endpoints',()=>{
  const req=(host,ip)=>({hostname:host,socket:{remoteAddress:ip},get:name=>name==='host'?host:''});
  assert.equal(__test.localChannel(req('127.0.0.1','127.0.0.1')),'LOCAL');
  assert.equal(__test.localChannel(req('192.168.88.68','192.168.88.20')),'LAN');
  assert.equal(__test.localChannel(req('192.168.88.68','8.8.8.8')),'');
});

test('V213 browser login bypasses the 5177 event loop and targets port 5179',()=>{
  const html=__test.inlineLoginScript();
  assert.match(html,/5179/);
  assert.match(html,/\/api\/v213\/auth-ping/);
  assert.match(html,/\/api\/v213\/local-auth\/login/);
  assert.doesNotMatch(html,/fetch\('\/api\/internal-auth\/login'/);
});

test('V213 auth sidecar is read-only, bounded and independent of runtime getDb',()=>{
  const source=fs.readFileSync(new URL('../src/v213AuthSidecar.js',import.meta.url),'utf8');
  assert.match(source,/new DatabaseSync\(file,\{readOnly:true\}\)/);
  assert.match(source,/PRAGMA query_only=ON/);
  assert.match(source,/PRAGMA busy_timeout=500/);
  assert.match(source,/CE_QC_AUTH_SIDECAR_PORT\|\|5179/);
  assert.match(source,/V213_AUTH_SIDECAR_LOGIN_START/);
  assert.match(source,/V213_AUTH_SIDECAR_LOGIN_OK/);
  assert.doesNotMatch(source,/import \{ getDb/);
  assert.doesNotMatch(source,/INSERT INTO user_sessions/);
  assert.doesNotMatch(source,/UPDATE users SET failedLoginCount/);
});

test('V213 auth sidecar is spawned only by bootstrap/server, never by unit tests',()=>{
  assert.equal(__test.shouldStartAuthSidecar(),false);
});
