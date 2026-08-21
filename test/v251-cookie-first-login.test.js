import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login=fs.readFileSync('src/v251CookieFirstLoginPatch.js','utf8');
const sidecar=fs.readFileSync('src/v213AuthSidecar.js','utf8');
const cold=fs.readFileSync('src/v46ColdStartIndexPatch.js','utf8');

test('V251 primary browser path uses the signed 5179 host cookie and does not wait for 5177 handoff',()=>{
  assert.match(login,/V251_COOKIE_FIRST_LOGIN_VERSION='2026-08-21-v251-cookie-first-login-v1'/);
  assert.match(login,/sidecar=location\.protocol\+'\/\/'\+host\+':\$\{AUTH_PORT\}'/);
  assert.match(login,/\/api\/v213\/local-auth\/login/);
  assert.match(login,/credentials:'include'/);
  assert.match(login,/if\(direct\)\{/);
  assert.match(login,/location\.replace\('\/\?v251='/);
  assert.match(login,/账号已验证，浏览器会话已建立，正在进入系统/);
  assert.doesNotMatch(login,/账号已验证，主程序繁忙，正在等待会话接管/);
});

test('V251 keeps 5177 handoff only as a compatibility fallback when direct 5179 is unreachable',()=>{
  assert.match(login,/proxyFallback/);
  assert.match(login,/\/api\/v246\/internal-auth\/login/);
  assert.match(login,/\/api\/v223\/fast-auth\/accept/);
  assert.match(login,/5179直连暂不可用，正在使用同源备用认证/);
});

test('V251 relies on the sidecar signed HttpOnly host cookie that is valid across ports on the same host',()=>{
  assert.match(sidecar,/const COOKIE='ce_v213_fast_session'/);
  assert.match(sidecar,/HttpOnly; SameSite=Strict/);
  assert.match(sidecar,/handoffToken:issued\.token/);
  assert.match(sidecar,/\{'set-cookie':issued\.cookies\}/);
  assert.doesNotMatch(sidecar,/Domain=/);
});

test('V251 middleware is imported after V249 so it mounts first for the real access registration',()=>{
  const v249=cold.indexOf("import './v249LoginReliabilityPatch.js';");
  const v251=cold.indexOf("import './v251CookieFirstLoginPatch.js';");
  assert.ok(v249>=0&&v251>v249);
  assert.match(login,/previousUse\.call\(this,v251LoginMiddleware\)/);
  assert.match(login,/return previousUse\.apply\(this,args\)/);
});
