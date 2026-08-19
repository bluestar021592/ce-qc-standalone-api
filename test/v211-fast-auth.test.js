import test from 'node:test';
import assert from 'node:assert/strict';
import { __test, V209_LOGIN_RELIABILITY_VERSION } from '../src/v209LoginReliabilityPatch.js';

const secret='0123456789abcdef0123456789abcdef0123456789abcdef';

test('V211 fast auth token signs and verifies without QC database writes',()=>{
  const payload={v:211,iat:Date.now(),exp:Date.now()+60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN',businessScope:'ALL'}};
  const token=__test.signFastPayload(payload,secret);
  const verified=__test.verifyFastToken(token,secret);
  assert.equal(verified.channel,'LOCAL');
  assert.equal(verified.user.username,'ce002784');
  assert.match(V209_LOGIN_RELIABILITY_VERSION,/v211-local-fast-auth-v1/);
});

test('V211 rejects tampered or expired fast auth tokens',()=>{
  const payload={v:211,iat:Date.now()-120_000,exp:Date.now()-60_000,channel:'LOCAL',user:{username:'ce002784',role:'ADMIN'}};
  const expired=__test.signFastPayload(payload,secret);
  assert.equal(__test.verifyFastToken(expired,secret),null);
  const good=__test.signFastPayload({...payload,exp:Date.now()+60_000},secret);
  const tampered=`${good.slice(0,-1)}${good.endsWith('A')?'B':'A'}`;
  assert.equal(__test.verifyFastToken(tampered,secret),null);
});

test('V211 local channel only accepts matching loopback or private LAN endpoints',()=>{
  const req=(host,ip)=>({hostname:host,socket:{remoteAddress:ip},get:name=>name==='host'?host:''});
  assert.equal(__test.localChannel(req('127.0.0.1','127.0.0.1')),'LOCAL');
  assert.equal(__test.localChannel(req('192.168.88.68','192.168.88.20')),'LAN');
  assert.equal(__test.localChannel(req('192.168.88.68','8.8.8.8')),'');
});
