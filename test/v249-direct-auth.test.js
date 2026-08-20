import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sidecar=fs.readFileSync('src/v213AuthSidecar.js','utf8');
const login=fs.readFileSync('src/v249LoginReliabilityPatch.js','utf8');
const cold=fs.readFileSync('src/v46ColdStartIndexPatch.js','utf8');

test('V249 keeps the auth sidecar isolated and reuses one read-only users connection instead of opening the 22GB DB per click',()=>{
  assert.match(sidecar,/V249_AUTH_PATH_VERSION='2026-08-20-v249-direct-sidecar-auth-v1'/);
  assert.match(sidecar,/new DatabaseSync\(file,\{readOnly:true\}\)/);
  assert.match(sidecar,/PRAGMA query_only=ON/);
  assert.match(sidecar,/let authDb=null/);
  assert.match(sidecar,/let authStmt=null/);
  assert.match(sidecar,/if\(authDb&&authStmt&&authDbFile===file\)return authDb/);
  assert.match(sidecar,/V249_AUTH_DB_READY/);
  assert.match(sidecar,/authPathVersion:V249_AUTH_PATH_VERSION/);
  assert.match(sidecar,/authMode:'V249_DIRECT_AUTH_SIDECAR'/);
});

test('V249 local browser verifies credentials on 5179 first and gives 5177 up to 30 seconds to hand off without fake six-second password failure',()=>{
  assert.match(login,/sidecar=location\.protocol\+'\/\/'\+host\+':\$\{AUTH_PORT\}'/);
  assert.match(login,/\/api\/v213\/auth-ping/);
  assert.match(login,/\/api\/v213\/local-auth\/login/);
  assert.match(login,/credentials:'include'/);
  assert.match(login,/const deadline=Date\.now\(\)\+30000/);
  assert.match(login,/账号已验证，主程序繁忙，正在等待会话接管/);
  assert.match(login,/\/api\/v223\/fast-auth\/accept/);
  assert.match(login,/\/api\/v246\/internal-auth\/login/);
  assert.doesNotMatch(login,/登录超过6秒没有响应/);
});

test('V249 login middleware is mounted before V246/access while V248 WHPP authority remains loaded first',()=>{
  const v248=cold.indexOf("import './v248WhppAuthorityPatch.js';");
  const v249=cold.indexOf("import './v249LoginReliabilityPatch.js';");
  assert.ok(v248>=0&&v249>v248);
  assert.match(login,/previousUse\.call\(this,v249LoginMiddleware\)/);
  assert.match(login,/return previousUse\.apply\(this,args\)/);
  assert.match(login,/X-CE-QC-Login-Reliability/);
});
