import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isV506SameOriginRequest,
  rebindV506AuthCookie,
  resolveV506BrowserChannel,
  rewriteV506LoginHtml,
  V506_LOCAL_AUTH_BRIDGE_ID
} from '../src/v506LocalAuthBridgePatch.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

function req(hostname,remote,{host=`${hostname}:5177`,origin='',protocol='http'}={}){
  return{
    hostname,protocol,headers:{host,...(origin?{origin}:{})},socket:{remoteAddress:remote},
    get(name){const key=String(name).toLowerCase();return key==='host'?host:key==='origin'?origin:'';}
  };
}
function sign(secret,payload){
  const body=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
  const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

test('V506 rewrites browser login from direct sidecar port to same-origin 5177 bridge',()=>{
  const input='<form action="http://127.0.0.1:5179/api/local-auth/login"><script>fetch(\'http://127.0.0.1:5179/api/local-auth/login\')</script>独立登录通道 5179，不占用质控主数据库写入锁。</form>';
  const output=rewriteV506LoginHtml(input);
  assert.equal(output.includes(':5179/api/local-auth/login'),false);
  assert.equal((output.match(/\/api\/local-auth-proxy\/login/g)||[]).length,2);
  assert.match(output,/当前5177页面安全转发/);
});

test('V506 preserves LOCAL and LAN channel policy including LAN_DIRECT_ENABLED',()=>{
  const previous=process.env.LAN_DIRECT_ENABLED;
  try{
    process.env.LAN_DIRECT_ENABLED='1';
    assert.equal(resolveV506BrowserChannel(req('127.0.0.1','127.0.0.1')),'LOCAL');
    assert.equal(resolveV506BrowserChannel(req('192.168.101.103','192.168.101.55')),'LAN');
    assert.equal(resolveV506BrowserChannel(req('example.com','203.0.113.8')),'');
    process.env.LAN_DIRECT_ENABLED='0';
    assert.equal(resolveV506BrowserChannel(req('192.168.101.103','192.168.101.55')),'');
  }finally{
    if(previous==null) delete process.env.LAN_DIRECT_ENABLED; else process.env.LAN_DIRECT_ENABLED=previous;
  }
});

test('V506 rejects cross-origin login bridge requests while allowing exact local/LAN origin',()=>{
  assert.equal(isV506SameOriginRequest(req('127.0.0.1','127.0.0.1',{origin:'http://127.0.0.1:5177'})),true);
  assert.equal(isV506SameOriginRequest(req('192.168.101.103','192.168.101.55',{origin:'http://192.168.101.103:5177'})),true);
  assert.equal(isV506SameOriginRequest(req('127.0.0.1','127.0.0.1',{origin:'http://evil.example:5177'})),false);
  assert.equal(isV506SameOriginRequest(req('127.0.0.1','127.0.0.1',{origin:'https://127.0.0.1:5177'})),false);
  assert.equal(isV506SameOriginRequest(req('::1','::1',{host:'[::1]:5177',origin:'http://[::1]:5177'})),true);
  assert.equal(isV506SameOriginRequest(req('127.0.0.1','127.0.0.1')),true);
});

test('V506 actually verifies and re-signs V431 cookie when rebinding LOCAL to LAN',()=>{
  const previous=process.env.CE_QC_LOCAL_SESSION_SECRET;
  const secret='v506-test-secret-abcdefghijklmnopqrstuvwxyz-0123456789';
  process.env.CE_QC_LOCAL_SESSION_SECRET=secret;
  try{
    const sourcePayload={v:431,iat:Date.now(),exp:Date.now()+60_000,channel:'LOCAL',user:{username:'qc-test',role:'ADMIN',businessScope:'ALL',devMode:true}};
    const source=sign(secret,sourcePayload);
    const rebound=rebindV506AuthCookie(`ce_qc_local_auth_v431=${source}; Path=/; HttpOnly; SameSite=Strict; Max-Age=60`,'LAN');
    const token=/ce_qc_local_auth_v431=([^;]+)/.exec(rebound)?.[1]||'';
    const [body,sig]=token.split('.');
    const expected=crypto.createHmac('sha256',secret).update(body).digest('base64url');
    assert.equal(sig,expected);
    const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    assert.equal(payload.channel,'LAN');
    assert.equal(payload.user.devMode,false);
    assert.equal(rebindV506AuthCookie(`ce_qc_local_auth_v431=${source}x; Path=/`,'LAN'),'');
  }finally{
    if(previous==null) delete process.env.CE_QC_LOCAL_SESSION_SECRET; else process.env.CE_QC_LOCAL_SESSION_SECRET=previous;
  }
});

test('V506 bridge is installed before accessIdentity and never authenticates against SQLite itself',()=>{
  const bridge=read('src/v506LocalAuthBridgePatch.js');
  const alias=read('src/v29EndpointAliasPatch.js');
  assert.match(alias,/import '\.\/v506LocalAuthBridgePatch\.js'/);
  assert.match(bridge,/args\[0\]\.name === 'accessIdentity'/);
  assert.match(bridge,/previousUse\.call\(this, v506LocalAuthBridgeMiddleware\)/);
  assert.match(bridge,/host: '127\.0\.0\.1', port: AUTH_PORT/);
  assert.match(bridge,/\/api\/local-auth\/login/);
  assert.match(bridge,/AUTH_SIDECAR_UNAVAILABLE/);
  assert.match(bridge,/AUTH_BRIDGE_ORIGIN_DENIED/);
  assert.doesNotMatch(bridge,/\bgetDb\s*\(/);
  assert.doesNotMatch(bridge,/DatabaseSync/);
  assert.match(bridge,/getRuntimeConfig\(\)\.tokenDir/);
});

test('V506 keeps native form fallback and dynamically rewrites the configured auth port',()=>{
  const bridge=read('src/v506LocalAuthBridgePatch.js');
  assert.match(bridge,/application\\\/x-www-form-urlencoded/);
  assert.match(bridge,/bridgeBody\(req\)/);
  assert.match(bridge,/res\.redirect\(303, '\/'\)/);
  assert.match(bridge,/new RegExp\(`/);
  assert.match(bridge,/escapedPort/);
  assert.match(bridge,/AUTH_SESSION_REBIND_FAILED/);
});

test('V506 exposes deterministic health and timeout behavior without exposing passwords',()=>{
  const bridge=read('src/v506LocalAuthBridgePatch.js');
  assert.equal(V506_LOCAL_AUTH_BRIDGE_ID,'2026-09-13-v506-same-origin-auth-bridge-v2');
  assert.match(bridge,/\/api\/local-auth-proxy\/health/);
  assert.match(bridge,/AUTH_SIDECAR_TIMEOUT/);
  assert.match(bridge,/MAX_RESPONSE_BYTES/);
  assert.doesNotMatch(bridge,/console\.(?:log|warn|error)\([^\n]*password/);
});

test('V556 LOCAL/LAN navigation never falls back to the SQLite-backed core session reader',()=>{
  const access=read('src/accessControl.js');
  assert.match(access,/V556_LOCAL_AUTH_FAST_PATH_ID = '2026-09-19-v556-local-auth-no-core-session-read-v1'/);
  const identity=access.match(/export async function accessIdentity\(req, res, next\) \{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(identity,/const localAuthFastPath = \(channel === 'LOCAL' \|\| channel === 'LAN'\) && !req\.v505PurgeReadOnlyAuth;/);
  assert.match(identity,/if \(!user && !localAuthFastPath\) \{/);
  assert.match(identity,/user = readSession\(req, channel, cloudflareEmail\);/);
  const issuer=access.match(/function issueSession\(res, row, req, channel, cloudflareEmail, mustChangePassword\) \{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(issuer,/LOCAL_AUTH_COOKIE/);
  assert.match(issuer,/crypto\.createHmac\('sha256', secret\)/);
  assert.match(issuer,/channel === 'LOCAL' \|\| channel === 'LAN'/);
});
